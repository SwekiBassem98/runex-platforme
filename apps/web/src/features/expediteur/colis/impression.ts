'use client';

/**
 * Impression des colis de l'expéditeur.
 *
 * Deux usages, un même mécanisme : ouvrir une fenêtre d'impression
 * avec un HTML autonome, A4, marque RUNEX, sans dépendance serveur.
 *
 * - colis unique : fiche détaillée (destinataire, montant, code-barres, statut…)
 * - liste filtrée : tableau paginé côté serveur (shipperId imposé par le jeton)
 *
 * Aucun champ n'est inventé : seuls les champs de PackageDto renseignés
 * par l'API et déjà visibles à l'écran sont repris.
 *
 * Performance : la liste est chargée par pages de 100, jusqu'à 500 colis
 * maximum (au-delà, l'impression serait illisible et la mémoire du navigateur
 * saturée). Le total réel reste annoncé.
 */

import type { PackageDto } from '@logixpress/types';
import { code128Svg } from './code128';
import { pieceBarcode } from '@logixpress/types';

const MAX_IMPRESSION_COLIS = 500;
const PAGE_SIZE_IMPRESSION = 100;

export const LIMITE_IMPRESSION = MAX_IMPRESSION_COLIS;

export interface ContexteImpression {
  entreprise: string;
  langue: string;
  dir: 'ltr' | 'rtl';
  formatTND: (m: number | string | null | undefined) => string;
  formatDate: (v: string | number | Date | null | undefined) => string;
  formatDateTime: (v: string | number | Date | null | undefined) => string;
  traduireStatut?: (s: string) => string;
  traduireType?: (t: string) => string;
}

