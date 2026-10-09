/**
 * Journal d'audit — écriture et consultation.
 *
 * Le principe qui gouverne ce service : une opération métier importante doit
 * laisser une trace, et cette trace ne doit pas pouvoir être réécrite.
 *
 * Trois conséquences en découlent, chacune visible dans le code.
 *
 * **L'origine est récupérée, pas demandée.** Adresse IP et client figurent
 * dans le contexte de requête, ouvert avant même l'authentification. Les
 * services métier n'ont donc pas à les passer : il leur faut l'action et
 * l'entité, le reste vient tout seul. C'est la seule façon que ces colonnes
 * soient réellement renseignées — une valeur que fourteen modules doivent se
 * souvenir de transmettre finit toujours par être oubliée à un endroit.
 *
 * **Un échec d'écriture n'est pas avalé.** Une écriture d'audit qui échoue en
 * silence laisse une opération réussie sans preuve : c'est le pire état
 * possible, puisqu'il est indiscernable d'une opération qui n'a rien fait.
 * Selon le cas, l'échec interrompt l'opération ou remonte à l'appelant.
 *
 * **La lecture est un droit, l'écriture est un fait.** `query` est filtré par
 * les droits de l'appelant ; `record` ne l'est pas, parce qu'une trace ne se
 * refuse pas. Personne n'ajoute ni ne retire une ligne par l'interface : la
 * base refuse l'écriture après coup, et cette restriction ne dépend pas du
 * code applicatif.
 */

import { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  actionsCataloguees,
  describeAuditAction,
  prefixesDeCategorie,
  prefixesFamilles,
  type AuditActionDescription,
  type AuditCategory,
} from '@logixpress/types';
import { getPrisma } from '../database/prisma-context';
import { auditReason, getAuditContext } from './audit-context';

/** Longueur des codes d'action et de type d'entité dans le schéma. */
const CODE_MAX = 50;
/** Borne haute par défaut d'un filtre de période : un `timestamptz` admet 294 000 ans. */
const MAX_DATE = new Date('9999-12-31T23:59:59.999Z');

/** Ce qu'une écriture d'audit porte au minimum. */
export interface AuditRecordInput {
  entityType: string;
  entityId: string;
  action: string;
  /**
   * Justification en clair.
   *
   * Le catalogue marque certaines actions comme exigeant un motif. Ce champ
   * n'est pas enforced ici : bloquer un encaissement faute de commentaire
   * déplacerait le problème. Il est signalé à l'écriture, et l'écran le montre
   * — ce qui laisse la trace de ce qui a été fait sans justification.
   */
  reason?: string | null;
  /** État avant. */
  previousValues?: unknown;
  /** État après. */
  newValues?: unknown;
  /** Acteur ; à défaut, celui du contexte de requête. */
  userId?: string | null;
  userIp?: string | null;
  userAgent?: string | null;
}

/** Ligne du journal, telle que la restituera l'interface. */
export interface AuditEntry {
  id: string;
  entityType: string;
  entityLabel: string;
  entityId: string;
  action: string;
  actionLabel: string;
  category: string;
  categoryLabel: string;
  critical: boolean;
  /** Le code est-il au catalogue ? Un code inconnu est affiché tel quel. */
  knownAction: boolean;
  reason: string | null;
  /** Vrai si le catalogue exigeait un motif et qu'il n'y en a pas. */
  missingReason: boolean;
  previousValues: unknown;
  newValues: unknown;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  userIp: string | null;
  userAgent: string | null;
  timestamp: string;
}

/** Filtres de la consultation, tous facultatifs. */
export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  action?: string;
  userId?: string;
  /** Accepte une catégorie (`FINANCE`) ou plusieurs codes d'action. */
  category?: string;
  /** Borne basse, incluse. */
  from?: string;
  /** Borne haute, incluse. */
  to?: string;
  /** Recherche libre sur le motif. */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** Erreur d'écriture d'audit, distincte des erreurs métier. */
