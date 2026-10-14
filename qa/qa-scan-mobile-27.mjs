#!/usr/bin/env node
/**
 * QA — scan d'un colis par l'application mobile (contrat `GET|POST /scan`).
 *
 * Le livreur scanne le QR / code-barres du bon de livraison :
 *  - code-barres, numéro, étiquette de pièce, lien, espaces → même colis ;
 *  - colis de sa tournée → DELIVERY + actions (démarrer, livrer…) exécutables ;
 *  - colis à ramasser chez l'expéditeur de son ramassage → PICKUP + ajout / retrait ;
 *  - tout autre colis → 403 NOT_ASSIGNED, sans rien révéler ;
 *  - illisible / clé fausse → 400 INVALID_CODE ; inconnu → 404 UNKNOWN_CODE ;
 *    pièce au-delà du nombre de pièces → 409 PIECE_NOT_FOUND.
 * Les autres profils : expéditeur (les siens seulement), agent (son dépôt), admin.
 * Les écrans existants acceptent aussi l'étiquette de pièce (fiche colis,
 * tournée, réception, ramassage).
 *
 *   QA_API_URL=http://localhost:4000/api/v1 node qa/qa-scan-mobile-27.mjs   (base seedée)
 */
const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
let pass = 0;
const failures = [];
const ok = (c, l, d = '') => {
  if (c) { pass++; console.log(`  ✔ ${l}`); } else { failures.push(l); console.log(`  ✘ ${l}${d ? ` — ${d}` : ''}`); }
  return c;
};
async function api(token, method, path, body) {
  const h = { Accept: 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${API}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* vide */ }
  return { status: r.status, data: j?.data, json: j };
}
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { email: e, password: p })).data.accessToken;
const enc = encodeURIComponent;

const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const ghassen = await login('livreur.ghassan@logixpress.tn', 'Liv123!');
const agent = await login('agent.magasin@logixpress.tn', 'Agent123!');
const meH = (await api(hamza, 'GET', '/auth/me')).data;
const hamzaId = meH.driverId ?? meH.driver?.id;
ok(Boolean(hamzaId), 'jeton livreur : driverId présent (/auth/me)');

const nouveau = async (n, pieces = 2) => (await api(exp, 'POST', '/colis', {
  customerName: `Scan ${n}`, customerPhone: `9855${1000 + n}`, governorate: 'Ben Arous', delegation: 'Mohamadia',
  address: `Rue scan ${n}`, totalPrice: 30 + n, pieceCount: pieces, contentSummary: `contenu ${n}`,
})).data;

console.log('\n1. Livreur — colis de sa tournée');
const A = await nouveau(1, 2);
const assign = await api(admin, 'POST', `/colis/${A.id}/assign`, { driverId: hamzaId });
ok(assign.status === 200, 'colis affecté au livreur', String(assign.status));
const codes = [A.barcode, A.trackingNumber, `${A.barcode}-1`, `${A.barcode}-2`, ` ${A.barcode} `, `https://suivi.runex.tn/t/${A.barcode}-2?src=qr`];
for (const c of codes) {
  const r = await api(hamza, 'POST', '/scan', { code: c });
  ok(r.status === 200 && r.data.package.id === A.id && r.data.relation === 'DELIVERY', `scan « ${c.trim()} » → colis, DELIVERY`, `${r.status} ${r.json?.code ?? ''}`);
}
let r = await api(hamza, 'GET', `/scan/${enc(`${A.barcode}-2`)}`);
ok(r.status === 200 && r.data.kind === 'piece' && r.data.piece?.number === 2 && r.data.piece?.count === 2, 'GET /scan/:code — pièce 2/2');
const d = r.data.package;
ok(d.trackingNumber === A.trackingNumber && d.customerName === 'Scan 1' && d.customerPhone && d.address && d.totalPrice === 31
  && d.status && Array.isArray(d.trackingTimeline), 'fiche complète : destinataire, montant, statut, chronologie');
