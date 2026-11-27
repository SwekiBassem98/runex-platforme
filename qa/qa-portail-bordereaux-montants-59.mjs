#!/usr/bin/env node
/**
 * QA 59 — montants des bordereaux dans le portail expéditeur (25/11).
 *
 * Constat : l'exploitation crée puis paie un bordereau ; chez elle les montants
 * sont justes, mais dans le portail expéditeur le récapitulatif « Net payable »
 * additionnait tous les bordereaux (payés et annulés compris) et ne bougeait
 * plus — la page ne se relisait pas non plus.
 *
 * Attendu, avec les mêmes chiffres que l'exploitation :
 *   - « À percevoir » = bordereaux à payer (« À payer » des deux côtés) ;
 *   - « Déjà réglé » = bordereaux payés ; un bordereau annulé ne compte pas ;
 *   - « Prochain bordereau (estimé) » = le « À régler » de l'exploitation ;
 *   - la page suit seule la création et le paiement (relecture discrète).
 *
 *   QA_API_URL=… QA_WEB_URL=… PUPPETEER_CORE=… CHROME=… [QA_SHOTS=…] node qa/qa-portail-bordereaux-montants-59.mjs
 */
import { execFileSync } from 'node:child_process';

const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const W = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
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
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const r3 = (x) => Math.round(Number(x) * 1000) / 1000;
/** « 1 423,100 DT » → 1423.1 */
const lireTND = (s) => Number(String(s ?? '').replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(',', '.'));

const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const shipperId = (await api(exp, 'GET', '/auth/me')).data.shipperId;
const adminId = (await api(admin, 'GET', '/auth/me')).data.id;
const hub = (await api(admin, 'GET', '/inter-depots/form-options')).data.deposits.find((d) => d.isMainHub);
const rs = (await api(hamza, 'GET', '/runsheets/driver/active')).data;

/** Totaux tels que l'exploitation les voit (liste admin, filtrée sur l'expéditeur). */
const totauxAdmin = async () => {
  const l = ((await api(admin, 'GET', '/payments/vouchers?limit=200')).data ?? []).filter((v) => v.shipperId === shipperId);
  const s = (f) => r3(l.filter(f).reduce((a, v) => a + Number(v.netPayable ?? 0), 0));
  return { aPercevoir: s((v) => v.status !== 'PAYE' && v.status !== 'ANNULE'), regle: s((v) => v.status === 'PAYE') };
};
const totauxExp = async () => {
  const l = (await api(exp, 'GET', '/payments/vouchers?limit=200')).data ?? [];
  const s = (f) => r3(l.filter(f).reduce((a, v) => a + Number(v.netPayable ?? 0), 0));
  return { aPercevoir: s((v) => v.status !== 'PAYE' && v.status !== 'ANNULE'), regle: s((v) => v.status === 'PAYE'), liste: l };
};
const candidatAdmin = async () => ((await api(admin, 'GET', `/payments/vouchers/candidats?shipperId=${shipperId}`)).data ?? []).find((c) => c.shipperId === shipperId);

console.log('\n1. Deux colis livrés et encaissés (caisse validée)');
const sfx = Date.now().toString().slice(-4);
for (const i of [1, 2]) {
  const c = (await api(exp, 'POST', '/colis', { customerName: `Q59 ${sfx}-${i}`, customerPhone: `9859${sfx}${i}`.slice(0, 8), governorate: 'Tunis', delegation: 'La Marsa', address: `Rue ${i}`, goodsPrice: 40 + i * 10 })).data;
  await api(admin, 'POST', '/depot/reception', { code: c.barcode, depositId: hub.id });
  await api(admin, 'POST', `/runsheets/${rs.id}/add-package`, { packageIdentifier: c.trackingNumber });
  await api(hamza, 'POST', `/colis/${c.id}/start`, {});
  const d = await api(hamza, 'POST', `/colis/${c.id}/deliver`, { collectedAmount: Number(c.totalPrice) });
  ok(d.status < 300, `colis ${i} livré`, `${d.status} ${d.message}`);
  sql(`UPDATE "Payment" SET status='VALIDE', "validatedAt"=now(), "validatedByUserId"='${adminId}' WHERE "packageId"='${c.id}'`);
}

console.log('\n2. « À régler » : mêmes chiffres des deux côtés');
const cand = await candidatAdmin();
const ar = (await api(exp, 'GET', '/payments/vouchers/a-regler')).data;
ok(!!cand && cand.livres >= 2, 'exploitation : expéditeur « À régler »', JSON.stringify(cand));
ok(ar && r3(ar.netEstime) === r3(cand?.netEstime) && ar.livres === cand?.livres && ar.retournes === cand?.retournes, 'portail : prochain bordereau = « À régler » de l’exploitation', `${JSON.stringify(ar)} vs ${cand?.netEstime}`);
ok((await api(admin, 'GET', '/payments/vouchers/a-regler')).status === 403, 'a-regler réservé à l’espace expéditeur');

