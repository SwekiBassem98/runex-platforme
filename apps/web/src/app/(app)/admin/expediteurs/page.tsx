'use client';

/**
 * Administration des expéditeurs : dossiers entreprises et comptes rattachés.
 *
 * ## Statistiques
 *
 * Le nombre de colis vient de l'API et n'est recalculé que pour la page
 * affichée. `lastActivityAt` vaut `null` quand aucune activité n'a jamais eu
 * lieu : l'écran écrit « aucune activité » plutôt que d'inventer une date ou
 * d'afficher un zéro qui ressemblerait à une mesure.
 *
 * ## Comptes associés
 *
 * Un expéditeur peut avoir plusieurs comptes. Détacher un compte ne supprime
 * rien : il retire seulement l'accès de cette personne aux données de
 * l'entreprise, et l'opération est journalisée.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Pencil, Plus, RotateCcw, ShieldCheck, UserPlus, UserX } from 'lucide-react';
import {
  Badge,
  type BadgeVariant,
  Card,
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
  formatDate,
  formatDateTime,
} from '@logixpress/ui';
import {
  shippersApi,
  usersApi,
  type FiltresListe,
  type PageResultat,
  type ShipperDto,
} from '@/lib/api';

const TAILLE_PAGE = 25;

const CHAMP_SAISIE =
  'w-full px-3 py-2.5 bg-white border border-slate-300 rounded-md text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600';

function varianteEtat(isActive: boolean): BadgeVariant {
  return isActive ? 'success' : 'danger';
}

function motifOuDefaut(motif: string): string {
  const net = motif.trim();
  return net.length > 0 ? net : 'Désactivation décidée par un administrateur.';
}

interface CompteRattachable {
  id: string;
  fullName: string;
  email: string;
}

export default function AdminExpediteursPage() {
  const [resultat, setResultat] = useState<PageResultat<ShipperDto>>({
    items: [],
    total: 0,
    page: 1,
    limit: TAILLE_PAGE,
  });
  const [recherche, setRecherche] = useState('');
  const [statutFiltre, setStatutFiltre] = useState('');
  const [page, setPage] = useState(1);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enFiches, setEnFiches] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [enEdition, setEnEdition] = useState<ShipperDto | null>(null);
  const [soumission, setSoumission] = useState(false);
  const [erreurForm, setErreurForm] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<Record<string, string>>({});
  const [avecCompte, setAvecCompte] = useState(true);

  const [desactivation, setDesactivation] = useState<ShipperDto | null>(null);
  const [motifDesactivation, setMotifDesactivation] = useState('');

  const [detail, setDetail] = useState<ShipperDto | null>(null);
  const [comptesDisponibles, setComptesDisponibles] = useState<CompteRattachable[]>([]);
  const [compteARattacher, setCompteARattacher] = useState('');

  const [form, setForm] = useState({
    code: '',
    companyName: '',
    brandName: '',
    taxId: '',
    phone: '',
    phoneSecondary: '',
    email: '',
    governorate: '',
    address: '',
    isActive: true,
    compteFullName: '',
    compteEmail: '',
    comptePhone: '',
    comptePassword: '',
    compteRole: 'EXPEDITEUR_ADMIN',
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
   * soumission. Sans cela, le bandeau reste au-dessus de la zone défilante
   * pendant que l'utilisateur est encore sur les champs du bas — tout semble
   * ne rien faire.
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
        status: statutFiltre || undefined,
        page,
        limit: TAILLE_PAGE,
      };
      setResultat(await shippersApi.list(filtres));
    } catch (err) {
      setResultat({ items: [], total: 0, page: 1, limit: TAILLE_PAGE });
      setErreur(err instanceof Error ? err.message : 'Chargement impossible.');
    } finally {
      setChargement(false);
    }
  }, [recherche, statutFiltre, page]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const ouvrirCreation = () => {
    setEnEdition(null);
    setErreurForm(null);
    setErreursChamps({});
    setAvecCompte(true);
    setForm({
      code: '',
      companyName: '',
      brandName: '',
      taxId: '',
      phone: '',
      phoneSecondary: '',
      email: '',
      governorate: '',
      address: '',
      isActive: true,
      compteFullName: '',
      compteEmail: '',
      comptePhone: '',
      comptePassword: '',
      compteRole: 'EXPEDITEUR_ADMIN',
    });
    setFormulaireOuvert(true);
  };

  const ouvrirEdition = (s: ShipperDto) => {
    setEnEdition(s);
    setErreurForm(null);
    setErreursChamps({});
    setAvecCompte(false);
    setForm({
      code: s.code,
      companyName: s.companyName,
      brandName: s.brandName ?? '',
      taxId: s.taxId ?? '',
      phone: s.phone,
      phoneSecondary: s.phoneSecondary ?? '',
      email: s.email,
      governorate: s.governorate,
      address: s.address,
      isActive: s.isActive,
      compteFullName: '',
      compteEmail: '',
      comptePhone: '',
      comptePassword: '',
      compteRole: 'EXPEDITEUR_ADMIN',
    });
    setFormulaireOuvert(true);
  };

  const soumettre = async () => {
    setSoumission(true);
    setErreurForm(null);

    // Le téléphone du dossier peut être repris depuis celui du compte quand la
    // case « créer le compte » est cochée : c'est l'intention visible dans le
    // formulaire, et cela évite un refus API silencieux pour l'utilisateur.
    const telephoneDossier = form.phone.trim() || (avecCompte && !enEdition ? form.comptePhone.trim() : '');

    // Validation côté client, miroir de l'API : les erreurs sont portées par
    // champ et le bandeau est ramené en vue, jamais laissées deviner.
    const erreurs: Record<string, string> = {};
    if (!enEdition && !form.code.trim()) erreurs.code = 'Le code est obligatoire.';
    if (!form.companyName.trim()) erreurs.companyName = 'La raison sociale est obligatoire.';
    if (!telephoneDossier) {
      erreurs.phone = avecCompte
        ? 'Renseignez le téléphone du dossier, ou celui du compte.'
        : 'Le téléphone est obligatoire.';
    }
    if (!form.email.trim()) erreurs.email = 'L’adresse e-mail du dossier est obligatoire.';
    if (!form.governorate.trim()) erreurs.governorate = 'Le gouvernorat est obligatoire.';
    if (!form.address.trim()) erreurs.address = 'L’adresse est obligatoire.';
    if (!enEdition && avecCompte) {
      if (!form.compteFullName.trim()) erreurs.compteFullName = 'Le nom du contact est obligatoire.';
      if (!form.compteEmail.trim()) erreurs.compteEmail = 'L’e-mail du compte est obligatoire.';
      if (form.comptePassword.length < 8) erreurs.comptePassword = '8 caractères minimum.';
    }
    if (Object.keys(erreurs).length > 0) {
      setErreursChamps(erreurs);
      setErreurForm('Le dossier n’a pas pu être enregistré : corrigez les champs signalés.');
      setSoumission(false);
      remonterHautModale();
      return;
    }
    setErreursChamps({});

    try {
      if (enEdition) {
        await shippersApi.update(enEdition.id, {
          companyName: form.companyName,
          brandName: form.brandName || null,
          taxId: form.taxId || null,
          phone: telephoneDossier,
          phoneSecondary: form.phoneSecondary || null,
          email: form.email,
          governorate: form.governorate,
          address: form.address,
        });
        setMessage(`Expéditeur « ${form.companyName} » mis à jour.`);
      } else {
        const corps: Record<string, unknown> = {
          code: form.code,
          companyName: form.companyName,
          brandName: form.brandName || null,
          taxId: form.taxId || null,
          phone: telephoneDossier,
          phoneSecondary: form.phoneSecondary || null,
          email: form.email,
          governorate: form.governorate,
          address: form.address,
          isActive: form.isActive,
        };
        if (avecCompte) {
          corps.compte = {
            fullName: form.compteFullName,
            email: form.compteEmail,
            phone: form.comptePhone.trim() || telephoneDossier,
            password: form.comptePassword,
            role: form.compteRole,
          };
        }
        await shippersApi.create(corps);
        setMessage(`Expéditeur « ${form.companyName} » créé.`);
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

  const basculerStatut = async (s: ShipperDto) => {
    if (s.isActive) {
      setMotifDesactivation('');
      setDesactivation(s);
      return;
    }
    try {
      await shippersApi.setStatus(s.id, true, 'Réactivation depuis l’administration.');
      setMessage(`Expéditeur « ${s.companyName} » réactivé.`);
      await charger();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Réactivation impossible.');
    }
  };

  const confirmerDesactivation = async () => {
    if (!desactivation) return;
    try {
      await shippersApi.setStatus(desactivation.id, false, motifOuDefaut(motifDesactivation));
      setMessage(`Expéditeur « ${desactivation.companyName} » désactivé.`);
      setDesactivation(null);
      await charger();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Désactivation impossible.');
    }
  };

  /** Charge le détail — comptes associés et activité — à la demande. */
  const ouvrirDetail = async (s: ShipperDto) => {
    setDetail(s);
    setCompteARattacher('');
    try {
      const [complet, disponibles] = await Promise.all([
        shippersApi.get(s.id),
        usersApi.list({ status: 'actif', limit: 100 }),
      ]);
      setDetail(complet);
      // Un compte déjà rattaché à cet expéditeur, ou rattaché à un autre, n'est
      // pas proposable : le proposer ferait échouer l'appel au moment du clic.
      const dejaPris = new Set((complet.users ?? []).map((u) => u.id));
      setComptesDisponibles(
        disponibles.items
          .filter((u) => !dejaPris.has(u.id) && !u.shipper)
          .map((u) => ({ id: u.id, fullName: u.fullName, email: u.email }))
      );
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Détail indisponible.');
    }
  };

  const rattacher = async () => {
    if (!detail || !compteARattacher) return;
    try {
      const maj = await shippersApi.rattacherCompte(detail.id, compteARattacher);
      setDetail(maj);
      setCompteARattacher('');
      setMessage('Compte rattaché.');
      await charger();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Rattachement impossible.');
    }
  };

  const detacher = async (userId: string) => {
    if (!detail) return;
    try {
      const maj = await shippersApi.detacherCompte(detail.id, userId);
      setDetail(maj);
      setMessage('Compte détaché.');
      await charger();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Détachement impossible.');
    }
  };

  const totalPages = Math.max(1, Math.ceil(resultat.total / TAILLE_PAGE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expéditeurs"
        description="Dossiers entreprises, comptes rattachés et activité colis."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Expéditeurs', active: true }]}
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
              <span>Nouvel expéditeur</span>
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
                placeholder="Raison sociale, code, téléphone…"
                libelle="Rechercher un expéditeur"
              />
            </div>
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
            title="Les expéditeurs n'ont pas pu être chargés"
            message={erreur}
            onRetry={() => void charger()}
          />
        ) : chargement ? (
          <SkeletonTable rows={6} cols={6} />
        ) : resultat.items.length === 0 ? (
          <EmptyState
            title="Aucun expéditeur ne correspond"
            description="Modifiez la recherche ou les filtres, ou créez un nouveau dossier."
          />
        ) : enFiches ? (
          <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
            {resultat.items.map((s) => (
              <FicheLigne
                key={s.id}
                titre={s.companyName}
                sousTitre={s.email}
                identifiant={`${s.code} · ${s.phone}`}
                champs={[
                  { libelle: 'Gouvernorat', valeur: s.governorate },
                  {
                    libelle: 'Colis',
                    valeur: typeof s.packagesCount === 'number' ? String(s.packagesCount) : '—',
                    numerique: true,
                  },
                  {
                    libelle: 'État',
                    valeur: <Badge variant={varianteEtat(s.isActive)}>{s.isActive ? 'Actif' : 'Inactif'}</Badge>,
                  },
                  {
                    libelle: 'Dernière activité',
                    valeur: s.lastActivityAt ? formatDate(s.lastActivityAt) : 'Aucune activité',
                  },
                ]}
                action={
                  <button
                    type="button"
                    onClick={() => void ouvrirDetail(s)}
                    className="px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                  >
                    Ouvrir
                  </button>
                }
              />
            ))}
          </div>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Expéditeur</Th>
                <Th>Contact</Th>
                <Th>Colis</Th>
                <Th>Dernière activité</Th>
                <Th>État</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {resultat.items.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <div className="font-medium text-slate-900">{s.companyName}</div>
                    <div className="text-xs font-mono text-slate-500">{s.code}</div>
                    {s.brandName ? <div className="text-xs text-slate-400">{s.brandName}</div> : null}
                  </Td>
                  <Td>
                    <div className="text-sm text-slate-700">{s.phone}</div>
                    <div className="text-xs text-slate-500">{s.email}</div>
                    <div className="text-xs text-slate-400">{s.governorate}</div>
                  </Td>
                  <Td>
                    <span className="text-sm font-medium text-slate-900">
                      {typeof s.packagesCount === 'number' ? s.packagesCount : '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-sm text-slate-600">
                      {s.lastActivityAt ? formatDate(s.lastActivityAt) : 'Aucune activité'}
                    </span>
                  </Td>
                  <Td>
                    <Badge variant={varianteEtat(s.isActive)}>{s.isActive ? 'Actif' : 'Inactif'}</Badge>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void ouvrirDetail(s)}
                        aria-label={`Ouvrir le dossier de ${s.companyName}`}
                        className="px-2 py-1 text-xs font-medium border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                      >
                        Ouvrir
                      </button>
                      <button
                        type="button"
                        onClick={() => ouvrirEdition(s)}
                        aria-label={`Modifier ${s.companyName}`}
                        className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void basculerStatut(s)}
                        className="px-2 py-1 text-xs font-medium border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                      >
                        {s.isActive ? 'Désactiver' : 'Activer'}
                      </button>
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
            libelle="expéditeurs"
          />
        ) : null}
      </div>

      {/* ---------------- Formulaire création / édition ---------------- */}
      <Modal
        isOpen={formulaireOuvert}
        onClose={() => setFormulaireOuvert(false)}
        title={enEdition ? `Modifier ${enEdition.companyName}` : 'Nouvel expéditeur'}
        subtitle={
          enEdition
            ? 'Le code n’est pas modifiable : il identifie le dossier dans tout le système.'
            : 'Vous pouvez créer le compte administrateur en même temps que le dossier.'
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
              {soumission ? 'Enregistrement…' : enEdition ? 'Enregistrer' : 'Créer le dossier'}
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
            <FormField label="Code" required helpText="Identifiant court et unique du dossier." error={erreursChamps.code}>
              <input
                value={form.code}
                onChange={(e) => majForm({ code: e.target.value.toUpperCase() })}
                disabled={enEdition !== null}
                className={`${CHAMP_SAISIE} disabled:bg-slate-100 disabled:text-slate-500 font-mono`}
                autoComplete="off"
              />
            </FormField>
            <FormField label="Raison sociale" required error={erreursChamps.companyName}>
              <input
                value={form.companyName}
                onChange={(e) => majForm({ companyName: e.target.value })}
                className={CHAMP_SAISIE}
                autoComplete="off"
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nom commercial">
              <input
                value={form.brandName}
                onChange={(e) => setForm({ ...form, brandName: e.target.value })}
                className={CHAMP_SAISIE}
                autoComplete="off"
              />
            </FormField>
            <FormField label="Matricule fiscal">
              <input
                value={form.taxId}
                onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                className={CHAMP_SAISIE}
                autoComplete="off"
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Téléphone"
              required
              error={erreursChamps.phone}
              helpText={avecCompte && !enEdition ? 'Peut être repris du téléphone du compte si laissé vide.' : undefined}
            >
              <input
                value={form.phone}
                onChange={(e) => majForm({ phone: e.target.value })}
                className={CHAMP_SAISIE}
                autoComplete="off"
              />
            </FormField>
            <FormField label="Téléphone secondaire">
              <input
                value={form.phoneSecondary}
                onChange={(e) => majForm({ phoneSecondary: e.target.value })}
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

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Gouvernorat" required error={erreursChamps.governorate}>
              <input
                value={form.governorate}
                onChange={(e) => majForm({ governorate: e.target.value })}
                className={CHAMP_SAISIE}
                autoComplete="off"
              />
            </FormField>
            <FormField label="Adresse" required error={erreursChamps.address}>
              <input
                value={form.address}
                onChange={(e) => majForm({ address: e.target.value })}
                className={CHAMP_SAISIE}
                autoComplete="off"
              />
            </FormField>
          </div>

          {!enEdition ? (
            <>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={avecCompte}
                  onChange={(e) => setAvecCompte(e.target.checked)}
                />
                Créer aussi le compte administrateur de l’expéditeur
              </label>

              {avecCompte ? (
                <div className="space-y-4 border-t border-slate-200 pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Nom du contact" required error={erreursChamps.compteFullName}>
                      <input
                        value={form.compteFullName}
                        onChange={(e) => majForm({ compteFullName: e.target.value })}
                        className={CHAMP_SAISIE}
                        autoComplete="off"
                      />
                    </FormField>
                    <FormField label="Rôle du compte" required>
                      <select
                        value={form.compteRole}
                        onChange={(e) => majForm({ compteRole: e.target.value })}
                        className={CHAMP_SAISIE}
                      >
                        <option value="EXPEDITEUR_ADMIN">Expéditeur — administrateur</option>
                        <option value="EXPEDITEUR_USER">Expéditeur — utilisateur</option>
                      </select>
                    </FormField>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="E-mail du compte" required error={erreursChamps.compteEmail}>
                      <input
                        type="email"
                        value={form.compteEmail}
                        onChange={(e) => majForm({ compteEmail: e.target.value })}
                        className={CHAMP_SAISIE}
                        autoComplete="off"
                      />
                    </FormField>
                    <FormField label="Téléphone du compte">
                      <input
                        value={form.comptePhone}
                        onChange={(e) => majForm({ comptePhone: e.target.value })}
                        className={CHAMP_SAISIE}
                        autoComplete="off"
                      />
                    </FormField>
                  </div>
                  <FormField
                    label="Mot de passe"
                    required
                    error={erreursChamps.comptePassword}
                    helpText="8 caractères minimum. Il sera communiqué au client hors de l’application."
                  >
                    <input
                      type="password"
                      value={form.comptePassword}
                      onChange={(e) => majForm({ comptePassword: e.target.value })}
                      className={CHAMP_SAISIE}
                      autoComplete="new-password"
                    />
                  </FormField>
                </div>
              ) : null}

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                Dossier actif dès la création
              </label>
            </>
          ) : null}
        </div>
      </Modal>

      {/* ---------------- Désactivation avec motif ---------------- */}
      <Modal
        isOpen={desactivation !== null}
        onClose={() => setDesactivation(null)}
        title="Désactiver cet expéditeur ?"
        subtitle={`Les comptes rattachés à ${desactivation?.companyName ?? ''} perdront l’accès au portail. Les colis et les traces d’audit sont conservés.`}
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
            placeholder="Ex. : contrat résilié, impayé, demande du client…"
          />
        </FormField>
      </Modal>

      {/* ---------------- Détail : comptes associés et activité ---------------- */}
      <Modal
        isOpen={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.companyName ?? ''}
        subtitle={detail ? `${detail.code} · ${detail.governorate}` : undefined}
        size="lg"
      >
        {detail ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card className="p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Colis</div>
                <div className="text-xl font-semibold text-slate-900">
                  {typeof detail.packagesCount === 'number' ? detail.packagesCount : '—'}
                </div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Comptes</div>
                <div className="text-xl font-semibold text-slate-900">{(detail.users ?? []).length}</div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dernière activité</div>
                <div className="text-sm font-medium text-slate-900 pt-1">
                  {detail.lastActivityAt ? formatDateTime(detail.lastActivityAt) : 'Aucune activité'}
                </div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">État</div>
                <div className="pt-1">
                  <Badge variant={varianteEtat(detail.isActive)}>
                    {detail.isActive ? 'Actif' : 'Inactif'}
                  </Badge>
                </div>
              </Card>
            </div>

            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 mb-2">
                <Building2 className="w-4 h-4 text-slate-400" aria-hidden="true" />
                Comptes rattachés
              </h3>
              {(detail.users ?? []).length === 0 ? (
                <p className="text-sm text-slate-500">Aucun compte n’a accès à ce dossier.</p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                  {(detail.users ?? []).map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900">{u.fullName}</div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {u.role ? <Badge variant="secondary">{u.role}</Badge> : null}
                        <Badge variant={varianteEtat(u.isActive)}>{u.isActive ? 'Actif' : 'Inactif'}</Badge>
                        <button
                          type="button"
                          onClick={() => void detacher(u.id)}
                          aria-label={`Détacher le compte de ${u.fullName}`}
                          className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer"
                        >
                          <UserX className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-col gap-2 pt-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <FormField label="Rattacher un compte existant">
                    <select
                      value={compteARattacher}
                      onChange={(e) => setCompteARattacher(e.target.value)}
                      className={CHAMP_SAISIE}
                    >
                      <option value="">— Choisir un compte —</option>
                      {comptesDisponibles.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.fullName} ({c.email})
                        </option>
                      ))}
                    </select>
                  </FormField>
                </div>
                <button
                  type="button"
                  onClick={() => void rattacher()}
                  disabled={!compteARattacher}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium disabled:opacity-60 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" aria-hidden="true" />
                  <span>Rattacher</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
