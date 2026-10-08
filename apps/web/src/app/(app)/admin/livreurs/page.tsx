'use client';

/**
 * Administration des livreurs : fiches chauffeur et compte associé.
 *
 * ## Un livreur, un compte
 *
 * La contrainte d'unicité sur `Driver.userId` est portée par la base : un compte
 * ne peut pas avoir deux fiches. L'écran ne propose donc au rattachement que des
 * comptes encore libres, et l'API répond 409 si l'on tente malgré tout — pas 500.
 *
 * ## Affectation en cours
 *
 * La tournée affichée est la plus récente parmi celles qui ne sont ni clôturées
 * ni annulées. Quand il n'y en a aucune, l'écran dit « aucune tournée ouverte »
 * au lieu d'afficher une ligne vide qui laisserait croire à une donnée manquante.
 */

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
  formatDate,
  formatTND,
} from '@logixpress/ui';
import { driversApi, type DriverDto, type FiltresListe, type PageResultat } from '@/lib/api';

const TAILLE_PAGE = 25;

const CHAMP_SAISIE =
  'w-full px-3 py-2.5 bg-white border border-slate-300 rounded-md text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600';

/** Libellé des états de tournée : le code d'énumération ne se montre pas tel quel. */
const LIBELLE_TOURNEE: Record<string, string> = {
  BROUILLON: 'Brouillon',
  EN_ATTENTE: 'En attente',
  VALIDEE_DEPART: 'Départ validé',
  EN_COURS: 'En cours',
  RETOUR_DEPOT: 'Retour au dépôt',
  CLOTUREE_CONFORME: 'Clôturée conforme',
  CLOTUREE_DEFICIT: 'Clôturée en déficit',
  ANNULEE: 'Annulée',
};

function varianteEtat(isActive: boolean): BadgeVariant {
  return isActive ? 'success' : 'danger';
}

function variantePresence(isOnline: boolean): BadgeVariant {
  return isOnline ? 'success' : 'default';
}

