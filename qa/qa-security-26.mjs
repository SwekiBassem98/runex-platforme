#!/usr/bin/env node
/**
 * PROMPT 26 — Security & integrity regression suite.
 *
 * Runs against a live API on a DISPOSABLE, freshly seeded database.
 * It only uses the public HTTP API (no direct DB writes), creates its own
 * fixtures with a unique suffix, and can be run repeatedly.
 *
 *   QA_BASE_URL=http://127.0.0.1:4000/api/v1 node qa/qa-security-26.mjs
 *
 * Never point it at a production API: it creates users, shippers, runsheets
 * and moves packages through their lifecycle.
 */

const BASE = (process.env.QA_BASE_URL ?? 'http://127.0.0.1:4000/api/v1').replace(/\/+$/, '');
const ADMIN = { email: process.env.QA_ADMIN_EMAIL ?? 'admin@logixpress.tn', password: process.env.QA_ADMIN_PASSWORD ?? 'Admin123!' };
const GEST = { email: 'gestionnaire@logixpress.tn', password: 'Gest123!' };
const EXP_A = { email: 'expediteur@bluestar.tn', password: 'Exp123!' };
const LIV_A = { email: 'livreur.hamza@logixpress.tn', password: 'Liv123!' };
const LIV_B = { email: 'livreur.ghassan@logixpress.tn', password: 'Liv123!' };
const AGENT = { email: 'agent.magasin@logixpress.tn', password: 'Agent123!' };
const FINANCE = { email: 'finance@logixpress.tn', password: 'Fin123!' };
const PWD = 'Qa-Secure-26!';
const SUFFIX = Date.now().toString(36).toUpperCase();

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✔ ${label}`);
  } else {
    fail += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function api(token, method, path, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV or empty */ }
  return { status: res.status, json, text, headers: res.headers };
}
async function login(cred) {
  const r = await api(null, 'POST', '/auth/login', cred);
  if (r.status !== 200) throw new Error(`login ${cred.email} → ${r.status} ${r.text.slice(0, 200)}`);
  return r.json.data; // { accessToken, refreshToken, user }
}
const leaky = (msg) => /prisma|invalid `|\binvocation\b|at Object\.|\n\s+at |P20\d\d|stack|query engine|syntax error at/i.test(String(msg ?? ''));
const pkgStatus = async (token, id) => (await api(token, 'GET', `/colis/${id}`)).json?.data?.status;

