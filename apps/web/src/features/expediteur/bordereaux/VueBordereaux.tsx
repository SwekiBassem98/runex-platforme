'use client';

/**
 * Bordereaux.
 *
 * `GET /payments/vouchers` renvoie les bordereaux de l'entreprise : ce que les
 * livreurs ont encaissé, ce qui revient en species, les frais, la retenue à la
 * source, et le net payable. L'API plafonne la réponse à 200 bordereaux sans
 * message de suite : au-delà de deux cents, l'écran affiche ce qu'il a et le
 * dit, plutôt que de laisser croire que la liste est complète.
 *
 * Les montants sont ceux du serveur. Aucun n'est recalculé ici : la retenue à la
 * source et les frais sont des règles de gestion, et les refaire en JavaScript
 * afficherait des chiffres différents de ceux qui seront payés.
 *
 * ## Langue
 *
 * Aucun mot n'est écrit ici : les titres, les colonnes, les filtres et les états
 * vides sont lus dans le dictionnaire, et les statuts de bordereau passent par
 * `useVocabulaire`, qui va chercher le mot dans la langue courante. Les
 * formateurs — dates, montants — viennent du contexte de langue : la même
 * montant ne s'écrit pas de la même façon en français et en arabe.
 */

import React from 'react';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { PaymentVoucherStatus, type PaymentVoucherDto } from '@logixpress/types';
import {
  Badge,
  ChargementEnCours,
  EmptyState,
  ErrorBanner,
  FilterBar,
  FilterSelect,
  SearchInput,
  SkeletonTable,
} from '@logixpress/ui';
import { listerBordereaux } from '@/features/expediteur/lib/client';
import { VARIANTE_STATUT_BORDEREAU, useVocabulaire } from '@/features/expediteur/lib/libelles';
import { useI18n } from '@/i18n';

/** Plafond imposé par l'API à la réponse de la liste. */
const PLAFOND = 200;