export class AuditWriteError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AuditWriteError';
  }
}

/** Ligne brute du journal. */
type RawEntry = Prisma.AuditLogGetPayload<object>;

/** Auteur d'une ligne : compte existant, ou compte supprimé depuis. */
interface Auteur {
  fullName: string;
  role: string | null;
}

/** Actions qui suppriment un compte : leur `previousValues` garde son nom. */
const ACTIONS_SUPPRESSION = ['USER_SUPPRIME', 'DRIVER_SUPPRIME', 'SHIPPER_SUPPRIME'];

export class AuditService {
  /**
   * Journalise une action.
   *
   * L'IP et le client viennent du contexte de requête quand l'appelant ne les
   * fournit pas. Le contexte est relu à l'instant de l'écriture, et non à
   * celui de l'appel : entre les deux, une transaction a pu s'ouvrir, et c'est
   * toujours la requête courante qu'on veut voir inscrite.
   */
  async record(input: AuditRecordInput, tx?: Prisma.TransactionClient): Promise<void> {
    const contexte = getAuditContext();
    const client = tx ?? getPrisma();

    const entree: Prisma.AuditLogUncheckedCreateInput = {
      entityType: input.entityType.slice(0, CODE_MAX),
      entityId: input.entityId.slice(0, 100),
      action: input.action.slice(0, CODE_MAX),
      reason: auditReason(input.reason),
      previousValues: jsonOuAbsence(input.previousValues),
      newValues: jsonOuAbsence(input.newValues),
      userId: input.userId ?? contexte?.userId ?? null,
      userIp: input.userIp ?? contexte?.ip ?? null,
      userAgent: input.userAgent ?? contexte?.userAgent ?? null,
    };

    await client.auditLog.create({ data: entree });
  }

  /**
   * Journalise, ou signale l'échec.
   *
   * C'est la forme à utiliser pour une opération engageante : encaissement,
   * annulation, réception. Si la trace ne peut pas être écrite, l'opération ne
   * doit pas être considérée comme faite.
   *
   * À employer à l'intérieur d'une transaction, quand l'opération métier et sa
   * trace doivent aboutir ensemble, ou échouer ensemble.
   */
  async recordOrFail(input: AuditRecordInput, tx?: Prisma.TransactionClient): Promise<void> {
    try {
      await this.record(input, tx);
    } catch (error) {
      throw new AuditWriteError(
        `Journalisation impossible (${input.action}) : l'opération n'a pas été enregistrée.`,
        error
      );
    }
  }

