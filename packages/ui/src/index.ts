/**
 * @logixpress/ui
 * Bibliothèque de composants et design system moderne pour la plateforme logistique RUNEX.
 * Palette : Rouge (#DC2626), Noir (#121417), Blanc (#FFFFFF), Gris (Slate 50 - 900).
 *
 * Langues : français par défaut, arabe disponible. Les libellés propres au design
 * system vivent dans `i18n/libelles.ts` et sont fournis par
 * `LibellesUIProvider` ; sans provider, les composants restent en français.
 */

import { PACKAGE_STATUS_LABELS, type Money, type PackageStatus } from '@logixpress/types';
import { LIBELLES_AR, LIBELLES_FR } from './i18n/libelles';
import { interpoler } from './i18n/interpoler';

// 1. App Shell & Layout
export * from './components/AppShell';
export * from './components/Sidebar';
export * from './components/TopNavigation';
export * from './components/Breadcrumbs';
export * from './components/PageHeader';

// 2. Data Display & Conteneurs
export * from './components/Card';
export * from './components/Table';
export * from './components/Badge';
export * from './components/StatusIndicator';
export * from './components/Tabs';
export * from './components/Pagination';

// 3. Formulaires & Filtres
export * from './components/Form';
export * from './components/SearchInput';
export * from './components/Filters';

// 4. Overlays & Dialogues
export * from './components/Modal';
export * from './components/Drawer';
export * from './components/ConfirmDialog';
export * from './components/Toast';

// 5. États Système & Retours Utilisateur
export * from './components/EmptyState';
export * from './components/Loading';
export * from './components/Skeleton';
export * from './components/ErrorState';

// 6. Visualisations & Graphiques
export * from './components/Charts';

// 7. Langues
export * from './i18n/libelles';
export * from './i18n/interpoler';
export * from './i18n/LibellesUIProvider';

// 8. Constantes & Helpers Monétaires
export * from './hooks/useInterface';

export const THEME_COLORS = {
  black: '#121417',
  darkGrey: '#1F242C',
  mediumGrey: '#64748B',
  lightGrey: '#F1F5F9',
  borderGrey: '#E2E8F0',
  white: '#FFFFFF',
  redPrimary: '#DC2626',
  redHover: '#B91C1C',
  redSubtle: '#FEE2E2',
  greenSuccess: '#16A34A',
  amberWarning: '#D97706',
};

/**
 * Langue de formatage courante.
 *
 * Les formateurs de dates et de durées sont utilisés partout, sans qu'un écran
 * ait à leur passer une langue : les faire dépendre d'un paramètre à chaque
 * appel serait une source d'oubli, et un oubli se voit — une date française
 * dans un écran arabe.
 *
 * La langue active est donc posee une fois, par le fournisseur de langue de
 * l'application. Elle ne remplace pas un paramètre explicite : un appel qui
 * demande une locale précise l'obtient toujours.
 */
let langueFormat: 'fr' | 'ar' = 'fr';

/** Locale de formatage des dates et durées. */
export function definirLangueFormat(langue: 'fr' | 'ar'): void {
  langueFormat = langue;
}

export function langueFormatActive(): 'fr' | 'ar' {
  return langueFormat;
}

const LOCALE_PAR_LANGUE_FORMAT: Record<'fr' | 'ar', string> = {
  fr: 'fr-TN',
  /*
   * `-u-nu-latn` demande les chiffres latins en contexte arabe.
   *
   * `Intl` applique par défaut à l'arabe le système oriental — ٠٤/١٠/٢٠٢٦ — alors
   * que les montants de la plateforme s'affichent toujours en chiffres latins
   * (voir `formatTND`). Sans ce suffixe, une ligne de tableau dActivities mêle les
   * deux systèmes, et l'œil ne sait plus si ٤ et 4 sont le même chiffre.
   */
  ar: 'ar-TN-u-nu-latn',
};