export function VueBordereaux() {
  const { t, formatDate, formatTND } = useI18n();
  const voc = useVocabulaire();

  const [bordereaux, setBordereaux] = React.useState<PaymentVoucherDto[]>([]);
  const [chargement, setChargement] = React.useState(true);
  const [erreur, setErreur] = React.useState<string | null>(null);

  const [recherche, setRecherche] = React.useState('');
  const [statut, setStatut] = React.useState('ALL');

  React.useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerBordereaux()
      .then((liste) => {
        if (annule) return;
        setBordereaux(liste);
      })
      .catch((err: unknown) => {
        if (annule) return;
        setBordereaux([]);
        setErreur(err instanceof Error ? err.message : t('bordereaux.erreur'));
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
    // `t` n'est pas une dépendance : rejouer la requête au changement de langue
    // ferait clignoter une liste pourtant déjà chargée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Filtres appliqués sur la réponse déjà reçue.
   *
   * `GET /payments/vouchers` n'a aucun paramètre de filtre : le serveur renvoie
   * tout, jusqu'à 200. Filtrer ici n'est pas un pis-aller impossible à corriger
   * plus tard — la liste tient en mémoire, et surtout le filtre est annoncé
   * comme portant sur ce qui est affiché.
   */
  const visibles = React.useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    return bordereaux.filter((b) => {
      if (statut !== 'ALL' && b.status !== statut) return false;
      if (!terme) return true;
      return (
        b.voucherNumber.toLowerCase().includes(terme) ||
        b.shipperName.toLowerCase().includes(terme) ||
        b.paymentMethod.toLowerCase().includes(terme)
      );
    });
  }, [bordereaux, recherche, statut]);

  const totaux = React.useMemo(
    () =>
      visibles.reduce(
        (acc, b) => ({
          livre: acc.livre + b.deliveredCount,
          rendu: acc.rendu + b.returnedCount,
          net: acc.net + Number(b.netPayable ?? 0),
        }),
        { livre: 0, rendu: 0, net: 0 }
      ),
    [visibles]
  );

  const filtresActifs = recherche.trim() !== '' || statut !== 'ALL';

  const reinitialiser = () => {
    setRecherche('');
    setStatut('ALL');
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('bordereaux.titre')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('bordereaux.sous-titre')}</p>
      </div>

      {!chargement && bordereaux.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Recapitulatif libelle={t('bordereaux.recap.livres')} valeur={String(totaux.livre)} />
          <Recapitulatif libelle={t('bordereaux.recap.rendus')} valeur={String(totaux.rendu)} />
          <Recapitulatif libelle={t('bordereaux.recap.net')} valeur={formatTND(totaux.net)} />
        </div>
      )}

      <FilterBar
        hasActiveFilters={filtresActifs}
        onReset={reinitialiser}
        resume={
          filtresActifs
            ? [
                // Le terme est cité tel quel : les guillemets sont lus dans les
                // deux sens, et le champ de recherche porte déjà son libellé.
                recherche.trim() ? `« ${recherche.trim()} »` : null,
                statut !== 'ALL' ? `${t('filtre.statut')} : ${voc.bordereau(statut)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
      >
        <div className="w-full sm:w-64">
          <SearchInput
            libelle={t('bordereaux.recherche')}
            placeholder={t('bordereaux.rechercheAide')}
            value={recherche}
            onChange={setRecherche}
          />
        </div>

        <FilterSelect
          label={t('filtre.statut')}
          selectedValue={statut}
          onChange={setStatut}
          options={[
            { value: 'ALL', label: t('filtre.tousStatuts') },
            ...Object.values(PaymentVoucherStatus).map((s) => ({
              value: s,
              label: voc.bordereau(s),
            })),
          ]}
        />
      </FilterBar>

      {erreur && (
        <ErrorBanner
          message={`${erreur} ${t('bordereaux.erreur')}`}
          onDismiss={() => setErreur(null)}
        />
      )}

      {chargement ? (
        <>
          <ChargementEnCours message={t('bordereaux.chargement')} />
          <SkeletonTable rows={5} cols={5} />
        </>
      ) : bordereaux.length === 0 ? (
        <EmptyState
          title={t('bordereaux.aucun')}
          description={t('bordereaux.aucunDescription')}
          action={
            <Link
              href="/expediteur/colis"
              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-md text-xs font-medium transition"
            >
              {t('colis.liste.titre')}
            </Link>
          }
        />
      ) : visibles.length === 0 ? (
        <EmptyState
          title={t('bordereaux.aucunCorrespond')}
          description={t('bordereaux.aucunCorrespondDescription')}
          action={
            <button
              type="button"
              onClick={reinitialiser}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-md text-xs font-medium transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              {t('commun.reinitialiserFiltres')}
            </button>
          }
        />
      ) : (
        <>
          <ul className="space-y-2">
            {visibles.map((b) => (
              <li key={b.id} className="bg-white border border-slate-200 rounded-lg p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    {/* Numéro de bordereau : donnée, lisible de gauche à droite. */}
                    <p className="font-mono text-sm font-bold text-slate-900" dir="ltr">
                      {b.voucherNumber}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {b.deliveredCount} {t('bordereaux.recap.livres')} · {b.returnedCount}{' '}
                      {t('bordereaux.recap.rendus')} · {b.paymentMethod}
                    </p>
                  </div>
                  <Badge variant={VARIANTE_STATUT_BORDEREAU[b.status] ?? 'default'}>
                    {voc.bordereau(b.status)}
                  </Badge>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs border-t border-slate-100 pt-2">
                  <Montant
                    libelle={t('bordereaux.montant.especes')}
                    valeur={formatTND(b.grossCashCollected)}
                  />
                  <Montant
                    libelle={t('bordereaux.montant.cheques')}
                    valeur={formatTND(b.grossChecksCollected)}
                  />
                  <Montant
                    libelle={t('bordereaux.montant.fraisLivraison')}
                    valeur={formatTND(b.deliveryFeesTotal)}
                  />
                  <Montant
                    libelle={t('bordereaux.montant.fraisRetour')}
                    valeur={formatTND(b.returnFeesTotal)}
                  />
                  <Montant
                    libelle={t('bordereaux.montant.retenue')}
                    valeur={formatTND(b.withholdingTaxTotal)}
                  />
                  <Montant libelle={t('bordereaux.montant.net')} valeur={formatTND(b.netPayable)} fort />
                </dl>

                {/*
                  `GET /payments/vouchers` ne renvoie aucune date de virement
                  prévue : la seule date de règlement disponible est `paidAt`,
                  présente une fois le bordereau décaissé. Avant ce moment, la seule
                  chose que l'on puisse dire est depuis quand il existe.
                */}
                <p className="text-[11px] text-slate-400 font-mono">
                  {b.paidAt
                    ? t('bordereaux.payeLe', { date: formatDate(b.paidAt) })
                    : t('bordereaux.creeLe', { date: formatDate(b.createdAt) })}
                </p>
              </li>
            ))}
          </ul>

          <p className="text-[11px] text-slate-400">
            {bordereaux.length >= PLAFOND
              ? t('bordereaux.plafondAtteint', { n: PLAFOND })
              : t('bordereaux.listeComplete', { n: bordereaux.length })}
          </p>
        </>
      )}
    </div>
  );
}

function Recapitulatif({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
      <p className="text-[11px] text-slate-500">{libelle}</p>
      <p className="text-lg font-bold text-slate-900 font-mono truncate" dir="ltr">
        {valeur}
      </p>
    </div>
  );
}

function Montant({
  libelle,
  valeur,
  fort,
}: {
  libelle: string;
  valeur: string;
  fort?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-400">{libelle}</dt>
      <dd className={`font-mono ${fort ? 'font-bold text-slate-900' : 'text-slate-700'}`} dir="ltr">
        {valeur}
      </dd>
    </div>
  );
}