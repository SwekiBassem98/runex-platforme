#!/usr/bin/env node
/**
 * QA 42 — demande du client (19/10, 22 h 17) :
 *  1. Suppression des bons de retour (Retours expéditeur), par l'administrateur ;
 *  2. Suppression des bordereaux « Inter dépôt retours et échanges » ;
 *  3. Inter dépôt retours : la liste s'ouvre sur la journée, l'historique reste ;
 *  4. Remise d'un bon de retour : code donné par l'expéditeur (comme le paiement) ;
 *  5. Écrans : boutons supprimer, liste du jour, champ du code, code côté expéditeur.
 *
 *   QA_API_URL=… QA_WEB_URL=… QA_DB_URL=… PUPPETEER_CORE=… CHROME=… node qa/qa-retours-suppression-code-42.mjs
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
  return { status: r.status, data: j?.data, message: j?.message, json: j };
}
const sql = (q) => execFileSync('psql', [DB, '-qAtc', q], { encoding: 'utf8' }).trim();
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const admin = await login('admin@logixpress.tn', 'Admin123!');
const agent = await login('agent.magasin@logixpress.tn', 'Agent123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const hamzaId = (await api(hamza, 'GET', '/auth/me')).data.driverId;
const shippers = (await api(admin, 'GET', '/shippers?limit=50')).data ?? [];
const bluestar = shippers.find((s) => s.code === 'EXP-BLUESTAR');
const techstore = shippers.find((s) => s.code === 'EXP-TECHSTORE');
const opts = (await api(admin, 'GET', '/inter-depots/form-options')).data;
const hub = opts.deposits.find((d) => d.isMainHub);
const sousse = opts.deposits.find((d) => d.name === 'Agence Sousse');
const colisDe = async (id) => (await api(admin, 'GET', `/colis/${id}`)).data;

let n = 0;
/** Colis retourné au dépôt (trois reports). */
async function retour(shipperId) {
  n++;
  const c = (await api(admin, 'POST', '/colis', { shipperId, customerName: `Retour Q42 ${n}`, customerPhone: `9642${String(1000 + n)}`, governorate: 'Ben Arous', delegation: 'Ben Arous', address: `Rue ${n}`, goodsPrice: 15, pieceCount: 1 })).data;
  if (shipperId === techstore.id) await api(admin, 'POST', '/inter-depots/acceptance/scan', { code: c.barcode, type: 'LIVRAISON', depositId: hub.id });
  else await api(admin, 'POST', '/depot/reception', { code: c.barcode, depositId: hub.id });
  await api(admin, 'POST', `/colis/${c.id}/assign`, { driverId: hamzaId });
  for (let k = 0; k < 3; k++) { await api(hamza, 'POST', `/colis/${c.id}/start`, {}); await api(hamza, 'POST', `/colis/${c.id}/postpone`, { reason: 'Client absent' }); }
  return c;
}

console.log('\n1. Suppression des bons de retour');
const c1 = await retour(bluestar.id);
ok((await colisDe(c1.id))?.status === 'RETOUR_DEPOT', 'colis retourné au dépôt (BlueStar)');
let r = await api(admin, 'POST', '/retours-expediteur/bons', { shipperId: bluestar.id });
const bonA = r.data;
await api(admin, 'POST', `/retours-expediteur/bons/${bonA.id}/scan`, { code: c1.barcode, mode: 'ajouter' });
ok((await api(admin, 'GET', `/retours-expediteur/bons/${bonA.id}`)).data?.colisCount === 1, 'bon en préparation avec 1 colis');
r = await api(agent, 'DELETE', `/retours-expediteur/bons/${bonA.id}`);
ok(r.status === 403, 'agent de dépôt : suppression refusée (administrateur seulement)', String(r.status));
r = await api(admin, 'DELETE', `/retours-expediteur/bons/${bonA.id}`);
ok(r.status === 200 && /de nouveau à rendre/.test(r.message ?? ''), 'bon en préparation supprimé', `${r.status} ${r.message}`);
ok((await api(admin, 'GET', `/retours-expediteur/bons/${bonA.id}`)).status === 404, 'bon introuvable après suppression');
ok(sql(`SELECT coalesce("returnSlipId"::text, 'null') FROM "Package" WHERE id = '${c1.id}'`) === 'null' && (await colisDe(c1.id))?.status === 'RETOUR_DEPOT', 'son colis redevient « à rendre »');
ok(((await api(admin, 'GET', '/retours-expediteur/a-rendre')).data ?? []).some((a) => a.shipperId === bluestar.id && a.colis >= 1), 'colis de nouveau proposé dans « à rendre »');
ok(sql(`SELECT count(*) FROM "AuditLog" WHERE action = 'RETURN_SLIP_SUPPRIME' AND "entityId" = '${bonA.id}'`) === '1', 'suppression inscrite au journal d’audit');

