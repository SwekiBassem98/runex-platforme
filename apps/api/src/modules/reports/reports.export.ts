/**
 * Mise en CSV des rapports.
 *
 * Un rapport exporté doit se relire dans un tableur, sans l'application et sans
 * le rapport à côté. Deux règles en découlent :
 *
 * - **ce qui sort, ce sont les lignes.** Un total ne se relit pas ligne à ligne,
 *   une liste d'expéditeurs si. Les agrégats restent à l'écran ; le fichier
 *   porte le détail, pour qu'on puisse retrouver le colis derrière un chiffre.
 * - **la période et le périmètre voyagent avec le fichier.** Un tableau de
 *   chiffres sans période lue est un tableau qu'on ne peut ni comparer au
 *   suivant ni opposer à quelqu'un.
 *
 * Les lignes portent leur libellé en clair, jamais leur code : le fichier est
 * lu par un exploitant, pas relu par le programme.
 */

import { buildCsv, MAX_EXPORT_ROWS, timestampedFilename } from '../../common/csv/csv';
import { badRequest } from '../../common/errors/api-error';
import { reportsService } from './reports.service';
import type { DomaineRapport, FiltresRapport } from './reports.types';

/** Le périmètre de l'appelant, tel que le middleware l'a calculé. */
type Scope = { shipperId?: string; assignedDriverId?: string; depositId?: string };

/** Une cellule de sortie. */
type Cellule = string | number | null | undefined;

export interface ExportRapport {
  csv: string;
  filename: string;
  rowCount: number;
}

/**
 * Assemble le fichier, en écartant les rapports qui dépassent la limite.
 *
 * La limite est vérifiée avant l'assemblage : au-delà, le fichier serait assemblé
 * pour être refusé ensuite, et l'export d'une année pleine coûterait une mémoire
 * inutile avant de dire non.
 */
function assembler(
  domaine: DomaineRapport,
  filtres: FiltresRapport,
  enTetes: ReadonlyArray<string>,
  lignes: ReadonlyArray<ReadonlyArray<Cellule>>
): ExportRapport {
  if (lignes.length > MAX_EXPORT_ROWS) {
    throw badRequest(
      `Export refusé : ${lignes.length.toLocaleString('fr-TN')} lignes dépassent la limite de ` +
        `${MAX_EXPORT_ROWS.toLocaleString('fr-TN')}. Resserrez la période.`
    );
  }
  return {
    csv: buildCsv(enTetes, lignes),
    filename: timestampedFilename(`rapport_${domaine}`),
    rowCount: lignes.length,
  };
}

/**
 * Les lignes d'un objet déjà mis en forme.
 *
 * Les agrégats portent des `montantDu` en chaîne à trois décimales ; les
 * convertir ici serait le travail du service, qui connaît le type.
 */
function depuisObjet<T extends Record<string, unknown>>(
  lignes: ReadonlyArray<T>,
  colonnes: ReadonlyArray<[string, string]> // [clé, libellé de colonne]
): { enTetes: string[]; lignes: Cellule[][] } {
  return {
    enTetes: colonnes.map(([, libelle]) => libelle),
    lignes: lignes.map((ligne) => colonnes.map(([cle]) => (ligne[cle] ?? null) as Cellule)),
  };
}

/** COLIS — les colis créés dans la période, ce qu'il en est advenu. */
export async function exportColis(filtres: FiltresRapport, scope: Scope): Promise<ExportRapport> {
  const lignes = await reportsService.detailColis(filtres, scope);
  const colonnes: Array<[string, string]> = [
    ['tracking', 'Numéro de suivi'],
    ['expediteur', 'Expéditeur'],
    ['livreur', 'Livreur'],
    ['codeLivreur', 'Code livreur'],
    ['depotOrigine', 'Dépôt d\'origine'],
    ['depotActuel', 'Dépôt actuel'],
    ['statut', 'Statut'],
    ['type', 'Type'],
    ['pieces', 'Pièces'],
    ['montantDu', 'Montant à encaisser (DT)'],
    ['encaisse', 'Montant encaissé (DT)'],
    ['creeLe', 'Créé le'],
    ['livreLe', 'Livré le'],
  ];
  const { enTetes, lignes: corps } = depuisObjet(lignes, colonnes);
  const { csv, filename, rowCount } = assembler('colis', filtres, enTetes, corps);
  return { csv, filename, rowCount };
}

/** EXPÉDITEURS — ce qui a été confié à chacun, et ce qui en est revenu. */
export async function exportExpediteurs(filtres: FiltresRapport, scope: Scope): Promise<ExportRapport> {
  const rapport = await reportsService.expediteurs(filtres, scope);
  const colonnes: Array<[string, string]> = [
    ['code', 'Code'],
    ['nom', 'Expéditeur'],
    ['colis', 'Colis confiés'],
    ['livres', 'Livrés'],
    ['incidents', 'Incidents'],
    ['tauxReussite', 'Taux de réussite (%)'],
    ['montantDu', 'Montant dû (DT)'],
    ['montantEncaisse', 'Montant encaissé (DT)'],
    ['nonEncaisse', 'Non encaissé (DT)'],
  ];
  const { enTetes, lignes } = depuisObjet(rapport.expediteurs, colonnes);
  const { csv, filename, rowCount } = assembler('expediteurs', filtres, enTetes, lignes);
  return { csv, filename, rowCount };
}

