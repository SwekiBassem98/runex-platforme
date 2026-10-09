'use client';

/**
 * Administration des comptes utilisateurs.
 *
 * ## Ce que cet écran ne fait pas
 *
 * Il ne crée pas de seconde barre latérale : la page est rendue à l'intérieur du
 * gabarit `(app)`, qui fournit déjà `AppShell`. Ajouter une coquille ici
 * produirait deux navigations imbriquées.
 *
 * Il n'affiche jamais de mot de passe. Le champ `passwordHash` n'existe pas dans
 * le DTO renvoyé par l'API : il n'y a donc rien à masquer côté écran, et c'est
 * volontaire — la protection vient du serveur, pas du rendu.
 *
 * ## Autorisation
 *
 * L'entrée de menu est masquée selon `USER_READ`, mais ce n'est qu'un confort :
 * l'API répond 403 à tout appel sans `USER_READ`/`USER_CREATE`/`USER_UPDATE`.
 * Un lien caché n'est pas une porte fermée.
 */

import { BoutonSupprimer, SuppressionDefinitive, usePeutSupprimer } from '@/components/admin/SuppressionDefinitive';
import { useFeedbackOn } from '@/lib/useFeedbackOn';
import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RotateCcw, ShieldCheck } from 'lucide-react';
import {
  Badge,
  type BadgeVariant,
  ErrorState,
  EmptyState,
  FicheLigne,
  BasculeFiches,
  FormField,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  SkeletonTable,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  formatDateTime,
} from '@logixpress/ui';
import {
  usersApi,
  type FiltresListe,
  type PageResultat,
  type ReferentielsAdmin,
  type RoleAttribuable,
  type UserDto,
} from '@/lib/api';

const TAILLE_PAGE = 25;

/**
 * Classes de champ de saisie, alignées sur celles du portail expéditeur.
 *
 * Les marges internes utilisent les propriétés logiques (`px` est symétrique,
 * donc neutre) : l'écran reste correct en arabe, où la direction s'inverse.
 */
const CHAMP_SAISIE =
  'w-full px-3 py-2.5 bg-white border border-slate-300 rounded-md text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600';

/**
 * Libellé français des rôles.
 *
 * L'API renvoie le code d'énumération ; le présenter tel quel dans une colonne
 * lue par un exploitant serait du jargon de base de données. La traduction se
 * fait ici, à la présentation — jamais dans le schéma.
 *
 * `EXPEDITEUR_ADMIN` et `EXPEDITEUR_USER` restent deux entrées distinctes : ce
 * sont deux niveaux de droit réels chez l'expéditeur, pas deux noms pour la
 * même chose.
 */
const LIBELLE_ROLE: Record<RoleAttribuable, string> = {
  SUPER_ADMIN: 'Super administrateur',
  ADMIN_GENERAL: 'Administrateur général',
  DISPATCHER: 'Dispatcheur',
  MAGASINIER: 'Magasinier',
  CAISSIER: 'Caissier',
  EXPEDITEUR_ADMIN: 'Expéditeur — administrateur',
  EXPEDITEUR_USER: 'Expéditeur — utilisateur',
  LIVREUR: 'Livreur',
};

/** Rôles qui exigent un rattachement à un expéditeur. */
const ROLES_EXPEDITEUR: RoleAttribuable[] = ['EXPEDITEUR_ADMIN', 'EXPEDITEUR_USER'];

function libelleRole(code: string): string {
  return LIBELLE_ROLE[code as RoleAttribuable] ?? code;
}

function varianteEtat(isActive: boolean): BadgeVariant {
  return isActive ? 'success' : 'danger';
}

/** Le motif est obligatoire ; on ne laisse jamais passer une chaîne vide. */
function motifOuDefaut(motif: string): string {
  const net = motif.trim();
  return net.length > 0 ? net : 'Désactivation décidée par un administrateur.';
}

