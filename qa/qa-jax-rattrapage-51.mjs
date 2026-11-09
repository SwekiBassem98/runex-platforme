#!/usr/bin/env node
/**
 * QA 51 — Sous-traitance JAX › « Restés chez Runex » : envoyer d'un coup à JAX
 * les colis restés chez Runex (créés avant la mise en service de JAX), pas
 * encore livrés, retournés ni annulés (demande du client, 09/11).
 *
 *  - en préparation / inter-dépôt : créés chez JAX, confiés à leur réception ;
 *  - en agence : confiés aussitôt (« Confié au partenaire JAX ») ;
 *  - en tournée (affecté, en cours de livraison, reporté) : retirés de la
 *    tournée puis confiés ;
 *  - livrés, repris volontairement : non concernés ; JAX en panne : refusés,
 *    gardés pour un nouvel essai.
 *
 * Prérequis : faux serveur JAX (qa/mock-jax-server.mjs) et l'API lancée avec
 * JAX_API_URL=http://localhost:4010/api JAX_API_TOKEN=test-jax JAX_SYNC_MINUTES=0.
 *
 *   QA_API_URL=… QA_WEB_URL=… QA_DB_URL=… PUPPETEER_CORE=… CHROME=… [QA_SHOTS=…] node qa/qa-jax-rattrapage-51.mjs
 */
import { execFileSync } from 'node:child_process';

