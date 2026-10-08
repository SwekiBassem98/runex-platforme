'use client';

/**
 * Bon de livraison — l'étiquette imprimée en A4 et collée sur le colis.
 *
 * Reprend la mise en page du bon utilisé par le client (modèle ADEX) :
 *
 *  ┌───────────────────────────────────────────────────────────────┐
 *  │ LOGO          Bon de Livraison N° : <numéro>        <date>    │
 *  │ ┌─────┐   ┌ EXPÉDITEUR ───────────────────────── téléphone ┐  │
 *  │ │ QR  │   │ M.F. : …   Adresse : …                         │  │
 *  │ └─────┘   └────────────────────────────────────────────────┘  │
 *  │ LGR(1/1)  ┌ DESTINATAIRE : ─────────────────────── nom ────┐  │
 *  │ départ => arrivée     Adresse / Tel / remarque · ouverture │  │
 *  │ => gouvernorat/délégation ─────────────────────────────────┘  │
 *  │ Désignation             Qté  PU HT  TVA  MT TVA  MT TTC       │
 *  │                               PRIX TOTAL :        43.000 DT   │
 *  │ Transporteur : … MF : …   ║║║║║║║║║  ☑ FRAGILE                │
 *  │                                     ☑ Autorisation d'ouverture│
 *  └───────────────────────────────────────────────────────────────┘
 *
 * Une page par pièce : la pièce i sur N porte « (i/N) » et son propre code
 * (celui scanné à l'acceptation inter-dépôt), en QR et en code-barres.
 * Toutes les valeurs viennent de l'API (`BonLivraisonDto`) : rien n'est
 * recalculé ici, hormis la mise en forme.
 */

import qrcode from 'qrcode-generator';
import type { BonLivraisonDto } from '@logixpress/types';
import { code128Svg } from '@/features/expediteur/colis/code128';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Montant au format du bon : trois décimales, point décimal (43.000). */
export function montantBon(n: number): string {
  return (Math.round(Number(n || 0) * 1000) / 1000).toFixed(3);
}

/** Date du bon : jj/mm/aaaa à l'heure de Tunis. */
export function dateBon(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Africa/Tunis',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')}`;
}

/** QR code en SVG (chemin unique, net à l'impression). */
export function qrSvg(text: string, sizeMm = 30): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const margin = 1;
  let d = '';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  const box = n + margin * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QR ${esc(text)}" ` +
    `width="${sizeMm}mm" height="${sizeMm}mm" viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges">` +
    `<rect width="${box}" height="${box}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`
  );
}

const CASE_COCHEE =
  '<svg width="4.2mm" height="4.2mm" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" fill="#fff" stroke="#000" stroke-width="1.4"/><path d="M4 8.5l3 3 5.5-7" fill="none" stroke="#000" stroke-width="1.8"/></svg>';
const CASE_VIDE =
  '<svg width="4.2mm" height="4.2mm" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" fill="#fff" stroke="#000" stroke-width="1.4"/></svg>';