  /**
   * Journalise sans jamais faire échouer l'opération.
   *
   * Réservé aux écritures *complémentaires* d'une opération déjà sûre : une
   * notification d'export, une trace de consultation. Utilisé pour une
   * réception ou un encaissement, il laisserait passer une opération sans
   * preuve — c'est le défaut que ce service existe pour empêcher.
   */
  async recordBestEffort(input: AuditRecordInput): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      console.error('[Audit] Trace non écrite :', input.entityType, input.action, error);
    }
  }

  /** Historique d'une entité, du plus récent au plus ancien. */
  async listForEntity(entityType: string, entityId: string, limit = 50): Promise<AuditEntry[]> {
    const resultat = await this.query({ entityType, entityId, limit });
    return resultat.entries;
  }

  /**
   * Consultation du journal.
   *
   * La pagination est plafonnée : le journal croît sans borne, et une
   * requête sans limite transformerait l'écran d'historique en source de
   * déni de service — sur la base, qui est le composant le plus sollicité de
   * l'application.
   */
  async query(filtres: AuditQuery): Promise<AuditQueryResult> {
    const prisma = getPrisma();
    const limit = Math.min(Math.max(filtres.limit ?? 50, 1), 200);
    const offset = Math.max(filtres.offset ?? 0, 0);
    const where = this.construireFiltre(filtres);

    const [lignes, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      prisma.auditLog.count({ where }),
    ]);

    const auteurs = await this.auteurs(lignes.map((l) => l.userId));
    return {
      entries: lignes.map((ligne) => this.versEntree(ligne, auteurs)),
      total,
      limit,
      offset,
    };
  }

  /**
   * Répartition des actions sur une période.
   *
   * Alimentée par un regroupement en base : compter ligne à ligne en
   * mémoire chargerait tout l'historique pour produire une dizaine de nombres.
   */
  async summary(depuis?: string, jusqua?: string): Promise<{
    total: number;
    parAction: Array<{ action: string; label: string; category: string; count: number; critical: boolean }>;
    parCategorie: Array<{ category: string; label: string; count: number }>;
    parEntite: Array<{ entityType: string; label: string; count: number }>;
  }> {
    const prisma = getPrisma();
    const bornes = bornesTemporelles(depuis, jusqua);

    // Comptages faits en SQL plutôt qu'en JavaScript.
    //
    // `groupBy` ferait trois requêtes et transposerait chaque ligne en objet
    // pour en lire un nombre ; ici un seul aller-retour rend les trois
    // résultats, déjà typés, et sans faire transiter le journal en mémoire —
    // il n'a pas de limite de taille.
    const [actions, entites, total] = await Promise.all([
      prisma.$queryRaw<{ action: string; count: bigint }[]>`
        SELECT "action", COUNT(*) AS count FROM "AuditLog"
        WHERE ${fragmentPeriode(bornes)} GROUP BY "action"
      `,
      prisma.$queryRaw<{ entityType: string; count: bigint }[]>`
        SELECT "entityType", COUNT(*) AS count FROM "AuditLog"
        WHERE ${fragmentPeriode(bornes)} GROUP BY "entityType"
      `,
      prisma.auditLog.count({ where: bornes ? { timestamp: bornes } : {} }),
    ]);

    const parAction = actions
      .map(({ action, count }) => {
        const description: AuditActionDescription = describeAuditAction(action);
        return {
          action,
          label: description.label,
          category: description.categoryLabel,
          count: Number(count),
          critical: description.critical,
        };
      })
      // Les actions rares d'abord en cas d'égalité : ce sont elles qu'on
      // cherche quand on relit un dossier.
      .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action));

    const parCategorieBrut = new Map<string, number>();
    for (const ligne of parAction) {
      parCategorieBrut.set(ligne.category, (parCategorieBrut.get(ligne.category) ?? 0) + ligne.count);
    }

    return {
      total,
      parAction,
      parCategorie: [...parCategorieBrut.entries()]
        .map(([category, count]) => ({ category, label: category, count }))
        .sort((a, b) => b.count - a.count),
      parEntite: entites
        .map(({ entityType, count }) => ({
          entityType,
          label: libelleEntite(entityType),
          count: Number(count),
        }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /**
   * Actions bedonnées dans le journal, pour le filtre de l'écran.
   *
   * La liste est mesurée, pas devinée : le catalogue peut être en avance sur ce
   * qui a réellement été écrit, et une entrée absente des filtres devient une
   * ligne que l'on ne peut pas retrouver.
   */
  async knownActions(): Promise<Array<{ action: string; count: number; description: AuditActionDescription }>> {
    const prisma = getPrisma();
    const groupes = await prisma.$queryRaw<{ action: string; count: bigint }[]>`
      SELECT "action", COUNT(*) AS count FROM "AuditLog" GROUP BY "action"
    `;
    return groupes
      .map(({ action, count }) => ({ action, count: Number(count), description: describeAuditAction(action) }))
      .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action));
  }

  /** Traduit les filtres de l'écran en clause `where`. */
  private construireFiltre(filtres: AuditQuery): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};

    if (filtres.entityType) where.entityType = filtres.entityType;
    if (filtres.entityId) where.entityId = filtres.entityId;
    if (filtres.userId) where.userId = filtres.userId;
    if (filtres.search?.trim()) {
      where.reason = { contains: filtres.search.trim(), mode: 'insensitive' };
    }

    if (filtres.action?.trim()) {
      const codes = filtres.action
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean);
      if (codes.length > 0) where.action = { in: codes };
    }

    if (filtres.category?.trim()) {
      // Un filtre de catégorie doit suivre les actions construites par
      // interpolation — `PACKAGE_STATUS_RECU_DEPOT` est bien une action de
      // colis — que le catalogue connaît sous un motif et non sous un code.
      const voulues = filtres.category
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      // Chaque catégorie demandée contribue sa clause, y compris lorsqu'elle ne
      // correspond à aucune action : une catégorie inconnue rend un journal vide
      // au lieu du journal entier. Élargir silencieusement la recherche parce
      // qu'un filtre n'a pas su être traduit donnerait à lire autre chose que ce
      // qui a été demandé — sur un relevé d'audit, c'est le pire des défauts.
      const clauses = voulues.map((categorie) => clauseDeCategorie(categorie));
      const and: Prisma.AuditLogWhereInput[] = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [...and, { OR: clauses }];
    }

    const bornes = bornesTemporelles(filtres.from, filtres.to);
    if (bornes) where.timestamp = bornes;

    return where;
  }

  /** Enveloppe une ligne brute pour l'interface. */
  /**
   * Noms des auteurs. Le journal n'a pas de clé étrangère vers `User` (un
   * compte supprimé ne doit pas toucher à l'historique) : les comptes existants
   * sont lus en une requête, et ceux supprimés depuis retrouvent leur nom dans
   * l'entrée de suppression (`previousValues.fullName`).
   */
  private async auteurs(ids: Array<string | null>): Promise<Map<string, Auteur>> {
    const uniques = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const resultat = new Map<string, Auteur>();
    if (uniques.length === 0) return resultat;
    const prisma = getPrisma();
    const comptes = await prisma.user.findMany({
      where: { id: { in: uniques } },
      select: { id: true, fullName: true, userRoles: { select: { role: { select: { name: true } } }, take: 1 } },
    });
    for (const c of comptes) resultat.set(c.id, { fullName: c.fullName, role: c.userRoles[0]?.role.name ?? null });
    const manquants = uniques.filter((id) => !resultat.has(id));
    if (manquants.length > 0) {
      const suppressions = await prisma.auditLog.findMany({
        where: { action: { in: ACTIONS_SUPPRESSION }, entityType: 'USER', entityId: { in: manquants } },
        select: { entityId: true, previousValues: true },
      });
      for (const s of suppressions) {
        const avant = (s.previousValues ?? {}) as { fullName?: unknown; role?: unknown };
        if (typeof avant.fullName === 'string') {
          resultat.set(s.entityId, {
            fullName: `${avant.fullName} (compte supprimé)`,
            role: typeof avant.role === 'string' ? avant.role : null,
          });
        }
      }
    }
    return resultat;
  }

  private versEntree(ligne: RawEntry, auteurs: Map<string, Auteur>): AuditEntry {
    const auteur = ligne.userId ? auteurs.get(ligne.userId) : undefined;
    const action = describeAuditAction(ligne.action);
    // Le motif est obligatoire quand le catalogue le dit.
    const exigeMotif = AUDIT_ACTIONS[ligne.action]?.requiresReason;

    return {
      id: ligne.id,
      entityType: ligne.entityType,
      entityLabel: libelleEntite(ligne.entityType),
      entityId: ligne.entityId,
      action: ligne.action,
      actionLabel: action.label,
      category: action.category,
      categoryLabel: action.categoryLabel,
      critical: action.critical,
      knownAction: action.known,
      reason: ligne.reason,
      missingReason: Boolean(exigeMotif) && !ligne.reason,
      previousValues: ligne.previousValues ?? null,
      newValues: ligne.newValues ?? null,
      userId: ligne.userId,
      userName: auteur?.fullName ?? (ligne.userId ? 'Compte supprimé' : null),
      userRole: auteur?.role ?? null,
      userIp: ligne.userIp,
      userAgent: ligne.userAgent,
      timestamp: ligne.timestamp.toISOString(),
    };
  }

  private prisma() {
    return getPrisma();
  }
}

