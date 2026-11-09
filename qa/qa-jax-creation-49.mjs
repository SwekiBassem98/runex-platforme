#!/usr/bin/env node
/**
 * QA 49 — JAX : tout colis créé par l'expéditeur part aussitôt chez JAX, sans
 * confirmation de l'administrateur ni condition de zone (retours du client,
 * 09/11 : « il n'apparaît pas chez JAX », puis « l'admin doit cliquer sur
 * Confier à JAX : cette étape ne doit pas exister »).
 *
 *  1. Création (portail expéditeur, zone JAX) → colis créé chez JAX, code EAN
 *     gardé ; le colis reste « En préparation » dans Runex.
 *  2. Tant qu'il est chez JAX : ni modification ni annulation Runex ; pas
 *     d'enlèvement demandé ni de relecture avant sa réception en agence.
 *  3. Réception en agence → « Confié au partenaire JAX » sans le recréer chez
 *     JAX ; l'enlèvement peut alors être demandé.
 *  4. Sans zone cochée et sans référentiel relu : envoyé quand même (référentiel
 *     relu automatiquement). JAX en panne : échec consigné, repris à la réception.
 *     Reprise avant réception : la fiche JAX est abandonnée.
 *
 * Prérequis : faux serveur JAX (qa/mock-jax-server.mjs, port 4010) et l'API
 * lancée avec JAX_API_URL=http://localhost:4010/api JAX_API_TOKEN=test-jax JAX_SYNC_MINUTES=0.
 *
 *   QA_API_URL=… QA_WEB_URL=… QA_DB_URL=… PUPPETEER_CORE=… CHROME=… node qa/qa-jax-creation-49.mjs
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
const sql = (q) => execFileSync('psql', [DB, '-qAtc', q], { encoding: 'utf8' }).trim();
const jax = async (p, body) => (await fetch(`${JAX}${p}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json();
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const attendre = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(200); } return null; };

await jax('/__control/reset', {});
const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hub = (await api(admin, 'GET', '/inter-depots/form-options')).data.deposits.find((d) => d.isMainHub);
const lire = async (id) => (await api(admin, 'GET', `/colis/${id}`)).data;
const chezJax = async () => (await jax('/__control/etat')).colis;
const sfx = Date.now().toString().slice(-4);
let n = 0;
const nouveau = async (gov, deleg) => {
  n++;
  return (await api(exp, 'POST', '/colis', { customerName: `Q49 ${sfx}-${n}`, customerPhone: `9849${sfx}`.slice(0, 7) + n, governorate: gov, delegation: deleg, address: `Rue ${n}`, goodsPrice: 30 + n })).data;
};
const recevoir = (c) => api(admin, 'POST', '/depot/reception', { code: c.barcode, depositId: hub.id });

console.log('\n0. Paramètres JAX');
let r;
// Aucune zone cochée, référentiel jamais relu : l'envoi à la création n'en dépend pas.
r = await api(admin, 'PUT', '/sous-traitance/jax/zones', { governorates: [] });
ok(r.status === 200, 'aucune zone JAX cochée');
sql(`DELETE FROM "PartenaireGouvernorat"`);

console.log('\n1. Création par l’expéditeur → visible chez JAX');
const c = await nouveau('Sousse', 'Hammam Sousse');
ok(c?.status === 'CREE', 'colis créé (réponse immédiate, « En préparation »)', c?.status);
const recu = await attendre(async () => (await chezJax()).find((x) => x.recu?.referenceExterne === c.trackingNumber));
ok(!!recu, 'le colis apparaît chez JAX dès sa création');
ok(recu?.recu?.governorat === '12' && recu?.recu?.expediteur_name === 'RUNEX' && Number(recu?.recu?.cod) === Number(c.totalPrice), 'JAX reçoit : gouvernorat Sousse, expéditeur RUNEX, montant', JSON.stringify(recu?.recu ?? {}).slice(0, 160));
let d = await attendre(async () => { const x = await lire(c.id); return x?.sousTraitance?.codeExterne ? x : null; });
ok(d?.sousTraitance?.codeExterne === recu?.ean && d?.sousTraitance?.etat === 'EN_ATTENTE_ENLEVEMENT', 'code JAX gardé sur le colis', JSON.stringify(d?.sousTraitance ?? null).slice(0, 160));
ok(d?.status === 'CREE', 'Runex : toujours « En préparation » (ramassage et dépôt comme d’habitude)');

console.log('\n2. Verrouillé tant qu’il est chez JAX');
r = await api(exp, 'PUT', `/colis/${c.id}`, { customerPhone: '22222222' });
ok(r.status === 409 && /JAX/.test(r.message ?? ''), 'modification par l’expéditeur : refusée (JAX connaît déjà la fiche)', `${r.status} ${r.message}`);
r = await api(exp, 'POST', `/colis/${c.id}/cancel`, { reason: 'test' });
ok(r.status === 409 && /JAX/.test(r.message ?? ''), 'annulation : refusée avec un motif clair', `${r.status} ${r.message}`);
let enl = (await api(admin, 'GET', '/sous-traitance/jax/enlevements')).data ?? [];
ok(!enl.some((g) => g.colis.some((x) => x.trackingNumber === c.trackingNumber)), 'pas encore d’enlèvement proposé (colis pas en agence)');
r = await api(admin, 'POST', '/sous-traitance/jax/sync', {});
// Depuis le 10/11 : le statut d'un colis chez JAX est relu dès sa création (QA 52).
ok(r.status === 200 && sql(`SELECT "derniereSyncLe" IS NOT NULL FROM "SousTraitance" WHERE "packageId" = '${c.id}'`) === 't' && (await lire(c.id)).status === 'CREE', 'relecture automatique : statut JAX relu dès la création (« en attente » : reste En préparation)', r.message);

console.log('\n3. Réception en agence → confié à JAX (sans doublon)');
const avant = (await chezJax()).length;
r = await recevoir(c);
ok(r.status === 200, 'colis reçu au hub', r.message);
d = await attendre(async () => { const x = await lire(c.id); return x?.status === 'SOUS_TRAITE' ? x : null; });
ok(!!d, 'statut « Confié au partenaire JAX »');
ok(d?.sousTraitance?.codeExterne === recu?.ean && d?.sousTraitance?.agence === hub.name, 'même code JAX, enlèvement à l’agence qui détient le colis');
ok((await chezJax()).length === avant, 'pas de second colis créé chez JAX');
enl = (await api(admin, 'GET', '/sous-traitance/jax/enlevements')).data ?? [];
ok(enl.some((g) => g.colis.some((x) => x.trackingNumber === c.trackingNumber)), 'enlèvement : le colis est proposé');

console.log('\n4. Toute destination, échec, reprise');
ok(Number(sql(`SELECT count(*) FROM "PartenaireGouvernorat"`)) >= 24, 'référentiel JAX relu automatiquement au premier envoi');
const autre = await nouveau('Nabeul', 'Hammamet');
const recuAutre = await attendre(async () => (await chezJax()).find((x) => x.recu?.referenceExterne === autre.trackingNumber));
ok(!!recuAutre && (await lire(autre.id)).sousTraitance?.mode === 'AUTO', 'autre destination (Nabeul) : envoyée automatiquement aussi');
// Échec à la création (JAX en panne) → nouvel essai automatique à la réception.
await jax('/__control/panne', { actif: true });
const echoue = await nouveau('Sfax', 'Sakiet Ezzit');
d = await attendre(async () => { const x = await lire(echoue.id); return x?.sousTraitance?.etat === 'ECHEC_ENVOI' ? x : null; });
ok(!!d && /503|indisponible/i.test(d.sousTraitance.derniereErreur ?? ''), 'JAX en panne : échec consigné sur le colis', d?.sousTraitance?.derniereErreur);
r = await api(exp, 'PUT', `/colis/${echoue.id}`, { customerPhone: '22222223' });
ok(r.status === 200, 'échec : le colis reste modifiable par l’expéditeur', `${r.status} ${r.message}`);
await jax('/__control/panne', { actif: false });
ok(true, 'JAX rétabli');
await recevoir(echoue);
d = await attendre(async () => { const x = await lire(echoue.id); return x?.status === 'SOUS_TRAITE' ? x : null; });
ok(!!d && /^SFA\d+/.test(d.sousTraitance.codeExterne ?? ''), 'à la réception : nouvel essai réussi, confié à JAX', JSON.stringify(d?.sousTraitance ?? null).slice(0, 120));
// Reprise avant réception.
const repris = await nouveau('Sousse', 'Msaken');
await attendre(async () => (await lire(repris.id))?.sousTraitance?.codeExterne);
r = await api(admin, 'POST', `/sous-traitance/jax/colis/${repris.id}/reprendre`);
ok(r.status === 200 && /annulez le code/i.test(r.message ?? ''), 'reprise avant réception : fiche JAX abandonnée, code à annuler chez JAX', `${r.status} ${r.message}`);
d = await lire(repris.id);
ok(d.status === 'CREE' && d.sousTraitance?.etat === 'ANNULE', 'colis repris : reste « En préparation » chez Runex');
r = await api(exp, 'PUT', `/colis/${repris.id}`, { customerPhone: '22222224' });
ok(r.status === 200, 'colis repris : de nouveau modifiable', `${r.status} ${r.message}`);
await recevoir(repris);
await sleep(2000);
ok((await lire(repris.id)).status === 'RECU_DEPOT', 'colis repris : pas renvoyé automatiquement à JAX à sa réception');

console.log('\n5. Écran (fiche du colis, exploitation)');
const c2 = await nouveau('Sousse', 'Akouda');
await attendre(async () => (await lire(c2.id))?.sousTraitance?.codeExterne);
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
await p.goto(`${W}/colis/${c2.id}`, { waitUntil: 'networkidle2' }); await sleep(1500);
const encart = await p.$eval('[data-testid=jax-avant-reception]', (x) => x.innerText).catch(() => '');
ok(/Déjà créé chez JAX/.test(encart) && /SOU\d+/.test(encart), 'fiche : « Déjà créé chez JAX (code …) », confié à la réception', encart);
ok(!(await p.$('[data-testid=confier-jax]')), 'fiche : pas de bouton « Confier à JAX » (aucune confirmation à faire)');
if (SHOTS) await p.screenshot({ path: `${SHOTS}/49-fiche-jax-avant-reception.png`, fullPage: true });
await b.close();
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