function styles(): string {
  return `
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: "DejaVu Sans", Verdana, Arial, sans-serif; color: #000; font-size: 9.5pt; line-height: 1.25; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .bon { width: 100%; border: 1.2px solid #000; padding: 3mm 4mm 4mm; position: relative; }
  .entete { display: grid; grid-template-columns: 42mm 1fr 42mm; align-items: center; border-bottom: 1.2px solid #000; padding-bottom: 2mm; }
  .logo img { max-height: 13mm; max-width: 40mm; display: block; }
  .numero { text-align: center; }
  .numero small { display: block; font-size: 8pt; color: #333; }
  .numero b { font-size: 14pt; letter-spacing: .5px; font-family: "DejaVu Sans Mono", Menlo, Consolas, monospace; }
  .date { text-align: right; font-weight: 700; font-size: 11pt; }
  .corps { display: grid; grid-template-columns: 52mm 1fr; gap: 3mm; margin-top: 3mm; }
  .gauche { display: flex; flex-direction: column; align-items: center; gap: 2mm; }
  .qr { border: 1.2px solid #000; padding: 1.5mm; line-height: 0; }
  .taille { border: 1.2px solid #000; padding: .5mm 2.5mm; font-weight: 700; font-size: 14pt; }
  .taille span { font-size: 10pt; font-weight: 600; }
  .route { border: 1.2px solid #000; width: 100%; padding: .8mm 1.5mm; text-align: center; font-weight: 700; font-size: 11.5pt; line-height: 1.2; }
  .route.zone { font-size: 10pt; }
  .boite { border: 1.2px solid #000; padding: 2mm 3mm; }
  .boite + .boite { margin-top: 2.5mm; }
  .ligne-titre { display: flex; justify-content: space-between; align-items: baseline; gap: 3mm; }
  .exp-nom { font-weight: 700; font-size: 12pt; text-transform: uppercase; }
  .exp-tel { font-weight: 700; font-size: 12pt; font-family: "DejaVu Sans Mono", Menlo, Consolas, monospace; }
  .petit { font-size: 8.5pt; }
  .dest-label { font-weight: 700; font-size: 9pt; }
  .dest-nom { font-weight: 700; font-size: 12.5pt; }
  .remarque { font-size: 8.5pt; }
  table.lignes { width: 100%; border-collapse: collapse; margin-top: 3mm; }
  table.lignes th { font-size: 8.5pt; font-weight: 700; text-align: right; padding: 1mm 1.5mm; border-bottom: 1px solid #000; }
  table.lignes th.des, table.lignes td.des { text-align: left; }
  table.lignes td { font-size: 9pt; text-align: right; padding: 1mm 1.5mm; vertical-align: top; }
  table.lignes td.des { font-size: 8.5pt; }
  .total { display: flex; justify-content: flex-end; align-items: baseline; gap: 18mm; border-top: 1.2px solid #000; margin-top: 1mm; padding-top: 1.5mm; }
  .total .lib { font-weight: 700; font-size: 10pt; }
  .total .val { font-weight: 700; font-size: 13pt; }
  .pied { display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; gap: 4mm; margin-top: 2mm; }
  .transporteur { font-weight: 700; font-size: 9.5pt; }
  .code { text-align: center; }
  .code svg { display: block; margin: 0 auto; }
  .code .txt { font-family: "DejaVu Sans Mono", Menlo, Consolas, monospace; font-size: 8.5pt; letter-spacing: 1px; margin-top: .5mm; }
  .cases { margin-top: 1.5mm; display: flex; flex-direction: column; gap: 1mm; align-items: flex-start; }
  .case { display: flex; align-items: center; gap: 1.5mm; font-size: 9pt; font-weight: 600; }
  [dir="auto"] { unicode-bidi: plaintext; }
  @media screen { body { background: #e2e8f0; padding: 6mm 0; } .page { background: #fff; width: 194mm; margin: 0 auto 6mm; padding: 0; box-shadow: 0 1px 4px rgba(0,0,0,.15); } }
  `;
}

export interface OptionsBonLivraison {
  /** URL absolue du logo imprimé en tête (le logo de la plateforme). */
  logoUrl?: string;
  /** Lance la boîte d'impression à l'ouverture (vrai par défaut). */
  imprimerAuChargement?: boolean;
}