/** LIVREURS — la performance de chacun, et sa trésorerie déclarée. */
export async function exportLivreurs(filtres: FiltresRapport, scope: Scope): Promise<ExportRapport> {
  const rapport = await reportsService.livreurs(filtres, scope);
  const colonnes: Array<[string, string]> = [
    ['code', 'Code'],
    ['nom', 'Livreur'],
    ['vehicule', 'Véhicule'],
    ['affectes', 'Colis affectés'],
    ['livres', 'Livrés'],
    ['echecs', 'Échecs'],
    ['retournes', 'Retournés'],
    ['enCours', 'En cours'],
    ['tauxReussite', 'Taux de réussite (%)'],
    ['tentatives', 'Tentatives de passage'],
    ['montantEncaisse', 'Encaissé (DT)'],
    ['deficitDeclare', 'Déficit déclaré (DT)'],
    ['soldeEspeces', 'Solde espèces déclaré (DT)'],
    ['dernierTour', 'Dernière tournée'],
  ];
  const { enTetes, lignes } = depuisObjet(rapport.livreurs, colonnes);
  const { csv, filename, rowCount } = assembler('livreurs', filtres, enTetes, lignes);
  return { csv, filename, rowCount };
}

/** FINANCE — le grand livre de la caisse sur la période. */
export async function exportFinance(filtres: FiltresRapport, scope: Scope): Promise<ExportRapport> {
  const lignes = await reportsService.detailFinancier(filtres, scope);
  const colonnes: Array<[string, string]> = [
    ['numero', 'N° encaissement'],
    ['colis', 'Colis'],
    ['expediteur', 'Expéditeur'],
    ['livreur', 'Livreur'],
    ['moyen', 'Moyen de paiement'],
    ['statut', 'Statut'],
    ['attendu', 'Attendu (DT)'],
    ['encaisse', 'Encaissé (DT)'],
    ['rembourse', 'Remboursé (DT)'],
    ['ecart', 'Écart (DT)'],
    ['motif', 'Motif de l\'écart'],
    ['collecteLe', 'Collecté le'],
    ['valideLe', 'Validé le'],
  ];
  const { enTetes, lignes: corps } = depuisObjet(lignes, colonnes);
  const { csv, filename, rowCount } = assembler('finance', filtres, enTetes, corps);
  return { csv, filename, rowCount };
}

/**
 * DÉPÔTS — l'état du stock et les transferts.
 *
 * Le rapport mêle deux natures de lignes : les dépôts et les transferts. Une
 * colonne `Nature` les distingue, ce qui garde un seul tableau rectangulaire —
 * deux sections dans un CSV ne seraient pas relisibles par un tableur.
 */
export async function exportDepots(filtres: FiltresRapport, scope: Scope): Promise<ExportRapport> {
  const rapport = await reportsService.depots(filtres, scope);

  const enTetes = [
    'Nature',
    'Référence',
    'Nom',
    'Actif',
    'Reçus',
    'Livrés',
    'Retournés',
    'Stock actuel',
    'En transfert',
    'Colis attendus',
    'Colis reçus',
    'Écart',
    'Statut',
    'Expédié le',
    'Reçu le',
  ];

  const corps: Cellule[][] = [
    ...rapport.depots.map((d) => [
      'Dépôt',
      d.code,
      d.nom,
      d.actif ? 'Oui' : 'Non',
      d.recus,
      d.livres,
      d.retournes,
      d.stock,
      d.enTransfert,
      null,
      null,
      null,
      null,
      null,
      null,
    ]),
    ...rapport.transferts.map((t) => [
      'Transfert',
      t.numero,
      `${t.source} → ${t.destination}`,
      null,
      null,
      null,
      null,
      null,
      null,
      t.colisAttendus,
      t.colisRecus,
      t.ecart,
      t.libelleStatut,
      t.expedieLe ?? '',
      t.recuLe ?? '',
    ]),
  ];

  const { csv, filename, rowCount } = assembler('depots', filtres, enTetes, corps);
  return { csv, filename, rowCount };
}

/** L'export d'un domaine, ou le refus de ce qui n'en a pas. */
export async function exporter(
  domaine: DomaineRapport,
  filtres: FiltresRapport,
  scope: Scope,
  actor: { id?: string }
): Promise<ExportRapport> {
  let resultat: ExportRapport;
  switch (domaine) {
    case 'colis':
      resultat = await exportColis(filtres, scope);
      break;
    case 'expediteurs':
      resultat = await exportExpediteurs(filtres, scope);
      break;
    case 'livreurs':
      resultat = await exportLivreurs(filtres, scope);
      break;
    case 'finance':
      resultat = await exportFinance(filtres, scope);
      break;
    case 'depots':
      resultat = await exportDepots(filtres, scope);
      break;
    default:
      throw badRequest('Rapport inconnu.');
  }
  // L'export est tracé avec son auteur : le fichier quitte l'application.
  await reportsService.tracerExport(domaine, filtres, actor);
  return resultat;
}
