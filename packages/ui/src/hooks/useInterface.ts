/**
 * Crochets partagés par les composants d'interface.
 *
 * Ils sont ici plutôt que dans les composants parce que trois d'entre eux
 * concernsent le *même* problème de deux côtés : une modale, un tiroir et la
 * navigation mobile sont trois façons de présenter un calque par-dessus la page.
 * Il faut donc qu'ils se comportent pareil — piège de focus, retour du focus,
 * fermeture par Échap, verrouillage du défilement — et le plus sûr moyen
 * d'y arriver est d'écrire le comportement une fois.
 */

'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Suit une requête média, pour les adaptations qui ne peuvent pas se faire en
 * CSS seul.
 *
 * Le cas typique est une table de vingt colonnes : le CSS peut la faire
 * défiler horizontalement, mais pas choisir entre « tableau » et « fiches »,
 * parce que la décision dépend du contenu affiché et non de la largeur de la
 * fenêtre — un panneau de détail ouvert doit rester un tableau.
 *
 * Le nom est une media query CSS, sans les parenthèses.
 */
export function useMediaQuery(requete: string): boolean {
  const [correspond, setCorrespond] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(requete).matches;
  });

  useEffect(() => {
    const liste = window.matchMedia(requete);
    const onChange = (event: MediaQueryListEvent) => setCorrespond(event.matches);
    setCorrespond(liste.matches);
    liste.addEventListener('change', onChange);
    return () => liste.removeEventListener('change', onChange);
  }, [requete]);

  return correspond;
}

/** Points de rupture utilisés dans toute l'application. */
export const POINT = {
  /** En dessous : la navigation devient un calque, les tableaux deviennent des fiches. */
  compacte: '(max-width: 1023px)',
  /** Téléphone : une seule colonne, une barre d'action pleine largeur. */
  telephone: '(max-width: 639px)',
  /** Tablette en paysage et petit portable : l'interface respire. */
  confortable: '(min-width: 1280px)',
  /** Respecte la préférence système de mouvement réduit. */
  mouvementReduit: '(prefers-reduced-motion: reduce)',
} as const;

/**
 * Empilement des éléments focusables d'un conteneur.
 *
 * La requête est volontairement écrite à la main plutôt quedeleguée à une
 * bibliothèque : elle ne retient que ce qui est réellement atteignable, dans
 * l'ordre du document, et elle ne dépend pas d'un observateur qui doit être
 * reconfiguré à chaque rendu.
 */
function focusables(racine: HTMLElement): HTMLElement[] {
  const selecteur = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(',');

  return Array.from(racine.querySelectorAll<HTMLElement>(selecteur)).filter(
    (element) =>
      // `offsetParent` est nul sur un élément masqué, et `<details>` replié
      // aussi : les deux sont des focusables qu'il ne faut pas propose au
      // clavier — le navigateur les ignorerait et le focus disparaîtrait.
      element.offsetParent !== null &&
      !element.hasAttribute('inert') &&
      element.getAttribute('aria-hidden') !== 'true'
  );
}

export interface OptionsCalque {
  /** Le calque est-il ouvert ? Le comportement ne s'applique qu'alors. */
  ouvert: boolean;
  /** Fermeture demandée — touche Échap ou clic sur le fond. */
  onFermer: () => void;
  /** Le calque est-il une modale qui doit voler le focus ? Un tiroir de navigation, non. */
  piegeFocus?: boolean;
  /** Déclencheur à DALLE à la fermeture, pour rendre le focus à l'endroit d'où il venait. */
  refDeclencheur?: React.RefObject<HTMLElement | null>;
}

/**
 * Le comportement commun aux calques.
 *
 * Trois choses manquent presque toujours à une modale, et les trois se
 * conquering à l'utilisateur :
 *
 * - **le piège de focus.** Tabulation parcourt la page *derrière* la modale,
 *   ce qui est activelyFolders trompeur : le focus part sur un bouton qu'on ne
 *   voit pas, et rien n'indique pourquoi la tabulation semble ne rien faire.
 * - **le retour du focus.** À la fermeture, le focus tombe sur `<body>`, et la
 *   tabulation repart du haut de la page. Sur un écran à filtres, cela
 *   signifie reprendre depuis le début après chaque ouverture.
 * - **le verrouillage du défilement** sansResize de la page, sinon l'arrière
 *   défile sous la modale.
 *
 * Le verrouillage réserve la gouttière de la barre de défilement : sans cela,
 * le passage de « avec barre » à « sans barre » décale la page de 15 px au
 * moment exact où l'on ouvre une modale.
 */
