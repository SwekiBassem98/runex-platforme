/**
 * Numéros métier séquentiels (PAY-, RUN-, RET-, CLI-) sans collision.
 *
 * Les numéros étaient calculés par « dernier + 1 » ou à partir de l'horloge,
 * hors transaction : deux créations simultanées produisaient le même numéro et
 * la seconde échouait sur l'index unique. Ici, le calcul se fait sous un verrou
 * consultatif PostgreSQL propre à la série, pris dans la transaction de
 * l'appelant : les créations concurrentes d'une même série sont sérialisées
 * le temps du calcul, puis le verrou tombe avec la transaction.
 */
import type { Prisma } from '@prisma/client';

export type NumberSeries = 'payment' | 'runsheet' | 'return' | 'customer';

async function lock(tx: Prisma.TransactionClient, series: NumberSeries, prefix: string): Promise<void> {
  const key = `runex:number:${series}:${prefix}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS locked`;
}

function nextFrom(last: string | null | undefined, prefix: string): number {
  if (!last) return 1;
  const tail = Number(last.slice(prefix.length));
  return Number.isFinite(tail) ? tail + 1 : 1;
}

/** `PAY-2026-000123` — séquence annuelle. */
export async function nextPaymentNumber(tx: Prisma.TransactionClient, now = new Date()): Promise<string> {
  const prefix = `PAY-${now.getFullYear()}-`;
  await lock(tx, 'payment', prefix);
  const last = await tx.payment.findFirst({
    where: { paymentNumber: { startsWith: prefix } },
    orderBy: { paymentNumber: 'desc' },
    select: { paymentNumber: true },
  });
  return `${prefix}${String(nextFrom(last?.paymentNumber, prefix)).padStart(6, '0')}`;
}

/** `RUN-20261008-0001` — séquence quotidienne (jour de Tunis). */
export async function nextRunsheetNumber(tx: Prisma.TransactionClient, stamp: string): Promise<string> {
  const prefix = `RUN-${stamp}-`;
  await lock(tx, 'runsheet', prefix);
  const last = await tx.runsheet.findFirst({
    where: { runsheetNumber: { startsWith: prefix } },
    orderBy: { runsheetNumber: 'desc' },
    select: { runsheetNumber: true },
  });
  return `${prefix}${String(nextFrom(last?.runsheetNumber, prefix)).padStart(4, '0')}`;
}

/** `RET-2026-000123` — séquence annuelle des retours. */
export async function nextReturnNumber(tx: Prisma.TransactionClient, now = new Date()): Promise<string> {
  const prefix = `RET-${now.getFullYear()}-`;
  await lock(tx, 'return', prefix);
  const last = await tx.returnRecord.findFirst({
    where: { returnNumber: { startsWith: prefix } },
    orderBy: { returnNumber: 'desc' },
    select: { returnNumber: true },
  });
  return `${prefix}${String(nextFrom(last?.returnNumber, prefix)).padStart(6, '0')}`;
}

/** `CLI-2026-000123` — séquence annuelle des destinataires. */
export async function nextCustomerCode(tx: Prisma.TransactionClient, now = new Date()): Promise<string> {
  const prefix = `CLI-${now.getFullYear()}-`;
  await lock(tx, 'customer', prefix);
  const last = await tx.customer.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  return `${prefix}${String(nextFrom(last?.code, prefix)).padStart(6, '0')}`;
}

/** Jour calendaire de Tunis au format `AAAAMMJJ`. */
export function tunisDayStamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts.replace(/-/g, '');
}
