#!/usr/bin/env node
/**
 * QA 58 — le livreur corrige un geste (demande client, 23/11) :
 *   - « Livré » par erreur : annulé (encaissement, caisse du livreur, tentative) ;
 *   - retour puis le client veut son colis : relivré dans la même tournée ;
 *   - retour / report / livraison partielle par erreur : annulés ;
 *   - refus quand le dépôt a déjà pris la main (caisse validée, bordereau,
 *     retour rescanné, tournée rentrée) ; l'exploitation garde la main.
 *
 *   QA_API_URL=… [QA_DB_URL=…] node qa/qa-corriger-action-livreur-58.mjs
 */
import { execFileSync } from 'node:child_process';

const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const DB = process.env.QA_DB_URL ?? 'postgresql://prod_owner:ownerpw@localhost:5432/runex_qa';
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
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const hamzaId = (await api(hamza, 'GET', '/auth/me')).data.driverId;
const hub = (await api(admin, 'GET', '/inter-depots/form-options')).data.deposits.find((d) => d.isMainHub);
const rs = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
const sfx = Date.now().toString().slice(-4);
let n = 0;
const enTournee = async (prix = 40, extra = {}) => {
  n++;
  const c = (await api(exp, 'POST', '/colis', { customerName: `Q58 ${sfx}-${n}`, customerPhone: `9858${sfx}`.slice(0, 7) + (n % 10), governorate: 'Tunis', delegation: 'La Marsa', address: `Rue ${n}`, goodsPrice: prix, ...extra })).data;
  await api(admin, 'POST', '/depot/reception', { code: c.barcode, depositId: hub.id });
  const a = await api(admin, 'POST', `/runsheets/${rs.id}/add-package`, { packageIdentifier: c.trackingNumber });
  if (a.status >= 400) console.log('  (ajout tournée)', a.status, a.message);
  await api(hamza, 'POST', `/colis/${c.id}/start`, {});
  return c;
};
const etat = (id) => sql(`SELECT status || '|' || coalesce("currentRunsheetId"::text,'') || '|' || "deliveryAttemptsCount" FROM "Package" WHERE id='${id}'`);
const solde = () => Number(sql(`SELECT "currentBalance" FROM "Driver" WHERE id='${hamzaId}'`));
const paiement = (id) => sql(`SELECT coalesce(status::text,'') || '|' || coalesce("amountCollected"::text,'') FROM "Payment" WHERE "packageId"='${id}'`);
const corriger = (tok, c, motif, commentaire) => api(tok, 'POST', `/colis/${c.id}/corriger`, { motif, ...(commentaire ? { commentaire } : {}) });

console.log('\n1. « Livré » par erreur');
const c1 = await enTournee(40);
const solde0 = solde();
let r = await api(hamza, 'POST', `/colis/${c1.id}/deliver`, { collectedAmount: Number(c1.totalPrice) });
ok(r.status === 200 && solde() === solde0 + Number(c1.totalPrice), 'livré par erreur : encaissé, caisse du livreur augmentée');
r = await corriger(hamza, c1, 'CLIENT');
ok(r.status === 400, 'motif « client » refusé sur un colis livré', `${r.status} ${r.message}`);
r = await corriger(hamza, c1, 'ERREUR', 'Mauvais colis scanné');
ok(r.status === 200 && r.data.status === 'EN_COURS_LIVRAISON', 'livreur : « Livré » annulé, colis de nouveau en cours de livraison', `${r.status} ${r.message}`);
ok(etat(c1.id) === `EN_COURS_LIVRAISON|${rs.id}|0`, 'même tournée, tentative effacée', etat(c1.id));
ok(paiement(c1.id).startsWith('ANNULE|'), 'encaissement annulé', paiement(c1.id));
ok(Math.abs(solde() - solde0) < 0.001, 'caisse du livreur revenue à son montant', `${solde0} → ${solde()}`);
ok(/annulé \(erreur du livreur\)/.test(sql(`SELECT title FROM "PackageTimeline" WHERE "packageId"='${c1.id}' ORDER BY "createdAt" DESC LIMIT 1`)), 'chronologie : « « Livré » annulé (erreur du livreur) »');
const caisseAvant = (await api(admin, 'GET', '/caisse/resume')).data;
r = await api(hamza, 'POST', `/colis/${c1.id}/postpone`, { reason: 'Client absent' });
ok(r.status === 200 && etat(c1.id).startsWith('REPORTE|'), 'le livreur fait le bon geste : reporté', `${r.status} ${r.message}`);
r = await api(hamza, 'POST', `/colis/${c1.id}/deliver`, { collectedAmount: Number(c1.totalPrice) });
ok(r.status === 200 && paiement(c1.id) === `EN_ATTENTE|${Number(c1.totalPrice).toFixed(3)}`, 'relivré ensuite : un seul encaissement, rouvert « à valider »', paiement(c1.id));
const caisseApres = (await api(admin, 'GET', '/caisse/resume')).data;
ok(Math.abs(caisseApres.encaisse - caisseAvant.encaisse - Number(c1.totalPrice)) < 0.001, 'caisse : le montant compté une seule fois', `${caisseAvant.encaisse} → ${caisseApres.encaisse}`);