const bonB = (await api(admin, 'POST', '/retours-expediteur/bons', { shipperId: bluestar.id })).data;
await api(admin, 'PATCH', `/retours-expediteur/bons/${bonB.id}`, { driverId: hamzaId });
await api(admin, 'POST', `/retours-expediteur/bons/${bonB.id}/scan`, { code: c1.barcode, mode: 'ajouter' });
r = await api(admin, 'POST', `/retours-expediteur/bons/${bonB.id}/etat`, { status: 'EN_COURS' });
ok(r.status === 200, 'bon B lancé (en cours de livraison)', `${r.status} ${r.message}`);
r = await api(admin, 'DELETE', `/retours-expediteur/bons/${bonB.id}`);
ok(r.status === 409 && /Revenu au dépôt/.test(r.message ?? ''), 'bon en cours de livraison : suppression refusée', `${r.status} ${r.message}`);

console.log('\n2. Code de remise (comme le paiement)');
const vueExp = (await api(exp, 'GET', '/retours-expediteur/bons')).data ?? [];
const code = vueExp.find((b) => b.id === bonB.id)?.handoverCode;
ok(/^\d{6}$/.test(code ?? ''), 'l’expéditeur voit le code à 6 chiffres de son bon', String(code));
ok((await api(admin, 'GET', `/retours-expediteur/bons/${bonB.id}`)).data?.handoverCode === undefined, 'l’exploitation ne voit pas le code');
const notif = sql(`SELECT count(*) FROM "Notification" n JOIN "ShipperUser" su ON su."userId" = n."userId" WHERE su."shipperId" = '${bluestar.id}' AND n.content LIKE '%${code}%'`);
ok(Number(notif) >= 1, 'notification « en route » à l’expéditeur avec le code', notif);
r = await api(admin, 'POST', `/retours-expediteur/bons/${bonB.id}/etat`, { status: 'REMIS' });
ok(r.status === 400, 'sans code : refusé', `${r.status} ${r.message}`);
r = await api(admin, 'POST', `/retours-expediteur/bons/${bonB.id}/etat`, { status: 'REMIS', code: code === '123456' ? '654321' : '123456' });
ok(r.status === 403 && /incorrect/.test(r.message ?? ''), 'mauvais code : refusé', `${r.status} ${r.message}`);
ok((await api(admin, 'GET', `/retours-expediteur/bons/${bonB.id}`)).data?.status === 'EN_COURS', 'mauvais code : bon toujours en cours');
r = await api(admin, 'POST', `/retours-expediteur/bons/${bonB.id}/etat`, { status: 'REMIS', code, receiverName: 'Karim' });
ok(r.status === 200 && r.data?.status === 'REMIS', 'bon code correct : remis', `${r.status} ${r.message}`);
ok((await colisDe(c1.id))?.status === 'RETOURNE_EXPEDITEUR', 'colis restitué à l’expéditeur');
ok(!((await api(exp, 'GET', '/retours-expediteur/bons')).data ?? []).find((b) => b.id === bonB.id)?.handoverCode, 'bon remis : code plus affiché');
// Bon ancien sans code : un code lui est attribué à la première tentative.
const bonC = (await api(admin, 'POST', '/retours-expediteur/bons', { shipperId: bluestar.id })).data;
const c2 = await retour(bluestar.id);
await api(admin, 'POST', `/retours-expediteur/bons/${bonC.id}/scan`, { code: c2.barcode, mode: 'ajouter' });
sql(`UPDATE "ReturnSlip" SET "handoverCode" = NULL WHERE id = '${bonC.id}'`);
r = await api(admin, 'POST', `/retours-expediteur/bons/${bonC.id}/etat`, { status: 'REMIS', code: '000000' });
const codeC = ((await api(exp, 'GET', '/retours-expediteur/bons')).data ?? []).find((b) => b.id === bonC.id)?.handoverCode;
ok(r.status >= 400 && /^\d{6}$/.test(codeC ?? ''), 'bon ancien sans code : code attribué, visible par l’expéditeur', `${r.status} ${codeC}`);
r = await api(admin, 'POST', `/retours-expediteur/bons/${bonC.id}/etat`, { status: 'REMIS', code: codeC });
ok(r.status === 200, 'remise au guichet avec le code attribué', `${r.status} ${r.message}`);
r = await api(admin, 'DELETE', `/retours-expediteur/bons/${bonC.id}`);
ok(r.status === 200 && /retournés à l’expéditeur/.test(r.message ?? ''), 'bon remis supprimé', `${r.status} ${r.message}`);
ok((await colisDe(c2.id))?.status === 'RETOURNE_EXPEDITEUR', 'bon remis supprimé : le colis reste restitué, historique conservé');
const bonD = (await api(admin, 'POST', '/retours-expediteur/bons', { shipperId: bluestar.id })).data;
await api(admin, 'POST', `/retours-expediteur/bons/${bonD.id}/etat`, { status: 'ANNULE' });
ok((await api(admin, 'DELETE', `/retours-expediteur/bons/${bonD.id}`)).status === 200, 'bon annulé supprimé');

