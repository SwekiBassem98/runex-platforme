/**
 * Documents imprimables de la caisse et des retours : bon de retour
 * expéditeur et bordereau de paiement. HTML autonome, ouvert dans une
 * fenêtre d'impression. Les codes de remise ne sont jamais imprimés.
 */
import type { PaymentVoucherDto } from '@logixpress/types';
import type { BonRetour } from './api';
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

export function imprimerBonRetour(bon: BonRetour): void {
  const lignes = (bon.colis ?? [])
    .map(
      (c, i) => `<tr><td>${i + 1}</td><td class="mono">${esc(c.trackingNumber)}</td><td>${esc(c.customerName)}</td>
      <td>${esc(c.governorate)}</td><td class="r">${c.pieceCount}</td><td>${esc(c.reason)}</td><td class="r">${dt(c.returnFee)}</td></tr>`
    )
    .join('');
  const frais = (bon.colis ?? []).reduce((s, c) => s + c.returnFee, 0);
  ouvrirImpression(
    page(
      `Bon de retour ${bon.slipNumber}`,
      `<div class="tete"><div><h1>RUNEX — Bon de retour expéditeur</h1><div class="muted">N° ${esc(bon.slipNumber)} · préparé le ${date(bon.createdAt)}</div></div>
      <div><strong>${esc(bon.shipperName)}</strong><br>${esc(bon.shipperPhone)}<br>${esc(bon.shipperAddress)}</div></div>
      <p>${bon.packagesCount} colis retourné(s) remis à l'expéditeur. ${bon.status === 'REMIS' ? `Remis le ${date(bon.handedOverAt)}${bon.receiverName ? ` à ${esc(bon.receiverName)}` : ''}.` : ''}</p>
      <table><thead><tr><th>#</th><th>Colis</th><th>Destinataire</th><th>Gouvernorat</th><th class="r">Pièces</th><th>Motif du retour</th><th class="r">Frais retour</th></tr></thead>
      <tbody>${lignes}<tr class="tot"><td colspan="6">Total</td><td class="r">${dt(frais)}</td></tr></tbody></table>
      ${bon.notes ? `<p class="muted">Note : ${esc(bon.notes)}</p>` : ''}
      <div class="sign"><div>Remis par (RUNEX)</div><div>Reçu par (expéditeur) — nom et signature</div></div>`
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