console.log('\n2. Retour, puis le client veut son colis');
const c2 = await enTournee(55);
r = await api(hamza, 'POST', `/colis/${c2.id}/return`, { reason: 'Refus de commande par le destinataire' });
ok(r.status === 200 && etat(c2.id) === 'RETOUR_DEPOT||1', 'retour déclaré : le colis sort de la tournée', etat(c2.id));
ok(Number(sql(`SELECT count(*) FROM "ReturnRecord" WHERE "packageId"='${c2.id}'`)) === 1, 'fiche de retour créée');
const tournee = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
ok((tournee.packages ?? []).some((p) => p.id === c2.id), 'il reste visible dans la tournée du livreur (onglet retours)');
r = await corriger(hamza, c2, 'CLIENT', 'Le client a rappelé');
ok(r.status === 200 && etat(c2.id) === `EN_COURS_LIVRAISON|${rs.id}|1`, 'relivré : en cours de livraison dans la même tournée, tentative gardée', `${r.status} ${r.message} ${etat(c2.id)}`);
ok(Number(sql(`SELECT count(*) FROM "ReturnRecord" WHERE "packageId"='${c2.id}'`)) === 0, 'fiche de retour retirée');
ok(/le client veut son colis/i.test(sql(`SELECT title FROM "PackageTimeline" WHERE "packageId"='${c2.id}' ORDER BY "createdAt" DESC LIMIT 1`)), 'chronologie : « Nouvelle livraison : le client veut son colis »');
r = await api(hamza, 'POST', `/colis/${c2.id}/deliver`, { collectedAmount: Number(c2.totalPrice) });
ok(r.status === 200 && etat(c2.id).startsWith('LIVRE|'), 'puis livré normalement', `${r.status} ${r.message}`);

console.log('\n3. Retour, report, livraison partielle par erreur');
const c3 = await enTournee();
await api(hamza, 'POST', `/colis/${c3.id}/return`, { reason: 'Client injoignable' });
r = await corriger(hamza, c3, 'ERREUR');
ok(r.status === 200 && etat(c3.id) === `EN_COURS_LIVRAISON|${rs.id}|0`, 'retour par erreur : annulé, tentative effacée', etat(c3.id));
const c4 = await enTournee();
await api(hamza, 'POST', `/colis/${c4.id}/postpone`, { reason: 'Client absent' });
r = await corriger(hamza, c4, 'ERREUR');
ok(r.status === 200 && etat(c4.id) === `EN_COURS_LIVRAISON|${rs.id}|0`, 'report par erreur : annulé', etat(c4.id));
const c5 = await enTournee(60, { pieceCount: 2 });
const solde5 = solde();
r = await api(hamza, 'POST', `/colis/${c5.id}/partial-delivery`, {
  deliveredDescription: '1 article', returnedDescription: '1 article', deliveredPieces: 1, collectedAmount: 30, reason: 'Une pièce refusée',
});
if (r.status === 200) {
  r = await corriger(hamza, c5, 'ERREUR');
  ok(r.status === 200 && etat(c5.id).startsWith('EN_COURS_LIVRAISON|') && Number(sql(`SELECT count(*) FROM "PartialDelivery" WHERE "packageId"='${c5.id}'`)) === 0 && Math.abs(solde() - solde5) < 0.001, 'livraison partielle par erreur : annulée (fiche et encaissement)', `${r.status} ${r.message}`);
} else console.log('  (livraison partielle non testée :', r.status, r.message, ')');