async function main() {
  console.log(`Base: ${BASE} — suffix ${SUFFIX}`);
  const admin = await login(ADMIN);
  const gest = await login(GEST);
  const expA = await login(EXP_A);
  const livA = await login(LIV_A);
  const agent = await login(AGENT);
  const finance = await login(FINANCE);

  // ------------------------------------------------------------------
  section('Fixtures');
  const drivers = (await api(admin.accessToken, 'GET', '/drivers?limit=100')).json.data;
  const hamza = drivers.find((d) => d.driverCode === 'LIV-BEN-001');
  const ghassan = drivers.find((d) => d.driverCode === 'LIV-SOU-002');
  ok(hamza && ghassan, 'seed drivers found');
  const depots = (await api(admin.accessToken, 'GET', '/depots')).json.data;
  const hub = depots.find((d) => d.isMainHub);
  const sousse = depots.find((d) => d.code === 'DEP-SOUSSE-AGT');

  const shipperB = await api(admin.accessToken, 'POST', '/shippers', {
    code: `QA-B-${SUFFIX}`, companyName: `QA Shipper B ${SUFFIX}`, phone: '70000000',
    email: `qa-b-${SUFFIX.toLowerCase()}@example.tn`, governorate: 'Tunis', address: 'Rue QA',
  });
  ok(shipperB.status === 201, 'create shipper B', `HTTP ${shipperB.status} ${shipperB.text.slice(0, 120)}`);
  const expBEmail = `qa-expb-${SUFFIX.toLowerCase()}@example.tn`;
  const expBUser = await api(admin.accessToken, 'POST', '/users', {
    fullName: 'QA Expediteur B', email: expBEmail, phone: '70000001', password: PWD,
    role: 'EXPEDITEUR_USER', shipperId: shipperB.json?.data?.id,
  });
  ok(expBUser.status === 201, 'create expediteur B user', `HTTP ${expBUser.status} ${expBUser.text.slice(0, 120)}`);
  const expB = await login({ email: expBEmail, password: PWD });

  const newPkg = async (session, extra = {}) => {
    const r = await api(session.accessToken, 'POST', '/colis', {
      customerName: `Client ${SUFFIX}`, customerPhone: `9${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
      address: '12 rue des Tests', governorate: 'Tunis', delegation: 'Bab Bhar',
      totalPrice: 50, pieceCount: 2, contentSummary: 'QA', ...extra,
    });
    if (r.status !== 201) throw new Error(`create package → ${r.status} ${r.text.slice(0, 200)}`);
    return r.json.data;
  };
  const assign = async (pkg, driver) =>
    api(admin.accessToken, 'POST', `/colis/${pkg.id}/assign`, { driverId: driver.id });

  const pkgB = await newPkg(expB);
  const pkgA = await newPkg(expA);
  ok((await assign(pkgB, hamza)).status === 200, 'assign shipper-B package to Hamza');
  ok((await assign(pkgA, hamza)).status === 200, 'assign shipper-A package to Hamza');

  // ------------------------------------------------------------------
  section('S1 — Expéditeur cannot run delivery actions (any package)');
  const shipperActions = [
    ['POST', 'deliver', { collectedAmount: 50 }],
    ['POST', 'partial-delivery', { deliveredContent: 'x', returnedContent: 'y', collectedAmount: 25, returnedAmount: 25, reason: 'r', deliveredPieces: 1, returnedPieces: 1 }],
    ['POST', 'exchange', { returnedItemSummary: 'old', newPackageBarcode: 'NEW-1' }],
    ['POST', 'postpone', { reason: 'Client absent' }],
    ['POST', 'failed-attempt', { reasonCode: 'INJOIGNABLE' }],
    ['POST', 'return', { reason: 'Refus' }],
    ['POST', 'return-to-shipper', {}],
    ['POST', 'start', {}],
  ];
  for (const [method, action, body] of shipperActions) {
    const foreign = await api(expA.accessToken, method, `/colis/${pkgB.id}/${action}`, body);
    ok([403, 404].includes(foreign.status), `expA → ${action} on shipper-B package refused`, `HTTP ${foreign.status}`);
    const own = await api(expA.accessToken, method, `/colis/${pkgA.id}/${action}`, body);
    ok([403, 404].includes(own.status), `expA → ${action} on own package refused`, `HTTP ${own.status}`);
  }
  ok((await pkgStatus(admin.accessToken, pkgB.id)) === 'AFFECTE_RUNSHEET', 'shipper-B package unchanged');
  ok((await pkgStatus(admin.accessToken, pkgA.id)) === 'AFFECTE_RUNSHEET', 'shipper-A package unchanged');
  const foreignRead = await api(expA.accessToken, 'GET', `/colis/${pkgB.trackingNumber}`);
  ok(foreignRead.status === 404, 'expA cannot read shipper-B package by tracking number');
  const foreignEdit = await api(expA.accessToken, 'PUT', `/colis/${pkgB.id}`, { contentSummary: 'pwned' });
  ok([403, 404].includes(foreignEdit.status), 'expA cannot edit shipper-B package');

  // ------------------------------------------------------------------
  section('S2 — LIVREUR token without driver profile');
  const lonelyEmail = `qa-liv-${SUFFIX.toLowerCase()}@example.tn`;
  const lonely = await api(admin.accessToken, 'POST', '/users', {
    fullName: 'QA Livreur sans fiche', email: lonelyEmail, phone: '70000002', password: PWD, role: 'LIVREUR',
  });
  ok(lonely.status === 201, 'create LIVREUR account without driver profile');
  const lonelyLogin = await api(null, 'POST', '/auth/login', { email: lonelyEmail, password: PWD });
  if (lonelyLogin.status === 200) {
    const t = lonelyLogin.json.data.accessToken;
    for (const p of ['/colis', '/runsheets', '/dashboard', '/ramassages']) {
      const r = await api(t, 'GET', p);
      const rows = Array.isArray(r.json?.data) ? r.json.data.length : null;
      ok(r.status === 403 || (r.status === 200 && rows === 0), `driverless LIVREUR cannot list ${p}`, `HTTP ${r.status} rows=${rows}`);
    }
  } else {
    ok(lonelyLogin.status === 403, 'driverless LIVREUR login refused with 403', `HTTP ${lonelyLogin.status}`);
  }

  // ------------------------------------------------------------------
  section('S3/S5 — Sessions, logout, refresh rotation');
  const s1 = await login(LIV_A);
  const s2 = await login(LIV_A);
  const adminTmp = await login(ADMIN);
  const lo = await api(adminTmp.accessToken, 'POST', '/auth/logout');
  ok(lo.status === 200, 'admin logout without body → 200');
  const r1 = await api(null, 'POST', '/auth/refresh', { refreshToken: s1.refreshToken });
  ok(r1.status === 200, "another user's logout does not revoke Hamza's session", `HTTP ${r1.status}`);
  const adminTmpMe = await api(adminTmp.accessToken, 'GET', '/auth/me');
  ok(adminTmpMe.status === 401, 'access token of a logged-out session is rejected', `HTTP ${adminTmpMe.status}`);
  const s1b = r1.json?.data;
  const reuse = await api(null, 'POST', '/auth/refresh', { refreshToken: s1.refreshToken });
  ok(reuse.status === 401, 'rotated refresh token cannot be reused');
  // Rotation keeps the same session (mobile requests in flight keep working),
  // so the newest refresh token stays valid after a rejected replay.
  if (s1b) {
    const newest = await api(null, 'POST', '/auth/refresh', { refreshToken: s1b.refreshToken });
    ok(newest.status === 200, 'newest refresh token still valid after a rejected replay', `HTTP ${newest.status}`);
  }
  const loS2 = await api(s2.accessToken, 'POST', '/auth/logout', { refreshToken: s2.refreshToken });
  ok(loS2.status === 200, 'logout with refreshToken');
  const r2 = await api(null, 'POST', '/auth/refresh', { refreshToken: s2.refreshToken });
  ok(r2.status === 401, 'logged-out refresh token is revoked');
  const stillOk = await api(livA.accessToken, 'GET', '/auth/me');
  ok(stillOk.status === 200, 'other session of the same driver unaffected');
  const forged = await api(null, 'POST', '/auth/refresh', { refreshToken: 'abc.def.ghi' });
  ok(forged.status === 401, 'forged refresh token → 401');

  section('S11 — Deactivation takes effect immediately');
  const expBId = expBUser.json?.data?.id;
  await api(admin.accessToken, 'PATCH', `/users/${expBId}/status`, { isActive: false, reason: 'QA' });
  ok((await api(expB.accessToken, 'GET', '/colis')).status === 401, 'deactivated user: existing access token rejected');
  ok((await api(null, 'POST', '/auth/refresh', { refreshToken: expB.refreshToken })).status === 401, 'deactivated user: refresh rejected');
  ok((await api(null, 'POST', '/auth/login', { email: expBEmail, password: PWD })).status !== 200, 'deactivated user: login refused');
  await api(admin.accessToken, 'PATCH', `/users/${expBId}/status`, { isActive: true, reason: 'QA restore' });
  const expB2 = await login({ email: expBEmail, password: PWD });
  ok(!!expB2.accessToken, 'reactivated user can log in');

  const livB = await login(LIV_B);
  await api(admin.accessToken, 'PATCH', `/drivers/${ghassan.id}/status`, { isActive: false, reason: 'QA' });
  ok((await api(livB.accessToken, 'GET', '/colis')).status === 401, 'deactivated driver: access token rejected');
  ok((await api(null, 'POST', '/auth/login', LIV_B)).status !== 200, 'deactivated driver: login refused');
  ok((await api(livB.accessToken, 'POST', '/drivers/presence/heartbeat')).status === 401, 'deactivated driver: heartbeat refused');
  await api(admin.accessToken, 'PATCH', `/drivers/${ghassan.id}/status`, { isActive: true, reason: 'QA restore' });
  ok((await api(null, 'POST', '/auth/login', LIV_B)).status === 200, 'reactivated driver can log in');

  // ------------------------------------------------------------------
  section('S4 — Demo credentials not public');
  const demo = await api(null, 'GET', '/auth/demo-users');
  ok(demo.status === 404 || (demo.status === 200 && !/Admin123|passwordHint":"[^"]+"/.test(demo.text)), '/auth/demo-users does not leak passwords', `HTTP ${demo.status}`);

  section('Password reset');
  const reqReset = await api(null, 'POST', '/auth/password-reset/request', { email: 'nobody@example.tn' });
  ok(reqReset.status === 200 && !/token/i.test(JSON.stringify(reqReset.json?.data ?? {})), 'reset request is generic and returns no token');
  const badConfirm = await api(null, 'POST', '/auth/password-reset/confirm', { token: 'x'.repeat(40), newPassword: 'Another-Pass-1' });
  ok(badConfirm.status === 400, 'reset confirm with bogus token → 400');

  // ------------------------------------------------------------------
  section('S7/S8 — Shipper report & audit isolation');
  for (const d of ['livreurs', 'depots']) {
    const r = await api(expA.accessToken, 'GET', `/reports/${d}`);
    ok(r.status === 403, `expA /reports/${d} refused`, `HTTP ${r.status}`);
    const csv = await api(expA.accessToken, 'GET', `/reports/${d}/export`);
    ok(csv.status === 403, `expA /reports/${d}/export refused`, `HTTP ${csv.status}`);
  }
  ok((await api(expA.accessToken, 'GET', '/reports/colis')).status === 200, 'expA /reports/colis still allowed');
  const domaines = await api(expA.accessToken, 'GET', '/reports/domaines');
  ok(domaines.status === 200 && !domaines.json.data.some((d) => ['livreurs', 'depots'].includes(d.id)), 'expA domain list hides livreurs/depots');
  const audit = await api(expA.accessToken, 'GET', `/colis/${pkgA.id}/audit`);
  ok(audit.status === 200, 'expA can read own package audit trail');
  ok(!(audit.json?.data ?? []).some((e) => 'userIp' in e || 'userAgent' in e), 'audit trail hides staff IP / user-agent from shippers');
  const auditAdmin = await api(admin.accessToken, 'GET', `/colis/${pkgA.id}/audit`);
  ok((auditAdmin.json?.data ?? []).some((e) => 'userIp' in e), 'admin still sees IP in audit trail');

  // ------------------------------------------------------------------
  section('S9 — No internal error leakage');
  const probes = [
    ['DELETE', '/devices/not-a-uuid'],
    ['GET', '/notifications?type=NOT_A_TYPE'],
    ['POST', '/notifications/not-a-uuid/read'],
    ['GET', '/colis/%00%27'],
    ['GET', '/payments/not-a-uuid'],
    ['GET', '/runsheets?date=not-a-date'],
    ['GET', '/inter-depots/not-a-number'],
    ['GET', '/ramassages?status=NOPE'],
  ];
  for (const [m, p] of probes) {
    const r = await api(admin.accessToken, m, p);
    ok(r.status < 500 && !leaky(r.json?.message) && !leaky(r.json?.detail), `${m} ${p} → clean ${r.status}`, `${r.status} ${String(r.json?.message ?? '').slice(0, 120)}`);
  }
  const badJson = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  ok(badJson.status === 400, 'malformed JSON → 400', `HTTP ${badJson.status}`);

  // ------------------------------------------------------------------
  section('S12 — Depot agent scoping');
  const recvForeign = await api(agent.accessToken, 'POST', '/depot/reception', { code: pkgA.barcode, depositId: sousse.id });
  ok(recvForeign.status === 403, 'agent cannot receive into another depot', `HTTP ${recvForeign.status}`);
  const rsSousse = await api(admin.accessToken, 'POST', '/runsheets', { driverId: hamza.id, depositId: sousse.id, tourDate: new Date().toISOString().slice(0, 10) });
  ok(rsSousse.status === 201, 'admin creates runsheet at Sousse');
  const agentRuns = (await api(agent.accessToken, 'GET', '/runsheets')).json?.data ?? [];
  ok(!agentRuns.some((r) => r.depositId === sousse.id), 'agent runsheet list limited to own depot');
  const livTransfers = (await api(livA.accessToken, 'GET', '/inter-depots')).json?.data ?? [];
  ok(livTransfers.every((t) => t.driverId === hamza.id), 'driver only sees transfers he transports', `${livTransfers.length} rows`);
  if (rsSousse.json?.data) await api(admin.accessToken, 'DELETE', `/runsheets/${rsSousse.json.data.runsheetNumber}`);

  // ------------------------------------------------------------------
  section('S13 — Recipients are not shared/overwritten across shippers');
  const sharedPhone = `5${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const pA = await newPkg(expA, { customerName: 'Alice Shipper A', customerPhone: sharedPhone, address: '1 rue Alpha', governorate: 'Tunis' });
  const pB = await newPkg(expB2, { customerName: 'Bob Shipper B', customerPhone: sharedPhone, address: '99 avenue Beta', governorate: 'Sfax' });
  const pA2 = await newPkg(expA, { customerName: 'Alice Shipper A', customerPhone: sharedPhone, address: '7 rue Nouvelle', governorate: 'Ariana' });
  const pAv = (await api(expA.accessToken, 'GET', `/colis/${pA.id}`)).json.data;
  const pBv = (await api(expB2.accessToken, 'GET', `/colis/${pB.id}`)).json.data;
  const pA2v = (await api(expA.accessToken, 'GET', `/colis/${pA2.id}`)).json.data;
  ok(pAv.customerName === 'Alice Shipper A', 'shipper A recipient name kept', pAv.customerName);
  ok(pBv.customerName === 'Bob Shipper B', 'shipper B sees its own recipient name', pBv.customerName);
  ok(pBv.address?.includes('99 avenue Beta'), 'shipper B package uses the address typed', pBv.address);
  ok(pA2v.address?.includes('7 rue Nouvelle'), 'repeat recipient with a new address uses the new address', pA2v.address);

  // ------------------------------------------------------------------
  section('R2/R3 — Delivery integrity');
  const pDel = await newPkg(expA, { totalPrice: 40, pieceCount: 1 });
  await assign(pDel, hamza);
  const [d1, d2] = await Promise.all([
    api(livA.accessToken, 'POST', `/colis/${pDel.id}/deliver`, { collectedAmount: 40 }),
    api(livA.accessToken, 'POST', `/colis/${pDel.id}/deliver`, { collectedAmount: 40 }),
  ]);
  const codes = [d1.status, d2.status].sort();
  ok(codes[0] === 200 && codes[1] === 409, 'concurrent double delivery → exactly one success', codes.join(','));
  const paysDel = (await api(finance.accessToken, 'GET', `/payments?limit=200`)).json?.data ?? [];
  ok(paysDel.filter((p) => p.packageId === pDel.id).length === 1, 'exactly one COD payment recorded');

  const pBack = await newPkg(expA, { totalPrice: 30, pieceCount: 1 });
  await assign(pBack, hamza);
  const balBefore = Number((await api(admin.accessToken, 'GET', `/drivers/${hamza.id}`)).json.data.currentBalance);
  const backDel = await api(gest.accessToken, 'POST', `/colis/${pBack.id}/deliver`, { collectedAmount: 30 });
  ok(backDel.status === 200, 'back-office (gestionnaire) delivery succeeds', `HTTP ${backDel.status} ${backDel.text.slice(0, 160)}`);
  const pays = (await api(finance.accessToken, 'GET', `/payments?limit=200`)).json?.data ?? [];
  ok(pays.some((p) => p.packageId === pBack.id), 'back-office delivery creates the COD payment');
  const balAfter = Number((await api(admin.accessToken, 'GET', `/drivers/${hamza.id}`)).json.data.currentBalance);
  ok(Math.abs(balAfter - balBefore - 30) < 0.001, 'assigned driver balance credited', `${balBefore} → ${balAfter}`);
  const unassigned = await newPkg(expA, { totalPrice: 10, pieceCount: 1 });
  const delUnassigned = await api(gest.accessToken, 'POST', `/colis/${unassigned.id}/deliver`, { collectedAmount: 10 });
  ok(delUnassigned.status === 409, 'delivery of a package never handed to a driver → 409', `HTTP ${delUnassigned.status}`);

  const exLivre = await api(livA.accessToken, 'POST', `/colis/${pDel.id}/exchange`, { returnedItemSummary: 'old', newPackageBarcode: 'NEW-2' });
  ok(exLivre.status === 409, 'exchange on a delivered package refused', `HTTP ${exLivre.status}`);
  const otherDriver = await newPkg(expA);
  await assign(otherDriver, ghassan);
  const steal = await api(livA.accessToken, 'POST', `/colis/${otherDriver.id}/deliver`, { collectedAmount: 50 });
  ok([403, 404].includes(steal.status), "driver cannot deliver another driver's package", `HTTP ${steal.status}`);

  // ------------------------------------------------------------------
  section('R5 — Runsheet rules');
  const today = new Date().toISOString().slice(0, 10);
  const [c1, c2] = await Promise.all([
    api(admin.accessToken, 'POST', '/runsheets', { driverId: hamza.id, depositId: hub.id, tourDate: today }),
    api(admin.accessToken, 'POST', '/runsheets', { driverId: hamza.id, depositId: hub.id, tourDate: today }),
  ]);
  ok(c1.status === 201 && c2.status === 201 && c1.json.data.runsheetNumber !== c2.json.data.runsheetNumber, 'concurrent runsheet creation → 2 distinct numbers', `${c1.status}/${c2.status}`);
  const rs = c1.json.data;
  const rsOther = c2.json.data;
  const pR = await newPkg(expA, { totalPrice: 77.5, pieceCount: 1 });
  const add = await api(admin.accessToken, 'POST', `/runsheets/${rs.runsheetNumber}/add-package`, { packageIdentifier: pR.trackingNumber });
  ok(add.status === 200, 'add eligible package', `HTTP ${add.status} ${add.text.slice(0, 160)}`);
  const pRv = (await api(admin.accessToken, 'GET', `/colis/${pR.id}`)).json.data;
  ok(pRv.status === 'AFFECTE_RUNSHEET', 'added package becomes AFFECTE_RUNSHEET', pRv.status);
  ok((pRv.driverId ?? pRv.assignedDriverId) === hamza.id, 'added package assigned to runsheet driver', String(pRv.driverId ?? pRv.assignedDriverId));
  ok(Math.abs(Number(add.json?.data?.expectedCash) - 77.5) < 0.001, 'expectedCash includes added package', String(add.json?.data?.expectedCash));
  const addTwice = await api(admin.accessToken, 'POST', `/runsheets/${rsOther.runsheetNumber}/add-package`, { packageIdentifier: pR.trackingNumber });
  ok(addTwice.status === 409, 'package cannot sit in two open runsheets', `HTTP ${addTwice.status}`);
  const addLivre = await api(admin.accessToken, 'POST', `/runsheets/${rs.runsheetNumber}/add-package`, { packageIdentifier: pDel.trackingNumber });
  ok(addLivre.status === 409, 'delivered package cannot be added', `HTTP ${addLivre.status}`);
  const pRm = await newPkg(expA, { totalPrice: 10, pieceCount: 1 });
  await api(admin.accessToken, 'POST', `/runsheets/${rs.runsheetNumber}/add-package`, { packageIdentifier: pRm.trackingNumber });
  const rm = await api(admin.accessToken, 'POST', `/runsheets/${rs.runsheetNumber}/remove-package`, { packageIdentifier: pRm.trackingNumber });
  ok(rm.status === 200 && Math.abs(Number(rm.json.data.expectedCash) - 77.5) < 0.001, 'remove-package decrements expectedCash', String(rm.json?.data?.expectedCash));

  const termine = await api(admin.accessToken, 'POST', `/runsheets/${rs.runsheetNumber}/status`, { status: 'TERMINE' });
  ok(termine.status === 409 || termine.status === 400, 'cannot jump to TERMINE without cash declaration', `HTTP ${termine.status}`);
  const valide = await api(admin.accessToken, 'POST', `/runsheets/${rs.runsheetNumber}/status`, { status: 'VALIDE' });
  ok(valide.status === 409 || valide.status === 400, 'cannot jump to VALIDE via status endpoint', `HTTP ${valide.status}`);
  const emptyStart = await api(admin.accessToken, 'POST', `/runsheets/${rsOther.runsheetNumber}/status`, { status: 'EN_COURS' });
  ok(emptyStart.status === 409, 'empty runsheet cannot depart', `HTTP ${emptyStart.status}`);
  const go = await api(admin.accessToken, 'POST', `/runsheets/${rs.runsheetNumber}/status`, { status: 'EN_COURS' });
  ok(go.status === 200 && go.json.data.status === 'EN_COURS', 'departure → EN_COURS');
  ok((await pkgStatus(admin.accessToken, pR.id)) === 'EN_COURS_LIVRAISON', 'packages move to EN_COURS_LIVRAISON on departure');
  const back = await api(admin.accessToken, 'POST', `/runsheets/${rs.runsheetNumber}/status`, { status: 'BROUILLON' });
  ok(back.status === 409 || back.status === 400, 'running runsheet cannot go back to draft', `HTTP ${back.status}`);
  const livSees = await api(livA.accessToken, 'GET', `/runsheets/${rs.runsheetNumber}`);
  ok(livSees.status === 200, 'driver sees his runsheet');
  const delR = await api(livA.accessToken, 'POST', `/colis/${pR.id}/deliver`, { collectedAmount: 77.5 });
  ok(delR.status === 200, 'driver delivers runsheet package', `HTTP ${delR.status} ${delR.text.slice(0, 120)}`);
  const close = await api(finance.accessToken, 'POST', `/runsheets/${rs.runsheetNumber}/close`, { collectedCash: 70 });
  ok(close.status === 200 && close.json.data.status === 'RETOUR_DEPOT', 'cash declaration closes the tour (RETOUR_DEPOT)', `HTTP ${close.status} ${close.text.slice(0, 160)}`);
  ok(Math.abs(Number(close.json?.data?.deficitAmount) - 7.5) < 0.001, 'deficit computed exactly (7.500)', String(close.json?.data?.deficitAmount));
  const val = await api(finance.accessToken, 'POST', `/runsheets/${rs.runsheetNumber}/validate`, {});
  ok(val.status === 200 && val.json.data.status === 'CLOTUREE_DEFICIT', 'caisse validation → CLOTUREE_DEFICIT', `HTTP ${val.status}`);
  const cancelOther = await api(admin.accessToken, 'POST', `/runsheets/${rsOther.runsheetNumber}/status`, { status: 'ANNULE' });
  ok(cancelOther.status === 200, 'empty waiting runsheet can be cancelled');

  // ------------------------------------------------------------------
  section('Push devices & notifications isolation');
  const tok = `qa-fcm-${SUFFIX}-${'x'.repeat(30)}`;
  const reg = await api(livA.accessToken, 'POST', '/devices/push-token', { token: tok, platform: 'android' });
  ok(reg.status === 201, 'register push token');
  const list = await api(livA.accessToken, 'GET', '/devices');
  ok(!list.text.includes(tok), 'device list never returns the raw token');
  const notifsB = (await api(expB2.accessToken, 'GET', '/notifications?limit=100')).json?.data ?? [];
  const notifsA = (await api(expA.accessToken, 'GET', '/notifications?limit=100')).json?.data ?? [];
  ok(!notifsB.some((n) => notifsA.some((m) => m.id === n.id)), 'notifications are per-user');
  const readForeign = notifsA[0] ? await api(expB2.accessToken, 'POST', `/notifications/${notifsA[0].id}/read`) : { status: 404 };
  ok(readForeign.status === 404, "cannot mark another user's notification read");

  // ------------------------------------------------------------------
  section('Role gates');
  ok((await api(expA.accessToken, 'GET', '/dashboard')).status === 403, 'expediteur → /dashboard 403');
  ok((await api(expA.accessToken, 'GET', '/users')).status === 403, 'expediteur → /users 403');
  ok((await api(livA.accessToken, 'GET', '/payments')).status === 403, 'livreur → /payments 403');
  ok((await api(livA.accessToken, 'POST', '/runsheets', { driverId: hamza.id, tourDate: today })).status === 403, 'livreur cannot create runsheets');
  ok((await api(gest.accessToken, 'POST', '/users', { fullName: 'x', email: `x${SUFFIX}@e.tn`, phone: '1', password: PWD, role: 'SUPER_ADMIN' })).status === 403, 'gestionnaire cannot create users');
  const hb = await api(livA.accessToken, 'POST', '/drivers/presence/heartbeat', { driverId: ghassan.id });
  ok(hb.status === 200, 'heartbeat ok (body driverId ignored)');
  const ghPres = (await api(admin.accessToken, 'GET', `/drivers/${ghassan.id}/presence`)).json?.data;
  ok(!ghPres?.online || ghPres?.driverId !== hamza.id, 'presence cannot be spoofed for another driver');

  // ------------------------------------------------------------------
  section('S6 — Brute-force protection (last: it trips the limiter for one fake account)');
  const victim = `nobody-${SUFFIX.toLowerCase()}@example.tn`;
  let limited = false;
  for (let i = 0; i < 15; i += 1) {
    const r = await api(null, 'POST', '/auth/login', { email: victim, password: `wrong-${i}` });
    if (r.status === 429) { limited = true; ok(!!r.headers.get('retry-after'), '429 carries Retry-After'); break; }
  }
  ok(limited, 'repeated failed logins are rate limited (429)');
  ok((await api(null, 'POST', '/auth/login', LIV_A)).status === 200, 'other accounts unaffected by the limiter');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    for (const f of failures) console.log(` - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 2;
});