console.log('\n3. Suppression des bordereaux inter dépôt retours');
const c3 = await retour(techstore.id);
ok((await colisDe(c3.id))?.status === 'RETOUR_DEPOT' && (await colisDe(c3.id))?.currentDepositId === hub.id, 'retour TechStore au hub');
const driver = opts.drivers[0];
const T1 = (await api(admin, 'POST', '/inter-depots', { type: 'RETOUR', destinationDepositId: sousse.id, transporterDriverId: driver.id })).data;
r = await api(admin, 'POST', `/inter-depots/${T1.transferNumber}/scan`, { code: c3.barcode, mode: 'add' });
ok(r.status === 200, 'retour chargé dans le bordereau', `${r.status} ${r.message}`);
ok((await colisDe(c3.id))?.status !== 'RETOUR_DEPOT', 'colis chargé (plus en stock)');
r = await api(agent, 'DELETE', `/inter-depots/${T1.transferNumber}`);
ok(r.status === 403, 'agent : suppression refusée', String(r.status));
r = await api(admin, 'DELETE', `/inter-depots/${T1.transferNumber}`);
ok(r.status === 200 && /remis en stock/.test(r.message ?? ''), 'bordereau en attente supprimé', `${r.status} ${r.message}`);
const c3b = await colisDe(c3.id);
ok(c3b?.status === 'RETOUR_DEPOT' && c3b?.currentDepositId === hub.id, 'son colis revient en stock au hub (retour)', `${c3b?.status}`);
ok((await api(admin, 'GET', `/inter-depots/${T1.transferNumber}`)).status === 404, 'bordereau introuvable après suppression');
ok(sql(`SELECT count(*) FROM "AuditLog" WHERE action = 'TRANSFERT_SUPPRIME' AND "entityId" = '${T1.id}'`) === '1', 'suppression inscrite au journal d’audit');
const T2 = (await api(admin, 'POST', '/inter-depots', { type: 'RETOUR', destinationDepositId: sousse.id, transporterDriverId: driver.id })).data;
await api(admin, 'POST', `/inter-depots/${T2.transferNumber}/scan`, { code: c3.barcode, mode: 'add' });
r = await api(admin, 'POST', '/inter-depots/acceptance/scan', { code: c3.barcode, type: 'RETOUR', depositId: sousse.id });
ok(r.status === 200 && r.data?.transferStatus === 'RECU', 'bordereau T2 reçu à Sousse', `${r.status} ${r.message}`);
r = await api(admin, 'DELETE', `/inter-depots/${T2.transferNumber}`);
ok(r.status === 200, 'bordereau reçu supprimé', `${r.status} ${r.message}`);
const c3c = await colisDe(c3.id);
ok(c3c?.status === 'RETOUR_DEPOT' && c3c?.currentDepositId === sousse.id, 'colis reçu : reste à l’Agence Sousse');
const T3 = (await api(admin, 'POST', '/inter-depots', { type: 'RETOUR', destinationDepositId: sousse.id, transporterDriverId: driver.id })).data;
sql(`UPDATE "InterDepotTransfer" SET status = 'RECU_PARTIEL' WHERE id = '${T3.id}'`);
r = await api(admin, 'DELETE', `/inter-depots/${T3.transferNumber}`);
ok(r.status === 409 && /acceptation/.test(r.message ?? ''), 'acceptation commencée : suppression refusée', `${r.status} ${r.message}`);
sql(`UPDATE "InterDepotTransfer" SET status = 'CRE' WHERE id = '${T3.id}'`);

