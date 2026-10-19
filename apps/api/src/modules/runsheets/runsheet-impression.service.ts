/**
 * Impression d'une tournée — `GET /runsheets/:id/impression` (comme ADEX) :
 *
 *   - « Bon de livraison N° RUN-… » : agence, voiture, livreur, date, nombre
 *     de colis et de pièces, puis une ligne par colis (code, expéditeur,
 *     contenu, montant, tentative, client, adresse), le total et la zone de
 *     cachet et signature ;
 *   - « Produits d'échange » : une fiche par colis d'échange de la tournée
 *     (expéditeur, destinataire, code et description de l'article à reprendre).
 *
 * Le code d'un produit d'échange est « 00 » suivi du numéro du colis, comme
 * chez ADEX : il s'imprime en code-barres et en QR sur la fiche jointe à
 * l'article repris.
 */

import { getPrisma } from '../../common/database/prisma-context';
import { notFound } from '../../common/errors/api-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (v: unknown) => Number(v ?? 0) || 0;

export interface ImpressionTournee {
  runsheetNumber: string;
  createdAt: string;
  tourDate: string;
  agence: string;
  voiture: string | null;
  livreur: string;
  matriculeFiscal: string | null;
  totalColis: number;
  totalPieces: number;
  total: number;
  colis: {
    numero: number;
    trackingNumber: string;
    expediteur: string;
    contenu: string;
    montant: number;
    pieces: number;
    tentative: number;
    client: string;
    telephone: string;
    adresse: string;
    echange: boolean;
  }[];
  echanges: {
    trackingNumber: string;
    codeProduit: string;
    description: string;
    expediteur: { nom: string; adresse: string; telephone: string; matriculeFiscal: string | null };
    destinataire: { nom: string; adresse: string; telephone: string };
  }[];
}

export async function impressionTournee(
  identifiant: string,
  scope: { depositId?: string; driverId?: string } = {}
): Promise<ImpressionTournee> {
  const prisma = getPrisma();
  const t = await prisma.runsheet.findFirst({
    where: UUID.test(identifiant) ? { OR: [{ id: identifiant }, { runsheetNumber: identifiant }] } : { runsheetNumber: identifiant },
    include: {
      deposit: { select: { name: true, companyId: true } },
      driver: { select: { licensePlate: true, user: { select: { fullName: true } } } },
      runsheetItems: {
        orderBy: { orderIndex: 'asc' },
        include: {
          package: {
            select: {
              id: true,
              trackingNumber: true,
              packageType: true,
              contentSummary: true,
              shipperNotes: true,
              totalPrice: true,
              pieceCount: true,
              shipper: { select: { companyName: true, brandName: true, address: true, governorate: true, phone: true, taxId: true } },
              customer: { select: { fullName: true, primaryPhone: true, secondaryPhone: true } },
              customerAddress: { select: { streetAddress: true, delegation: true, governorate: true } },
              exchangeRecord: { select: { returnedItemSummary: true } },
              deliveryAttempts: { select: { runsheetId: true } },
            },
          },
        },
      },
    },
  });
  // Un agent de dépôt n'imprime que les tournées de son dépôt, un livreur que les siennes.
  if (!t || (scope.depositId && t.depositId !== scope.depositId) || (scope.driverId && t.driverId !== scope.driverId)) {
    throw notFound('Feuille de tournée introuvable.');
  }

  const societe = t.deposit.companyId
    ? await prisma.company.findUnique({ where: { id: t.deposit.companyId }, select: { taxRegistration: true } })
    : await prisma.company.findFirst({ select: { taxRegistration: true } });

  const adresse = (a: { streetAddress: string; delegation: string; governorate: string } | null) =>
    a ? [a.streetAddress, a.delegation, a.governorate].filter((x, i, l) => x && l.indexOf(x) === i).join(', ') : '';

  const colis = t.runsheetItems.map((item, i) => {
    const p = item.package;
    // Tentative en cours : celles des tournées précédentes, plus celle-ci.
    const precedentes = p.deliveryAttempts.filter((a) => a.runsheetId !== t.id).length;
    return {
      numero: i + 1,
      trackingNumber: p.trackingNumber,
      expediteur: p.shipper.brandName || p.shipper.companyName,
      contenu: p.contentSummary,
      montant: n(p.totalPrice),
      pieces: p.pieceCount,
      tentative: precedentes + 1,
      client: p.customer.fullName,
      telephone: [p.customer.primaryPhone, p.customer.secondaryPhone].filter(Boolean).join(' / '),
      adresse: adresse(p.customerAddress),
      echange: String(p.packageType) === 'EXCHANGE',
    };
  });

  const echanges = t.runsheetItems
    .filter((item) => String(item.package.packageType) === 'EXCHANGE')
    .map((item) => {
      const p = item.package;
      return {
        trackingNumber: p.trackingNumber,
        codeProduit: `00${p.trackingNumber}`,
        description: p.exchangeRecord?.returnedItemSummary || p.shipperNotes || p.contentSummary,
        expediteur: {
          nom: p.shipper.brandName || p.shipper.companyName,
          adresse: [p.shipper.governorate, p.shipper.address].filter(Boolean).join(' , '),
          telephone: p.shipper.phone,
          matriculeFiscal: p.shipper.taxId,
        },
        destinataire: { nom: p.customer.fullName, adresse: adresse(p.customerAddress), telephone: p.customer.primaryPhone },
      };
    });

  return {
    runsheetNumber: t.runsheetNumber,
    createdAt: t.createdAt.toISOString(),
    tourDate: t.tourDate.toISOString().slice(0, 10),
    agence: t.deposit.name,
    voiture: t.driver.licensePlate,
    livreur: t.driver.user.fullName,
    matriculeFiscal: societe?.taxRegistration ?? null,
    totalColis: colis.length,
    totalPieces: colis.reduce((s, c) => s + (c.pieces || 1), 0),
    total: Math.round(colis.reduce((s, c) => s + c.montant, 0) * 1000) / 1000,
    colis,
    echanges,
  };
}