function formatPresenceRelative(lastSeenAt: string | null): string {
  if (!lastSeenAt) return 'Jamais vu';
  const diff = Date.now() - new Date(lastSeenAt).getTime();
  if (!Number.isFinite(diff) || diff < 0) return 'Jamais vu';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "À l'instant";
  if (mins < 60) return `Il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Il y a ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Hier';
  return `Il y a ${days} jours`;
}

function formatPresenceAbsolute(lastSeenAt: string | null): string {
  if (!lastSeenAt) return '—';
  try {
    return new Date(lastSeenAt).toLocaleString('fr-TN', {
      timeZone: 'Africa/Tunis',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(lastSeenAt).toISOString();
  }
}

function motifOuDefaut(motif: string): string {
  const net = motif.trim();
  return net.length > 0 ? net : 'Désactivation décidée par un administrateur.';
}

interface CompteLibre {
  id: string;
  fullName: string;
  email: string;
  phone: string;
}

export default function AdminLivreursPage() {
  const [resultat, setResultat] = useState<PageResultat<DriverDto>>({
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
  const [enEdition, setEnEdition] = useState<DriverDto | null>(null);
  const [soumission, setSoumission] = useState(false);
  const [erreurForm, setErreurForm] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<Record<string, string>>({});
  const [avecCompte, setAvecCompte] = useState(true);
  const [comptesLibres, setComptesLibres] = useState<CompteLibre[]>([]);

  const [desactivation, setDesactivation] = useState<DriverDto | null>(null);
  const [motifDesactivation, setMotifDesactivation] = useState('');

  const [form, setForm] = useState({
    driverCode: '',
    vehicleType: '',
    licensePlate: '',
    cashCeiling: '',
    isActive: true,
    userId: '',
    compteFullName: '',
    compteEmail: '',
    comptePhone: '',
    comptePassword: '',
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
        status: statutFiltre || undefined,
        page,
        limit: TAILLE_PAGE,
      };
      setResultat(await driversApi.list(filtres));
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

  const ouvrirCreation = async () => {
    setEnEdition(null);
    setErreurForm(null);
    setErreursChamps({});
    setAvecCompte(true);
    setForm({
      driverCode: '',
      vehicleType: '',
      licensePlate: '',
      cashCeiling: '',
      isActive: true,
      userId: '',
      compteFullName: '',
      compteEmail: '',
      comptePhone: '',
      comptePassword: '',
    });
    setFormulaireOuvert(true);
    try {
      setComptesLibres(await driversApi.comptesDisponibles());
    } catch {
      // Sans cette liste, l'option « rattacher un compte existant » reste vide :
      // l'utilisateur peut toujours créer un compte neuf. On ne bloque pas.
      setComptesLibres([]);
    }
  };

  const ouvrirEdition = async (d: DriverDto) => {
    setEnEdition(d);
    setErreurForm(null);
    setErreursChamps({});
    setAvecCompte(false);
    setForm({
      driverCode: d.driverCode,
      vehicleType: d.vehicleType,
      licensePlate: d.licensePlate ?? '',
      cashCeiling: String(d.cashCeiling),
      isActive: d.isActive,
      userId: d.user?.id ?? '',
      compteFullName: '',
      compteEmail: '',
      comptePhone: '',
      comptePassword: '',
    });
    setFormulaireOuvert(true);
    try {
      setComptesLibres(await driversApi.comptesDisponibles());
    } catch {
      setComptesLibres([]);
    }
  };

  const soumettre = async () => {
    setSoumission(true);
    setErreurForm(null);

    // Validation côté client, miroir de l'API, portée par champ et ramenée en
    // vue : un refus serveur ne doit jamais passer inaperçu.
    const erreurs: Record<string, string> = {};
    if (!form.driverCode.trim()) erreurs.driverCode = 'Le code livreur est obligatoire.';
    if (!form.vehicleType.trim()) erreurs.vehicleType = 'Le type de véhicule est obligatoire.';
    if (form.cashCeiling.trim()) {
      const plafond = Number(form.cashCeiling);
      if (!Number.isFinite(plafond) || plafond <= 0) {
        erreurs.cashCeiling = 'Le plafond de caisse doit être un montant positif.';
      }
    }
    if (!enEdition) {
      if (avecCompte) {
        if (!form.compteFullName.trim()) erreurs.compteFullName = 'Le nom complet est obligatoire.';
        if (!form.compteEmail.trim()) erreurs.compteEmail = 'L’e-mail du compte est obligatoire.';
        if (!form.comptePhone.trim()) erreurs.comptePhone = 'Le téléphone du compte est obligatoire.';
        if (form.comptePassword.length < 8) erreurs.comptePassword = '8 caractères minimum.';
      } else if (!form.userId) {
        erreurs.userId = 'Choisissez un compte existant, ou créez-en un.';
      }
    }
    if (Object.keys(erreurs).length > 0) {
      setErreursChamps(erreurs);
      setErreurForm('La fiche n’a pas pu être enregistrée : corrigez les champs signalés.');
      setSoumission(false);
      remonterHautModale();
      return;
    }
    setErreursChamps({});

    try {
      if (enEdition) {
        await driversApi.update(enEdition.id, {
          vehicleType: form.vehicleType,
          licensePlate: form.licensePlate || null,
          ...(form.cashCeiling ? { cashCeiling: Number(form.cashCeiling) } : {}),
          ...(form.userId && form.userId !== enEdition.user?.id ? { userId: form.userId } : {}),
        });
        setMessage(`Livreur « ${form.driverCode} » mis à jour.`);
      } else {
        if (avecCompte) {
          if (!form.compteEmail || !form.comptePassword) {
            throw new Error('Le compte livreur doit avoir un e-mail et un mot de passe.');
          }
        } else if (!form.userId) {
          throw new Error('Choisissez un compte existant, ou créez-en un.');
        }
        await driversApi.create({
          driverCode: form.driverCode,
          vehicleType: form.vehicleType,
          licensePlate: form.licensePlate || null,
          cashCeiling: form.cashCeiling ? Number(form.cashCeiling) : undefined,
          isActive: form.isActive,
          ...(avecCompte
            ? {
                compte: {
                  fullName: form.compteFullName,
                  email: form.compteEmail,
                  phone: form.comptePhone,
                  password: form.comptePassword,
                },
              }
            : { userId: form.userId }),
        });
        setMessage(`Livreur « ${form.driverCode} » créé.`);
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

  const basculerStatut = async (d: DriverDto) => {
    if (d.isActive) {
      setMotifDesactivation('');
      setDesactivation(d);
      return;
    }
    try {
      await driversApi.setStatus(d.id, true, 'Réactivation depuis l’administration.');
      setMessage(`Livreur « ${d.driverCode} » réactivé.`);
      await charger();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Réactivation impossible.');
    }
  };

  const confirmerDesactivation = async () => {
    if (!desactivation) return;
    try {
      await driversApi.setStatus(desactivation.id, false, motifOuDefaut(motifDesactivation));
      setMessage(`Livreur « ${desactivation.driverCode} » désactivé.`);
      setDesactivation(null);
      await charger();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Désactivation impossible.');
    }
  };

  const totalPages = Math.max(1, Math.ceil(resultat.total / TAILLE_PAGE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Livreurs"
        description="Fiches chauffeur, compte associé, véhicule et tournée en cours."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Livreurs', active: true }]}
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
              onClick={() => void ouvrirCreation()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-medium transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Nouveau livreur</span>
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
                placeholder="Code, immatriculation, nom…"
                libelle="Rechercher un livreur"
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
          <ErrorState title="Les livreurs n'ont pas pu être chargés" message={erreur} onRetry={() => void charger()} />
        ) : chargement ? (
          <SkeletonTable rows={6} cols={6} />
        ) : resultat.items.length === 0 ? (
          <EmptyState
            title="Aucun livreur ne correspond"
            description="Modifiez la recherche ou les filtres, ou créez une nouvelle fiche."
          />
        ) : enFiches ? (
          <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
            {resultat.items.map((d) => (
              <FicheLigne
                key={d.id}
                titre={d.user?.fullName ?? d.driverCode}
                sousTitre={d.user?.email ?? 'Compte non rattaché'}
                identifiant={`${d.driverCode} · ${d.licensePlate ?? 'sans immatriculation'}`}
                champs={[
                  { libelle: 'Véhicule', valeur: d.vehicleType },
                  {
                    libelle: 'Présence',
                    valeur: (
                      <span className="inline-flex flex-col gap-0.5">
                        <Badge variant={variantePresence(Boolean(d.isOnline))} className="w-fit gap-1">
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${d.isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`}
                            aria-hidden="true"
                          />
                          {d.isOnline ? 'En ligne' : 'Hors ligne'}
                        </Badge>
                        <span className="text-xs text-slate-500" title={formatPresenceAbsolute(d.lastSeenAt)}>
                          {formatPresenceRelative(d.lastSeenAt)}
                          {d.lastSeenAt ? ` · ${formatPresenceAbsolute(d.lastSeenAt)}` : ''}
                        </span>
                      </span>
                    ),
                  },
                  { libelle: 'Plafond de caisse', valeur: formatTND(d.cashCeiling), numerique: true },
                  {
                    libelle: 'Tournée',
                    valeur: d.currentAssignment
                      ? `${d.currentAssignment.runsheetNumber} — ${LIBELLE_TOURNEE[d.currentAssignment.status] ?? d.currentAssignment.status}`
                      : 'Aucune tournée ouverte',
                  },
                  {
                    libelle: 'État',
                    valeur: <Badge variant={varianteEtat(d.isActive)}>{d.isActive ? 'Actif' : 'Inactif'}</Badge>,
                  },
                ]}
                action={
                  <button
                    type="button"
                    onClick={() => void basculerStatut(d)}
                    className="px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                  >
                    {d.isActive ? 'Désactiver' : 'Activer'}
                  </button>
                }
              />
            ))}
          </div>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Livreur</Th>
                <Th>Véhicule</Th>
                <Th>Dépôt</Th>
                <Th>Présence</Th>
                <Th>Tournée en cours</Th>
                <Th>Plafond</Th>
                <Th>État</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {resultat.items.map((d) => (
                <Tr key={d.id}>
                  <Td>
                    <div className="font-medium text-slate-900">{d.user?.fullName ?? '—'}</div>
                    <div className="text-xs font-mono text-slate-500">{d.driverCode}</div>
                    <div className="text-xs text-slate-400">{d.user?.email ?? 'Compte non rattaché'}</div>
                  </Td>
                  <Td>
                    <div className="text-sm text-slate-700">{d.vehicleType}</div>
                    <div className="text-xs text-slate-500">{d.licensePlate ?? '—'}</div>
                  </Td>
                  <Td>
                    <span className="text-sm text-slate-700">{d.deposit?.name ?? '—'}</span>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <Badge variant={variantePresence(Boolean(d.isOnline))} className="w-fit gap-1">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${d.isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`}
                          aria-hidden="true"
                        />
                        {d.isOnline ? 'En ligne' : 'Hors ligne'}
                      </Badge>
                      <span className="text-xs text-slate-500" title={formatPresenceAbsolute(d.lastSeenAt)}>
                        {formatPresenceRelative(d.lastSeenAt)}
                      </span>
                      {d.lastSeenAt ? (
                        <span className="text-[11px] text-slate-400" title={d.lastSeenAt}>
                          {formatPresenceAbsolute(d.lastSeenAt)}
                        </span>
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    {d.currentAssignment ? (
                      <div>
                        <div className="text-xs font-mono text-slate-900">
                          {d.currentAssignment.runsheetNumber}
                        </div>
                        <div className="text-xs text-slate-500">
                          {LIBELLE_TOURNEE[d.currentAssignment.status] ?? d.currentAssignment.status} ·{' '}
                          {formatDate(d.currentAssignment.tourDate)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400">Aucune tournée ouverte</span>
                    )}
                  </Td>
                  <Td>
                    <span className="text-sm text-slate-700">{formatTND(d.cashCeiling)}</span>
                  </Td>
                  <Td>
                    <Badge variant={varianteEtat(d.isActive)}>{d.isActive ? 'Actif' : 'Inactif'}</Badge>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void ouvrirEdition(d)}
                        aria-label={`Modifier la fiche ${d.driverCode}`}
                        className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void basculerStatut(d)}
                        className="px-2 py-1 text-xs font-medium border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                      >
                        {d.isActive ? 'Désactiver' : 'Activer'}
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
            libelle="livreurs"
          />
        ) : null}
      </div>

      {/* ---------------- Formulaire création / édition ---------------- */}
      <Modal
        isOpen={formulaireOuvert}
        onClose={() => setFormulaireOuvert(false)}
        title={enEdition ? `Modifier ${enEdition.driverCode}` : 'Nouveau livreur'}
        subtitle={
          enEdition
            ? 'Le code livreur n’est pas modifiable : il figure sur les bordereaux déjà émis.'
            : 'Un livreur doit être rattaché à un compte : créez-le ici, ou choisissez un compte existant.'
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
              {soumission ? 'Enregistrement…' : enEdition ? 'Enregistrer' : 'Créer la fiche'}
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
            <FormField label="Code livreur" required error={erreursChamps.driverCode}>
              <input
                value={form.driverCode}
                onChange={(e) => majForm({ driverCode: e.target.value.toUpperCase() })}
                disabled={enEdition !== null}
                className={`${CHAMP_SAISIE} disabled:bg-slate-100 disabled:text-slate-500 font-mono`}
                autoComplete="off"
              />
            </FormField>
            <FormField label="Type de véhicule" required error={erreursChamps.vehicleType}>
              <input
                value={form.vehicleType}
                onChange={(e) => majForm({ vehicleType: e.target.value })}
                className={CHAMP_SAISIE}
                placeholder="Moto, fourgon, voiture…"
                autoComplete="off"
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Immatriculation">
              <input
                value={form.licensePlate}
                onChange={(e) => majForm({ licensePlate: e.target.value.toUpperCase() })}
                className={CHAMP_SAISIE}
                autoComplete="off"
              />
            </FormField>
            <FormField
              label="Plafond de caisse (DT)"
              error={erreursChamps.cashCeiling}
              helpText="Montant maximum d’encaissements que le livreur peut détenir."
            >
              <input
                type="number"
                min="0"
                step="0.001"
                value={form.cashCeiling}
                onChange={(e) => majForm({ cashCeiling: e.target.value })}
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
                Créer un nouveau compte pour ce livreur
              </label>

              {avecCompte ? (
                <div className="grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
                  <FormField label="Nom complet" required error={erreursChamps.compteFullName}>
                    <input
                      value={form.compteFullName}
                      onChange={(e) => majForm({ compteFullName: e.target.value })}
                      className={CHAMP_SAISIE}
                      autoComplete="off"
                    />
                  </FormField>
                  <FormField label="Téléphone" required error={erreursChamps.comptePhone}>
                    <input
                      value={form.comptePhone}
                      onChange={(e) => majForm({ comptePhone: e.target.value })}
                      className={CHAMP_SAISIE}
                      autoComplete="off"
                    />
                  </FormField>
                  <FormField label="Adresse e-mail" required error={erreursChamps.compteEmail}>
                    <input
                      type="email"
                      value={form.compteEmail}
                      onChange={(e) => majForm({ compteEmail: e.target.value })}
                      className={CHAMP_SAISIE}
                      autoComplete="off"
                    />
                  </FormField>
                  <FormField label="Mot de passe" required error={erreursChamps.comptePassword} helpText="8 caractères minimum.">
                    <input
                      type="password"
                      value={form.comptePassword}
                      onChange={(e) => majForm({ comptePassword: e.target.value })}
                      className={CHAMP_SAISIE}
                      autoComplete="new-password"
                    />
                  </FormField>
                </div>
              ) : (
                <FormField
                  label="Compte existant"
                  required
                  error={erreursChamps.userId}
                  helpText="Seuls les comptes sans fiche livreur sont proposés : un compte ne peut pas avoir deux fiches."
                >
                  <select
                    value={form.userId}
                    onChange={(e) => majForm({ userId: e.target.value })}
                    className={CHAMP_SAISIE}
                  >
                    <option value="">— Choisir un compte —</option>
                    {comptesLibres.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName} ({c.email})
                      </option>
                    ))}
                  </select>
                </FormField>
              )}

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                Fiche active dès la création
              </label>
            </>
          ) : (
            <FormField
              label="Compte rattaché"
              helpText="Changer le compte déplace l’accès d’une personne à une autre : l’opération est journalisée."
            >
              <select
                value={form.userId}
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
                className={CHAMP_SAISIE}
              >
                {enEdition.user ? (
                  <option value={enEdition.user.id}>
                    {enEdition.user.fullName} ({enEdition.user.email})
                  </option>
                ) : (
                  <option value="">— Aucun —</option>
                )}
                {comptesLibres.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} ({c.email})
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </div>
      </Modal>

      {/* ---------------- Désactivation avec motif ---------------- */}
      <Modal
        isOpen={desactivation !== null}
        onClose={() => setDesactivation(null)}
        title="Désactiver ce livreur ?"
        subtitle={`La fiche ${desactivation?.driverCode ?? ''} ne pourra plus recevoir de tournée. Les bordereaux et les traces d’audit sont conservés.`}
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
            placeholder="Ex. : congé, fin de contrat, véhicule immobilisé…"
          />
        </FormField>
      </Modal>
    </div>
  );
}
