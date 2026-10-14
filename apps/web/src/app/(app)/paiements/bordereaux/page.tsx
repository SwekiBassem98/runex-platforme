'use client';

/**
 * Bordereaux de paiement expéditeurs (comme ADEX).
 *
 * « À régler » : par expéditeur, les colis livrés (encaissement validé par
 * la caisse) et retournés qui ne sont dans aucun bordereau ; « Créer le
 * bordereau » les regroupe et génère un code de retrait à 6 chiffres que
 * l'expéditeur voit dans son espace. Pour payer, la caisse saisit le code
 * que l'expéditeur lui donne.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Card, Modal, PageHeader, Table, Tbody, Td, Th, Thead, Tr, formatTND, useToast } from '@logixpress/ui';
import { PAYMENT_METHOD_LABELS, PaymentMethod, PermissionCode, type PaymentVoucherDto } from '@logixpress/types';
import { paymentsApi, type CandidatsBordereau } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { imprimerBordereau } from '@/lib/impression-documents';

/** État d'un bordereau : libellé lisible (et non le code de l'API) et couleur. */
const ETAT_BORDEREAU: Record<string, { libelle: string; variante: 'warning' | 'primary' | 'success' | 'danger' }> = {
  EN_ATTENTE: { libelle: 'En attente', variante: 'warning' },
  CONFIRME: { libelle: 'À payer', variante: 'primary' },
  PAYE: { libelle: 'Réglé', variante: 'success' },
  ANNULE: { libelle: 'Annulé', variante: 'danger' },
};

const MOYENS = [PaymentMethod.ESPECE, PaymentMethod.CHEQUE, PaymentMethod.VIREMENT, PaymentMethod.TRAITE];

