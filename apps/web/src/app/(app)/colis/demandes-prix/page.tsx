'use client';

/**
 * Demandes de changement de prix.
 *
 * Quand un expéditeur modifie le prix d'un colis déjà créé, le prix n'est pas
 * appliqué : une demande arrive ici. L'administration approuve (le colis, le
 * montant à encaisser et l'attendu de la tournée sont mis à jour, l'expéditeur
 * et le livreur sont prévenus) ou refuse (l'expéditeur est prévenu).
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Card, Modal, PageHeader, Table, Tbody, Td, Th, Thead, Tr, formatTND, useToast } from '@logixpress/ui';
import { PACKAGE_STATUS_LABELS, type PackageStatus } from '@logixpress/types';
import { demandesPrixApi, type DemandePrix } from '@/lib/api';

const ONGLETS: { id: DemandePrix['status']; libelle: string }[] = [
  { id: 'EN_ATTENTE', libelle: 'En attente' },
  { id: 'APPROUVEE', libelle: 'Approuvées' },
  { id: 'REFUSEE', libelle: 'Refusées' },
];

const VARIANTE: Record<DemandePrix['status'], 'warning' | 'success' | 'danger'> = {
  EN_ATTENTE: 'warning',
  APPROUVEE: 'success',
  REFUSEE: 'danger',
};

export default function DemandesPrixPage() {
  const { addToast } = useToast();
  const [onglet, setOnglet] = useState<DemandePrix['status']>('EN_ATTENTE');
  const [lignes, setLignes] = useState<DemandePrix[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ demande: DemandePrix; approuver: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      setLignes(await demandesPrixApi.list({ status: onglet }));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible.');
    } finally {
      setChargement(false);
    }
  }, [onglet]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const confirmer = async () => {
    if (!decision) return;
    setEnvoi(true);
    try {
      const r = decision.approuver
        ? await demandesPrixApi.approuver(decision.demande.id, note.trim() || undefined)
        : await demandesPrixApi.refuser(decision.demande.id, note.trim() || undefined);
      addToast({ type: decision.approuver ? 'success' : 'info', title: r.message ?? 'Demande traitée' });
      setDecision(null);
      window.dispatchEvent(new Event('runex:demandes-prix'));
      await charger();
    } catch (e) {
      addToast({ type: 'error', title: 'Action impossible', message: e instanceof Error ? e.message : undefined });
    } finally {
      setEnvoi(false);
    }
  };

  const colonnes = onglet === 'EN_ATTENTE' ? 8 : 8;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demandes de changement de prix"
        description="Les expéditeurs demandent, l'administration approuve avant que le nouveau prix ne s'applique."
        breadcrumbs={[{ label: 'Gestion des colis', href: '/colis' }, { label: 'Demandes de prix', active: true }]}
      />
      <div className="px-6 space-y-4">
        <div className="flex gap-2" role="tablist">
          {ONGLETS.map((o) => (
            <button
              key={o.id}
              role="tab"
              aria-selected={onglet === o.id}
              type="button"
              onClick={() => setOnglet(o.id)}
              className={`px-3 py-1.5 rounded-md text-sm border ${
                onglet === o.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              {o.libelle}
            </button>
          ))}
        </div>
        {erreur && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{erreur}</p>}
        <Card className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <tr>
                  <Th>Colis</Th>
                  <Th>Expéditeur</Th>
                  <Th>Destinataire</Th>
                  <Th align="right">Prix actuel</Th>
                  <Th align="right">Prix demandé</Th>
                  <Th align="right">À encaisser</Th>
                  <Th>Motif / décision</Th>
                  <Th align="right">{onglet === 'EN_ATTENTE' ? 'Actions' : 'État'}</Th>
                </tr>
              </Thead>
              <Tbody>
                {chargement ? (
                  <tr>
                    <Td colSpan={colonnes} align="center" className="py-6 text-slate-500">
                      Chargement…
                    </Td>
                  </tr>
                ) : lignes.length === 0 ? (
                  <tr>
                    <Td colSpan={colonnes} align="center" className="py-6 text-slate-500">
                      Aucune demande.
                    </Td>
                  </tr>
                ) : (
                  lignes.map((d) => (
                    <Tr key={d.id} data-testid={`demande-prix-${d.trackingNumber}`}>
                      <Td>
                        <Link href={`/colis/${d.packageId}`} className="font-mono font-semibold text-red-700 hover:underline">
                          {d.trackingNumber}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {PACKAGE_STATUS_LABELS[d.packageStatus as PackageStatus] ?? d.packageStatus} ·{' '}
                          {new Date(d.createdAt).toLocaleString('fr-TN')}
                        </div>
                      </Td>
                      <Td>
                        <div className="font-semibold">{d.shipperName}</div>
                        {d.requestedBy && <div className="text-xs text-slate-500">{d.requestedBy}</div>}
                      </Td>
                      <Td>{d.customerName}</Td>
                      <Td align="right" className="font-mono">{formatTND(d.previousGoodsPrice)}</Td>
                      <Td align="right" className="font-mono font-bold">{formatTND(d.newGoodsPrice)}</Td>
                      <Td align="right" className="font-mono text-xs">
                        {formatTND(d.previousTotal)} → {formatTND(d.newTotal)}
                      </Td>
                      <Td className="text-xs text-slate-600 max-w-xs">
                        {d.reason && <div>Motif : {d.reason}</div>}
                        {d.decidedBy && (
                          <div>
                            {d.decidedBy}
                            {d.decisionNote ? ` — ${d.decisionNote}` : ''}
                          </div>
                        )}
                      </Td>
                      <Td align="right">
                        {d.status === 'EN_ATTENTE' ? (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              data-testid="approuver-prix"
                              onClick={() => {
                                setNote('');
                                setDecision({ demande: d, approuver: true });
                              }}
                              className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                            >
                              Approuver
                            </button>
                            <button
                              type="button"
                              data-testid="refuser-prix"
                              onClick={() => {
                                setNote('');
                                setDecision({ demande: d, approuver: false });
                              }}
                              className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50"
                            >
                              Refuser
                            </button>
                          </div>
                        ) : (
                          <Badge variant={VARIANTE[d.status]}>{ONGLETS.find((o) => o.id === d.status)?.libelle}</Badge>
                        )}
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </div>
        </Card>
      </div>

      <Modal
        isOpen={!!decision}
        onClose={() => !envoi && setDecision(null)}
        title={decision?.approuver ? 'Approuver le nouveau prix' : 'Refuser la demande'}
        subtitle={
          decision
            ? `Colis ${decision.demande.trackingNumber} : ${formatTND(decision.demande.previousGoodsPrice)} → ${formatTND(decision.demande.newGoodsPrice)}`
            : undefined
        }
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDecision(null)} disabled={envoi} className="px-3 py-1.5 rounded-md border border-slate-200 text-sm">
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void confirmer()}
              disabled={envoi}
              data-testid="confirmer-decision-prix"
              className={`px-3 py-1.5 rounded-md text-white text-sm disabled:opacity-50 ${
                decision?.approuver ? 'bg-emerald-600' : 'bg-red-600'
              }`}
            >
              {decision?.approuver ? 'Approuver' : 'Refuser'}
            </button>
          </div>
        }
      >
        {decision && (
          <div className="space-y-3 text-sm">
            {decision.approuver ? (
              <p className="text-slate-600">
                Le montant à encaisser passera à <strong>{formatTND(decision.demande.newTotal)}</strong>. L&apos;expéditeur
                et le livreur seront prévenus.
              </p>
            ) : (
              <p className="text-slate-600">Le colis gardera son prix actuel. L&apos;expéditeur sera prévenu.</p>
            )}
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Note (facultatif)</span>
              <input
                type="text"
                value={note}
                maxLength={255}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2"
              />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