const keys = r.data.actions.map((a) => a.key);
ok(['start', 'deliver', 'postpone', 'failed-attempt', 'return'].every((k) => keys.includes(k)), 'actions proposées selon le statut', keys.join(','));
ok(r.data.actions.every((a) => a.method === 'POST' && a.path.startsWith(`/colis/${A.trackingNumber}/`)), 'chaque action donne méthode et chemin');
ok(Array.isArray(r.data.nextStatuses) && r.data.nextStatuses.includes('LIVRE'), 'nextStatuses');
const start = r.data.actions.find((a) => a.key === 'start');
const st = await api(hamza, start.method, start.path, {});
ok(st.status === 200 && st.data.status === 'EN_COURS_LIVRAISON', 'action « Démarrer » exécutée telle que fournie', `${st.status} ${st.json?.message ?? ''}`);
r = await api(hamza, 'POST', '/scan', { code: A.barcode });
ok(!r.data.actions.some((a) => a.key === 'start') && r.data.actions.some((a) => a.key === 'deliver'), 'après démarrage : plus de « Démarrer », « Livré » proposé');
ok((await api(hamza, 'GET', `/colis/${enc(`${A.barcode}-1`)}`)).data?.id === A.id, 'GET /colis/<étiquette de pièce> accepté');

console.log('\n2. Refus');
r = await api(ghassen, 'POST', '/scan', { code: A.barcode });
ok(r.status === 403 && r.json.code === 'NOT_ASSIGNED' && !r.json.data && !JSON.stringify(r.json).includes('Scan 1'), 'autre livreur → 403 NOT_ASSIGNED, rien révélé');
r = await api(hamza, 'POST', '/scan', { code: 'abc$%' });
ok(r.status === 400 && r.json.code === 'INVALID_CODE', 'illisible → 400 INVALID_CODE');
const fauxCle = A.barcode.slice(0, 14) + String((Number(A.barcode[14]) + 1) % 10);
r = await api(hamza, 'POST', '/scan', { code: fauxCle });
ok(r.status === 400 && r.json.code === 'INVALID_CODE', 'clé de contrôle fausse → 400 INVALID_CODE');
r = await api(hamza, 'POST', '/scan', { code: '26010199999999' });
ok(r.status === 404 && r.json.code === 'UNKNOWN_CODE', 'numéro bien formé inconnu → 404 UNKNOWN_CODE');
r = await api(hamza, 'POST', '/scan', { code: `${A.barcode}-9` });
ok(r.status === 409 && r.json.code === 'PIECE_NOT_FOUND', 'pièce 9 d’un colis à 2 pièces → 409 PIECE_NOT_FOUND');
r = await api(hamza, 'POST', '/scan', {});
ok(r.status === 400 && r.json.code === 'INVALID_CODE', 'corps vide → 400');
ok((await api(null, 'POST', '/scan', { code: A.barcode })).status === 401, 'sans jeton → 401');

console.log('\n3. Livreur — ramassage chez l’expéditeur');
const B = await nouveau(2, 1);
r = await api(hamza, 'POST', '/scan', { code: B.barcode });
ok(r.status === 403 && r.json.code === 'NOT_ASSIGNED', 'sans ramassage ouvert → NOT_ASSIGNED');
const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const pk = await api(admin, 'POST', '/ramassages', {
  shipperId: B.shipperId, scheduledDate: demain, timeSlotStartHour: 9, timeSlotEndHour: 11, assignedDriverId: hamzaId,
  address: 'Zone industrielle, Ben Arous', estimatedPackageCount: 3,
});
ok(pk.status === 201 || pk.status === 200, 'ramassage organisé et affecté au livreur', `${pk.status} ${pk.json?.message ?? ''}`);
const ref = pk.data?.referenceNumber;
r = await api(hamza, 'POST', '/scan', { code: B.barcode });
ok(r.status === 200 && r.data.relation === 'PICKUP' && r.data.pickup?.referenceNumber === ref && r.data.pickup.attached === false, 'scan chez l’expéditeur → PICKUP, à rattacher');
const attach = r.data.actions?.[0];
ok(attach?.key === 'pickup-attach' && attach.method === 'PATCH' && attach.path === `/ramassages/${ref}/packages`, 'action « Ajouter au ramassage »');
const at = await api(hamza, attach.method, attach.path, attach.body);
ok(at.status === 200 && at.data.actualPickedCount === 1, 'rattachement exécuté tel que fourni', `${at.status} ${at.json?.message ?? ''}`);
r = await api(hamza, 'POST', '/scan', { code: B.trackingNumber });
ok(r.data.pickup?.attached === true && r.data.actions[0].key === 'pickup-detach', 'rescan → déjà rattaché, action « Retirer »');
r = await api(ghassen, 'POST', '/scan', { code: B.barcode });
ok(r.status === 403 && r.json.code === 'NOT_ASSIGNED', 'autre livreur → NOT_ASSIGNED');
const C = await nouveau(3, 2);
const at2 = await api(hamza, 'PATCH', `/ramassages/${ref}/packages`, { attach: [`${C.barcode}-2`] });
ok(at2.status === 200 && at2.data.actualPickedCount === 2, 'ramassage : rattachement direct par code scanné (étiquette de pièce)', `${at2.status} ${at2.json?.message ?? ''}`);
ok((await api(hamza, 'PATCH', `/ramassages/${ref}/packages`, { attach: ['999'] })).status === 400, 'ramassage : code illisible → 400');
ok((await api(hamza, 'PATCH', `/ramassages/${ref}/packages`, { attach: ['26010199999999'] })).status === 404, 'ramassage : code inconnu → 404');

