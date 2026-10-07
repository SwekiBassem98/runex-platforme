'use client';

/**
 * Détail d'un encaissement, et les deux seules actions possibles.
 *
 * Valider et écarter ne sont pas des champs modifiables mais des opérations
 * de caisse. Le formulaire n'envoie qu'une référence et une note : ni
 * montant, ni statut. Le serveur compare le bilan et décide — et un bilan
 * qui ne se referme pas ne peut pas être validé, seulement écarté avec un
 * motif.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, PageHeader, Badge, formatDateTime, formatMoney } from '@logixpress/ui';
import { cashApi } from '@/lib/api';
import {
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PaymentStatus,
  type PaymentDto,
} from '@logixpress/types';

const STATUS_VARIANT: Record<PaymentStatus, 'default' | 'success' | 'warning' | 'danger' | 'secondary'> = {
  EN_ATTENTE: 'warning',
  VALIDE: 'success',
  ECARTE: 'danger',
  REMBOURSE: 'secondary',
  ANNULE: 'default',
};

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className="text-xs font-medium text-slate-900 text-right">{value}</span>
    </div>
  );
}

export default function PaiementDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [payment, setPayment] = useState<PaymentDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [transactionRef, setTransactionRef] = useState('');
  const [notes, setNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [mode, setMode] = useState<'validate' | 'reject' | null>(null);

  const load = useCallback(async () => {
    if (!params?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      setPayment(await cashApi.get(params.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    } finally {
      setIsLoading(false);
    }
  }, [params?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(action: 'validate' | 'reject') {
    if (!payment) return;
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      if (action === 'validate') {
        const updated = await cashApi.validate(payment.id, { transactionRef, notes });
        setPayment(updated);
        setNotice(`Encaissement ${updated.paymentNumber} validé par ${updated.validatedByName}.`);
      } else {
        const updated = await cashApi.reject(payment.id, { reason: rejectReason, notes });
        setPayment(updated);
        setNotice(`Encaissement ${updated.paymentNumber} écarté.`);
      }
      setMode(null);
      setRejectReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Opération impossible.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-slate-500" role="status">
        Chargement de l'encaissement…
      </div>
    );
  }

  if (!payment) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error ?? 'Encaissement introuvable.'}
        </p>
        <button
          type="button"
          onClick={() => router.push('/paiements')}
          className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded text-xs font-semibold"
        >
          Retour à la caisse
        </button>
      </div>
    );
  }

  const actionable = payment.status === 'EN_ATTENTE';
  const needsReference = payment.method !== 'ESPECE';
  /*
   * Les deux conditions de validité d'une validation, calculées avant l'affichage.
   *
   * Le serveur refusait ces deux cas, mais l'interface ne le disait pas : la
   * caisse cliquait, attendait, puis lisait « opération impossible ». Sur un
   * encaissement à 100 DT, cela se produisait à chaque fois que le reliquat
   * restait dû, et à chaque fois que la référence de carte manquait.
   */
  const bloqueParBilan = !payment.isBalanced;
  const bloqueParReference = needsReference && !transactionRef.trim();
  const validationBloquee = bloqueParBilan || bloqueParReference;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Encaissement ${payment.paymentNumber}`}
        description={`Colis #${payment.packageTrackingNumber} — ${payment.shipperName}`}
        breadcrumbs={[
          { label: 'Finance' },
          { label: 'Paiements', href: '/paiements' },
          { label: payment.paymentNumber, active: true },
        ]}
        actions={
          <Badge variant={STATUS_VARIANT[payment.status] ?? 'default'}>
            {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
          </Badge>
        }
      />

      <div className="px-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" title="Bilan" subtitle="Les trois montants doivent se refermer sur l'attendu.">
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Attendu', value: payment.amountExpected, tone: 'text-slate-900' },
                { label: 'Encaissé', value: payment.amountCollected, tone: 'text-slate-900' },
                {
                  label: 'Reliquat',
                  value: payment.amountOutstanding,
                  tone: payment.isBalanced ? 'text-emerald-700' : 'text-rose-600',
                },
              ].map((cell) => (
                <div key={cell.label} className="rounded-md border border-slate-200 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">{cell.label}</p>
                  <p className={`mt-1 font-mono text-sm font-bold ${cell.tone}`}>
                    {formatMoney(cell.value)}
                  </p>
                </div>
              ))}
            </div>

            {!payment.isBalanced && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                Il manque {formatMoney(payment.amountOutstanding)} : cet encaissement ne peut pas être
                validé tant que la différence n'est pas expliquée.
              </p>
            )}

            <div className="pt-1">
              <Line label="Colis" value={<span className="font-mono">#{payment.packageTrackingNumber}</span>} />
              <Line label="Expéditeur" value={payment.shipperName} />
              <Line label="Livreur" value={payment.driverName ?? '—'} />
              <Line label="Tournée" value={payment.runsheetNumber ?? '—'} />
              <Line label="Moyen de paiement" value={PAYMENT_METHOD_LABELS[payment.method] ?? payment.method} />
              <Line label="Référence" value={payment.transactionRef ?? '—'} />
              <Line label="Frais de livraison" value={formatMoney(payment.deliveryFee)} />
              <Line label="Encaissé le" value={formatDateTime(payment.collectedAt)} />
              {payment.amountRefunded !== '0.000' && (
                <Line label="Remboursé" value={formatMoney(payment.amountRefunded)} />
              )}
              <Line
                label="Validé le"
                value={payment.validatedAt ? formatDateTime(payment.validatedAt) : '—'}
              />
              <Line label="Validé par" value={payment.validatedByName ?? '—'} />
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          {error && (
            <p
              role="alert"
              className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              aria-live="polite"
              className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2"
            >
              {notice}
            </p>
          )}
          {payment.discrepancyReason && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wider text-rose-700">Motif de l'écart</p>
              <p className="mt-1 text-xs text-rose-900">{payment.discrepancyReason}</p>
            </div>
          )}

          <Card title="Actions de caisse">
            {!actionable ? (
              <p className="text-xs text-slate-500">
                Cet encaissement est « {PAYMENT_STATUS_LABELS[payment.status]} » : il n'est plus
                modifiable. Une validation écrite par la caisse ne se rature pas depuis cet écran.
              </p>
            ) : mode === 'validate' ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-600">
                  Vous confirmez que l'encaissé correspond bien à l'attendu ?
                </p>
                {needsReference && (
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-700">
                      Référence du {PAYMENT_METHOD_LABELS[payment.method].toLowerCase()} *
                    </span>
                    <input
                      value={transactionRef}
                      onChange={(e) => setTransactionRef(e.target.value)}
                      placeholder="N° de chèque"
                      className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-md text-xs font-mono"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">Note interne</span>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-md text-xs"
                  />
                </label>
                <div className="flex gap-2">
                  {(bloqueParBilan || bloqueParReference) && (
                    <ul className="text-[11px] text-rose-700 space-y-1">
                      {bloqueParBilan && (
                        <li>
                          Le reliquat de {formatMoney(payment.amountOutstanding)} doit être soldé :
                          validez après encaissement du complément, ou écartez avec un motif.
                        </li>
                      )}
                      {bloqueParReference && (
                        <li>
                          La référence de transaction est obligatoire pour un paiement par{' '}
                          {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}.
                        </li>
                      )}
                    </ul>
                  )}
                  <button
                    type="button"
                    disabled={isSubmitting || validationBloquee}
                    aria-busy={isSubmitting}
                    onClick={() => void submit('validate')}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-xs font-semibold cursor-pointer"
                  >
                    Confirmer la validation
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode(null)}
                    className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded text-xs font-semibold"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : mode === 'reject' ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-600">
                  Un écart se motive. Ce que vous écrivez ici est ce que la direction relira.
                </p>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">Motif de l'écart *</span>
                  <input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Ex: client a réglé 60 sur 100, reliquant en attente"
                    aria-required="true"
                    aria-invalid={!rejectReason.trim()}
                    aria-describedby="aide-motif-ecart"
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-md text-xs"
                  />
                  <span id="aide-motif-ecart" className="sr-only">
                    Champ obligatoire. Décrivez la différence constatée entre l'attendu et l'encaissé.
                  </span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting || !rejectReason.trim()}
                    aria-busy={isSubmitting}
                    onClick={() => void submit('reject')}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded text-xs font-semibold cursor-pointer"
                  >
                    Confirmer l'écart
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode(null)}
                    className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded text-xs font-semibold"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setMode('validate')}
                  className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold"
                >
                  Valider l'encaissement
                </button>
                <button
                  type="button"
                  onClick={() => setMode('reject')}
                  className="w-full px-3 py-2 bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 rounded text-xs font-semibold"
                >
                  Écarter et motiver
                </button>
                <p className="pt-1 text-[11px] text-slate-500">
                  Ces deux actions écrivent votre nom et l'heure. Un paiement ne se règle pas en
                  changeant une étiquette.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
