/**
 * Finance par expéditeur — `GET /payments/finance/expediteurs` et
 * `GET /payments/finance/expediteurs/:id`.
 *
 * Pour chaque expéditeur, ce que la finance doit savoir avant de payer :
 *
 *   - son tarif (frais par type de colis, retour, gestion, R.A.S.) ;
 *   - ce qui est **à régler** : colis livrés (encaissement validé) et retours
 *     pas encore dans un bordereau, avec le calcul du net ;
 *   - les bordereaux **à payer** (confirmés) et **payés** ;
 *   - l'argent encore **chez les clients** (colis en cours).
 *
 * Tout est calculé en base, sur tous les expéditeurs à la fois (aucune page
 * tronquée). La recherche porte sur la raison sociale, le nom commercial, le
 * code et le téléphone.
 */

import { Prisma } from '@prisma/client';
import { getPrisma } from '../../common/database/prisma-context';
import { asUuid, notFound } from '../../common/errors/api-error';
import { SELECT_TARIF, arrondi3, tarifDto, type TarifDto } from '../../common/tarifs/tarif-expediteur';
import { paymentsService, type CandidatsBordereau } from './payments.service';

const TERMINES = ['LIVRE', 'LIVRAISON_PARTIELLE', 'RETOURNE_EXPEDITEUR', 'ANNULE'];

export interface LigneFinanceExpediteur {
  id: string;
  code: string;
  name: string;
  brandName: string | null;
  governorate: string;
  phone: string;
  isActive: boolean;
  tarif: TarifDto;
  aRegler: {
    livres: number;
    retournes: number;
    encaisse: number;
    fraisLivraison: number;
    fraisRetour: number;
    fraisGestion: number;
    ras: number;
    net: number;
  } | null;
  aPayer: { count: number; net: number };
  paye: { count: number; net: number; lastPaidAt: string | null };
  chezClients: { count: number; amount: number };
}

export interface FinanceExpediteurs {
  generatedAt: string;
  totals: {
    shippers: number;
    toSettle: number;
    toSettleCount: number;
    toPay: number;
    toPayCount: number;
    paidThisMonth: number;
    paidThisMonthCount: number;
    withheldThisMonth: { delivery: number; returns: number; management: number; ras: number };
    atCustomers: number;
  };
  items: LigneFinanceExpediteur[];
}

export interface FicheFinanceExpediteur extends LigneFinanceExpediteur {
  email: string;
  address: string;
  vouchers: {
    id: string;
    voucherNumber: string;
    status: string;
    createdAt: string;
    paidAt: string | null;
    deliveredCount: number;
    returnedCount: number;
    gross: number;
    deliveryFees: number;
    returnFees: number;
    managementFees: number;
    ras: number;
    net: number;
  }[];
  monthly: { month: string; paid: number; withheld: number }[];
}

const n = (v: unknown) => Number(v ?? 0) || 0;