console.log('\n3. Portail ouvert pendant que l’exploitation travaille');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const errs = [];
const p = await b.newPage();
await p.setViewport({ width: 1366, height: 900 });
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'expediteur@bluestar.tn'); await p.type('input[type=password]', 'Exp123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
await p.goto(`${W}/expediteur/bordereaux`, { waitUntil: 'networkidle2' });
await p.waitForSelector('[data-testid=recap-a-percevoir]', { timeout: 10000 });
await sleep(800);
const tuiles = () => p.evaluate(() => Object.fromEntries(['recap-a-percevoir', 'recap-regle', 'recap-prochain'].map((id) => [id, document.querySelector(`[data-testid=${id}] p.font-mono`)?.textContent ?? ''])));
const ecran = async () => { const t = await tuiles(); return { aPercevoir: r3(lireTND(t['recap-a-percevoir'])), regle: r3(lireTND(t['recap-regle'])), prochain: r3(lireTND(t['recap-prochain'])) }; };
/** Retour sur l'onglet : déclenche la relecture discrète, puis attend la valeur attendue. */
const attendre = async (cond, ms = 40000) => {
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  const fin = Date.now() + ms;
  while (Date.now() < fin) { const e = await ecran(); if (cond(e)) return e; await sleep(1000); }
  return ecran();
};
let A = await totauxAdmin();
let E = await ecran();
ok(E.aPercevoir === A.aPercevoir && E.regle === A.regle, 'à l’ouverture : « À percevoir » et « Déjà réglé » = exploitation', `${JSON.stringify(E)} vs ${JSON.stringify(A)}`);
ok(E.prochain === r3(cand.netEstime), '« Prochain bordereau (estimé) » affiché', `${E.prochain} vs ${cand.netEstime}`);
if (SHOTS) await p.screenshot({ path: `${SHOTS}/59-avant.png` });

// L'exploitation crée le bordereau.
const v = await api(admin, 'POST', '/payments/vouchers', { shipperId });
ok(v.status < 300, 'exploitation : bordereau créé', `${v.status} ${v.message}`);
const net = r3(v.data?.netPayable);
ok(net === r3(cand.netEstime), 'net du bordereau = net estimé « À régler »', `${net} vs ${cand.netEstime}`);
const expV = (await totauxExp()).liste.find((x) => x.voucherNumber === v.data?.voucherNumber);
ok(expV && r3(expV.netPayable) === net, 'portail (API) : même net que l’exploitation', `${expV?.netPayable} vs ${net}`);
A = await totauxAdmin();
E = await attendre((e) => e.aPercevoir === A.aPercevoir);
ok(E.aPercevoir === A.aPercevoir, 'portail sans recharger : « À percevoir » inclut le nouveau bordereau', `${E.aPercevoir} vs ${A.aPercevoir}`);
ok(E.prochain === 0, '« Prochain bordereau » retombe à 0 (tout est dans le bordereau)', String(E.prochain));
const txt = await p.evaluate(() => document.body.innerText);
ok(new RegExp(`${v.data.voucherNumber}[\\s\\S]{0,200}À payer`).test(txt), 'statut « À payer », comme chez l’exploitation');
if (SHOTS) await p.screenshot({ path: `${SHOTS}/59-cree.png` });

// L'exploitation le paie avec le code de retrait de l'expéditeur.
const aPercevoirAvant = E.aPercevoir;
const reglePayeAvant = E.regle;
const pay = await api(admin, 'POST', `/payments/vouchers/${v.data.voucherNumber}/validate`, { secretCode: expV.withdrawalCode, paymentMethod: 'ESPECE' });
ok(pay.status < 300, 'exploitation : bordereau payé', `${pay.status} ${pay.message}`);
A = await totauxAdmin();
E = await attendre((e) => e.regle === A.regle && e.aPercevoir === A.aPercevoir);
ok(E.aPercevoir === r3(aPercevoirAvant - net) && E.aPercevoir === A.aPercevoir, '« À percevoir » diminue du net payé', `${E.aPercevoir} (avant ${aPercevoirAvant}, net ${net})`);
ok(E.regle === r3(reglePayeAvant + net) && E.regle === A.regle, '« Déjà réglé » augmente du net payé', `${E.regle} (avant ${reglePayeAvant})`);
ok(/Réglé le/.test(await p.evaluate(() => document.body.innerText)), 'ligne « Réglé le … » sur le bordereau payé');
if (SHOTS) await p.screenshot({ path: `${SHOTS}/59-paye.png` });

console.log('\n4. Un bordereau annulé ne compte pas');
const enCours = (await totauxExp()).liste.find((x) => x.status !== 'PAYE' && x.status !== 'ANNULE');
if (enCours) {
  const an = await api(admin, 'POST', `/payments/vouchers/${enCours.id}/annuler`, { motif: 'QA 59' });
  ok(an.status < 300, 'exploitation : bordereau annulé', `${an.status} ${an.message}`);
  A = await totauxAdmin();
  E = await attendre((e) => e.aPercevoir === A.aPercevoir);
  ok(E.aPercevoir === A.aPercevoir && E.aPercevoir === r3(aPercevoirAvant - net - Number(enCours.netPayable)), '« À percevoir » sans le bordereau annulé', `${E.aPercevoir} vs ${A.aPercevoir}`);
} else console.log('  (aucun autre bordereau à payer : étape sautée)');

console.log('\n5. Tableau de bord');
await p.goto(`${W}/expediteur/tableau-de-bord`, { waitUntil: 'networkidle2' }).catch(() => {});
await sleep(1500);
const tdb = await p.evaluate(() => document.body.innerText);
ok(/Prochain paiement/.test(tdb) && /RUNEX vous doit/.test(tdb), 'tableau de bord : « RUNEX vous doit » et « Prochain paiement »');
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));
await b.close();

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
