'use client';

/**
 * Transferts inter-dépôts : suivi des navettes entre agences.
 * L'API expose `GET /inter-depots` ; l'application Vite n'avait pas d'écran
 * dédié, la page est donc écrite à partir du contrat réel de l'endpoint.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, RotateCcw } from 'lucide-react';
import {
  Badge,
  type BadgeVariant,
  Card,
  ErrorState,
  EmptyState,
  SkeletonTable,
  ChargementEnCours,
  FicheLigne,
  BasculeFiches,
  PageHeader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  formatDelai,
} from '@logixpress/ui';
import { interDepotsApi, type InterDepotDto } from '@/lib/api';

/** Libellé français des états de navette : le code d'énumération n'a rien à
 *  faire dans une colonne d'état lue par un exploitant. */
const LIBELLE_ETAT: Record<string, string> = {
  EN_LOT: 'En lot au départ',
  EN_TRANSIT: 'En transit',
  RECEPTIONNE: 'Réceptionné',
  PARTIEL: 'Réception partielle',
};

/** Chaque état porte sa propre couleur : « réceptionné » en vert, un blocage en
 *  rouge. Tout non-réceptionné en ambre learn à l'utilisateur que l'ambre ne
 *  signale rien. */
const VARIANTE_ETAT: Record<string, BadgeVariant> = {
  EN_LOT: 'secondary',
  EN_TRANSIT: 'secondary',
  RECEPTIONNE: 'success',
  PARTIEL: 'warning',
};

/**
 * Dernière étape connue d'une navette.
 *
 * L'API renvoie la frise complète de la navette ; sans elle, l'écran ne disait
 * ni quand elle était partie, ni quand elle était arrivée — c'est-à-dire
 * précisément ce qu'on vient chercher sur cet écran.
 */
function derniereEtape(transfert: InterDepotDto): string {
  const etapes = transfert.timeline ?? [];
  const derniere = etapes[etapes.length - 1];
  if (!derniere) return '—';
  return `${derniere.step} · ${formatDelai(derniere.timestamp)}`;
}

export default function InterDepotsPage() {
  const [transfers, setTransfers] = useState<InterDepotDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enFiches, setEnFiches] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await interDepotsApi.list();
      setTransfers(response.data ?? []);
    } catch (err) {
      // Les lignes du chargement précédent sont effacées : sinon, après un
      // échec, l'écran affichait les navettes d'un autre moment sous un bandeau
      // d'erreur, et rien ne distinguait une donnée fraîche d'une donnée périmée.
      setTransfers([]);
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transferts Inter-Dépôts"
        description="Navettes logistiques entre le Hub Central et les agences régionales."
        breadcrumbs={[{ label: 'Logistique' }, { label: 'Inter-Dépôts', active: true }]}
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={isLoading}
            aria-busy={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-md text-xs font-medium transition cursor-pointer"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isLoading ? 'Actualisation…' : 'Actualiser'}</span>
          </button>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        {error ? (
          <ErrorState
            title="Les transferts n'ont pas pu être chargés"
            message={error}
            onRetry={() => void load()}
          />
        ) : isLoading ? (
          <>
            <ChargementEnCours message="Chargement des transferts" />
            <SkeletonTable rows={5} cols={6} />
          </>
        ) : transfers.length === 0 ? (
          <EmptyState
            icon={<ArrowRightLeft className="w-8 h-8 text-slate-500" aria-hidden="true" />}
            title="Aucun transfert inter-dépôts"
            description="Les navettes entre le Hub Central et les agences apparaîtront ici, avec leur état d'avancement."
          />
        ) : (
          <>
            <div className="flex justify-end">
              <BasculeFiches enFiches={enFiches} onChange={setEnFiches} />
            </div>

            {enFiches && (
              <div className="sm:hidden bg-white border border-slate-200 rounded-lg overflow-hidden">
                {transfers.map((t) => (
                  <FicheLigne
                    key={t.id}
                    titre={t.transferNumber}
                    sousTitre={`${t.sourceDeposit} → ${t.destinationDeposit}`}
                    identifiant={t.id}
                    action={
                      <Badge variant={VARIANTE_ETAT[t.status] ?? 'secondary'}>
                        {LIBELLE_ETAT[t.status] ?? t.status}
                      </Badge>
                    }
                    champs={[
                      { libelle: 'Colis', valeur: t.totalPackages },
                      {
                        libelle: 'Contact',
                        valeur: (
                          <a
                            href={`tel:${t.contactPhone}`}
                            aria-label={`Appeler le contact de la navette ${t.transferNumber}`}
                            className="font-mono text-red-600 hover:underline"
                          >
                            {t.contactPhone}
                          </a>
                        ),
                      },
                      {
                        libelle: 'Dernière étape',
                        valeur: derniereEtape(t),
                      },
                    ]}
                  />
                ))}
              </div>
            )}

            <div className={enFiches ? 'hidden sm:block' : ''}>
            <Table libelle="Transferts inter-dépôts" largeurMin="720px">
              <Thead>
                <tr>
                  <Th figee>N° Transfert</Th>
                  <Th>Origine</Th>
                  <Th>Destination</Th>
                  <Th align="center">Colis</Th>
                  <Th align="center" priorite="secondaire">Contact</Th>
                  <Th align="center">État</Th>
                  <Th priorite="tertiaire">Dernière étape</Th>
                </tr>
              </Thead>
              <Tbody>
                {transfers.map((t) => (
                  <Tr key={t.id} resume={`Navette ${t.transferNumber}, de ${t.sourceDeposit} vers ${t.destinationDeposit}, ${LIBELLE_ETAT[t.status] ?? t.status}, ${t.totalPackages} colis`}>
                    <Td figee className="font-mono font-bold text-slate-800">{t.transferNumber}</Td>
                    <Td>{t.sourceDeposit}</Td>
                    <Td>{t.destinationDeposit}</Td>
                    <Td align="center" className="font-mono font-semibold">
                      {t.totalPackages}
                    </Td>
                    <Td align="center" priorite="secondaire">
                      {/* Sur un poste logistique, un numéro de téléphone est une
                          action : appeler l'agence qui holds la navette. */}
                      <a
                        href={`tel:${t.contactPhone}`}
                        aria-label={`Appeler le contact de la navette ${t.transferNumber}`}
                        className="font-mono text-red-600 hover:underline"
                      >
                        {t.contactPhone}
                      </a>
                    </Td>
                    <Td align="center">
                      <Badge variant={VARIANTE_ETAT[t.status] ?? 'secondary'}>
                        {LIBELLE_ETAT[t.status] ?? t.status}
                      </Badge>
                    </Td>
                    <Td priorite="tertiaire" className="text-slate-600">
                      {derniereEtape(t)}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
