/**
 * QA 40 — impression d'une tournée (comme ADEX) : bon de livraison de la
 * tournée et fiches « Produit d'échange », bouton avec flèche quand la tournée
 * contient des colis d'échange.
 *
 *   PUPPETEER_CORE=…/puppeteer-core.js CHROME=…/chrome node qa/qa-impression-tournee-40.mjs
 * API sur :4000, web sur :3000 (build de production), base de démonstration.
 */
const API = process.env.QA_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const W = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? '/tmp';
let pass = 0, fail = 0;
const ok = (c, l, d = '') => { if (c) { pass++; console.log('  ✔', l); } else { fail++; console.log('  ✘', l, d); } return c; };
async function api(t, m, p, b) {
  const h = { Accept: 'application/json' };
  if (t) h.Authorization = `Bearer ${t}`;
  if (b !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = null; try { j = await r.json(); } catch { /* vide */ }
  return { s: r.status, d: j?.data, m: j?.message };
}
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).d?.accessToken;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const liv = await login('livreur.ghassan@logixpress.tn', 'Liv123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const me = (await api(liv, 'GET', '/auth/me')).d;
const lid = me.driverId ?? me.driver?.id;

console.log('1. Tournée avec colis normaux et d’échange');
const crees = [];
for (let i = 0; i < 4; i++) {
  const echange = i >= 2;
  const r = await api(exp, 'POST', '/colis', {
    customerName: `Imp ${i}`, customerPhone: `9855500${i}`, governorate: 'Zaghouan', delegation: 'Zaghouan Ville', address: `Rue ${i}`,
    goodsPrice: 40 + i * 5, pieceCount: i + 1, contentSummary: echange ? `Tenue noire T${i}` : `Article ${i}`,
    ...(echange ? { packageType: 'EXCHANGE', notes: `Reprendre la tenue taille ${i}` } : {}),
  });
  ok(r.s === 201, `colis ${echange ? 'd’échange' : 'normal'} ${i + 1} créé`, `${r.s} ${r.m}`);
  crees.push(r.d);
  await api(admin, 'POST', `/colis/${r.d.id}/assign`, { driverId: lid });
}
const N = (await api(liv, 'GET', '/runsheets/driver/active')).d?.runsheetNumber;

console.log('2. API d’impression');
const imp = await api(admin, 'GET', `/runsheets/${N}/impression`);
const d = imp.d;
ok(imp.s === 200 && d?.runsheetNumber === N && d.livreur && d.agence, 'en-tête : n°, agence, livreur', `${imp.s} ${imp.m}`);
ok(d?.totalColis >= 4 && d.totalPieces >= 10, 'nombre de colis et de pièces', `${d?.totalColis} / ${d?.totalPieces}`);
const somme = Math.round(d.colis.reduce((s, c) => s + c.montant, 0) * 1000) / 1000;
ok(Math.abs(somme - d.total) < 0.001, 'total = somme des montants', `${somme} / ${d.total}`);
const l1 = d.colis.find((c) => c.trackingNumber === crees[0].trackingNumber);
ok(l1 && l1.expediteur && l1.contenu === 'Article 0' && l1.tentative === 1 && /Zaghouan/.test(l1.adresse) && l1.client === 'Imp 0', 'ligne colis : expéditeur, contenu, tentative 1, client, adresse', JSON.stringify(l1));
ok(d.echanges.length === 2 && d.echanges.every((e) => e.codeProduit === `00${e.trackingNumber}`), '2 produits d’échange, code « 00 » + n° du colis');
const e1 = d.echanges.find((e) => e.trackingNumber === crees[2].trackingNumber);
ok(e1 && /Reprendre la tenue/.test(e1.description) && e1.expediteur.nom && e1.expediteur.telephone && e1.destinataire.nom === 'Imp 2', 'fiche d’échange : description, expéditeur, destinataire', JSON.stringify(e1));
ok((await api(exp, 'GET', `/runsheets/${N}/impression`)).s === 403, 'expéditeur : 403');
ok((await api(hamza, 'GET', `/runsheets/${N}/impression`)).s === 404, 'autre livreur : 404');
ok((await api(liv, 'GET', `/runsheets/${N}/impression`)).s === 200, 'son livreur : 200');

console.log('3. Écrans');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
await p.goto(W + '/runsheets', { waitUntil: 'networkidle2' });
const zone = await p.waitForSelector(`[data-testid="impression-${N}"]`, { timeout: 8000 }).catch(() => null);
ok(!!zone, 'liste : bouton d’impression de la tournée');
ok(!!(await zone?.$('[data-testid=imprimer-menu]')), 'tournée avec échanges : flèche affichée');
const autres = await p.$$('[data-testid^="impression-RUN"]');
let sansFleche = false;
for (const z of autres) if (!(await z.$('[data-testid=imprimer-menu]'))) sansFleche = true;
ok(sansFleche || autres.length === 1, 'tournée sans échange : pas de flèche');
const ouvrir = async (clic) => {
  const popup = new Promise((r) => b.once('targetcreated', async (t) => r(await t.page())));
  await clic();
  const fen = await Promise.race([popup, sleep(6000).then(() => null)]);
  if (fen) { await sleep(900); await fen.setViewport({ width: 1000, height: 1300 }).catch(() => null); }
  return fen;
};
let fen = await ouvrir(() => zone.$eval('[data-testid=imprimer-runsheet]', (n) => n.click()));
let texte = fen ? await fen.evaluate(() => document.body.innerText) : '';
ok(new RegExp(`BON DE LIVRAISON N°${N}`).test(texte) && /Nombre total des colis/.test(texte) && /TOTAL/.test(texte) && /Cachet et signature/.test(texte), 'impression Runsheet : bon de livraison de la tournée');
ok(texte.includes(crees[0].trackingNumber) && /Tent\./i.test(texte), 'bon : colis et colonne « Tent. »');
if (fen) await fen.screenshot({ path: `${SHOTS}/40-bon-tournee.png`, fullPage: true }).catch(() => null);
await (await zone.$('[data-testid=imprimer-menu]'))?.click();
await p.waitForSelector('[data-testid=imprimer-echanges]', { timeout: 3000 });
ok(await p.$eval('[role=menu]', (n) => /Runsheet/.test(n.innerText) && /Produits échanges/.test(n.innerText)), 'menu : « Runsheet » et « Produits échanges »');
await p.screenshot({ path: `${SHOTS}/40-menu.png` });
fen = await ouvrir(() => p.click('[data-testid=imprimer-echanges]'));
texte = fen ? await fen.evaluate(() => document.body.innerText) : '';
ok((texte.match(/Produit d'échange/g) ?? []).length === 2 && texte.includes(`00${crees[2].trackingNumber}`) && /Destinataire/.test(texte), 'impression Produits échanges : une fiche par échange');
if (fen) await fen.screenshot({ path: `${SHOTS}/40-produit-echange.png` }).catch(() => null);
ok(!errs.length, 'aucune erreur JavaScript', errs.join(' | '));
await b.close();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
