/**
 * Documents imprimables de la caisse et des retours : bon de retour
 * expéditeur et bordereau de paiement. HTML autonome, ouvert dans une
 * fenêtre d'impression. Les codes de remise ne sont jamais imprimés.
 */
import type { PaymentVoucherDto } from '@logixpress/types';
import type { BonRetourDetail } from './api';
import { qrSvg } from '@/features/colis/bonLivraison';
import { ouvrirImpression } from '@/features/expediteur/colis/impression';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const dt = (v: number) => `${v.toFixed(3)} DT`;
const date = (v?: string | null) => (v ? new Date(v).toLocaleString('fr-TN') : '—');

const STYLE = `
  body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:24px;font-size:12px}
  h1{font-size:18px;margin:0}.muted{color:#64748b}
  .tete{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #cbd5e1;padding:5px 6px;text-align:left}
  th{background:#f1f5f9;font-size:11px;text-transform:uppercase}.r{text-align:right}.mono{font-family:monospace}
  .sign{display:flex;gap:40px;margin-top:40px}.sign div{flex:1;border-top:1px solid #94a3b8;padding-top:6px}
  .tot td{font-weight:bold}
  @media print{body{margin:10mm}}
`;

function page(titre: string, corps: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(titre)}</title><style>${STYLE}</style></head><body>${corps}<script>window.onload=()=>{window.focus();window.print()}</script></body></html>`;
}

/**
 * Bon de retour, mis en page comme chez ADEX : en-tête (logo, numéro, QR),
 * livreur / voiture / date / totaux, expéditeur, table des colis, cachet et
 * signature de l'agence et du livreur.
 */
export function imprimerBonRetour(bon: BonRetourDetail, agence = 'RUNEX'): void {
  const logo = `${window.location.origin}/brand/runex-logo.jpeg`;
  const lignes = bon.colis
    .map(
      (c, i) => `<tr><td class="c">${i + 1}</td><td class="mono">${esc(c.trackingNumber)}${c.kind === 'ECHANGE' ? '<br><small>article échange</small>' : ''}</td>
      <td>${esc(c.content || '—')}</td><td class="r">${c.kind === 'ECHANGE' ? '—' : dt(c.amount)}</td>
      <td>${esc(c.customerName)}${c.customerPhone ? `<br><small>${esc(c.customerPhone)}</small>` : ''}</td><td>${esc(c.address)}</td></tr>`
    )
    .join('');
  const date = bon.plannedDate ? new Date(`${bon.plannedDate}T12:00:00`).toLocaleDateString('fr-TN') : new Date(bon.createdAt).toLocaleString('fr-TN');
  ouvrirImpression(
    page(
      `Bon de retour ${bon.slipNumber}`,
      `<style>
        .cadre{border:1.5px solid #94a3b8;padding:10px 12px;margin-bottom:10px}
        .entete{display:flex;align-items:center;gap:18px}.entete img.logo{height:46px}
        .entete h1{flex:1;font-size:22px}.entete .qr svg{width:90px;height:90px}
        .grille{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px}
        .grille b{font-weight:700}
        td.c{text-align:center} small{color:#64748b}
        .signe{display:flex;justify-content:space-between;min-height:70px}
      </style>
      <div class="cadre entete"><img class="logo" src="${esc(logo)}" alt="RUNEX"><h1>Bon de retour N° ${esc(bon.slipNumber)}</h1><div class="qr">${qrSvg(bon.slipNumber, 24)}</div></div>
      <div class="cadre grille">
        <div><b>Nom livreur :</b> ${esc(bon.driverName ?? '—')}</div>
        <div><b>Voiture :</b> ${esc(bon.vehiclePlate ?? '—')}</div>
        <div><b>Date :</b> ${esc(date)}</div>
        <div><b>Nombre total des colis :</b> ${bon.colisCount}</div>
        <div><b>Nombre total des pièces :</b> ${bon.piecesCount}</div>
        <div><b>État :</b> ${esc(bon.statusLabel)}</div>
      </div>
      <div class="cadre grille">
        <div><b>Expéditeur :</b> ${esc(bon.shipperName)}</div>
        <div><b>Téléphone :</b> ${esc(bon.shipperPhone ?? '—')}</div>
        <div><b>Adresse :</b> ${esc(bon.shipperAddress ?? '—')}</div>
      </div>
      <table><thead><tr><th class="c">N°</th><th>Code</th><th>Contenu colis</th><th class="r">Montant</th><th>Client</th><th>Adresse</th></tr></thead>
      <tbody>${lignes || '<tr><td colspan="6" class="c muted">Aucun colis dans ce bon.</td></tr>'}</tbody></table>
      ${bon.notes ? `<p class="muted">Note : ${esc(bon.notes)}</p>` : ''}
      <div class="cadre" style="margin-top:18px"><b>Cachet et signature :</b>
        <div class="signe"><div style="align-self:flex-end">${esc(bon.depositName ?? agence)}</div><div style="align-self:flex-end">${esc(bon.driverName ?? 'Livreur')}</div><div style="align-self:flex-end">Expéditeur</div></div>
      </div>`
    )
  );
}

export function imprimerBordereau(v: PaymentVoucherDto): void {
  const lignes = (v.colis ?? [])
    .map(
      (c, i) => `<tr><td>${i + 1}</td><td class="mono">${esc(c.trackingNumber)}</td><td>${esc(c.customerName)}</td>
      <td>${c.status === 'RETOURNE_EXPEDITEUR' ? 'Retour' : 'Livré'}</td><td class="r">${dt(c.collectedAmount)}</td>
      <td class="r">${dt(c.status === 'RETOURNE_EXPEDITEUR' ? c.returnFee : c.deliveryFee)}</td></tr>`
    )
    .join('');
  ouvrirImpression(
    page(
      `Bordereau ${v.voucherNumber}`,
      `<div class="tete"><div><h1>RUNEX — Bordereau de paiement</h1><div class="muted">N° ${esc(v.voucherNumber)} · ${date(v.createdAt)}</div></div>
      <div><strong>${esc(v.shipperName)}</strong><br>${v.deliveredCount} livré(s) · ${v.returnedCount} retour(s)</div></div>
      <table><thead><tr><th>#</th><th>Colis</th><th>Destinataire</th><th>Type</th><th class="r">Encaissé</th><th class="r">Frais</th></tr></thead><tbody>${lignes}</tbody></table>
      <table style="width:50%;margin-left:auto"><tbody>
      <tr><td>Total encaissé</td><td class="r">${dt(v.grossCashCollected)}</td></tr>
      <tr><td>Frais de livraison</td><td class="r">− ${dt(v.deliveryFeesTotal)}</td></tr>
      <tr><td>Frais de retour</td><td class="r">− ${dt(v.returnFeesTotal)}</td></tr>
      <tr><td>Retenue à la source</td><td class="r">− ${dt(v.withholdingTaxTotal)}</td></tr>
      <tr class="tot"><td>Net à payer</td><td class="r">${dt(v.netPayable)}</td></tr></tbody></table>
      ${v.paidAt ? `<p>Réglé le ${date(v.paidAt)}.</p>` : ''}
      <div class="sign"><div>Caisse RUNEX</div><div>Expéditeur — nom et signature</div></div>`
    )
  );
}