console.log('\n4. Inter dépôt retours : liste du jour');
const T4 = (await api(admin, 'POST', '/inter-depots', { type: 'RETOUR', destinationDepositId: sousse.id, transporterDriverId: driver.id })).data;
sql(`UPDATE "InterDepotTransfer" SET "createdAt" = now() - interval '2 days' WHERE id = '${T4.id}'`);
const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
const avant = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date(Date.now() - 2 * 86400000));
let liste = (await api(admin, 'GET', `/inter-depots?type=RETOUR&start=${jour}&end=${jour}`)).data ?? [];
ok(liste.some((t) => t.transferNumber === T3.transferNumber) && !liste.some((t) => t.transferNumber === T4.transferNumber), 'période du jour : bordereau du jour seulement');
liste = (await api(admin, 'GET', `/inter-depots?type=RETOUR&start=${avant}&end=${jour}`)).data ?? [];
ok(liste.some((t) => t.transferNumber === T4.transferNumber), 'historique : bordereau d’avant-hier toujours consultable');

console.log('\n5. Écrans');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const txt = () => p.evaluate(() => document.body.innerText);
const attendre = async (re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await txt())) return true; await sleep(150); } return false; };
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);

await p.goto(W + '/inter-depots/retours', { waitUntil: 'networkidle2' }); await sleep(1500);
ok(!!(await p.$('[data-testid=liste-du-jour]')), 'inter dépôt retours : « du jour » par défaut');
const dates = await p.$$eval('input[type=date]', (l) => l.map((n) => n.value));
ok(dates[0] === jour && dates[1] === jour, 'période affichée : aujourd’hui → aujourd’hui', dates.join(' '));
let t = await txt();
ok(t.includes(T3.transferNumber) && !t.includes(T4.transferNumber), 'liste : bordereaux du jour seulement');
await p.$$eval('input[type=date]', (l, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(l[0], v); l[0].dispatchEvent(new Event('input', { bubbles: true })); }, avant);
for (const bt of await p.$$('button')) { if (/Filtrer/.test(await bt.evaluate((x) => x.innerText))) { await bt.click(); break; } }
ok(await attendre(new RegExp(T4.transferNumber)), 'historique : bordereau d’avant-hier affiché après changement de période');
for (const bt of await p.$$('button')) { if (/Aujourd/.test(await bt.evaluate((x) => x.innerText))) { await bt.click(); break; } }
await sleep(1200);
ok(!(await txt()).includes(T4.transferNumber), 'bouton « Aujourd’hui » : retour à la liste du jour');
await p.click(`[aria-label="Supprimer définitivement le bordereau ${T3.transferNumber}"]`);
await p.waitForSelector('[data-testid=confirmer-suppression]', { timeout: 5000 });
await p.screenshot({ path: `${SHOTS}/42-suppression-interdepot.png` });
await p.click('[data-testid=confirmer-suppression]');
ok(await attendre(new RegExp(`Bordereau ${T3.transferNumber} supprimé`)), 'suppression d’un bordereau depuis la liste');
await sleep(800);
ok(!(await p.$(`[aria-label="Supprimer définitivement le bordereau ${T3.transferNumber}"]`)), 'bordereau retiré de la liste');

