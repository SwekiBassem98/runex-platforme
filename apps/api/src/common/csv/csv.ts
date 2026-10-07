/**
 * Écriture de fichiers CSV.
 *
 * Un export n'est pas une fonctionnalité de rapport : c'est un moyen de sortir
 * les chiffres qu'un rapport a calculés. Les règles qui le rendent sûr — la
 * neutralisation des formules, le BOM, les fins de ligne — sont donc partagées,
 * et non réécrites à chaque export.
 *
 * La neutralisation des formules n'est pas un détail : Excel interprète un
 * texte commencant par `=`, `+`, `-` ou `@` comme une formule, et un nom de
 * client « =CMD|... » deviendrait une formule exécutée à l'ouverture du
 * fichier.
 */

/** Séparateur décimal attendu par les tableurs francophones. */
export const CSV_SEPARATOR = ',';

/** Fins de ligne : CRLF, ce que le tableur attend. */
const EOL = '\r\n';

/**
 * Marque d'ordre des octets.
 *
 * Sans elle, Excel lit un UTF-8 comme un jeu de caractères local : les accents
 * deviennent illisibles dès la première ligne accentuée, ce qui suffit à faire
 * abandonner l'export.
 */
const BOM = '\uFEFF';

/**
 * Échappe une cellule CSV.
 *
 * @param value Valeur à écrire ; `null` et `undefined` deviennent une cellule
 *              vide.
 */
export function csvCell(value: string | number | null | undefined): string {
  const raw = String(value ?? '');
  const neutralised = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[";\r\n]/.test(raw) ? `"${neutralised.replace(/"/g, '""')}"` : neutralised;
}

/** Une ligne de cellules, déjà échappée. */
export function csvLine(cells: ReadonlyArray<string | number | null | undefined>): string {
  return cells.map(csvCell).join(CSV_SEPARATOR);
}

/**
 * Assemble un fichier CSV complet.
 *
 * @param header Libellés de colonnes.
 * @param rows   Lignes, dans l'ordre d'affichage.
 */
export function buildCsv(
  header: ReadonlyArray<string | number | null | undefined>,
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>
): string {
  return `${BOM}${[csvLine(header), ...rows.map((r) => csvLine(r))].join(EOL)}${EOL}`;
}

/** Au-delà, l'export devient un fichier que personne n'ouvre. */
export const MAX_EXPORT_ROWS = 50_000;

/**
 * Nom de fichier horodaté.
 *
 * L'horodatage évite qu'un export-CA overrime le précédent au premier clic.
 * `filename` est borné à 180 caractères : au-delà, certains systèmes de
 * fichiers et la plupart des navigateurs tronquent le nom en silence.
 */
export function timestampedFilename(prefix: string, suffix = ''): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const clef = suffix ? `_${suffix}` : '';
  return `${prefix}_${stamp}${clef}.csv`.slice(0, 180);
}
