'use client';

/**
 * « Mon argent » — l'argent de l'expéditeur, dit le plus simplement possible.
 *
 *  1. Une seule grande somme : ce que RUNEX lui doit.
 *  2. Le chemin de l'argent en cinq étapes, de gauche à droite :
 *     chez vos clients → encaissé (vérification) → prochain paiement →
 *     prêt à être payé → déjà payé. Un appui sur une étape montre ses colis.
 *  3. Le calcul du prochain paiement, ligne par ligne (encaissé − frais = net).
 *  4. Colis par colis : prix payé par le client, frais RUNEX, ce qui revient à
 *     l'expéditeur, et où est l'argent en ce moment.
 *
 * Mêmes chiffres que l'exploitation (« À régler », bordereaux) : tout vient de
 * `GET /payments/mon-argent`. La page se relit seule (30 s, retour sur l'onglet).
 */

import React from 'react';
import Link from 'next/link';
import { ArrowRight, Banknote, CheckCircle2, Clock, Search, Truck, Wallet } from 'lucide-react';
import { ErrorBanner, Spinner } from '@logixpress/ui';
import { lireMonArgent, type EtapeArgent, type MonArgent } from '@/features/expediteur/lib/client';
import { useVocabulaire } from '@/features/expediteur/lib/libelles';
import { useI18n, type Cle } from '@/i18n';

const COULEUR: Record<EtapeArgent, string> = {
  EN_LIVRAISON: 'bg-amber-50 text-amber-800 border-amber-200',
  VERIFICATION: 'bg-sky-50 text-sky-800 border-sky-200',
  PROCHAIN: 'bg-violet-50 text-violet-800 border-violet-200',
  A_PAYER: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  PAYE: 'bg-green-100 text-green-900 border-green-300',
  RETOUR: 'bg-rose-50 text-rose-800 border-rose-200',
  AUCUN: 'bg-slate-50 text-slate-500 border-slate-200',
};

