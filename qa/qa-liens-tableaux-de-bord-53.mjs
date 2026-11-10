#!/usr/bin/env node
/**
 * QA 53 — tableaux de bord : chaque tuile mène à une liste qui montre
 * EXACTEMENT les colis qu'elle compte (retour du client, 10/11 : « En
 * préparation » affichait 2 colis, la page Colis n'en montrait aucun).
 *
 * Pour chaque tuile (exploitation et expéditeur) : on clique, puis on compare
 * le nombre de colis affiché par la liste au nombre de la tuile.
 *
 *   QA_API_URL=… QA_WEB_URL=… PUPPETEER_CORE=… CHROME=… [QA_SHOTS=…] node qa/qa-liens-tableaux-de-bord-53.mjs
 */
import { execFileSync } from 'node:child_process';

const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const W = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
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
const DB = process.env.QA_DB_URL ?? 'postgresql://prod_owner:ownerpw@localhost:5432/runex_qa';
const sql = (q) => execFileSync('psql', [DB, '-qAtc', q], { encoding: 'utf8' }).trim();
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');

// Jeu d'essai : colis en préparation (dont un « ramassage prévu »), au dépôt, livrés aujourd'hui.
const sfx = Date.now().toString().slice(-4);
let n = 0;
const creer = async () => {
  n++;
  const c = (await api(exp, 'POST', '/colis', { customerName: `Q53 ${sfx}-${n}`, customerPhone: `9853${sfx}`.slice(0, 7) + n, governorate: 'Tunis', delegation: 'La Marsa', address: `Rue ${n}`, goodsPrice: 30 })).data;
  // Livré par Runex dans ce scénario (JAX peut être configuré sur l'API de test).
  sql(`DELETE FROM "SousTraitance" WHERE "packageId" = '${c.id}'`);
  return c;
};
const hub = (await api(admin, 'GET', '/inter-depots/form-options')).data.deposits.find((d) => d.isMainHub);
const rs = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
await creer();
const aLivrer = await creer();
await api(admin, 'POST', '/depot/reception', { code: aLivrer.barcode, depositId: hub.id });
const affectation = await api(admin, 'POST', `/colis/${aLivrer.id}/assign`, { driverId: (await api(hamza, 'GET', '/auth/me')).data.driverId });
if (affectation.status >= 300) console.log('  (affectation)', affectation.status, affectation.message);
void rs;
await api(hamza, 'POST', `/colis/${aLivrer.id}/start`, {});
const livraison = await api(hamza, 'POST', `/colis/${aLivrer.id}/deliver`, { collectedAmount: Number(aLivrer.totalPrice) });
ok(livraison.status < 300, 'jeu d’essai : un colis livré aujourd’hui', `${livraison.status} ${livraison.message}`);
const auDepot = await creer();
await api(admin, 'POST', '/depot/reception', { code: auDepot.barcode, depositId: hub.id });

const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const errs = [];

