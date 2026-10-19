'use client';

/**
 * Validation d'une tournée par la caisse — comme « Validation runsheet » chez
 * ADEX, aux couleurs de RUNEX.
 *
 *   - Clôture : total des colis livrés (prix) face au total réglé (payé),
 *     recette espèces et chèques, compteurs livrés / reportés / retours /
 *     non traités ;
 *   - Recette (calculée automatiquement) et espèces remises par le livreur :
 *     le déficit se lit pendant la saisie ;
 *   - Colis non livrés : scan avec la bascule « Reporté / Retour définitif » ;
 *   - à gauche, tous les colis de la tournée, quel que soit leur état
 *     (recherche, filtres livrés / non traités / écarts, montant payé
 *     corrigeable) ; à droite, les reportés et retours définitifs : un colis
 *     quitte le tableau de gauche pour la liste de droite dès qu'il est
 *     scanné (affichage seulement, le traitement ne change pas) ;
 *   - Valider : la tournée est clôturée, sort de la liste des tournées en
 *     cours et reste dans l'historique.
 */

import React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Barcode,
  CheckCircle2,
  Clock3,
  Coins,
  FileCheck2,
  Pencil,
  Printer,
  Receipt,
  Search,
  Truck,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ErrorBanner, Modal, useToast } from '@logixpress/ui';
import { validationTourneeApi, type EtatColisValidation, type ValidationTournee as Vue } from '@/lib/api';
import { playFeedback } from '@/lib/feedback';
import { imprimerValidationTournee } from '@/lib/impression-documents';
import { BoutonImpressionTournee } from '@/features/runsheets/BoutonImpressionTournee';

const dt = (n: number) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;
const CARTE = 'bg-white border border-slate-200 rounded-2xl shadow-xs';

const ETATS: Record<EtatColisValidation, { libelle: string; classe: string; point: string }> = {
  LIVRE: { libelle: 'Livré', classe: 'bg-emerald-50 text-emerald-800 border-emerald-200', point: '#10b981' },
  REPORTE: { libelle: 'Reporté', classe: 'bg-amber-50 text-amber-800 border-amber-200', point: '#f59e0b' },
  RETOUR: { libelle: 'Retour définitif', classe: 'bg-red-50 text-red-800 border-red-200', point: '#ef4444' },
  NON_TRAITE: { libelle: 'Non traité', classe: 'bg-slate-100 text-slate-700 border-slate-300', point: '#64748b' },
  ANNULE: { libelle: 'Annulé', classe: 'bg-slate-50 text-slate-400 border-slate-200', point: '#cbd5e1' },
};

const STATUTS: Record<string, { libelle: string; classe: string }> = {
  EN_ATTENTE: { libelle: 'En attente', classe: 'bg-slate-100 text-slate-700' },
  VALIDEE_DEPART: { libelle: 'Départ validé', classe: 'bg-sky-100 text-sky-800' },
  EN_COURS: { libelle: 'En tournée', classe: 'bg-amber-100 text-amber-800' },
  RETOUR_DEPOT: { libelle: 'Revenue au dépôt', classe: 'bg-violet-100 text-violet-800' },
  CLOTUREE_CONFORME: { libelle: 'Validée — conforme', classe: 'bg-emerald-100 text-emerald-800' },
  CLOTUREE_DEFICIT: { libelle: 'Validée — déficit', classe: 'bg-red-100 text-red-800' },
  ANNULEE: { libelle: 'Annulée', classe: 'bg-slate-100 text-slate-500' },
};

type Filtre = 'TOUS' | 'LIVRE' | 'NON_TRAITE' | 'ECART';

