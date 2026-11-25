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
import { listerBordereaux, lireARegler, type ARegler } from '@/features/expediteur/lib/client';
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

  // Prochain bordereau (estimé) : ce que l'exploitation voit « À régler ».
  const [aRegler, setARegler] = React.useState<ARegler | null>(null);

  /*
   * Lecture des bordereaux, puis relecture discrète : quand l'exploitation
   * crée ou paie un bordereau, la page de l'expéditeur suit sans qu'il ait à
   * la recharger (toutes les 30 s onglet visible, et au retour sur l'onglet).
   */
  const charger = React.useCallback(async (discret: boolean) => {
    if (!discret) {
      setChargement(true);
      setErreur(null);
    }
    const [liste, prochain] = await Promise.allSettled([listerBordereaux(), lireARegler()]);
    if (liste.status === 'fulfilled') {
      setBordereaux(liste.value);
      setErreur(null);
    } else if (!discret) {
      setBordereaux([]);
      setErreur(liste.reason instanceof Error ? liste.reason.message : t('bordereaux.erreur'));
    }
    if (prochain.status === 'fulfilled') setARegler(prochain.value);
    if (!discret) setChargement(false);
    // `t` n'est pas une dépendance : rejouer la requête au changement de langue
    // ferait clignoter une liste pourtant déjà chargée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    void charger(false);
    const minuteur = window.setInterval(() => {
      if (document.visibilityState === 'visible') void charger(true);
    }, 30_000);
    const auRetour = () => {
      if (document.visibilityState === 'visible') void charger(true);
    };
    document.addEventListener('visibilitychange', auRetour);
    window.addEventListener('focus', auRetour);
    return () => {
      window.clearInterval(minuteur);
      document.removeEventListener('visibilitychange', auRetour);
      window.removeEventListener('focus', auRetour);
    };
  }, [charger]);

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

  /*
   * Mêmes montants que l'exploitation : « À percevoir » = bordereaux prêts, pas
   * encore payés (« À payer » chez l'exploitation) ; « Déjà réglé » = payés.
   * Un bordereau annulé ne compte nulle part.
   */
  const totaux = React.useMemo(() => {
    const actifs = visibles.filter((b) => b.status !== 'ANNULE');
    const aPayer = actifs.filter((b) => b.status !== 'PAYE');
    const payes = actifs.filter((b) => b.status === 'PAYE');
    const somme = (l: PaymentVoucherDto[]) => l.reduce((s, b) => s + Number(b.netPayable ?? 0), 0);
    return {
      aPercevoir: somme(aPayer),
      nbAPercevoir: aPayer.length,
      regle: somme(payes),
      nbRegle: payes.length,
    };
  }, [visibles]);

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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="bordereaux-recap">
          <Recapitulatif
            libelle={t('bordereaux.recap.aPercevoir')}
            valeur={formatTND(totaux.aPercevoir)}
            aide={t('bordereaux.recap.aPercevoirAide', { n: totaux.nbAPercevoir })}
            testId="recap-a-percevoir"
          />
          <Recapitulatif
            libelle={t('bordereaux.recap.regle')}
            valeur={formatTND(totaux.regle)}
            aide={t('bordereaux.recap.regleAide', { n: totaux.nbRegle })}
            testId="recap-regle"
          />
          <Recapitulatif
            libelle={t('bordereaux.recap.prochain')}
            valeur={formatTND(aRegler?.netEstime ?? 0)}
            aide={t('bordereaux.recap.prochainAide', { livres: aRegler?.livres ?? 0, rendus: aRegler?.retournes ?? 0 })}
            testId="recap-prochain"
          />
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

                {b.withdrawalCode && (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2"
                    data-testid="code-retrait"
                  >
                    <span className="text-xs text-emerald-900">{t('bordereaux.code.aide')}</span>
                    <span className="font-mono text-lg font-bold tracking-[0.3em] text-emerald-800" dir="ltr">
                      {b.withdrawalCode}
                    </span>
                  </div>
                )}

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
                  {Number(b.managementFeesTotal ?? 0) > 0 && (
                    <Montant libelle={t('bordereaux.montant.gestion')} valeur={formatTND(b.managementFeesTotal ?? 0)} />
                  )}
                  <Montant
                    libelle={
                      Number(b.withholdingTaxRate ?? 0) > 0
                        ? `${t('bordereaux.montant.retenue')} (${Math.round(Number(b.withholdingTaxRate) * 10000) / 100} %)`
                        : t('bordereaux.montant.retenue')
                    }
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

function Recapitulatif({ libelle, valeur, aide, testId }: { libelle: string; valeur: string; aide?: string; testId?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3" data-testid={testId}>
      <p className="text-[11px] text-slate-500">{libelle}</p>
      <p className="text-lg font-bold text-slate-900 font-mono truncate" dir="ltr">
        {valeur}
      </p>
      {aide && <p className="text-[11px] text-slate-400">{aide}</p>}
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