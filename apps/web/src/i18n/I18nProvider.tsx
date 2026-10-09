'use client';

/**
 * Langue courante de l'application.
 *
 * Un contexte unique, monté sur les surfaces traduites, qui fournit la langue,
 * la fonction de traduction et les formateurs liés à cette langue. Les écrans ne
 * reçoivent rien par props et n'importent aucun dictionnaire : ils appellent
 * `useI18n()`.
 *
 * ## Ce que le fournisseur décide, et une seule fois
 *
 *   - `document.documentElement.lang` et `.dir` : la direction d'écriture est une
 *     propriété du document, pas d'un écran. C'est ce qui fait qu'un `<aside>`
 *     se place à droite en arabe sans qu'aucun composant ne le sache ;
 *   - la langue de formatage des formateurs du design system, pour qu'une date
 *     affichée le soit dans la bonne langue sans que l'appelant passe un
 *     paramètre ;
 *   - la langue du design system (`LibellesUIProvider`), pour que pagination,
 *     filtres et libellés de formulaire suivent le même mouvement.
 *
 * ## Portée
 *
 * Le fournisseur est monté par le portail expéditeur et par la connexion, pas par
 * la racine : le back-office n'est pas traduit et ne doit pas bouger. Voir
 * `estSurfaceI18n`, qui définit ce périmètre une seule fois pour être lu aussi
 * par le script de premier rendu.
 *
 * ## Persistance et détection
 *
 * La préférence est enregistrée dans `localStorage` et relue au démarrage : elle
 * survit à la navigation, au rechargement et à la déconnexion. La langue du
 * navigateur n'est consultée qu'en l'absence de préférence — une fois le choix
 * fait, il fait autorité, même s'il contredit la configuration du poste.
 *
 * Changer de langue ne touche pas à la session : le jeton, le rôle et les
 * permissions vivent ailleurs, et un utilisateur qui passe en arabe doit rester
 * connecté.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  LibellesUIProvider,
  definirLangueFormat,
  formatDate as formatDateBase,
  formatDateTime as formatDateTimeBase,
  formatDelai as formatDelaiBase,
  formatTND,
} from '@logixpress/ui';
import {
  CLE_LANGUE,
  DIR_PAR_LANGUE,
  LANGUE_DEFAUT,
  LOCALE_PAR_LANGUE,
  estLangue,
  langueDepuisNavigateur,
  type Langue,
} from './config';
import { ar } from './dictionnaires/ar';
import { libelleActionAudit, traduireTexteServeur } from './textes-serveur';
import { fr, type Cle, type Dictionnaire } from './dictionnaires/fr';

export type { Cle, Langue };

const DICTIONNAIRES: Record<Langue, Dictionnaire> = { fr, ar: ar as Dictionnaire };

/**
 * Familles de valeurs de domaine, telles que le serveur les renvoie.
 *
 * Statuts, types, tailles, modes de paiement, gouvernorats : ces chaînes sont des
 * identifiants de protocole, jamais des mots. Le portail n'affiche jamais la
 * valeur brute — il affiche `traduireValeur`, qui retrouve le mot dans le
 * dictionnaire en partant du même identifiant. La liste est donc la frontière
 * exacte entre ce qui se traduit et ce qui ne se traduit pas.
 */
export const FAMILLES_VALEURS = [
  'statut',
  'type',
  'taille',
  'rdv',
  'bordereauStatut',
  'paiement',
  'etape',
  'gou',
  'moyenPaiement',
  'motif',
  'notif.categorie',
] as const;

export type FamilleValeur = (typeof FAMILLES_VALEURS)[number];