console.log('\n1. Exploitation');
{
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 950 });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
  await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
  const v = (await api(admin, 'GET', '/dashboard?days=14')).data;
  const tuiles = [
    ...['preparation', 'collecte', 'depot', 'transit', 'livraison', 'reporte', 'livre', 'retour'].map((cle) => ({ sel: `[data-testid=tdb-etape-${cle}]`, attendu: v.vue.pipeline[cle], libelle: `étape « ${cle} »` })),
    { sel: '[data-testid=kpi-en-cours]', attendu: v.vue.active, libelle: 'Colis en cours' },
    { sel: '[data-testid=kpi-livres]', attendu: v.vue.period.delivered, libelle: 'Livrés · 14 jours' },
    // Taux de livraison (Rapports d'exploitation) : livrés parmi les colis créés sur la période.
    { sel: '[data-testid=kpi-taux]', attendu: v.vue.period.deliveredOfCreated, libelle: 'Taux de livraison (créés et livrés sur la période)' },
  ];
  const aAffecter = v.alerts.find((a) => a.category === 'COLIS_NON_AFFECTES')?.count ?? 0;
  for (const tu of tuiles) {
    await p.goto(W + '/dashboard', { waitUntil: 'networkidle2' });
    await p.waitForSelector(tu.sel, { timeout: 10000 });
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.click(tu.sel)]);
    await sleep(1800);
    const affiche = await p.evaluate(() => Number((document.body.innerText.match(/(\d+) colis\b/) ?? [])[1] ?? -1));
    ok(affiche === tu.attendu, `${tu.libelle} : la tuile compte ${tu.attendu}, la liste en montre ${affiche}`);
  }
  // « Colis à affecter » (À traiter maintenant) et « Livrés aujourd’hui ».
  await p.goto(W + '/dashboard', { waitUntil: 'networkidle2' }); await sleep(1200);
  const href = await p.evaluate(() => [...document.querySelectorAll('a')].find((a) => /colis à affecter/i.test(a.innerText))?.getAttribute('href'));
  if (href) {
    await p.goto(W + href, { waitUntil: 'networkidle2' }); await sleep(1800);
    const affiche = await p.evaluate(() => Number((document.body.innerText.match(/(\d+) colis\b/) ?? [])[1] ?? -1));
    ok(affiche === aAffecter, `Colis à affecter : ${aAffecter} attendus, la liste en montre ${affiche}`, href);
  } else ok(false, 'lien « Colis à affecter » trouvé');
  await p.goto(W + '/dashboard', { waitUntil: 'networkidle2' }); await sleep(1200);
  const hrefLivres = await p.evaluate(() => [...document.querySelectorAll('a')].find((a) => /livrés aujourd/i.test(a.innerText))?.getAttribute('href'));
  await p.goto(W + hrefLivres, { waitUntil: 'networkidle2' }); await sleep(1800);
  let t = await p.evaluate(() => document.body.innerText);
  const affLiv = Number((t.match(/(\d+) colis\b/) ?? [])[1] ?? -1);
  ok(affLiv === v.vue.today.delivered && t.includes(aLivrer.trackingNumber), `Livrés aujourd’hui : ${v.vue.today.delivered} attendus, ${affLiv} affichés`);
  ok(/livrés depuis le/.test(t), 'filtre posé par le lien expliqué en clair (« livrés depuis le … »)');
  // Le menu « Statut » montre l'étape choisie et « Réinitialiser » la retire.
  await p.goto(W + '/colis?statut=CREE,RAMASSAGE_PROGRAMME', { waitUntil: 'networkidle2' }); await sleep(1500);
  t = await p.evaluate(() => document.body.innerText);
  ok(/Créé · Ramassage prévu/.test(t), 'menu Statut : « Créé · Ramassage prévu »');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/53-colis-en-preparation.png` });
  await ctx.close();
}

console.log('\n2. Portail expéditeur');
{
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage(); await p.setViewport({ width: 1366, height: 900 });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
  await p.type('input[type=email]', 'expediteur@bluestar.tn'); await p.type('input[type=password]', 'Exp123!');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
  const d = (await api(exp, 'GET', '/shipper/dashboard?days=14')).data;
  const tuiles = [
    ...['preparation', 'collecte', 'depot', 'livraison', 'reporte', 'livre', 'retour'].map((cle) => ({ sel: `[data-testid=tdb-etape-${cle}]`, attendu: d.pipeline[cle], libelle: `étape « ${cle} »` })),
    { sel: '[data-testid=tdb-taux]', attendu: d.period.deliveredOfCreated, libelle: 'Taux (créés et livrés sur la période)' },
  ];
  for (const tu of tuiles) {
    await p.goto(W + '/expediteur/tableau-de-bord', { waitUntil: 'networkidle2' });
    await p.waitForSelector(tu.sel, { timeout: 10000 });
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.click(tu.sel)]);
    await sleep(1800);
    const affiche = await p.evaluate(() => Number((document.body.innerText.match(/(\d+) colis\b/) ?? [])[1] ?? -1));
    ok(affiche === tu.attendu, `${tu.libelle} : la tuile compte ${tu.attendu}, la liste en montre ${affiche}`);
  }
  await ctx.close();
}
await b.close();
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
