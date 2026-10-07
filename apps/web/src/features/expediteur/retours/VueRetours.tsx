'use client';

/**
 * Bons de retour.
 *
 * Deux ensembles se confondent souvent, et l'écran les sépare parce qu'ils ne
 * dépendent pas des mêmes données :
 *
 * - les colis dont le type est `RETURN`, annoncés comme retours dès la remise à
 *   RUNEX — c'est ce que `GET /colis?type=RETURN` sait compter ;
 * - les colis de tout type que le livreur a ramenés au dépôt : refus du
 *   destinataire, échec de livraison, livraison partielle.
 *
 * Le second ensemble n'a pas de filtre. L'API n'accepte qu'un statut par
 * requête et refuse les plages : chaque statut de retour est donc interrogé
 * séparément, et les réponses fusionnées. Le total affiché est la somme des
 * totaux annoncés par le serveur — jamais la longueur de la page, qui ferait
 * lire « 20 retours » là où il y en a cent.
 *
 * `PackageDto.returns` porte l'historique : un même colis peut revenir plusieurs
 * fois, chaque passage avec son numéro, son motif et le montant ramené.
 *
 * ## Langue
 *
 * La distinction ci-dessus est celle du domaine, pas celle du vocabulaire : le
 * premier ensemble se reconnaît au type, le second à un statut. Elle reste donc
 * écrite en statuts, jamais en mots.
 *
 * La mention des statuts retenus est la seule phrase qui devait être assemblée
 * à la main. Elle ne l'est plus : `retours.statutsRetenus` reçoit la liste, et
 * chaque statut y entre déjà traduit par le vocabulaire — une liste en français
 * dans un écran arabe se lirait comme une faute de l'API.
 *
 * Les motifs, eux, viennent du serveur : ils sont ce que le livreur a écrit ou
 * le code métier qu'il a choisi. Ce n'est pas un mot affiché par l'écran, donc
 * ce n'est pas un mot que l'écran traduit — seul le mot qui les introduit l'est.
 */

import React from 'react';
import Link from 'next/link';
import { PackageType, type PackageDto } from '@logixpress/types';
import { useI18n } from '@/i18n';
import { VueColisCategorie } from '@/features/expediteur/colis/VueColisCategorie';
import { STATUTS_RETOUR, useVocabulaire } from '@/features/expediteur/lib/libelles';

/**
 * Les deux ensembles, décrits par la clé de leur libellé et de leur aide.
 *
 * Les clés sont des littéraux et non des mots : `t` refuse une clé construite,
 * et une clé fausse doit apparaître à la compilation.
 */
const ENSEMBLES = [
  {
    id: 'revenus',
    libelle: 'retours.ensemble.revenus',
    aide: 'retours.ensemble.revenusAide',
  },
  {
    id: 'declares',
    libelle: 'retours.ensemble.declares',
    aide: 'retours.ensemble.declaresAide',
  },
] as const;

type EnsembleId = (typeof ENSEMBLES)[number]['id'];

/** Historique de retour d'un colis, rendu sous son en-tête. */
function Historique({ colis }: { colis: PackageDto }) {
  const { t, formatDateTime, formatTND } = useI18n();

  const retours = colis.returns ?? [];
  if (retours.length === 0) {
    return (
      <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
        {t('retours.aucunPassage')}
      </p>
    );
  }

  return (
    <ul className="border-t border-slate-100 pt-2 space-y-1.5">
      {retours.map((retour) => (
        <li key={retour.id} className="text-xs">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            {/* Numéro de passage : un identifiant, pas un mot. */}
            <span className="font-mono text-[11px] font-semibold text-slate-700" dir="ltr">
              {retour.returnNumber}
            </span>
            <span className="text-[11px] text-slate-400 font-mono">
              {formatDateTime(retour.createdAt)}
            </span>
          </div>
          {/* Le motif est ce que le livreur a décrit : il reste tel quel. */}
          <p className="text-slate-600">{t('retours.motif', { motif: retour.reason })}</p>
          {retour.returnedItems && (
            <p className="text-slate-500">
              {retour.returnedItems}
              {retour.returnedQuantity != null &&
                ` — ${t('retours.pieces', { n: retour.returnedQuantity })}`}
            </p>
          )}
          <p className="text-slate-500 font-mono">
            {retour.amount != null
              ? t('retours.montantRamene', { montant: formatTND(retour.amount) })
              : t('retours.montantInconnu')}
            {retour.returnDepositName ? ` · ${retour.returnDepositName}` : ''}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function VueRetours() {
  const { t } = useI18n();
  const voc = useVocabulaire();

  const [ensemble, setEnsemble] = React.useState<EnsembleId>('revenus');
  const declares = ensemble === 'declares';
  const courant = ENSEMBLES.find((e) => e.id === ensemble) ?? ENSEMBLES[0];

  return (
    <div className="space-y-4">
      <nav aria-label={t('retours.titre')} className="flex gap-2 overflow-x-auto pb-1">
        {ENSEMBLES.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setEnsemble(e.id)}
            aria-current={ensemble === e.id ? 'page' : undefined}
            className={`shrink-0 px-3.5 py-2 rounded-md text-xs font-semibold transition cursor-pointer ${
              ensemble === e.id
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t(e.libelle)}
          </button>
        ))}
      </nav>

      <p className="text-[11px] text-slate-500 -mt-2">
        {t(courant.aide)} —{' '}
        {declares
          ? t('retours.typeRetour')
          : t('retours.statutsRetenus', {
              // Traduits ici, jamais en français : la liste est affichée telle
              // qu'elle l'est dans le reste de l'écran.
              statuts: STATUTS_RETOUR.map((s) => voc.statutColis(s).label).join(', '),
            })}
      </p>

      {declares ? (
        <VueColisCategorie
          key="declarés"
          type={PackageType.RETURN}
          titre={t('retours.ensemble.declares')}
          sousTitre={t('retours.sous-titre.declares')}
          videTitre={t('retours.aucunTitre.declares')}
          videDescription={t('retours.aucunDescription.declares')}
          rendu={(colis) => <Historique colis={colis} />}
        />
      ) : (
        <VueColisCategorie
          key="revenus"
          statuts={STATUTS_RETOUR}
          titre={t('retours.ensemble.revenus')}
          sousTitre={t('retours.sous-titre.revenus')}
          videTitre={t('retours.aucunTitre.revenus')}
          videDescription={t('retours.aucunDescription.revenus')}
          rendu={(colis) => <Historique colis={colis} />}
        />
      )}

      <p className="text-[11px] text-slate-400">
        {t('retours.aideFinal')}{' '}
        <Link href="/expediteur/suivi" className="text-red-600 hover:text-red-700 font-medium">
          {t('retours.suivre')}
        </Link>
      </p>
    </div>
  );
}