function esc(s: unknown): string {
  const t = String(s ?? '');
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pageStyles(dir: string): string {
  return `
  @page { size: A4; margin: 12mm 10mm 12mm 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:#0f172a; font-size:11px; line-height:1.4; background:#fff; }
  .no-print { display: none !important; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #dc2626; padding-bottom:10px; margin-bottom:14px; gap:12px; }
  .brand { display:flex; align-items:center; gap:10px; }
  .brand-mark { width:36px; height:36px; background:#0f172a; color:#fff; display:flex; align-items:center; justify-content:center; border-radius:8px; font-weight:800; font-size:14px; letter-spacing:0.5px; }
  .brand-text { line-height:1.1; }
  .brand-name { font-weight:800; font-size:18px; color:#dc2626; letter-spacing:0.4px; }
  .brand-sub { font-size:10px; color:#475569; font-weight:600; text-transform:uppercase; letter-spacing:0.6px; }
  .meta { text-align:${dir === 'rtl' ? 'left' : 'right'}; font-size:10px; color:#475569; }
  .meta strong { color:#0f172a; }
  .title { font-size:16px; font-weight:800; color:#0f172a; margin:0 0 4px 0; }
  .subtitle { font-size:11px; color:#475569; margin:0 0 12px 0; }
  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px 18px; margin:12px 0; }
  .field { break-inside:avoid; }
  .field-label { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#64748b; margin-bottom:2px; }
  .field-value { font-size:12px; font-weight:600; color:#0f172a; word-break:break-word; }
  .field-value.mono { font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; }
  .barcode-box { border:1.5px solid #0f172a; border-radius:8px; padding:10px 12px; text-align:center; background:#f8fafc; margin:10px 0; break-inside:avoid; }
  .barcode-label { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.6px; color:#475569; margin-bottom:4px; }
  .barcode-value { font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:16px; font-weight:800; letter-spacing:2px; color:#0f172a; }
  .barcode-sub { font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:10px; color:#475569; margin-top:2px; letter-spacing:1px; }
  .status-badge { display:inline-block; padding:3px 8px; border-radius:999px; font-size:10px; font-weight:700; border:1px solid #e2e8f0; background:#f8fafc; }
  .card { border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:10px; break-inside:avoid; background:#fff; }
  .card-header { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px; }
  .card-tracking { font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-weight:800; color:#dc2626; font-size:13px; letter-spacing:0.5px; }
  .card-barcode { font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:10px; color:#64748b; }
  .card-customer { font-weight:700; font-size:12px; color:#0f172a; }
  .card-address { font-size:11px; color:#334155; margin-top:2px; }
  .card-meta { display:flex; gap:8px; flex-wrap:wrap; margin-top:6px; font-size:10px; color:#475569; }
  .card-amount { font-weight:800; color:#0f172a; font-size:12px; }
  .table-wrap { overflow:hidden; border:1px solid #e2e8f0; border-radius:8px; }
  table { width:100%; border-collapse:collapse; font-size:10px; }
  thead th { background:#f8fafc; color:#334155; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; font-size:9px; padding:7px 8px; border-bottom:1px solid #e2e8f0; text-align:${dir === 'rtl' ? 'right' : 'left'}; }
  tbody td { padding:7px 8px; border-bottom:1px solid #f1f5f9; vertical-align:top; }
  tbody tr:last-child td { border-bottom:none; }
  .mono { font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; }
  .text-right { text-align:right; }
  .text-center { text-align:center; }
  .footer { margin-top:16px; padding-top:8px; border-top:1px solid #e2e8f0; font-size:9px; color:#94a3b8; display:flex; justify-content:space-between; gap:12px; }
  .notice { background:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:8px 10px; border-radius:8px; font-size:10px; margin-bottom:12px; }
  .page-break { page-break-after: always; break-after: page; }
  .card-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  @media print {
    .card, .barcode-box, table { break-inside:avoid; }
    a { color:inherit; text-decoration:none; }
  }
  /* RTL adjustments */
  [dir="rtl"] .header { flex-direction: row-reverse; }
  [dir="rtl"] thead th { text-align:right; }
  `;
}

function headerHtml(ctx: ContexteImpression, titre: string, sousTitre: string): string {
  const now = new Date().toLocaleString(ctx.langue === 'ar' ? 'ar-TN' : 'fr-TN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return `
  <div class="header">
    <div class="brand">
      <div class="brand-mark">RX</div>
      <div class="brand-text">
        <div class="brand-name">RUNEX</div>
        <div class="brand-sub">Espace Expéditeur${ctx.entreprise ? ` · ${esc(ctx.entreprise)}` : ''}</div>
      </div>
    </div>
    <div class="meta">
      <div><strong dir="ltr">${esc(titre)}</strong></div>
      <div>${esc(sousTitre)}</div>
      <div>${esc(now)}</div>
    </div>
  </div>`;
}

function footerHtml(ctx: ContexteImpression, total: number, affiche: number): string {
  const lim = affiche < total ? ` — Affichés ${affiche}/${total} (limite ${MAX_IMPRESSION_COLIS})` : '';
  return `
  <div class="footer">
    <span>RUNEX — Espace Expéditeur · Document généré automatiquement · ${esc(new Date().toLocaleDateString(ctx.langue === 'ar' ? 'ar-TN' : 'fr-TN'))}${lim}</span>
    <span>Page <span class="pageNumber"></span></span>
  </div>`;
}

/**
 * Étiquettes de pièces : une par pièce, code `<code colis>-<n°>`. C'est
 * l'étiquette scannée à l'acceptation inter-dépôt ; un colis n'est reçu
 * que lorsque toutes ses pièces le sont.
 */
function etiquettesPiecesHtml(colis: PackageDto): string {
  const n = Math.max(1, Number(colis.pieceCount ?? 1));
  if (n < 2) return '';
  const labels = Array.from({ length: n }, (_, i) => {
    const code = pieceBarcode(colis.barcode, i + 1);
    return `
    <div class="barcode-box" style="break-inside:avoid; page-break-inside:avoid;">
      <div class="barcode-label">Pièce ${i + 1} / ${n} — ${esc(colis.customerName ?? '')}</div>
      <div class="barcode-value" dir="ltr">${esc(code)}</div>
      <div class="barcode-sub" dir="ltr">${esc(colis.trackingNumber)} · ${esc(colis.governorate ?? '')}${colis.destinationDepositName ? ` · ${esc(colis.destinationDepositName)}` : ''}</div>
      <div style="margin-top:6px; display:flex; justify-content:center;">${code128Svg(code, { height: 46, moduleWidth: 1.5 })}</div>
    </div>`;
  }).join('');
  return `
<div style="page-break-before:always; break-before:page;">
  <div style="font-weight:700; font-size:12px; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px; color:#334155;">Étiquettes de pièces (${n}) — à coller une par pièce</div>
  ${labels}
</div>`;
}

export function genererHtmlColisUnique(colis: PackageDto, ctx: ContexteImpression): string {
  const dir = ctx.dir;
  const statutLabel = ctx.traduireStatut ? ctx.traduireStatut(colis.status) : colis.status;
  const typeLabel = ctx.traduireType ? ctx.traduireType(colis.packageType) : colis.packageType;
  const styles = pageStyles(dir);
  const header = headerHtml(ctx, `Colis ${colis.trackingNumber}`, `Code-barres ${colis.barcode} · Créé le ${ctx.formatDateTime(colis.createdAt)}`);
  const gov = esc(colis.governorate);
  const del = esc(colis.delegation ?? '');
  const addr = esc(colis.address ?? '—');
  const phone = esc(colis.customerPhone ?? '—');
  const cust = esc(colis.customerName ?? '—');
  const shipper = esc(colis.shipperName ?? ctx.entreprise ?? '—');
  const content = esc(colis.contentSummary ?? '—');
  const notes = colis.notes ? esc(colis.notes) : '';

  return `<!doctype html>
<html lang="${esc(ctx.langue)}" dir="${esc(dir)}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>RUNEX — ${esc(colis.trackingNumber)}</title>
<style>${styles}</style>
</head>
<body>
${header}
<h1 class="title" dir="ltr">${esc(colis.trackingNumber)}</h1>
<p class="subtitle">Fiche colis — Expéditeur : <strong>${shipper}</strong> · Type : ${esc(typeLabel)} · ${esc(String(colis.pieceCount ?? 1))} pièce(s)</p>

<div class="barcode-box">
  <div class="barcode-label">Code-barres</div>
  <div class="barcode-value" dir="ltr">${esc(colis.barcode)}</div>
  <div class="barcode-sub" dir="ltr">${esc(colis.trackingNumber)} · ${esc(colis.barcode)}</div>
  <div style="margin-top:6px; display:flex; justify-content:center;">${code128Svg(colis.barcode, { height: 52, moduleWidth: 1.6 })}</div>
</div>

<div class="info-grid">
  <div class="field"><div class="field-label">Destinataire</div><div class="field-value">${cust}</div></div>
  <div class="field"><div class="field-label">Téléphone</div><div class="field-value mono" dir="ltr">${phone}</div></div>
  <div class="field"><div class="field-label">Gouvernorat</div><div class="field-value">${gov}</div></div>
  <div class="field"><div class="field-label">Délégation</div><div class="field-value">${del || '—'}</div></div>
  <div class="field" style="grid-column:1 / -1"><div class="field-label">Adresse exacte</div><div class="field-value">${addr}</div></div>
  <div class="field"><div class="field-label">Montant à encaisser (COD)</div><div class="field-value mono">${esc(ctx.formatTND(colis.totalPrice))}</div></div>
  <div class="field"><div class="field-label">Frais de livraison</div><div class="field-value mono">${esc(ctx.formatTND(colis.deliveryFee))}</div></div>
  <div class="field"><div class="field-label">Statut</div><div class="field-value"><span class="status-badge">${esc(statutLabel)}</span></div></div>
  <div class="field"><div class="field-label">Date de création</div><div class="field-value">${esc(ctx.formatDateTime(colis.createdAt))}</div></div>
  <div class="field"><div class="field-label">Type / Taille</div><div class="field-value">${esc(typeLabel)} · ${esc(colis.sizeCategory)} · ${esc(String(colis.pieceCount ?? 1))} p.</div></div>
  <div class="field"><div class="field-label">Position actuelle</div><div class="field-value">${esc(colis.currentLocation ?? colis.currentDepositName ?? '—')}</div></div>
  <div class="field" style="grid-column:1 / -1"><div class="field-label">Contenu</div><div class="field-value">${content}</div></div>
  ${colis.allowOpen ? `<div class="field"><div class="field-label">Ouverture</div><div class="field-value">Autorisée avant paiement</div></div>` : ''}
  ${notes ? `<div class="field" style="grid-column:1 / -1"><div class="field-label">Instructions</div><div class="field-value">${notes}</div></div>` : ''}
</div>

${colis.trackingTimeline && colis.trackingTimeline.length ? `
<div style="margin-top:14px; break-inside:avoid;">
  <div style="font-weight:700; font-size:11px; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px; color:#334155;">Chronologie (aperçu)</div>
  <div style="border-left:2px solid #e2e8f0; padding-left:12px; margin-left:4px;">
    ${[...colis.trackingTimeline].slice(0,6).reverse().map(ev => `
      <div style="position:relative; margin-bottom:8px;">
        <span style="position:absolute; left:-17px; top:4px; width:8px; height:8px; border-radius:50%; background:#dc2626; border:2px solid #fff; display:inline-block;"></span>
        <div style="font-weight:600; font-size:10px;">${esc(ev.label ?? ev.status ?? '')}</div>
        <div style="font-size:9px; color:#64748b;">${esc(ev.timestamp ? new Date(ev.timestamp).toLocaleString(ctx.langue === 'ar' ? 'ar-TN' : 'fr-TN') : '')} ${ev.location ? `· ${esc(ev.location)}` : ''}</div>
        ${ev.notes ? `<div style="font-size:9px; color:#475569; font-style:italic; margin-top:2px;">${esc(ev.notes)}</div>` : ''}
      </div>
    `).join('')}
  </div>
</div>` : ''}

${etiquettesPiecesHtml(colis)}

${footerHtml(ctx, 1, 1)}
<script>window.onload=()=>{ setTimeout(()=>window.print(), 300); };</script>
</body>
</html>`;
}

export function genererHtmlColisListe(
  colisList: PackageDto[],
  ctx: ContexteImpression,
  meta: { total: number; filtresResume?: string; dateDebut?: string }
): string {
  const dir = ctx.dir;
  const styles = pageStyles(dir);
  const titre = meta.filtresResume ? `Colis filtrés` : `Tous les colis`;
  const sousTitre = meta.filtresResume
    ? `${colisList.length} colis filtrés sur ${meta.total} · ${esc(meta.filtresResume)}`
    : `${colisList.length} colis sur ${meta.total}`;
  const header = headerHtml(ctx, titre, sousTitre);

  const limiteDepassee = meta.total > colisList.length;
  const notice = limiteDepassee
    ? `<div class="notice">Affichage limité à ${MAX_IMPRESSION_COLIS} colis pour l'impression (total correspondant : ${meta.total}). Pour obtenir l'intégralité, affinez vos filtres (statut, date, recherche) puis relancez l'impression.</div>`
    : '';

  // Mode tableau A4 : une ligne par colis
  const rows = colisList.map(c => {
    const statut = ctx.traduireStatut ? ctx.traduireStatut(c.status) : c.status;
    const typeL = ctx.traduireType ? ctx.traduireType(c.packageType) : c.packageType;
    return `
    <tr>
      <td class="mono" dir="ltr" style="font-weight:700; color:#dc2626;">${esc(c.trackingNumber)}<br/><span style="font-size:9px; color:#64748b;">${esc(c.barcode)}</span></td>
      <td><div style="font-weight:600;">${esc(c.customerName)}</div><div class="mono" dir="ltr" style="font-size:10px; color:#475569;">${esc(c.customerPhone)}</div></td>
      <td><div>${esc(c.governorate)}${c.delegation ? ` · ${esc(c.delegation)}` : ''}</div><div style="font-size:9px; color:#64748b; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(c.address)}</div></td>
      <td class="mono text-right" style="font-weight:700;">${esc(ctx.formatTND(c.totalPrice))}</td>
      <td style="font-size:10px;">${esc(typeL)}<br/><span style="font-size:9px; color:#64748b;">${esc(c.sizeCategory)} · ${esc(String(c.pieceCount ?? 1))} p.</span></td>
      <td><span class="status-badge" style="font-size:9px;">${esc(statut)}</span><div style="font-size:9px; color:#64748b; margin-top:2px;">${esc(ctx.formatDate(c.createdAt))}</div></td>
    </tr>`;
  }).join('');

  // Grille étiquettes (optionnelle, après tableau, pour collage)
  const etiquettes = colisList.slice(0, Math.min(12, colisList.length)).map(c => `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-tracking" dir="ltr">${esc(c.trackingNumber)}</div>
          <div class="card-barcode" dir="ltr">${esc(c.barcode)}</div>
        </div>
        <div class="card-amount mono">${esc(ctx.formatTND(c.totalPrice))}</div>
      </div>
      <div class="card-customer">${esc(c.customerName)} <span class="mono" dir="ltr" style="font-weight:400; color:#475569;">${esc(c.customerPhone)}</span></div>
      <div class="card-address">${esc(c.governorate)} · ${esc(c.delegation ?? '')} — ${esc(c.address)}</div>
      <div class="card-meta">
        <span>${ctx.traduireStatut ? esc(ctx.traduireStatut(c.status)) : esc(c.status)}</span>
        <span>·</span>
        <span>${esc(c.packageType)}</span>
        <span>·</span>
        <span>${esc(ctx.formatDate(c.createdAt))}</span>
      </div>
      <div style="margin-top:8px; display:flex; justify-content:center;">${code128Svg(c.barcode, { height: 36, moduleWidth: 1.2 })}</div>
      ${Number(c.pieceCount ?? 1) > 1 ? Array.from({ length: Number(c.pieceCount) }, (_, i) => `
      <div style="margin-top:6px; text-align:center; font-size:9px; color:#475569;" dir="ltr">Pièce ${i + 1}/${esc(String(c.pieceCount))} · ${esc(pieceBarcode(c.barcode, i + 1))}
        <div style="display:flex; justify-content:center;">${code128Svg(pieceBarcode(c.barcode, i + 1), { height: 28, moduleWidth: 1.1 })}</div>
      </div>`).join('') : ''}
    </div>
  `).join('');

  return `<!doctype html>
<html lang="${esc(ctx.langue)}" dir="${esc(dir)}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>RUNEX — ${esc(titre)} — ${colisList.length} colis</title>
<style>${styles}</style>
</head>
<body>
${header}
<h1 class="title">${esc(titre)} — ${colisList.length} colis</h1>
<p class="subtitle">Expéditeur : <strong>${esc(ctx.entreprise)}</strong> · ${esc(sousTitre)} · Généré le ${esc(new Date().toLocaleString(ctx.langue === 'ar' ? 'ar-TN' : 'fr-TN'))}</p>
${notice}
<div class="table-wrap">
<table>
<thead>
<tr>
  <th style="width:15%">Suivi / Code-barres</th>
  <th style="width:18%">Destinataire</th>
  <th style="width:27%">Destination</th>
  <th style="width:12%" class="text-right">Montant</th>
  <th style="width:13%">Type</th>
  <th style="width:15%">Statut / Date</th>
</tr>
</thead>
<tbody>
${rows || `<tr><td colspan="6" style="text-align:center; padding:24px; color:#64748b;">Aucun colis ne correspond à ces critères.</td></tr>`}
</tbody>
</table>
</div>

${colisList.length > 0 ? `
<div style="margin-top:18px;">
  <div style="font-weight:800; font-size:11px; text-transform:uppercase; letter-spacing:0.6px; color:#0f172a; margin-bottom:8px;">Étiquettes (aperçu ${Math.min(12, colisList.length)}/${colisList.length}) — à découper</div>
  <div class="card-grid">
    ${etiquettes}
  </div>
  ${colisList.length > 12 ? `<div style="font-size:10px; color:#64748b; margin-top:8px; text-align:center;">… et ${colisList.length - 12} autres colis dans le tableau ci-dessus. Impression étiquettes limitée à 12 pour lisibilité.</div>` : ''}
</div>` : ''}

${footerHtml(ctx, meta.total, colisList.length)}
<script>window.onload=()=>{ setTimeout(()=>window.print(), 350); };</script>
</body>
</html>`;
}

export function ouvrirImpression(html: string): void {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    // Fallback : impression via iframe si popup bloquée
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 1000);
    };
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
}

