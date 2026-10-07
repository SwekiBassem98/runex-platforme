'use client';

/**
 * Fournisseur de langue du design system.
 *
 * Un contexte unique, monté par l'application, qui donne à tous les composants
 * les libellés de la langue courante. Sans lui, le français reste la valeur par
 * défaut : les pages d'exploitation ne changent pas d'apparence tant qu'elles
 * n'ont pas été traduites.
 *
 * L'intérêt est qu'aucun composant n'a à recevoir une dizaine de props
 * traduisibles, et qu'un mot ajouté au design system existe en français et en
 * arabe dès sa création : c'est le typage du dictionnaire qui l'exige, pas une
 * relecture.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { LIBELLES_AR, LIBELLES_FR, type LibellesUI } from './libelles';
import { interpoler } from './interpoler';

export type LangueUI = 'fr' | 'ar';

interface ContexteUI {
  langue: LangueUI;
  libelles: LibellesUI;
  /** Remplace `{n}`, `{libelle}` et assimilés. */
  format: (modele: string, valeurs?: Record<string, string | number>) => string;
}

const Contexte = createContext<ContexteUI>({
  langue: 'fr',
  libelles: LIBELLES_FR,
  format: (modele, valeurs) => interpoler(modele, valeurs),
});

export function LibellesUIProvider({
  langue,
  children,
}: {
  langue: LangueUI;
  children: React.ReactNode;
}) {
  const valeur = useMemo<ContexteUI>(
    () => ({
      langue,
      libelles: langue === 'ar' ? LIBELLES_AR : LIBELLES_FR,
      format: interpoler,
    }),
    [langue]
  );
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useLibellesUI(): ContexteUI {
  return useContext(Contexte);
}