export function VueMonArgent() {
  const { t, formatTND, formatDate, formatDateTime } = useI18n();
  const voc = useVocabulaire();
  const [donnees, setDonnees] = React.useState<MonArgent | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [etape, setEtape] = React.useState<EtapeArgent | null>(null);
  const [recherche, setRecherche] = React.useState('');
  const [terme, setTerme] = React.useState('');
  const listeRef = React.useRef<HTMLDivElement>(null);

  // Recherche : on attend que la saisie se calme.
  React.useEffect(() => {
    const id = window.setTimeout(() => setTerme(recherche.trim()), 300);
    return () => window.clearTimeout(id);
  }, [recherche]);

  const charger = React.useCallback(
    async (discret: boolean) => {
      try {
        const d = await lireMonArgent({ etape: etape ?? undefined, search: terme || undefined });
        setDonnees(d);
        setErreur(null);
      } catch (e) {
        if (!discret) setErreur(e instanceof Error ? e.message : t('argent.erreur'));
      }
    },
    // `t` change avec la langue : les données n'ont pas à être relues pour autant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [etape, terme]
  );

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

  const choisir = (e: EtapeArgent | null) => {
    setEtape((x) => (x === e ? null : e));
    window.setTimeout(() => listeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  if (!donnees) {
    return (
      <div className="space-y-4">
        <Entete />
        {erreur ? <ErrorBanner message={erreur} /> : <div className="py-16 flex justify-center"><Spinner /></div>}
      </div>
    );
  }

  const e = donnees.etapes;
  const p = e.prochain;
  const pret = e.aPayer.bordereaux;

  const ETAPES: Array<{ id: EtapeArgent; icone: React.ReactNode; titre: Cle; montant: number; aide: string; testId: string }> = [
    { id: 'EN_LIVRAISON', icone: <Truck className="w-4 h-4" />, titre: 'argent.etape1.titre', montant: e.enLivraison.montant, aide: t('argent.etape1.aide', { n: e.enLivraison.colis }), testId: 'etape-clients' },
    { id: 'VERIFICATION', icone: <Clock className="w-4 h-4" />, titre: 'argent.etape2.titre', montant: e.verification.pourVous, aide: t('argent.etape2.aide', { n: e.verification.colis }), testId: 'etape-verification' },
    { id: 'PROCHAIN', icone: <Wallet className="w-4 h-4" />, titre: 'argent.etape3.titre', montant: p.net, aide: t('argent.etape3.aide', { n: p.colis }), testId: 'etape-prochain' },
    { id: 'A_PAYER', icone: <Banknote className="w-4 h-4" />, titre: 'argent.etape4.titre', montant: e.aPayer.montant, aide: t('argent.etape4.aide', { n: pret.length }), testId: 'etape-a-payer' },
    { id: 'PAYE', icone: <CheckCircle2 className="w-4 h-4" />, titre: 'argent.etape5.titre', montant: e.paye.montant, aide: t('argent.etape5.aide', { n: e.paye.bordereaux }), testId: 'etape-paye' },
  ];

  return (
    <div className="space-y-5">
      <Entete majLe={formatDateTime(donnees.majLe)} />

      {/* 1. La réponse : combien RUNEX me doit. */}
      <section className="rounded-xl bg-slate-900 text-white p-5 sm:p-6 flex flex-wrap items-end justify-between gap-4" data-testid="argent-du">
        <div>
          <p className="text-sm text-slate-300">{t('argent.aRecevoir')}</p>
          <p className="text-3xl sm:text-4xl font-extrabold font-mono mt-1" dir="ltr" data-testid="argent-du-montant">
            {formatTND(donnees.aRecevoir)}
          </p>
          <p className="text-xs text-slate-400 mt-2 max-w-xl">{t('argent.aRecevoirAide')}</p>
        </div>
        <div className="text-sm text-slate-300 space-y-1">
          {pret.length > 0 && (
            <p className="text-emerald-300 font-semibold">{t('argent.pretMaintenant', { montant: formatTND(e.aPayer.montant) })}</p>
          )}
          {e.paye.dernier && (
            <p>{t('argent.dernierPaiement', { montant: formatTND(e.paye.dernier.net), date: formatDate(e.paye.dernier.le) })}</p>
          )}
          <Link href="/expediteur/bordereaux" className="inline-flex items-center gap-1 text-white font-semibold hover:underline">
            {t('argent.voirBordereaux')} <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* 2. Le chemin de l'argent. */}
      <section aria-labelledby="argent-chemin">
        <h2 id="argent-chemin" className="text-sm font-bold text-slate-900 mb-2">{t('argent.chemin')}</h2>
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {ETAPES.map((x, i) => (
            <li key={x.id} className="relative">
              <button
                type="button"
                onClick={() => choisir(x.id)}
                data-testid={x.testId}
                aria-pressed={etape === x.id}
                className={`w-full h-full text-start rounded-lg border p-4 transition cursor-pointer hover:shadow-sm ${COULEUR[x.id]} ${etape === x.id ? 'ring-2 ring-offset-1 ring-slate-900' : ''}`}
              >
                <span className="flex items-center gap-2 text-xs font-bold">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/80 text-[11px]">{i + 1}</span>
                  {x.icone}
                  {t(x.titre)}
                </span>
                <span className="block text-xl font-extrabold font-mono mt-2 text-slate-900" dir="ltr" data-testid={`${x.testId}-montant`}>
                  {formatTND(x.montant)}
                </span>
                <span className="block text-[11px] mt-1 opacity-90">{x.aide}</span>
              </button>
              {i < ETAPES.length - 1 && (
                <ArrowRight className="hidden lg:block absolute top-1/2 -end-3 -translate-y-1/2 w-4 h-4 text-slate-400 z-10 rtl:rotate-180" aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
        {e.retour.colis > 0 && (
          <button type="button" onClick={() => choisir('RETOUR')} className="mt-2 text-xs text-rose-800 hover:underline cursor-pointer" data-testid="etape-retour">
            {t('argent.retours', { n: e.retour.colis })}
          </button>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 3. Le calcul du prochain paiement. */}
        <section className="bg-white border border-slate-200 rounded-lg p-4" aria-labelledby="argent-calcul" data-testid="argent-calcul">
          <h2 id="argent-calcul" className="text-sm font-bold text-slate-900">{t('argent.calcul.titre')}</h2>
          {p.colis === 0 ? (
            <p className="text-sm text-slate-500 mt-3">{t('argent.calcul.vide')}</p>
          ) : (
            <dl className="mt-3 text-sm divide-y divide-slate-100">
              <LigneCalcul libelle={t('argent.calcul.encaisse', { n: p.livres })} montant={p.encaisse} signe="+" />
              <LigneCalcul libelle={t('argent.calcul.fraisLivraison')} montant={p.fraisLivraison} signe="−" />
              {p.fraisRetour > 0 && <LigneCalcul libelle={t('argent.calcul.fraisRetour', { n: p.retournes })} montant={p.fraisRetour} signe="−" />}
              {p.fraisGestion > 0 && <LigneCalcul libelle={t('argent.calcul.fraisGestion')} montant={p.fraisGestion} signe="−" />}
              {p.ras > 0 && <LigneCalcul libelle={t('argent.calcul.ras', { taux: p.tauxRas })} montant={p.ras} signe="−" />}
              <div className="flex items-center justify-between pt-2 mt-1 font-bold text-slate-900">
                <dt>{t('argent.calcul.net')}</dt>
                <dd className="font-mono" dir="ltr" data-testid="argent-calcul-net">{formatTND(p.net)}</dd>
              </div>
            </dl>
          )}
          {pret.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
              <p className="text-xs font-bold text-slate-700">{t('argent.pretsTitre')}</p>
              {pret.map((b) => (
                <p key={b.numero} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-700" dir="ltr">{b.numero}</span>
                  <span className="font-mono font-bold text-emerald-800" dir="ltr">{formatTND(b.net)}</span>
                </p>
              ))}
              <Link href="/expediteur/bordereaux" className="inline-block text-xs text-red-700 font-semibold hover:underline">{t('argent.codeRetrait')}</Link>
            </div>
          )}
        </section>

        {/* 4. Colis par colis. */}
        <section ref={listeRef} className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-4 scroll-mt-4" aria-labelledby="argent-colis">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="argent-colis" className="text-sm font-bold text-slate-900">{t('argent.colis.titre')}</h2>
            <label className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" aria-hidden="true" />
              <input
                value={recherche}
                onChange={(ev) => setRecherche(ev.target.value)}
                placeholder={t('argent.colis.recherche')}
                aria-label={t('argent.colis.recherche')}
                data-testid="argent-recherche"
                className="ps-8 pe-3 py-1.5 text-sm border border-slate-300 rounded-md w-64 max-w-full"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3" role="group" aria-label={t('argent.colis.filtre')}>
            <Puce actif={etape === null} onClick={() => setEtape(null)} libelle={t('argent.colis.tous')} />
            {(['EN_LIVRAISON', 'VERIFICATION', 'PROCHAIN', 'A_PAYER', 'PAYE', 'RETOUR'] as EtapeArgent[]).map((x) =>
              donnees.parEtape[x] > 0 || etape === x ? (
                <Puce key={x} actif={etape === x} onClick={() => setEtape(x)} libelle={`${t(`argent.ou.${x}` as Cle)} · ${donnees.parEtape[x]}`} testId={`puce-${x}`} />
              ) : null
            )}
          </div>

          {donnees.colis.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">{t('argent.colis.vide')}</p>
          ) : (
            <>
              <div className="hidden md:grid grid-cols-[1.6fr_1fr_1fr_1fr_1.6fr] gap-3 px-2 mt-4 pb-2 text-[11px] font-semibold text-slate-500 border-b border-slate-200">
                <span>{t('argent.col.colis')}</span>
                <span className="text-end">{t('argent.col.prix')}</span>
                <span className="text-end">{t('argent.col.frais')}</span>
                <span className="text-end">{t('argent.col.pourVous')}</span>
                <span>{t('argent.col.ou')}</span>
              </div>
              <ul className="divide-y divide-slate-100" data-testid="argent-liste">
                {donnees.colis.map((c) => (
                  <li key={c.id} data-testid={`argent-colis-${c.trackingNumber}`} className="grid grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr_1.6fr] gap-x-3 gap-y-1 px-2 py-2.5 text-sm items-center">
                    <div className="col-span-2 md:col-span-1 min-w-0">
                      <Link href={`/expediteur/colis/${c.id}`} className="font-mono text-xs font-bold text-red-700 hover:underline" dir="ltr">
                        {c.trackingNumber}
                      </Link>
                      <span className="block text-xs text-slate-600 truncate">
                        {c.client}
                        {c.ville ? ` · ${c.ville}` : ''}
                      </span>
                      <span className="block text-[11px] text-slate-400">{voc.statutColis(c.statut).label}</span>
                    </div>
                    <Montant libelle={t('argent.col.prix')} valeur={formatTND(c.prix)} />
                    <Montant libelle={t('argent.col.frais')} valeur={c.frais > 0 ? `− ${formatTND(c.frais)}` : '—'} classe="text-slate-500" />
                    <Montant
                      libelle={t('argent.col.pourVous')}
                      valeur={c.etape === 'EN_LIVRAISON' || c.etape === 'RETOUR' || c.etape === 'AUCUN' ? '—' : formatTND(c.pourVous)}
                      classe={c.pourVous < 0 ? 'text-rose-700 font-bold' : 'text-slate-900 font-bold'}
                      testId="pour-vous"
                    />
                    <div className="col-span-2 md:col-span-1">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${COULEUR[c.etape]}`} data-testid="ou-argent">
                        {t(`argent.ou.${c.etape}` as Cle)}
                      </span>
                      {c.bordereau && (
                        <span className="block text-[11px] text-slate-500 mt-0.5">
                          {t('argent.ou.bordereau', { n: c.bordereau })}
                          {c.payeLe ? ` · ${t('argent.ou.payeLe', { date: formatDate(c.payeLe) })}` : ''}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {donnees.totalColis > donnees.colis.length && (
                <p className="text-[11px] text-slate-400 mt-2">{t('argent.colis.plus', { n: donnees.colis.length, total: donnees.totalColis })}</p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Entete({ majLe }: { majLe?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('argent.titre')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('argent.sousTitre')}</p>
      </div>
      {majLe && <p className="text-[11px] text-slate-400">{t('argent.majLe', { date: majLe })}</p>}
    </div>
  );
}

function LigneCalcul({ libelle, montant, signe }: { libelle: string; montant: number; signe: '+' | '−' }) {
  const { formatTND } = useI18n();
  return (
    <div className="flex items-center justify-between py-1.5">
      <dt className="text-slate-600">{libelle}</dt>
      <dd className={`font-mono ${signe === '−' ? 'text-rose-700' : 'text-slate-900'}`} dir="ltr">
        {signe} {formatTND(montant)}
      </dd>
    </div>
  );
}

function Montant({ libelle, valeur, classe = 'text-slate-900', testId }: { libelle: string; valeur: string; classe?: string; testId?: string }) {
  return (
    <div className="md:text-end">
      <span className="md:hidden block text-[10px] text-slate-400">{libelle}</span>
      <span className={`font-mono text-sm ${classe}`} dir="ltr" data-testid={testId}>
        {valeur}
      </span>
    </div>
  );
}

function Puce({ actif, onClick, libelle, testId }: { actif: boolean; onClick: () => void; libelle: string; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      data-testid={testId}
      className={`px-2.5 py-1 rounded-full text-xs font-semibold border cursor-pointer transition ${actif ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
    >
      {libelle}
    </button>
  );
}