export default function PaiementsPage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const peutRegler = user?.permissions?.includes(PermissionCode.PAYMENT_VALIDATE) ?? false;
  const [vouchers, setVouchers] = useState<PaymentVoucherDto[]>([]);
  const [candidats, setCandidats] = useState<CandidatsBordereau[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [aPayer, setAPayer] = useState<PaymentVoucherDto | null>(null);
  const [code, setCode] = useState('');
  const [moyen, setMoyen] = useState<PaymentMethod>(PaymentMethod.ESPECE);
  const [reference, setReference] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [response, c] = await Promise.all([
        paymentsApi.list(),
        peutRegler ? paymentsApi.candidats().catch(() => []) : Promise.resolve([]),
      ]);
      setVouchers(response.data ?? []);
      setCandidats(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    } finally {
      setIsLoading(false);
    }
  }, [peutRegler]);

  useEffect(() => {
    void load();
  }, [load]);

  const action = async (cle: string, fn: () => Promise<{ message?: string }>, apres?: () => void) => {
    setOccupe(cle);
    try {
      const r = await fn();
      addToast({ type: 'success', title: r.message ?? 'Fait' });
      apres?.();
      await load();
    } catch (e) {
      addToast({ type: 'error', title: 'Action impossible', message: e instanceof Error ? e.message : undefined });
    } finally {
      setOccupe(null);
    }
  };

  const imprimer = async (v: PaymentVoucherDto) => {
    try {
      imprimerBordereau(await paymentsApi.detail(v.id));
    } catch (e) {
      addToast({ type: 'error', title: 'Impression impossible', message: e instanceof Error ? e.message : undefined });
    }
  };

  const payer = () =>
    aPayer &&
    action(
      `pay-${aPayer.id}`,
      () =>
        paymentsApi.validate(aPayer.voucherNumber, {
          secretCode: code.trim(),
          paymentMethod: moyen,
          transactionRef: reference.trim() || undefined,
        }),
      () => setAPayer(null)
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bordereaux de paiement expéditeurs"
        description="Regroupez ce qui est dû à chaque expéditeur, puis payez-le avec le code qu'il vous donne."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Bordereaux', active: true }]}
      />

      <div className="p-6 space-y-6">
        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
        )}

        {peutRegler && (
          <Card className="p-0">
            <div className="px-4 py-3 border-b border-slate-200">
              <h3 className="font-semibold text-slate-800">À régler — nouveaux bordereaux</h3>
              <p className="text-xs text-slate-500">
                Colis livrés dont l&apos;encaissement est validé par la caisse, et colis retournés, pas encore dans un bordereau.
              </p>
            </div>
            <Table>
              <Thead>
                <tr>
                  <Th>Expéditeur</Th>
                  <Th align="center">Livrés / Retours</Th>
                  <Th align="right">Encaissé</Th>
                  <Th align="right">Frais</Th>
                  <Th align="right">Net estimé</Th>
                  <Th align="right">Action</Th>
                </tr>
              </Thead>
              <Tbody>
                {isLoading ? (
                  <tr>
                    <Td colSpan={6} align="center" className="text-slate-500 py-4">
                      Chargement…
                    </Td>
                  </tr>
                ) : candidats.length === 0 ? (
                  <tr>
                    <Td colSpan={6} align="center" className="text-slate-500 py-4">
                      Rien à régler pour le moment.
                    </Td>
                  </tr>
                ) : (
                  candidats.map((c) => (
                    <Tr key={c.shipperId} data-testid={`a-regler-${c.shipperName}`}>
                      <Td className="font-semibold">{c.shipperName}</Td>
                      <Td align="center">
                        <span className="text-emerald-700 font-bold">{c.livres} L</span> /{' '}
                        <span className="text-red-600 font-bold">{c.retournes} R</span>
                      </Td>
                      <Td align="right" className="font-mono">{formatTND(c.encaisse)}</Td>
                      <Td align="right" className="font-mono">{formatTND(c.fraisLivraison + c.fraisRetour)}</Td>
                      <Td align="right" className="font-mono font-bold">{formatTND(c.netEstime)}</Td>
                      <Td align="right">
                        <button
                          type="button"
                          disabled={occupe === `cre-${c.shipperId}`}
                          data-testid="creer-bordereau"
                          onClick={() =>
                            void action(`cre-${c.shipperId}`, () => paymentsApi.creer({ shipperId: c.shipperId }))
                          }
                          className="text-xs px-2 py-1 rounded bg-slate-900 text-white disabled:opacity-50"
                        >
                          Créer le bordereau
                        </button>
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </Card>
        )}

        <Card className="p-0">
          <Table>
            <Thead>
              <tr>
                <Th>N° Bordereau</Th>
                <Th>Expéditeur</Th>
                <Th align="center">Livrés / Retours</Th>
                <Th align="right">Brut Encaissé</Th>
                <Th align="right">Net à Payer</Th>
                <Th align="center">État</Th>
                <Th align="right">Actions</Th>
              </tr>
            </Thead>
            <Tbody>
              {isLoading ? (
                <tr>
                  <Td colSpan={7} align="center" className="text-slate-500 py-6">
                    Chargement…
                  </Td>
                </tr>
              ) : vouchers.length === 0 ? (
                <tr>
                  <Td colSpan={7} align="center" className="text-slate-500 py-6">
                    Aucun bordereau.
                  </Td>
                </tr>
              ) : (
                vouchers.map((v) => (
                  <Tr key={v.id} data-testid={`bordereau-${v.voucherNumber}`}>
                    <Td className="font-mono font-bold text-amber-700">{v.voucherNumber}</Td>
                    <Td className="font-semibold">{v.shipperName}</Td>
                    <Td align="center">
                      <span className="text-emerald-700 font-bold">{v.deliveredCount} L</span> /{' '}
                      <span className="text-red-600 font-bold">{v.returnedCount} R</span>
                    </Td>
                    <Td align="right" className="font-mono">{formatTND(v.grossCashCollected)}</Td>
                    <Td align="right" className="font-mono font-bold text-slate-900">{formatTND(v.netPayable)}</Td>
                    <Td align="center">
                      <Badge variant={ETAT_BORDEREAU[v.status]?.variante ?? 'primary'}>
                        {ETAT_BORDEREAU[v.status]?.libelle ?? v.status}
                      </Badge>
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void imprimer(v)}
                          className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50"
                        >
                          Imprimer
                        </button>
                        {peutRegler && (v.status === 'CONFIRME' || v.status === 'EN_ATTENTE') && (
                          <>
                            <button
                              type="button"
                              data-testid="payer-bordereau"
                              onClick={() => {
                                setCode('');
                                setReference('');
                                setMoyen(PaymentMethod.ESPECE);
                                setAPayer(v);
                              }}
                              className="text-xs px-2 py-1 rounded bg-emerald-600 text-white"
                            >
                              Payer
                            </button>
                            <button
                              type="button"
                              disabled={occupe === `ann-${v.id}`}
                              onClick={() => void action(`ann-${v.id}`, () => paymentsApi.annuler(v.id))}
                              className="text-xs px-2 py-1 rounded border border-red-200 text-red-700"
                            >
                              Annuler
                            </button>
                          </>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </Card>
      </div>

      <Modal
        isOpen={!!aPayer}
        onClose={() => !occupe && setAPayer(null)}
        title={aPayer ? `Payer le bordereau ${aPayer.voucherNumber}` : ''}
        subtitle={aPayer ? `${aPayer.shipperName} — net ${formatTND(aPayer.netPayable)}` : undefined}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAPayer(null)} className="px-3 py-1.5 rounded-md border border-slate-200 text-sm">
              Annuler
            </button>
            <button
              type="button"
              disabled={!code.trim() || !!occupe}
              onClick={() => void payer()}
              data-testid="confirmer-paiement-bordereau"
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-50"
            >
              Confirmer le paiement
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">
            Saisissez le code du bordereau que l&apos;expéditeur vous donne (affiché dans son espace « Bordereaux »).
          </p>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Code de l&apos;expéditeur</span>
            <input
              inputMode="numeric"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              data-testid="code-bordereau"
              className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2 font-mono tracking-widest"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Moyen de paiement</span>
            <select
              value={moyen}
              onChange={(e) => setMoyen(e.target.value as PaymentMethod)}
              className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2 bg-white"
            >
              {MOYENS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          {moyen !== PaymentMethod.ESPECE && (
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">N° de chèque / virement</span>
              <input
                value={reference}
                maxLength={100}
                onChange={(e) => setReference(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2"
              />
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}
