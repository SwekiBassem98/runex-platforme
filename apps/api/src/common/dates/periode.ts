/**
 * Bornes de période, partagées par les écrans qui filtrent sur une plage de
 * dates.
 *
 * Le code avait quatre implémentations, dont trois se trompaient différemment.
 * La règle retenue est la seule qui ne se trompe pas :
 *
 * - une date seule est lue à **minuit UTC**, pour que « le 12 » désigne le
 *   même ensemble d'événements quelle que soit l'heure du navigateur ;
 * - la borne haute est **exclusive et portée au lendemain**, pour que « jusqu'au
 *   12 » n'exclue pas ce qui s'est passé le 12 à 14 h — l'erreur la plus
 *   naturelle et la plus coûteuse sur un relevé financier.
 *
 * L'audit avait la borne haute inclusive, et la caisse omettait purement et
 * simple la période quand elle n'était pas saisie ; les rapports ne doivent pas
 * hériter de ces deux errements.
 */

/** Borne de période, telle que Prisma l'attend sur un `timestamptz`. */
export interface Periode {
  gte?: Date;
  lt?: Date;
}

/** Vrai si la valeur est une date seule, `AAAA-MM-JJ`. */
function estDateSeule(valeur: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(valeur);
}

/**
 * Convertit une borne textuelle en date.
 *
 * @param valeur     `AAAA-MM-JJ` ou une horodatage complet.
 * @param finDeJour  Porter au lendemain du jour demandé, pour une borne haute.
 */
/**
 * Instant UTC correspondant à 00:00 à Tunis pour la date `AAAA-MM-JJ`.
 * Le décalage est lu via Intl (pas de constante figée), pour rester juste si
 * la Tunisie réintroduisait l'heure d'été.
 */
export function debutJourneeTunis(jour: string): Date | null {
  const minuitUtc = new Date(`${jour}T00:00:00.000Z`);
  if (Number.isNaN(minuitUtc.getTime())) return null;
  const decalageMinutes = (instant: Date): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Tunis',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(instant);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    return Math.round((local - instant.getTime()) / 60000);
  };
  const premier = new Date(minuitUtc.getTime() - decalageMinutes(minuitUtc) * 60000);
  return new Date(minuitUtc.getTime() - decalageMinutes(premier) * 60000);
}

export function parseDay(valeur: string | undefined | null, finDeJour = false): Date | null {
  const brut = valeur?.trim();
  if (!brut) return null;
  // Une date seule désigne une JOURNÉE DE TUNIS (Africa/Tunis), pas une
  // journée UTC : sinon tout ce qui se passe entre 00:00 et 01:00 heure locale
  // serait compté la veille.
  if (estDateSeule(brut)) {
    const debut = debutJourneeTunis(brut);
    if (!debut) return null;
    return finDeJour ? new Date(debut.getTime() + 24 * 3600 * 1000) : debut;
  }
  const date = new Date(brut);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/**
 * Construit les bornes d'une période.
 *
 * @returns `null` quand aucune borne n'est demandée : les appelants doivent
 *          alors ne rien filtrer, plutôt que de borner la période à l'éternité
 *          par une valeur fantaisiste.
 */
export function periode(from?: string | null, to?: string | null): Periode | null {
  const debut = parseDay(from, false);
  const fin = parseDay(to, true);
  if (!debut && !fin) return null;
  return { ...(debut ? { gte: debut } : {}), ...(fin ? { lt: fin } : {}) };
}

/**
 * Décrit une période en français, pour l'en-tête d'un export et le nom de
 * fichier. Une période absente est dite telle quelle plutôt que masquée.
 */
export function describePeriode(
  from?: string | null,
  to?: string | null,
  defaut = 'toutes périodes'
): string {
  const debut = from?.trim();
  const fin = to?.trim();
  if (!debut && !fin) return defaut;
  if (debut && fin) return `${debut} → ${fin}`;
  return debut ? `depuis le ${debut}` : `jusqu'au ${fin}`;
}

/**
 * Bornes par défaut d'un rapport.
 *
 * Un rapport sans période se lirait comme un bilan depuis l'origine des
 * données, ce qui n'est presque jamais la question posée : on veut « ces
 * trente derniers jours ».
 */
export function periodeParDefaut(jours = 30): Periode {
  const fin = new Date();
  const debut = new Date(fin.getTime() - jours * 24 * 60 * 60 * 1000);
  return { gte: debut, lt: fin };
}
