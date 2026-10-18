#!/usr/bin/env node
/**
 * QA 36 — acceptation par zone (demande du client, 18/10) :
 *  1. Acceptation Magasin : expéditeurs de Tunis et Ben Arous seulement ;
 *  2. Acceptation inter dépôt (livraison) : expéditeurs hors Tunis / Ben Arous,
 *     avec ou sans bordereau ;
 *  3. Acceptation inter dépôt retours : retours de toutes les zones ;
 *  4. Inter dépôt retours (création) : agences hors Tunis / Ben Arous seulement.
 *
 *   QA_API_URL=http://localhost:4000/api/v1 node qa/qa-acceptation-zones-36.mjs   (base seedée)
 */
const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
let pass = 0;
const failures = [];
const ok = (c, l, d = '') => {
  if (c) { pass++; console.log(`  ✔ ${l}`); } else { failures.push(l); console.log(`  ✘ ${l}${d ? ` — ${d}` : ''}`); }
};
async function api(token, method, path, body) {
  const h = { Accept: 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${API}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* vide */ }
  return { status: r.status, data: j?.data, message: j?.message, json: j };
}
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data.accessToken;
const admin = await login('admin@logixpress.tn', 'Admin123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const hamzaId = (await api(hamza, 'GET', '/auth/me')).data.driverId;
const shippers = (await api(admin, 'GET', '/shippers?limit=50')).data ?? [];
const bluestar = shippers.find((s) => s.governorate === 'Ben Arous');
const benhcine = shippers.find((s) => s.governorate === 'Tunis');
const techstore = shippers.find((s) => s.governorate === 'Sousse');
ok(!!bluestar && !!benhcine && !!techstore, 'expéditeurs de Ben Arous, Tunis et Sousse (base de démonstration)');
const opts = (await api(admin, 'GET', '/inter-depots/form-options')).data;
const hub = opts.deposits.find((d) => d.isMainHub);
const sousse = opts.deposits.find((d) => d.name === 'Agence Sousse');
const tunis = opts.deposits.find((d) => d.name === 'Agence Tunis');
ok(JSON.stringify(opts.zoneHub) === JSON.stringify(['Tunis', 'Ben Arous']), 'zone du hub exposée : Tunis, Ben Arous', JSON.stringify(opts.zoneHub));
let n = 0;
const colis = async (shipperId, extra = {}) => {
  n++;
  const r = await api(admin, 'POST', '/colis', { shipperId, customerName: `Zone ${n}`, customerPhone: `9612${String(1000 + n)}`, governorate: 'Sfax', delegation: 'Sfax Ville', address: `Rue ${n}`, goodsPrice: 20, pieceCount: 1, ...extra });
  return r.data;
};
const magasin = (code, depositId = hub.id) => api(admin, 'POST', '/depot/reception', { code, depositId });
const accepter = (code, type, depositId = hub.id) => api(admin, 'POST', '/inter-depots/acceptance/scan', { code, type, depositId });

console.log('\n1. Acceptation Magasin : Tunis et Ben Arous seulement');
const cBA = await colis(bluestar.id);
const cTN = await colis(benhcine.id);
const cSO = await colis(techstore.id, { pieceCount: 2 });
let r = await magasin(cBA.barcode);
ok(r.status === 200 && r.data?.outcome === 'RECEIVED', 'expéditeur de Ben Arous : reçu', `${r.status} ${r.message}`);
r = await magasin(cTN.barcode);
ok(r.status === 200 && r.data?.outcome === 'RECEIVED', 'expéditeur de Tunis : reçu', `${r.status} ${r.message}`);
r = await magasin(cSO.barcode);
ok(r.status === 409 && r.data?.outcome === 'WRONG_CHANNEL' && /Inter dépôt livraison/.test(r.message ?? ''), 'expéditeur de Sousse : refusé, renvoyé vers l’acceptation inter dépôt', `${r.status} ${r.message}`);
ok((await api(admin, 'GET', `/colis/${cSO.id}`)).data?.status === 'CREE', 'colis de Sousse inchangé');

console.log('\n2. Acceptation inter dépôt (livraison) : hors Tunis et Ben Arous');
const cBA2 = await colis(bluestar.id);
r = await accepter(cBA2.barcode, 'LIVRAISON');
ok(r.status === 409 && /Acceptation Magasin/.test(r.message ?? ''), 'expéditeur de Ben Arous : renvoyé vers l’Acceptation Magasin', `${r.status} ${r.message}`);
r = await accepter(`${cSO.barcode}-1`, 'LIVRAISON');
ok(r.status === 200 && /reçu/.test(r.data?.message ?? r.json?.data?.message ?? r.message ?? ''), 'expéditeur de Sousse : accepté sans bordereau', `${r.status} ${r.message}`);
const apres = (await api(admin, 'GET', `/colis/${cSO.id}`)).data;
ok(apres?.status === 'RECU_DEPOT' && apres?.currentDepositName === hub.name, 'colis reçu au hub', `${apres?.status} ${apres?.currentDepositName}`);
r = await accepter(cSO.barcode, 'LIVRAISON');
ok(r.status === 409 && /déjà reçu/.test(r.message ?? ''), 'deuxième scan : déjà reçu');
const board = (await api(admin, 'GET', `/inter-depots/acceptance?type=LIVRAISON&depositId=${hub.id}`)).data;
ok(board?.accepted?.some((a) => a.trackingNumber === cSO.trackingNumber && a.transferNumber === '' && a.state === 'RECU'), 'liste des acceptations : colis « sans bordereau »');
ok(board?.receivedCount >= 1, 'compteur « colis reçus » à jour', String(board?.receivedCount));

console.log('\n3. Acceptation inter dépôt retours : toutes les zones');
// Un retour d'expéditeur de Sousse revenu à l'agence de Sousse…
const ret = async (shipperId) => {
  const c = await colis(shipperId);
  await api(admin, 'POST', `/colis/${c.id}/assign`, { driverId: hamzaId });
  for (let k = 0; k < 3; k++) { await api(hamza, 'POST', `/colis/${c.id}/start`, {}); await api(hamza, 'POST', `/colis/${c.id}/postpone`, { reason: 'Client absent' }); }
  return c;
};
const rSO = await ret(techstore.id);
const rBA = await ret(bluestar.id);
ok((await api(admin, 'GET', `/colis/${rSO.id}`)).data?.status === 'RETOUR_DEPOT', 'retour créé (3 reports)');
// …accepté à l'Agence Sousse, puis au hub : de n'importe quelle zone.
r = await accepter(rSO.barcode, 'RETOUR', sousse.id);
ok(r.status === 200, 'retour accepté à l’Agence Sousse (venu d’une autre zone)', `${r.status} ${r.message}`);
ok((await api(admin, 'GET', `/colis/${rSO.id}`)).data?.currentDepositName === 'Agence Sousse', 'retour maintenant à l’Agence Sousse');
r = await accepter(rSO.barcode, 'RETOUR', sousse.id);
ok(r.status === 409 && /déjà en retour/.test(r.message ?? ''), 'deuxième scan au même dépôt : déjà en retour');
r = await accepter(rBA.barcode, 'RETOUR', tunis.id);
ok(r.status === 200, 'retour d’un expéditeur de Ben Arous accepté à l’Agence Tunis', `${r.status} ${r.message}`);
r = await accepter(cTN.barcode, 'RETOUR');
ok(r.status === 409 && /n'est pas un retour/.test(r.message ?? ''), 'colis qui n’est pas un retour : refusé', r.message);
const boardR = (await api(admin, 'GET', `/inter-depots/acceptance?type=RETOUR&depositId=${sousse.id}`)).data;
ok(boardR?.accepted?.some((a) => a.trackingNumber === rSO.trackingNumber), 'liste des retours acceptés (Sousse)');

console.log('\n4. Inter dépôt retours : agences hors Tunis et Ben Arous');
ok(opts.deposits.find((d) => d.id === tunis.id)?.inZoneHub === true && opts.deposits.find((d) => d.id === sousse.id)?.inZoneHub === false, 'agences marquées dans / hors zone du hub');
const driver = opts.drivers[0];
r = await api(admin, 'POST', '/inter-depots', { type: 'RETOUR', destinationDepositId: tunis.id, transporterDriverId: driver.id });
ok(r.status === 400 && /Retours expéditeur/.test(r.message ?? ''), 'inter dépôt retours vers Agence Tunis : refusé', `${r.status} ${r.message}`);
r = await api(admin, 'POST', '/inter-depots', { type: 'RETOUR', destinationDepositId: sousse.id, transporterDriverId: driver.id });
ok(r.status === 201, 'inter dépôt retours vers Agence Sousse : créé', `${r.status} ${r.message}`);
r = await api(admin, 'POST', '/inter-depots', { type: 'LIVRAISON', destinationDepositId: tunis.id, transporterDriverId: driver.id });
ok(r.status === 201, 'inter dépôt livraison vers Agence Tunis : toujours possible', `${r.status} ${r.message}`);

console.log(`\n${pass} vérifications réussies, ${failures.length} échec(s).`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