const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const W = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const JAX = (process.env.QA_JAX_URL ?? 'http://localhost:4010').replace(/\/+$/, '');
const DB = process.env.QA_DB_URL ?? 'postgresql://prod_owner:ownerpw@localhost:5432/runex_qa';
const SHOTS = process.env.QA_SHOTS ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const failures = [];
const ok = (c, l, d = '') => {
  if (c) { pass++; console.log(`  ✔ ${l}`); } else { failures.push(l); console.log(`  ✘ ${l}${d ? ` — ${d}` : ''}`); }
};
async function api(token, method, p, body) {
  const h = { Accept: 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${API}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* vide */ }
  return { status: r.status, data: j?.data, message: j?.message };
}
const sql = (q) => execFileSync('psql', [DB, '-qAtc', q], { encoding: 'utf8' }).trim();
const jax = async (p, body) => (await fetch(`${JAX}${p}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json();
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const attendre = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(200); } return null; };

await jax('/__control/reset', {});
const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const opts = (await api(admin, 'GET', '/inter-depots/form-options')).data;
const hub = opts.deposits.find((d) => d.isMainHub);
const sousse = opts.deposits.find((d) => d.name === 'Agence Sousse');
const lire = async (id) => (await api(admin, 'GET', `/colis/${id}`)).data;
const sfx = Date.now().toString().slice(-4);
let n = 0;
// Colis « d'avant JAX » : créé puis privé de sa fiche JAX de création.
const ancien = async (gov = 'Tunis', deleg = 'La Marsa') => {
  n++;
  const c = (await api(exp, 'POST', '/colis', { customerName: `Q51 ${sfx}-${n}`, customerPhone: `9851${sfx}`.slice(0, 7) + (n % 10), governorate: gov, delegation: deleg, address: `Rue ${n}`, goodsPrice: 20 + n })).data;
  sql(`DELETE FROM "SousTraitance" WHERE "packageId" = '${c.id}'`);
  return c;
};
const recevoir = (c, depositId = hub.id) => api(admin, 'POST', '/depot/reception', { code: c.barcode, depositId });

console.log('\n1. Colis restés chez Runex, dans tous les états');
const rs = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
ok(!!rs?.id, 'tournée active du livreur Hamza', rs?.runsheetNumber);
const enTournee = async (c) => { await recevoir(c); return api(admin, 'POST', `/runsheets/${rs.id}/add-package`, { packageIdentifier: c.trackingNumber }); };
const cCree = await ancien();
const cAgence = await ancien(); await recevoir(cAgence);
const cAffecte = await ancien(); await enTournee(cAffecte);
const cRoute = await ancien(); await enTournee(cRoute); await api(hamza, 'POST', `/colis/${cRoute.id}/start`, {});
const cReporte = await ancien(); await enTournee(cReporte); await api(hamza, 'POST', `/colis/${cReporte.id}/start`, {}); await api(hamza, 'POST', `/colis/${cReporte.id}/postpone`, { reason: 'Client absent' });
const cTransit = await ancien('Sousse', 'Akouda'); await recevoir(cTransit);
const T = (await api(admin, 'POST', '/inter-depots', { type: 'LIVRAISON', destinationDepositId: sousse.id, transporterDriverId: opts.drivers[0].id })).data;
await api(admin, 'POST', `/inter-depots/${T.transferNumber}/scan`, { code: cTransit.barcode, mode: 'add' });
const cLivre = await ancien(); await enTournee(cLivre); await api(hamza, 'POST', `/colis/${cLivre.id}/deliver`, { collectedAmount: Number(cLivre.totalPrice) });
const cRepris = await ancien(); await recevoir(cRepris);
await api(admin, 'POST', '/sous-traitance/jax/envoyer', { packageIds: [cRepris.id] });
await api(admin, 'POST', `/sous-traitance/jax/colis/${cRepris.id}/reprendre`);
const etats = Object.fromEntries(await Promise.all([cCree, cAgence, cAffecte, cRoute, cReporte, cTransit, cLivre, cRepris].map(async (c) => [c.customerName, (await lire(c.id)).status])));
ok(
  (await lire(cCree.id)).status === 'CREE' && (await lire(cAgence.id)).status === 'RECU_DEPOT' && (await lire(cAffecte.id)).status === 'AFFECTE_RUNSHEET' &&
    (await lire(cRoute.id)).status === 'EN_COURS_LIVRAISON' && (await lire(cReporte.id)).status === 'REPORTE' && (await lire(cLivre.id)).status === 'LIVRE' &&
    /INTER_DEPOT/.test((await lire(cTransit.id)).status) && (await lire(cRepris.id)).sousTraitance?.etat === 'ANNULE',
  'jeu d’essai : préparation, agence, affecté, en route, reporté, inter-dépôt, livré, repris',
  JSON.stringify(etats)
);

console.log('\n2. Aperçu');
const a = (await api(admin, 'GET', '/sous-traitance/jax/rattrapage')).data;
const ids = new Set(a.colis.map((x) => x.id));
ok([cCree, cAgence, cAffecte, cRoute, cReporte, cTransit].every((c) => ids.has(c.id)), 'les 6 colis restés chez Runex sont listés');
ok(!ids.has(cLivre.id) && !ids.has(cRepris.id), 'colis livré et colis repris volontairement : non concernés');
ok(a.enTournee >= 3 && a.colis.find((x) => x.id === cRoute.id)?.enTournee, 'colis en tournée signalés (seront retirés)', String(a.enTournee));
ok(a.parStatut.length >= 5 && a.total === ids.size, 'répartition par statut', JSON.stringify(a.parStatut));

console.log('\n3. Panne JAX : rien n’est perdu');
await jax('/__control/panne', { actif: true });
let r = await api(admin, 'POST', '/sous-traitance/jax/rattrapage', { exclure: [] });
ok(r.status === 200 && r.data.reussis === 0 && r.data.echecs.length > 0, 'JAX en panne : envois refusés, motif donné', r.message);
await jax('/__control/panne', { actif: false });
ok((await lire(cAgence.id)).status === 'RECU_DEPOT' && (await lire(cCree.id)).status === 'CREE', 'colis inchangés chez Runex');
ok((await lire(cRoute.id)).status === 'RECU_DEPOT' && !(await lire(cRoute.id)).currentRunsheetId, 'colis en route : déjà retiré de la tournée (rapporté au dépôt)');

console.log('\n4. Envoi depuis l’écran');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
await p.goto(W + '/sous-traitance', { waitUntil: 'networkidle2' });
await p.click('[data-testid=onglet-rattrapage]');
await p.waitForSelector('[data-testid=rattrapage-resume]', { timeout: 8000 });
const resume = await p.$eval('[data-testid=rattrapage-resume]', (x) => x.innerText);
ok(/colis restés chez Runex/.test(resume) && /En cours de livraison|Reçu au dépôt/.test(resume), 'onglet « Restés chez Runex » : total et statuts', resume.replace(/\s+/g, ' '));
if (SHOTS) await p.screenshot({ path: `${SHOTS}/51-restes-chez-runex.png`, fullPage: true });
await p.click('[data-testid=rattrapage-envoyer]');
await p.waitForSelector('[data-testid=rattrapage-confirmer]', { timeout: 4000 });
await p.click('[data-testid=rattrapage-confirmer]');
await p.waitForSelector('[data-testid=rattrapage-progression]', { timeout: 5000 }).catch(() => {});
const fini = await attendre(async () => !(await p.$('[data-testid=rattrapage-progression]')) && !!(await p.$('[data-testid=rattrapage-envoyer]')), 90000);
const apres = (await api(admin, 'GET', '/sous-traitance/jax/rattrapage')).data;
ok(!!fini && ![cCree, cAgence, cAffecte, cRoute, cReporte, cTransit].some((c) => apres.colis.some((x) => x.id === c.id)), 'envoi terminé : nos colis ne sont plus « restés chez Runex »', `reste ${apres.total}`);
if (SHOTS) await p.screenshot({ path: `${SHOTS}/51-apres-envoi.png`, fullPage: true });
await b.close();
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));

console.log('\n5. Résultat');
const chez = (await jax('/__control/etat')).colis;
const chezJax = (c) => chez.some((x) => x.recu?.referenceExterne === c.trackingNumber);
ok([cCree, cAgence, cAffecte, cRoute, cReporte, cTransit].every(chezJax), 'les 6 colis sont créés chez JAX');
ok(!(await lire(cLivre.id)).sousTraitance && chez.filter((x) => x.recu?.referenceExterne === cLivre.trackingNumber).length <= 1, 'le colis livré n’est pas envoyé');
for (const [c, lib] of [[cAgence, 'en agence'], [cAffecte, 'affecté à une tournée'], [cRoute, 'en cours de livraison'], [cReporte, 'reporté']]) {
  const d = await lire(c.id);
  ok(d.status === 'SOUS_TRAITE' && !d.currentRunsheetId && /^[A-Z]{3}\d+/.test(d.sousTraitance?.codeExterne ?? ''), `${lib} → « Confié au partenaire JAX », hors tournée`, `${d.status} ${d.currentRunsheetId}`);
}
let d = await lire(cCree.id);
ok(d.status === 'CREE' && d.sousTraitance?.codeExterne, 'en préparation → créé chez JAX, confié à sa réception');
d = await lire(cTransit.id);
ok(/INTER_DEPOT/.test(d.status) && d.sousTraitance?.codeExterne && d.sousTraitance.agence === sousse.name, 'en inter-dépôt → créé chez JAX, enlèvement prévu à l’agence d’arrivée', `${d.status} ${d.sousTraitance?.agence}`);
const tournee = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
const restants = JSON.stringify(tournee?.packages ?? tournee?.colis ?? tournee ?? '');
ok(![cAffecte, cRoute, cReporte].some((c) => restants.includes(c.trackingNumber)), 'application du livreur : colis retirés de sa tournée');
await recevoir(cCree);
ok(!!(await attendre(async () => (await lire(cCree.id)).status === 'SOUS_TRAITE')), 'réception du colis en préparation → « Confié au partenaire JAX »');
const fin = (await api(admin, 'GET', '/sous-traitance/jax/rattrapage')).data;
ok(fin.total === 0, 'plus rien à rattraper (base de démonstration comprise)', JSON.stringify(fin.colis.slice(0, 3).map((x) => [x.trackingNumber, x.status, x.erreur])));

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
