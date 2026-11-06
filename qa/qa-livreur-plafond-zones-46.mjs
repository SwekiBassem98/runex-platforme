#!/usr/bin/env node
/**
 * QA 46 — demandes du client (06/11) :
 *  1. Fiche livreur : plus de champ « plafond » (création, modification, liste, détail, API) ;
 *  2. Zones des livreurs : elles valent pour la journée (heure de Tunis) —
 *     celles de la veille sont effacées, partout (application, affectation, écran Zones) ;
 *  3. Colis de tournée : l'identifiant de zone est fourni (filtre par zone de l'application).
 *
 *   QA_API_URL=… QA_WEB_URL=… QA_DB_URL=… PUPPETEER_CORE=… CHROME=… node qa/qa-livreur-plafond-zones-46.mjs
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
  return { status: r.status, data: j?.data, message: j?.message };
}
const sql = (q) => execFileSync('psql', [DB, '-qAtc', q], { encoding: 'utf8' }).trim();
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const admin = await login('admin@logixpress.tn', 'Admin123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const me = (await api(hamza, 'GET', '/auth/me')).data;
const stamp = Date.now().toString().slice(-5);

console.log('\n1. Fiche livreur sans plafond');
let r = await api(admin, 'POST', '/drivers', {
  driverCode: `LIV-Q46-${stamp}`, vehicleType: 'Moto', licensePlate: `${stamp} TU 46`, cashCeiling: 99,
  compte: { fullName: 'Livreur Q46', email: `livreur.q46.${stamp}@test.tn`, phone: `55${stamp}1`, password: 'Livreur123!' },
});
ok(r.status === 201 && r.data?.id, 'création d’un livreur sans plafond', `${r.status} ${r.message}`);
ok(r.data && !('cashCeiling' in r.data), 'fiche livreur : plus de plafond dans la réponse');
const nouveauId = r.data?.id;
ok(sql(`SELECT "cashCeiling"::text FROM "Driver" WHERE id = '${nouveauId}'`) === '2000.000', 'valeur envoyée ignorée (plus pilotée par l’écran)');
r = await api(admin, 'PATCH', `/drivers/${nouveauId}`, { vehicleType: 'Voiture', cashCeiling: 5 });
if (r.status === 404 || r.status === 405) r = await api(admin, 'PUT', `/drivers/${nouveauId}`, { vehicleType: 'Voiture', cashCeiling: 5 });
ok(r.status === 200 && r.data?.vehicleType === 'Voiture', 'modification sans plafond', `${r.status} ${r.message}`);
const dash = (await api(hamza, 'GET', '/dashboard')).data;
const alerte = JSON.stringify(dash?.alerts ?? []);
ok(!/plafond/i.test(alerte), 'tableau de bord livreur : plus de mention du plafond', alerte.slice(0, 160));
const profil = (await api(hamza, 'GET', '/drivers/me')).data;
ok(profil && !('cashCeiling' in profil), 'profil livreur (application) : plus de plafond');

console.log('\n2. Zones du jour');
const shippers = (await api(admin, 'GET', '/shippers?limit=50')).data;
const bluestar = shippers.find((s) => s.code === 'EXP-BLUESTAR');
// Les zones naissent avec les colis : deux adresses, deux zones.
for (const [gov, deleg] of [['Ben Arous', 'Rades'], ['Tunis', 'La Marsa']]) {
  await api(admin, 'POST', '/colis', { shipperId: bluestar.id, customerName: `Zone ${deleg}`, customerPhone: '98460009', governorate: gov, delegation: deleg, address: 'Rue 46', goodsPrice: 20 });
}
const zones = (await api(admin, 'GET', '/zones')).data ?? [];
ok(zones.length >= 2, 'zones de la plateforme disponibles', String(zones.length));
const [z1, z2] = zones;
r = await api(hamza, 'PUT', '/drivers/me/zones', { zoneIds: [z1.id, z2.id] });
ok(r.status === 200 && r.data.length === 2, 'livreur : 2 zones choisies aujourd’hui');
ok(r.data.every((z) => z.delegation && z.governorate), 'zones avec gouvernorat et délégation');
let mesZones = (await api(hamza, 'GET', '/drivers/me')).data?.zones ?? [];
ok(mesZones.length === 2 && mesZones[0].delegation, 'profil (application) : zones du jour avec délégation');
let adm = (await api(admin, 'GET', '/zones')).data.find((z) => z.id === z1.id);
ok(adm?.drivers?.some((d) => d.id === me.driverId), 'écran Zones : le livreur figure dans sa zone du jour');
// Passage à minuit : les choix d'hier ne valent plus.
sql(`UPDATE "DriverZone" SET "createdAt" = now() - interval '1 day' WHERE "driverId" = '${me.driverId}'`);
mesZones = (await api(hamza, 'GET', '/drivers/me/zones')).data ?? [];
ok(mesZones.length === 0, 'lendemain : plus aucune zone pour le livreur (à choisir à nouveau)');
ok(sql(`SELECT count(*) FROM "DriverZone" WHERE "driverId" = '${me.driverId}'`) === '0', 'zones de la veille effacées en base');
r = await api(hamza, 'PUT', '/drivers/me/zones', { zoneIds: [z2.id] });
ok(r.status === 200 && r.data.length === 1 && r.data[0].id === z2.id, 'nouvelle journée : nouvelles zones choisies');
sql(`UPDATE "DriverZone" SET "createdAt" = now() - interval '1 day' WHERE "driverId" = '${me.driverId}'`);
adm = (await api(admin, 'GET', '/zones')).data.find((z) => z.id === z2.id);
ok(!adm?.drivers?.some((d) => d.id === me.driverId), 'écran Zones : plus de livreur d’hier dans la zone');
// Affectation : le livreur ne « couvre » plus la zone d'hier.
const c = (await api(admin, 'POST', '/colis', { shipperId: bluestar.id, customerName: 'Zone Q46', customerPhone: '98460001', governorate: z2.governorate, delegation: z2.delegation, address: 'Rue 46', goodsPrice: 20 })).data;
await api(hamza, 'PUT', '/drivers/me/zones', { zoneIds: [z2.id] });
let sugg = (await api(admin, 'GET', `/colis/${c.id}/driver-suggestions`)).data;
ok(sugg?.drivers?.find((d) => d.id === me.driverId)?.coversZone === true, 'affectation : livreur proposé pour sa zone du jour');
sql(`UPDATE "DriverZone" SET "createdAt" = now() - interval '1 day' WHERE "driverId" = '${me.driverId}'`);
sugg = (await api(admin, 'GET', `/colis/${c.id}/driver-suggestions`)).data;
ok(sugg?.drivers?.find((d) => d.id === me.driverId)?.coversZone === false, 'affectation : plus prioritaire le lendemain');

console.log('\n3. Colis de tournée : identifiant de zone');
const rs = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
ok(Array.isArray(rs?.packages ?? rs?.colis), 'tournée active de l’application lue');
const fiche = (await api(admin, 'GET', `/colis/${c.id}`)).data;
ok(fiche?.zoneId === z2.id && fiche.zoneName, 'colis : sa zone (identifiant et nom) est fournie à l’application', JSON.stringify({ zoneId: fiche?.zoneId, zoneName: fiche?.zoneName }));

console.log('\n4. Écran Livreurs (back-office)');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
await p.goto(W + '/admin/livreurs', { waitUntil: 'networkidle2' }); await sleep(1500);
let t = await p.evaluate(() => document.querySelector('main')?.innerText ?? '');
ok(!/plafond/i.test(t), 'liste des livreurs : plus de colonne « Plafond »');
for (const bt of await p.$$('button')) { if (/Nouveau livreur|Ajouter|Créer/i.test(await bt.evaluate((x) => x.innerText))) { await bt.click(); break; } }
await sleep(800);
const formulaire = await p.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? '');
ok(/Immatriculation/.test(formulaire) && !/plafond/i.test(formulaire), 'formulaire de création : plus de champ « Plafond de caisse »', formulaire.slice(0, 120));
await p.screenshot({ path: `${SHOTS}/46-formulaire-livreur.png` });
await p.goto(W + '/admin/zones', { waitUntil: 'networkidle2' }); await sleep(1200);
ok(/Livreurs du jour/i.test(await p.evaluate(() => document.body.innerText)), 'écran Zones : colonne « Livreurs du jour »');
await b.close();
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