function debutDuMois(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function versLigne(
  s: {
    id: string;
    code: string;
    companyName: string;
    brandName: string | null;
    governorate: string;
    phone: string;
    isActive: boolean;
    config: Parameters<typeof tarifDto>[0];
  },
  candidat: CandidatsBordereau | undefined,
  bordereaux: Map<string, { status: string; count: number; net: number; lastPaidAt: Date | null }[]>,
  clients: Map<string, { count: number; amount: number }>
): LigneFinanceExpediteur {
  const parStatut = bordereaux.get(s.id) ?? [];
  const confirme = parStatut.find((b) => b.status === 'CONFIRME');
  const paye = parStatut.find((b) => b.status === 'PAYE');
  return {
    id: s.id,
    code: s.code,
    name: s.companyName,
    brandName: s.brandName,
    governorate: s.governorate,
    phone: s.phone,
    isActive: s.isActive,
    tarif: tarifDto(s.config),
    aRegler: candidat
      ? {
          livres: candidat.livres,
          retournes: candidat.retournes,
          encaisse: candidat.encaisse,
          fraisLivraison: candidat.fraisLivraison,
          fraisRetour: candidat.fraisRetour,
          fraisGestion: candidat.fraisGestion,
          ras: candidat.ras,
          net: candidat.netEstime,
        }
      : null,
    aPayer: { count: confirme?.count ?? 0, net: arrondi3(confirme?.net ?? 0) },
    paye: { count: paye?.count ?? 0, net: arrondi3(paye?.net ?? 0), lastPaidAt: paye?.lastPaidAt?.toISOString() ?? null },
    chezClients: clients.get(s.id) ?? { count: 0, amount: 0 },
  };
}

async function contexte(shipperIds?: string[]) {
  const prisma = getPrisma();
  const filtreVoucher: Prisma.PaymentVoucherWhereInput = shipperIds ? { shipperId: { in: shipperIds } } : {};
  const [candidats, groupes, enCours] = await Promise.all([
    paymentsService.candidats(shipperIds?.length === 1 ? shipperIds[0] : undefined),
    prisma.paymentVoucher.groupBy({
      by: ['shipperId', 'status'],
      where: { status: { in: ['CONFIRME', 'PAYE'] }, ...filtreVoucher },
      _count: { _all: true },
      _sum: { netPayable: true },
      _max: { paidAt: true },
    }),
    prisma.package.groupBy({
      by: ['shipperId'],
      where: { deletedAt: null, status: { notIn: TERMINES as never }, ...(shipperIds ? { shipperId: { in: shipperIds } } : {}) },
      _count: { _all: true },
      _sum: { totalPrice: true },
    }),
  ]);
  const parCandidat = new Map(candidats.map((c) => [c.shipperId, c]));
  const bordereaux = new Map<string, { status: string; count: number; net: number; lastPaidAt: Date | null }[]>();
  for (const g of groupes) {
    const liste = bordereaux.get(g.shipperId) ?? [];
    liste.push({ status: g.status, count: g._count._all, net: n(g._sum.netPayable), lastPaidAt: g._max.paidAt });
    bordereaux.set(g.shipperId, liste);
  }
  const clients = new Map(enCours.map((g) => [g.shipperId, { count: g._count._all, amount: arrondi3(n(g._sum.totalPrice)) }]));
  return { parCandidat, bordereaux, clients };
}

const SELECT_EXPEDITEUR = {
  id: true,
  code: true,
  companyName: true,
  brandName: true,
  governorate: true,
  phone: true,
  isActive: true,
  config: { select: SELECT_TARIF },
} satisfies Prisma.ShipperSelect;

export async function listerFinanceExpediteurs(search?: string): Promise<FinanceExpediteurs> {
  const prisma = getPrisma();
  const terme = search?.trim();
  const where: Prisma.ShipperWhereInput = { deletedAt: null };
  if (terme) {
    where.OR = [
      { companyName: { contains: terme, mode: 'insensitive' } },
      { brandName: { contains: terme, mode: 'insensitive' } },
      { code: { contains: terme, mode: 'insensitive' } },
      { phone: { contains: terme } },
    ];
  }
  const mois = debutDuMois();
  const [expediteurs, ctx, payesDuMois] = await Promise.all([
    prisma.shipper.findMany({ where, select: SELECT_EXPEDITEUR, orderBy: { companyName: 'asc' }, take: 500 }),
    contexte(),
    prisma.paymentVoucher.aggregate({
      where: { status: 'PAYE', paidAt: { gte: mois } },
      _count: { _all: true },
      _sum: { netPayable: true, deliveryFeesTotal: true, returnFeesTotal: true, managementFeesTotal: true, withholdingTaxTotal: true },
    }),
  ]);

  const items = expediteurs
    .map((s) => versLigne(s, ctx.parCandidat.get(s.id), ctx.bordereaux, ctx.clients))
    // Ce qui attend de l'argent d'abord, puis par ordre alphabétique.
    .sort((a, b) => (b.aPayer.net + (b.aRegler?.net ?? 0)) - (a.aPayer.net + (a.aRegler?.net ?? 0)) || a.name.localeCompare(b.name));

  // Les totaux portent sur tous les expéditeurs, pas seulement sur la recherche.
  const tous = [...ctx.parCandidat.values()];
  let aPayer = 0;
  let aPayerNb = 0;
  for (const liste of ctx.bordereaux.values()) {
    for (const b of liste) {
      if (b.status === 'CONFIRME') {
        aPayer += b.net;
        aPayerNb += b.count;
      }
    }
  }
  const chezClients = [...ctx.clients.values()].reduce((s, c) => s + c.amount, 0);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      shippers: await prisma.shipper.count({ where: { deletedAt: null } }),
      toSettle: arrondi3(tous.reduce((s, c) => s + c.netEstime, 0)),
      toSettleCount: tous.length,
      toPay: arrondi3(aPayer),
      toPayCount: aPayerNb,
      paidThisMonth: arrondi3(n(payesDuMois._sum.netPayable)),
      paidThisMonthCount: payesDuMois._count._all,
      withheldThisMonth: {
        delivery: arrondi3(n(payesDuMois._sum.deliveryFeesTotal)),
        returns: arrondi3(n(payesDuMois._sum.returnFeesTotal)),
        management: arrondi3(n(payesDuMois._sum.managementFeesTotal)),
        ras: arrondi3(n(payesDuMois._sum.withholdingTaxTotal)),
      },
      atCustomers: arrondi3(chezClients),
    },
    items,
  };
}