console.log('\n4. Refus quand le dépôt a déjà pris la main');
const autre = (await api(exp, 'POST', '/colis', { customerName: `Q58 autre ${sfx}`, customerPhone: '98580000', governorate: 'Tunis', delegation: 'La Marsa', address: 'Rue X', goodsPrice: 10 })).data;
r = await corriger(hamza, autre, 'ERREUR');
ok(r.status === 403 || r.status === 409, 'colis d’un autre livreur / hors tournée : refusé', `${r.status} ${r.message}`);
const c6 = await enTournee();
await api(hamza, 'POST', `/colis/${c6.id}/deliver`, { collectedAmount: Number(c6.totalPrice) });
sql(`UPDATE "Payment" SET status='VALIDE', "validatedAt"=now(), "validatedByUserId"=(SELECT id FROM "User" WHERE email='admin@logixpress.tn') WHERE "packageId"='${c6.id}'`);
r = await corriger(hamza, c6, 'ERREUR');
ok(r.status === 409 && /caisse/.test(r.message ?? ''), 'encaissement déjà validé par la caisse : refusé', `${r.status} ${r.message}`);
const c7 = await enTournee();
await api(hamza, 'POST', `/colis/${c7.id}/return`, { reason: 'Refus' });
sql(`UPDATE "RunsheetItem" SET "scannedAtReturn"=now() WHERE "packageId"='${c7.id}'`);
r = await corriger(hamza, c7, 'CLIENT');
ok(r.status === 409 && /rendu au dépôt/.test(r.message ?? ''), 'retour déjà rescanné au dépôt : refusé (réaffectation par l’exploitation)', `${r.status} ${r.message}`);
const c8 = await enTournee();
await api(hamza, 'POST', `/colis/${c8.id}/return`, { reason: 'Refus' });
sql(`UPDATE "Runsheet" SET status='RETOUR_DEPOT' WHERE id='${rs.id}'`);
r = await corriger(hamza, c8, 'CLIENT');
ok(r.status === 409 && /rentrée au dépôt/.test(r.message ?? ''), 'tournée rentrée au dépôt : le livreur ne corrige plus', `${r.status} ${r.message}`);
r = await corriger(admin, c8, 'ERREUR');
ok(r.status === 200 && etat(c8.id).startsWith('EN_COURS_LIVRAISON|'), 'l’exploitation peut encore corriger avant la clôture de la caisse', `${r.status} ${r.message}`);
sql(`UPDATE "Runsheet" SET status='CLOTUREE_CONFORME' WHERE id='${rs.id}'`);
const c9 = await (async () => { const x = (await api(exp, 'POST', '/colis', { customerName: `Q58 c9 ${sfx}`, customerPhone: '98580009', governorate: 'Tunis', delegation: 'La Marsa', address: 'Rue 9', goodsPrice: 10 })).data; return x; })();
sql(`UPDATE "Package" SET status='LIVRE', "assignedDriverId"='${hamzaId}' WHERE id='${c9.id}'`);
sql(`INSERT INTO "RunsheetItem" (id, "runsheetId", "packageId") VALUES (gen_random_uuid(), '${rs.id}', '${c9.id}')`);
r = await corriger(admin, c9, 'ERREUR');
ok(r.status === 409, 'tournée clôturée : plus de correction', `${r.status} ${r.message}`);
sql(`UPDATE "Runsheet" SET status='EN_COURS' WHERE id='${rs.id}'`);
const c10 = await enTournee();
r = await corriger(hamza, c10, 'ERREUR');
ok(r.status === 409, 'colis encore à livrer : rien à corriger', `${r.status} ${r.message}`);

if (process.env.PUPPETEER_CORE) {
  console.log('\n5. Exploitation : boutons de correction sur la fiche du colis');
  const W = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const c11 = await enTournee();
  await api(hamza, 'POST', `/colis/${c11.id}/return`, { reason: 'Refus' });
  const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
  const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 950 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
  await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
  await p.goto(`${W}/colis/${c11.id}`, { waitUntil: 'networkidle2' }); await new Promise((x) => setTimeout(x, 2000));
  ok(!!(await p.$('[data-testid=corriger-erreur]')) && !!(await p.$('[data-testid=relivrer]')), 'fiche (retour) : « Corriger une erreur » et « Le client veut son colis »');
  await p.click('[data-testid=relivrer]'); await new Promise((x) => setTimeout(x, 2000));
  ok(etat(c11.id).startsWith('EN_COURS_LIVRAISON|'), 'exploitation : colis remis en livraison');
  if (process.env.QA_SHOTS) await p.screenshot({ path: `${process.env.QA_SHOTS}/58-fiche-colis.png` });
  await b.close();
  ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));
}

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