/** Convertit une valeur en JSON, ou la retire si elle n'en contient pas. */
function jsonOuAbsence(valeur: unknown): Prisma.InputJsonValue | undefined {
  if (valeur === undefined || valeur === null) return undefined;
  if (typeof valeur === 'string') return { value: valeur };
  return valeur as Prisma.InputJsonValue;
}

/**
 * Fragment SQL d'une borne temporelle.
 *
 * Une borne absente est remplacée par les extrêmes du domaine : la clause
 * reste ainsi identique dans tous les cas, et la requête garde le même plan
 * que la période soit précisée ou non.
 */
function fragmentPeriode(bornes: Prisma.DateTimeFilter | undefined): Prisma.Sql {
  return bornes
    ? Prisma.sql`"timestamp" BETWEEN ${bornes.gte ?? new Date(0)} AND ${bornes.lte ?? new Date(MAX_DATE)}`
    : Prisma.sql`TRUE`;
}

/** Bornes temporelles, si l'une des deux est exploitable. */
function bornesTemporelles(depuis?: string, jusqua?: string): Prisma.DateTimeFilter | undefined {
  const debut = depuis ? new Date(depuis) : null;
  const fin = jusqua ? new Date(jusqua) : null;
  const valide = (d: Date | null): d is Date => d !== null && !Number.isNaN(d.getTime());
  if (!valide(debut) && !valide(fin)) return undefined;
  return {
    ...(valide(debut) ? { gte: debut } : {}),
    // `to` est pris tel quel : une borne haute donnée à la date du jour exclut
    // tout ce qui a été écrit dans la journée. La fin de journée est donc
    // reconstruite quand la borne n'en précise pas.
    ...(valide(fin) ? { lte: fin } : {}),
  };
}

