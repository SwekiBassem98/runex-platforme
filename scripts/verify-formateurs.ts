/**
 * Vérifie le formateur de montants sur les cas qui ont réellement cassé.
 *
 * Un montant qui traverse l'affichage, puis une comparaison, puis un export, se
 * relit au moins deux fois. Si la forme produite n'est pas relisible par le
 * formateur, la seconde lecture renvoie une chaîne différente de la première —
 * et le.total d'un rapport finit par ne pas correspondre à la somme de ses
 * lignes. Ces contrôles portent donc autant sur l'aller-retour que sur le rendu.
 */

import { formatTND, formatDate, formatDelai } from '../packages/ui/src/index';

const cas: Array<[string | number | null, string]> = [
  ['374.000', '374,000\u00a0DT'],
  ['1234567.890', '1\u00a0234\u00a0567,890\u00a0DT'],
  ['0.000', '0,000\u00a0DT'],
  ['-12.500', '-12,500\u00a0DT'],
  ['58.105', '58,105\u00a0DT'],
  ['1234567890123.456', '1\u00a0234\u00a0567\u00a0890\u00a0123,456\u00a0DT'],
  [1234567.89, '1\u00a0234\u00a0567,890\u00a0DT'],
  [58.1, '58,100\u00a0DT'],
  ['0', '0,000\u00a0DT'],
  ['12', '12,000\u00a0DT'],
  ['.5', '0,500\u00a0DT'],
  [null, '0,000\u00a0DT'],
  [undefined, '0,000\u00a0DT'],
  ['', '0,000\u00a0DT'],
  // Un montant déjà formaté doit se relire à l'identique.
  ['1\u00a0234\u00a0567,890', '1\u00a0234\u00a0567,890\u00a0DT'],
  // Notation exponentielle, que PostgreSQL peut produire sur de très grandes valeurs.
  ['1.285e+7', '12\u00a0850\u00a0000,000\u00a0DT'],
];

let echecs = 0;
for (const [entree, attendu] of cas) {
  const obtenu = formatTND(entree);
  const ok = obtenu === attendu;
  if (!ok) echecs++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${JSON.stringify(entree)} → ${obtenu}${ok ? '' : `  (attendu ${attendu})`}`);
}

// Aller-retour : ce que le formateur produit, il doit le relire sans le changer.
for (const source of ['1234567.890', '374.000', '-12.500', '0.001']) {
  const une = formatTND(source);
  const deux = formatTND(une.replace(/\u00a0DT$/, ''));
  const ok = une === deux;
  if (!ok) echecs++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  aller-retour ${source} → ${une} → ${deux}`);
}

// Un montant illisible ressort tel quel : mieux vaut afficher la donnée brute
// que de la convertir en zéro.
const brut = formatTND('pas un montant');
const okBrut = brut === 'pas un montant\u00a0DT';
if (!okBrut) echecs++;
console.log(`  ${okBrut ? 'OK  ' : 'FAIL'}  donnée illisible préservée → ${brut}`);

// Les dates sont rendues en fr-TN quelle que soit la locale du navigateur :
// un ordre jour/mois inversé fait lire un virement au mauvais jour.
const date = formatDate('2026-03-12T00:00:00Z');
const okDate = /\d{2}\/\d{2}\/2026/.test(date);
if (!okDate) echecs++;
console.log(`  ${okDate ? 'OK  ' : 'FAIL'}  date au format tunisien → ${date}`);

const invalide = formatDate('pas une date');
const okInvalide = invalide === '—';
if (!okInvalide) echecs++;
console.log(`  ${okInvalide ? 'OK  ' : 'FAIL'}  date illisible → ${invalide}`);

const delai = formatDelai(new Date(Date.now() - 4 * 60 * 1000).toISOString());
const okDelai = delai === 'il y a 4 min';
if (!okDelai) echecs++;
console.log(`  ${okDelai ? 'OK  ' : 'FAIL'}  ancienneté → ${delai}`);

console.log(`\n${echecs === 0 ? 'OK' : 'ÉCHECS'} : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);