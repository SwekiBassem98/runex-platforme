/**
 * Point d'entrée de l'internationalisation.
 *
 * Les écrans importent d'ici, jamais des fichiers internes : `@/i18n` pour le
 * contexte et les types, `@/i18n/config` quand une liste a besoin des langues
 * elles-mêmes.
 */

export {
  I18nProvider,
  useI18n,
  FAMILLES_VALEURS,
  type I18n,
  type Cle,
  type FamilleValeur,
  type Langue,
} from './I18nProvider';
export { SelecteurLangue } from './SelecteurLangue';
export { SCRIPT_PREMIER_RENDU } from './premier-rendu';
export {
  LANGUES,
  LANGUE_DEFAUT,
  CLE_LANGUE,
  DIR_PAR_LANGUE,
  LOCALE_PAR_LANGUE,
  NOM_LANGUE,
  SURFACES_I18N,
  estLangue,
  estSurfaceI18n,
  langueDepuisNavigateur,
} from './config';