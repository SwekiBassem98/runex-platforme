#!/usr/bin/env node
/**
 * QA 52 — retours du client (10/11) :
 *  1. Statuts JAX → statuts Runex (liste du client) : le statut du colis suit
 *     JAX, y compris pour un colis encore « En préparation » côté Runex (les
 *     25 colis restés figés) ; correspondance modifiable ; colis chez JAX
 *     fermé aux tournées Runex.
 *  2. Portail expéditeur : étape « Reportés » au tableau de bord ; chaque
 *     étape mène à ses colis (« En livraison » n'est plus vide) ; aucune
 *     mention de JAX (liste, fiche, chronologie).
 *  3. Admin : « Bonsoir, Runex » ; écrans lisibles sur téléphone.
 *
 * Prérequis : faux serveur JAX (qa/mock-jax-server.mjs) et l'API lancée avec
 * JAX_API_URL=http://localhost:4010/api JAX_API_TOKEN=test-jax JAX_SYNC_MINUTES=0 JAX_RATTRAPAGE_AUTO=0.
 *
 *   QA_API_URL=… QA_WEB_URL=… PUPPETEER_CORE=… CHROME=… [QA_SHOTS=…] node qa/qa-jax-statuts-portail-52.mjs
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
  return { status: r.status, data: j?.data, meta: j?.meta, message: j?.message };
}
const jax = async (p, body) => (await fetch(`${JAX}${p}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json();
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;

await jax('/__control/reset', {});
const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
await api(admin, 'POST', '/sous-traitance/jax/referentiels');
const sfx = Date.now().toString().slice(-4);
let n = 0;
const creer = async () => {
  n++;
  return (await api(exp, 'POST', '/colis', { customerName: `Q52 ${sfx}-${n}`, customerPhone: `9852${sfx}`.slice(0, 7) + n, governorate: 'Sousse', delegation: 'Akouda', address: `Rue ${n}`, goodsPrice: 40 })).data;
};
const lire = async (id) => (await api(admin, 'GET', `/colis/${id}`)).data;
const lireExp = async (id) => (await api(exp, 'GET', `/colis/${id}`)).data;
const statutJax = async (c, statutId) => {
  const ean = (await lire(c.id)).sousTraitance.codeExterne;
  await jax('/__control/statut', { ean, statutId });
};

console.log('\n1. Statuts JAX → statuts Runex');
const p = (await api(admin, 'GET', '/sous-traitance/jax/parametres')).data;
const propose = (lib) => p.statuts.find((s) => s.libelle === lib)?.statutRunexPropose;
ok(
  propose('En attente') === 'CREE' && propose("reçu à l'entrepôt") === 'RECU_DEPOT' &&
    propose('en cours de préparation au transfert à une autre agence') === 'EN_LOT_INTER_DEPOT' && propose('En cours de livraison') === 'EN_COURS_LIVRAISON' &&
    propose('Annulé') === 'RETOUR_DEPOT' && propose("en cours de préparation au retour vers l'expéditeur") === 'EN_RUNSHEET_RETOUR' && propose('Livré') === 'LIVRE',
  'correspondances proposées conformes à la liste du client',
  JSON.stringify(p.statuts.map((s) => [s.libelle, s.statutRunexPropose]))
);
const a = await creer();
ok((await lire(a.id)).status === 'CREE' && (await lire(a.id)).sousTraitance?.codeExterne, 'colis créé : « En préparation », chez JAX');
await statutJax(a, 9); // reçu à l'entrepôt
let r = await api(admin, 'POST', '/sous-traitance/jax/sync', {});
ok(r.status === 200 && r.data.relus >= 1, 'relecture automatique : les colis « En préparation » chez JAX sont relus (plus figés)', r.message);
let d = await lire(a.id);
ok(d.status === 'RECU_DEPOT' && !d.currentDepositId, 'reçu à l’entrepôt JAX → « Reçu au dépôt » (hors stock d’une agence Runex)', d.status);
ok((await lireExp(a.id)).status === 'RECU_DEPOT', 'expéditeur : le même statut');
r = await api(admin, 'POST', `/colis/${a.id}/assign`, { driverId: (await api(hamza, 'GET', '/auth/me')).data.driverId });
ok(r.status === 409 && /Confié au partenaire JAX/.test(r.message ?? ''), 'colis chez JAX : affectation à un livreur Runex refusée', `${r.status} ${r.message}`);
await statutJax(a, 10);
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [a.id] });
ok((await lire(a.id)).status === 'EN_LOT_INTER_DEPOT', 'transfert vers une autre agence → « En lot inter-dépôt »');
await statutJax(a, 4);
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [a.id] });
ok((await lire(a.id)).status === 'EN_COURS_LIVRAISON', 'en cours de livraison → « En cours de livraison »');
await statutJax(a, 9);
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [a.id] });
ok((await lire(a.id)).status === 'REPORTE', 'reçu à l’entrepôt après une sortie en livraison → « Reporté »');
await statutJax(a, 4);
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [a.id] });
await statutJax(a, 5);
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [a.id] });
d = await lire(a.id);
ok(d.status === 'LIVRE' && Number(d.collectedAmount) === Number(d.totalPrice) && d.sousTraitance.etat === 'LIVRE', 'livré → « Livré », montant encaissé par JAX');
await statutJax(a, 9);
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [a.id] });
ok((await lire(a.id)).status === 'LIVRE', 'statut final : une relecture ne le change plus');
const b = await creer();
await statutJax(b, 7);
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [b.id] });
ok((await lire(b.id)).status === 'RETOUR_DEPOT', 'annulé (rubrique « En retour ») → « Retour au dépôt »');
await statutJax(b, 11);
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [b.id] });
ok((await lire(b.id)).status === 'EN_RUNSHEET_RETOUR', 'préparation du retour vers l’expéditeur → « En retour fournisseur »');
const tl = (await lire(b.id)).trackingTimeline ?? [];
ok(tl.some((e) => /Retour au dépôt/.test(e.label)) && tl.some((e) => /Statut JAX/.test(e.notes ?? e.description ?? '')), 'chronologie (exploitation) : statut Runex et statut JAX');
// Correspondance fixée par l'administrateur.
r = await api(admin, 'PATCH', '/sous-traitance/jax/statuts/9', { statutRunex: 'EN_TRANSIT_INTER_DEPOT' });
ok(r.status === 200, 'correspondance « reçu à l’entrepôt » modifiable', r.message);
const c = await creer();
await statutJax(c, 9);
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [c.id] });
ok((await lire(c.id)).status === 'EN_TRANSIT_INTER_DEPOT', 'correspondance manuelle appliquée');
await api(admin, 'PATCH', '/sous-traitance/jax/statuts/9', { statutRunex: null });

console.log('\n2. Portail expéditeur');
const enLiv = await creer();
await statutJax(enLiv, 4);
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [enLiv.id] });
const rep = await creer();
await statutJax(rep, 4);
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [rep.id] });
await statutJax(rep, 8);
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [rep.id] });
ok((await lire(rep.id)).status === 'REPORTE', 'colis reporté chez JAX');
const tdb = (await api(exp, 'GET', '/shipper/dashboard')).data;
ok(typeof tdb?.pipeline?.reporte === 'number' && tdb.pipeline.reporte >= 1, 'tableau de bord : étape « Reportés »', JSON.stringify(tdb?.pipeline));
const multi = (await api(exp, 'GET', '/colis?limit=100&status=AFFECTE_RUNSHEET,EN_COURS_LIVRAISON')).data ?? [];
ok(multi.length === tdb.pipeline.livraison && multi.some((x) => x.id === enLiv.id), '« En livraison » : la liste montre autant de colis que le tableau de bord', `${multi.length} / ${tdb.pipeline.livraison}`);

const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const br = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const errs = [];
{
  const ctx = await br.createBrowserContext();
  const pg = await ctx.newPage(); await pg.setViewport({ width: 1366, height: 900 });
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
  await pg.type('input[type=email]', 'expediteur@bluestar.tn'); await pg.type('input[type=password]', 'Exp123!');
  await Promise.all([pg.waitForNavigation({ waitUntil: 'networkidle2' }), pg.keyboard.press('Enter')]);
  await pg.goto(W + '/expediteur/tableau-de-bord', { waitUntil: 'networkidle2' }); await sleep(1500);
  ok(!!(await pg.$('[data-testid=tdb-etape-reporte]')) && /Reportés/.test(await pg.$eval('[data-testid=tdb-etape-reporte]', (x) => x.innerText)), 'tableau de bord : tuile « Reportés »');
  if (SHOTS) await pg.screenshot({ path: `${SHOTS}/52-tdb-expediteur.png` });
  await Promise.all([pg.waitForNavigation({ waitUntil: 'networkidle2' }), pg.click('[data-testid=tdb-etape-livraison]')]);
  await sleep(1500);
  let t = await pg.evaluate(() => document.body.innerText);
  ok(t.includes(enLiv.trackingNumber), 'clic « En livraison » : le colis en livraison est listé (plus de liste vide)');
  await pg.goto(W + '/expediteur/tableau-de-bord', { waitUntil: 'networkidle2' }); await sleep(1000);
  await Promise.all([pg.waitForNavigation({ waitUntil: 'networkidle2' }), pg.click('[data-testid=tdb-etape-reporte]')]);
  await sleep(1500);
  t = await pg.evaluate(() => document.body.innerText);
  ok(t.includes(rep.trackingNumber), 'clic « Reportés » : le colis reporté est listé');
  await pg.goto(W + '/expediteur/colis?date=tous', { waitUntil: 'networkidle2' }); await sleep(1500);
  t = await pg.evaluate(() => document.body.innerText);
  ok(!/JAX/i.test(t), 'liste des colis : aucune mention de JAX');
  await pg.goto(`${W}/expediteur/colis/${b.id}`, { waitUntil: 'networkidle2' }); await sleep(1500);
  t = await pg.evaluate(() => document.body.innerText);
  ok(!/JAX|partenaire de livraison/i.test(t), 'fiche du colis (et sa chronologie) : aucune mention de JAX', (t.match(/.{30}JAX.{30}/) ?? [''])[0]);
  await ctx.close();
}

console.log('\n3. Exploitation');
{
  const ctx = await br.createBrowserContext();
  const pg = await ctx.newPage(); await pg.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(W + '/connexion', { waitUntil: 'networkidle2' });
  await pg.type('input[type=email]', 'admin@logixpress.tn'); await pg.type('input[type=password]', 'Admin123!');
  await Promise.all([pg.waitForNavigation({ waitUntil: 'networkidle2' }), pg.keyboard.press('Enter')]);
  await pg.goto(W + '/dashboard', { waitUntil: 'networkidle2' }); await sleep(1500);
  const t = await pg.evaluate(() => document.body.innerText);
  ok(/(Bonjour|Bon après-midi|Bonsoir), Runex/.test(t), 'accueil : « …, Runex »');
  for (const chemin of ['/dashboard', '/colis', `/colis/${a.id}`, '/sous-traitance', '/retours-expediteur', '/admin/expediteurs']) {
    await pg.goto(W + chemin, { waitUntil: 'networkidle2' }); await sleep(1200);
    const res = await pg.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const coupes = [...document.querySelectorAll('header button, header a')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1; }).length;
      return { large: document.documentElement.scrollWidth <= vw + 1, coupes };
    });
    ok(res.large && res.coupes === 0, `téléphone ${chemin} : rien ne déborde (barre du haut comprise)`, JSON.stringify(res));
  }
  await pg.goto(W + '/colis', { waitUntil: 'networkidle2' }); await sleep(1200);
  ok(!!(await pg.$('.sm\\:hidden.bg-white')) || /TÉLÉPHONE|Téléphone/i.test(await pg.evaluate(() => document.body.innerText)), 'liste des colis sur téléphone : en fiches par défaut');
  if (SHOTS) await pg.screenshot({ path: `${SHOTS}/52-colis-telephone.png` });
  await ctx.close();
}
await br.close();
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
