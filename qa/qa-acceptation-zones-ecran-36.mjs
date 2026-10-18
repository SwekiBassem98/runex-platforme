/**
 * QA 36 (écrans) — acceptation par zone : Acceptation Magasin (Tunis / Ben
 * Arous), acceptation inter dépôt livraison (hors zone, sans bordereau),
 * acceptation inter dépôt retours (toutes zones), création d'un inter dépôt
 * retours (agences hors zone seulement).
 *
 *   PUPPETEER_CORE=…/puppeteer-core.js CHROME=…/chrome SHOTS=/tmp/shots node qa/qa-acceptation-zones-ecran-36.mjs
 * Web sur :3000 (build de production), API sur :4000, base de démonstration.
 */
const API = process.env.QA_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const W = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? '/tmp';
const ja = async (t, m, p, b) => {
  const r = await fetch(API + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let x = null; try { x = await r.json(); } catch { /* vide */ }
  return { s: r.status, d: x?.data, m: x?.message };
};
let pass = 0, fail = 0;
const ok = (c, l, d = '') => { if (c) { pass++; console.log('  ✔', l); } else { fail++; console.log('  ✘', l, d); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = (await ja(null, 'POST', '/auth/login', { identifier: 'admin@logixpress.tn', password: 'Admin123!' })).d.accessToken;
const shippers = (await ja(admin, 'GET', '/shippers?limit=50')).d ?? [];
const sousse = shippers.find((s) => s.governorate === 'Sousse');
const ba = shippers.find((s) => s.governorate === 'Ben Arous');
const mk = async (shipperId, i) => (await ja(admin, 'POST', '/colis', { shipperId, customerName: `Écran ${i}`, customerPhone: `9633${1000 + i}`, governorate: 'Sfax', delegation: 'Sfax Ville', address: 'Rue', goodsPrice: 10, pieceCount: 1 })).d;
const cSO = await mk(sousse.id, 1);
const cBA = await mk(ba.id, 2);

const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const txt = () => p.evaluate(() => document.body.innerText);
const attendre = async (re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await txt())) return true; await sleep(150); } return false; };
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);

console.log('1. Acceptation Magasin');
await p.goto(W + '/magasin', { waitUntil: 'networkidle2' }); await sleep(1000);
ok(/expéditeurs de Tunis et Ben Arous/.test(await txt()), 'règle affichée sous le titre');
await p.type('input[aria-label="Code-barres ou numéro de colis à recevoir"]', cSO.barcode); await p.keyboard.press('Enter');
ok(await attendre(/Expéditeur hors Tunis \/ Ben Arous/), 'colis de Sousse : refus explicite');
ok(!!(await p.$('[data-testid=vers-acceptation-interdepot]')), 'lien vers l’acceptation inter dépôt');
await p.screenshot({ path: `${SHOTS}/36-magasin.png` });

console.log('2. Acceptation inter dépôt (livraison)');
await p.click('[data-testid=vers-acceptation-interdepot]'); await sleep(1500);
ok(/inter-depots\/acceptation/.test(p.url()) && (await attendre(/hors Tunis et Ben Arous/)), 'page ouverte, règle affichée');
await p.type('input[placeholder="code à barre"]', cSO.barcode); await p.keyboard.press('Enter');
ok(await attendre(new RegExp(`Colis ${cSO.trackingNumber} reçu`)), 'colis de Sousse accepté sans bordereau');
ok(await attendre(/sans bordereau/), 'ligne « sans bordereau » dans les acceptations');
await p.type('input[placeholder="code à barre"]', cBA.barcode); await p.keyboard.press('Enter');
ok(await attendre(/acceptez-le dans « Acceptation Magasin »/), 'colis de Ben Arous renvoyé vers l’Acceptation Magasin');
await p.screenshot({ path: `${SHOTS}/36-acceptation-livraison.png` });

console.log('3. Acceptation inter dépôt retours');
await p.goto(W + '/inter-depots/acceptation?type=RETOUR', { waitUntil: 'networkidle2' }); await sleep(1200);
ok(/Retours de toutes les agences/.test(await txt()), 'règle « toutes les agences » affichée');
await p.screenshot({ path: `${SHOTS}/36-acceptation-retours.png` });

console.log('4. Ajouter un inter dépôt retours');
await p.goto(W + '/inter-depots/nouveau?type=RETOUR', { waitUntil: 'networkidle2' }); await sleep(1500);
const agences = await p.evaluate(() => {
  const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.text === 'Choisissez agence'));
  return s ? [...s.options].map((o) => o.text) : [];
});
ok(agences.includes('Agence Sousse') && agences.includes('Agence Sfax'), 'agences hors zone proposées', agences.join(', '));
ok(!agences.includes('Agence Tunis') && !agences.some((a) => /Hub Central/.test(a)), 'Agence Tunis et hub non proposés');
ok(!!(await p.$('[data-testid=aide-agence-retour]')), 'aide affichée');
await p.screenshot({ path: `${SHOTS}/36-retour-nouveau.png` });
ok(!errs.length, 'aucune erreur JavaScript', errs.join(' | '));
console.log(`\n${pass} réussis, ${fail} échoués`);
await b.close();
process.exit(fail ? 1 : 0);
