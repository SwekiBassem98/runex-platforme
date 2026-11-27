#!/usr/bin/env node
/**
 * QA 60 — (27/11)
 *
 * A. Retours JAX : un colis en retour chez JAX (annulé, refusé, « retour
 *    expéditeur ») que JAX range ensuite dans son entrepôt (« reçu à
 *    l'entrepôt », « Au dépôt JAX ») restait affiché « Reçu au dépôt », sans
 *    agence, dans « Colis à affecter ». Attendu : « Retour au dépôt » à
 *    l'agence qui l'avait confié, traitable par l'exploitation (bon de retour)
 *    — et les colis déjà mal classés corrigés (relecture, démarrage).
 *
 * B. « Mon argent » (portail expéditeur) : ce que RUNEX doit, l'argent par
 *    étape et colis par colis — mêmes chiffres que l'exploitation.
 *
 * Prérequis : faux serveur JAX (qa/mock-jax-server.mjs) et API avec
 * JAX_API_URL=… JAX_API_TOKEN=test-jax JAX_SYNC_MINUTES=0.
 *
 *   QA_API_URL=… QA_WEB_URL=… PUPPETEER_CORE=… CHROME=… [RESTART_API=…] [QA_SHOTS=…] node qa/qa-retours-jax-et-argent-60.mjs
 */
import { execFileSync } from 'node:child_process';

