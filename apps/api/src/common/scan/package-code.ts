/**
 * Lecture d'un code de colis scanné ou saisi : une seule règle pour toute l'API.
 *
 * Ce qu'un lecteur (pistolet du dépôt, caméra de l'application livreur) peut
 * rendre, depuis le bon de livraison ou une saisie manuelle :
 *
 *  - le code-barres du colis : 15 chiffres, clé de contrôle comprise ;
 *  - le numéro de suivi : 14 chiffres (12 pour l'ancien format) ;
 *  - l'étiquette d'une pièce : `<code-barres>-<n°>` (QR et code 128 du bon
 *    d'un colis à plusieurs pièces) ;
 *  - l'identifiant interne (UUID), utilisé par les écrans ;
 *  - un lien dont le dernier segment est l'un des codes ci-dessus — au cas où
 *    un QR futur porterait une URL de suivi.
 *
 * Distinguer « illisible » d'« inconnu » reste la règle : un code mal formé
 * est un problème d'étiquette, un code bien formé mais absent un colis non
 * déclaré.
 */

import type { Prisma } from '@prisma/client';
import { isUuid } from '../errors/api-error';
import { isBusinessNumberFormat, isValidBarcode } from '../../modules/depot/package-identity';

export type PackageCodeKind = 'barcode' | 'piece' | 'business-number' | 'uuid' | 'malformed';

export interface ParsedPackageCode {
  /** Saisie nettoyée (espaces retirés, dernier segment d'une URL). */
  raw: string;
  /** Code du colis sans le suffixe de pièce. */
  base: string;
  /** Numéro de pièce lu sur l'étiquette, ou null. */
  piece: number | null;
  kind: PackageCodeKind;
}

const MAX_LENGTH = 120;

/** Nettoie et classe un code ; ne lève jamais d'erreur. */
export function parsePackageCode(input: unknown): ParsedPackageCode {
  let raw = String(input ?? '').trim();
  if (raw.length > MAX_LENGTH) return { raw: raw.slice(0, MAX_LENGTH), base: '', piece: null, kind: 'malformed' };
  // Lien de suivi : on garde le dernier segment non vide, sans paramètres.
  if (/^https?:\/\//i.test(raw)) {
    const path = raw.replace(/[?#].*$/, '').split('/').filter(Boolean);
    raw = decodeURIComponent(path[path.length - 1] ?? '');
  }
  // Les lecteurs et la saisie manuelle ajoutent parfois des espaces.
  raw = raw.replace(/\s+/g, '');
  if (!raw) return { raw, base: '', piece: null, kind: 'malformed' };
  if (isUuid(raw)) return { raw: raw.toLowerCase(), base: raw.toLowerCase(), piece: null, kind: 'uuid' };
  if (isValidBarcode(raw)) return { raw, base: raw, piece: null, kind: 'barcode' };
  if (isBusinessNumberFormat(raw)) return { raw, base: raw, piece: null, kind: 'business-number' };

  const m = /^(\d{12,15})-(\d{1,3})$/.exec(raw);
  if (m) {
    const base = m[1]!;
    const piece = Number(m[2]);
    if (piece >= 1 && (isValidBarcode(base) || isBusinessNumberFormat(base))) {
      return { raw, base, piece, kind: 'piece' };
    }
  }
  return { raw, base: '', piece: null, kind: 'malformed' };
}

/**
 * Filtre Prisma retrouvant un colis par n'importe lequel de ses codes.
 *
 * Un code mal formé garde la recherche exacte sur le numéro et le code-barres
 * (des données anciennes peuvent ne pas suivre le format), mais n'interroge
 * jamais la colonne `id` : PostgreSQL refuserait une valeur non UUID.
 */
export function packageCodeWhere(input: unknown): Prisma.PackageWhereInput {
  const code = parsePackageCode(input);
  const value = code.kind === 'malformed' ? String(input ?? '').trim() : code.raw;
  const or: Prisma.PackageWhereInput[] = [{ trackingNumber: value }, { barcode: value }];
  if (code.kind === 'uuid') or.unshift({ id: code.raw });
  if (code.kind === 'piece') or.push({ barcode: code.base }, { trackingNumber: code.base });
  return { OR: or };
}

/** Vrai si `input` désigne ce colis (id, numéro, code-barres ou étiquette de pièce). */
export function codeMatchesPackage(
  input: unknown,
  pkg: { id: string; trackingNumber: string; barcode: string }
): boolean {
  const code = parsePackageCode(input);
  const candidates = code.kind === 'malformed' ? [String(input ?? '').trim()] : [code.raw, code.base];
  return candidates.some((c) => c && (c === pkg.id || c === pkg.trackingNumber || c === pkg.barcode));
}
