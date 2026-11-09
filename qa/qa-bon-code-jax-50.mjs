#!/usr/bin/env node
/**
 * QA 50 — bon de livraison d'un colis confié à JAX : deux codes, celui de
 * Runex et celui de JAX (retour du client, 09/11 : le livreur JAX ne pouvait
 * pas scanner le colis, seul le numéro Runex figurait sur l'étiquette).
 *
 * Prérequis : faux serveur JAX (qa/mock-jax-server.mjs) et l'API lancée avec
 * JAX_API_URL=http://localhost:4010/api JAX_API_TOKEN=test-jax JAX_SYNC_MINUTES=0.
 *
 *   QA_API_URL=… QA_WEB_URL=… PUPPETEER_CORE=… CHROME=… [QA_SHOTS=…] node qa/qa-bon-code-jax-50.mjs
 */
const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const W = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const JAX = (process.env.QA_JAX_URL ?? 'http://localhost:4010').replace(/\/+$/, '');
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
const jax = async (p, body) => (await fetch(`${JAX}${p}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json();
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;

const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const sfx = Date.now().toString().slice(-4);
const creer = async (nom, extra = {}) =>
  (await api(exp, 'POST', '/colis', { customerName: `${nom} ${sfx}`, customerPhone: `9850${sfx}`, governorate: 'Tunis', delegation: 'La Marsa', address: 'Rue 50', goodsPrice: 30, ...extra })).data;

console.log('\n1. API');
const c = await creer('Q50 JAX', { pieceCount: 2 });
let bon = (await api(exp, 'GET', `/colis/${c.id}/bon-livraison`)).data;
const ean = (await jax('/__control/etat')).colis.find((x) => x.recu?.referenceExterne === c.trackingNumber)?.ean;
ok(!!ean, 'colis créé chez JAX dès la création', String(ean));
ok(bon?.partnerCode?.partner === 'JAX' && bon.partnerCode.code === ean, 'bon imprimé juste après la création : code JAX présent', JSON.stringify(bon?.partnerCode));
ok(bon?.barcode === c.barcode && bon?.number === c.trackingNumber, 'le code Runex reste sur le bon');
// Panne JAX : pas de code JAX, le bon reste imprimable.
await jax('/__control/panne', { actif: true });
const t0 = Date.now();
const sans = await creer('Q50 panne');
ok(sans?.id && Date.now() - t0 < 8000, 'JAX en panne : création toujours possible, sans attente excessive', `${Date.now() - t0} ms`);
await jax('/__control/panne', { actif: false });
bon = (await api(exp, 'GET', `/colis/${sans.id}/bon-livraison`)).data;
ok(bon && !bon.partnerCode, 'pas de code JAX tant que l’envoi a échoué : seul le code Runex');
// Repris : plus de code JAX.
const repris = await creer('Q50 repris');
await api(admin, 'POST', `/sous-traitance/jax/colis/${repris.id}/reprendre`);
bon = (await api(admin, 'GET', `/colis/${repris.id}/bon-livraison`)).data;
ok(bon && !bon.partnerCode, 'colis repris : le code JAX n’est plus imprimé');

console.log('\n2. Impression');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const ctx = await b.createBrowserContext();
const p = await ctx.newPage(); await p.setViewport({ width: 1366, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'expediteur@bluestar.tn'); await p.type('input[type=password]', 'Exp123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
await p.goto(`${W}/expediteur/colis/${c.id}`, { waitUntil: 'networkidle2' }); await sleep(1000);
const cible = new Promise((r) => ctx.once('targetcreated', r));
await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^Bon de livraison$/.test(x.innerText.trim()))?.click());
const tg = await Promise.race([cible, sleep(8000).then(() => null)]);
const pop = tg ? await tg.page() : null;
ok(!!pop, 'fenêtre du bon ouverte');
if (pop) {
  await pop.waitForSelector('section.page', { timeout: 8000 }).catch(() => {});
  await pop.setViewport({ width: 900, height: 1200 });
  await sleep(600);
  const info = await pop.evaluate(() => [...document.querySelectorAll('section.page')].map((s) => {
    const bloc = s.querySelector('[data-champ=code-partenaire]');
    const r = bloc?.getBoundingClientRect();
    const page = s.querySelector('.bon')?.getBoundingClientRect();
    return {
      runex: s.dataset.code,
      jax: bloc?.dataset.code,
      texte: bloc?.innerText.replace(/\s+/g, ' ').trim(),
      barres: bloc?.querySelectorAll('svg rect').length ?? 0,
      dedans: !!r && !!page && r.right <= page.right + 0.5 && r.left >= page.left,
    };
  }));
  ok(info.length === 2, 'une page par pièce (2)');
  ok(info.every((x) => x.jax === ean && /CODE JAX/.test(x.texte ?? '') && x.texte.includes(ean)), 'chaque page : bloc « CODE JAX » avec le code JAX', JSON.stringify(info[0]));
  ok(info.every((x) => x.barres > 20), 'code JAX en code-barres (scannable)');
  ok(info.every((x) => x.runex && x.runex !== ean), 'code Runex de la pièce toujours imprimé, distinct du code JAX');
  ok(info.every((x) => x.dedans), 'bloc JAX dans le cadre du bon (pas coupé)');
  if (SHOTS) {
    await pop.screenshot({ path: `${SHOTS}/50-bon-code-jax.png` });
    await pop.emulateMediaType('print');
    (await import('node:fs')).writeFileSync(`${SHOTS}/50-bon-code-jax.pdf`, await pop.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true }));
  }
}
await b.close();
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