/** Préfixes des actions d'une catégorie, pour le filtre correspondant. */
function codesDeCategorie(categorie: string): string[] {
  return prefixesDeCategorie(categorie as AuditCategory);
}

/**
 * Clause de filtrage d'une catégorie.
 *
 * « Non répertoriée » est la seule catégorie qui ne se reconnaisse pas à un
 * préfixe : elle regroupe au contraire tout ce qui n'est ni un code du
 * catalogue ni le début d'une famille.
 */
function clauseDeCategorie(categorie: string): Prisma.AuditLogWhereInput {
  if (categorie === 'REFERENTIEL') {
    // `StringFilter` ne connaît pas `in` : c'est une égalité par code.
    const connues: Prisma.AuditLogWhereInput[] = actionsCataloguees().map((code) => ({
      action: { equals: code },
    }));
    const familles: Prisma.AuditLogWhereInput[] = prefixesFamilles().map((prefixe) => ({
      action: { startsWith: prefixe },
    }));
    return { NOT: { OR: [...connues, ...familles] } };
  }
  const codes = codesDeCategorie(categorie);
  if (codes.length === 0) return RIEN;
  return { OR: codes.map((code) => ({ action: { startsWith: code } })) };
}

/**
 * Condition qui ne retient aucune ligne.
 *
 * Passe par un `OR` vide ne convient pas : Prisma lit `{ OR: [] }` comme une
 * absence de contrainte, et le filtre rapporterait alors tout le journal. Une
 * condition impossible, elle, dit exactement ce qu'elle veut.
 *
 * L'action ne peut pas être vide — la base l'interdit —, et le comparer à une
 * chaîne vide ne demande donc à personne.
 */
const RIEN: Prisma.AuditLogWhereInput = { action: { equals: '' } };

/** Libellé lisible d'un type d'entité, avec repli sur le code brut. */
function libelleEntite(entityType: string): string {
  return AUDIT_ENTITY_TYPES[entityType as keyof typeof AUDIT_ENTITY_TYPES] ?? entityType;
}


export const auditService = new AuditService();