export default function AdminUtilisateursPage() {
  const [resultat, setResultat] = useState<PageResultat<UserDto>>({
    items: [],
    total: 0,
    page: 1,
    limit: TAILLE_PAGE,
  });
  const [referentiels, setReferentiels] = useState<ReferentielsAdmin | null>(null);
  const [recherche, setRecherche] = useState('');
  const [roleFiltre, setRoleFiltre] = useState('');
  const [statutFiltre, setStatutFiltre] = useState('');
  const [page, setPage] = useState(1);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enFiches, setEnFiches] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const peutSupprimer = usePeutSupprimer();
  const [aSupprimer, setASupprimer] = useState<UserDto | null>(null);

  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [enEdition, setEnEdition] = useState<UserDto | null>(null);
  const [soumission, setSoumission] = useState(false);
  const [erreurForm, setErreurForm] = useState<string | null>(null);
  // Retour sonore des actions de l'écran (succès, refus).
  useFeedbackOn(message, 'success');
  useFeedbackOn(erreurForm, 'error');
  useFeedbackOn(erreur, 'error');
  const [erreursChamps, setErreursChamps] = useState<Record<string, string>>({});
  const [desactivation, setDesactivation] = useState<UserDto | null>(null);
  const [motifDesactivation, setMotifDesactivation] = useState('');

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: 'DISPATCHER' as RoleAttribuable,
    shipperId: '',
    depositId: '',
    isActive: true,
  });

  /** Met à jour un champ et efface l'erreur de validation qui lui était attachée. */
  const majForm = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErreursChamps((prev) => {
      const cles = Object.keys(patch).filter((c) => c in prev);
      if (cles.length === 0) return prev;
      const copie = { ...prev };
      for (const cle of cles) delete copie[cle];
      return copie;
    });
  };

  /**
   * Ramène le haut de la fenêtre en vue quand une erreur survient à la
   * soumission : sans cela, le bandeau reste au-dessus de la zone défilante
   * et l'utilisateur, resté sur les champs du bas, croit que rien ne se passe.
   */
  const remonterHautModale = () => {
    requestAnimationFrame(() => {
      document.querySelector('[role="dialog"] .overflow-y-auto')?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const filtres: FiltresListe = {
        search: recherche || undefined,
        role: roleFiltre || undefined,
        status: statutFiltre || undefined,
        page,
        limit: TAILLE_PAGE,
      };
      setResultat(await usersApi.list(filtres));
    } catch (err) {
      // Les lignes précédentes sont effacées : sinon un échec laisserait à
      // l'écran des comptes d'un autre instant sous un simple bandeau d'erreur.
      setResultat({ items: [], total: 0, page: 1, limit: TAILLE_PAGE });
      setErreur(err instanceof Error ? err.message : 'Chargement impossible.');
    } finally {
      setChargement(false);
    }
  }, [recherche, roleFiltre, statutFiltre, page]);

  useEffect(() => {
    void charger();
  }, [charger]);

  useEffect(() => {
    usersApi
      .referentiels()
      .then(setReferentiels)
      .catch(() => setReferentiels(null));
  }, []);

  const roleExigeExpediteur = ROLES_EXPEDITEUR.includes(form.role);

  const ouvrirCreation = () => {
    setEnEdition(null);
    setErreurForm(null);
    setErreursChamps({});
    setForm({
      fullName: '',
      email: '',
      phone: '',
      password: '',
      role: 'DISPATCHER',
      shipperId: '',
      depositId: '',
      isActive: true,
    });
    setFormulaireOuvert(true);
  };

  const ouvrirEdition = (u: UserDto) => {
    setEnEdition(u);
    setErreurForm(null);
    setErreursChamps({});
    setForm({
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      password: '',
      role: u.roles[0] ?? 'DISPATCHER',
      shipperId: u.shipper?.id ?? '',
      depositId: u.depositId ?? '',
      isActive: u.isActive,
    });
    setFormulaireOuvert(true);
  };

  const soumettre = async () => {
    setSoumission(true);
    setErreurForm(null);

    // Validation côté client, miroir de l'API, portée par champ et ramenée en
    // vue : un refus serveur ne doit jamais passer inaperçu.
    const erreurs: Record<string, string> = {};
    if (!form.fullName.trim()) erreurs.fullName = 'Le nom complet est obligatoire.';
    if (!form.phone.trim()) erreurs.phone = 'Le téléphone est obligatoire.';
    if (!form.email.trim()) erreurs.email = 'L’adresse e-mail est obligatoire.';
    if (form.password && form.password.length < 8) erreurs.password = '8 caractères minimum.';
    if (!enEdition && !form.password) erreurs.password = 'Un mot de passe est obligatoire à la création.';
    if (roleExigeExpediteur && !form.shipperId) {
      erreurs.shipperId = 'Un compte expéditeur doit être rattaché à un expéditeur.';
    }
    if (Object.keys(erreurs).length > 0) {
      setErreursChamps(erreurs);
      setErreurForm('Le compte n’a pas pu être enregistré : corrigez les champs signalés.');
      setSoumission(false);
      remonterHautModale();
      return;
    }
    setErreursChamps({});

    try {
      if (enEdition) {
        const corps: Record<string, unknown> = {
          fullName: form.fullName,
          email: form.email,
          phone: form.phone,
          role: form.role,
          shipperId: roleExigeExpediteur ? form.shipperId : null,
          depositId: form.depositId || null,
        };
        // Un mot de passe vide en édition signifie « inchangé » : on n'envoie
        // pas le champ du tout, plutôt qu'une chaîne vide qui serait refusée.
        if (form.password) corps.password = form.password;
        await usersApi.update(enEdition.id, corps);
        setMessage(`Compte « ${form.fullName} » mis à jour.`);
      } else {
        if (!form.password) throw new Error('Un mot de passe est obligatoire à la création.');
        await usersApi.create({
          fullName: form.fullName,
          email: form.email,
          phone: form.phone,
          password: form.password,
          role: form.role,
          shipperId: roleExigeExpediteur ? form.shipperId : null,
          depositId: form.depositId || null,
          isActive: form.isActive,
        });
        setMessage(`Compte « ${form.fullName} » créé.`);
      }
      setFormulaireOuvert(false);
      await charger();
    } catch (err) {
      setErreurForm(err instanceof Error ? err.message : 'Enregistrement impossible.');
      remonterHautModale();
    } finally {
      setSoumission(false);
    }
  };

  const basculerStatut = async (u: UserDto) => {
    if (u.isActive) {
      setMotifDesactivation('');
      setDesactivation(u);
      return;
    }
    try {
      await usersApi.setStatus(u.id, true, 'Réactivation depuis l’administration.');
      setMessage(`Compte « ${u.fullName} » réactivé.`);
      await charger();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Réactivation impossible.');
    }
  };

  const confirmerDesactivation = async () => {
    if (!desactivation) return;
    try {
      await usersApi.setStatus(desactivation.id, false, motifOuDefaut(motifDesactivation));
      setMessage(`Compte « ${desactivation.fullName} » désactivé.`);
      setDesactivation(null);
      await charger();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Désactivation impossible.');
    }
  };

  const reinitialiserMotDePasse = async (u: UserDto) => {
    const nouveau = window.prompt(
      `Nouveau mot de passe pour ${u.fullName} (8 caractères minimum).\n\n` +
        'Il sera communiqué à l’utilisateur hors de l’application ; ' +
        'l’ancien cesse de fonctionner immédiatement.'
    );
    if (!nouveau) return;
    try {
      await usersApi.update(u.id, {
        password: nouveau,
        reason: 'Réinitialisation par un administrateur.',
      });
      setMessage(`Mot de passe de « ${u.fullName} » réinitialisé.`);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Réinitialisation impossible.');
    }
  };

  const totalPages = Math.max(1, Math.ceil(resultat.total / TAILLE_PAGE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comptes utilisateurs"
        description="Création, rôles et accès des comptes internes et des comptes expéditeur."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Utilisateurs', active: true }]}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void charger()}
              disabled={chargement}
              aria-busy={chargement}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-md text-xs font-medium transition cursor-pointer"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${chargement ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{chargement ? 'Actualisation…' : 'Actualiser'}</span>
            </button>
            <button
              type="button"
              onClick={ouvrirCreation}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-medium transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Nouveau compte</span>
            </button>
          </div>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        {message ? (
          <div
            role="status"
            className="flex items-start gap-2 p-3 border border-green-200 bg-green-50 text-green-800 rounded-md text-sm"
          >
            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{message}</span>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="sm:max-w-xs sm:flex-1">
              <SearchInput
                value={recherche}
                onChange={(v) => {
                  setPage(1);
                  setRecherche(v);
                }}
                placeholder="Nom, e-mail ou téléphone…"
                libelle="Rechercher un compte utilisateur"
              />
            </div>
            <select
              value={roleFiltre}
              onChange={(e) => {
                setPage(1);
                setRoleFiltre(e.target.value);
              }}
              aria-label="Filtrer par rôle"
              className="px-3 py-2 bg-white border border-slate-200 rounded-md text-sm text-slate-700"
            >
              <option value="">Tous les rôles</option>
              {Object.entries(LIBELLE_ROLE).map(([code, libelle]) => (
                <option key={code} value={code}>
                  {libelle}
                </option>
              ))}
            </select>
            <select
              value={statutFiltre}
              onChange={(e) => {
                setPage(1);
                setStatutFiltre(e.target.value);
              }}
              aria-label="Filtrer par état"
              className="px-3 py-2 bg-white border border-slate-200 rounded-md text-sm text-slate-700"
            >
              <option value="">Actifs et inactifs</option>
              <option value="actif">Actifs uniquement</option>
              <option value="inactif">Inactifs uniquement</option>
            </select>
          </div>
          <BasculeFiches enFiches={enFiches} onChange={setEnFiches} />
        </div>

        {erreur ? (
          <ErrorState
            title="Les comptes n'ont pas pu être chargés"
            message={erreur}
            onRetry={() => void charger()}
          />
        ) : chargement ? (
          <>
            <SkeletonTable rows={6} cols={6} />
            <span role="status" className="sr-only">
              Chargement des comptes…
            </span>
          </>
        ) : resultat.items.length === 0 ? (
          <EmptyState
            title="Aucun compte ne correspond"
            description="Modifiez la recherche ou les filtres, ou créez un nouveau compte."
          />
        ) : enFiches ? (
          <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
            {resultat.items.map((u) => (
              <FicheLigne
                key={u.id}
                titre={u.fullName}
                sousTitre={u.email}
                identifiant={u.phone}
                champs={[
                  { libelle: 'Rôle', valeur: u.roles.map(libelleRole).join(', ') },
                  { libelle: 'Rattachement', valeur: u.shipper?.companyName ?? u.depositName ?? '—' },
                  {
                    libelle: 'État',
                    valeur: <Badge variant={varianteEtat(u.isActive)}>{u.isActive ? 'Actif' : 'Inactif'}</Badge>,
                  },
                  {
                    libelle: 'Dernière connexion',
                    valeur: u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Jamais connecté',
                  },
                ]}
                action={
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => ouvrirEdition(u)}
                      className="px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                    >
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => void basculerStatut(u)}
                      className="px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                    >
                      {u.isActive ? 'Désactiver' : 'Activer'}
                    </button>
                    {peutSupprimer && <BoutonSupprimer nom={u.fullName} onClick={() => setASupprimer(u)} compact={false} />}
                  </div>
                }
              />
            ))}
          </div>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Compte</Th>
                <Th>Rôle</Th>
                <Th>Rattachement</Th>
                <Th>État</Th>
                <Th>Dernière connexion</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {resultat.items.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    <div className="font-medium text-slate-900">{u.fullName}</div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                    <div className="text-xs text-slate-400">{u.phone}</div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <Badge key={r} variant="secondary">
                          {libelleRole(r)}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <div className="text-sm text-slate-700">{u.shipper?.companyName ?? u.depositName ?? '—'}</div>
                    {u.driver ? <div className="text-xs text-slate-500">{u.driver.driverCode}</div> : null}
                  </Td>
                  <Td>
                    <Badge variant={varianteEtat(u.isActive)}>{u.isActive ? 'Actif' : 'Inactif'}</Badge>
                  </Td>
                  <Td>
                    <span className="text-sm text-slate-600">
                      {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Jamais connecté'}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => ouvrirEdition(u)}
                        aria-label={`Modifier le compte de ${u.fullName}`}
                        className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void reinitialiserMotDePasse(u)}
                        aria-label={`Réinitialiser le mot de passe de ${u.fullName}`}
                        className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void basculerStatut(u)}
                        className="px-2 py-1 text-xs font-medium border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                      >
                        {u.isActive ? 'Désactiver' : 'Activer'}
                      </button>
                      {peutSupprimer && <BoutonSupprimer nom={u.fullName} onClick={() => setASupprimer(u)} />}
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}

        {!chargement && !erreur && resultat.total > 0 ? (
          <Pagination
            currentPage={resultat.page}
            totalPages={totalPages}
            totalItems={resultat.total}
            pageSize={TAILLE_PAGE}
            onPageChange={setPage}
            libelle="comptes"
          />
        ) : null}
      </div>

      <Modal
        isOpen={formulaireOuvert}
        onClose={() => setFormulaireOuvert(false)}
        title={enEdition ? `Modifier ${enEdition.fullName}` : 'Nouveau compte'}
        subtitle={
          enEdition
            ? 'Le rôle et le rattachement sont journalisés avec l’auteur du changement.'
            : 'Le mot de passe doit comporter au moins 8 caractères.'
        }
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setFormulaireOuvert(false)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void soumettre()}
              disabled={soumission}
              className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-md disabled:opacity-60 cursor-pointer"
            >
              {soumission ? 'Enregistrement…' : enEdition ? 'Enregistrer' : 'Créer le compte'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {erreurForm ? (
            <div role="alert" className="p-3 border border-red-200 bg-red-50 text-red-800 rounded-md text-sm">
              {erreurForm}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nom complet" required error={erreursChamps.fullName}>
              <input
                value={form.fullName}
                onChange={(e) => majForm({ fullName: e.target.value })}
                className={CHAMP_SAISIE}
                autoComplete="off"
              />
            </FormField>
            <FormField label="Téléphone" required error={erreursChamps.phone}>
              <input
                value={form.phone}
                onChange={(e) => majForm({ phone: e.target.value })}
                className={CHAMP_SAISIE}
                autoComplete="off"
              />
            </FormField>
          </div>

          <FormField label="Adresse e-mail" required error={erreursChamps.email}>
            <input
              type="email"
              value={form.email}
              onChange={(e) => majForm({ email: e.target.value })}
              className={CHAMP_SAISIE}
              autoComplete="off"
            />
          </FormField>

          <FormField
            label={enEdition ? 'Nouveau mot de passe' : 'Mot de passe'}
            required={!enEdition}
            error={erreursChamps.password}
            helpText={
              enEdition
                ? 'Laisser vide pour conserver le mot de passe actuel.'
                : '8 caractères minimum. Il sera communiqué à l’utilisateur hors de l’application.'
            }
          >
            <input
              type="password"
              value={form.password}
              onChange={(e) => majForm({ password: e.target.value })}
              className={CHAMP_SAISIE}
              autoComplete="new-password"
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Rôle" required>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as RoleAttribuable })}
                className={CHAMP_SAISIE}
              >
                {referentiels?.roles.length
                  ? referentiels.roles.map((r) => (
                      <option key={r.name} value={r.name}>
                        {r.displayName}
                      </option>
                    ))
                  : Object.entries(LIBELLE_ROLE).map(([code, libelle]) => (
                      <option key={code} value={code}>
                        {libelle}
                      </option>
                    ))}
              </select>
            </FormField>

            <FormField label="Dépôt">
              <select
                value={form.depositId}
                onChange={(e) => setForm({ ...form, depositId: e.target.value })}
                className={CHAMP_SAISIE}
              >
                <option value="">Aucun</option>
                {referentiels?.depots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          {roleExigeExpediteur ? (
            <FormField
              label="Expéditeur"
              required
              error={erreursChamps.shipperId}
              helpText="Obligatoire pour un compte expéditeur : c'est ce lien qui borne les données visibles."
            >
              <select
                value={form.shipperId}
                onChange={(e) => majForm({ shipperId: e.target.value })}
                className={CHAMP_SAISIE}
              >
                <option value="">— Choisir un expéditeur —</option>
                {referentiels?.expediteurs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.companyName} ({s.code})
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}

          {!enEdition ? (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Compte actif dès la création
            </label>
          ) : null}
        </div>
      </Modal>

      {/*
        Une seule boîte de dialogue pour la désactivation, et elle porte le
        motif : une trace d'audit sans raison ne permettrait pas de répondre,
        six mois plus tard, à la question « qui a coupé cet accès, et
        pourquoi ? ». Le bouton de confirmation reste désactivé tant que le
        motif est vide.
      */}
      <Modal
        isOpen={desactivation !== null}
        onClose={() => setDesactivation(null)}
        title="Désactiver ce compte ?"
        subtitle={`Le compte de ${desactivation?.fullName ?? ''} ne pourra plus se connecter. Ses colis et ses traces d’audit sont conservés.`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDesactivation(null)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void confirmerDesactivation()}
              disabled={!motifDesactivation.trim()}
              className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-md disabled:opacity-60 cursor-pointer"
            >
              Confirmer la désactivation
            </button>
          </div>
        }
      >
        <FormField label="Motif de la désactivation" required>
          <textarea
            value={motifDesactivation}
            onChange={(e) => setMotifDesactivation(e.target.value)}
            rows={3}
            className={CHAMP_SAISIE}
            placeholder="Ex. : départ de l’entreprise, changement de poste…"
          />
        </FormField>
      </Modal>
      {aSupprimer && (
        <SuppressionDefinitive
          ressource="users"
          id={aSupprimer.id}
          onClose={() => setASupprimer(null)}
          onSupprime={(texte) => {
            setASupprimer(null);
            setMessage(texte);
            void charger();
          }}
          onDesactiver={
            aSupprimer.isActive
              ? () => {
                  const cible = aSupprimer;
                  setASupprimer(null);
                  void basculerStatut(cible);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