export interface I18n {
  langue: Langue;
  dir: 'ltr' | 'rtl';
  estRTL: boolean;
  /** Locale de formatage : `fr-TN` ou `ar-TN`. */
  locale: string;
  setLangue: (langue: Langue) => void;
  /**
   * Traduit une clé.
   *
   * Les variables `{n}`, `{date}`… sont remplacées par les valeurs fournies. Une
   * clé absente renvoie la clé elle-même, visible dans l'écran : mieux vaut voir
   * `colis.liste.titre` qu'un espace, qui se lit comme une page vide.
   */
  t: (cle: Cle, valeurs?: Record<string, string | number>) => string;
  /**
   * Traduit une valeur de domaine dont la clé est calculée à l'exécution.
   *
   * Un statut arrive du serveur, sa clé ne peut donc pas être écrite en littéral
   * dans l'appel — `t` refuse une clé construite, parce qu'une clé fausse doit
   *appercevoir à la compilation. `traduireValeur('statut', colis.status)` retrouve
   * le mot par recherche, et renvoie la valeur d'origine si le dictionnaire n'a
   * rien pour elle : un statut nouveau côté API reste lisible plutôt que vide.
   */
  traduireValeur: (famille: FamilleValeur, valeur: string | null | undefined) => string;
  /**
   * Texte rédigé par l'API en français (chronologie, motif, phrase d'audit,
   * titre de notification), rendu dans la langue courante. Le texte libre d'un
   * utilisateur reste tel quel. Voir `textes-serveur.ts`.
   */
  traduireServeur: (texte: string | null | undefined) => string;
  /** Libellé d'une action d'audit, à partir de son code. */
  libelleAudit: (code: string, libelleServeur?: string) => string;
  formatDate: (valeur: string | number | Date | null | undefined) => string;
  formatDateTime: (valeur: string | number | Date | null | undefined) => string;
  formatTND: (montant: number | string | null | undefined) => string;
  /** Durée relative, déjà traduite. */
  formatDelai: (valeur: string | number | Date | null | undefined) => string;
}

/**
 * Valeur hors provider.
 *
 * Un composant rendu hors du fournisseur — un test, une story — ne doit pas
 * lever une exception : il s'affiche en français. Le contexte n'est donc jamais
 * nul, et le français reste la valeur par défaut.
 */
const CONTEXTE_PAR_DEFAUT: I18n = {
  langue: LANGUE_DEFAUT,
  dir: 'ltr',
  estRTL: false,
  locale: LOCALE_PAR_LANGUE[LANGUE_DEFAUT],
  setLangue: () => undefined,
  t: (cle, valeurs) => appliquer(fr, cle, valeurs),
  traduireValeur: (famille, valeur) => valeur ?? '',
  traduireServeur: (texte) => texte ?? '',
  libelleAudit: (code, libelleServeur) => libelleServeur ?? code,
  formatDate: formatDateBase,
  formatDateTime: formatDateTimeBase,
  formatTND,
  formatDelai: formatDelaiBase,
};

const Contexte = createContext<I18n>(CONTEXTE_PAR_DEFAUT);

function appliquer(
  dictionnaire: Dictionnaire,
  cle: string,
  valeurs?: Record<string, string | number>
): string {
  const modele = (dictionnaire as Record<string, string>)[cle] ?? cle;
  if (!valeurs) return modele;
  return modele.replace(/\{(\w+)\}/g, (entier, nom: string) =>
    nom in valeurs ? String(valeurs[nom]) : entier
  );
}

/**
 * Libellé d'une valeur de domaine, pour la langue courante.
 *
 * La recherche passe par le dictionnaire, pas par un objet de correspondance
 * construit à la main dans chaque écran : c'est le seul endroit où l'on peut
 * garantir qu'un statut et son libellé restent d'accord, et qu'une famille
 * oubliée en français se remarque.
 *
 * La valeur brute est renvoyée telle quelle en dernier recours. Un statut
 * ajouté côté API la veille s'affiche donc lisible — c'est l'utilisateur qui voit
 * l'anomalie, pas une page vide.
 */
function libelleValeur(dictionnaire: Dictionnaire, famille: FamilleValeur, valeur: string): string {
  return (dictionnaire as Record<string, string>)[`${famille}.${valeur}`] ?? valeur;
}

