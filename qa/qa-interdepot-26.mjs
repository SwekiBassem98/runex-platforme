#!/usr/bin/env node
/**
 * QA 26 — transferts inter-dépôts de bout en bout, contre l'API réelle.
 *
 * Remplace scripts/verify-interdepot.sh, écrit avant que le conducteur du
 * transfert (transporterDriverId) ne devienne obligatoire et que le cycle ne
 * passe à CRE → PREPARE → EN_TRANSIT → RECU / ANNULE.
 *
 *   node qa/qa-interdepot-26.mjs            (API sur http://127.0.0.1:4000)
 *   QA_BASE_URL=https://… node qa/qa-interdepot-26.mjs
 *
 * N'utilise que l'API (aucun accès direct à la base) ; s'exécute sur une base
 * de démonstration fraîchement seedée.
 */
const BASE = (process.env.QA_BASE_URL ?? 'http://127.0.0.1:4000/api/v1').replace(/\/+$/, '');
let pass = 0;
const failures = [];
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`  ✔ ${label}`); }
  else { failures.push(label); console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
  return cond;
};
async function api(token, method, path, body) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch { /* vide */ }
  return { status: r.status, json, data: json?.data };
}
async function login(email, password) {
  const r = await api(null, 'POST', '/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status}`);
  return r.data.accessToken;
}

const admin = await login('admin@logixpress.tn', 'Admin123!');
const agent = await login('agent.magasin@logixpress.tn', 'Agent123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const livreur = await login('livreur.hamza@logixpress.tn', 'Liv123!');

const depots = (await api(admin, 'GET', '/depots')).data;
const HUB = depots.find((d) => d.isMainHub);
const OTHER = depots.find((d) => !d.isMainHub && d.status === 'ACTIF');
const THIRD = depots.find((d) => !d.isMainHub && d.status === 'ACTIF' && d.id !== OTHER.id);
const drivers = (await api(admin, 'GET', '/drivers?limit=50')).data;
const DRIVER = drivers.find((d) => d.isActive && d.driverCode === 'LIV-SOU-002') ?? drivers.find((d) => d.isActive);
const HAMZA = drivers.find((d) => d.driverCode === 'LIV-BEN-001');

let seq = 0;
async function readyPackage(price = 25) {
  seq++;
  const c = await api(exp, 'POST', '/colis', {
    customerName: `Transit QA ${seq}`, customerPhone: `9922${String(Date.now()).slice(-4)}`,
    address: `Rue du transit ${seq}`, governorate: 'Sousse', city: 'Sousse', totalPrice: price,
  });
  if (c.status !== 201) throw new Error(`création colis → ${c.status} ${JSON.stringify(c.json)}`);
  const s = await api(admin, 'POST', '/warehouse/scan-accept', { barcode: c.data.trackingNumber, depositId: HUB.id });
  if (s.status !== 200 && s.status !== 201) throw new Error(`scan-accept → ${s.status} ${JSON.stringify(s.json)}`);
  return c.data;
}
const colis = async (id) => (await api(admin, 'GET', `/colis/${id}`)).data;

console.log(`Hub ${HUB.name} → ${OTHER.name}, conducteur ${DRIVER.driverCode}`);
const p1 = await readyPackage(20);
const p2 = await readyPackage(40);
ok((await colis(p1.id)).currentDepositId === HUB.id, 'colis 1 réceptionné au hub');

console.log('\n=== 1. Garde-fous à la création ===');
const base = { sourceDepositId: HUB.id, destinationDepositId: OTHER.id, transporterDriverId: DRIVER.id };
ok((await api(admin, 'POST', '/inter-depots', { ...base, destinationDepositId: HUB.id, packageIds: [p1.id] })).status === 400, 'source = destination → 400');
ok((await api(admin, 'POST', '/inter-depots', { ...base, packageIds: [] })).status === 400, 'aucun colis → 400');
ok((await api(admin, 'POST', '/inter-depots', { ...base, transporterDriverId: undefined, packageIds: [p1.id] })).status === 400, 'sans conducteur → 400');
ok((await api(admin, 'POST', '/inter-depots', { ...base, packageIds: ['pas-un-uuid'] })).status === 400, 'identifiant de colis invalide → 400');
ok((await api(admin, 'POST', '/inter-depots', { ...base, packageIds: [p1.id, p1.id] })).status === 400, 'colis répété → 400');
ok((await api(admin, 'POST', '/inter-depots', { ...base, sourceDepositId: OTHER.id, destinationDepositId: HUB.id, packageIds: [p1.id] })).status === 409, 'colis absent du dépôt source → 409');
ok((await api(admin, 'POST', '/inter-depots', { ...base, scheduledDate: '08/10/2026', packageIds: [p1.id] })).status === 400, 'date mal formée → 400');
ok((await api(exp, 'POST', '/inter-depots', { ...base, packageIds: [p1.id] })).status === 403, 'expéditeur ne peut pas créer → 403');
ok((await api(livreur, 'POST', '/inter-depots', { ...base, packageIds: [p1.id] })).status === 403, 'livreur ne peut pas créer → 403');
ok((await api(agent, 'POST', '/inter-depots', { ...base, sourceDepositId: OTHER.id, destinationDepositId: THIRD.id, packageIds: [p1.id] })).status === 403, 'agent : source hors de son dépôt → 403');

console.log('\n=== 2. Création par l’agent du dépôt source ===');
const created = await api(agent, 'POST', '/inter-depots', { ...base, packageIds: [p1.id, p2.id], sealNumber: 'PLOMB-QA-1' });
ok(created.status === 201, 'création → 201', `HTTP ${created.status} ${JSON.stringify(created.json)?.slice(0, 200)}`);
const TN = created.data?.transferNumber;
ok(created.data?.status === 'CRE', 'statut CRE');
ok(created.data?.totalPackages === 2, '2 colis dans le lot');
let c1 = await colis(p1.id);
ok(c1.status === 'EN_LOT_INTER_DEPOT', 'colis en lot inter-dépôt');
ok((await api(admin, 'POST', '/inter-depots', { ...base, packageIds: [p1.id] })).status === 409, 'colis déjà dans un lot → 409');

console.log('\n=== 3. Visibilité ===');
ok((await api(livreur, 'GET', `/inter-depots/${TN}`)).status === 404 || HAMZA?.id === DRIVER.id, 'livreur non transporteur ne voit pas le transfert');
ok((await api(exp, 'GET', `/inter-depots/${TN}`)).status === 403, 'expéditeur → 403');
const list = await api(agent, 'GET', '/inter-depots');
ok(list.status === 200 && list.data.some((t) => t.transferNumber === TN), 'agent voit le transfert de son dépôt');

console.log('\n=== 4. Préparation et départ ===');
const prep = await api(agent, 'POST', `/inter-depots/${TN}/prepare`, {});
ok(prep.status === 200 && prep.data.status === 'PREPARE', 'préparation → PREPARE', `HTTP ${prep.status}`);
ok((await api(admin, 'POST', `/inter-depots/${TN}/receive`, { receivedPackages: 2 })).status === 409, 'réception avant départ → 409');
const disp = await api(agent, 'POST', `/inter-depots/${TN}/dispatch`, {});
ok(disp.status === 200 && disp.data.status === 'EN_TRANSIT', 'départ → EN_TRANSIT', `HTTP ${disp.status}`);
c1 = await colis(p1.id);
ok(c1.status === 'EN_TRANSIT_INTER_DEPOT', 'colis en transit');
ok(c1.currentDepositId == null, 'colis sorti du stock du dépôt source');
ok((await api(agent, 'POST', `/inter-depots/${TN}/cancel`, {})).status === 409, 'annulation pendant le transit → 409');
ok((await api(agent, 'POST', `/inter-depots/${TN}/dispatch`, {})).status === 409, 'second départ → 409');
ok((await api(agent, 'POST', `/inter-depots/${TN}/receive`, { receivedPackages: 2 })).status === 403, 'le dépôt source ne peut pas réceptionner → 403');

const inv = await api(admin, 'GET', `/inventaire/exceptions?search=${p1.trackingNumber}`);
ok(inv.status === 200 && !(inv.data ?? []).some((r) => r.id === p1.id), 'colis en transit non signalé comme incohérent');

console.log('\n=== 5. Réception ===');
ok((await api(admin, 'POST', `/inter-depots/${TN}/receive`, { receivedPackages: 3 })).status === 400, 'reçus > expédiés → 400');
ok((await api(admin, 'POST', `/inter-depots/${TN}/receive`, { receivedPackages: -1 })).status === 400, 'reçus négatifs → 400');
const [r1, r2] = await Promise.all([
  api(admin, 'POST', `/inter-depots/${TN}/receive`, { receivedPackages: 2 }),
  api(admin, 'POST', `/inter-depots/${TN}/receive`, { receivedPackages: 2 }),
]);
const codes = [r1.status, r2.status].sort();
ok(codes[0] === 200 && codes[1] === 409, 'réceptions simultanées : une seule réussit', `codes ${codes}`);
const recv = r1.status === 200 ? r1 : r2;
ok(recv.data?.status === 'RECU', 'statut RECU');
c1 = await colis(p1.id);
ok(c1.currentDepositId === OTHER.id, 'colis arrivé au dépôt de destination');
ok(c1.status === 'RECU_DEPOT_DESTINATION', 'statut colis reçu au dépôt de destination');
ok((await api(admin, 'POST', `/inter-depots/${TN}/receive`, { receivedPackages: 2 })).status === 409, 'seconde réception → 409');
ok((await api(admin, 'POST', `/inter-depots/${TN}/cancel`, {})).status === 409, 'annulation après réception → 409');
const detail = await api(admin, 'GET', `/inter-depots/${TN}`);
ok(detail.status === 200 && Array.isArray(detail.data.timeline ?? detail.data.steps ?? []), 'détail du transfert lisible');

console.log('\n=== 6. Réception avec écart ===');
const p3 = await readyPackage(50);
const t2 = await api(admin, 'POST', '/inter-depots', { ...base, packageIds: [p3.id] });
ok(t2.status === 201, 'second transfert créé');
await api(admin, 'POST', `/inter-depots/${t2.data.transferNumber}/dispatch`, {});
const anomalie = await api(admin, 'POST', `/inter-depots/${t2.data.transferNumber}/receive`, { receivedPackages: 0, receptionNotes: 'Colis manquant' });
ok(anomalie.status === 200, 'réception avec écart enregistrée');
ok(anomalie.data?.hasDiscrepancy === true, 'écart signalé');

console.log('\n=== 7. Annulation avant départ ===');
const p4 = await readyPackage(30);
const t3 = await api(admin, 'POST', '/inter-depots', { ...base, packageIds: [p4.id] });
const cancel = await api(agent, 'POST', `/inter-depots/${t3.data.transferNumber}/cancel`, {});
ok(cancel.status === 200 && cancel.data.status === 'ANNULE', 'annulation → ANNULE', `HTTP ${cancel.status}`);
const c4 = await colis(p4.id);
ok(c4.status === 'RECU_DEPOT' && c4.currentDepositId === HUB.id, 'colis revenu au dépôt d’origine');
ok((await api(admin, 'POST', '/inter-depots', { ...base, packageIds: [p4.id] })).status === 201, 'colis à nouveau transférable');

console.log('\n=== 8. Identifiants hostiles ===');
ok((await api(admin, 'GET', '/inter-depots/%00')).status === 400 || (await api(admin, 'GET', '/inter-depots/xyz')).status === 404, 'identifiant inconnu → 404');
ok((await api(admin, 'POST', '/inter-depots/TRF-INCONNU/dispatch', {})).status === 404, 'transition sur transfert inconnu → 404');

console.log(`\nRESULT: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(` - ${f}`); process.exit(1); }
