'use client';

/**
 * Bouton d'impression d'une tournée (comme ADEX) : un clic imprime le bon de
 * livraison de la tournée ; quand la tournée contient des colis d'échange, une
 * flèche ouvre le choix « Runsheet » ou « Produits échanges ».
 *
 * Le menu est positionné en `fixed` : il n'est pas coupé par le défilement
 * horizontal du tableau qui le contient.
 */

import React from 'react';
import { ArrowLeftRight, ChevronDown, Printer } from 'lucide-react';
import { useToast } from '@logixpress/ui';
import { impressionTourneeApi } from '@/lib/api';
import { imprimerBonTournee, imprimerProduitsEchange } from '@/lib/impression-documents';

export function BoutonImpressionTournee({
  runsheetNumber,
  aEchanges,
  taille = 'sm',
}: {
  runsheetNumber: string;
  aEchanges: boolean;
  taille?: 'sm' | 'md';
}) {
  const { addToast } = useToast();
  const [menu, setMenu] = React.useState<{ top: number; left: number } | null>(null);
  const [occupe, setOccupe] = React.useState(false);
  const fleche = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!menu) return;
    const fermer = () => setMenu(null);
    window.addEventListener('scroll', fermer, true);
    window.addEventListener('resize', fermer);
    return () => {
      window.removeEventListener('scroll', fermer, true);
      window.removeEventListener('resize', fermer);
    };
  }, [menu]);

  const imprimer = async (quoi: 'runsheet' | 'echanges') => {
    setMenu(null);
    setOccupe(true);
    try {
      const donnees = await impressionTourneeApi.lire(runsheetNumber);
      if (quoi === 'runsheet') imprimerBonTournee(donnees);
      else imprimerProduitsEchange(donnees);
    } catch (e) {
      addToast({ type: 'error', title: 'Impression impossible', message: e instanceof Error ? e.message : '' });
    } finally {
      setOccupe(false);
    }
  };

  const grand = taille === 'md';
  const base = `inline-flex items-center justify-center border transition cursor-pointer disabled:opacity-50 ${
    grand ? 'h-8 text-xs font-semibold' : 'h-7'
  }`;

  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()} data-testid={`impression-${runsheetNumber}`}>
      <button
        type="button"
        disabled={occupe}
        onClick={() => void imprimer('runsheet')}
        title="Imprimer la runsheet"
        aria-label={`Imprimer la runsheet ${runsheetNumber}`}
        data-testid="imprimer-runsheet"
        className={`${base} ${grand ? 'px-3 gap-1.5' : 'w-7'} ${aEchanges ? 'rounded-l-md' : 'rounded-md'} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}
      >
        <Printer className="w-3.5 h-3.5" aria-hidden="true" />
        {grand && <span>Imprimer</span>}
      </button>
      {aEchanges && (
        <button
          ref={fleche}
          type="button"
          disabled={occupe}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          aria-label="Choisir le document à imprimer"
          data-testid="imprimer-menu"
          onClick={() => {
            if (menu) return setMenu(null);
            const r = fleche.current?.getBoundingClientRect();
            if (r) setMenu({ top: r.bottom + 4, left: Math.max(8, r.right - 200) });
          }}
          className={`${base} w-6 rounded-r-md border-l-0 border-red-200 bg-red-600 text-white hover:bg-red-700`}
        >
          <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
      {menu && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setMenu(null)} aria-hidden="true" />
          <span
            role="menu"
            className="fixed z-50 w-[200px] rounded-xl border border-slate-200 bg-white py-1 shadow-xl motion-safe:animate-dash-rise"
            style={{ top: menu.top, left: menu.left }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => void imprimer('runsheet')}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <Printer className="w-4 h-4 text-slate-500" aria-hidden="true" /> Runsheet
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void imprimer('echanges')}
              data-testid="imprimer-echanges"
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <ArrowLeftRight className="w-4 h-4 text-slate-500" aria-hidden="true" /> Produits échanges
            </button>
          </span>
        </>
      )}
    </span>
  );
}
