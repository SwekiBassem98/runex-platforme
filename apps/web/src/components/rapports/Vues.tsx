/**
 * Vues des rapports d'exploitation.
 *
 * Chaque rapport répond à une question, et la question décide de la mise en
 * page :
 *
 * - **Colis** — « le flux suit-il, et qu'est-ce qui le coince ? ». D'où un
 *   graphique de flux(created/livré/incident) et un classement des motifs,
 *   plutôt qu'un camembert de statuts ;
 * - **Expéditeurs** — « qui fait des colis, et qui est payé ? ». Le tableau
 *   porte les volumes et les dinars côte à côte ;
 * - **Livreurs** — « qui livre, et qui rapporte la caisse ? ». Le taux de
 *   réussite est la donnée d'accompagnement ;
 * - **Finance** — « l'argent attendu est-il rentré, et où est le trou ? ». Les
 *   écarts sont la seule liste qu'on lit ligne à ligne ;
 * - **Dépôts** — « où est le stock, et ce qui bloque ? ». Les transferts en
 *   écart et le stock immobile sont le contenu utile.
 *
 * Le périmètre affiché par l'API est repris en tête de chaque rapport : un
 * chiffre lu par un expéditeur et un chiffre lu par un gestionnaire ne sont pas
 * le même chiffre, et sans la mention on prendrait le second pour le premier.
 */

'use client';

import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import {
  Badge,
  Card,
  EmptyState,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  formatDate,
  formatMoney,
} from '@logixpress/ui';
import type {
  EnteteRapport,
  RapportColis,
  RapportDepots,
  RapportExpediteurs,
  RapportFinance,
  RapportLivreurs,
} from '@logixpress/types';
import {
  GraphiqueCaisse,
  GraphiqueDepots,
  GraphiqueFlux,
  GraphiqueMotifs,
  GraphiqueStock,
  GraphiqueTaux,
} from './Graphiques';

/* ------------------------------------------------------------------ */
/* Briques communes                                                    */
/* ------------------------------------------------------------------ */

function Tuile({
  libelle,
  valeur,
  detail,
  accent = 'neutre',
}: {
  libelle: string;
  valeur: string;
  detail?: string;
  accent?: 'neutre' | 'bon' | 'mauvais' | 'alerte';
}) {
  const teintes = {
    neutre: 'text-slate-900',
    bon: 'text-emerald-600',
    mauvais: 'text-slate-900',
    alerte: 'text-red-600',
  } as const;
  return (
    <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-xs">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{libelle}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${teintes[accent]}`}>{valeur}</p>
      {detail && <p className="mt-0.5 text-[11px] text-slate-500">{detail}</p>}
    </div>
  );
}

/**
 * Ce que l'API a réellement compté, et sur quoi.
 *
 * Le `période` vient du serveur et non des champs de date de l'écran : c'est la
 * borne résolue, après application d'une période par défaut ou d'un décalage de
 * fuseau. L'afficher évite qu'un rapport calculé sur trente jours se présente
 * comme un rapport « depuis toujours ».
 */
function Portee({ entete }: { entete: EnteteRapport }) {
  return (
    <p className="text-[11px] text-slate-500">
      Période appliquée : <span className="font-medium text-slate-700">{entete.periode}</span>
      <span className="mx-1.5 text-slate-300">|</span>
      Périmètre :{' '}
      <span className="font-medium text-slate-700">{entete.perimetre}</span>
    </p>
  );
}

function aucunResultat(objet: string): React.ReactElement {
  return (
    <EmptyState
      title="Aucun mouvement sur cette période"
      description={`Aucun ${objet} n'a été enregistré entre les deux bornes choisies. Élargissez la période ou changez de filtre : le rapport est exact, il n'a simplement rien à dire.`}
    />
  );
}

/**
 * Taux en pourcentage, une décimale.
 *
 * Le taux est un ratio, pas un montant : il ne suit pas le format monétaire à
 * trois décimales, et arrondir à une décimale évite d'afficher « 66,7 % » là où
 * l'écran est déjà chargé de nombres longs. La locale reste française, pour que
 * la virgule décimale ne disparaisse pas.
 */