/**
 * Séparateur de milliers, en typographie française.
 *
 * Les montants de cette plateforme dépassent le million de dinars dès qu'on
 * additionne les bordereaux d'une semaine. Écrit `1284500.890 DT`, ce nombre
 * forme un bloc de quatorze caractères sans espace : l'œil ne le découpe pas, et
 * l'utilisateur perd le compte des groupes de trois. Écrit `1 284 500,890 DT`,
 * il se lit. La virgule décimale va avec : un point en position décimale se lit
 * comme un séparateur de milliers dans une culture française, et le doute
 * s'installe sur le chiffre le plus important de l'ecran.
 *
 * L'espace insécable tient la ligne : une espace ordinaire permettrait à un montant
 * d'être coupé après « 1 284 », ce qui changerait le nombre lu.
 */
const ESPACE_INSECABLE = '\u00a0';

/** Découpe une chaîne de chiffres en groupes de trois, sans passer par un nombre. */
function groupes(brut: string): string {
  return brut.replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE_INSECABLE);
}

/**
 * Normalise un montant en trois décimales, sans jamais passer par un flottant.
 *
 * Le dinar est un décimal en base, et un nombre flottant ne sait pas le
 * représenter : `58.105` peut ressortir `58.104999999`. Sur un rapport de caisse
 * — ou l'on additionne des centaines de lignes et ou un millime de trop se voit —
 * l'écart d'affichage n'est pas acceptable. La chaîne est donc découpée et
 * complétée, et la valeur affichée est exactement celle que la base a stockée.
 */
function troisDecimales(montant: number | string | null | undefined): string {
  if (montant === null || montant === undefined || montant === '') return '0,000';
  const source =
    typeof montant === 'number'
      ? Number.isFinite(montant)
        ? montant.toFixed(3)
        : '0'
      : String(montant).trim();

  // La forme relue accepte ce que la forme produite émet : séparateur de
  // milliers et notation exponentielle. Sans cela, un montant déjà formaté qui
  // repasse par le formateur ressortait tel quel — et copier un montant depuis
  // un tableau pour le coller dans un filtre ne fonctionnait pas.
  const sansEspaces = source.replace(/[\u00a0\u202f ]/g, '');
  const exponentielle = /^([+-]?[0-9.]+)[eE]([+-]?[0-9]+)$/.exec(sansEspaces);
  // Seule la notation exponentielle repasse par un nombre. Tout le reste reste
  // en chaîne : c'est précisément ce que la fonction s'interdit de faire.
  const normalisee = exponentielle
    ? (Number(exponentielle[1]) * Math.pow(10, Number(exponentielle[2]))).toFixed(3)
    : sansEspaces;

  const correspondance = /^([+-]?)([0-9]*)(?:[.,]([0-9]*))?$/.exec(normalisee);
  if (!correspondance) return source;
  const [, signe, entiers = '', decimales = ''] = correspondance;
  const sansZeros = (entiers || '0').replace(/^0+(?=\d)/, '');
  const prefixe = signe === '-' ? '-' : signe === '+' ? '' : '';
  return `${prefixe}${groupes(sansZeros)},${decimales.padEnd(3, '0').slice(0, 3)}`;
}

/**
 * Montant en dinars, avec séparateur de milliers et virgule décimale.
 *
 * `1 284 500,890 DT`. C'est le format unique de la plateforme : `formatTND` et
 * `formatMoney` convergeaient vers deux rendus différents — l'un sans séparateur
 * et passant par un flottant, l'autre exact — et les deux cohabitaient dans le
 * même module de caisse, où le même montant s'affichait différemment selon
 * l'écran. Un relevé de caisse doit se lire partout de la même façon.
 */
export function formatTND(amount: number | string | null | undefined): string {
  return `${troisDecimales(amount)}${ESPACE_INSECABLE}DT`;
}

/** Alias de `formatTND`, pour les montants issus de la base. */
export function formatMoney(amount: Money | null | undefined): string {
  return formatTND(amount);
}

/** Montant sans la devise — pour les en-têtes de colonne et les tableaux denses. */
export function formatMontant(amount: number | string | null | undefined): string {
  return troisDecimales(amount);
}

/**
 * Date et heure, au format tunisien.
 *
 * `Date` s'affiche différemment selon la locale du navigateur : un poste en
 * français et un poste en anglais ne montrent pas la même date pour le même
 * paiement, et l'ordre jour/mois s'inverse — source classique d'un virement lu
 * au mauvais jour. La locale est donc forcée.
 */
