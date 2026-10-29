#!/usr/bin/env node
/**
 * QA 44 — portail expéditeur, page Colis (demande du client, 29/10) :
 * la liste s'ouvre sur les colis du jour, l'impression « tous les colis »
 * (étiquettes à scanner) ne reprend que ceux-là, et l'historique reste
 * accessible (bouton Historique, date, recherche, liens du tableau de bord).
 *
 *   QA_API_URL=… QA_WEB_URL=… QA_DB_URL=… PUPPETEER_CORE=… CHROME=… node qa/qa-expediteur-colis-du-jour-44.mjs
 */
import { execFileSync } from 'node:child_process';

const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const W = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const DB = process.env.QA_DB_URL ?? 'postgresql://prod_owner:ownerpw@localhost:5432/runex_qa';
const SHOTS = process.env.QA_SHOTS ?? '/tmp';
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
  return { status: r.status, data: j?.data, meta: j?.meta, message: j?.message };
}
const sql = (q) => execFileSync('psql', [DB, '-qAtc', q], { encoding: 'utf8' }).trim();
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());

console.log('\n1. Données : colis du jour et colis anciens');
const sfx = Date.now().toString().slice(-5);
const nouveau = async (i) => (await api(exp, 'POST', '/colis', { customerName: `Jour ${sfx}-${i}`, customerPhone: `9644${String(1000 + i)}`, governorate: 'Ben Arous', delegation: 'Ben Arous', address: `Rue ${i}`, goodsPrice: 10 + i })).data;
const ancien = await nouveau(1);
const ancien2 = await nouveau(2);
// Tous les colis existants passent à des jours précédents : seuls ceux créés ensuite sont « du jour ».
sql(`UPDATE "Package" SET "createdAt" = "createdAt" - interval '3 days' WHERE "shipperId" = (SELECT "shipperId" FROM "Package" WHERE id = '${ancien.id}') AND "createdAt" >= now() - interval '1 day'`);
const duJour = [await nouveau(3), await nouveau(4), await nouveau(5)];
const apiJour = await api(exp, 'GET', `/colis?date=${jour}&limit=100`);
const totalJour = apiJour.meta?.total ?? apiJour.data?.length;
ok(totalJour === 3, 'API : 3 colis créés aujourd’hui', String(totalJour));
const apiTous = await api(exp, 'GET', '/colis?limit=1');
const totalTous = apiTous.meta?.total;
ok(totalTous > 3, 'API : historique plus large que la journée', String(totalTous));