export async function recupererTousLesColisPourImpression(
  lister: (filtres: Record<string, unknown>) => Promise<{ colis: PackageDto[]; total: number }>,
  filtresBase: Record<string, unknown>
): Promise<{ colis: PackageDto[]; total: number }> {
  // Premier appel pour connaître le total
  const premier = await lister({ ...filtresBase, page: 1, limit: PAGE_SIZE_IMPRESSION });
  let tous = [...premier.colis];
  let total = premier.total;

  if (tous.length >= total || tous.length >= MAX_IMPRESSION_COLIS) {
    return { colis: tous.slice(0, MAX_IMPRESSION_COLIS), total };
  }

  // Cas catégories "retours" qui agrègent 4 statuts côté VueColis : le total est la somme,
  // mais le premier appel n'en a ramené que 20. On boucle pages.
  let page = 2;
  while (tous.length < total && tous.length < MAX_IMPRESSION_COLIS && page <= 10) {
    const suivant = await lister({ ...filtresBase, page, limit: PAGE_SIZE_IMPRESSION });
    if (suivant.colis.length === 0) break;
    // Éviter doublons (retours fusion)
    const connus = new Set(tous.map(c => c.id));
    for (const c of suivant.colis) if (!connus.has(c.id)) tous.push(c);
    if (suivant.colis.length < PAGE_SIZE_IMPRESSION) break;
    page += 1;
  }
  return { colis: tous.slice(0, MAX_IMPRESSION_COLIS), total };
}
