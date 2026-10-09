'use client';

/**
 * Zones de livraison.
 *
 * Une zone est un couple (gouvernorat, délégation). Elle naît toute seule :
 * à la première saisie d'un colis vers une délégation encore inconnue
 * (portail expéditeur ou exploitation), l'API la crée et la rattache à
 * l'agence qui dessert le gouvernorat. Cet écran sert à la suivre et à
 * l'ajuster : nom affiché, agence de livraison, tarif indicatif, activation,
 * et surtout les livreurs qui la couvrent — ce sont eux que l'affectation
 * d'un colis de la zone propose en premier, et eux que l'application livreur
 * affiche dans « Mes zones ».
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, MapPinned, Package, Pencil, RotateCcw, Sparkles, Users } from 'lucide-react';
import {
  Badge,
  BasculeFiches,
  EmptyState,
  ErrorState,
  FicheLigne,
  FormField,
  Modal,
  PageHeader,
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
import { driversApi, receptionApi, zonesApi, type DepotOption, type DriverDto, type ZoneDto } from '@/lib/api';
import { useFeedbackOn } from '@/lib/useFeedbackOn';

const CHAMP =
  'w-full px-3 py-2.5 bg-white border border-slate-300 rounded-md text-sm text-slate-900 ' +
  'focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600';

const NOUVELLE_MS = 7 * 86400 * 1000;

export default function ZonesPage() {
  const [zones, setZones] = useState<ZoneDto[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');
  const [gouvernorat, setGouvernorat] = useState('');
  const [statut, setStatut] = useState('');
  const [enFiches, setEnFiches] = useState(false);
  const [edition, setEdition] = useState<ZoneDto | null>(null);
  useFeedbackOn(erreur, 'error');
  useFeedbackOn(message, 'success');

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      setZones(await zonesApi.list({ active: statut || undefined }));
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Zones indisponibles.');
    } finally {
      setChargement(false);
    }
  }, [statut]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const gouvernorats = useMemo(
    () => [...new Set(zones.map((z) => z.governorate))].sort((a, b) => a.localeCompare(b, 'fr')),
    [zones]
  );

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return zones.filter(
      (z) =>
        (!gouvernorat || z.governorate === gouvernorat) &&
        (!q || [z.name, z.delegation, z.governorate, z.code, z.depositName ?? ''].some((v) => v.toLowerCase().includes(q)))
    );
  }, [zones, recherche, gouvernorat]);

  const stats = useMemo(() => {
    const actives = zones.filter((z) => z.isActive);
    return {
      total: zones.length,
      actives: actives.length,
      sansLivreur: actives.filter((z) => (z.drivers?.length ?? 0) === 0 && (z.openPackages ?? 0) > 0).length,
      nouvelles: zones.filter((z) => Date.now() - new Date(z.createdAt).getTime() < NOUVELLE_MS).length,
      enCours: zones.reduce((s, z) => s + (z.openPackages ?? 0), 0),
    };
  }, [zones]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Zones de livraison"
        description="Créées automatiquement à la saisie des colis. Ajustez l’agence, le tarif et les livreurs de chaque zone."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Zones', active: true }]}
        actions={
          <button
            type="button"
            onClick={() => void charger()}
            disabled={chargement}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-md text-xs font-medium transition cursor-pointer"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${chargement ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{chargement ? 'Actualisation…' : 'Actualiser'}</span>
          </button>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tuile icone={<MapPinned className="w-4 h-4" />} libelle="Zones actives" valeur={`${stats.actives} / ${stats.total}`} />
          <Tuile icone={<Sparkles className="w-4 h-4" />} libelle="Nouvelles (7 jours)" valeur={String(stats.nouvelles)} />
          <Tuile icone={<Users className="w-4 h-4" />} libelle="Colis en cours" valeur={String(stats.enCours)} />
          <Tuile
            icone={<AlertTriangle className="w-4 h-4" />}
            libelle="Colis sans livreur de zone"
            valeur={String(stats.sansLivreur)}
            alerte={stats.sansLivreur > 0}
            aide="Zones avec des colis en cours mais aucun livreur rattaché"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="sm:max-w-xs sm:flex-1">
              <SearchInput value={recherche} onChange={setRecherche} placeholder="Délégation, gouvernorat, agence…" libelle="Rechercher une zone" />
            </div>
            <select
              value={gouvernorat}
              onChange={(e) => setGouvernorat(e.target.value)}
              aria-label="Filtrer par gouvernorat"
              className="px-3 py-2 bg-white border border-slate-200 rounded-md text-sm text-slate-700"
            >
              <option value="">Tous les gouvernorats</option>
              {gouvernorats.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <select
              value={statut}
              onChange={(e) => setStatut(e.target.value)}
              aria-label="Filtrer par état"
              className="px-3 py-2 bg-white border border-slate-200 rounded-md text-sm text-slate-700"
            >
              <option value="">Actives et désactivées</option>
              <option value="true">Actives</option>
              <option value="false">Désactivées</option>
            </select>
          </div>
          <BasculeFiches enFiches={enFiches} onChange={setEnFiches} />
        </div>

        {erreur ? (
          <ErrorState title="Les zones n'ont pas pu être chargées" message={erreur} onRetry={() => void charger()} />
        ) : chargement ? (
          <SkeletonTable rows={6} cols={6} />
        ) : visibles.length === 0 ? (
          <EmptyState
            title={zones.length === 0 ? 'Aucune zone pour l’instant' : 'Aucune zone ne correspond'}
            description={
              zones.length === 0
                ? 'Les zones apparaissent d’elles-mêmes dès la première saisie d’un colis vers une nouvelle délégation.'
                : 'Modifiez la recherche ou les filtres.'
            }
          />
        ) : enFiches ? (
          <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
            {visibles.map((z) => (
              <FicheLigne
                key={z.id}
                titre={z.name}
                sousTitre={`${z.delegation} · ${z.governorate}`}
                identifiant={z.code}
                onClick={() => setEdition(z)}
                action={<EtatZone zone={z} />}
                champs={[
                  { libelle: 'Agence', valeur: z.depositName ?? '—' },
                  { libelle: 'Colis en cours', valeur: String(z.openPackages ?? 0), numerique: true },
                  { libelle: 'Livreurs', valeur: <Livreurs zone={z} /> },
                  { libelle: 'Tarif', valeur: formatTND(z.baseDeliveryFee), numerique: true },
                ]}
              />
            ))}
          </div>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Zone</Th>
                <Th>Agence</Th>
                <Th>Colis en cours</Th>
                <Th>Livreurs</Th>
                <Th>Tarif</Th>
                <Th>État</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {visibles.map((z) => (
                <Tr key={z.id} onClick={() => setEdition(z)} resume={`Zone ${z.name}, ${z.governorate}`}>
                  <Td>
                    <div className="font-medium text-slate-900">{z.name}</div>
                    <div className="text-xs text-slate-500">
                      {z.delegation} · {z.governorate} · <span className="font-mono">{z.code}</span>
                    </div>
                  </Td>
                  <Td>{z.depositName ?? '—'}</Td>
                  <Td>
                    <span className="tabular-nums font-semibold">{z.openPackages ?? 0}</span>
                    <span className="text-xs text-slate-400"> / {z.totalPackages ?? 0}</span>
                  </Td>
                  <Td>
                    <Livreurs zone={z} />
                  </Td>
                  <Td className="tabular-nums">{formatTND(z.baseDeliveryFee)}</Td>
                  <Td>
                    <EtatZone zone={z} />
                  </Td>
                  <Td>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEdition(z);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50"
                    >
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Modifier
                    </button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </div>

      {edition && (
        <EditionZone
          zone={edition}
          onClose={() => setEdition(null)}
          onSaved={async (z) => {
            setEdition(null);
            setMessage(`Zone « ${z.name} » enregistrée.`);
            await charger();
          }}
        />
      )}
    </div>
  );
}

function Tuile({
  icone,
  libelle,
  valeur,
  alerte = false,
  aide,
}: {
  icone: React.ReactNode;
  libelle: string;
  valeur: string;
  alerte?: boolean;
  aide?: string;
}) {
  return (
    <div
      className={`rounded-lg border p-3 bg-white ${alerte ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}
      title={aide}
    >
      <div className={`flex items-center gap-1.5 text-xs font-medium ${alerte ? 'text-amber-700' : 'text-slate-500'}`}>
        {icone}
        {libelle}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{valeur}</div>
    </div>
  );
}

function EtatZone({ zone }: { zone: ZoneDto }) {
  const nouvelle = Date.now() - new Date(zone.createdAt).getTime() < NOUVELLE_MS;
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge variant={zone.isActive ? 'success' : 'default'}>{zone.isActive ? 'Active' : 'Désactivée'}</Badge>
      {zone.autoCreated && nouvelle && <Badge variant="primary">Nouvelle · {formatDate(zone.createdAt)}</Badge>}
    </span>
  );
}

function Livreurs({ zone }: { zone: ZoneDto }) {
  const liste = zone.drivers ?? [];
  if (liste.length === 0) {
    return (zone.openPackages ?? 0) > 0 ? (
      <span className="text-xs font-medium text-amber-700">Aucun livreur</span>
    ) : (
      <span className="text-xs text-slate-400">—</span>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {liste.slice(0, 3).map((d) => (
        <span key={d.id} className="px-1.5 py-0.5 rounded bg-slate-100 text-[11px] text-slate-700" title={d.fullName}>
          {d.driverCode}
        </span>
      ))}
      {liste.length > 3 && <span className="text-[11px] text-slate-500">+{liste.length - 3}</span>}
    </span>
  );
}

function EditionZone({
  zone,
  onClose,
  onSaved,
}: {
  zone: ZoneDto;
  onClose: () => void;
  onSaved: (z: ZoneDto) => void | Promise<void>;
}) {
  const [nom, setNom] = useState(zone.name);
  const [agence, setAgence] = useState(zone.depositId);
  const [tarif, setTarif] = useState(String(zone.baseDeliveryFee));
  const [active, setActive] = useState(zone.isActive);
  const [livreurs, setLivreurs] = useState<string[]>((zone.drivers ?? []).map((d) => d.id));
  const [agences, setAgences] = useState<DepotOption[]>([]);
  const [tous, setTous] = useState<DriverDto[]>([]);
  const [filtre, setFiltre] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    void receptionApi.depots().then(setAgences).catch(() => setAgences([]));
    void driversApi
      .list({ limit: 200, status: 'actif' })
      .then((r) => setTous(r.items))
      .catch(() => setTous([]));
  }, []);

  const proposes = useMemo(() => {
    const q = filtre.trim().toLowerCase();
    return tous.filter(
      (d) => !q || `${d.driverCode} ${d.user?.fullName ?? ''} ${d.licensePlate ?? ''}`.toLowerCase().includes(q)
    );
  }, [tous, filtre]);

  const enregistrer = async () => {
    setEnCours(true);
    setErreur(null);
    try {
      const z = await zonesApi.update(zone.id, {
        name: nom,
        depositId: agence,
        baseDeliveryFee: Number(tarif.replace(',', '.')),
        isActive: active,
        driverIds: livreurs,
      });
      await onSaved(z);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Zone ${zone.delegation}`}
      subtitle={`${zone.governorate} · ${zone.code}${zone.autoCreated ? ' · créée automatiquement' : ''}`}
      size="lg"
      footer={
        <>
          <Link
            href={`/colis?zone=${zone.id}`}
            className="me-auto inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:text-red-700"
            data-testid="voir-colis-zone"
          >
            <Package className="w-3.5 h-3.5" />
            Voir les colis de la zone
          </Link>
          <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 text-slate-700 rounded text-xs font-medium">
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void enregistrer()}
            disabled={enCours}
            className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded text-xs font-semibold"
          >
            {enCours ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {erreur && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2.5">
            {erreur}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Nom affiché" required>
            <input id="zone-nom" className={CHAMP} value={nom} onChange={(e) => setNom(e.target.value)} maxLength={100} />
          </FormField>
          <FormField label="Agence de livraison">
            <select id="zone-agence" className={CHAMP} value={agence} onChange={(e) => setAgence(e.target.value)}>
              {agences.length === 0 && <option value={zone.depositId}>{zone.depositName ?? 'Agence actuelle'}</option>}
              {agences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.isMainHub ? ' (hub)' : ''}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Tarif indicatif (DT)">
            <input id="zone-tarif" className={CHAMP} inputMode="decimal" value={tarif} onChange={(e) => setTarif(e.target.value)} />
          </FormField>
          <FormField label="État">
            <label className="flex items-center gap-2 py-2.5 text-sm text-slate-700">
              <input id="zone-active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-red-600 w-4 h-4" />
              Zone active (proposée aux livreurs, colis routés vers son agence)
            </label>
          </FormField>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-sm font-semibold text-slate-900">
              Livreurs de la zone <span className="text-slate-400 font-normal">({livreurs.length})</span>
            </p>
            <input
              id="zone-filtre-livreurs"
              className="px-2.5 py-1.5 border border-slate-200 rounded-md text-xs w-44"
              placeholder="Filtrer les livreurs…"
              value={filtre}
              onChange={(e) => setFiltre(e.target.value)}
            />
          </div>
          <p className="text-xs text-slate-500 mb-2">
            Proposés en premier à l’affectation des colis de la zone. Le livreur voit la zone dans « Mes zones ».
          </p>
          <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
            {proposes.length === 0 ? (
              <p className="p-3 text-xs text-slate-500">Aucun livreur actif.</p>
            ) : (
              proposes.map((d) => {
                const coche = livreurs.includes(d.id);
                return (
                  <label key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={coche}
                      onChange={() =>
                        setLivreurs((l) => (coche ? l.filter((x) => x !== d.id) : [...l, d.id]))
                      }
                      className="accent-red-600 w-4 h-4"
                    />
                    <span className="font-medium text-slate-900">{d.user?.fullName ?? d.driverCode}</span>
                    <span className="text-xs text-slate-500">
                      {d.driverCode} · {d.vehicleType}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