export function formatDateTime(valeur: string | number | Date | null | undefined): string {
  if (!valeur) return '\u2014';
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return '\u2014';
  return new Intl.DateTimeFormat(LOCALE_PAR_LANGUE_FORMAT[langueFormat], {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Date seule : `12/03/2026`. */
export function formatDate(valeur: string | number | Date | null | undefined): string {
  if (!valeur) return '\u2014';
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return '\u2014';
  return new Intl.DateTimeFormat(LOCALE_PAR_LANGUE_FORMAT[langueFormat], {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/** Heure seule : `14:30`. */
export function formatHeure(valeur: string | number | Date | null | undefined): string {
  if (!valeur) return '\u2014';
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return '\u2014';
  return new Intl.DateTimeFormat(LOCALE_PAR_LANGUE_FORMAT[langueFormat], {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Durée écoulée en clair : « il y a 4 min », « il y a 3 jours ».
 *
 * Une date brute dans une liste de notifications oblige à calculer l'ancienneté
 * de chaque ligne. Sur un écran d'exploitation, c'est l'ancienneté qui est utile
 * — pas la date, déjà visible ailleurs.
 */
export function formatDelai(valeur: string | number | Date | null | undefined): string {
  if (!valeur) return '\u2014';
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return '\u2014';
  const secondes = Math.round((Date.now() - date.getTime()) / 1000);
  const l = langueFormat === 'ar' ? LIBELLES_AR : LIBELLES_FR;
  const dire = (modele: string, n: number) => interpoler(modele, { n });

  if (secondes < 60) return l['delai.moment'];
  const minutes = Math.floor(secondes / 60);
  if (minutes < 60) return dire(l['delai.minutes'], minutes);
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return dire(l['delai.heures'], heures);
  const jours = Math.floor(heures / 24);
  if (jours < 31) return dire(l['delai.jours'], jours);
  const mois = Math.floor(jours / 30);
  if (mois < 12) return dire(l['delai.mois'], mois);
  const ans = Math.floor(mois / 12);
  // Le pluriel français porte deux formes ; l'arabe distingue aussi le singulier
  // et le pluriel, mais son pluriel canonique est « سنوات ».
  return ans > 1 ? dire(l['delai.annees'], ans) : dire(l['delai.annee'], ans);
}

/**
 * Habillage des statuts de colis : couleurs et libellés.
 *
 * Le libellé vient de `PACKAGE_STATUS_LABELS`, dans le paquet partagé, et non
 * d'une chaîne répétée ici. Une notification produite par l'API et une pastille
 * affichée par un écran décrivent le même statut : si les deux avaient leurs
 * propres mots, un livreur chercherait « Reporté » dans une liste qui ne
 * contient que « Reporté » — mais une caisse qui lit « Reporté » dans un
 * journal d'audit et « Reporté » sur son écran, non plus. Une seule table de
 * mots supprime la question.
 */
const statusStyle: Record<string, { bg: string; text: string; border: string }> = {
  CREE: { bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-300' },
  RAMASSAGE_PROGRAMME: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
  RAMASSE: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  RECU_DEPOT: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  EN_LOT_INTER_DEPOT: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  EN_TRANSIT_INTER_DEPOT: { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300' },
  RECU_DEPOT_DESTINATION: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
  AFFECTE_RUNSHEET: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  EN_COURS_LIVRAISON: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  LIVRE: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300' },
  LIVRAISON_PARTIELLE: { bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-cyan-300' },
  REPORTE: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  ECHEC_LIVRAISON: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  RETOUR_DEPOT: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  EN_RUNSHEET_RETOUR: { bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', border: 'border-fuchsia-200' },
  RETOURNE_EXPEDITEUR: { bg: 'bg-neutral-100', text: 'text-neutral-700', border: 'border-neutral-300' },
  ANNULE: { bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-200' },
};

export const PACKAGE_STATUS_MAP: Record<
  string,
  { label: string; bg: string; text: string; border: string }
> = Object.fromEntries(
  Object.entries(statusStyle).map(([status, style]) => [
    status,
    { label: PACKAGE_STATUS_LABELS[status as PackageStatus] ?? status, ...style },
  ])
);