console.log('\n2. Écran Colis');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1366, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
// L'impression ouvre une fenêtre : on capture son contenu.
await p.evaluateOnNewDocument(() => {
  window.__impressions = [];
  window.open = () => {
    const doc = { write: (h) => window.__impressions.push(h), close() {}, open() {} };
    return { document: doc, focus() {}, print() {}, close() {}, addEventListener() {}, onload: null };
  };
});
const txt = () => p.evaluate(() => document.body.innerText);
const attendre = async (re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await txt())) return true; await sleep(150); } return false; };
await p.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'expediteur@bluestar.tn'); await p.type('input[type=password]', 'Exp123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
await p.goto(W + '/expediteur/colis', { waitUntil: 'networkidle2' });
ok(await attendre(/3 colis créés aujourd’hui/), 'ouverture : « 3 colis créés aujourd’hui »');
let t = await txt();
ok(duJour.every((c) => t.includes(c.trackingNumber)), 'les colis du jour sont listés');
ok(!t.includes(ancien.trackingNumber) && !t.includes(ancien2.trackingNumber), 'les colis anciens ne sont pas listés');
ok(await p.$eval('[data-testid=colis-du-jour]', (n) => n.getAttribute('aria-pressed') === 'true'), 'bouton « Aujourd’hui » actif');
ok(await p.$eval('[data-testid=filtre-date]', (n, j) => n.value === j, jour), 'date affichée : aujourd’hui');
const libelle = await p.$eval('[data-testid=imprimer-colis]', (n) => n.innerText);
ok(/Imprimer les 3 colis du jour/.test(libelle), 'bouton d’impression : « Imprimer les 3 colis du jour »', libelle);
await p.screenshot({ path: `${SHOTS}/44-colis-du-jour.png` });
await p.click('[data-testid=imprimer-colis]');
await sleep(1500);
const html = (await p.evaluate(() => window.__impressions.join(''))) || '';
ok(duJour.every((c) => html.includes(c.trackingNumber)) && !html.includes(ancien.trackingNumber), 'impression : les colis du jour seulement', `${html.length} caractères`);

console.log('\n3. Historique');
await p.click('[data-testid=colis-historique]');
ok(await attendre(new RegExp(`${totalTous} colis — tout l’historique`)), 'Historique : tous les colis', String(totalTous));
ok(await attendre(new RegExp(ancien.trackingNumber)), 'Historique : un colis ancien est listé');
const libelleH = await p.$eval('[data-testid=imprimer-colis]', (n) => n.innerText);
ok(!/du jour/.test(libelleH), 'impression en historique : plus « du jour »', libelleH);
await p.click('[data-testid=colis-du-jour]');
ok(await attendre(/3 colis créés aujourd’hui/), 'retour à « Aujourd’hui »');
// Recherche : tout l'historique tant qu'aucune date n'est choisie.
await p.type('#recherche-colis', ancien2.trackingNumber);
const dansTableau = async (num, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate((n) => [...document.querySelectorAll('main table, main [data-testid], main')].some((x) => x.innerText.includes(n)), num)) return true; await sleep(150); } return false; };
ok(await dansTableau(ancien2.trackingNumber), 'recherche d’un colis ancien depuis la vue du jour : trouvé dans la liste');
ok(!!(await p.waitForSelector('[data-testid=recherche-historique]', { timeout: 5000 }).catch(() => null)), 'mention « recherche dans tout l’historique »');
await sleep(1200);
ok(await p.evaluate((n) => [...document.querySelectorAll('table tbody tr, [data-testid^=fiche]')].some((x) => x.innerText.includes(n)), ancien2.trackingNumber), 'résultat de la recherche : la ligne du colis ancien');
await p.click('#recherche-colis', { clickCount: 3 }); await p.keyboard.press('Backspace');
ok(await attendre(/3 colis créés aujourd’hui/), 'recherche effacée : retour aux colis du jour');
// Date choisie : jour précis.
const avant = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date(Date.now() - 3 * 86400000));
await p.$eval('[data-testid=filtre-date]', (n, v) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true }));
}, avant);
ok(await attendre(new RegExp(ancien.trackingNumber)), 'date choisie (il y a 3 jours) : colis de ce jour-là');
t = await txt();
ok(!duJour.some((c) => t.includes(c.trackingNumber)), 'date choisie : pas les colis d’aujourd’hui');

console.log('\n4. Liens du tableau de bord et journée vide');
await p.goto(W + '/expediteur/colis?statut=CREE', { waitUntil: 'networkidle2' });
ok(await attendre(new RegExp(ancien.trackingNumber)), 'lien filtré (statut) : ouvre sur tout l’historique');
ok(await p.$eval('[data-testid=colis-historique]', (n) => n.getAttribute('aria-pressed') === 'true'), 'lien filtré : « Historique » actif');
sql(`UPDATE "Package" SET "createdAt" = "createdAt" - interval '3 days' WHERE id IN (${duJour.map((c) => `'${c.id}'`).join(',')})`);
await p.goto(W + '/expediteur/colis', { waitUntil: 'networkidle2' });
ok(await attendre(/Aucun colis créé aujourd’hui/), 'journée sans colis : message dédié');
await p.click('[data-testid=voir-historique]');
ok(await attendre(new RegExp(ancien.trackingNumber)), '« Voir l’historique » : colis anciens');
await b.close();
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
