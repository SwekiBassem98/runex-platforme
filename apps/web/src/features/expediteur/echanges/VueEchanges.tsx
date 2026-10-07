'use client';

/**
 * Échanges.
 *
 * `GET /colis?type=EXCHANGE` renvoie les colis sur lesquels un échange a été
 * enregistré. `PackageDto.exchange` décrit alors les deux faces de l'opération :
 * l'article repris chez le client et l'article de remplacement, plus l'écart
 * financier — positif quand le client doit payer la différence, négatif quand
 * il y a droit à remboursement.
 *
 * L'échange n'est pas saisissable ici. L'API ne l'accorde qu'à un livreur, en
 * cours de tournée ; l'expéditeur enregistre l'intention dans le type du colis
 * et la décision se lit dans le journal d'audit de la fiche.
 *
 * ## Langue
 *
 * Cet écran ne contient aucun mot : les intitulés viennent du dictionnaire et
 * les deux formateurs — date et montant — du contexte de langue, pour qu'un
 * écart financier soit écrit dans la langue de l'écran qui le montre.
 */

import React from 'react';
import { PackageType } from '@logixpress/types';
import { useI18n } from '@/i18n';
import { VueColisCategorie } from '@/features/expediteur/colis/VueColisCategorie';

export function VueEchanges() {
  const { t, formatDateTime, formatTND } = useI18n();

  return (
    <VueColisCategorie
      type={PackageType.EXCHANGE}
      titre={t('echanges.titre')}
      sousTitre={t('echanges.sous-titre')}
      videTitre={t('echanges.aucun')}
      videDescription={t('echanges.aucunDescription')}
      rendu={(colis) => {
        const echange = colis.exchange;
        if (!echange) {
          return (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
              {t('echanges.enCours')}
            </p>
          );
        }

        return (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs border-t border-slate-100 pt-3">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                {t('echanges.articleRepris')}
              </dt>
              {/* Code-barres : une suite de chiffres et de lettres se lit de
                  gauche à droite dans les deux langues. */}
              <dd className="text-slate-800 font-mono">
                <span dir="ltr">{echange.oldPackageBarcode}</span>
              </dd>
              <dd className="text-slate-600">{echange.returnedItemSummary}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                {t('echanges.articleRemplace')}
              </dt>
              <dd className="text-slate-800 font-mono">
                <span dir="ltr">{echange.newPackageBarcode}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                {t('echanges.ecart')}
              </dt>
              <dd
                className={`font-mono font-semibold ${
                  (echange.financialDifference ?? 0) > 0 ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {echange.financialDifference
                  ? t(echange.financialDifference > 0 ? 'echanges.aPayer' : 'echanges.aRembourser', {
                      montant: formatTND(Math.abs(echange.financialDifference)),
                    })
                  : t('echanges.aucunEcart')}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                {t('echanges.realiseLe')}
              </dt>
              <dd className="text-slate-700">{formatDateTime(echange.createdAt)}</dd>
              {echange.driverName && (
                <dd className="text-slate-500">{t('echanges.par', { nom: echange.driverName })}</dd>
              )}
            </div>
          </dl>
        );
      }}
    />
  );
}
