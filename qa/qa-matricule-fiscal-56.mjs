#!/usr/bin/env node
/**
 * QA 56 — matricule fiscal de RUNEX (1906149) sur les documents (16/11) :
 * bon de livraison d'un colis, feuille de tournée, bordereau de paiement,
 * et la migration qui corrige la fiche société.
 *
 *   QA_API_URL=… QA_WEB_URL=… PUPPETEER_CORE=… CHROME=… [QA_SHOTS=…] node qa/qa-matricule-fiscal-56.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const W = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const DB = process.env.QA_DB_URL ?? 'postgresql://prod_owner:ownerpw@localhost:5432/runex_qa';
const SHOTS = process.env.QA_SHOTS ?? '';
const MF = '1906149';
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
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');

console.log('\n1. Fiche société (migration)');
sql(`UPDATE "Company" SET "taxRegistration"='9876543/M/000', "legalName"='LogiXpress Tunisie SARL'`);
sql(readFileSync(new URL('../prisma/migrations/20261116000000_matricule_fiscal_runex/migration.sql', import.meta.url), 'utf8').replace(/--.*$/gm, ''));
ok(sql(`SELECT DISTINCT "taxRegistration" FROM "Company"`) === MF, 'migration : matricule fiscal 1906149 sur la fiche société');
ok(sql(`SELECT DISTINCT "legalName" FROM "Company"`) === 'RUNEX', 'migration : raison sociale de démonstration remplacée par RUNEX');

console.log('\n2. API');
const c = (await api(exp, 'POST', '/colis', { customerName: 'Q56 MF', customerPhone: '98561234', governorate: 'Tunis', delegation: 'La Marsa', address: 'Rue 56', goodsPrice: 20 })).data;
const bon = (await api(exp, 'GET', `/colis/${c.id}/bon-livraison`)).data;
ok(bon?.carrier?.taxRegistration === MF && bon.carrier.name === 'RUNEX', 'bon de livraison : transporteur RUNEX, M.F. 1906149', JSON.stringify(bon?.carrier));
sql(`UPDATE "Company" SET "taxRegistration"=NULL`);
const bon2 = (await api(exp, 'GET', `/colis/${c.id}/bon-livraison`)).data;
ok(bon2?.carrier?.taxRegistration === MF, 'fiche société vide : repli sur 1906149');
sql(`UPDATE "Company" SET "taxRegistration"='${MF}'`);
const rs = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
const imp = (await api(admin, 'GET', `/runsheets/${rs.id}/impression`)).data;
ok(imp?.matriculeFiscal === MF, 'feuille de tournée : M/F 1906149', String(imp?.matriculeFiscal));

console.log('\n3. Documents imprimés');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const errs = [];
const popup = async (ctx, p, clic) => {
  const cible = new Promise((r) => ctx.once('targetcreated', r));
  await clic();
  const tg = await Promise.race([cible, sleep(8000).then(() => null)]);
  const pop = tg ? await tg.page() : null;
  if (pop) { await pop.evaluate(() => { window.print = () => {}; }).catch(() => {}); await sleep(1500); }
  return pop;
};
// Bon de livraison (portail expéditeur)
let ctx = await b.createBrowserContext();
let p = await ctx.newPage(); await p.setViewport({ width: 1366, height: 900 });
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'expediteur@bluestar.tn'); await p.type('input[type=password]', 'Exp123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
await p.goto(`${W}/expediteur/colis/${c.id}`, { waitUntil: 'networkidle2' }); await sleep(1000);
let pop = await popup(ctx, p, () => p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^Bon de livraison$/.test(x.innerText.trim()))?.click()));
ok(!!pop, 'bon de livraison ouvert');
if (pop) {
  await pop.waitForSelector('section.page', { timeout: 8000 }).catch(() => {});
  const info = await pop.evaluate(() => ({
    entete: document.querySelector('[data-champ=mf-runex]')?.textContent?.trim(),
    pied: document.querySelector('[data-champ=transporteur]')?.textContent?.replace(/\s+/g, ' ').trim(),
  }));
  ok(info.entete === `M.F. : ${MF}`, 'bon de livraison : M.F. 1906149 sous le logo', info.entete);
  ok(info.pied?.includes('Transporteur : RUNEX') && info.pied.includes(`MF: ${MF}`), 'bon de livraison : « Transporteur : RUNEX — MF: 1906149 »', info.pied);
  if (SHOTS) { await pop.setViewport({ width: 900, height: 1200 }); await pop.screenshot({ path: `${SHOTS}/56-bon-livraison.png` }); }
}
// Liste imprimée du portail
await ctx.close();

// Bordereau de paiement et feuille de tournée (exploitation)
ctx = await b.createBrowserContext();
p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 950 });
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
// Un colis livré pour avoir un bordereau.
const hub = (await api(admin, 'GET', '/inter-depots/form-options')).data.deposits.find((d) => d.isMainHub);
const l = (await api(exp, 'POST', '/colis', { customerName: 'Q56 Livré', customerPhone: '98561235', governorate: 'Tunis', delegation: 'La Marsa', address: 'Rue 56', goodsPrice: 30 })).data;
await api(admin, 'POST', '/depot/reception', { code: l.barcode, depositId: hub.id });
await api(admin, 'POST', `/runsheets/${rs.id}/add-package`, { packageIdentifier: l.trackingNumber });
await api(hamza, 'POST', `/colis/${l.id}/start`, {});
await api(hamza, 'POST', `/colis/${l.id}/deliver`, { collectedAmount: Number(l.totalPrice) });
const shipperId = (await api(exp, 'GET', '/auth/me')).data.shipperId;
const v = await api(admin, 'POST', '/payments/vouchers', { shipperId });
ok(v.status < 300, 'bordereau de paiement créé', `${v.status} ${v.message}`);
await p.goto(W + '/paiements/bordereaux', { waitUntil: 'networkidle2' }); await sleep(1500);
pop = await popup(ctx, p, () => p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^Imprimer$/.test(x.innerText.trim()))?.click()));
if (pop) {
  const t = await pop.evaluate(() => ({ mf: document.querySelector('[data-champ=mf-runex]')?.textContent?.trim(), pied: document.querySelector('[data-champ=mention-legale]')?.textContent?.trim() }));
  ok(t.mf === `M.F. RUNEX : ${MF}` && t.pied === `RUNEX · M.F. ${MF}`, 'bordereau de paiement : M.F. 1906149 (en-tête et pied)', JSON.stringify(t));
  if (SHOTS) await pop.screenshot({ path: `${SHOTS}/56-bordereau.png` });
} else ok(false, 'bordereau de paiement imprimé');
await p.goto(`${W}/runsheets`, { waitUntil: 'networkidle2' }); await sleep(2000);
pop = await popup(ctx, p, () => p.evaluate((n) => document.querySelector(`[aria-label="Imprimer la runsheet ${n}"]`)?.click(), rs.runsheetNumber));
if (pop) {
  const t = await pop.evaluate(() => ({ mf: document.querySelector('.mf')?.textContent?.trim(), pied: document.querySelector('[data-champ=mention-legale]')?.textContent?.trim() }));
  ok(t.mf === `M/F : ${MF}` && t.pied === `RUNEX · M.F. ${MF}`, 'feuille de tournée imprimée : M/F 1906149', JSON.stringify(t));
} else ok(false, 'feuille de tournée imprimée');
await ctx.close();
await b.close();
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
