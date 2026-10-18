/**
 * QA 37 — tableau de bord de l'administration (`/dashboard`).
 *
 *   API  : `GET /dashboard?days=` → champ `vue` (périodes, cohérence des
 *          totaux, classements triés, cloisonnement agent de dépôt / livreur /
 *          expéditeur).
 *   Écran: bandeau, période, bascule Colis / Encaissé, infobulle, liens vers
 *          la gestion des colis filtrée, pas de débordement sur téléphone.
 *
 *   PUPPETEER_CORE=…/puppeteer-core.js CHROME=…/chrome node qa/qa-tableau-admin-37.mjs
 * Web sur :3000 (build de production), API sur :4000, base de démonstration
 * (de préférence après qa-retours-client-33 pour avoir de l'activité).
 */
const API = process.env.QA_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const W = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? '/tmp';
const ja = async (t, p) => {
  const r = await fetch(API + p, { headers: t ? { Authorization: 'Bearer ' + t } : {} });
  let x = null; try { x = await r.json(); } catch { /* vide */ }
  return { s: r.status, d: x?.data };
};
const login = async (identifier, password) => {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  return (await r.json()).data?.accessToken;
};
let pass = 0, fail = 0;
const ok = (c, l, d = '') => { if (c) { pass++; console.log('  ✔', l); } else { fail++; console.log('  ✘', l, d); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('1. API');
const admin = await login('admin@logixpress.tn', 'Admin123!');
const r14 = await ja(admin, '/dashboard');
const v = r14.d?.vue;
ok(r14.s === 200 && v && v.periodDays === 14 && v.daily.length === 14, 'période par défaut : 14 jours', JSON.stringify(v?.periodDays));
ok(r14.d.colis && r14.d.livreurs && r14.d.alerts, 'champs historiques conservés');
for (const d of [7, 30, 90]) {
  const r = await ja(admin, `/dashboard?days=${d}`);
  ok(r.d?.vue?.periodDays === d && r.d.vue.daily.length === d, `période ${d} jours`);
}
const rx = await ja(admin, '/dashboard?days=5');
ok(rx.d?.vue?.periodDays === 14, 'période inconnue → 14 jours');
const somme = Object.values(v.pipeline).reduce((a, b) => a + b, 0);
ok(somme === v.active, 'parcours = colis en cours', `${somme} vs ${v.active}`);
ok(v.daily.reduce((s, j) => s + j.created, 0) === v.period.created, 'courbe : somme des créés = période');
ok(v.daily.reduce((s, j) => s + j.delivered, 0) === v.period.delivered, 'courbe : somme des livrés = période');
ok(v.topDrivers.every((d, i, t) => i === 0 || t[i - 1].delivered >= d.delivered), 'livreurs triés par livraisons');
ok(v.topShippers.every((s, i, t) => i === 0 || t[i - 1].created >= s.created), 'expéditeurs triés par colis');
ok(v.topShippers.every((s) => s.delivered + s.returned <= s.created), 'expéditeurs : livrés + retours ≤ colis');
ok(v.agencies.length > 1 && v.agencies[0].isMainHub, 'agences : hub en tête');
ok(v.agencies.every((a) => a.toAssign <= a.inStock), 'agences : sans livreur ≤ en stock');
ok(Math.abs(v.money.codInProgress - r14.d.paiements.montantAEncaisserTND) < 1e6 && v.money.codInProgress >= 0, 'argent : à encaisser cohérent');

const agent = await login('agent.magasin@logixpress.tn', 'Agent123!');
const ra = await ja(agent, '/dashboard');
ok(ra.s === 200 && ra.d?.vue?.agencies.length === 1 && ra.d.vue.agencies[0].isMainHub, 'agent de dépôt : son dépôt seulement');
const liv = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const rl = await ja(liv, '/dashboard');
ok(rl.s === 200 && rl.d && rl.d.vue === undefined, 'livreur : tableau personnel, sans vue globale');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
ok((await ja(exp, '/dashboard')).s === 403, 'expéditeur : 403');
ok((await ja(null, '/dashboard')).s === 401, 'anonyme : 401');

console.log('2. Écran');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const txt = () => p.evaluate(() => document.body.innerText);
const attendre = async (re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await txt())) return true; await sleep(150); } return false; };
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
await p.goto(W + '/dashboard', { waitUntil: 'networkidle2' });
ok(await attendre(/Bonjour|Bon après-midi|Bonsoir/), 'salutation affichée');
ok(await attendre(/À traiter maintenant/), 'section « À traiter maintenant »');
ok(await attendre(/Activité des 14 derniers jours/), 'courbe sur 14 jours');
ok(await attendre(new RegExp(`${v.active}\\s*\\n?\\s*Colis en cours|Colis en cours[\\s\\S]{0,40}${v.active}`)), 'colis en cours = API');
await p.click('[data-testid=tdb-periode-30]');
ok(await attendre(/Activité des 30 derniers jours/), 'période 30 jours appliquée');
ok(await attendre(/Livrés · 30 jours/), 'indicateurs recalculés sur 30 jours');
await p.click('[data-testid=tdb-mesure-argent]');
ok(await attendre(/Encaissé à la livraison \(DT\)/), 'bascule Encaissé');
await p.click('[data-testid=tdb-mesure-volumes]');
const svg = await p.$('svg[role=img]');
const bb = await svg.boundingBox();
await p.mouse.move(bb.x + bb.width - 20, bb.y + bb.height / 2);
ok(!!(await p.waitForSelector('[data-testid=tdb-infobulle]', { timeout: 3000 }).catch(() => null)), 'infobulle au survol');
ok((await p.$$('[data-testid=tdb-top-livreurs] li')).length === Math.min(6, v.topDrivers.length), 'classement des livreurs affiché');
ok((await p.$$('[data-testid=tdb-top-expediteurs] li')).length === v.topShippers.length, 'classement des expéditeurs affiché');
await p.screenshot({ path: `${SHOTS}/37-tableau-admin.png` });
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => null), p.click('[data-testid=tdb-etape-depot]')]);
await sleep(1500);
ok(/\/colis\?statut=RECU_DEPOT/.test(p.url()), 'étape « Au dépôt » → gestion des colis', p.url());
ok(await attendre(/statut reçu au dépôt|Reçu au dépôt/i), 'filtre de statut appliqué');
await p.goto(W + '/dashboard', { waitUntil: 'networkidle2' });
await p.waitForSelector('[data-testid=tdb-action-COLIS_NON_AFFECTES]');
ok(!!(await p.$('[data-testid=tdb-action-RUNSHEETS_A_VALIDER]')), 'cartes d’action affichées');
await p.setViewport({ width: 390, height: 844 }); await sleep(800);
ok((await p.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'téléphone : pas de défilement horizontal');
ok(!errs.length, 'aucune erreur JavaScript', errs.join(' | '));
console.log(`\n${pass} réussis, ${fail} échoués`);
await b.close();
process.exit(fail ? 1 : 0);