// Bons de retour : suppression depuis la liste.
const bonE = (await api(admin, 'POST', '/retours-expediteur/bons', { shipperId: bluestar.id })).data;
await p.goto(W + '/retours-expediteur', { waitUntil: 'networkidle2' }); await sleep(1500);
ok(!!(await p.$(`[aria-label="Supprimer définitivement le bon ${bonE.slipNumber}"]`)), 'retours expéditeur : bouton supprimer sur chaque bon');
await p.click(`[aria-label="Supprimer définitivement le bon ${bonE.slipNumber}"]`);
await p.waitForSelector('[data-testid=confirmer-suppression]', { timeout: 5000 });
await p.click('[data-testid=confirmer-suppression]');
ok(await attendre(new RegExp(`Bon ${bonE.slipNumber} supprimé`)), 'bon supprimé depuis la liste');

// Remise avec code depuis la liste.
const c4 = await retour(bluestar.id);
const bonF = (await api(admin, 'POST', '/retours-expediteur/bons', { shipperId: bluestar.id })).data;
await api(admin, 'POST', `/retours-expediteur/bons/${bonF.id}/scan`, { code: c4.barcode, mode: 'ajouter' });
const codeF = ((await api(exp, 'GET', '/retours-expediteur/bons')).data ?? []).find((x) => x.id === bonF.id)?.handoverCode;
await p.reload({ waitUntil: 'networkidle2' }); await sleep(1500);
await p.select(`select[aria-label="Changer l'état du bon ${bonF.slipNumber}"]`, 'REMIS'); await sleep(400);
ok(!!(await p.$('[data-testid=code-remise]')), 'fenêtre « remis » : champ du code de remise');
ok(await p.$eval('[data-testid=confirmer-etat]', (x) => x.disabled), '« Confirmer » inactif sans code');
await p.type('[data-testid=code-remise]', codeF === '999999' ? '888888' : '999999');
await p.click('[data-testid=confirmer-etat]');
ok(await attendre(/Code de remise incorrect/), 'mauvais code : message clair');
await p.screenshot({ path: `${SHOTS}/42-code-remise.png` });
await p.click('[data-testid=code-remise]', { clickCount: 3 }); await p.keyboard.press('Backspace');
await p.type('[data-testid=code-remise]', codeF);
await p.click('[data-testid=confirmer-etat]');
ok(await attendre(new RegExp(`Bon ${bonF.slipNumber} remis`)), 'bon code correct : remis depuis la liste');
await b.close();

// Espace expéditeur : le code du bon ouvert est affiché.
const bonG = (await api(admin, 'POST', '/retours-expediteur/bons', { shipperId: bluestar.id })).data;
await api(admin, 'POST', `/retours-expediteur/bons/${bonG.id}/scan`, { code: (await retour(bluestar.id)).barcode, mode: 'ajouter' });
const codeG = ((await api(exp, 'GET', '/retours-expediteur/bons')).data ?? []).find((x) => x.id === bonG.id)?.handoverCode;
const b2 = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const q = await b2.newPage(); await q.setViewport({ width: 1280, height: 900 });
await q.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
await q.type('input[type=email]', 'expediteur@bluestar.tn'); await q.type('input[type=password]', 'Exp123!');
await Promise.all([q.waitForNavigation({ waitUntil: 'networkidle2' }), q.keyboard.press('Enter')]);
const lien = await q.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')).find((h) => h && /retours/.test(h)));
await q.goto(W + (lien ?? '/expediteur/retours'), { waitUntil: 'networkidle2' }); await sleep(1500);
const bloc = await q.$(`[data-testid="code-remise-${bonG.slipNumber}"]`);
ok(!!bloc && (await bloc.evaluate((x) => x.innerText)).includes(codeG), 'espace expéditeur : code de remise du bon affiché', lien ?? '');
await q.screenshot({ path: `${SHOTS}/42-expediteur-code.png` });
await b2.close();
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
