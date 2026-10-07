/**
 * Identité d'un colis : numéro de business et code-barres.
 *
 * Deux représentations distinctes, pour deux usages distincts.
 *
 * Le **numéro de business** est ce que l'être humain lit, dicte au téléphone et
 * recopie sur un bordereau : deux chiffres d'année, quatre de date, huit de
 * séquence. Il est unique, et garanti unique par la base — la séquence
 * `package_number_seq` ne rend jamais la même valeur, ce qu'un tirage
 * aléatoire puis vérification ne pouvait pas promettre sous concurrence.
 *
 * Le **code-barres** est ce que le lecteur optique capte. C'est le numéro de
 * business suivi d'une clé de contrôle calculée : une erreur de saisie ou de
 * transmission se détecte sans jointure, en additionnant les chiffres. La
 * lecture est donc capable de dire « ce code est invalide » au lieu de chercher
 * un colis qui n'existe pas et de le fabriquer de toutes pièces.
 *
 * Le format reste strictement numérique : les symbologies les plus répandues
 * (EAN-13, Code 128 en mode C) ne connaissent pas les lettres.
 */

import { getPrisma } from '../../common/database/prisma-context';

/** Longueur du numéro de business : 2 (année) + 4 (date) + 8 (séquence). */
const NUMBER_LENGTH = 14;
/** Longueur du code-barres : le numéro, plus une clé de contrôle. */
const BARCODE_LENGTH = NUMBER_LENGTH + 1;
/**
 * Longueur de l'ancien format : 2 (année) + 4 (date) + 6 (séquence).
 *
 * Les colis créés avant le passage à la séquence portent ce format, et ils
 * constituent l'essentiel du stock existant. Refuser de les recevoir rendrait
 * la réception inutilisable le jour où elle est déployée : il faut savoir les
 * lire. Leur code-barres leur était leur numéro, sans clé de contrôle —
 * d'où l'absence de vérification possible sur ces codes-là.
 */
const LEGACY_NUMBER_LENGTH = 12;

/**
 * Clé de contrôle, modulo 10, poids alternés 3 puis 1.
 *
 * Le poids alterné évite que deux erreurs d'échange de chiffres consécutifs
 * se compensent — le défaut d'une somme simple, où `12` et `21` portent la
 * même clé.
 */
function checkDigit(nineOrMoreDigits: string): number {
  let sum = 0;
  // Le poids s'applique en partant de la droite du corps du code.
  for (let i = 0; i < nineOrMoreDigits.length; i += 1) {
    const digit = nineOrMoreDigits.charCodeAt(nineOrMoreDigits.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Numéro de business pour un nouveau colis.
 *
 * La séquence garantit l'unicité, mais le numéro est préfixé par la date du
 * jour : deux colis créés le même jour se suivent, et un colis se classe dans
 * l'ordre où il est entré.
 */
export async function generateBusinessNumber(now = new Date()): Promise<string> {
  const stamp =
    String(now.getFullYear()).slice(-2) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    // Nom de séquence écrit en dur, sans interpolation : le gabarit de Prisma
    // transformerait une variable en paramètre lié (`$1`), et PostgreSQL
    // refuserait de l'utiliser comme nom de relation. Le nom n'a de toute
    // façon aucune raison d'être variable — c'est une constante du schéma.
    const rows = await getPrisma().$queryRaw<{ next: bigint }[]>`
      SELECT nextval('package_number_seq') AS next
    `;
    const candidate = `${stamp}${String(rows[0].next).padStart(8, '0')}`;
    if (candidate.length === NUMBER_LENGTH) return candidate;
  }

  throw new Error("Impossible de générer un numéro de business.");
}

/** Représentation scannable d'un numéro de business. */
export function barcodeFor(businessNumber: string): string {
  const body = businessNumber.slice(0, NUMBER_LENGTH);
  // Le format courant seulement : un numéro à l'ancien format est recevable
  // comme saisie, mais il ne peut pas servir à fabriquer une étiquette — le
  // code produit serait trop court pour que quiconque sache le lire.
  if (!new RegExp(`^\\d{${NUMBER_LENGTH}}$`).test(body)) {
    // Un numéro non conforme ne doit pas produire un code-barres qui « passe »
    // la vérification : mieux vaut une erreur franche qu'une étiquette fausse.
    throw new Error(`Numéro de business invalide : « ${businessNumber} ».`);
  }
  return `${body}${checkDigit(body)}`;
}

/** Vrai si le code est structurellement valide, clé de contrôle comprise. */
export function isValidBarcode(code: string): boolean {
  if (!/^\d+$/.test(code) || code.length !== BARCODE_LENGTH) return false;
  return checkDigit(code.slice(0, NUMBER_LENGTH)) === Number(code[BARCODE_LENGTH - 1]);
}

/** Vrai si la chaîne ressemble à un numéro de business, ancien format compris. */
export function isBusinessNumberFormat(code: string): boolean {
  return (
    new RegExp(`^\\d{${NUMBER_LENGTH}}$`).test(code) ||
    new RegExp(`^\\d{${LEGACY_NUMBER_LENGTH}}$`).test(code)
  );
}

/**
 * Lecture d'un code par un opérateur.
 *
 * Distingue un code mal formé d'un code bien formé mais inconnu. La nuance
 * change tout : le premier signale un lecteur mal réglé ou une étiquette
 * abîmée, le second un colis qui n'a pas été déclaré. Les confondre enverrait
 * l'opérateur chercher un problème qui n'existe pas.
 */
export type ScannedCodeKind = 'barcode' | 'business-number' | 'malformed';

export function classifyScannedCode(raw: string): ScannedCodeKind {
  const code = raw.trim();
  if (isValidBarcode(code)) return 'barcode';
  if (isBusinessNumberFormat(code)) return 'business-number';
  return 'malformed';
}

/**
 * Identifiants à tenter pour retrouver un colis.
 *
 * Un code scanné peut être le code-barres ou le numéro de business saisi à la
 * main ; les deux doivent mener au même colis. Les numéros saisis avec des
 * espaces ou des tirets sont ramenés à leur forme nue.
 */
export function lookupIdentifiers(raw: string): { barcode?: string; trackingNumber?: string } {
  const code = raw.trim();
  if (!code) return {};
  const bare = code.replace(/[\s-]/g, '');
  return {
    barcode: bare,
    trackingNumber: code,
  };
}

export const IDENTITY_FORMAT = {
  NUMBER_LENGTH,
  BARCODE_LENGTH,
} as const;