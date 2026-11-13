#!/usr/bin/env node
/**
 * QA 55 — reversement JAX automatique (retour du client, 13/11) : un colis
 * livré par JAX ne demande plus de « Reçu de JAX » manuel. JAX garde 6,500 DT
 * et le reste entre aussitôt en caisse, en finance et dans le bordereau de
 * l'expéditeur. Les colis livrés par JAX qui attendaient encore la
 * confirmation sont réglés par la migration (part de JAX comprise).
 *
 * Prérequis : faux serveur JAX et l'API lancée avec JAX_API_URL=… JAX_API_TOKEN=test-jax JAX_SYNC_MINUTES=0.
 *
 *   QA_API_URL=… [QA_DB_URL=…] [PUPPETEER_CORE=… CHROME=… QA_WEB_URL=…] node qa/qa-jax-reversement-auto-55.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const JAX = (process.env.QA_JAX_URL ?? 'http://localhost:4010').replace(/\/+$/, '');
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
const jax = async (p, body) => (await fetch(`${JAX}${p}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json();
const sql = (q) => execFileSync('psql', [DB, '-qAtc', q], { encoding: 'utf8' }).trim();
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hub = (await api(admin, 'GET', '/inter-depots/form-options')).data.deposits.find((d) => d.isMainHub);
const sfx = Date.now().toString().slice(-4);
let n = 0;
const creer = async () => {
  n++;
  return (await api(exp, 'POST', '/colis', { customerName: `Q55 ${sfx}-${n}`, customerPhone: `9855${sfx}`.slice(0, 7) + (n % 10), governorate: 'Sousse', delegation: 'Akouda', address: `Rue ${n}`, goodsPrice: 70 })).data;
};
const eanDe = async (c) => (await jax('/__control/etat')).colis.find((x) => x.recu?.referenceExterne === c.trackingNumber)?.ean;
const livrerParJax = async (c) => {
  await api(admin, 'POST', '/depot/reception', { code: c.barcode, depositId: hub.id });
  await jax('/__control/statut', { ean: await eanDe(c), statutId: 5 });
  await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [c.id] });
};
const st = (id) => sql(`SELECT etat || '|' || coalesce("fraisPartenaire"::text,'') || '|' || ("codRecuLe" IS NOT NULL) FROM "SousTraitance" WHERE "packageId"='${id}'`);
const shipperId = (await api(exp, 'GET', '/auth/me')).data.shipperId;

console.log('\n1. Livré par JAX : réglé d’office');
const avantCaisse = (await api(admin, 'GET', '/caisse/resume')).data;
const candAvant = (await api(admin, 'GET', '/payments/vouchers/candidats')).data.find((x) => x.shipperId === shipperId);
const c1 = await creer();
await livrerParJax(c1);
ok(sql(`SELECT status FROM "Package" WHERE id='${c1.id}'`) === 'LIVRE', 'colis livré par JAX → « Livré »');
ok(st(c1.id) === 'LIVRE|6.500|true', 'part de JAX 6,500 DT et reversement enregistré automatiquement', st(c1.id));
const net1 = Number(c1.totalPrice) - 6.5;
const recu = (await api(admin, 'GET', '/sous-traitance/jax/colis?cod=recu')).data;
ok(recu.lignes.some((l) => l.packageId === c1.id), '« Reversements JAX » : colis listé, sans action');
ok(!(await api(admin, 'GET', '/sous-traitance/jax/colis?cod=a_recevoir')).data.lignes.some((l) => l.packageId === c1.id), 'rien « à recevoir » à confirmer');
ok(recu.codRecu && recu.codRecu.colis >= 1, 'totaux des reversements renvoyés');

console.log('\n2. Caisse');
const apresCaisse = (await api(admin, 'GET', '/caisse/resume')).data;
ok(Math.abs(apresCaisse.recuJax - avantCaisse.recuJax - net1) < 0.001, `caisse : reversé par JAX + ${net1.toFixed(3)} DT`, `${avantCaisse.recuJax} → ${apresCaisse.recuJax}`);
ok(apresCaisse.aRecevoirJax === avantCaisse.aRecevoirJax, 'caisse : rien en attente de JAX');
ok(Math.abs(apresCaisse.fraisJax - avantCaisse.fraisJax - 6.5) < 0.001, 'caisse : part de JAX + 6,500');
const fee = Number(c1.deliveryFee);
ok(Math.abs(apresCaisse.margeNette - avantCaisse.margeNette - (fee - 6.5)) < 0.001, `bénéfice net : + ${(fee - 6.5).toFixed(3)} DT (frais ${fee.toFixed(3)} − 6,500)`);
ok(Math.abs(apresCaisse.resteExpediteurs - avantCaisse.resteExpediteurs - (Number(c1.totalPrice) - fee)) < 0.001, 'reste dû aux expéditeurs : + montant du colis − frais', `${avantCaisse.resteExpediteurs} → ${apresCaisse.resteExpediteurs}`);

console.log('\n3. Finance et bordereau expéditeur');
const candApres = (await api(admin, 'GET', '/payments/vouchers/candidats')).data.find((x) => x.shipperId === shipperId);
ok((candApres?.livres ?? 0) === (candAvant?.livres ?? 0) + 1, 'bordereau : colis JAX réglable dès sa livraison', `${candAvant?.livres} → ${candApres?.livres}`);
ok(Math.abs((candApres?.encaisse ?? 0) - (candAvant?.encaisse ?? 0) - Number(c1.totalPrice)) < 0.001, 'bordereau : montant encaissé du colis compté');
const fin = (await api(admin, 'GET', `/payments/finance/expediteurs/${shipperId}`)).data;
ok(fin?.aRegler && fin.aRegler.livres >= 1, 'Finance : colis JAX dans « À régler » de l’expéditeur');
const v = await api(admin, 'POST', '/payments/vouchers', { shipperId });
ok(v.status < 300, 'bordereau créé', `${v.status} ${v.message}`);
ok(!!sql(`SELECT "paymentVoucherId" FROM "Package" WHERE id='${c1.id}'`), 'le colis JAX est dans le bordereau');

console.log('\n4. Colis en attente avant la mise à jour (migration)');
const c2 = await creer();
await livrerParJax(c2);
sql(`UPDATE "SousTraitance" SET "codRecuLe"=NULL, "fraisPartenaire"=NULL WHERE "packageId"='${c2.id}'`);
const c3 = await creer();
await livrerParJax(c3);
sql(`UPDATE "SousTraitance" SET "fraisPartenaire"=NULL WHERE "packageId"='${c3.id}'`); // déjà reçu à la main avant la règle
const avant4 = (await api(admin, 'GET', '/sous-traitance/jax/colis?cod=a_recevoir')).data.codARecevoir;
ok(avant4.colis >= 1, 'simulation : un colis livré attend la confirmation (ancien fonctionnement)');
sql(readFileSync(new URL('../prisma/migrations/20261113000000_jax_reversement_auto/migration.sql', import.meta.url), 'utf8').replace(/--.*$/gm, ''));
ok(st(c2.id) === 'LIVRE|6.500|true', 'migration : colis en attente réglé, part de JAX 6,500', st(c2.id));
ok(st(c3.id) === 'LIVRE||true', 'migration : reversement déjà enregistré inchangé', st(c3.id));
ok((await api(admin, 'GET', '/sous-traitance/jax/colis?cod=a_recevoir')).data.codARecevoir.colis === 0, 'plus rien à confirmer');

if (process.env.PUPPETEER_CORE) {
  console.log('\n5. Écran « Reversements JAX »');
  const W = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
  const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 950 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
  await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
  await p.goto(W + '/sous-traitance', { waitUntil: 'networkidle2' });
  await p.click('[data-testid=onglet-encaissements]'); await new Promise((r) => setTimeout(r, 1500));
  const t = await p.evaluate(() => document.body.innerText);
  ok(/Reversements JAX/.test(t) && /Automatique/.test(t) && t.includes(c1.trackingNumber), 'onglet « Reversements JAX » : automatique, colis listé');
  ok(!(await p.$('[data-testid=marquer-cod-recu]')) && !/Reçu de JAX/.test(t), 'plus de bouton « Reçu de JAX » ni de cases à cocher');
  ok(/Reversé par JAX/.test(t), 'compteur « Reversé par JAX »');
  if (process.env.QA_SHOTS) await p.screenshot({ path: `${process.env.QA_SHOTS}/55-reversements-jax.png` });
  await b.close();
  ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));
}

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
