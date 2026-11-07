#!/usr/bin/env node
/**
 * QA 48 — portail expéditeur, liste « Aujourd'hui » : un colis encore
 * « En préparation » (CREE, aucune action dessus) reste dans la liste les
 * jours suivants, au lieu d'en sortir à minuit. Dès qu'il est pris en charge
 * (dépôt, ramassage…), il ne reste plus que dans l'historique.
 *
 *   QA_API_URL=… QA_WEB_URL=… QA_DB_URL=… PUPPETEER_CORE=… CHROME=… [QA_SHOTS=…] node qa/qa-portail-colis-en-attente-48.mjs
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
  return { status: r.status, data: j?.data, meta: j?.meta, message: j?.message };
}
const sql = (q) => execFileSync('psql', [DB, '-qAtc', q], { encoding: 'utf8' }).trim();
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const jourTunis = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const sfx = Date.now().toString().slice(-5);
const creer = async (nom) =>
  (await api(exp, 'POST', '/colis', { customerName: `${nom} ${sfx}`, customerPhone: '98480001', governorate: 'Tunis', delegation: 'La Marsa', address: 'Rue 48', goodsPrice: 20 })).data;

console.log('\n1. Données');
const duJour = await creer('Q48 du jour');
const enAttente = await creer('Q48 en attente');
const traite = await creer('Q48 traité');
const ancienAttente = await creer('Q48 ancien en attente');
// Créés les jours précédents (aucune action) — et un qui a été reçu au dépôt.
sql(`UPDATE "Package" SET "createdAt" = now() - interval '2 days' WHERE id IN ('${enAttente.id}', '${traite.id}')`);
sql(`UPDATE "Package" SET "createdAt" = now() - interval '9 days' WHERE id = '${ancienAttente.id}'`);
const hub = (await api(admin, 'GET', '/inter-depots/form-options')).data.deposits.find((d) => d.isMainHub);
const rec = await api(admin, 'POST', '/depot/reception', { code: traite.barcode, depositId: hub.id });
ok(rec.status < 300, 'colis « traité » reçu au dépôt', `${rec.status} ${rec.message}`);
ok(sql(`SELECT status FROM "Package" WHERE id = '${traite.id}'`) !== 'CREE', 'il n’est plus « En préparation »');

console.log('\n2. API — liste du jour');
const aujourdhui = jourTunis();
const lister = async (q) => ((await api(exp, 'GET', `/colis?limit=200&${q}`)).data ?? []).map((c) => c.id);
let ids = await lister(`date=${aujourdhui}&avecCreesEnAttente=1`);
ok(ids.includes(duJour.id), 'colis créé aujourd’hui : présent');
ok(ids.includes(enAttente.id), 'colis d’avant-hier encore « En préparation » : reste dans la liste');
ok(ids.includes(ancienAttente.id), 'colis d’il y a 9 jours encore « En préparation » : reste aussi');
ok(!ids.includes(traite.id), 'colis d’avant-hier pris en charge (dépôt) : sort de la liste du jour');
const meta = (await api(exp, 'GET', `/colis?limit=1&date=${aujourdhui}&avecCreesEnAttente=1`)).meta;
ok(meta?.total === ids.length, 'total annoncé = lignes listées', `${meta?.total} / ${ids.length}`);
ids = await lister(`date=${aujourdhui}`);
ok(ids.includes(duJour.id) && !ids.includes(enAttente.id), 'sans l’option : uniquement les colis créés le jour (autres écrans inchangés)');
ids = await lister(`date=${aujourdhui}&avecCreesEnAttente=1&search=${encodeURIComponent(enAttente.trackingNumber)}`);
ok(ids.length === 1 && ids[0] === enAttente.id, 'recherche + filtre du jour : le colis en attente est trouvé');
ids = await lister(`date=${aujourdhui}&avecCreesEnAttente=1&status=CREE`);
ok(ids.includes(enAttente.id) && !ids.includes(traite.id), 'filtre de statut « En préparation » combiné');
ids = await lister('');
ok([duJour, enAttente, traite, ancienAttente].every((c) => ids.includes(c.id)), 'historique : tous les colis');
const autre = await login('admin@logixpress.tn', 'Admin123!');
const vusAdmin = ((await api(autre, 'GET', `/colis?limit=200&date=${aujourdhui}&avecCreesEnAttente=1`)).data ?? []).map((c) => c.shipperId);
ok(vusAdmin.length > 0, 'option sans effet sur le cloisonnement (l’API reste filtrée par rôle)');
const vusExp = ((await api(exp, 'GET', `/colis?limit=200&date=${aujourdhui}&avecCreesEnAttente=1`)).data ?? []);
ok(vusExp.every((c) => c.shipperId === duJour.shipperId), 'expéditeur : seulement ses propres colis');

console.log('\n3. Portail — page Colis');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1366, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'expediteur@bluestar.tn'); await p.type('input[type=password]', 'Exp123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
await p.goto(W + '/expediteur/colis', { waitUntil: 'networkidle2' }); await sleep(1500);
let t = await p.evaluate(() => document.body.innerText);
ok(/colis du jour/i.test(t) && /En préparation/.test(t), 'en-tête : « colis du jour — créés aujourd’hui ou encore « En préparation » »', t.slice(0, 200));
ok(t.includes(enAttente.trackingNumber), 'liste du jour : le colis en attente d’avant-hier est affiché');
ok(t.includes(ancienAttente.trackingNumber), 'liste du jour : le colis en attente d’il y a 9 jours est affiché');
ok(t.includes(duJour.trackingNumber), 'liste du jour : le colis d’aujourd’hui est affiché');
ok(!t.includes(traite.trackingNumber), 'liste du jour : le colis pris en charge n’y est plus');
if (SHOTS) await p.screenshot({ path: `${SHOTS}/48-liste-du-jour.png` });
// « Imprimer les colis du jour » couvre aussi les colis en attente.
const libelle = await p.evaluate(() => [...document.querySelectorAll('button')].map((x) => x.innerText).find((x) => /Imprimer les \d+ colis du jour/.test(x)) ?? '');
const n = Number(libelle.match(/(\d+)/)?.[1] ?? -1);
const attendu = (await api(exp, 'GET', `/colis?limit=1&date=${aujourdhui}&avecCreesEnAttente=1`)).meta?.total;
ok(n === attendu, `impression du jour : ${n} colis (en attente compris)`, libelle);
await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.getAttribute('data-testid') === 'colis-historique')?.click());
await sleep(1500);
t = await p.evaluate(() => document.body.innerText);
ok(/tout l’historique/.test(t), 'bouton « Historique » : tout l’historique');
await b.close();
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