export function ValidationTournee({ id }: { id: string }) {
  const { addToast } = useToast();
  const [vue, setVue] = React.useState<Vue | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<'REPORTE' | 'RETOUR'>('REPORTE');
  const [code, setCode] = React.useState('');
  const [retourScan, setRetourScan] = React.useState<{ ok: boolean; texte: string } | null>(null);
  const [scanEnCours, setScanEnCours] = React.useState(false);
  const [remises, setRemises] = React.useState('');
  const [remisesTouchees, setRemisesTouchees] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [confirmer, setConfirmer] = React.useState(false);
  const [envoi, setEnvoi] = React.useState(false);
  const [recherche, setRecherche] = React.useState('');
  const [filtre, setFiltre] = React.useState<Filtre>('TOUS');
  const [edition, setEdition] = React.useState<{ id: string; valeur: string } | null>(null);
  const [lot, setLot] = React.useState(false);
  const champScan = React.useRef<HTMLInputElement>(null);

  const appliquer = React.useCallback((v: Vue) => {
    setVue(v);
    if (!remisesTouchees) setRemises(String(v.totaux.especesRemises));
  }, [remisesTouchees]);

  const charger = React.useCallback(async () => {
    try {
      appliquer(await validationTourneeApi.lire(id));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Tournée indisponible.');
    }
  }, [id, appliquer]);

  React.useEffect(() => {
    void charger();
  }, [charger]);

  const scanner = async (valeur: string, modeScan = mode): Promise<boolean> => {
    const c = valeur.trim();
    if (!c || !vue) return false;
    setScanEnCours(true);
    try {
      const r = await validationTourneeApi.scanner(vue.runsheetNumber, c, modeScan);
      if (r.data) appliquer(r.data);
      setRetourScan({ ok: true, texte: r.message ?? 'Colis traité.' });
      playFeedback('success');
      return true;
    } catch (e) {
      setRetourScan({ ok: false, texte: e instanceof Error ? e.message : 'Scan refusé.' });
      playFeedback('error');
      return false;
    } finally {
      setScanEnCours(false);
      setCode('');
      champScan.current?.focus();
    }
  };

  const reporterTous = async () => {
    if (!vue) return;
    setLot(true);
    let nb = 0;
    for (const c of vue.colis.filter((x) => x.etat === 'NON_TRAITE')) {
      try {
        const r = await validationTourneeApi.scanner(vue.runsheetNumber, c.barcode, mode);
        if (r.data) appliquer(r.data);
        nb += 1;
      } catch {
        /* le colis reste à traiter, la liste le montre */
      }
    }
    setLot(false);
    setRetourScan({ ok: true, texte: `${nb} colis marqué${nb > 1 ? 's' : ''} ${mode === 'REPORTE' ? 'reporté' : 'en retour définitif'}${nb > 1 ? 's' : ''}.` });
    playFeedback('complete');
  };

  const enregistrerMontant = async () => {
    if (!edition || !vue) return;
    const montant = Number(edition.valeur.replace(',', '.'));
    try {
      const r = await validationTourneeApi.montant(vue.runsheetNumber, edition.id, montant);
      if (r.data) appliquer(r.data);
      setEdition(null);
      addToast({ type: 'success', title: 'Montant corrigé', message: r.message ?? '' });
    } catch (e) {
      addToast({ type: 'error', title: 'Correction refusée', message: e instanceof Error ? e.message : '' });
    }
  };

  const valider = async () => {
    if (!vue) return;
    setEnvoi(true);
    try {
      const montant = Number(String(remises).replace(',', '.'));
      const r = await validationTourneeApi.valider(vue.runsheetNumber, {
        especesRemises: Number.isFinite(montant) ? montant : undefined,
        notes: notes.trim() || undefined,
      });
      if (r.data) setVue(r.data);
      setConfirmer(false);
      playFeedback('complete');
      addToast({ type: r.data?.status === 'CLOTUREE_DEFICIT' ? 'warning' : 'success', title: 'Tournée validée', message: r.message ?? '' });
    } catch (e) {
      setConfirmer(false);
      setErreur(e instanceof Error ? e.message : 'Validation impossible.');
      playFeedback('error');
    } finally {
      setEnvoi(false);
    }
  };

  if (!vue) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Link href="/runsheets" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Retour aux tournées
        </Link>
        {erreur ? <ErrorBanner message={erreur} /> : <div className="h-64 rounded-2xl bg-slate-100 animate-pulse" />}
      </div>
    );
  }

  const t = vue.totaux;
  const statut = STATUTS[vue.status] ?? { libelle: vue.status, classe: 'bg-slate-100 text-slate-700' };
  const remisesNb = Number(String(remises).replace(',', '.'));
  const deficitSaisi = vue.validable ? Math.max(0, Math.round((t.recetteEspece - (Number.isFinite(remisesNb) ? remisesNb : 0)) * 1000) / 1000) : t.deficit;
  const ecartReglement = Math.abs(t.ecart) > 0.0005;
  const terme = recherche.trim().toLowerCase();
  // À gauche : tous les colis, quel que soit leur état. À droite : les
  // reportés et retours définitifs — un colis y passe dès qu'il est scanné.
  const scanne = (c: (typeof vue.colis)[number]) => c.etat === 'REPORTE' || c.etat === 'RETOUR';
  const gauche = vue.colis.filter((c) => !scanne(c));
  const nonLivres = vue.colis.filter(scanne);
  const avecEcart = (c: (typeof gauche)[number]) => c.etat === 'LIVRE' && Math.abs(c.ecart) > 0.0005;
  const garde = (f: Filtre) => (c: (typeof gauche)[number]) =>
    f === 'TOUS' ? true : f === 'ECART' ? avecEcart(c) : c.etat === f;
  const lignes = gauche.filter((c) => {
    if (!garde(filtre)(c)) return false;
    if (!terme) return true;
    return [c.trackingNumber, c.barcode, c.customerName, c.shipperName, c.price.toFixed(3), c.paid.toFixed(3)].some((x) => x.toLowerCase().includes(terme));
  });
  const nbFiltre = (f: Filtre) => gauche.filter(garde(f)).length;

  return (
    <div className="dash-anime p-4 sm:p-6 space-y-5" data-testid="validation-tournee">
      {/* En-tête */}
      <div className="space-y-3">
        <Link href="/runsheets" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Retour aux tournées
        </Link>
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-red-600">Validation de la tournée</p>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 font-mono">{vue.runsheetNumber}</h1>
            <p className="text-sm text-slate-600 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Truck className="w-4 h-4 text-slate-400" aria-hidden="true" />
              <span className="font-semibold text-slate-900">{vue.driver.name}</span>
              <span className="text-slate-400">·</span> {vue.driver.code}
              {vue.driver.plate && (
                <>
                  <span className="text-slate-400">·</span> Matricule <span className="font-mono">{vue.driver.plate}</span>
                </>
              )}
              <span className="text-slate-400">·</span> Créée par <span className="font-semibold">{vue.depositName}</span>
              <span className="text-slate-400">·</span> {new Date(`${vue.tourDate}T12:00:00`).toLocaleDateString('fr-FR')}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {t.colis} colis affecté{t.colis > 1 ? 's' : ''} · {t.pieces} pièce{t.pieces > 1 ? 's' : ''}
              {t.annules ? ` · ${t.annules} annulé${t.annules > 1 ? 's' : ''}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${statut.classe}`} data-testid="statut-tournee">
              {statut.libelle}
            </span>
            <BoutonImpressionTournee runsheetNumber={vue.runsheetNumber} aEchanges={vue.colis.some((c) => c.echange)} taille="md" />
            <button
              type="button"
              onClick={() => imprimerValidationTournee(vue)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" /> Fiche de validation
            </button>
          </div>
        </div>
      </div>

      {erreur && <ErrorBanner message={erreur} onDismiss={() => setErreur(null)} />}

      {!vue.validable && (vue.status === 'CLOTUREE_CONFORME' || vue.status === 'CLOTUREE_DEFICIT') && (
        <div
          className={`rounded-2xl border p-4 flex items-start gap-3 ${vue.status === 'CLOTUREE_DEFICIT' ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}
          data-testid="bandeau-validee"
        >
          {vue.status === 'CLOTUREE_DEFICIT' ? (
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden="true" />
          )}
          <div className="text-sm">
            <p className="font-bold text-slate-900">
              Tournée validée{vue.validatedBy ? ` par ${vue.validatedBy}` : ''}
              {vue.closedAt ? ` le ${new Date(vue.closedAt).toLocaleString('fr-FR')}` : ''}.
            </p>
            <p className="text-slate-600">
              {vue.status === 'CLOTUREE_DEFICIT'
                ? `Déficit de ${dt(t.deficit)} : ${dt(t.especesRemises)} remis sur ${dt(t.recetteEspece)} d’espèces.`
                : 'Caisse conforme. La tournée est rangée dans l’historique.'}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
        {/* Clôture */}
        <section className={`${CARTE} p-4 sm:p-5 space-y-3`} aria-labelledby="titre-cloture">
          <h2 id="titre-cloture" className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-red-600" aria-hidden="true" /> Clôture
          </h2>
          <div className={`rounded-xl border overflow-hidden ${ecartReglement ? 'border-red-300' : 'border-slate-200'}`}>
            <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50/60">
              <span className="text-sm text-slate-700">Total des colis livrés</span>
              <span className="font-mono font-semibold text-slate-900" data-testid="total-colis-livres">{dt(t.totalColisLivres)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
              <span className="text-sm text-slate-700">Total réglé par les clients</span>
              <span className={`font-mono font-semibold inline-flex items-center gap-1.5 ${ecartReglement ? 'text-red-700' : 'text-slate-900'}`} data-testid="total-reglement">
                {ecartReglement && <AlertTriangle className="w-4 h-4" aria-label="Écart" />}
                {dt(t.totalReglement)}
              </span>
            </div>
            {ecartReglement && (
              <p className="px-4 py-2 text-[11px] text-red-700 bg-red-50 border-t border-red-100">
                Écart de {dt(t.ecart)} entre le prix des colis livrés et ce qui a été payé : vérifiez les montants dans la liste.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
            <span className="text-sm font-semibold text-emerald-900">Recette espèces</span>
            <span className="font-mono text-lg font-extrabold text-emerald-800" data-testid="recette-espece">{dt(t.recetteEspece)}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-2.5">
            <span className="text-sm text-slate-700">Recette chèques ({t.nbCheques})</span>
            <span className="font-mono font-semibold text-slate-900">{dt(t.recetteCheque)}</span>
          </div>
          {t.recetteAutre > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-2.5">
              <span className="text-sm text-slate-700">Autres moyens (virement, traite)</span>
              <span className="font-mono font-semibold text-slate-900">{dt(t.recetteAutre)}</span>
            </div>
          )}
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1" data-testid="compteurs-validation">
            {(
              [
                ['Livrés', t.livres, ETATS.LIVRE.point, 'LIVRE'],
                ['Reportés', t.reportes, ETATS.REPORTE.point, 'REPORTE'],
                ['Retours', t.retours, ETATS.RETOUR.point, 'RETOUR'],
                ['Non traités', t.nonTraites, ETATS.NON_TRAITE.point, 'NON_TRAITE'],
              ] as const
            ).map(([libelle, nb, couleur]) => (
              <li key={libelle} className="rounded-xl border border-slate-200 px-3 py-2">
                <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: couleur }} /> {libelle}
                </span>
                <span className="block text-xl font-extrabold tabular-nums text-slate-900">{nb}</span>
              </li>
            ))}
          </ul>
          <div className="flex h-2 rounded-full bg-slate-100 overflow-hidden gap-[2px]" aria-hidden="true">
            {(['LIVRE', 'REPORTE', 'RETOUR', 'NON_TRAITE'] as const).map((e) => {
              const nb = e === 'LIVRE' ? t.livres : e === 'REPORTE' ? t.reportes : e === 'RETOUR' ? t.retours : t.nonTraites;
              return nb > 0 ? <span key={e} style={{ width: `${(nb / Math.max(1, t.colis)) * 100}%`, backgroundColor: ETATS[e].point }} /> : null;
            })}
          </div>
        </section>

          {/* Tous les colis de la tournée (à gauche, comme ADEX) */}
          <section className={`${CARTE} overflow-hidden`} aria-labelledby="titre-colis">
            <div className="p-4 sm:p-5 border-b border-slate-100 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h2 id="titre-colis" className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-red-600" aria-hidden="true" /> Colis de la tournée
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 text-[11px] font-bold tabular-nums" data-testid="nb-gauche">
                    {gauche.length}
                  </span>
                </h2>
                <div className="relative w-full sm:w-60">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                  <input
                    type="search"
                    value={recherche}
                    onChange={(e) => setRecherche(e.target.value)}
                    placeholder="Code, prix, client…"
                    aria-label="Rechercher un colis de la tournée"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:bg-white focus:border-slate-400"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filtrer les colis de la tournée">
                {(['TOUS', 'LIVRE', 'NON_TRAITE', 'ECART'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={filtre === f}
                    onClick={() => setFiltre(f)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition cursor-pointer ${
                      filtre === f ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {f === 'TOUS' ? 'Tous' : f === 'LIVRE' ? 'Livrés' : f === 'NON_TRAITE' ? 'Non traités' : 'Avec écart'}
                    <span className={`ml-1.5 tabular-nums ${filtre === f ? 'text-white/70' : 'text-slate-400'}`}>{nbFiltre(f)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]" data-testid="table-colis-validation">
                <thead>
                  <tr className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="text-left px-4 py-2">Colis</th>
                    <th className="text-left px-2 py-2">État</th>
                    <th className="text-right px-2 py-2">Prix</th>
                    <th className="text-right px-4 py-2">Montant payé</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lignes.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center text-xs text-slate-400 py-8">
                        {gauche.length === 0 ? 'Tous les colis de la tournée sont reportés ou retournés (liste de droite).' : 'Aucun colis ne correspond.'}
                      </td>
                    </tr>
                  ) : (
                    lignes.map((c) => {
                      const ecart = avecEcart(c);
                      const etatC = ETATS[c.etat];
                      return (
                        <tr
                          key={c.id}
                          className={`hover:bg-slate-50/70 ${c.etat === 'ANNULE' ? 'opacity-60' : ''}`}
                          data-testid={`ligne-${c.trackingNumber}`}
                          data-etat={c.etat}
                        >
                          <td className="px-4 py-2.5">
                            <span className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-bold text-red-700">{c.trackingNumber}</span>
                              {c.echange && (
                                <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 text-[9px] font-bold uppercase">Échange</span>
                              )}
                            </span>
                            <span className="block text-[11px] text-slate-500 truncate max-w-[220px]">
                              {c.customerName} · {c.shipperName} · {c.pieceCount} p.
                            </span>
                          </td>
                          <td className="px-2 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${etatC.classe}`}>{etatC.libelle}</span>
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700 whitespace-nowrap">{dt(c.price)}</td>
                          <td className="px-4 py-2.5 text-right">
                            {c.etat === 'NON_TRAITE' ? (
                              vue.validable ? (
                                <span className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => void scanner(c.barcode, 'REPORTE')}
                                    className="px-2 py-1 rounded-md bg-amber-100 text-amber-800 text-[10px] font-semibold hover:bg-amber-200 cursor-pointer"
                                    aria-label={`Reporter ${c.trackingNumber}`}
                                  >
                                    Reporter
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void scanner(c.barcode, 'RETOUR')}
                                    className="px-2 py-1 rounded-md bg-red-100 text-red-800 text-[10px] font-semibold hover:bg-red-200 cursor-pointer"
                                    aria-label={`Retour définitif ${c.trackingNumber}`}
                                  >
                                    Retour
                                  </button>
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )
                            ) : c.etat === 'ANNULE' ? (
                              <span className="text-xs text-slate-400">—</span>
                            ) : edition?.id === c.id ? (
                              <form
                                onSubmit={(ev) => {
                                  ev.preventDefault();
                                  void enregistrerMontant();
                                }}
                                className="inline-flex items-center gap-1"
                              >
                                <input
                                  autoFocus
                                  inputMode="decimal"
                                  value={edition.valeur}
                                  onChange={(ev) => setEdition({ id: c.id, valeur: ev.target.value })}
                                  className="w-24 px-2 py-1 rounded-md border border-slate-300 text-xs font-mono text-right"
                                  aria-label={`Montant payé pour ${c.trackingNumber}`}
                                  data-testid="champ-montant"
                                />
                                <button type="submit" className="px-2 py-1 rounded-md bg-slate-900 text-white text-[11px] font-semibold cursor-pointer">
                                  OK
                                </button>
                                <button type="button" onClick={() => setEdition(null)} aria-label="Annuler" className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer">
                                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </form>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 justify-end">
                                {ecart && (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-700" title={`Écart de ${dt(c.ecart)}`}>
                                    <AlertTriangle className="w-3 h-3" aria-hidden="true" /> écart {dt(c.ecart)}
                                  </span>
                                )}
                                <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded-full ${ecart ? 'bg-red-600 text-white' : 'bg-emerald-50 text-emerald-800'}`}>{dt(c.paid)}</span>
                                {c.modifiable && (
                                  <button
                                    type="button"
                                    onClick={() => setEdition({ id: c.id, valeur: String(c.paid) })}
                                    aria-label={`Corriger le montant de ${c.trackingNumber}`}
                                    className="p-1 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
                                    data-testid={`corriger-${c.trackingNumber}`}
                                  >
                                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                  </button>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Recette + scan + validation */}
        <section className="space-y-4">
          <div className={`${CARTE} p-4 sm:p-5 space-y-3`} aria-labelledby="titre-recette">
            <h2 id="titre-recette" className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Coins className="w-4 h-4 text-red-600" aria-hidden="true" /> Recette (calculée automatiquement)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-600">Nombre de chèques</p>
                <p className="mt-1 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 font-mono text-sm">{t.nbCheques}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Calculé automatiquement</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-600">Recette espèces</p>
                <p className="mt-1 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 font-mono text-sm font-bold text-emerald-800">{dt(t.recetteEspece)}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">= somme des règlements en espèces</p>
              </div>
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Espèces remises par le livreur</span>
              <span className={`mt-1 flex items-center rounded-lg border bg-white focus-within:ring-2 focus-within:ring-red-500/30 ${deficitSaisi > 0 ? 'border-red-300' : 'border-slate-300'}`}>
                <input
                  inputMode="decimal"
                  value={remises}
                  disabled={!vue.validable}
                  onChange={(e) => {
                    setRemises(e.target.value);
                    setRemisesTouchees(true);
                  }}
                  className="w-full px-3 py-2 text-sm font-mono bg-transparent focus:outline-none disabled:text-slate-500"
                  data-testid="especes-remises"
                />
                <span className="px-3 text-xs font-semibold text-slate-400">DT</span>
              </span>
              <span className={`block text-[11px] mt-1 ${deficitSaisi > 0 ? 'text-red-700 font-semibold' : 'text-emerald-700'}`} data-testid="deficit-saisi">
                {deficitSaisi > 0 ? `Déficit : ${dt(deficitSaisi)} manquent dans la caisse.` : 'Caisse conforme : rien ne manque.'}
              </span>
            </label>
            {vue.validable && (
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Note (facultative)</span>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={500}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30"
                  placeholder="ex. le livreur rapporte le complément demain"
                />
              </label>
            )}
          </div>

          {vue.validable && (
            <div className={`${CARTE} p-4 sm:p-5 space-y-3`} aria-labelledby="titre-scan">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="titre-scan" className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Barcode className="w-4 h-4 text-red-600" aria-hidden="true" /> Colis non livrés
                </h2>
                <div role="radiogroup" aria-label="Type de traitement" className="inline-flex p-0.5 rounded-xl bg-slate-100 border border-slate-200">
                  {(
                    [
                      ['REPORTE', 'Reporté', Clock3],
                      ['RETOUR', 'Retour définitif', Undo2],
                    ] as const
                  ).map(([cle, libelle, Icone]) => (
                    <button
                      key={cle}
                      type="button"
                      role="radio"
                      aria-checked={mode === cle}
                      onClick={() => setMode(cle)}
                      data-testid={`mode-${cle}`}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        mode === cle ? (cle === 'REPORTE' ? 'bg-amber-500 text-white shadow-sm' : 'bg-red-600 text-white shadow-sm') : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Icone className="w-3.5 h-3.5" aria-hidden="true" /> {libelle}
                    </button>
                  ))}
                </div>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void scanner(code);
                }}
                className="flex gap-2"
              >
                <input
                  ref={champScan}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Scanner le code à barres"
                  aria-label="Code à barres du colis"
                  autoFocus
                  data-testid="scan-validation"
                  className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500/30"
                />
                <button
                  type="submit"
                  disabled={scanEnCours || !code.trim()}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 cursor-pointer ${mode === 'REPORTE' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-red-600 hover:bg-red-700'}`}
                >
                  {mode === 'REPORTE' ? 'Reporté' : 'Retour'}
                </button>
              </form>
              {retourScan && (
                <p
                  role="status"
                  className={`text-xs rounded-lg px-3 py-2 border ${retourScan.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}
                  data-testid="retour-scan"
                >
                  {retourScan.texte}
                </p>
              )}
              {t.nonTraites > 0 && (
                <button
                  type="button"
                  onClick={() => void reporterTous()}
                  disabled={lot}
                  data-testid="traiter-tous"
                  className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-dashed border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
                >
                  {lot ? 'Traitement…' : `Marquer les ${t.nonTraites} colis non traités comme « ${mode === 'REPORTE' ? 'Reporté' : 'Retour définitif'} »`}
                </button>
              )}
            </div>
          )}

          <ListeLaterale
            titre="Colis reportés et retours définitifs"
            aide={vue.validable ? 'Ils quitteront la tournée à la validation.' : 'Ils ont quitté la tournée à la validation.'}
            icone={Undo2}
            ton="amber"
            colis={nonLivres}
            vide="Aucun colis reporté ou retourné pour l’instant : scannez un colis, il quitte le tableau de gauche pour cette liste."
            testid="liste-reportes"
            actions={
              vue.validable
                ? (c) =>
                    c.etat === 'REPORTE' ? (
                      <button
                        type="button"
                        onClick={() => void scanner(c.barcode, 'RETOUR')}
                        className="px-2 py-1 rounded-md bg-red-100 text-red-800 text-[10px] font-semibold hover:bg-red-200 cursor-pointer"
                        aria-label={`Passer ${c.trackingNumber} en retour définitif`}
                      >
                        → Retour définitif
                      </button>
                    ) : null
                : undefined
            }
          />

          {vue.validable && (
            <div>
              <button
                type="button"
                onClick={() => setConfirmer(true)}
                disabled={t.nonTraites > 0}
                data-testid="bouton-valider"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-red-600 text-white text-sm font-bold shadow-lg shadow-red-900/20 hover:bg-red-700 disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed transition cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Valider la tournée
              </button>
              {t.nonTraites > 0 && (
                <p className="text-[11px] text-slate-500 mt-1.5 text-center">
                  {t.nonTraites} colis non traité{t.nonTraites > 1 ? 's' : ''} : scannez-les en « Reporté » ou « Retour définitif » pour pouvoir valider.
                </p>
              )}
            </div>
          )}
        </section>
      </div>


      <Modal
        isOpen={confirmer}
        onClose={() => !envoi && setConfirmer(false)}
        title={`Valider la tournée ${vue.runsheetNumber}`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmer(false)} disabled={envoi} className="px-3 py-1.5 rounded-md border border-slate-200 text-sm cursor-pointer">
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void valider()}
              disabled={envoi}
              data-testid="confirmer-validation"
              className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 cursor-pointer"
            >
              {envoi ? 'Validation…' : 'Valider'}
            </button>
          </div>
        }
      >
        <dl className="space-y-1.5 text-sm">
          <Ligne libelle="Colis livrés" valeur={`${t.livres} / ${t.colis}`} />
          <Ligne libelle="Reportés · retours définitifs" valeur={`${t.reportes} · ${t.retours}`} />
          <Ligne libelle="Total réglé" valeur={dt(t.totalReglement)} />
          <Ligne libelle="Espèces attendues" valeur={dt(t.recetteEspece)} />
          <Ligne libelle="Espèces remises" valeur={dt(Number.isFinite(remisesNb) ? remisesNb : 0)} />
          <Ligne libelle="Déficit" valeur={dt(deficitSaisi)} alerte={deficitSaisi > 0} />
        </dl>
        <p className="text-xs text-slate-500 mt-3">
          Les encaissements des colis livrés sont validés (ceux qui ne correspondent pas au prix sont marqués en écart), les colis reportés et retournés
          quittent la tournée, et la tournée passe dans l’historique.
        </p>
      </Modal>
    </div>
  );
}

function Ligne({ libelle, valeur, alerte = false, icone: Icone }: { libelle: string; valeur: string; alerte?: boolean; icone?: LucideIcon }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500 flex items-center gap-1">
        {Icone && <Icone className="w-3.5 h-3.5" aria-hidden="true" />}
        {libelle}
      </dt>
      <dd className={`font-mono font-semibold ${alerte ? 'text-red-700' : 'text-slate-900'}`}>{valeur}</dd>
    </div>
  );
}

type ColisVue = Vue['colis'][number];

/** Liste de droite : colis reportés et retours définitifs (scannés). */
function ListeLaterale({
  titre,
  aide,
  icone: Icone,
  ton,
  colis,
  vide,
  actions,
  testid,
}: {
  titre: string;
  aide: string;
  icone: LucideIcon;
  ton: 'slate' | 'amber';
  colis: ColisVue[];
  vide?: string;
  actions?: (c: ColisVue) => React.ReactNode;
  testid: string;
}) {
  const fond = ton === 'amber' ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-slate-200';
  return (
    <section className={`rounded-2xl border shadow-xs overflow-hidden ${fond}`} data-testid={testid} aria-label={titre}>
      <div className="px-4 py-3 border-b border-black/5">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Icone className={`w-4 h-4 ${ton === 'amber' ? 'text-amber-600' : 'text-slate-500'}`} aria-hidden="true" />
          {titre}
          <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[11px] font-bold tabular-nums">{colis.length}</span>
        </h2>
        <p className="text-[11px] text-slate-500 mt-0.5">{aide}</p>
      </div>
      {colis.length === 0 ? (
        <p className="px-4 py-5 text-xs text-slate-400 text-center">{vide ?? 'Aucun colis.'}</p>
      ) : (
        <ul className="divide-y divide-black/5 max-h-[420px] overflow-y-auto">
          {colis.map((c) => {
            const e = ETATS[c.etat];
            return (
              <li key={c.id} className="px-4 py-2.5 flex items-center gap-3 motion-safe:animate-dash-rise" data-testid={`lateral-${c.trackingNumber}`}>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-red-700">{c.trackingNumber}</span>
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${e.classe}`}>{e.libelle}</span>
                    {c.echange && (
                      <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 text-[9px] font-bold uppercase">Échange</span>
                    )}
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">
                    {c.customerName} · {c.shipperName} · {c.pieceCount} pièce{c.pieceCount > 1 ? 's' : ''}
                  </span>
                </span>
                <span className="font-mono text-xs text-slate-700 shrink-0">{dt(c.price)}</span>
                {actions && <span className="flex items-center gap-1 shrink-0">{actions(c)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