export function useComportementCalque<T extends HTMLElement = HTMLDivElement>({
  ouvert,
  onFermer,
  piegeFocus = true,
  refDeclencheur,
}: OptionsCalque) {
  const refCalque = useRef<T>(null);
  const onFermerRef = useRef(onFermer);
  onFermerRef.current = onFermer;

  // Focus au premier élément focusable du calque.
  useLayoutEffect(() => {
    if (!ouvert || !piegeFocus) return;
    const racine = refCalque.current;
    if (!racine) return;

    const cible =
      racine.querySelector<HTMLElement>('[data-focus-initial]') ??
      focusables(racine)[0] ??
      racine;

    // `requestAnimationFrame` laisse passer le rendu : chercher un focusable
    // dans la même passe que le montage le rate systématiquement, et le focus
    // tombe alors sur le corps du document.
    const id = requestAnimationFrame(() => cible.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [ouvert, piegeFocus]);

  // Échap, et piège de Tabulation.
  useEffect(() => {
    if (!ouvert) return;

    const surTouche = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onFermerRef.current();
        return;
      }
      if (event.key !== 'Tab' || !piegeFocus) return;

      const racine = refCalque.current;
      if (!racine) return;
      const liste = focusables(racine);
      if (liste.length === 0) {
        event.preventDefault();
        return;
      }
      const premier = liste[0];
      const dernier = liste[liste.length - 1];
      const actif = document.activeElement;

      if (event.shiftKey && (actif === premier || actif === racine)) {
        event.preventDefault();
        dernier.focus();
      } else if (!event.shiftKey && actif === dernier) {
        event.preventDefault();
        premier.focus();
      }
    };

    document.addEventListener('keydown', surTouche, true);
    return () => document.removeEventListener('keydown', surTouche, true);
  }, [ouvert, piegeFocus]);

  // Verrouillage du défilement de la page.
  useEffect(() => {
    if (!ouvert) return;
    const { body } = document;
    const largeurBarre = window.innerWidth - racineLargeur();
    const overflowInitial = body.style.overflow;
    const paddingInitial = body.style.paddingRight;

    body.style.overflow = 'hidden';
    if (largeurBarre > 0) body.style.paddingRight = `${largeurBarre}px`;

    return () => {
      body.style.overflow = overflowInitial;
      body.style.paddingRight = paddingInitial;
    };
  }, [ouvert]);

  // Retour du focus à la fermeture.
  useEffect(() => {
    if (ouvert) return;
    const declencheur = refDeclencheur?.current;
    if (declencheur && document.contains(declencheur)) {
      declencheur.focus({ preventScroll: true });
    }
  }, [ouvert, refDeclencheur]);

  return refCalque;
}

function racineLargeur(): number {
  return document.documentElement.clientWidth;
}

/**
 * Ferme sur Échap et rend le focus à l'élément qui l'a ouvert.
 *
 * Pour un menu et une liste déroulante : ce ne sont pas des modales, on ne doit
 * donc pas confisquer le focus — mais ils doivent se fermer au clavier, ce que
 * leur bouton ne fait pas.
 */
export function useFermetureAuClavier(
  ouvert: boolean,
  onFermer: () => void,
  refDeclencheur?: React.RefObject<HTMLElement | null>
) {
  const onFermerRef = useRef(onFermer);
  onFermerRef.current = onFermer;

  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onFermerRef.current();
    };
    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, [ouvert]);

  useEffect(() => {
    if (ouvert) return;
    const declencheur = refDeclencheur?.current;
    if (declencheur && document.contains(declencheur)) {
      declencheur.focus({ preventScroll: true });
    }
  }, [ouvert, refDeclencheur]);
}

/** Identifiant stable pour lier un libellé à son champ. */
export function useId(prefixe: string, suffixe?: string): string {
  const ref = useRef<string | undefined>(undefined);
  if (ref.current === undefined) {
    ref.current = `${prefixe}-${Math.random().toString(36).slice(2, 9)}${suffixe ?? ''}`;
  }
  return ref.current;
}

/**
 * Réinitialise une valeur quand une clé change.
 *
 * Utile pour les champs pilotés par l'URL : revenir sur l'écran « colis »
 * après avoir consulté un colis doit laisser le formulaire vide, pas carries
 * le nom du dernier client saisi.
 */
export function useResetSurChangement<T>(valeur: T, cle: string): T {
  const [etat, setEtat] = useState<{ cle: string; valeur: T }>({ cle, valeur });
  if (etat.cle !== cle) setEtat({ cle, valeur });
  return etat.cle === cle ? valeur : etat.valeur;
}

/** Annule une valeur qui change trop vite — utile pour la recherche au clavier. */
export function useDifferee<T>(valeur: T, delai = 300): T {
  const [differee, setDifferee] = useState(valeur);
  useEffect(() => {
    const id = setTimeout(() => setDifferee(valeur), delai);
    return () => clearTimeout(id);
  }, [valeur, delai]);
  return differee;
}

/**
 * Empile les gestionnaires de touche.
 *
 * Une touche d'échappement doit d'abord fermer ce qui est au-dessus : le
 * sous-menu, puis le menu, puis la modale. Sans ordre explicite, le même
 * gestionnaireReply en cascade et le premier arrivé ferme tout — ou rien.
 */
export function useTouche(
  touche: string,
  gestionnaire: (event: KeyboardEvent) => void,
  actif = true
) {
  const ref = useRef(gestionnaire);
  ref.current = gestionnaire;

  const surTouche = useCallback((event: KeyboardEvent) => {
    if (event.key === touche) ref.current(event);
  }, [touche]);

  useEffect(() => {
    if (!actif) return;
    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, [surTouche, actif]);
}