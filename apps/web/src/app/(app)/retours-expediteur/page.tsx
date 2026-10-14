'use client';

/**
 * Retours expéditeur (comme ADEX).
 *
 * « À rendre » : les colis retournés au dépôt, groupés par expéditeur. On
 * prépare un bon de retour (imprimable) ; l'expéditeur voit le code du bon
 * dans son espace, le donne au guichet, et la saisie du code confirme la
 * remise : chaque colis passe « Restitué à l'expéditeur ».
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Card, Modal, PageHeader, Table, Tbody, Td, Th, Thead, Tr, formatTND, useToast } from '@logixpress/ui';
import { retoursExpediteurApi, type BonRetour, type GroupeRetours } from '@/lib/api';
import { imprimerBonRetour } from '@/lib/impression-documents';

type Onglet = 'a-rendre' | 'PREPARE' | 'REMIS' | 'ANNULE';

const ONGLETS: { id: Onglet; libelle: string }[] = [
  { id: 'a-rendre', libelle: 'À rendre' },
  { id: 'PREPARE', libelle: 'Bons préparés' },
  { id: 'REMIS', libelle: 'Remis' },
  { id: 'ANNULE', libelle: 'Annulés' },
];

const ETAT: Record<BonRetour['status'], { libelle: string; variante: 'warning' | 'success' | 'danger' }> = {
  PREPARE: { libelle: 'Préparé', variante: 'warning' },
  REMIS: { libelle: 'Remis', variante: 'success' },
  ANNULE: { libelle: 'Annulé', variante: 'danger' },
};

export default function RetoursExpediteurPage() {
  const { addToast } = useToast();
  const [onglet, setOnglet] = useState<Onglet>('a-rendre');
  const [groupes, setGroupes] = useState<GroupeRetours[]>([]);
  const [bons, setBons] = useState<BonRetour[]>([]);
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({});
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [remise, setRemise] = useState<BonRetour | null>(null);
  const [code, setCode] = useState('');
  const [receveur, setReceveur] = useState('');

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      if (onglet === 'a-rendre') setGroupes(await retoursExpediteurApi.aRendre());
      else setBons(await retoursExpediteurApi.bons({ status: onglet }));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible.');
    } finally {
      setChargement(false);
    }
  }, [onglet]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const action = async (cle: string, fn: () => Promise<{ message?: string }>, apres?: () => void) => {
    setOccupe(cle);
    try {
      const r = await fn();
      addToast({ type: 'success', title: r.message ?? 'Fait' });
      apres?.();
      await charger();
    } catch (e) {
      addToast({ type: 'error', title: 'Action impossible', message: e instanceof Error ? e.message : undefined });
    } finally {
      setOccupe(null);
    }
  };

  const preparer = (g: GroupeRetours) =>
    action(`prep-${g.shipperId}`, async () => {
      const r = await retoursExpediteurApi.creer({ shipperId: g.shipperId });
      if (r.data) imprimerBonRetour(await retoursExpediteurApi.bon(r.data.id));
      return r;
    });

  const imprimer = async (b: BonRetour) => {
    try {
      imprimerBonRetour(await retoursExpediteurApi.bon(b.id));
    } catch (e) {
      addToast({ type: 'error', title: 'Impression impossible', message: e instanceof Error ? e.message : undefined });
    }
  };

  const totalColis = groupes.reduce((s, g) => s + g.colis.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Retours expéditeur"
        description="Colis retournés à rendre à leurs expéditeurs : bon de retour, remise confirmée par le code de l'expéditeur."
        breadcrumbs={[{ label: 'Exploitation' }, { label: 'Retours expéditeur', active: true }]}
      />
      <div className="px-6 space-y-4">
        <div className="flex flex-wrap gap-2" role="tablist">
          {ONGLETS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={onglet === o.id}
              onClick={() => setOnglet(o.id)}
              className={`px-3 py-1.5 rounded-md text-sm border ${
                onglet === o.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              {o.libelle}
              {o.id === 'a-rendre' && onglet === 'a-rendre' && !chargement ? ` (${totalColis})` : ''}
            </button>
          ))}
        </div>
        {erreur && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{erreur}</p>}

        {onglet === 'a-rendre' ? (
          chargement ? (
            <p className="text-sm text-slate-500">Chargement…</p>
          ) : groupes.length === 0 ? (
            <Card>
              <p className="text-sm text-slate-500">Aucun colis retourné en attente de restitution.</p>
            </Card>
          ) : (
            groupes.map((g) => (
              <Card key={g.shipperId} className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`retours-${g.shipperName}`}>
                  <button
                    type="button"
                    onClick={() => setOuverts((o) => ({ ...o, [g.shipperId]: !o[g.shipperId] }))}
                    className="text-left"
                  >
                    <div className="font-semibold text-slate-900">{g.shipperName}</div>
                    <div className="text-xs text-slate-500">
                      {g.colis.length} colis à rendre{g.shipperPhone ? ` · ${g.shipperPhone}` : ''} ·{' '}
                      {ouverts[g.shipperId] ? 'masquer' : 'voir le détail'}
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={occupe === `prep-${g.shipperId}`}
                    onClick={() => void preparer(g)}
                    data-testid="preparer-bon"
                    className="text-sm px-3 py-1.5 rounded-md bg-slate-900 text-white disabled:opacity-50"
                  >
                    Préparer le bon de retour
                  </button>
                </div>
                {ouverts[g.shipperId] && (
                  <div className="overflow-x-auto border-t border-slate-200">
                    <Table>
                      <Thead>
                        <tr>
                          <Th>Colis</Th>
                          <Th>Destinataire</Th>
                          <Th>Motif</Th>
                          <Th>Où</Th>
                          <Th align="right">Frais retour</Th>
                        </tr>
                      </Thead>
                      <Tbody>
                        {g.colis.map((c) => (
                          <Tr key={c.id}>
                            <Td className="font-mono">{c.trackingNumber}</Td>
                            <Td>
                              {c.customerName}
                              <div className="text-xs text-slate-500">{c.governorate}</div>
                            </Td>
                            <Td className="text-xs">{c.reason ?? '—'}</Td>
                            <Td className="text-xs">{c.depositName ?? '—'}</Td>
                            <Td align="right" className="font-mono">{formatTND(c.returnFee)}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </div>
                )}
              </Card>
            ))
          )
        ) : (
          <Card className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <tr>
                    <Th>N° bon</Th>
                    <Th>Expéditeur</Th>
                    <Th align="center">Colis</Th>
                    <Th>Préparé</Th>
                    <Th>Remise</Th>
                    <Th align="center">État</Th>
                    <Th align="right">Actions</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {chargement ? (
                    <tr>
                      <Td colSpan={7} align="center" className="py-6 text-slate-500">
                        Chargement…
                      </Td>
                    </tr>
                  ) : bons.length === 0 ? (
                    <tr>
                      <Td colSpan={7} align="center" className="py-6 text-slate-500">
                        Aucun bon.
                      </Td>
                    </tr>
                  ) : (
                    bons.map((b) => (
                      <Tr key={b.id} data-testid={`bon-${b.slipNumber}`}>
                        <Td className="font-mono font-semibold">{b.slipNumber}</Td>
                        <Td>{b.shipperName}</Td>
                        <Td align="center">{b.packagesCount}</Td>
                        <Td className="text-xs">
                          {new Date(b.createdAt).toLocaleString('fr-TN')}
                          {b.createdBy ? <div className="text-slate-500">{b.createdBy}</div> : null}
                        </Td>
                        <Td className="text-xs">
                          {b.handedOverAt ? (
                            <>
                              {new Date(b.handedOverAt).toLocaleString('fr-TN')}
                              <div className="text-slate-500">
                                {b.receiverName ? `à ${b.receiverName}` : ''} {b.handedOverBy ? `par ${b.handedOverBy}` : ''}
                              </div>
                            </>
                          ) : (
                            '—'
                          )}
                        </Td>
                        <Td align="center">
                          <Badge variant={ETAT[b.status].variante}>{ETAT[b.status].libelle}</Badge>
                        </Td>
                        <Td align="right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void imprimer(b)}
                              className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50"
                            >
                              Imprimer
                            </button>
                            {b.status === 'PREPARE' && (
                              <>
                                <button
                                  type="button"
                                  data-testid="remettre-bon"
                                  onClick={() => {
                                    setCode('');
                                    setReceveur('');
                                    setRemise(b);
                                  }}
                                  className="text-xs px-2 py-1 rounded bg-emerald-600 text-white"
                                >
                                  Remettre
                                </button>
                                <button
                                  type="button"
                                  disabled={occupe === `ann-${b.id}`}
                                  onClick={() => void action(`ann-${b.id}`, () => retoursExpediteurApi.annuler(b.id))}
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
            </div>
          </Card>
        )}
      </div>

      <Modal
        isOpen={!!remise}
        onClose={() => !occupe && setRemise(null)}
        title={remise ? `Remettre le bon ${remise.slipNumber}` : ''}
        subtitle={remise ? `${remise.packagesCount} colis — ${remise.shipperName}` : undefined}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRemise(null)} className="px-3 py-1.5 rounded-md border border-slate-200 text-sm">
              Annuler
            </button>
            <button
              type="button"
              disabled={!code.trim() || !!occupe}
              data-testid="confirmer-remise"
              onClick={() =>
                remise &&
                void action(
                  `rem-${remise.id}`,
                  () => retoursExpediteurApi.remettre(remise.id, { code: code.trim(), receiverName: receveur.trim() || undefined }),
                  () => setRemise(null)
                )
              }
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-50"
            >
              Confirmer la remise
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">
            Demandez à l&apos;expéditeur le code du bon (affiché dans son espace « Retours »). Sans le bon code, la remise est
            refusée.
          </p>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Code de l&apos;expéditeur</span>
            <input
              inputMode="numeric"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              data-testid="code-remise"
              className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2 font-mono tracking-widest"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Reçu par (nom, facultatif)</span>
            <input
              value={receveur}
              maxLength={150}
              onChange={(e) => setReceveur(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2"
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
