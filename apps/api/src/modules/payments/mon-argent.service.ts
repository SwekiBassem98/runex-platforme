/**
 * « Mon argent » — l'argent de l'expéditeur, dit simplement (27/11).
 *
 * Les expéditeurs veulent une seule réponse : combien RUNEX leur doit, et où
 * en est l'argent de chaque colis. Chaque colis est rangé dans UNE étape :
 *
 *   EN_LIVRAISON  pas encore livré : l'argent est chez le client
 *   VERIFICATION  livré : le livreur a encaissé, la caisse RUNEX vérifie
 *   PROCHAIN      vérifié : entrera dans le prochain bordereau de paiement
 *   A_PAYER       dans un bordereau prêt : RUNEX doit le payer
 *   PAYE          payé à l'expéditeur
 *   RETOUR        colis qui revient (pas d'argent ; frais de retour à la fin)
 *   AUCUN         annulé
 *
 * Mêmes règles que l'exploitation : « Prochain » = « À régler » de la finance
 * (`paymentsService.candidats`), « À payer » / « Payé » = ses bordereaux.
 */
import { Prisma } from '@prisma/client';
import { getPrisma } from '../../common/database/prisma-context';
import { arrondi3, SELECT_TARIF, tarifDepuisConfig } from '../../common/tarifs/tarif-expediteur';
import { paymentsService } from './payments.service';

export const ETAPES_ARGENT = ['EN_LIVRAISON', 'VERIFICATION', 'PROCHAIN', 'A_PAYER', 'PAYE', 'RETOUR', 'AUCUN'] as const;
export type EtapeArgent = (typeof ETAPES_ARGENT)[number];

const LIVRES = ['LIVRE', 'LIVRAISON_PARTIELLE'];
const EN_RETOUR = ['RETOUR_DEPOT', 'EN_RUNSHEET_RETOUR', 'ECHEC_LIVRAISON'];
const MAX_COLIS = 3000;
const MAX_LISTE = 300;

export interface ColisArgent {
  id: string;
  trackingNumber: string;
  client: string;
  ville: string;
  statut: string;
  etape: EtapeArgent;
  /** Ce que le client doit payer. */
  prix: number;
  /** Ce que le livreur a encaissé. */
  encaisse: number;
  /** Frais RUNEX du colis (livraison, ou retour). */
  frais: number;
  /** Ce qui revient à l'expéditeur pour ce colis (négatif : retour facturé). */
  pourVous: number;
  bordereau: string | null;
  payeLe: string | null;
  date: string;
}

type Ligne = Prisma.PackageGetPayload<{
  select: {
    id: true;
    trackingNumber: true;
    status: true;
    totalPrice: true;
    collectedAmount: true;
    deliveryFee: true;
    returnFee: true;
    deliveredAt: true;
    updatedAt: true;
    customer: { select: { fullName: true } };
    customerAddress: { select: { governorate: true; delegation: true } };
    payment: { select: { status: true } };
    sousTraitance: { select: { codRecuLe: true } };
    paymentVoucher: { select: { voucherNumber: true; status: true; paidAt: true } };
  };
}>;

function etapeDe(p: Ligne): EtapeArgent {
  const s = String(p.status);
  if (s === 'ANNULE') return 'AUCUN';
  if (EN_RETOUR.includes(s)) return 'RETOUR';
  if (s === 'RETOURNE_EXPEDITEUR' || LIVRES.includes(s)) {
    const v = p.paymentVoucher;
    if (v && v.status !== 'ANNULE') return v.status === 'PAYE' ? 'PAYE' : 'A_PAYER';
    if (s === 'RETOURNE_EXPEDITEUR') return 'PROCHAIN';
    // Même règle que « À régler » : caisse validée, et pour JAX montant reversé.
    if (p.payment?.status === 'EN_ATTENTE') return 'VERIFICATION';
    if (p.sousTraitance && !p.sousTraitance.codRecuLe) return 'VERIFICATION';
    return 'PROCHAIN';
  }
  return 'EN_LIVRAISON';
}