/**
 * Langue enregistrée, si elle existe et est encore supportée.
 *
 * Une valeur écrite par une version antérieure — ou altérée à la main — ne doit
 * pas casser le rendu : elle est ignorée, et le défaut reprend la main.
 */
function langueEnregistree(): Langue | null {
  try {
    const brute = window.localStorage.getItem(CLE_LANGUE);
    return estLangue(brute) ? brute : null;
  } catch {
    // Navigation privée, stockage refusé : on reste sur la langue du navigateur.
    return null;
  }
}

/**
 * Langue du premier rendu React, lue avant la peinture.
 *
 * Le script posé dans `<head>` a déjà appliqué la langue enregistrée sur
 * `<html>` — direction comprise, sans quoi la page s'afficherait une fois en
 * français avant de passer en arabe. Lire la même valeur ici évite au premier
 * rendu React de repartir du français et de faire revenir l'écran en miroir une
 * fois l'hydratation faite.
 * L'attribut est la source de vérité parce qu'il est le seul à avoir été
 * appliqué à l'écran.
 */
function langueInitiale(): Langue {
  if (typeof document === 'undefined') return LANGUE_DEFAUT;
  return estLangue(document.documentElement.lang) ? document.documentElement.lang : LANGUE_DEFAUT;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  /*
   * Le français est la valeur de premier rendu : le serveur ne sait pas quelle
   * langue est enregistrée, et afficher l'arabe puis le français à l'hydratation
   * ferait clignoter toute la page. Sur le portail, le script de premier rendu
   * a déjà posé `dir` avant la peinture ; cet effet ne fait qu'aligner l'état
   * React sur ce qui est déjà à l'écran, sans repasser par le français.
   */
  const [langue, setLangueEtat] = useState<Langue>(langueInitiale());

  useEffect(() => {
    const enregistree = langueEnregistree();
    const initiale =
      enregistree ??
      langueDepuisNavigateur(navigator.languages ?? [navigator.language ?? LANGUE_DEFAUT]);
    if (initiale !== langue) setLangueEtat(initiale);
    // Au premier rendu seulement : ensuite la décision appartient à l'utilisateur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Propriétés du document + langue de formatage, dans un seul effet.
  useEffect(() => {
    const dir = DIR_PAR_LANGUE[langue];
    document.documentElement.lang = langue;
    document.documentElement.dir = dir;
    definirLangueFormat(langue);
  }, [langue]);

  const setLangue = useCallback((suivante: Langue) => {
    setLangueEtat(suivante);
    try {
      window.localStorage.setItem(CLE_LANGUE, suivante);
    } catch {
      // Préférence non conservée : la langue reste active pour la session.
    }
  }, []);

  const valeur = useMemo<I18n>(() => {
    const dictionnaire = DICTIONNAIRES[langue];
    const statut = (code: string) => libelleValeur(dictionnaire, 'statut', code);
    return {
      langue,
      dir: DIR_PAR_LANGUE[langue],
      estRTL: DIR_PAR_LANGUE[langue] === 'rtl',
      locale: LOCALE_PAR_LANGUE[langue],
      setLangue,
      t: (cle, valeurs) => appliquer(dictionnaire, cle, valeurs),
      traduireValeur: (famille, valeur) => libelleValeur(dictionnaire, famille, valeur ?? ''),
      traduireServeur: (texte) => traduireTexteServeur(texte, langue, statut),
      libelleAudit: (code, libelleServeur) => libelleActionAudit(code, libelleServeur, langue, statut),
      formatDate: formatDateBase,
      formatDateTime: formatDateTimeBase,
      formatTND,
      formatDelai: formatDelaiBase,
    };
  }, [langue, setLangue]);

  return (
    <Contexte.Provider value={valeur}>
      <LibellesUIProvider langue={langue}>{children}</LibellesUIProvider>
    </Contexte.Provider>
  );
}

export function useI18n(): I18n {
  return useContext(Contexte);
}