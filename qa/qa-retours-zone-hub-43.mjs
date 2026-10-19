#!/usr/bin/env node
/**
 * QA 43 — Retours expéditeur réservés à la zone du hub (Tunis, Ben Arous).
 *
 * Les colis retournés d'un expéditeur rattaché à une autre agence (Sousse…)
 * ne sont ni proposés ni acceptés dans un bon de retour : ils repartent vers
 * leur agence par « Inter dépôt retours et échanges ».
 *
 *   QA_API_URL=… QA_WEB_URL=… QA_DB_URL=… PUPPETEER_CORE=… CHROME=… node qa/qa-retours-zone-hub-43.mjs
 */
import { execFileSync } from 'node:child_process';

const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const W = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const DB = process.env.QA_DB_URL ?? 'postgresql://prod_owner:ownerpw@localhost:5432/runex_qa';
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
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const hamzaId = (await api(hamza, 'GET', '/auth/me')).data.driverId;
const shippers = (await api(admin, 'GET', '/shippers?limit=50')).data ?? [];
const bluestar = shippers.find((s) => s.code === 'EXP-BLUESTAR');
const benhcine = shippers.find((s) => s.code === 'EXP-BENHCINE');
const techstore = shippers.find((s) => s.code === 'EXP-TECHSTORE');
const hub = (await api(admin, 'GET', '/inter-depots/form-options')).data.deposits.find((d) => d.isMainHub);

let n = 0;
async function retour(shipper) {
  n++;
  const c = (await api(admin, 'POST', '/colis', { shipperId: shipper.id, customerName: `Zone Q43 ${n}`, customerPhone: `9643${String(1000 + n)}`, governorate: 'Ben Arous', delegation: 'Ben Arous', address: `Rue ${n}`, goodsPrice: 15 })).data;
  if (shipper.zoneHub) await api(admin, 'POST', '/depot/reception', { code: c.barcode, depositId: hub.id });
  else await api(admin, 'POST', '/inter-depots/acceptance/scan', { code: c.barcode, type: 'LIVRAISON', depositId: hub.id });
  await api(admin, 'POST', `/colis/${c.id}/assign`, { driverId: hamzaId });
  for (let k = 0; k < 3; k++) { await api(hamza, 'POST', `/colis/${c.id}/start`, {}); await api(hamza, 'POST', `/colis/${c.id}/postpone`, { reason: 'Client absent' }); }
  return c;
}

console.log('\n1. Dossiers');
ok(bluestar?.zoneHub === true && benhcine?.zoneHub === true, 'BlueStar (Ben Arous) et Benhcine (Tunis) : zone du hub');
ok(techstore?.zoneHub === false, 'TechStore (Agence Sousse) : hors zone');

console.log('\n2. À rendre et création du bon');
const cTS = await retour(techstore);
const cBS = await retour(bluestar);
ok(sql(`SELECT status FROM "Package" WHERE id = '${cTS.id}'`) === 'RETOUR_DEPOT', 'retour TechStore au hub');
const aRendre = (await api(admin, 'GET', '/retours-expediteur/a-rendre')).data ?? [];
ok(!aRendre.some((a) => a.shipperId === techstore.id), '« à rendre » : expéditeur hors zone absent');
ok(aRendre.some((a) => a.shipperId === bluestar.id), '« à rendre » : expéditeur de Ben Arous présent');
let r = await api(admin, 'POST', '/retours-expediteur/bons', { shipperId: techstore.id });
ok(r.status === 409 && /Agence Sousse/.test(r.message ?? '') && /Inter dépôt retours/.test(r.message ?? ''), 'bon pour un expéditeur hors zone : refusé, renvoyé vers l’inter-dépôt', `${r.status} ${r.message}`);
r = await api(admin, 'POST', '/retours-expediteur/bons', { shipperId: benhcine.id });
ok(r.status === 201, 'bon pour un expéditeur de Tunis : créé', `${r.status} ${r.message}`);
const bonBS = (await api(admin, 'POST', '/retours-expediteur/bons', { shipperId: bluestar.id })).data;
ok(!(bonBS?.colisAuDepot ?? []).some((c) => c.id === cTS.id) && (bonBS?.colisAuDepot ?? []).some((c) => c.id === cBS.id), 'fiche du bon : seuls les colis de l’expéditeur, aucun hors zone');

console.log('\n3. Scan');
r = await api(admin, 'POST', `/retours-expediteur/bons/${bonBS.id}/scan`, { code: cTS.barcode, mode: 'ajouter' });
ok(r.status === 409, 'colis hors zone scanné dans un bon : refusé', `${r.status} ${r.message}`);
r = await api(admin, 'POST', `/retours-expediteur/bons/${bonBS.id}/scan`, { code: cBS.barcode, mode: 'ajouter' });
ok(r.status === 200, 'colis de Ben Arous scanné : ajouté', `${r.status} ${r.message}`);
// Bon ouvert avant la règle pour un expéditeur hors zone : plus d'ajout.
const ancien = sql(`INSERT INTO "ReturnSlip" (id, "slipNumber", "shipperId", status, "handoverCode", "createdAt", "updatedAt") VALUES (gen_random_uuid(), 'BR-Q43-${Date.now() % 100000}', '${techstore.id}', 'PREPARE', '123456', now(), now()) RETURNING id`).split('\n')[0];
r = await api(admin, 'POST', `/retours-expediteur/bons/${ancien}/scan`, { code: cTS.barcode, mode: 'ajouter' });
ok(r.status === 409 && /Inter dépôt retours/.test(r.message ?? ''), 'ancien bon hors zone : ajout refusé', `${r.status} ${r.message}`);
ok((await api(admin, 'DELETE', `/retours-expediteur/bons/${ancien}`)).status === 200, 'ancien bon hors zone : peut être supprimé');

console.log('\n4. Le retour hors zone part par l’inter-dépôt');
const opts = (await api(admin, 'GET', '/inter-depots/form-options')).data;
const sousse = opts.deposits.find((d) => d.name === 'Agence Sousse');
const T = (await api(admin, 'POST', '/inter-depots', { type: 'RETOUR', destinationDepositId: sousse.id, transporterDriverId: opts.drivers[0].id })).data;
const cand = (await api(admin, 'GET', `/inter-depots/${T.transferNumber}/candidates`)).data ?? [];
ok(cand.some((c) => c.id === cTS.id), 'inter dépôt retours vers Sousse : le retour TechStore est proposé');

console.log('\n5. Écran « Ajouter un bon de retour »');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1366, height: 900 });
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
await p.goto(W + '/retours-expediteur/nouveau', { waitUntil: 'networkidle2' }); await sleep(1500);
const liste = await p.$eval('[data-testid=liste-expediteurs]', (x) => x.innerText);
ok(liste.includes(bluestar.companyName) && liste.includes(benhcine.companyName), 'liste : expéditeurs de Tunis et Ben Arous');
ok(!liste.includes(techstore.companyName), 'liste : TechStore (Sousse) absent');
await p.goto(W + '/retours-expediteur', { waitUntil: 'networkidle2' }); await sleep(1500);
const bandeau = await p.$('[data-testid=a-rendre]');
ok(!bandeau || !(await bandeau.evaluate((x) => x.innerText)).includes(techstore.companyName), 'bandeau « à rendre » : pas de TechStore');
await b.close();

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