export async function monArgent(shipperId: string, filtres: { etape?: string; search?: string } = {}) {
  const prisma = getPrisma();
  const [rows, shipper, vouchers, candidats] = await Promise.all([
    prisma.package.findMany({
      where: { shipperId, deletedAt: null },
      select: {
        id: true,
        trackingNumber: true,
        status: true,
        totalPrice: true,
        collectedAmount: true,
        deliveryFee: true,
        returnFee: true,
        deliveredAt: true,
        updatedAt: true,
        customer: { select: { fullName: true } },
        customerAddress: { select: { governorate: true, delegation: true } },
        payment: { select: { status: true } },
        sousTraitance: { select: { codRecuLe: true } },
        paymentVoucher: { select: { voucherNumber: true, status: true, paidAt: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_COLIS,
    }),
    prisma.shipper.findUnique({ where: { id: shipperId }, select: { config: { select: SELECT_TARIF } } }),
    prisma.paymentVoucher.findMany({
      where: { shipperId, status: { not: 'ANNULE' } },
      select: { voucherNumber: true, status: true, netPayable: true, paidAt: true, createdAt: true, deliveredCount: true, returnedCount: true },
      orderBy: { createdAt: 'desc' },
    }),
    paymentsService.candidats(shipperId),
  ]);
  const tarif = tarifDepuisConfig(shipper?.config);

  const colis: ColisArgent[] = rows.map((p) => {
    const etape = etapeDe(p);
    const s = String(p.status);
    const prix = Number(p.totalPrice ?? 0);
    const encaisse = LIVRES.includes(s) ? Number(p.collectedAmount ?? 0) : 0;
    let frais = 0;
    if (LIVRES.includes(s)) frais = Number(p.deliveryFee ?? 0);
    else if (s === 'RETOURNE_EXPEDITEUR') frais = Number(p.returnFee ?? 0) > 0 ? Number(p.returnFee) : tarif.retour;
    const pourVous = etape === 'AUCUN' || etape === 'RETOUR' || etape === 'EN_LIVRAISON' ? 0 : arrondi3(encaisse - frais);
    return {
      id: p.id,
      trackingNumber: p.trackingNumber,
      client: p.customer?.fullName ?? '',
      ville: [p.customerAddress?.delegation, p.customerAddress?.governorate].filter(Boolean).join(', '),
      statut: s,
      etape,
      prix: arrondi3(prix),
      encaisse: arrondi3(encaisse),
      frais: arrondi3(frais),
      pourVous,
      bordereau: p.paymentVoucher && p.paymentVoucher.status !== 'ANNULE' ? p.paymentVoucher.voucherNumber : null,
      payeLe: p.paymentVoucher?.status === 'PAYE' ? (p.paymentVoucher.paidAt?.toISOString() ?? null) : null,
      date: (p.deliveredAt ?? p.updatedAt).toISOString(),
    };
  });

  const compte = (e: EtapeArgent) => colis.filter((c) => c.etape === e);
  const somme = (l: ColisArgent[], f: (c: ColisArgent) => number) => arrondi3(l.reduce((a, c) => a + f(c), 0));
  const enLivraison = compte('EN_LIVRAISON');
  const verification = compte('VERIFICATION');
  const retour = compte('RETOUR');
  const prochain = candidats[0];
  const aPayer = vouchers.filter((v) => v.status !== 'PAYE');
  const payes = vouchers.filter((v) => v.status === 'PAYE');

  const etapes = {
    enLivraison: { colis: enLivraison.length, montant: somme(enLivraison, (c) => c.prix) },
    verification: { colis: verification.length, encaisse: somme(verification, (c) => c.encaisse), pourVous: somme(verification, (c) => c.pourVous) },
    prochain: {
      colis: (prochain?.livres ?? 0) + (prochain?.retournes ?? 0),
      livres: prochain?.livres ?? 0,
      retournes: prochain?.retournes ?? 0,
      encaisse: prochain?.encaisse ?? 0,
      fraisLivraison: prochain?.fraisLivraison ?? 0,
      fraisRetour: prochain?.fraisRetour ?? 0,
      fraisGestion: prochain ? prochain.fraisGestion : 0,
      tauxRas: prochain?.tauxRas ?? 0,
      ras: prochain?.ras ?? 0,
      net: prochain?.netEstime ?? 0,
    },
    aPayer: {
      bordereaux: aPayer.map((v) => ({ numero: v.voucherNumber, net: arrondi3(Number(v.netPayable ?? 0)), creeLe: v.createdAt.toISOString(), colis: v.deliveredCount + v.returnedCount })),
      montant: arrondi3(aPayer.reduce((a, v) => a + Number(v.netPayable ?? 0), 0)),
    },
    paye: {
      bordereaux: payes.length,
      montant: arrondi3(payes.reduce((a, v) => a + Number(v.netPayable ?? 0), 0)),
      dernier: payes[0] ? { numero: payes[0].voucherNumber, net: arrondi3(Number(payes[0].netPayable ?? 0)), le: payes[0].paidAt?.toISOString() ?? null } : null,
    },
    retour: { colis: retour.length },
  };
  // Ce que RUNEX doit à l'expéditeur aujourd'hui : bordereaux prêts + prochain
  // bordereau + argent encaissé en vérification (avant frais de bordereau).
  const aRecevoir = arrondi3(etapes.aPayer.montant + etapes.prochain.net + etapes.verification.pourVous);

  const terme = (filtres.search ?? '').trim().toLowerCase();
  const etapeFiltre = ETAPES_ARGENT.includes(filtres.etape as EtapeArgent) ? (filtres.etape as EtapeArgent) : null;
  const filtres2 = colis.filter(
    (c) =>
      (!etapeFiltre || c.etape === etapeFiltre) &&
      (!terme || c.trackingNumber.toLowerCase().includes(terme) || c.client.toLowerCase().includes(terme) || (c.bordereau ?? '').toLowerCase().includes(terme))
  );
  const parEtape = Object.fromEntries(ETAPES_ARGENT.map((e) => [e, colis.filter((c) => c.etape === e).length])) as Record<EtapeArgent, number>;

  return {
    aRecevoir,
    etapes,
    colis: filtres2.slice(0, MAX_LISTE),
    totalColis: filtres2.length,
    parEtape,
    majLe: new Date().toISOString(),
  };
}
