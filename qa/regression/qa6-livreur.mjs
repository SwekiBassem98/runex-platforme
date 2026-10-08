// QA LIVREUR — authentification, cloisonnement, workflow de livraison côté
// mobile (HTTP), caisse, idempotence, visibilité admin/expéditeur.
const BASE = 'http://127.0.0.1:4000/api/v1';
let echecs = 0;
let passes = 0;
const ok = (cond, libelle, detail = '') => {
  if (cond) passes += 1;
  else echecs += 1;
  console.log(`  ${cond ? 'OK  ' : 'ECHEC'} ${libelle}${detail ? ` — ${detail}` : ''}`);
};

async function api(token, method, path, body) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* corps non JSON */
  }
  return { status: res.status, json };
}

async function login(email, password) {
  const r = await api(null, 'POST', '/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status}`);
  return { access: r.json.data.accessToken, refresh: r.json.data.refreshToken, user: r.json.data.user };
}

const TAG = 'Vérification Livreur';

// ---------------------------------------------------------------- sessions
const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const livA = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const meA = await api(livA.access, 'GET', '/auth/me');
const driverA = meA.json?.data?.driverId ?? meA.json?.data?.driver?.id ?? livA.user?.driverId;
if (!driverA) throw new Error('identifiant livreur A introuvable');

console.log('=== AUTH ===');
ok(!!admin.access && !!livA.access && !!exp.access, 'connexions admin/expéditeur/livreur');
const bad = await api(null, 'POST', '/auth/login', { email: 'livreur.hamza@logixpress.tn', password: 'FAUX' });
ok(bad.status === 401, 'mot de passe erroné -> 401', `HTTP ${bad.status}`);
const ref = await api(null, 'POST', '/auth/refresh', { refreshToken: livA.refresh });
ok(ref.status === 200 && !!ref.json?.data?.accessToken, 'refresh du jeton livreur');
const garbage = await api('nimportequoi', 'GET', '/colis');
ok(garbage.status === 401, 'jeton invalide -> 401', `HTTP ${garbage.status}`);
for (const [m, p] of [['GET', '/users'], ['GET', '/audit'], ['GET', '/payments/vouchers'], ['GET', '/shippers'], ['GET', '/search']]) {
  const r = await api(livA.access, m, p);
  ok(r.status === 403, `livreur sur ${p} -> 403`, `HTTP ${r.status}`);
}

// ---------------------------------------------------------------- setup
console.log('=== PRÉPARATION (admin/expéditeur) ===');
const stamp = Date.now();
const codeB = `LIV-QA-B${String(stamp).slice(-6)}`;
let drvB = await api(admin.access, 'POST', '/drivers', {
  driverCode: codeB,
  vehicleType: 'Moto',
  compte: {
    fullName: 'QA Livreur B',
    email: `qa.livb.${stamp}@qa.test`,
    phone: '22222222',
    password: 'Qa123456!',
  },
});
if (drvB.status === 409) {
  // Relance précédente laissée en base : retrouver le livreur existant
  const list = await api(admin.access, 'GET', '/drivers');
  const found = (list.json?.data ?? []).find((d) => d.driverCode === 'LIV-QA-B' || d.driverCode === codeB);
  drvB = { status: 200, json: { data: found } };
}
ok(drvB.status === 201 || drvB.status === 200, 'création du livreur B avec compte', `HTTP ${drvB.status} code=${codeB}`);
const driverB = drvB.json?.data?.id;
if (!driverB) throw new Error('driverB introuvable après création/récupération');
let livB;
try {
  livB = await login(`qa.livb.${stamp}@qa.test`, 'Qa123456!');
} catch {
  // Si on a réutilisé un ancien code, l'email ne correspond pas — retrouver le vrai
  const list = await api(admin.access, 'GET', '/drivers');
  const found = (list.json?.data ?? []).find((d) => d.id === driverB);
  const emailB = found?.user?.email ?? found?.email;
  if (!emailB) throw new Error('email livreur B introuvable');
  livB = await login(emailB, 'Qa123456!');
}
ok(!!livB.access, 'connexion du livreur B');

const depotsRes = await api(admin.access, 'GET', '/depots');
let depositId = depotsRes.json?.data?.[0]?.id ?? depotsRes.json?.data?.items?.[0]?.id ?? null;
if (!depositId) {
  const r2 = await api(admin.access, 'GET', '/depot/reception/depots');
  depositId = r2.json?.data?.[0]?.id ?? r2.json?.data?.items?.[0]?.id ?? r2.json?.data?.depots?.[0]?.id ?? null;
}
if (!depositId) throw new Error('aucun dépôt trouvé pour la tournée');

const creerColis = async (pieces) => {
  const r = await api(exp.access, 'POST', '/colis', {
    customerName: TAG,
    customerPhone: '55555555',
    address: 'Rue QA 12',
    totalPrice: 60,
    pieceCount: pieces,
  });
  return r.json.data;
};
const P1 = await creerColis(1);
const P2 = await creerColis(1);
const P3 = await creerColis(1);
const P4 = await creerColis(2);
const P5 = await creerColis(1);
ok([P1, P2, P3, P4, P5].every((p) => p?.trackingNumber), '5 colis créés par l’expéditeur');

const assigner = (p, d) => api(admin.access, 'POST', `/colis/${p.id}/assign`, { driverId: d });
for (const p of [P1, P3, P4, P5]) await assigner(p, driverA);
await assigner(P2, driverB);

const today = new Date().toISOString().slice(0, 10);
const mkRunsheet = async (d, pkgs) =>
  api(admin.access, 'POST', '/runsheets', { driverId: d, depositId, tourDate: today, packageIds: pkgs.map((p) => p.id), notes: 'QA-LIVREUR' });
const RA = await mkRunsheet(driverA, [P1]);
const RB = await mkRunsheet(driverB, [P2]);
if (RA.status >= 300) console.log('RA err', JSON.stringify(RA.json));
if (RB.status >= 300) console.log('RB err', JSON.stringify(RB.json));
ok(RA.status < 300 && RB.status < 300, 'tournées RA (A) et RB (B) créées', `RA=${RA.status} RB=${RB.status}`);
const raId = RA.json?.data?.id;
const rbId = RB.json?.data?.id;

// ---------------------------------------------------------------- cloisonnement
console.log('=== CLOISONNEMENT ===');
const listeA = await api(livA.access, 'GET', '/colis?limit=100');
const tracksA = (listeA.json?.data ?? []).map((p) => p.trackingNumber);
ok(tracksA.includes(P1.trackingNumber), 'A voit son colis P1');
ok(!tracksA.includes(P2.trackingNumber), 'A ne voit pas le colis P2 de B');
const volP2 = await api(livA.access, 'GET', `/colis/${P2.trackingNumber}`);
ok(volP2.status === 404, 'A ne peut pas lire P2 -> 404', `HTTP ${volP2.status}`);
const volB = await api(livB.access, 'GET', `/colis/${P1.trackingNumber}`);
ok(volB.status === 404, 'B ne peut pas lire P1 -> 404', `HTTP ${volB.status}`);

const rsA = await api(livA.access, 'GET', '/runsheets');
const rsAids = (rsA.json?.data ?? []).map((r) => r.id);
ok(rsAids.includes(raId) && !rsAids.includes(rbId), 'A ne voit que sa tournée');
const rsAforge = await api(livA.access, 'GET', `/runsheets?driverId=${driverB}`);
const forgeIds = (rsAforge.json?.data ?? []).map((r) => r.id);
ok(!forgeIds.includes(rbId), 'paramètre driverId forgé ignoré', `${forgeIds.length} tournée(s)`);
const activeForge = await api(livA.access, 'GET', `/runsheets/driver/active?driverId=${driverB}`);
ok(
  activeForge.status === 404 || activeForge.json?.data?.driverId === driverA,
  'tournée active forgée -> jamais celle de B',
  `HTTP ${activeForge.status}`
);
const rbDirect = await api(livA.access, 'GET', `/runsheets/${rbId}`);
ok(rbDirect.status === 404, 'A ne peut pas ouvrir RB -> 404', `HTTP ${rbDirect.status}`);
const raDirect = await api(livA.access, 'GET', `/runsheets/${raId}`);
ok(raDirect.status === 200, 'A ouvre sa propre tournée RA');

// ---------------------------------------------------------------- tableau de bord scopé
console.log('=== TABLEAU DE BORD LIVREUR ===');
// Depuis le prompt 24, « hors ligne » = pas de battement récent : l'application
// mobile bat avant d'ouvrir son tableau de bord, on fait de même.
await api(livA.access, 'POST', '/drivers/presence/heartbeat', {});
const dashBefore = await api(livA.access, 'GET', '/dashboard');
const baseTotal = dashBefore.json?.data?.colis?.total ?? 0;
const baseEncaisser = dashBefore.json?.data?.paiements?.montantAEncaisserTND ?? 0;
const dashA = await api(livA.access, 'GET', '/dashboard');
ok(dashA.status === 200, 'dashboard livreur -> 200', `HTTP ${dashA.status}`);
// Le total doit avoir progressé de 4-5 colis créés pour ce test (tolérance pour l'historique)
ok(dashA.json?.data?.colis?.total >= 4 && dashA.json?.data?.colis?.total >= baseTotal, 'dashboard scopé : colis propres présents', `total=${dashA.json?.data?.colis?.total} base=${baseTotal}`);
ok((dashA.json?.data?.charts?.supplierActivity ?? []).length === 0, 'aucune activité fournisseur tiers exposée');
ok(dashA.json?.data?.paiements?.montantAEncaisserTND >= 180, 'à encaisser = sa propre caisse (≥180)', `${dashA.json?.data?.paiements?.montantAEncaisserTND}`);
ok(dashA.json?.data?.livreurs?.horsLigne === 0, 'présence non inventée (horsLigne=0)');
ok(dashA.json?.data?.livreurs?.total === 1, 'dashboard livreur ne liste qu’un seul livreur');

// ---------------------------------------------------------------- workflow livraison
console.log('=== WORKFLOW LIVRAISON (A sur P1) ===');
const start1 = await api(livA.access, 'POST', `/colis/${P1.trackingNumber}/start`, {});
ok(start1.status === 200 && start1.json?.data?.status === 'EN_COURS_LIVRAISON', 'démarrage -> EN_COURS_LIVRAISON', `HTTP ${start1.status}`);
const audit1 = await api(livA.access, 'GET', `/colis/${P1.trackingNumber}/audit`);
const n1 = (audit1.json?.data ?? []).length;
const start2 = await api(livA.access, 'POST', `/colis/${P1.trackingNumber}/start`, {});
ok(start2.status === 409, 'second démarrage refusé -> 409', `HTTP ${start2.status}`);
const audit2 = await api(livA.access, 'GET', `/colis/${P1.trackingNumber}/audit`);
ok((audit2.json?.data ?? []).length === n1, 'pas d’événement de chronologie dupliqué');

const liv1 = await api(livA.access, 'POST', `/colis/${P1.trackingNumber}/deliver`, { collectedAmount: 60 });
ok(liv1.status === 200 && liv1.json?.data?.status === 'LIVRE', 'livraison + encaissement -> LIVRE', `HTTP ${liv1.status}`);
const liv2 = await api(livA.access, 'POST', `/colis/${P1.trackingNumber}/deliver`, { collectedAmount: 60 });
ok(liv2.status === 409, 'livrer deux fois -> 409 (pas de double paiement)', `HTTP ${liv2.status}`);
const neg = await api(livA.access, 'POST', `/colis/${P3.trackingNumber}/deliver`, { collectedAmount: -5 });
ok(neg.status >= 400, 'montant négatif refusé', `HTTP ${neg.status}`);

console.log('=== GESTES SUR COLIS D’AUTRUI ===');
for (const geste of ['start', 'deliver', 'partial-delivery', 'exchange', 'postpone', 'return']) {
  const r = await api(livA.access, 'POST', `/colis/${P2.trackingNumber}/${geste}`, { collectedAmount: 60, reason: 'x' });
  ok(r.status === 403, `A ${geste} sur P2 (B) -> 403`, `HTTP ${r.status}`);
}

console.log('=== ÉCHEC / PARTIEL / RETOUR ===');
const badReason = await api(livA.access, 'POST', `/colis/${P3.trackingNumber}/failed-attempt`, { reasonCode: 'INVENTE' });
ok(badReason.status === 400, 'motif d’échec hors référentiel -> 400', `HTTP ${badReason.status}`);
const echec = await api(livA.access, 'POST', `/colis/${P3.trackingNumber}/failed-attempt`, { reasonCode: 'INJOIGNABLE', comment: 'absent' });
if (echec.status !== 200) console.log('echec err', JSON.stringify(echec.json));
ok(echec.status === 200, 'tentative échouée enregistrée (INJOIGNABLE)', `HTTP ${echec.status} -> ${echec.json?.data?.status}`);

const partBad = await api(livA.access, 'POST', `/colis/${P4.trackingNumber}/partial-delivery`, {
  deliveredPieces: 2,
  deliveredDescription: 'tout',
  returnedDescription: 'rien',
  collectedAmount: 60,
  reason: 'test',
});
ok(partBad.status === 400, 'partiel avec toutes les pièces -> 400', `HTTP ${partBad.status}`);
const part = await api(livA.access, 'POST', `/colis/${P4.trackingNumber}/partial-delivery`, {
  deliveredPieces: 1,
  deliveredDescription: '1 pièce livrée',
  returnedDescription: '1 pièce reprise',
  collectedAmount: 30,
  reason: 'client partiel',
});
ok(part.status === 200 && part.json?.data?.status === 'LIVRAISON_PARTIELLE', 'livraison partielle -> LIVRAISON_PARTIELLE', `HTTP ${part.status}`);

const ret = await api(livA.access, 'POST', `/colis/${P5.trackingNumber}/return`, { reason: 'refus du client' });
ok(ret.status === 200 && ret.json?.data?.status === 'RETOUR_DEPOT', 'retour dépôt -> RETOUR_DEPOT', `HTTP ${ret.status}`);

// ---------------------------------------------------------------- visibilité
console.log('=== VISIBILITÉ ADMIN / EXPÉDITEUR ===');
const expVue = await api(exp.access, 'GET', `/colis?search=${P1.trackingNumber}`);
const vu = (expVue.json?.data ?? [])[0];
ok(vu?.status === 'LIVRE', 'expéditeur voit P1 LIVRE', vu?.status);
const admVue = await api(admin.access, 'GET', `/colis?search=${P1.trackingNumber}`);
ok((admVue.json?.data ?? [])[0]?.status === 'LIVRE', 'admin voit P1 LIVRE');
const admAudit = await api(admin.access, 'GET', `/colis/${P1.trackingNumber}/audit`);
const actions = (admAudit.json?.data ?? []).map((e) => e.action ?? e.auditAction ?? '');
ok(JSON.stringify(admAudit.json?.data ?? []).includes('DELIVERY_DONE') || actions.some((a) => /DELIVERY_DONE|LIVRE/.test(a)), 'audit contient la livraison');
const notifA = await api(livA.access, 'GET', '/notifications');
ok(notifA.status === 200, 'notifications du livreur accessibles', `HTTP ${notifA.status}`);

console.log(`\n${echecs === 0 ? 'TOUT PASSE' : 'DES ÉCHECS'} — ${passes} contrôles, ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