export async function ficheFinanceExpediteur(id: string): Promise<FicheFinanceExpediteur> {
  const prisma = getPrisma();
  const uuid = asUuid(id);
  if (!uuid) throw notFound('Expéditeur introuvable.');
  const s = await prisma.shipper.findFirst({
    where: { id: uuid, deletedAt: null },
    select: { ...SELECT_EXPEDITEUR, email: true, address: true },
  });
  if (!s) throw notFound('Expéditeur introuvable.');

  const sixMois = new Date();
  sixMois.setUTCMonth(sixMois.getUTCMonth() - 5, 1);
  sixMois.setUTCHours(0, 0, 0, 0);

  const [ctx, vouchers, mensuel] = await Promise.all([
    contexte([uuid]),
    prisma.paymentVoucher.findMany({
      where: { shipperId: uuid },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    prisma.$queryRaw<{ month: string; paid: Prisma.Decimal | null; withheld: Prisma.Decimal | null }[]>`
      SELECT to_char(date_trunc('month', v."paidAt" AT TIME ZONE 'Africa/Tunis'), 'YYYY-MM') AS month,
             sum(v."netPayable") AS paid,
             sum(v."deliveryFeesTotal" + v."returnFeesTotal" + v."managementFeesTotal" + v."withholdingTaxTotal") AS withheld
      FROM "PaymentVoucher" v
      WHERE v."shipperId" = ${uuid}::uuid AND v."status" = 'PAYE' AND v."paidAt" >= ${sixMois}
      GROUP BY 1`,
  ]);

  const parMois = new Map(mensuel.map((m) => [m.month, m]));
  const monthly: FicheFinanceExpediteur['monthly'] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    const cle = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const m = parMois.get(cle);
    monthly.push({ month: cle, paid: arrondi3(n(m?.paid)), withheld: arrondi3(n(m?.withheld)) });
  }

  return {
    ...versLigne(s, ctx.parCandidat.get(uuid), ctx.bordereaux, ctx.clients),
    email: s.email,
    address: s.address,
    vouchers: vouchers.map((v) => ({
      id: v.id,
      voucherNumber: v.voucherNumber,
      status: v.status,
      createdAt: v.createdAt.toISOString(),
      paidAt: v.paidAt?.toISOString() ?? null,
      deliveredCount: v.deliveredCount,
      returnedCount: v.returnedCount,
      gross: n(v.grossCashCollected) + n(v.grossChecksCollected),
      deliveryFees: n(v.deliveryFeesTotal),
      returnFees: n(v.returnFeesTotal),
      managementFees: n(v.managementFeesTotal),
      ras: n(v.withholdingTaxTotal),
      net: n(v.netPayable),
    })),
    monthly,
  };
}
