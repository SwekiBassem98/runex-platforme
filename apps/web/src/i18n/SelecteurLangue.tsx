'use client';

/**
 * Sélecteur de langue.
 *
 * Un segment par langue, dans la langue elle-même : « Français » ne s'écrit pas
 * « French » dans une liste de choix de langue, et « العربية » ne s'écrit pas en
 * caractères latins. C'est la seule forme qui reste lisible pour quelqu'un qui
 * ne sait pas lire l'autre alphabet.
 *
 * Le composant ne manipule aucune session : il appelle `setLangue`, qui écrit la
 * préférence et bascule `document.documentElement.dir`. Passer de français en
 * arabe laisse l'utilisateur connecté, sur la même page.
 *
 * `dir="ltr"` est posé explicitement sur le conteneur : en arabe, un mot latin
 * isolé dans une phrase se range de gauche à droite, et un mélange
 * français/arabe aligné à droite devient illisible.
 */

import React from 'react';
import { Check, Languages } from 'lucide-react';
import { LANGUES, NOM_LANGUE, type Langue } from './config';
import { useI18n } from './I18nProvider';

export function SelecteurLangue({ compact = false }: { compact?: boolean }) {
  const { langue, setLangue, t } = useI18n();
  const [ouvert, setOuvert] = React.useState(false);
  const conteneur = React.useRef<HTMLDivElement>(null);

  // Un clic dehors referme la liste, comme partout ailleurs.
  React.useEffect(() => {
    if (!ouvert) return;
    const surClic = (event: MouseEvent) => {
      if (!conteneur.current?.contains(event.target as Node)) setOuvert(false);
    };
    const surTouche = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOuvert(false);
    };
    document.addEventListener('mousedown', surClic);
    document.addEventListener('keydown', surTouche);
    return () => {
      document.removeEventListener('mousedown', surClic);
      document.removeEventListener('keydown', surTouche);
    };
  }, [ouvert]);

  const choisir = (suivante: Langue) => {
    setLangue(suivante);
    setOuvert(false);
  };

  return (
    <div className="relative" ref={conteneur}>
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        aria-haspopup="listbox"
        aria-label={t('connexion.langue')}
        className={`flex items-center gap-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer ${
          compact ? 'p-2' : 'px-2.5 py-1.5 border border-slate-200 text-xs font-medium'
        }`}
      >
        <Languages className="w-4 h-4 shrink-0" aria-hidden="true" />
        {!compact && <span dir="ltr">{NOM_LANGUE[langue]}</span>}
      </button>

      {ouvert && (
        <ul
          role="listbox"
          aria-label={t('connexion.langue')}
          className="absolute end-0 mt-1 z-50 min-w-40 rounded-md bg-white border border-slate-200 shadow-lg py-1"
        >
          {LANGUES.map((code) => {
            const actif = code === langue;
            return (
              <li key={code} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={actif}
                  onClick={() => choisir(code)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-start text-xs transition cursor-pointer ${
                    actif
                      ? 'bg-red-50 text-red-700 font-semibold'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {/* Le nom de la langue est toujours écrit dans sa propre
                      direction : « Français » à gauche, « العربية » à droite. */}
                  <span dir={DIR_NOM[code]} lang={code}>
                    {NOM_LANGUE[code]}
                  </span>
                  {actif && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Direction d'écriture du nom de la langue, indépendamment de l'interface. */
const DIR_NOM: Record<Langue, 'ltr' | 'rtl'> = { fr: 'ltr', ar: 'rtl' };
