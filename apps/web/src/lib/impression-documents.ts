/**
 * Documents imprimables de la caisse et des retours : bon de retour
 * expéditeur et bordereau de paiement. HTML autonome, ouvert dans une
 * fenêtre d'impression. Les codes de remise ne sont jamais imprimés.
 */
import type { PaymentVoucherDto } from '@logixpress/types';
import type { BonRetourDetail, ValidationTournee } from './api';
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
      ${Number(v.managementFeesTotal ?? 0) > 0 ? `<tr><td>Frais de gestion</td><td class="r">− ${dt(v.managementFeesTotal ?? 0)}</td></tr>` : ''}
      <tr><td>Retenue à la source${Number(v.withholdingTaxRate ?? 0) > 0 ? ` (${Math.round(Number(v.withholdingTaxRate) * 10000) / 100} % du net)` : ''}</td><td class="r">− ${dt(v.withholdingTaxTotal)}</td></tr>
      <tr class="tot"><td>Net à payer</td><td class="r">${dt(v.netPayable)}</td></tr></tbody></table>
      ${v.paidAt ? `<p>Réglé le ${date(v.paidAt)}.</p>` : ''}
      <div class="sign"><div>Caisse RUNEX</div><div>Expéditeur — nom et signature</div></div>`
    )
  );
}

/* ------------------------------------------------------------------ */
/* Feuille de validation d'une tournée                                 */
/* ------------------------------------------------------------------ */

const ETAT_IMPRIME: Record<string, string> = {
  LIVRE: 'Livré',
  REPORTE: 'Reporté',
  RETOUR: 'Retour définitif',
  NON_TRAITE: 'Non traité',
  ANNULE: 'Annulé',
};

const STATUT_TOURNEE: Record<string, string> = {
  EN_ATTENTE: 'En attente',
  VALIDEE_DEPART: 'Départ validé',
  EN_COURS: 'En tournée',
  RETOUR_DEPOT: 'Revenue au dépôt',
  CLOTUREE_CONFORME: 'Validée — conforme',
  CLOTUREE_DEFICIT: 'Validée — déficit',
  ANNULEE: 'Annulée',
};

/** Feuille de la tournée : livreur, totaux de clôture, colis et écarts, signatures. */
export function imprimerValidationTournee(v: ValidationTournee): void {
  const logo = `${window.location.origin}/brand/runex-logo.jpeg`;
  const t = v.totaux;
  const lignes = v.colis
    .map(
      (c, i) => `<tr><td class="c">${i + 1}</td><td class="mono">${esc(c.trackingNumber)}</td><td>${esc(c.customerName)}<br><small>${esc(c.shipperName)}</small></td>
      <td class="c">${c.pieceCount}</td><td>${esc(ETAT_IMPRIME[c.etat] ?? c.statusLabel)}</td><td class="r">${dt(c.price)}</td>
      <td class="r">${c.etat === 'LIVRE' ? dt(c.paid) : '—'}</td><td class="r ${c.etat === 'LIVRE' && Math.abs(c.ecart) > 0.0005 ? 'alerte' : ''}">${c.etat === 'LIVRE' && Math.abs(c.ecart) > 0.0005 ? dt(c.ecart) : ''}</td></tr>`
    )
    .join('');
  ouvrirImpression(
    page(
      `Tournée ${v.runsheetNumber}`,
      `<style>
        .cadre{border:1.5px solid #94a3b8;padding:10px 12px;margin-bottom:10px;border-radius:6px}
        .entete{display:flex;align-items:center;gap:18px}.entete img.logo{height:46px}
        .entete h1{flex:1;font-size:20px}.entete .qr svg{width:84px;height:84px}
        .grille{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px}
        td.c{text-align:center} small{color:#64748b} .alerte{color:#b91c1c;font-weight:bold}
        .totaux{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
        .totaux div{border:1px solid #e2e8f0;border-radius:6px;padding:6px 8px}
        .totaux b{display:block;font-size:14px} .rouge{color:#b91c1c}.vert{color:#047857}
        .bande{height:4px;background:#dc2626;margin:-4px 0 12px}
      </style>
      <div class="cadre entete"><img class="logo" src="${esc(logo)}" alt="RUNEX"><h1>Validation de la tournée N° ${esc(v.runsheetNumber)}</h1><div class="qr">${qrSvg(v.runsheetNumber, 24)}</div></div>
      <div class="bande"></div>
      <div class="cadre grille">
        <div><b>Livreur :</b> ${esc(v.driver.name)} (${esc(v.driver.code)})</div>
        <div><b>Matricule :</b> ${esc(v.driver.plate ?? '—')}</div>
        <div><b>Agence :</b> ${esc(v.depositName)}</div>
        <div><b>Date de tournée :</b> ${esc(new Date(`${v.tourDate}T12:00:00`).toLocaleDateString('fr-TN'))}</div>
        <div><b>État :</b> ${esc(STATUT_TOURNEE[v.status] ?? v.status)}</div>
        <div><b>Validée par :</b> ${esc(v.validatedBy ?? '—')}${v.closedAt ? ` le ${esc(date(v.closedAt))}` : ''}</div>
      </div>
      <div class="totaux">
        <div>Colis<b>${t.colis} (${t.pieces} pièces)</b></div>
        <div>Livrés<b class="vert">${t.livres}</b></div>
        <div>Reportés / retours<b>${t.reportes} / ${t.retours}</b></div>
        <div>Non traités<b>${t.nonTraites}</b></div>
        <div>Total colis livrés<b>${dt(t.totalColisLivres)}</b></div>
        <div>Total réglé<b class="${Math.abs(t.ecart) > 0.0005 ? 'rouge' : ''}">${dt(t.totalReglement)}</b></div>
        <div>Recette espèces<b class="vert">${dt(t.recetteEspece)}</b></div>
        <div>Recette chèques (${t.nbCheques})<b>${dt(t.recetteCheque)}</b></div>
        <div>Espèces remises<b>${dt(t.especesRemises)}</b></div>
        <div>Déficit<b class="${t.deficit > 0 ? 'rouge' : 'vert'}">${dt(t.deficit)}</b></div>
      </div>
      <table><thead><tr><th class="c">N°</th><th>Colis</th><th>Client / expéditeur</th><th class="c">Pièces</th><th>État</th><th class="r">Prix</th><th class="r">Payé</th><th class="r">Écart</th></tr></thead>
      <tbody>${lignes || '<tr><td colspan="8" class="c muted">Aucun colis.</td></tr>'}</tbody></table>
      <div class="sign"><div>Caisse — ${esc(v.depositName)}</div><div>Livreur — ${esc(v.driver.name)}</div></div>`
    )
  );
}

/* ------------------------------------------------------------------ */
/* Fiche d'encaissement (comptage de caisse)                           */
/* ------------------------------------------------------------------ */

export interface FicheEncaissement {
  livreur: string;
  code: string;
  runsheets: string;
  nature: string;
  caissier: string;
  billets: { valeur: number; type: 'billet' | 'pièce'; nombre: number | null }[];
  operations: { libelle: string; montant: number | null }[];
  fondDeCaisse: number | null;
}

/** Valeurs des billets et pièces tunisiens, du plus grand au plus petit. */
export const COUPURES: { valeur: number; type: 'billet' | 'pièce' }[] = [
  { valeur: 50, type: 'billet' },
  { valeur: 20, type: 'billet' },
  { valeur: 10, type: 'billet' },
  { valeur: 5, type: 'billet' },
  { valeur: 5, type: 'pièce' },
  { valeur: 2, type: 'pièce' },
  { valeur: 1, type: 'pièce' },
  { valeur: 0.5, type: 'pièce' },
  { valeur: 0.2, type: 'pièce' },
  { valeur: 0.1, type: 'pièce' },
  { valeur: 0.05, type: 'pièce' },
];

/** Totaux de la fiche : comptage, opérations, décalage = comptage − opérations − fond de caisse. */
export function totauxFiche(f: Pick<FicheEncaissement, 'billets' | 'operations' | 'fondDeCaisse'>) {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const total = r3(f.billets.reduce((s, b) => s + (b.nombre ?? 0) * b.valeur, 0));
  const operations = r3(f.operations.reduce((s, o) => s + (o.montant ?? 0), 0));
  const fond = r3(f.fondDeCaisse ?? 0);
  return { total, operations, fond, decalage: r3(total - operations - fond) };
}

const nb2 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** Fiche d'encaissement d'un livreur, comme la feuille « ENCAISSEMENT » de la caisse. */
export function imprimerFicheEncaissement(f: FicheEncaissement): void {
  const logo = `${window.location.origin}/brand/runex-logo.jpeg`;
  const tot = totauxFiche(f);
  const compte = f.billets.some((b) => b.nombre !== null);
  const lignesBillets = f.billets
    .map(
      (b) => `<tr><td class="coup">${nb2(b.valeur).replace(/,00$/, '')}<small> ${b.type === 'pièce' ? 'pièce' : 'billet'}</small></td>
      <td class="c">${b.nombre ?? ''}</td><td class="r">${b.nombre !== null ? nb2(b.nombre * b.valeur) : ''}</td></tr>`
    )
    .join('');
  const nbLignesOp = Math.max(f.operations.length, f.billets.length);
  const lignesOps = Array.from({ length: nbLignesOp }, (_, i) => {
    const o = f.operations[i];
    return `<tr><td>${o ? esc(o.libelle) : '&nbsp;'}</td><td class="r">${o && o.montant !== null ? nb2(o.montant) : ''}</td></tr>`;
  }).join('');
  const maintenant = new Date().toLocaleString('fr-TN');
  ouvrirImpression(
    page(
      `Encaissement ${f.livreur}`,
      `<style>
        .entete{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #dc2626;padding-bottom:8px;margin-bottom:12px}
        .entete img{height:44px}.entete h1{font-size:20px;letter-spacing:2px}
        .info th{background:#0f172a;color:#fff}.info td{height:28px;font-size:13px}
        .deux{display:grid;grid-template-columns:1fr 1.2fr;gap:12px;margin-top:12px}
        .deux table{margin-top:0} .deux th{background:#1e293b;color:#fff}
        td.coup{font-weight:bold;font-size:14px} td.coup small{font-weight:normal;color:#64748b;font-size:10px}
        td{height:22px} td.c{text-align:center}
        .totaux{width:60%;margin-top:12px}
        .totaux td:first-child{font-weight:bold;background:#fef3c7;width:55%}
        .totaux tr.dec td:first-child{background:#fee2e2;color:#991b1b}
        .totaux tr.dec td:last-child{color:${tot.decalage === 0 ? '#047857' : '#b91c1c'};font-weight:bold}
        .sign{margin-top:46px}
      </style>
      <div class="entete"><img src="${esc(logo)}" alt="RUNEX"><h1>ENCAISSEMENT</h1><div class="muted">${esc(maintenant)}</div></div>
      <table class="info"><thead><tr><th>Nom &amp; prénom</th><th>Runsheet</th><th>Nature</th><th>Caissier</th></tr></thead>
      <tbody><tr><td><b>${esc(f.livreur)}</b><br><small>${esc(f.code)}</small></td><td class="mono">${esc(f.runsheets || '—')}</td><td>${esc(f.nature)}</td><td>${esc(f.caissier)}</td></tr></tbody></table>
      <div class="deux">
        <table><thead><tr><th>Billet</th><th class="c">Nombre</th><th class="r">Montant</th></tr></thead><tbody>${lignesBillets}</tbody>
        <tfoot><tr class="tot"><td>Total</td><td></td><td class="r">${compte ? nb2(tot.total) : ''}</td></tr></tfoot></table>
        <table><thead><tr><th>Opération</th><th class="r">Montant</th></tr></thead><tbody>${lignesOps}</tbody>
        <tfoot><tr class="tot"><td>Total opérations</td><td class="r">${nb2(tot.operations)}</td></tr></tfoot></table>
      </div>
      <table class="totaux"><tbody>
        <tr><td>TOTAL</td><td class="r">${compte ? nb2(tot.total) : ''}</td></tr>
        <tr><td>TOTAL OPÉRATION</td><td class="r">${nb2(tot.operations)}</td></tr>
        <tr><td>FOND DE CAISSE</td><td class="r">${f.fondDeCaisse !== null ? nb2(tot.fond) : ''}</td></tr>
        <tr class="dec"><td>DÉCALAGE</td><td class="r">${compte ? nb2(tot.decalage) : ''}</td></tr>
      </tbody></table>
      <div class="sign"><div>Signature du caissier</div><div>Signature du livreur</div></div>`
    )
  );
}