function Pourcent(valeur: number): string {
  if (!Number.isFinite(valeur)) return '—';
  return `${new Intl.NumberFormat('fr-TN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(valeur)} %`;
}

/** Badge coloré sur un taux : lisible en un coup d'œil dans un tableau long. */
function BadgeTaux({ taux }: { taux: number }) {
  const variante =
    taux >= 90 ? 'success' : taux >= 70 ? 'warning' : taux < 0 ? 'secondary' : 'danger';
  return <Badge variant={variante}>{Pourcent(taux)}</Badge>;
}

/* ------------------------------------------------------------------ */
/* Colis                                                               */
/* ------------------------------------------------------------------ */

export function VueColis({ rapport }: { rapport: RapportColis }) {
  const { totaux, taux } = rapport;
  const vivant =
    totaux.crees > 0 ||
    totaux.livres > 0 ||
    totaux.echecs > 0 ||
    totaux.retournes > 0 ||
    totaux.reportes > 0;

  return (
    <div className="space-y-5">
      <Portee entete={rapport} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tuile libelle="Colis créés" valeur={String(totaux.crees)} />
        <Tuile libelle="Livrés" valeur={String(totaux.livres)} accent="bon" />
        <Tuile
          libelle="Taux de livraison"
          valeur={Pourcent(taux.livraison)}
          accent={taux.livraison >= 90 ? 'bon' : 'alerte'}
        />
        <Tuile
          libelle="Incidents"
          valeur={String(totaux.echecs + totaux.retournes)}
          detail={`${totaux.echecs} échecs · ${totaux.retournes} retournés`}
          accent={totaux.echecs + totaux.retournes > 0 ? 'alerte' : 'neutre'}
        />
        <Tuile libelle="En cours" valeur={String(totaux.enCours)} detail="non soldés à la fin de la période" />
      </div>

      {!vivant ? (
        aucunResultat('colis')
      ) : (
        <>
          <Card title="Flux quotidien" subtitle="Ce qui entre, ce qui sort, ce qui coince">
            <GraphiqueFlux data={rapport.parJour} />
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Card
              title="Motifs de non-livraison"
              subtitle="Ce qui empêche la livraison, du plus fréquent au plus rare"
            >
              {rapport.parMotifIncident.length === 0 ? (
                <p className="py-10 text-center text-xs text-slate-500">
                  Aucun incident sur la période. Le motif le plus fréquent n'existe pas encore.
                </p>
              ) : (
                <GraphiqueMotifs data={rapport.parMotifIncident} nomSerie="Colis concernés" />
              )}
            </Card>

            <Card title="Répartition par statut" subtitle="État des colis à la fin de la période">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Statut</Th>
                    <Th align="right">Colis</Th>
                    <Th align="right">Part</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rapport.parStatut.map((ligne) => (
                    <Tr key={ligne.statut}>
                      <Td>{ligne.libelle}</Td>
                      <Td align="right" className="font-mono">
                        {ligne.count}
                      </Td>
                      <Td align="right" className="text-slate-500">
                        {totaux.crees > 0 ? Pourcent((ligne.count / totaux.crees) * 100) : '—'}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
          </div>

          <Card title="Détail jour par jour" subtitle="Le graphique donne la forme, le tableau les chiffres exacts">
            <Table>
              <Thead>
                <Tr>
                  <Th>Jour</Th>
                  <Th align="right">Créés</Th>
                  <Th align="right">Livrés</Th>
                  <Th align="right">Incidents</Th>
                  <Th align="right">Solde du jour</Th>
                </Tr>
              </Thead>
              <Tbody>
                {rapport.parJour.map((jour) => (
                  <Tr key={jour.jour}>
                    <Td>{jour.libelle}</Td>
                    <Td align="right" className="font-mono">
                      {jour.crees}
                    </Td>
                    <Td align="right" className="font-mono text-emerald-700">
                      {jour.livres}
                    </Td>
                    <Td align="right" className="font-mono text-red-600">
                      {jour.incidents}
                    </Td>
                    <Td
                      align="right"
                      className={`font-mono font-medium ${
                        jour.livres - jour.crees >= 0 ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {jour.livres - jour.crees > 0 ? '+' : ''}
                      {jour.livres - jour.crees}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Expéditeurs                                                         */
/* ------------------------------------------------------------------ */

export function VueExpediteurs({ rapport }: { rapport: RapportExpediteurs }) {
  const { totaux } = rapport;
  const sansDonnees = rapport.expediteurs.length === 0;

  return (
    <div className="space-y-5">
      <Portee entete={rapport} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tuile libelle="Expéditeurs actifs" valeur={String(rapport.expediteurs.length)} />
        <Tuile libelle="Colis confiés" valeur={String(totaux.colis)} />
        <Tuile
          libelle="Montant confié"
          valeur={formatMoney(totaux.montantConfie)}
          detail={`${formatMoney(totaux.montantDu)} attendus au scan`}
        />
        <Tuile
          libelle="Montant encaissé"
          valeur={formatMoney(totaux.montantEncaisse)}
          detail={`${formatMoney(totaux.nonEncaisse)} non encaissés`}
          accent={Number(totaux.nonEncaisse) > 0 ? 'alerte' : 'bon'}
        />
      </div>

      {sansDonnees ? (
        aucunResultat('colis expédiés')
      ) : (
        <>
          <Card
            title="Taux de réussite par expéditeur"
            subtitle="En dessous de 70 %, l'expéditeur est à revoir — la barre passe au rouge"
          >
            <GraphiqueTaux
              data={[...rapport.expediteurs]
                .sort((a, b) => a.tauxReussite - b.tauxReussite)
                .map((ligne) => ({ nom: ligne.nom, taux: ligne.tauxReussite }))}
            />
          </Card>

          <Card title="Détail par expéditeur" subtitle="Volumes et montants, dans l'ordre du tableau">
            <Table>
              <Thead>
                <Tr>
                  <Th>Code</Th>
                  <Th>Expéditeur</Th>
                  <Th align="right">Colis</Th>
                  <Th align="right">Livrés</Th>
                  <Th align="right">Incidents</Th>
                  <Th align="right">Réussite</Th>
                  <Th align="right">Dû</Th>
                  <Th align="right">Encaissé</Th>
                  <Th align="right">Non encaissé</Th>
                </Tr>
              </Thead>
              <Tbody>
                {rapport.expediteurs.map((ligne) => (
                  <Tr key={ligne.id}>
                    <Td className="font-mono text-xs">{ligne.code}</Td>
                    <Td className="font-medium">{ligne.nom}</Td>
                    <Td align="right" className="font-mono">
                      {ligne.colis}
                    </Td>
                    <Td align="right" className="font-mono text-emerald-700">
                      {ligne.livres}
                    </Td>
                    <Td align="right" className="font-mono text-red-600">
                      {ligne.incidents}
                    </Td>
                    <Td align="right">
                      <BadgeTaux taux={ligne.tauxReussite} />
                    </Td>
                    <Td align="right" className="font-mono text-xs">
                      {formatMoney(ligne.montantDu)}
                    </Td>
                    <Td align="right" className="font-mono text-xs text-emerald-700">
                      {formatMoney(ligne.montantEncaisse)}
                    </Td>
                    <Td
                      align="right"
                      className={`font-mono text-xs ${
                        Number(ligne.nonEncaisse) > 0 ? 'text-red-600 font-medium' : 'text-slate-500'
                      }`}
                    >
                      {formatMoney(ligne.nonEncaisse)}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Card>

          <Card
            title="Concentration de l'activité"
            subtitle="Premier, deuxième, troisième — et la part que le reste représente"
          >
            <div className="space-y-3">
              {rapport.concentration.map((ligne, index) => {
                const part =
                  Number(totaux.montantConfie) > 0
                    ? (Number(ligne.montantConfie) / Number(totaux.montantConfie)) * 100
                    : 0;
                return (
                  <div key={ligne.nom}>
                    <div className="flex items-baseline justify-between text-xs mb-1">
                      <span className="font-medium text-slate-700">
                        {index + 1}. {ligne.nom}
                      </span>
                      <span className="font-mono text-slate-500">
                        {ligne.colis} colis · {formatMoney(ligne.montantConfie)} · {Pourcent(part)}
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-800 rounded-full"
                        style={{ width: `${Math.min(100, part)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Livreurs                                                            */
/* ------------------------------------------------------------------ */

export function VueLivreurs({ rapport }: { rapport: RapportLivreurs }) {
  const { totaux } = rapport;
  const sansDonnees = rapport.livreurs.length === 0;

  return (
    <div className="space-y-5">
      <Portee entete={rapport} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tuile libelle="Livreurs actifs" valeur={String(totaux.livreurs)} />
        <Tuile libelle="Colis affectés" valeur={String(totaux.affectes)} />
        <Tuile
          libelle="Livrés"
          valeur={String(totaux.livres)}
          detail={`${totaux.echecs} échecs · ${totaux.retournes} retournés`}
          accent={totaux.livres > 0 ? 'bon' : 'neutre'}
        />
        <Tuile
          libelle="Montant encaissé"
          valeur={formatMoney(totaux.montantEncaisse)}
          detail={`${totaux.enCours} colis encore en cours`}
        />
      </div>

      {/* Le solde d'un livreur est son débit d'espèces moins ce qu'il a
          annoncé rapporter. Tant que le cash n'est pas pointé, c'est une
          déclaration : le rapport la nomme comme telle et ne la présente pas
          comme une perte constatée. */}
      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-900 leading-relaxed">
          <span className="font-semibold">Solde espèces et déficit sont des déclarations.</span> Ce
          sont les montants que le livreur a saisis en fin de tournée, avant le pointage de la
          caisse. Un écart entre le déclaré et le pointé apparaît sur l'écran de paiements, pas ici.
        </p>
      </div>

      {sansDonnees ? (
        aucunResultat('colis affectés')
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Card
              title="Taux de réussite par livreur"
              subtitle="Le classement remonte les moins bons en premier : c'est la liste d'accompagnement"
            >
              <GraphiqueTaux
                data={[...rapport.livreurs]
                  .sort((a, b) => a.tauxReussite - b.tauxReussite)
                  .map((ligne) => ({ nom: ligne.nom, taux: ligne.tauxReussite }))}
              />
            </Card>

            <Card title="Motifs d'échec" subtitle="Ce qui fait échouer les tournées">
              {rapport.parMotifEchec.length === 0 ? (
                <p className="py-10 text-center text-xs text-slate-500">
                  Aucun échec de livraison sur la période.
                </p>
              ) : (
                <GraphiqueMotifs data={rapport.parMotifEchec} nomSerie="Tentatives" />
              )}
            </Card>
          </div>

          <Card title="Détail par livreur" subtitle="Tournée, issue, caisse déclarée">
            <Table>
              <Thead>
                <Tr>
                  <Th>Code</Th>
                  <Th>Livreur</Th>
                  <Th>Véhicule</Th>
                  <Th align="right">Affectés</Th>
                  <Th align="right">Livrés</Th>
                  <Th align="right">Échecs</Th>
                  <Th align="right">Retour.</Th>
                  <Th align="right">En cours</Th>
                  <Th align="right">Réussite</Th>
                  <Th align="right">Encaissé</Th>
                  <Th align="right">Solde déclaré</Th>
                  <Th align="right">Dernier tour</Th>
                </Tr>
              </Thead>
              <Tbody>
                {rapport.livreurs.map((ligne) => (
                  <Tr key={ligne.id}>
                    <Td className="font-mono text-xs">{ligne.code}</Td>
                    <Td className="font-medium">{ligne.nom}</Td>
                    <Td className="text-xs text-slate-500">{ligne.vehicule || '—'}</Td>
                    <Td align="right" className="font-mono">
                      {ligne.affectes}
                    </Td>
                    <Td align="right" className="font-mono text-emerald-700">
                      {ligne.livres}
                    </Td>
                    <Td align="right" className="font-mono text-red-600">
                      {ligne.echecs}
                    </Td>
                    <Td align="right" className="font-mono text-slate-600">
                      {ligne.retournes}
                    </Td>
                    <Td align="right" className="font-mono text-slate-500">
                      {ligne.enCours}
                    </Td>
                    <Td align="right">
                      <BadgeTaux taux={ligne.tauxReussite} />
                    </Td>
                    <Td align="right" className="font-mono text-xs text-emerald-700">
                      {formatMoney(ligne.montantEncaisse)}
                    </Td>
                    <Td align="right" className="font-mono text-xs text-slate-600">
                      {formatMoney(ligne.soldeEspeces)}
                      {/* Le déficit n'est pas le solde : c'est un manque déclaré par le
                          livreur sur la tournée. Les deux tiennent dans la même case, mais
                          seul le déficit porte l'alerte. */}
                      {Number(ligne.deficitDeclare) > 0 && (
                        <span className="block text-[11px] text-red-600 font-semibold">
                          manque de {formatMoney(ligne.deficitDeclare)}
                        </span>
                      )}
                    </Td>
                    <Td align="right" className="text-xs text-slate-500">
                      {ligne.dernierTour
                        ? formatDate(ligne.dernierTour)
                        : '—'}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Finance                                                             */
/* ------------------------------------------------------------------ */

export function VueFinance({ rapport }: { rapport: RapportFinance }) {
  const { totaux } = rapport;

  return (
    <div className="space-y-5">
      <Portee entete={rapport} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tuile libelle="Montant attendu" valeur={formatMoney(totaux.attendu)} />
        <Tuile
          libelle="Montant encaissé"
          valeur={formatMoney(totaux.encaisse)}
          detail={`${formatMoney(totaux.valide)} validés · ${formatMoney(totaux.enAttente)} en attente`}
          accent="bon"
        />
        <Tuile
          libelle="Montant manquant"
          valeur={formatMoney(totaux.manquant)}
          accent={Number(totaux.manquant) > 0 ? 'alerte' : 'neutre'}
        />
        <Tuile
          libelle="Taux de recouvrement"
          valeur={Pourcent(totaux.tauxRecouvrement)}
          accent={totaux.tauxRecouvrement >= 95 ? 'bon' : 'alerte'}
        />
      </div>

      {Number(totaux.ecart) !== 0 && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-900 leading-relaxed">
            <span className="font-semibold">
              {totaux.nbEcarts} écart{totaux.nbEcarts > 1 ? 's' : ''} de caisse, pour{' '}
              {formatMoney(totaux.ecart)} au total.
            </span>{' '}
            Chaque ligne du tableau ci-dessous est un tour où le livreur a déclaré une somme et où
            le pointage a retenu autre chose. Le rapprochement se fait sur l'écran de paiements.
          </p>
        </div>
      )}

      <Card title="Attendu contre encaissé" subtitle="L'écart se lit directement, sans calcul">
        <GraphiqueCaisse
          data={rapport.parJour.map((jour) => ({
            libelle: jour.libelle,
            attendu: Number(jour.attendu),
            encaisse: Number(jour.encaisse),
          }))}
        />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card title="Par statut de paiement" subtitle="Où en est chaque somme collectée">
          <Table>
            <Thead>
              <Tr>
                <Th>Statut</Th>
                <Th align="right">Nb</Th>
                <Th align="right">Attendu</Th>
                <Th align="right">Encaissé</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rapport.parStatut.map((ligne) => (
                <Tr key={ligne.statut}>
                  <Td>{ligne.libelle}</Td>
                  <Td align="right" className="font-mono">
                    {ligne.count}
                  </Td>
                  <Td align="right" className="font-mono text-xs">
                    {formatMoney(ligne.attendu)}
                  </Td>
                  <Td align="right" className="font-mono text-xs text-emerald-700">
                    {formatMoney(ligne.encaisse)}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>

        <Card title="Par moyen de paiement" subtitle="Espèces, chèque, virement : où passe la caisse">
          <Table>
            <Thead>
              <Tr>
                <Th>Moyen</Th>
                <Th align="right">Nb</Th>
                <Th align="right">Attendu</Th>
                <Th align="right">Encaissé</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rapport.parMoyen.map((ligne) => (
                <Tr key={ligne.moyen}>
                  <Td>{ligne.libelle}</Td>
                  <Td align="right" className="font-mono">
                    {ligne.count}
                  </Td>
                  <Td align="right" className="font-mono text-xs">
                    {formatMoney(ligne.attendu)}
                  </Td>
                  <Td align="right" className="font-mono text-xs text-emerald-700">
                    {formatMoney(ligne.encaisse)}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      </div>

      <Card
        title="Écarts de caisse"
        subtitle="Les tournées où le montant déclaré et le montant pointé divergent — à traiter en priorité"
      >
        {rapport.ecarts.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-500">
            Aucun écart : chaque tour déclaré correspond au cash pointé.
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Tour</Th>
                <Th>Livreur</Th>
                <Th>Expéditeur</Th>
                <Th align="right">Attendu</Th>
                <Th align="right">Encaissé</Th>
                <Th align="right">Écart</Th>
                <Th>Statut</Th>
                <Th>Motif</Th>
                <Th>Collecté le</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rapport.ecarts.map((ligne) => (
                <Tr key={ligne.id}>
                  <Td className="font-mono text-xs">{ligne.numero}</Td>
                  <Td className="font-medium">{ligne.livreur}</Td>
                  <Td className="text-xs text-slate-600">{ligne.expediteur}</Td>
                  <Td align="right" className="font-mono text-xs">
                    {formatMoney(ligne.attendu)}
                  </Td>
                  <Td align="right" className="font-mono text-xs text-emerald-700">
                    {formatMoney(ligne.encaisse)}
                  </Td>
                  <Td
                    align="right"
                    className={`font-mono text-xs font-bold ${
                      Number(ligne.ecart) < 0 ? 'text-red-600' : 'text-amber-600'
                    }`}
                  >
                    {formatMoney(ligne.ecart)}
                  </Td>
                  <Td>
                    <Badge variant={ligne.statut === 'REJETE' ? 'danger' : 'warning'}>
                      {ligne.statut}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-slate-600">{ligne.motif ?? '—'}</Td>
                  <Td className="text-xs text-slate-500">
                    {formatDate(ligne.collecteLe)}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dépôts                                                              */
/* ------------------------------------------------------------------ */

export function VueDepots({ rapport }: { rapport: RapportDepots }) {
  const { totaux } = rapport;

  return (
    <div className="space-y-5">
      <Portee entete={rapport} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tuile libelle="Dépôts actifs" valeur={String(totaux.depots)} />
        <Tuile libelle="Colis reçus" valeur={String(totaux.recus)} />
        <Tuile
          libelle="Colis livrés"
          valeur={String(totaux.livres)}
          detail={`${totaux.retournes} retournés`}
          accent="bon"
        />
        <Tuile libelle="Stock actuel" valeur={String(totaux.stockActuel)} detail="colis présents en dépôt" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card title="Reçus et livrés par dépôt" subtitle="Quel dépôt fait tourner le plus de colis">
          <GraphiqueDepots
            data={rapport.depots.map((ligne) => ({
              nom: ligne.nom,
              recus: ligne.recus,
              livres: ligne.livres,
            }))}
          />
        </Card>

        <Card title="Stock par dépôt" subtitle="Où dort le stock — le graphique à lire avant de déplacer un transfert">
          <GraphiqueStock data={rapport.depots.map((ligne) => ({ nom: ligne.nom, stock: ligne.stock }))} />
        </Card>
      </div>

      <Card title="Détail par dépôt" subtitle="Activité et état du stock">
        <Table>
          <Thead>
            <Tr>
              <Th>Code</Th>
              <Th>Dépôt</Th>
              <Th>Ville</Th>
              <Th align="right">Reçus</Th>
              <Th align="right">Livrés</Th>
              <Th align="right">Retournés</Th>
              <Th align="right">Stock</Th>
              <Th align="right">En transfert</Th>
              <Th align="right">En transit</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rapport.depots.map((ligne) => (
              <Tr key={ligne.id}>
                <Td className="font-mono text-xs">{ligne.code}</Td>
                <Td className="font-medium">{ligne.nom}</Td>
                <Td className="text-xs text-slate-500">{ligne.ville || '—'}</Td>
                <Td align="right" className="font-mono">
                  {ligne.recus}
                </Td>
                <Td align="right" className="font-mono text-emerald-700">
                  {ligne.livres}
                </Td>
                <Td align="right" className="font-mono text-slate-600">
                  {ligne.retournes}
                </Td>
                <Td align="right" className="font-mono font-medium">
                  {ligne.stock}
                </Td>
                <Td align="right" className="font-mono text-slate-500">
                  {ligne.enTransfert}
                </Td>
                <Td align="right" className="font-mono text-slate-500">
                  {ligne.enTransit}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>

      <Card
        title="Transferts inter-dépôts"
        subtitle="Les lignes en écart sont le dossier à relancer : un colis annoncé et jamais reçu ne rattrape pas tout seul"
      >
        {rapport.transferts.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-500">
            Aucun transfert entre dépôts sur la période.
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Numéro</Th>
                <Th>Origine</Th>
                <Th>Destination</Th>
                <Th align="right">Attendus</Th>
                <Th align="right">Reçus</Th>
                <Th align="right">Écart</Th>
                <Th>Statut</Th>
                <Th>Expédié le</Th>
                <Th>Reçu le</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rapport.transferts.map((ligne) => (
                <Tr key={ligne.id}>
                  <Td className="font-mono text-xs">{ligne.numero}</Td>
                  <Td className="text-xs">{ligne.source}</Td>
                  <Td className="text-xs">{ligne.destination}</Td>
                  <Td align="right" className="font-mono">
                    {ligne.colisAttendus}
                  </Td>
                  <Td align="right" className="font-mono">
                    {ligne.colisRecus}
                  </Td>
                  <Td
                    align="right"
                    className={`font-mono font-bold ${ligne.ecart !== 0 ? 'text-red-600' : 'text-slate-500'}`}
                  >
                    {ligne.ecart > 0 ? `+${ligne.ecart}` : ligne.ecart}
                  </Td>
                  <Td>
                    <Badge variant={ligne.ecart !== 0 ? 'danger' : 'secondary'}>{ligne.libelleStatut}</Badge>
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {formatDate(ligne.expedieLe)}
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {formatDate(ligne.recuLe)}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      {rapport.stockImmobile.length > 0 && (
        <Card
          title="Stock immobile"
          subtitle="Colis présents depuis plus de 7 jours — ni sortis, ni transférés"
        >
          <Table>
            <Thead>
              <Tr>
                <Th>Dépôt</Th>
                <Th align="right">Colis</Th>
                <Th align="right">Plus ancien</Th>
                <Th align="right">Montant</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rapport.stockImmobile.map((ligne) => (
                <Tr key={ligne.depot}>
                  <Td className="font-medium">{ligne.depot}</Td>
                  <Td align="right" className="font-mono">
                    {ligne.colis}
                  </Td>
                  <Td
                    align="right"
                    className={`font-mono ${ligne.plusAncienJours > 30 ? 'text-red-600 font-medium' : ''}`}
                  >
                    {ligne.plusAncienJours} j
                  </Td>
                  <Td align="right" className="font-mono text-xs">
                    {formatMoney(ligne.montant)}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}