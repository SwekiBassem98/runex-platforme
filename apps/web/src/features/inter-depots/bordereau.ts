/**
 * Bordereau inter-dépôt imprimable (icône imprimante de la liste).
 *
 * Une page A4 : en-tête (n°, type, agences, livreur, immatriculation, date),
 * code-barres du bordereau, tableau des colis avec leurs pièces, totaux et
 * cadres de signature départ / arrivée.
 */
import type { InterDepotDto } from '@/lib/api';
import { code128Svg } from '@/features/expediteur/colis/code128';

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('fr-TN', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export function genererBordereauHtml(t: InterDepotDto): string {
  const retour = t.type === 'RETOUR';
  const lignes = t.items
    .map(
      (i, n) => `
    <tr>
      <td>${n + 1}</td>
      <td class="mono">${esc(i.trackingNumber)}<br/><span class="sub">${esc(i.barcode)}</span></td>
      <td>${esc(i.shipperName)}</td>
      <td>${esc(i.customerName)}<br/><span class="sub">${esc(i.destination)}</span></td>
      <td style="text-align:center">${i.pieceCount}</td>
      <td style="text-align:center">${i.receivedPieces}/${i.pieceCount}</td>
      <td style="text-align:center">${code128Svg(i.barcode, { height: 26, moduleWidth: 1 })}</td>
    </tr>`
    )
    .join('');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"/><title>Bordereau ${esc(t.transferNumber)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#0f172a; font-size:11px; }
  h1 { font-size:18px; margin:0; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #dc2626; padding-bottom:8px; margin-bottom:10px; }
  .brand { font-weight:900; font-size:20px; color:#dc2626; letter-spacing:1px; }
  .grid { display:grid; grid-template-columns: repeat(3, 1fr); gap:6px 14px; margin:10px 0; }
  .f .l { font-size:9px; text-transform:uppercase; color:#64748b; font-weight:700; }
  .f .v { font-weight:600; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th, td { border:1px solid #cbd5e1; padding:4px 5px; vertical-align:middle; }
  th { background:#f1f5f9; font-size:9px; text-transform:uppercase; text-align:left; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight:700; }
  .sub { font-size:9px; color:#64748b; font-weight:400; }
  .tot { margin-top:8px; font-weight:700; }
  .sign { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-top:22px; }
  .sign div { border:1px dashed #94a3b8; height:70px; padding:5px; font-size:9px; color:#475569; }
  tr { break-inside:avoid; }
</style></head><body>
<div class="head">
  <div><div class="brand">RUNEX</div><div class="sub">${retour ? 'Inter-dépôt retours et échanges' : 'Inter-dépôt livraison'}</div></div>
  <div style="text-align:right">
    <h1 class="mono">${esc(t.transferNumber)}</h1>
    <div>${code128Svg(t.transferNumber, { height: 34, moduleWidth: 1.2 })}</div>
  </div>
</div>
<div class="grid">
  <div class="f"><div class="l">Agence de départ</div><div class="v">${esc(t.sourceDeposit)}</div></div>
  <div class="f"><div class="l">${retour ? "Agence de l'expéditeur (retour)" : "Agence d'arrivée"}</div><div class="v">${esc(t.destinationDeposit)}</div></div>
  <div class="f"><div class="l">État</div><div class="v">${esc(t.statusLabel)}</div></div>
  <div class="f"><div class="l">Livreur</div><div class="v">${esc(t.driverName ?? '—')}</div></div>
  <div class="f"><div class="l">Matricule</div><div class="v mono">${esc(t.vehiclePlate ?? '—')}</div></div>
  <div class="f"><div class="l">Date de départ</div><div class="v">${esc(fmt(t.departureAt))}</div></div>
</div>
<table>
  <thead><tr><th>#</th><th>Colis</th><th>Expéditeur</th><th>Destinataire</th><th>Pièces</th><th>Reçues</th><th>Code</th></tr></thead>
  <tbody>${lignes || '<tr><td colspan="7" style="text-align:center;color:#64748b">Aucun colis chargé</td></tr>'}</tbody>
</table>
<div class="tot">Total : ${t.totalPackages} commande(s) · ${t.totalPieces} pièce(s) · reçues : ${t.receivedPieces}/${t.totalPieces}</div>
<div class="sign">
  <div>Remis par (agence de départ)<br/>Nom, date, signature</div>
  <div>Livreur — ${esc(t.driverName ?? '')}<br/>Signature</div>
  <div>Reçu par (agence d'arrivée)<br/>Nom, date, signature</div>
</div>
<script>window.onload=()=>{ setTimeout(()=>window.print(), 300); };</script>
</body></html>`;
}

/** Ouvre le bordereau dans une fenêtre d'impression. */
export function imprimerBordereau(t: InterDepotDto): void {
  const w = window.open('', '_blank', 'noopener=no,width=900,height=1000');
  if (!w) return;
  w.document.open();
  w.document.write(genererBordereauHtml(t));
  w.document.close();
}