const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const W = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const JAX = (process.env.QA_JAX_URL ?? 'http://localhost:4010').replace(/\/+$/, '');
const DB = process.env.QA_DB_URL ?? 'postgresql://prod_owner:ownerpw@localhost:5432/runex_qa';
const SHOTS = process.env.QA_SHOTS ?? '';
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
const jax = async (p, body) => (await fetch(`${JAX}${p}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json();
const sql = (q) => execFileSync('psql', [DB, '-qAtc', q], { encoding: 'utf8' }).trim();
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const r3 = (x) => Math.round(Number(x) * 1000) / 1000;
let admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const adminId = (await api(admin, 'GET', '/auth/me')).data.id;
const shipperId = (await api(exp, 'GET', '/auth/me')).data.shipperId;
const hub = (await api(admin, 'GET', '/inter-depots/form-options')).data.deposits.find((d) => d.isMainHub);
const sfx = Date.now().toString().slice(-4);
let n = 0;
await api(admin, 'POST', '/sous-traitance/jax/referentiels');

// ---------------------------------------------------------------- A. JAX
const confier = async () => {
  n++;
  const c = (await api(exp, 'POST', '/colis', { customerName: `Q60 ${sfx}-${n}`, customerPhone: `9860${sfx}`.slice(0, 7) + (n % 10), governorate: 'Sousse', delegation: 'Akouda', address: `Rue ${n}`, goodsPrice: 45 })).data;
  await api(admin, 'POST', '/depot/reception', { code: c.barcode, depositId: hub.id });
  c.ean = (await jax('/__control/etat')).colis.find((x) => x.recu?.referenceExterne === c.trackingNumber)?.ean;
  return c;
};
const statutJax = async (c, statutId) => { await jax('/__control/statut', { ean: c.ean, statutId }); await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [c.id] }); };
const etat = (c) => sql(`SELECT p.status || '|' || coalesce(p."currentDepositId"::text,'') || '|' || st.etat FROM "Package" p JOIN "SousTraitance" st ON st."packageId"=p.id WHERE p.id='${c.id}'`);
const retourAgence = `RETOUR_DEPOT|${hub.id}|RETOUR_EN_COURS`;

console.log('\nA1. Annulé chez JAX, puis « reçu à l’entrepôt » JAX');
const a = await confier();
await statutJax(a, 4);
await statutJax(a, 7);
ok(etat(a) === retourAgence, '« Annulé » : Retour au dépôt, à l’agence qui l’avait confié', etat(a));
await statutJax(a, 9);
ok(etat(a) === retourAgence, '« reçu à l’entrepôt » (JAX) : reste Retour au dépôt — plus « Reçu au dépôt »', etat(a));
await statutJax(a, 3);
ok(etat(a) === retourAgence, '« Au dépôt JAX » : reste Retour au dépôt', etat(a));
const aAffecter = (await api(admin, 'GET', `/colis?status=RECU_DEPOT&limit=200`)).data ?? [];
ok(!aAffecter.some?.((x) => x.id === a.id), 'absent des colis « Reçu au dépôt » (Colis à affecter)');
const fiche = (await api(admin, 'GET', `/colis/${a.id}`)).data;
ok(fiche?.status === 'RETOUR_DEPOT', 'fiche du colis : « Retour au dépôt »', fiche?.status);
const tl = sql(`SELECT title FROM "PackageTimeline" WHERE "packageId"='${a.id}' ORDER BY "createdAt" DESC LIMIT 3`);
ok(/à reprendre chez JAX/.test(tl), 'chronologie : « Retour — à reprendre chez JAX par … »', tl);

console.log('\nA2. Retour vers l’expéditeur chez JAX, puis entrepôt');
const b = await confier();
await statutJax(b, 4);
await statutJax(b, 6);
ok(etat(b) === retourAgence, '« Retour expéditeur » : Retour au dépôt (plus « En retour fournisseur » sans bon)', etat(b));
await statutJax(b, 11);
await statutJax(b, 9);
ok(etat(b) === retourAgence, 'préparation au retour puis entrepôt : Retour au dépôt', etat(b));
await statutJax(b, 12);
ok(etat(b) === `RETOUR_DEPOT|${hub.id}|RETOURNE`, '« Reçu par l’expediteur » : Retour au dépôt, fiche JAX terminée', etat(b));

console.log('\nA3. L’exploitation le rend à l’expéditeur');
const bon = await api(admin, 'POST', '/retours-expediteur/bons', { shipperId, driverId: null });
ok(bon.status < 300, 'bon de retour créé', `${bon.status} ${bon.message}`);
if (bon.data?.id) {
  const s = await api(admin, 'POST', `/retours-expediteur/bons/${bon.data.id}/scan`, { code: a.barcode });
  ok(s.status < 300, 'colis en retour chez JAX scanné sur le bon de retour', `${s.status} ${s.message}`);
  const avant = sql(`SELECT status FROM "Package" WHERE id='${a.id}'`);
  await statutJax(a, 9);
  ok(sql(`SELECT status FROM "Package" WHERE id='${a.id}'`) === avant, 'sur un bon de retour : une relecture JAX ne change plus son statut', `${avant}`);
}

console.log('\nA4. Les autres parcours ne changent pas');
const l = await confier();
await statutJax(l, 4); await statutJax(l, 5);
ok(etat(l).startsWith('LIVRE||LIVRE'), 'livré par JAX : Livré');
const rep = await confier();
await statutJax(rep, 4); await statutJax(rep, 9);
ok(etat(rep).startsWith('REPORTE|'), 'sorti en livraison puis entrepôt (sans retour) : Reporté', etat(rep));

console.log('\nA5. Colis déjà mal classés (avant le correctif)');
const cassé = async (statut, statutId) => {
  const c = await confier();
  await jax('/__control/statut', { ean: c.ean, statutId });
  sql(`UPDATE "Package" SET status='${statut}', "currentDepositId"=NULL WHERE id='${c.id}'`);
  sql(`UPDATE "SousTraitance" SET etat='RETOUR_EN_COURS', "statutExterne"='reçu à l''entrepôt', "statutExterneCode"='9' WHERE "packageId"='${c.id}'`);
  return c;
};
const k1 = await cassé('RECU_DEPOT', 9);
ok(etat(k1) === 'RECU_DEPOT||RETOUR_EN_COURS', 'reproduit : « Reçu au dépôt » sans agence, en retour chez JAX', etat(k1));
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [k1.id] });
ok(etat(k1) === retourAgence, 'relecture JAX : corrigé en Retour au dépôt', etat(k1));
const k2 = await cassé('RECU_DEPOT', 9);
const k3 = await cassé('EN_RUNSHEET_RETOUR', 9);
if (process.env.RESTART_API) {
  execFileSync('bash', [process.env.RESTART_API], { env: { ...process.env, JAX_CORRECTION_DELAI_MS: '1500' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { await sleep(1000); if ((await fetch(`${API}/health`).catch(() => null))?.ok) break; }
  await sleep(6000);
  ok(etat(k2) === retourAgence && etat(k3) === retourAgence, 'au démarrage de l’API : corrigés sans appel à JAX', `${etat(k2)} / ${etat(k3)}`);
  admin = await login('admin@logixpress.tn', 'Admin123!');
} else console.log('  (RESTART_API absent : correction au démarrage non vérifiée)');

// ----------------------------------------------------------- B. Mon argent
console.log('\nB1. Argent par étape : mêmes chiffres que l’exploitation');
const hamzaRs = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
const livrer = async (prix, valider) => {
  n++;
  const c = (await api(exp, 'POST', '/colis', { customerName: `Q60 Argent ${n}`, customerPhone: `9861${sfx}`.slice(0, 7) + (n % 10), governorate: 'Tunis', delegation: 'La Marsa', address: `Rue ${n}`, goodsPrice: prix })).data;
  await api(admin, 'POST', '/depot/reception', { code: c.barcode, depositId: hub.id });
  await api(admin, 'POST', `/runsheets/${hamzaRs.id}/add-package`, { packageIdentifier: c.trackingNumber });
  await api(hamza, 'POST', `/colis/${c.id}/start`, {});
  await api(hamza, 'POST', `/colis/${c.id}/deliver`, { collectedAmount: Number(c.totalPrice) });
  if (valider) sql(`UPDATE "Payment" SET status='VALIDE', "validatedAt"=now(), "validatedByUserId"='${adminId}' WHERE "packageId"='${c.id}'`);
  return c;
};
const v1 = await livrer(60, true);
const v2 = await livrer(90, false);
const lire = async (q = '') => (await api(exp, 'GET', `/payments/mon-argent${q}`)).data;
let m = await lire();
const cand = ((await api(admin, 'GET', `/payments/vouchers/candidats?shipperId=${shipperId}`)).data ?? []).find((x) => x.shipperId === shipperId);
ok(m && r3(m.etapes.prochain.net) === r3(cand?.netEstime ?? 0) && m.etapes.prochain.livres === (cand?.livres ?? 0), '« Prochain paiement » = « À régler » de l’exploitation', `${m?.etapes.prochain.net} vs ${cand?.netEstime}`);
const ligne = (c) => m.colis.find((x) => x.id === c.id);
ok(ligne(v1)?.etape === 'PROCHAIN' && r3(ligne(v1).pourVous) === r3(Number(ligne(v1).encaisse) - Number(ligne(v1).frais)), 'colis vérifié : « Prochain paiement », pour vous = encaissé − frais', JSON.stringify(ligne(v1)));
ok(ligne(v2)?.etape === 'VERIFICATION', 'colis livré, caisse pas encore validée : « Encaissé — en vérification »', ligne(v2)?.etape);
ok(ligne(a)?.etape === 'RETOUR' && ligne(a).pourVous === 0, 'colis en retour : pas d’argent', JSON.stringify(ligne(a)));
const vAdmin = ((await api(admin, 'GET', '/payments/vouchers?limit=200')).data ?? []).filter((v) => v.shipperId === shipperId);
const aPayerAdmin = r3(vAdmin.filter((v) => v.status !== 'PAYE' && v.status !== 'ANNULE').reduce((s, v) => s + Number(v.netPayable), 0));
ok(r3(m.etapes.aPayer.montant) === aPayerAdmin, '« Prêt à être payé » = bordereaux à payer de l’exploitation', `${m.etapes.aPayer.montant} vs ${aPayerAdmin}`);
ok(r3(m.aRecevoir) === r3(m.etapes.aPayer.montant + m.etapes.prochain.net + m.etapes.verification.pourVous), '« RUNEX vous doit » = prêt + prochain + en vérification');
ok((await api(admin, 'GET', '/payments/mon-argent')).status === 403, 'réservé à l’espace expéditeur');

console.log('\nB2. Bordereau créé puis payé : l’argent avance d’étape');
const du0 = m.aRecevoir;
const v = (await api(admin, 'POST', '/payments/vouchers', { shipperId })).data;
m = await lire();
ok(ligne(v1)?.etape === 'A_PAYER' && ligne(v1)?.bordereau === v.voucherNumber, 'bordereau créé : colis « Prêt à être payé », n° de bordereau affiché', JSON.stringify(ligne(v1)));
ok(m.etapes.prochain.net === 0 && r3(m.aRecevoir) === r3(du0), 'le montant dû ne change pas, il passe d’étape');
const code = (await api(exp, 'GET', '/payments/vouchers')).data.find((x) => x.voucherNumber === v.voucherNumber)?.withdrawalCode;
await api(admin, 'POST', `/payments/vouchers/${v.voucherNumber}/validate`, { secretCode: code, paymentMethod: 'ESPECE' });
m = await lire();
ok(ligne(v1)?.etape === 'PAYE' && !!ligne(v1)?.payeLe, 'payé : colis « Payé », avec la date', JSON.stringify(ligne(v1)));
ok(r3(m.aRecevoir) === r3(du0 - Number(v.netPayable)), '« RUNEX vous doit » diminue du montant payé', `${m.aRecevoir} vs ${du0} − ${v.netPayable}`);
ok(m.etapes.paye.dernier?.numero === v.voucherNumber, 'dernier paiement affiché');
const filtre = await lire('?etape=VERIFICATION');
ok(filtre.colis.length >= 1 && filtre.colis.every((c) => c.etape === 'VERIFICATION'), 'filtre par étape');
const cherche = await lire(`?search=${v2.trackingNumber}`);
ok(cherche.colis.length === 1 && cherche.colis[0].id === v2.id, 'recherche par n° de colis');

console.log('\nB3. Écrans');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const br = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const errs = [];
const p = await br.newPage();
await p.setViewport({ width: 1440, height: 1000 });
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'expediteur@bluestar.tn'); await p.type('input[type=password]', 'Exp123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
await p.goto(`${W}/expediteur/argent`, { waitUntil: 'networkidle2' });
await p.waitForSelector('[data-testid=argent-du-montant]', { timeout: 10000 });
const lireTND = (s) => Number(String(s ?? '').replace(/[^\d,.-]/g, '').replace(',', '.'));
const du = lireTND(await p.$eval('[data-testid=argent-du-montant]', (e) => e.textContent));
ok(r3(du) === r3(m.aRecevoir), 'page « Mon argent » : « RUNEX vous doit » affiché', `${du} vs ${m.aRecevoir}`);
const navTxt = await p.evaluate(() => document.querySelector('nav, aside')?.innerText ?? document.body.innerText);
ok(/Mon argent/.test(navTxt), 'menu : « Mon argent »');
if (SHOTS) await p.screenshot({ path: `${SHOTS}/60-mon-argent.png`, fullPage: true });
await p.click('[data-testid=etape-verification]');
await sleep(1500);
const badges = await p.$$eval('[data-testid=argent-liste] [data-testid=ou-argent]', (els) => els.map((e) => e.textContent));
ok(badges.length > 0 && badges.every((b) => /vérification/.test(b)), 'appui sur l’étape 2 : seulement les colis en vérification', JSON.stringify(badges));
await p.type('[data-testid=argent-recherche]', v2.trackingNumber);
await sleep(1500);
ok((await p.$$('[data-testid=argent-liste] li')).length === 1, 'recherche d’un colis');
await p.goto(`${W}/expediteur/tableau-de-bord`, { waitUntil: 'networkidle2' });
await sleep(2000);
const tdb = lireTND(await p.$eval('[data-testid=tdb-argent-du] p.font-mono', (e) => e.textContent).catch(() => ''));
ok(r3(tdb) === r3(m.aRecevoir), 'tableau de bord : même « RUNEX vous doit »', `${tdb}`);
ok(!!(await p.$('[data-testid=tdb-voir-argent]')), 'tableau de bord : lien vers « Mon argent »');
await p.evaluate(() => { try { localStorage.setItem('runex.langue', 'ar'); } catch { /* */ } });
await p.goto(`${W}/expediteur/argent`, { waitUntil: 'networkidle2' });
await sleep(1500);
if (SHOTS) await p.screenshot({ path: `${SHOTS}/60-mon-argent-ar.png` });

// Admin : la liste JAX montre le statut Runex des retours.
const ctx = await br.createBrowserContext();
const pa = await ctx.newPage(); await pa.setViewport({ width: 1440, height: 950 });
pa.on('pageerror', (e) => errs.push(e.message));
await pa.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await pa.type('input[type=email]', 'admin@logixpress.tn'); await pa.type('input[type=password]', 'Admin123!');
await Promise.all([pa.waitForNavigation({ waitUntil: 'networkidle2' }), pa.keyboard.press('Enter')]);
await pa.goto(`${W}/sous-traitance`, { waitUntil: 'networkidle2' });
await sleep(2000);
await pa.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Colis confiés|Confiés/.test(b.innerText))?.click());
await sleep(1500);
const runexB = await pa.$eval(`[data-testid="statut-runex-${b.trackingNumber}"]`, (e) => e.textContent).catch(() => null);
ok(/Retour au dépôt/.test(runexB ?? ''), 'admin › Sous-traitance JAX : « Runex : Retour au dépôt » sur le retour', runexB);
if (SHOTS) await pa.screenshot({ path: `${SHOTS}/60-jax-admin.png` });
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));
await br.close();

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