function pageBon(bon: BonLivraisonDto, pieceIndex: number, opts: OptionsBonLivraison): string {
  const piece = bon.pieces[pieceIndex] ?? { index: 1, code: bon.barcode };
  const tel = [bon.recipient.phone, bon.recipient.phoneSecondary].filter(Boolean).join(' / ');
  const zone = [bon.governorate, bon.delegation].filter(Boolean).join('/');
  // « SFAX route de sokra km 3.5 » : le gouvernorat en tête, sauf s'il figure déjà dans l'adresse.
  const gouvExp = bon.shipper.governorate ?? '';
  const adresseExp =
    gouvExp && !bon.shipper.address.toLowerCase().includes(gouvExp.toLowerCase())
      ? `${gouvExp.toUpperCase()} ${bon.shipper.address}`
      : bon.shipper.address;
  const lignes = bon.lines
    .map(
      (l) => `<tr>
        <td class="des" dir="auto">${esc(l.designation)}</td>
        <td>${esc(l.quantity)}</td>
        <td>${montantBon(l.unitPriceHT)}</td>
        <td>${esc(l.vatRate)}%</td>
        <td>${montantBon(l.vatAmount)}</td>
        <td>${montantBon(l.totalTTC)}</td>
      </tr>`
    )
    .join('');

  return `<section class="page" data-piece="${piece.index}" data-code="${esc(piece.code)}">
  <div class="bon">
    <div class="entete">
      <div class="logo">${opts.logoUrl ? `<img src="${esc(opts.logoUrl)}" alt="Logo"/>` : ''}</div>
      <div class="numero"><small>Bon de Livraison N°:</small><b data-champ="numero">${esc(bon.number)}</b></div>
      <div class="date" data-champ="date">${esc(dateBon(bon.date))}</div>
    </div>

    <div class="corps">
      <div class="gauche">
        <div class="qr">${qrSvg(piece.code, 30)}</div>
        <div class="taille" data-champ="taille">${esc(bon.sizeShort)}<span>(${piece.index}/${bon.pieceCount})</span></div>
        <div class="route" data-champ="route" dir="auto">${esc(bon.originAgency)} =&gt; ${esc(bon.destinationAgency)}</div>
        <div class="route zone" data-champ="zone" dir="auto">=&gt; ${esc(zone)}</div>
      </div>

      <div class="droite">
        <div class="boite" data-champ="expediteur">
          <div class="ligne-titre">
            <span class="exp-nom" dir="auto">${esc(bon.shipper.name)}</span>
            <span class="exp-tel">${esc(bon.shipper.phone)}</span>
          </div>
          <div class="petit">M.F. :${esc(bon.shipper.taxId ?? '—')}</div>
          <div class="petit" dir="auto">Adresse :${esc(adresseExp)}</div>
        </div>
        <div class="boite" data-champ="destinataire">
          <div class="ligne-titre">
            <span class="dest-label">DESTINATAIRE:</span>
            <span class="dest-nom" dir="auto">${esc(bon.recipient.name)}</span>
          </div>
          <div class="petit">Adresse: <span dir="auto">${esc(bon.recipient.address)}</span>${bon.recipient.governorate ? ` / ${esc(bon.recipient.governorate)}` : ''}</div>
          <div class="petit">Tel:${esc(tel)}</div>
          <div class="remarque"><span dir="auto">${esc(bon.remark)}</span>${bon.allowOpen ? ' · Autorisation d’ouvrir le colis' : ''}</div>
        </div>
      </div>
    </div>

    <table class="lignes">
      <thead><tr>
        <th class="des">Désignation</th><th>Qté</th><th>PU HT</th><th>TVA</th><th>MT TVA</th><th>MT TTC</th>
      </tr></thead>
      <tbody>${lignes}</tbody>
    </table>
    <div class="total"><span class="lib">PRIX TOTAL :</span><span class="val" data-champ="total">${montantBon(bon.total)} DT</span></div>

    <div class="pied">
      <div class="transporteur" data-champ="transporteur">
        Transporteur : ${esc(bon.carrier.name)}<br/>MF: ${esc(bon.carrier.taxRegistration ?? '—')}
      </div>
      <div class="code">
        ${code128Svg(piece.code, { height: 48, moduleWidth: 1.25 })}
        <div class="txt">${esc(piece.code)}</div>
        <div class="cases">
          <span class="case" data-champ="fragile" data-coche="${bon.isFragile}">${bon.isFragile ? CASE_COCHEE : CASE_VIDE} FRAGILE</span>
          <span class="case" data-champ="ouverture" data-coche="${bon.allowOpen}">${bon.allowOpen ? CASE_COCHEE : CASE_VIDE} Autorisation d’ouverture</span>
        </div>
      </div>
      <div></div>
    </div>
  </div>
</section>`;
}

/** Document HTML autonome : une page A4 par pièce de chaque colis. */
export function genererHtmlBonsLivraison(bons: BonLivraisonDto[], opts: OptionsBonLivraison = {}): string {
  const pages = bons
    .flatMap((bon) => Array.from({ length: Math.max(1, bon.pieceCount) }, (_, i) => pageBon(bon, i, opts)))
    .join('\n');
  const titre =
    bons.length === 1 ? `Bon de livraison ${bons[0]!.number}` : `Bons de livraison (${bons.length} colis)`;
  const auto = opts.imprimerAuChargement !== false;
  return `<!doctype html>
<html lang="fr" dir="ltr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(titre)}</title>
<style>${styles()}</style>
</head>
<body>
${pages}
${auto ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});</script>` : ''}
</body>
</html>`;
}

/** Ouvre la fenêtre d'impression (iframe en secours si les fenêtres sont bloquées). */
export function imprimerBonsLivraison(bons: BonLivraisonDto[]): void {
  const logoUrl = `${window.location.origin}/brand/runex-logo.jpeg`;
  const html = genererHtmlBonsLivraison(bons, { logoUrl });
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    return;
  }
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(genererHtmlBonsLivraison(bons, { logoUrl, imprimerAuChargement: false }));
  doc.close();
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1000);
  };
}
