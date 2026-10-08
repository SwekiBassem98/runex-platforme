#!/usr/bin/env node
/**
 * QA — Inter-dépôts « au scan » (livraison et retours), contre l'API réelle.
 *
 * Flux attendu (repris de la plateforme utilisée par les agences) :
 *   bordereau (agence, livreur → immatriculation, date) → scan des colis
 *   (Ajouter / Retirer, contrôle de destination) → acceptation à l'arrivée,
 *   pièce par pièce, bordereau ouvert tant qu'une pièce manque.
 *
 *   node qa/qa-interdepot-26.mjs     (base fraîchement seedée, API sur :4000)
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
  return { status: r.status, json, data: json?.data, msg: json?.message ?? '' };
}
async function login(email, password) {
  const r = await api(null, 'POST', '/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status}`);
  return r.data.accessToken;
}
const show = (r) => `HTTP ${r.status} ${r.msg}`.slice(0, 220);

const admin = await login('admin@logixpress.tn', 'Admin123!');
const agent = await login('agent.magasin@logixpress.tn', 'Agent123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const livreur = await login('livreur.hamza@logixpress.tn', 'Liv123!');

console.log('=== 0. Référentiels du formulaire ===');
const opts = await api(agent, 'GET', '/inter-depots/form-options');
ok(opts.status === 200, 'form-options → 200', show(opts));
const deposits = opts.data.deposits;
const HUB = deposits.find((d) => d.isMainHub);
const SFAX = deposits.find((d) => /sfax/i.test(d.name));
const SOUSSE = deposits.find((d) => /sousse/i.test(d.name));
const TUNIS = deposits.find((d) => /tunis/i.test(d.name) && !d.isMainHub);
ok(HUB && SFAX && SOUSSE && TUNIS, 'agences hub / Sfax / Sousse / Tunis disponibles');
ok(opts.data.operatingDepositId === HUB.id, "l'agent opère depuis son dépôt (hub)");
const DRIVER = opts.data.drivers.find((d) => d.licensePlate) ?? opts.data.drivers[0];
ok(!!DRIVER && /-/.test(DRIVER.label), 'livreurs listés avec leur agence', DRIVER?.label);
const HAMZA_ID = (await api(admin, 'GET', '/drivers?limit=50')).data.find((d) => d.driverCode === 'LIV-BEN-001').id;

let seq = 0;
async function newPackage(token, extra = {}) {
  seq++;
  const r = await api(token, 'POST', '/colis', {
    customerName: `Client ID ${seq}`, customerPhone: `9877${String(1000 + seq)}`, address: `Rue ${seq}`, totalPrice: 20 + seq, ...extra,
  });
  if (r.status !== 201) throw new Error(`création colis → ${show(r)}`);
  return r.data;
}
async function receiveAtHub(p) {
  const r = await api(admin, 'POST', '/warehouse/scan-accept', { barcode: p.trackingNumber, depositId: HUB.id });
  if (r.status !== 200 && r.status !== 201) throw new Error(`scan-accept → ${show(r)}`);
}
const colis = async (id) => (await api(admin, 'GET', `/colis/${id}`)).data;
const pkgRow = async (id) => (await api(admin, 'GET', `/colis/${id}`)).data;

console.log('\n=== 1. Routage des colis ===');
const P2 = await newPackage(exp, { governorate: 'Sfax', delegation: 'Sfax', pieceCount: 2 });
const P1 = await newPackage(exp, { governorate: 'Sfax', delegation: 'Sfax' });
const PSO = await newPackage(exp, { governorate: 'Sousse', delegation: 'Sousse' });
const PCREE = await newPackage(exp, { governorate: 'Sfax', delegation: 'Sfax' });
ok(P2.destinationDepositId === SFAX.id || (await colis(P2.id)).destinationDepositId === SFAX.id, 'colis pour Sfax routé vers Agence Sfax');
for (const p of [P2, P1, PSO]) await receiveAtHub(p);
ok((await colis(P2.id)).currentDepositId === HUB.id, 'colis réceptionnés au hub');

console.log('\n=== 2. Ouverture du bordereau (en-tête) ===');
const baseHdr = { type: 'LIVRAISON', destinationDepositId: SFAX.id, transporterDriverId: DRIVER.id };
ok((await api(agent, 'POST', '/inter-depots', { ...baseHdr, destinationDepositId: undefined })).status === 400, 'sans agence → 400');
ok((await api(agent, 'POST', '/inter-depots', { ...baseHdr, destinationDepositId: HUB.id })).status === 400, 'vers son propre dépôt → 400');
ok((await api(agent, 'POST', '/inter-depots', { ...baseHdr, transporterDriverId: undefined })).status === 400, 'sans livreur → 400');
ok((await api(agent, 'POST', '/inter-depots', { ...baseHdr, packageIds: [P1.id] })).status === 400, 'colis joints à la création → 400 (le scan est obligatoire)');
ok((await api(agent, 'POST', '/inter-depots', { ...baseHdr, type: 'AUTRE' })).status === 400, 'type inconnu → 400');
ok((await api(agent, 'POST', '/inter-depots', { ...baseHdr, departureAt: 'pas une date' })).status === 400, 'date invalide → 400');
ok((await api(agent, 'POST', '/inter-depots', { ...baseHdr, vehiclePlate: '<script>' })).status === 400, 'immatriculation invalide → 400');
ok((await api(exp, 'POST', '/inter-depots', baseHdr)).status === 403, 'expéditeur → 403');
ok((await api(livreur, 'POST', '/inter-depots', baseHdr)).status === 403, 'livreur → 403');
ok((await api(agent, 'POST', '/inter-depots', { ...baseHdr, sourceDepositId: SOUSSE.id })).status === 403, 'agent : départ hors de son dépôt → 403');
const created = await api(agent, 'POST', '/inter-depots', baseHdr);
ok(created.status === 201, 'bordereau enregistré → 201', show(created));
const T = created.data;
ok(/^ID-D-\d{8}-\d{4}$/.test(T.transferNumber), 'numéro ID-D-AAAAMMJJ-NNNN', T.transferNumber);
ok(T.status === 'CRE' && T.statusLabel === 'En attente', 'état « En attente »');
ok(T.vehiclePlate === (DRIVER.licensePlate ?? null), "immatriculation reprise du livreur", `${T.vehiclePlate} vs ${DRIVER.licensePlate}`);
ok(T.direction === 'ENVOI' && T.sourceDepositId === HUB.id, 'parti du dépôt de l’agent, sens Envoi');
const patched = await api(agent, 'PATCH', `/inter-depots/${T.transferNumber}`, { vehiclePlate: '1234 tun 567' });
ok(patched.status === 200 && patched.data.vehiclePlate === '1234 TUN 567', 'immatriculation modifiable tant que « En attente »', show(patched));

console.log('\n=== 3. Colis proposés pour cette destination ===');
const cand = await api(agent, 'GET', `/inter-depots/${T.transferNumber}/candidates`);
ok(cand.status === 200, 'candidats → 200', show(cand));
const candIds = (cand.data ?? []).map((c) => c.id);
ok(candIds.includes(P2.id) && candIds.includes(P1.id), 'colis pour Sfax proposés');
ok(!candIds.includes(PSO.id), 'colis pour Sousse non proposé');

console.log('\n=== 4. Chargement au scan ===');
const scan = (t, code, mode = 'add', tok = agent) => api(tok, 'POST', `/inter-depots/${t}/scan`, { code, mode });
let r = await scan(T.transferNumber, PSO.barcode);
ok(r.status === 409 && /destiné à l'agence Agence Sousse/.test(r.msg), 'colis pour Sousse refusé dans un bordereau Sfax', show(r));
r = await scan(T.transferNumber, '999999999999');
ok(r.status === 404, 'code inconnu → 404', show(r));
r = await scan(T.transferNumber, "x' OR 1=1 --");
ok(r.status === 400, 'code illisible → 400', show(r));
r = await scan(T.transferNumber, PCREE.barcode);
ok(r.status === 409 && /réceptionné/.test(r.msg), 'colis pas encore réceptionné au dépôt → 409', show(r));
r = await scan(T.transferNumber, P2.barcode);
ok(r.status === 200 && r.data.totalPackages === 1 && r.data.totalPieces === 2, 'colis 2 pièces ajouté (1 colis / 2 pièces)', show(r));
let c2 = await colis(P2.id);
ok(c2.status === 'EN_TRANSIT_INTER_DEPOT' && c2.currentDepositId == null, 'le colis quitte le stock du hub (en route)');
r = await scan(T.transferNumber, P2.barcode);
ok(r.status === 409 && /déjà dans ce bordereau/.test(r.msg), 'double scan → 409', show(r));
r = await scan(T.transferNumber, P1.trackingNumber);
ok(r.status === 200 && r.data.totalPackages === 2, 'ajout par numéro de suivi', show(r));
r = await scan(T.transferNumber, P1.barcode, 'remove');
ok(r.status === 200 && r.data.totalPackages === 1, 'interrupteur « Retirer » : colis retiré', show(r));
const c1 = await colis(P1.id);
ok(c1.status === 'RECU_DEPOT' && c1.currentDepositId === HUB.id, 'colis retiré remis en stock au hub');
r = await scan(T.transferNumber, P1.barcode, 'remove');
ok(r.status === 409, 'retirer un colis absent du bordereau → 409', show(r));
const T2 = (await api(agent, 'POST', '/inter-depots', baseHdr)).data;
r = await scan(T2.transferNumber, P2.barcode);
ok(r.status === 409 && /déjà chargé/.test(r.msg), 'colis déjà dans un autre bordereau → 409', show(r));
r = await scan(T.transferNumber, P1.barcode);
ok(r.status === 200, 'colis rajouté');
const [s1, s2] = await Promise.all([scan(T2.transferNumber, PSO.barcode), scan(T2.transferNumber, PSO.barcode)]);
ok(s1.status === 409 && s2.status === 409, 'scans simultanés refusés de façon identique (garde destination)');

console.log('\n=== 5. Visibilité ===');
ok((await api(exp, 'GET', `/inter-depots/${T.transferNumber}`)).status === 403, 'expéditeur → 403');
ok((await api(livreur, 'GET', `/inter-depots/${T.transferNumber}`)).status === 404 || DRIVER.driverCode === 'LIV-BEN-001', 'livreur non transporteur ne voit pas le bordereau');

console.log('\n=== 6. Acceptation à Sfax, pièce par pièce ===');
const accept = (code, type = 'LIVRAISON', tok = admin, depositId = SFAX.id) =>
  api(tok, 'POST', '/inter-depots/acceptance/scan', { code, type, depositId });
const board = await api(admin, 'GET', `/inter-depots/acceptance?type=LIVRAISON&depositId=${SFAX.id}`);
ok(board.status === 200 && board.data.expectedCount === 2, 'Sfax attend 2 colis', show(board));
r = await accept(`${P2.barcode}-1`, 'LIVRAISON', agent, undefined);
ok(r.status === 409 && /voyage vers Agence Sfax/.test(r.msg), "le hub ne peut pas accepter ce qui va à Sfax", show(r));
r = await accept(P2.barcode);
ok(r.status === 409 && /scannez l'étiquette de chaque pièce/.test(r.msg), 'colis multi-pièces : étiquette de pièce exigée', show(r));
r = await accept(`${P2.barcode}-3`);
ok(r.status === 400, 'pièce inexistante (3/2) → 400', show(r));
r = await accept(`${P2.barcode}-1`, 'RETOUR');
ok(r.status === 409 && /Acceptation inter dépôt/.test(r.msg), 'mauvais écran (retours) → 409', show(r));
r = await accept(`${P2.barcode}-1`);
ok(r.status === 200 && r.data.receivedPieces === 1 && !r.data.packageComplete, 'pièce 1/2 reçue — colis partiellement reçu', show(r));
ok(r.data.transferStatus === 'RECU_PARTIEL', 'bordereau « Partiellement reçu »');
r = await accept(`${P2.barcode}-1`);
ok(r.status === 409 && /déjà reçue/.test(r.msg), 'même pièce rescannée → 409', show(r));
ok((await scan(T.transferNumber, PCREE.barcode)).status === 409, 'plus aucun ajout une fois l’acceptation commencée');
ok((await api(agent, 'POST', `/inter-depots/${T.transferNumber}/cancel`)).status === 409, 'annulation impossible après acceptation');
ok((await api(agent, 'PATCH', `/inter-depots/${T.transferNumber}`, { vehiclePlate: '1 TUN 1' })).status === 409, 'en-tête figé après acceptation');
let b2 = await api(admin, 'GET', `/inter-depots/acceptance?type=LIVRAISON&depositId=${SFAX.id}`);
ok(b2.data.partialCount === 1, 'compteur « partiellement reçus » = 1', JSON.stringify({ r: b2.data.receivedCount, p: b2.data.partialCount }));
r = await accept(P1.barcode);
ok(r.status === 200 && r.data.packageComplete, 'colis 1 pièce reçu par son code', show(r));
const [a1, a2] = await Promise.all([accept(`${P2.barcode}-2`), accept(`${P2.barcode}-2`)]);
const codes = [a1.status, a2.status].sort();
ok(codes[0] === 200 && codes[1] === 409, 'scans simultanés de la même pièce : un seul compte', `codes ${codes}`);
const fin = (a1.status === 200 ? a1 : a2).data;
ok(fin.transferStatus === 'RECU', 'dernière pièce → bordereau « Reçu »');
c2 = await colis(P2.id);
ok(c2.status === 'RECU_DEPOT_DESTINATION' && c2.currentDepositId === SFAX.id, 'colis arrivé à l’agence qui livre');
b2 = await api(admin, 'GET', `/inter-depots/acceptance?type=LIVRAISON&depositId=${SFAX.id}`);
ok(b2.data.receivedCount >= 2 && b2.data.expectedCount === 0, 'compteurs à jour : 2 reçus, plus rien attendu');
const detail = await api(admin, 'GET', `/inter-depots/${T.transferNumber}`);
ok(detail.data.items.every((i) => i.receptionState === 'RECU') && detail.data.receivedPieces === 3, 'bordereau : 2 colis / 3 pièces reçus');

console.log('\n=== 7. Listes et compteurs ===');
const listHub = await api(admin, 'GET', `/inter-depots?type=LIVRAISON&depositId=${HUB.id}`);
ok(listHub.status === 200 && listHub.json.meta.stats.sentReceived >= 1, 'hub : « envoyés reçus » ≥ 1', JSON.stringify(listHub.json?.meta?.stats));
ok(listHub.data.find((t) => t.transferNumber === T.transferNumber)?.direction === 'ENVOI', 'type Envoi côté hub');
const listSfax = await api(admin, 'GET', `/inter-depots?type=LIVRAISON&depositId=${SFAX.id}`);
ok(listSfax.json.meta.stats.received >= 1 && listSfax.data.find((t) => t.transferNumber === T.transferNumber)?.direction === 'RECEPTION', 'Sfax : reçu, type Réception');
ok((await api(admin, 'GET', '/inter-depots?start=2026-13-01')).status === 400, 'date de filtre invalide → 400');
const agentList = await api(agent, 'GET', '/inter-depots');
ok(agentList.status === 200 && agentList.data.every((t) => t.sourceDepositId === HUB.id || t.destinationDepositId === HUB.id), 'agent : uniquement les bordereaux de son dépôt');

console.log('\n=== 8. Annulation ===');
const PX = await newPackage(exp, { governorate: 'Tunis', delegation: 'Tunis' });
await receiveAtHub(PX);
const T3 = (await api(agent, 'POST', '/inter-depots', { ...baseHdr, destinationDepositId: TUNIS.id })).data;
ok((await scan(T3.transferNumber, PX.barcode)).status === 200, 'colis pour Tunis chargé');
r = await api(agent, 'POST', `/inter-depots/${T3.transferNumber}/cancel`);
ok(r.status === 200 && r.data.status === 'ANNULE', 'bordereau annulé', show(r));
const cx = await colis(PX.id);
ok(cx.status === 'RECU_DEPOT' && cx.currentDepositId === HUB.id, 'colis remis en stock au hub');
ok((await api(agent, 'POST', `/inter-depots/${T3.transferNumber}/cancel`)).status === 409, 'double annulation → 409');

console.log('\n=== 9. Inter-dépôt retours et échanges ===');
const ts = (await api(admin, 'GET', '/shippers?status=actif&limit=50')).data.find((s) => s.code === 'EXP-TECHSTORE');
const PR = (await api(admin, 'POST', '/colis', { customerName: 'Retour Client', customerPhone: '98123000', address: 'Rue R', governorate: 'Ben Arous', totalPrice: 30, shipperId: ts.id })).data;
ok((await colis(PR.id)).originDepositId === SOUSSE.id, "colis TechStore rattaché à l'agence de l'expéditeur (Sousse)");
await receiveAtHub(PR);
await api(admin, 'POST', `/colis/${PR.id}/assign`, { driverId: HAMZA_ID });
r = await api(livreur, 'POST', `/colis/${PR.id}/return`, { reason: 'Refus client', returnedContent: 'Colis complet' });
const cr = await colis(PR.id);
ok(cr.status === 'RETOUR_DEPOT', 'colis en retour au dépôt', `${show(r)} / ${cr.status}`);
if (cr.currentDepositId !== HUB.id) console.log('   (dépôt courant du retour :', cr.currentDepositId, ')');
const TR = await api(agent, 'POST', '/inter-depots', { type: 'RETOUR', destinationDepositId: SOUSSE.id, transporterDriverId: DRIVER.id });
ok(TR.status === 201 && /^ID-R-/.test(TR.data.transferNumber), 'bordereau retours ID-R- créé', show(TR));
const TRS = (await api(agent, 'POST', '/inter-depots', { type: 'RETOUR', destinationDepositId: SFAX.id, transporterDriverId: DRIVER.id })).data;
r = await scan(TRS.transferNumber, PR.barcode);
ok(r.status === 409 && /appartient à l'agence Agence Sousse/.test(r.msg), 'retour Sousse refusé dans un bordereau retours vers Sfax', show(r));
r = await scan(TR.data.transferNumber, PX.barcode);
ok(r.status === 409 && /n'est pas un retour/.test(r.msg), 'colis de livraison refusé en inter-dépôt retours', show(r));
const rc = await api(agent, 'GET', `/inter-depots/${TR.data.transferNumber}/candidates`);
ok((rc.data ?? []).some((c) => c.id === PR.id), 'retour proposé pour l’agence de son expéditeur');
r = await scan(TR.data.transferNumber, PR.barcode);
ok(r.status === 200, 'retour chargé', show(r));
r = await scan(T2.transferNumber, PX.barcode);
r = await accept(PR.barcode, 'LIVRAISON', admin, SOUSSE.id);
ok(r.status === 409, 'retour accepté dans le mauvais écran → 409', show(r));
r = await accept(PR.barcode, 'RETOUR', admin, SOUSSE.id);
ok(r.status === 200 && r.data.transferStatus === 'RECU', 'retour accepté à Sousse, bordereau reçu', show(r));
const crr = await colis(PR.id);
ok(crr.status === 'RETOUR_DEPOT' && crr.currentDepositId === SOUSSE.id, "retour en stock à l'agence de l'expéditeur");

console.log('\n=== 10. Ancien cycle et identifiants hostiles ===');
for (const step of ['prepare', 'dispatch', 'receive']) {
  ok((await api(agent, 'POST', `/inter-depots/${T2.transferNumber}/${step}`, {})).status === 410, `/${step} → 410 (remplacé par le scan)`);
}
ok((await api(admin, 'GET', '/inter-depots/ID-INCONNU')).status === 404, 'bordereau inconnu → 404');
ok((await api(admin, 'POST', '/inter-depots/ID-INCONNU/scan', { code: P1.barcode })).status === 404, 'scan sur bordereau inconnu → 404');
ok((await api(admin, 'POST', '/inter-depots/acceptance/scan', { code: '' })).status === 400, 'acceptation sans code → 400');

console.log(`\nRESULT: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(` - ${f}`); process.exit(1); }
