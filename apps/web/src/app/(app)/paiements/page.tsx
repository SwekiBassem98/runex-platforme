'use client';

/**
 * Encaissements COD.
 *
 * L'argent des clients pris par les livreurs, pièce par pièce. Le cycle y est
 * visible : `En attente` attend la caisse, `Validé` est signé, `Écarté` porte
 * son motif. Aucun bouton ne « met à jour un statut » : valider et écarter
 * appellent deux actions de caisse, et c'est le serveur qui décide de ce
 * qu'elles écrivent.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Card,
  PageHeader,
  Badge,
  BasculeFiches,
  ErrorBanner,
  FicheLigne,
  LigneVide,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  formatMoney,
} from '@logixpress/ui';
import { cashApi } from '@/lib/api';
import { CashSummaryStrip } from '@/features/finance/CashSummaryStrip';
import {
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PaymentStatus,
  type PaymentDto,
  type PaymentSummaryDto,
} from '@logixpress/types';

const STATUS_VARIANT: Record<PaymentStatus, 'default' | 'success' | 'warning' | 'danger' | 'secondary'> = {
  EN_ATTENTE: 'warning',
  VALIDE: 'success',
  ECARTE: 'danger',
  REMBOURSE: 'secondary',
  ANNULE: 'default',
};

const FILTERS: { value: '' | PaymentStatus; label: string }[] = [
  { value: '', label: 'Tous les statuts' },
  { value: PaymentStatus.EN_ATTENTE, label: 'En attente' },
  { value: PaymentStatus.VALIDE, label: 'Validés' },
  { value: PaymentStatus.ECARTE, label: 'Écartés' },
  { value: PaymentStatus.REMBOURSE, label: 'Remboursés' },
  { value: PaymentStatus.ANNULE, label: 'Annulés' },
];

export default function PaiementsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<PaymentSummaryDto | null>(null);
  /*
   * Le filtre est relu depuis l'URL, et réécrit à chaque changement.
   *
   * Trois entrées de l'application mènent ici avec un filtre : « Traiter » sur
   * le bilan de caisse, le clic sur une ligne d'expéditeur, le clic sur une
   * ligne de livreur. Le paramètre était ignoré : l'utilisateur arrivait sur la
   * liste complète, sans aucune trace du filtre demandé, et ne comprenait pas
   * pourquoi la réclamation qu'il venait sélectionner n'y figurait pas. Rien de
   * plus trompeur qu'un lien qui fonctionnait à moitié.
   */
  const [status, setStatus] = useState<'' | PaymentStatus>(() => {
    const demande = params.get('status');
    return FILTERS.some((f) => f.value === demande) ? (demande as PaymentStatus) : '';
  });
  const [shipperId, setShipperId] = useState<string>(() => params.get('shipperId') ?? '');
  const [driverId, setDriverId] = useState<string>(() => params.get('driverId') ?? '');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enFiches, setEnFiches] = useState(false);

  useEffect(() => {
    const demande = params.get('status');
    setStatus(FILTERS.some((f) => f.value === demande) ? (demande as PaymentStatus) : '');
    setShipperId(params.get('shipperId') ?? '');
    setDriverId(params.get('driverId') ?? '');
  }, [params]);

  /** Réécrit l'URL pour que la vue filtrée soit partageable et survive au retour. */
  useEffect(() => {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (shipperId) query.set('shipperId', shipperId);
    if (driverId) query.set('driverId', driverId);
    const suite = query.toString();
    router.replace(suite ? `/paiements?${suite}` : '/paiements', { scroll: false });
  }, [status, shipperId, driverId, router]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [list, totals] = await Promise.all([
        cashApi.list({
          limit: 100,
          ...(status ? { status } : {}),
          ...(shipperId ? { shipperId } : {}),
          ...(driverId ? { driverId } : {}),
        }),
        cashApi.summary(),
      ]);
      setPayments(list.data ?? []);
      setTotal(Number(list.meta?.total ?? list.data?.length ?? 0));
      setSummary(totals);
    } catch (err) {
      setPayments([]);
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    } finally {
      setIsLoading(false);
    }
  }, [status, shipperId, driverId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Le nombre d'écarts est ce que la caisse regarde en premier : tant qu'il
  // n'est pas à zéro, les autres chiffres sont provisoires.
  const gaps = useMemo(() => payments.filter((p) => !p.isBalanced), [payments]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Caisse — Encaissements clients"
        description="Argent pris par les livreurs à la livraison, et état de sa validation par la caisse."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Encaissements', active: true }]}
        actions={
          <div className="flex gap-2">
            {[
              { label: 'Par expéditeur', to: '/paiements/expediteurs' },
              { label: 'Par livreur', to: '/paiements/livreurs' },
              { label: 'Tableau de bord', to: '/finance' },
              { label: 'Bordereaux', to: '/paiements/bordereaux' },
            ].map((link) => (
              <button
                key={link.to}
                type="button"
                onClick={() => router.push(link.to)}
                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded text-xs font-semibold transition cursor-pointer"
              >
                {link.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="px-6 space-y-4">
        {summary && <CashSummaryStrip summary={summary} isLoading={isLoading} />}

        {(status || shipperId || driverId) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold">Filtres appliqués :</span>
            {status && (
              <button
                type="button"
                onClick={() => setStatus('')}
                className="px-2 py-1 bg-white border border-slate-300 rounded-full cursor-pointer hover:bg-slate-50"
              >
                {PAYMENT_STATUS_LABELS[status]}
                <span aria-hidden="true" className="ml-1 text-slate-500">×</span>
                <span className="sr-only">Retirer le filtre de statut</span>
              </button>
            )}
            {shipperId && (
              <button
                type="button"
                onClick={() => setShipperId('')}
                className="px-2 py-1 bg-white border border-slate-300 rounded-full cursor-pointer hover:bg-slate-50"
              >
                Expéditeur {shipperId.slice(0, 8)}
                <span aria-hidden="true" className="ml-1 text-slate-500">×</span>
                <span className="sr-only">Retirer le filtre expéditeur</span>
              </button>
            )}
            {driverId && (
              <button
                type="button"
                onClick={() => setDriverId('')}
                className="px-2 py-1 bg-white border border-slate-300 rounded-full cursor-pointer hover:bg-slate-50"
              >
                Livreur {driverId.slice(0, 8)}
                <span aria-hidden="true" className="ml-1 text-slate-500">×</span>
                <span className="sr-only">Retirer le filtre livreur</span>
              </button>
            )}
          </div>
        )}

        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}

        {gaps.length > 0 && (
          <p className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {gaps.length} encaissement(s) ne se soldent pas. La caisse ne peut pas les valider : ils
            doivent être écartés avec un motif, ou complétés.
          </p>
        )}

        <Card className="p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-800">
              Encaissements{' '}
              {isLoading ? '' : total > payments.length ? `(${total} dont ${payments.length} chargés)` : `(${total})`}
            </h2>
            <div className="flex gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.value || 'all'}
                  onClick={() => setStatus(f.value)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                    status === f.value
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {payments.length > 0 && (
            <div className="flex justify-end px-4 pt-3">
              <BasculeFiches enFiches={enFiches} onChange={setEnFiches} />
            </div>
          )}

          <div className={enFiches ? 'hidden sm:block' : ''}>
          <Table libelle="Encaissements clients" largeurMin="1000px">
            <Thead>
              <tr>
                <Th figee>N°</Th>
                <Th priorite="primaire">Colis</Th>
                <Th priorite="secondaire">Expéditeur</Th>
                <Th priorite="tertiaire">Livreur</Th>
                <Th priorite="tertiaire">Moyen</Th>
                <Th align="right" priorite="secondaire">Dû</Th>
                <Th align="right" priorite="secondaire">Encaissé</Th>
                <Th align="right" priorite="primaire">Reliquat</Th>
                <Th align="center" priorite="primaire">
                  Statut
                </Th>
              </tr>
            </Thead>
            <Tbody>
              {payments.map((p) => (
                <Tr
                  key={p.id}
                  onClick={() => router.push(`/paiements/${p.id}`)}
                  className="cursor-pointer"
                >
                  <Td className="font-mono text-xs">{p.paymentNumber}</Td>
                  <Td priorite="primaire" className="font-mono text-xs">
                    #{p.packageTrackingNumber}
                  </Td>
                  <Td priorite="secondaire" className="text-xs">
                    {p.shipperName}
                  </Td>
                  <Td priorite="tertiaire" className="text-xs">
                    {p.driverName ?? '—'}
                  </Td>
                  <Td priorite="tertiaire" className="text-xs">
                    {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                  </Td>
                  <Td align="right" priorite="secondaire" numerique className="font-mono text-xs">
                    {formatMoney(p.amountExpected)}
                  </Td>
                  <Td align="right" priorite="secondaire" numerique className="font-mono text-xs">
                    {formatMoney(p.amountCollected)}
                  </Td>
                  <Td align="right" priorite="primaire" numerique className="font-mono text-xs">
                    <span className={p.isBalanced ? 'text-slate-500' : 'text-rose-700 font-semibold'}>
                      {formatMoney(p.amountOutstanding)}
                    </span>
                  </Td>
                  <Td align="center" priorite="primaire">
                    <Badge variant={STATUS_VARIANT[p.status] ?? 'default'}>
                      {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                    </Badge>
                  </Td>
                </Tr>
              ))}
              {!isLoading && payments.length === 0 && (
                <LigneVide colSpan={9}>
                  {status || shipperId || driverId
                    ? 'Aucun encaissement ne correspond à ces filtres.'
                    : "Aucun encaissement enregistré. Les montants déclarés par les livreurs apparaîtront ici."}
                </LigneVide>
              )}
            </Tbody>
          </Table>

          </div>

          {enFiches && (
            <div className="sm:hidden bg-white border-t border-slate-200">
              {payments.map((p) => (
                <FicheLigne
                  key={p.id}
                  titre={p.paymentNumber}
                  identifiant={`#${p.packageTrackingNumber}`}
                  sousTitre={p.shipperName}
                  onClick={() => router.push(`/paiements/${p.id}`)}
                  action={
                    <Badge variant={STATUS_VARIANT[p.status] ?? 'default'}>
                      {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                    </Badge>
                  }
                  champs={[
                    { libelle: 'Dû', valeur: formatMoney(p.amountExpected), numerique: true },
                    { libelle: 'Encaissé', valeur: formatMoney(p.amountCollected), numerique: true },
                    {
                      libelle: 'Reliquat',
                      valeur: (
                        <span className={p.isBalanced ? '' : 'text-rose-700 font-semibold'}>
                          {formatMoney(p.amountOutstanding)}
                        </span>
                      ),
                      numerique: true,
                    },
                    { libelle: 'Moyen', valeur: PAYMENT_METHOD_LABELS[p.method] ?? p.method },
                    { libelle: 'Livreur', valeur: p.driverName ?? 'Non renseigné' },
                    { libelle: 'Statut', valeur: PAYMENT_STATUS_LABELS[p.status] ?? p.status },
                  ]}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
