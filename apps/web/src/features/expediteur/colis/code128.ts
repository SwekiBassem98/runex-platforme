/**
 * Code 128 (jeu B) en SVG, sans dépendance.
 *
 * Les étiquettes imprimées doivent être lues par les pistolets du dépôt :
 * l'ancienne impression dessinait des barres décoratives, illisibles par un
 * lecteur. Le jeu B couvre tous les caractères ASCII imprimables (32–127),
 * ce qui suffit pour les codes-barres RUNEX (chiffres + clé de contrôle).
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

/** Séquence des modules (largeurs alternées barre/espace) pour `value`. */
export function code128Widths(value: string): number[] {
  const codes: number[] = [START_B];
  for (const ch of value) {
    const code = ch.charCodeAt(0) - 32;
    if (code < 0 || code > 95) throw new Error(`Caractère non encodable en Code 128 B : ${ch}`);
    codes.push(code);
  }
  const checksum = codes.reduce((sum, code, i) => sum + code * (i === 0 ? 1 : i), 0) % 103;
  codes.push(checksum, STOP);
  return codes.flatMap((code) => PATTERNS[code]!.split('').map(Number));
}

/** Code-barres SVG, zone de silence comprise (10 modules de chaque côté). */
export function code128Svg(value: string, opts: { height?: number; moduleWidth?: number } = {}): string {
  const height = opts.height ?? 48;
  const module = opts.moduleWidth ?? 1.4;
  let widths: number[];
  try {
    widths = code128Widths(value);
  } catch {
    return '';
  }
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  const bars: string[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
    x += w;
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Code-barres" ` +
    `width="${(total * module).toFixed(1)}" height="${height}" viewBox="0 0 ${total} ${height}" ` +
    `preserveAspectRatio="none" shape-rendering="crispEdges" style="background:#fff">` +
    `<g fill="#000">${bars.join('')}</g></svg>`
  );
}