console.log('\n4. Autres profils');
r = await api(exp, 'POST', '/scan', { code: `${A.barcode}-1` });
ok(r.status === 200 && r.data.relation === 'SHIPPER' && r.data.actions.length === 0, 'expéditeur : son colis, sans action terrain');
const tous = (await api(admin, 'GET', '/colis?limit=100')).data;
const autre = tous.find((c) => c.shipperId !== A.shipperId);
r = await api(exp, 'POST', '/scan', { code: autre.barcode });
ok(r.status === 404 && r.json.code === 'UNKNOWN_CODE', 'expéditeur : colis d’un autre → inconnu (404)');
r = await api(agent, 'POST', '/scan', { code: C.barcode });
ok(r.status === 200 && r.data.relation === 'DEPOT', 'agent : colis de son dépôt → DEPOT', `${r.status} ${r.json?.code ?? ''}`);
r = await api(admin, 'POST', '/scan', { code: A.trackingNumber });
ok(r.status === 200 && r.data.relation === 'BACK_OFFICE', 'administration : BACK_OFFICE');

console.log('\n5. Étiquettes de pièce dans les écrans existants');
const lk = await api(admin, 'POST', '/depot/reception/lookup', { code: `${C.barcode}-1` });
ok(lk.status === 200 && lk.data?.kind !== 'malformed' && lk.data?.package?.trackingNumber === C.trackingNumber, 'réception : aperçu par étiquette de pièce', JSON.stringify(lk.data?.kind));

console.log('\n6. Application livreur : connexion et profil');
for (const id of ['50123456', '+216 50 123 456', 'LIV-BEN-001', 'liv-ben-001', '214 tun 4512', 'livreur.hamza@logixpress.tn']) {
  const r = await api(null, 'POST', '/auth/login', { identifier: id, password: 'Liv123!' });
  ok(r.status === 200 && r.data.user.driverId === hamzaId, `connexion livreur par « ${id} »`, String(r.status));
}
ok((await api(null, 'POST', '/auth/login', { identifier: '50123456', password: 'faux' })).status === 401, 'mauvais mot de passe → 401');
ok((await api(null, 'POST', '/auth/login', { identifier: '99999999', password: 'Liv123!' })).status === 401, 'téléphone inconnu → 401');
ok((await api(null, 'POST', '/auth/login', { email: 'admin@logixpress.tn', password: 'Admin123!' })).status === 200, 'champ « email » toujours accepté');
const me = await api(hamza, 'GET', '/drivers/me');
ok(me.status === 200 && me.data.driverCode === 'LIV-BEN-001' && me.data.licensePlate === '214 TUN 4512' && me.data.depositName, 'GET /drivers/me : fiche du livreur connecté');
ok((await api(admin, 'GET', '/drivers/me')).status === 403, 'GET /drivers/me réservé aux livreurs');
const done = await api(admin, 'PATCH', `/ramassages/${ref}/start`, {});
const fin = await api(hamza, 'PATCH', `/ramassages/${ref}/complete`, {});
ok(fin.status === 200 && fin.data.status === 'EFFECTUE', 'ramassage clôturé par le livreur', `${done.status} ${fin.status} ${fin.json?.message ?? ''}`);
const liste = (await api(hamza, 'GET', '/ramassages/driver/active')).data;
ok(liste.some((p) => p.referenceNumber === ref && p.status === 'EFFECTUE'), 'ramassages du livreur : effectués du jour inclus');

console.log(`\n${pass} vérifications réussies, ${failures.length} échec(s)`);
if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
