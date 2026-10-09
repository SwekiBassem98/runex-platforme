/**
 * Configuration des langues de la plateforme.
 *
 * Le français est la langue de travail : c'est celle des dossiers, des statuts
 * métier et de l'exploitation. L'arabe n'est pas une traduction de confort, c'est
 * la langue de la clientèle — d'où une direction de document à part entière.
 *
 * Les deux listes ci-dessous sont les seules à faire foi : `LANGUES` alimente le
 * sélecteur, `DIR_PAR_LANGUE` décide du sens d'écriture, `LOCALE_PAR_LANGUE`
 * décide du format des dates. Aucun écran ne redéfinit ces trois choses.
 */

export const LANGUES = ['fr', 'ar'] as const;

export type Langue = (typeof LANGUES)[number];

export const LANGUE_DEFAUT: Langue = 'fr';

/**
 * Clé de persistance.
 *
 * Volontairement dans le même espace de noms que le reste de l'application
 * (`runex:*`), et non `i18nextLng` : la préférence est un réglage de la
 * plateforme, pas une variable propre à une bibliothèque.
 */
export const CLE_LANGUE = 'runex.langue';

export const DIR_PAR_LANGUE: Record<Langue, 'ltr' | 'rtl'> = {
  fr: 'ltr',
  ar: 'rtl',
};

/**
 * Locales de formatage.
 *
 * `fr-TN` et `ar-TN` partagent le fuseau et le calendrier, mais pas les noms de
 * mois ni l'ordre des composantes. La date du 4 octobre s'écrit `04/10/2026` en
 * français et `04 أكتوبر 2026` en arabe : c'est le formatage natif qui décide, et
 * non une chaîne construite à la main.
 *
 * Le suffixe `-u-nu-latn` est délibéré. `Intl` applique à l'arabe le système de
 * numération oriental — ٤ octobre — alors que les montants de la plateforme
 * restent en chiffres latins, comme sur toute facture tunisienne. Sans ce
 * suffixe, un même écran affiche `04/10/2026` en montant et `٠٤/١٠/٢٠٢٦` en
 * date : deux systèmes de chiffres sur une même ligne de tableau, où l'on
 * compare des dates à des montants. Le Maghreb n'utilise pas les chiffres
 * orientaux ; on demande donc explicitement ceux qui s'écrivent `0` à `9`.
 */
export const LOCALE_PAR_LANGUE: Record<Langue, string> = {
  fr: 'fr-TN',
  ar: 'ar-TN-u-nu-latn',
};

/** Libellé de chaque langue, dans cette langue. */
export const NOM_LANGUE: Record<Langue, string> = {
  fr: 'Français',
  ar: 'العربية',
};

export function estLangue(valeur: unknown): valeur is Langue {
  return typeof valeur === 'string' && (LANGUES as readonly string[]).includes(valeur);
}

/**
 * Surfaces où la langue de l'utilisateur s'applique.
 *
 * L'arabe est la langue de la clientèle, pas celle du back-office : les écrans
 * d'exploitation sont en français et ne sont pas traduits. La langue est donc
 * appliquée à tout `/expediteur` — la connexion du client comprise — et nulle
 * part ailleurs.
 *
 * Une application globale aurait deux défauts. Le premier est visible : un poste
 * de dépôt ouvre le portail en arabe, puis l'administration — dont les libellés
 * restent en français — se retrouverait en miroir, avec une barre latérale à
 * droite et des dates arabes sous des titres français. Le second est plus
 * discret et plus grave : un expéditeur qui choisit l'arabe verrait ensuite le
 * back-office se souvenir de ce choix, alors que ses écrans ne savent pas le
 * rendre.
 *
 * `/mot-de-passe-oublie` et `/reinitialisation` en font partie : un expéditeur
 * y arrive depuis son portail ou depuis le courriel, dans sa langue.
 *
 * `/connexion` est volontairement absent : c'est la porte d'entrée de l'équipe
 * interne, sur le même modèle que le back-office.
 *
 * Cette liste est l'unique définition du périmètre. Elle est lue à deux moments :
 * par le script de premier rendu (avant l'hydratation, pour que la page ne
 * s'affiche pas en français avant de passer en arabe) et par le fournisseur de
 * langue. Les deux doivent décider pareil — d'où une fonction, et non deux
 * listes comparées à la main.
 */
export const SURFACES_I18N: readonly string[] = ['/expediteur', '/mot-de-passe-oublie', '/reinitialisation'];

/** Le chemin appartient-il à une surface traduite ? */
export function estSurfaceI18n(chemin: string): boolean {
  return SURFACES_I18N.some((surface) => chemin === surface || chemin.startsWith(`${surface}/`));
}

/**
 * Langue déduite du navigateur, au premier visit seulement.
 *
 * La détection se limite à l'espace de noms linguistique : `ar-TN`, `ar-EG` et
 * `ar` ouvrent l'interface en arabe, tout le reste reste en français. Elle
 * n'intervient que si aucune préférence n'est enregistrée, et une fois la
 * session ouverte, la session decide.
 */
export function langueDepuisNavigateur(langues: readonly string[]): Langue {
  for (const tag of langues) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'ar') return 'ar';
    if (base === 'fr') return 'fr';
  }
  return LANGUE_DEFAUT;
}