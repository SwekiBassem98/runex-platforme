#!/usr/bin/env node
/**
 * QA 45 — sous-traitance de la livraison au partenaire JAX.
 *
 * Nécessite le faux serveur JAX (qa/mock-jax-server.mjs, port 4010) et une API
 * démarrée avec JAX_API_URL=http://localhost:4010/api JAX_API_TOKEN=test-jax.
 *
 *  1. Référentiels JAX (gouvernorats, statuts) et zones automatiques ;
 *  2. Envoi automatique à la réception (zone JAX) et manuel (« À confier ») ;
 *  3. Ce que JAX reçoit (champs de la collection Postman) ;
 *  4. Colis verrouillé : pas de tournée, pas d'inter-dépôt, pas de modification ;
 *  5. Enlèvement par agence ;
 *  6. Relecture des statuts : pris en charge, problème, livré, retour ;
 *  7. Encaissements : l'expéditeur n'est réglé qu'après le reversement JAX ;
 *  8. Reprise avant enlèvement, retour reçu, correspondance de statut manuelle ;
 *  9. Échec d'envoi (gouvernorat inconnu de JAX) ;
 * 10. Écrans : page Sous-traitance JAX, fiche colis (exploitation), portail expéditeur.
 *
 *   QA_API_URL=… QA_WEB_URL=… QA_JAX_URL=… PUPPETEER_CORE=… CHROME=… node qa/qa-sous-traitance-jax-45.mjs
 */
import { execFileSync } from 'node:child_process';
const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const W = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const JAX = (process.env.QA_JAX_URL ?? 'http://localhost:4010').replace(/\/+$/, '');
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
  return { status: r.status, data: j?.data, message: j?.message };
}
const DB = process.env.QA_DB_URL ?? 'postgresql://prod_owner:ownerpw@localhost:5432/runex_qa';
const sql = (q) => execFileSync('psql', [DB, '-qAtc', q], { encoding: 'utf8' }).trim();
const jax = async (p, body) => (await fetch(`${JAX}${p}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json();
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const attendre = async (f, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(200); } return null; };

await jax('/__control/reset', {});
const admin = await login('admin@logixpress.tn', 'Admin123!');
const agent = await login('agent.magasin@logixpress.tn', 'Agent123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const hamzaId = (await api(hamza, 'GET', '/auth/me')).data.driverId;
const opts = (await api(admin, 'GET', '/inter-depots/form-options')).data;
const hub = opts.deposits.find((d) => d.isMainHub);
const sousse = opts.deposits.find((d) => d.name === 'Agence Sousse');
const shippers = (await api(admin, 'GET', '/shippers?limit=50')).data;
const bluestar = shippers.find((s) => s.code === 'EXP-BLUESTAR');
const lire = async (id) => (await api(admin, 'GET', `/colis/${id}`)).data;
let n = 0;
const nouveau = async (gov, deleg, extra = {}) => {
  n++;
  return (await api(exp, 'POST', '/colis', { customerName: `Client JAX ${n}`, customerPhone: `9845${String(1000 + n)}`, governorate: gov, delegation: deleg, address: `Rue ${n}`, goodsPrice: 40 + n, ...extra })).data;
};
const recevoir = (c, depositId = hub.id) => api(admin, 'POST', '/depot/reception', { code: c.barcode, depositId });

console.log('\n1. Paramètres');
let r = await api(agent, 'GET', '/sous-traitance/jax/parametres');
ok(r.status === 403, 'agent de dépôt : pas d’accès à la sous-traitance', String(r.status));
r = await api(admin, 'GET', '/sous-traitance/jax/parametres');
ok(r.status === 200 && r.data.configure === true && /4010/.test(r.data.url), 'JAX connecté (jeton présent), URL de l’API');
ok(!JSON.stringify(r.data).includes('test-jax'), 'le jeton JAX n’est jamais renvoyé');
r = await api(admin, 'POST', '/sous-traitance/jax/referentiels');
ok(r.status === 200 && r.data.gouvernorats === 24 && r.data.statuts === 8, 'référentiels JAX relus : 24 gouvernorats, 8 statuts', r.message);
const p1 = (await api(admin, 'GET', '/sous-traitance/jax/parametres')).data;
const prop = (lib) => p1.statuts.find((s) => s.libelle === lib)?.etatPropose;
ok(prop('Enlevé') === 'PRIS_EN_CHARGE' && prop('En cours de livraison') === 'EN_LIVRAISON' && prop('Livré') === 'LIVRE' && prop('Retour expéditeur') === 'RETOUR_EN_COURS' && prop('Annulé') === 'ANNULE', 'statuts JAX : correspondance proposée d’après le libellé');
r = await api(admin, 'PUT', '/sous-traitance/jax/zones', { governorates: ['Sousse', 'Sfax'] });
ok(r.status === 200 && r.data.length === 2, 'zones automatiques : Sousse, Sfax');

console.log('\n2. Envoi automatique à la réception (zone JAX)');
const cAuto = await nouveau('Sousse', 'Hammam Sousse', { packageType: 'EXCHANGE', notes: 'Appeler avant' });
r = await recevoir(cAuto);
ok(r.status === 200, 'colis reçu au hub', r.message);
let d = await attendre(async () => { const x = await lire(cAuto.id); return x.status === 'SOUS_TRAITE' ? x : null; });
ok(!!d, 'reçu → confié à JAX automatiquement (statut « Confié au partenaire JAX »)');
ok(d?.sousTraitance?.etat === 'EN_ATTENTE_ENLEVEMENT' && d.sousTraitance.mode === 'AUTO' && /^SOU\d+/.test(d.sousTraitance.codeExterne ?? ''), 'code JAX enregistré, en attente d’enlèvement', JSON.stringify(d?.sousTraitance));
ok(d?.sousTraitance?.agence === hub.name && d.currentDepositName === hub.name, 'enlèvement prévu à l’agence qui détient le colis (hub)');
const etatJax = await jax('/__control/etat');
const recu = etatJax.colis.find((x) => x.ean === d.sousTraitance.codeExterne)?.recu ?? {};
ok(recu.referenceExterne === cAuto.trackingNumber && recu.expediteur_name === 'RUNEX', 'JAX reçoit : référence = numéro Runex, expéditeur RUNEX');
ok(recu.governorat === '12' && recu.gouvernorat_pickup === 3 && recu.delegation === 'Hammam Sousse', 'JAX reçoit : gouvernorats JAX (destination Sousse = 12, enlèvement Ben Arous = 3)');
ok(Number(recu.cod) === Number(d.totalPrice) && recu.echange === 1 && /BlueStar/.test(recu.description) && /Appeler avant/.test(recu.description), 'JAX reçoit : montant, échange, expéditeur réel et instructions dans la description');
ok(/Hub Central Ben Arous/.test(recu.adresse_pickup) && recu.tel === cAuto.customerPhone, 'JAX reçoit : adresse d’enlèvement et téléphone du client');
const cHorsZone = await nouveau('Nabeul', 'Hammamet');
await recevoir(cHorsZone);
await sleep(1200);
ok((await lire(cHorsZone.id)).status === 'RECU_DEPOT', 'destination hors zone JAX : reste chez Runex');

console.log('\n3. Colis verrouillé chez JAX');
r = await api(admin, 'POST', `/colis/${cAuto.id}/assign`, { driverId: hamzaId });
ok(r.status >= 400 && /Confié au partenaire JAX/.test(r.message ?? ''), 'affectation à un livreur Runex : refusée', `${r.status} ${r.message}`);
d = await lire(cAuto.id);
ok(d.status === 'SOUS_TRAITE' && !d.assignedDriverId, 'colis toujours chez JAX, sans livreur Runex');
const listeRs = (await api(admin, 'GET', '/runsheets?limit=20')).data;
const rs = (Array.isArray(listeRs) ? listeRs : listeRs?.items ?? []).find((x) => ['BROUILLON', 'EN_ATTENTE', 'VALIDEE_DEPART', 'EN_COURS'].includes(x.status));
ok(!!rs, 'une tournée ouverte existe (base de démonstration)');
r = await api(admin, 'POST', `/runsheets/${rs?.id}/add-package`, { packageIdentifier: cAuto.trackingNumber });
ok(r.status === 409 && /Confié au partenaire JAX/.test(r.message ?? '') && (await lire(cAuto.id)).status === 'SOUS_TRAITE', 'ajout à une tournée Runex : refusé', `${r.status} ${r.message}`);
r = await api(exp, 'PATCH', `/colis/${cAuto.id}`, { customerPhone: '22222222' });
if (r.status === 404 || r.status === 405) r = await api(exp, 'PUT', `/colis/${cAuto.id}`, { customerPhone: '22222222' });
ok(r.status === 409 && /JAX/.test(r.message ?? ''), 'modification par l’expéditeur : refusée (confié à JAX)', `${r.status} ${r.message}`);
const T = (await api(admin, 'POST', '/inter-depots', { type: 'LIVRAISON', destinationDepositId: sousse.id, transporterDriverId: opts.drivers[0].id })).data;
r = await api(admin, 'POST', `/inter-depots/${T.transferNumber}/scan`, { code: cAuto.barcode, mode: 'add' });
ok(r.status >= 400, 'chargement dans un inter-dépôt : refusé', `${r.status}`);
await api(admin, 'POST', `/inter-depots/${T.transferNumber}/cancel`);

console.log('\n4. Envoi manuel (À confier)');
const el = (await api(admin, 'GET', '/sous-traitance/jax/eligibles')).data ?? [];
ok(el.some((x) => x.id === cHorsZone.id) && !el.some((x) => x.id === cAuto.id), 'à confier : colis en stock, pas ceux déjà chez JAX');
r = await api(admin, 'POST', '/sous-traitance/jax/envoyer', { packageIds: [cHorsZone.id, cAuto.id] });
const res = r.data ?? [];
ok(res.find((x) => x.packageId === cHorsZone.id)?.ok === true, 'colis de Nabeul confié à JAX à la main', JSON.stringify(res));
ok(res.find((x) => x.packageId === cAuto.id)?.ok === false && /déjà confié/.test(res.find((x) => x.packageId === cAuto.id)?.message ?? ''), 'colis déjà chez JAX : refusé, motif clair');
ok((await lire(cHorsZone.id)).sousTraitance?.mode === 'MANUEL', 'envoi manuel tracé');

console.log('\n5. Enlèvement');
let enl = (await api(admin, 'GET', '/sous-traitance/jax/enlevements')).data ?? [];
const gHub = enl.find((g) => g.depositId === hub.id);
ok(gHub?.aDemander === 2, 'hub : 2 colis à faire enlever par JAX', JSON.stringify(gHub));
r = await api(admin, 'POST', '/sous-traitance/jax/enlevements', { depositId: hub.id, note: 'Quai 2, après 14 h' });
ok(r.status === 201 && /2 colis/.test(r.message ?? ''), 'enlèvement demandé à JAX', r.message);
const pk = (await jax('/__control/etat')).enlevements.at(-1);
ok(pk?.colis_list?.length === 2 && pk.gouvernorat_id === 3 && pk.note === 'Quai 2, après 14 h' && pk.colis_statut === '10', 'JAX reçoit la demande : 2 EAN, gouvernorat du hub, note');
ok((await lire(cAuto.id)).sousTraitance?.etat === 'ENLEVEMENT_DEMANDE', 'colis : enlèvement demandé');
r = await api(admin, 'POST', '/sous-traitance/jax/enlevements', { depositId: hub.id });
ok(r.status === 409, 'rien de plus à faire enlever : 409');

console.log('\n6. Relecture des statuts JAX');
const eanA = (await lire(cAuto.id)).sousTraitance.codeExterne;
const eanB = (await lire(cHorsZone.id)).sousTraitance.codeExterne;
await jax('/__control/statut', { ean: eanA, statutId: 2 });
r = await api(admin, 'POST', '/sous-traitance/jax/sync', {});
ok(r.status === 200 && r.data.relus === 2 && r.data.changes >= 1, 'relecture : 2 colis relus', r.message);
d = await lire(cAuto.id);
ok(d.status === 'SOUS_TRAITE' && d.sousTraitance.etat === 'PRIS_EN_CHARGE' && d.sousTraitance.statutExterne === 'Enlevé', 'enlevé chez JAX → pris en charge');
ok(!d.currentDepositName, 'enlevé : le colis n’est plus dans le stock du hub');
ok(d.trackingTimeline?.some((e) => /Pris en charge par JAX/.test(e.label)), 'chronologie : « Pris en charge par JAX »');
await jax('/__control/statut', { ean: eanA, statutId: 8 });
await jax('/__control/probleme', { ean: eanA, texte: 'Client injoignable' });
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [cAuto.id] });
d = await lire(cAuto.id);
ok(d.sousTraitance.etat === 'EN_LIVRAISON' && d.sousTraitance.problemes === 'Client injoignable', 'reporté chez JAX + problème signalé : visible sur le colis');
await jax('/__control/statut', { ean: eanA, statutId: 5 });
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [cAuto.id] });
d = await lire(cAuto.id);
ok(d.status === 'LIVRE' && d.sousTraitance.etat === 'LIVRE', 'livré chez JAX → colis Livré dans Runex');
ok(Number(d.collectedAmount) === Number(d.totalPrice) && d.sousTraitance.codMontant === Number(d.totalPrice) && !d.sousTraitance.codRecuLe, 'montant encaissé par JAX, à reverser à Runex');
await jax('/__control/statut', { ean: eanA, statutId: 2 });
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [cAuto.id] });
d = await lire(cAuto.id);
ok(d.status === 'LIVRE' && d.sousTraitance.statutExterne === 'Livré', 'relecture tardive d’un ancien statut : ni retour en arrière, ni libellé contradictoire', d.sousTraitance.statutExterne);

console.log('\n7. Encaissements : expéditeur réglé après le reversement JAX');
let cand = (await api(admin, 'GET', '/payments/vouchers/candidats')).data.find((x) => x.shipperId === bluestar.id);
const livresAvant = cand?.livres ?? 0;
let liste = (await api(admin, 'GET', '/sous-traitance/jax/colis?cod=a_recevoir')).data;
ok(liste.lignes.some((l) => l.packageId === cAuto.id) && liste.codARecevoir.total >= Number(d.totalPrice), 'encaissements : montant à recevoir de JAX');
r = await api(admin, 'POST', '/sous-traitance/jax/encaissements', { packageIds: [cAuto.id] });
ok(r.status === 200, 'reversement JAX enregistré', r.message);
cand = (await api(admin, 'GET', '/payments/vouchers/candidats')).data.find((x) => x.shipperId === bluestar.id);
ok((cand?.livres ?? 0) === livresAvant + 1, 'bordereau expéditeur : colis JAX réglable une fois le montant reçu', `${livresAvant} → ${cand?.livres}`);

console.log('\n8. Retour, reprise, correspondance manuelle');
await jax('/__control/statut', { ean: eanB, statutId: 6 });
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [cHorsZone.id] });
d = await lire(cHorsZone.id);
ok(d.status === 'SOUS_TRAITE' && d.sousTraitance.etat === 'RETOUR_EN_COURS', 'retour chez JAX → retour en cours (colis encore chez JAX)');
r = await api(admin, 'POST', `/sous-traitance/jax/colis/${cHorsZone.id}/reprendre`);
ok(r.status === 409, 'déjà enlevé : reprise refusée');
r = await api(admin, 'POST', `/sous-traitance/jax/colis/${cHorsZone.id}/retour-recu`);
d = await lire(cHorsZone.id);
ok(r.status === 200 && d.status === 'RETOUR_DEPOT' && d.currentDepositName === hub.name && d.sousTraitance.etat === 'RETOURNE', 'retour JAX reçu au hub → circuit des retours Runex', r.message);
const cRep = await nouveau('Sfax', 'Sfax Ville');
await recevoir(cRep);
d = await attendre(async () => { const x = await lire(cRep.id); return x.status === 'SOUS_TRAITE' ? x : null; });
ok(!!d, 'Sfax (zone JAX) : confié automatiquement');
r = await api(admin, 'POST', `/sous-traitance/jax/colis/${cRep.id}/reprendre`);
d = await lire(cRep.id);
ok(r.status === 200 && /annulez/.test(r.message ?? '') && d.status === 'RECU_DEPOT' && d.currentDepositName === hub.name, 'reprise avant enlèvement : de nouveau en stock, rappel d’annuler chez JAX', r.message);
r = await api(admin, 'PATCH', '/sous-traitance/jax/statuts/8', { etat: 'RETOUR_EN_COURS' });
const st8 = (await api(admin, 'GET', '/sous-traitance/jax/parametres')).data.statuts.find((s) => s.code === '8');
ok(r.status === 200 && st8.etat === 'RETOUR_EN_COURS' && st8.manuel, 'correspondance « Reporté » fixée à la main');
await api(admin, 'POST', '/sous-traitance/jax/referentiels');
ok((await api(admin, 'GET', '/sous-traitance/jax/parametres')).data.statuts.find((s) => s.code === '8').etat === 'RETOUR_EN_COURS', 'relecture des référentiels : correspondance manuelle conservée');
await api(admin, 'PATCH', '/sous-traitance/jax/statuts/8', { etat: null });

console.log('\n9. Échec d’envoi');
const cEchec = await nouveau('Nabeul', 'Kélibia');
await recevoir(cEchec);
// Référentiel incomplet : Nabeul n'est plus connu chez JAX.
sql(`DELETE FROM "PartenaireGouvernorat" WHERE partenaire = 'JAX' AND nom = 'Nabeul'`);
r = await api(admin, 'POST', '/sous-traitance/jax/envoyer', { packageIds: [cEchec.id] });
const echec = r.data?.[0];
ok(echec?.ok === false && /Nabeul/.test(echec.message) && /référentiel JAX/.test(echec.message), 'gouvernorat inconnu de JAX : envoi refusé, motif clair', JSON.stringify(echec));
d = await lire(cEchec.id);
ok(d.status === 'RECU_DEPOT' && d.sousTraitance?.etat === 'ECHEC_ENVOI' && d.sousTraitance.derniereErreur, 'échec : colis resté chez Runex, erreur gardée sur la fiche');
ok(((await api(admin, 'GET', '/sous-traitance/jax/eligibles')).data ?? []).find((x) => x.id === cEchec.id)?.echecPrecedent, 'à confier : échec précédent affiché, nouvel essai possible');
await api(admin, 'POST', '/sous-traitance/jax/referentiels');
r = await api(admin, 'POST', '/sous-traitance/jax/envoyer', { packageIds: [cEchec.id] });
ok(r.data?.[0]?.ok === true && (await lire(cEchec.id)).status === 'SOUS_TRAITE', 'référentiel relu : nouvel essai réussi');

console.log('\n10. Écrans');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const txt = () => p.evaluate(() => document.body.innerText);
const voir = async (re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await txt())) return true; await sleep(150); } return false; };
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
ok(await voir(/Sous-traitance JAX/), 'menu : « Sous-traitance JAX »');
await p.goto(W + '/sous-traitance', { waitUntil: 'networkidle2' });
ok(await voir(new RegExp(cAuto.trackingNumber)), 'page : colis confiés listés');
ok(!!(await p.$('[data-testid=compteurs-jax]')) && !(await p.$('[data-testid=jax-non-configure]')), 'compteurs, JAX connecté');
await p.screenshot({ path: `${SHOTS}/45-confies.png` });
await p.click('[data-testid=onglet-aconfier]');
const cEcran = await nouveau('Monastir', 'Monastir');
await recevoir(cEcran);
await p.click('[data-testid=onglet-confies]'); await sleep(300); await p.click('[data-testid=onglet-aconfier]');
ok(await voir(new RegExp(cEcran.trackingNumber)), 'à confier : colis reçu au hub listé');
await jax('/__control/reset', {}); // nouveau cycle côté faux JAX
await api(admin, 'POST', '/sous-traitance/jax/referentiels');
await p.click(`[data-testid="choix-${cEcran.trackingNumber}"]`);
await p.click('[data-testid=envoyer-jax]');
ok(await voir(/1 colis confié\(s\) à JAX/), 'écran : colis confié à JAX');
await p.click('[data-testid=onglet-enlevements]');
ok(await voir(/Demander l’enlèvement de \d+ colis à JAX/) && (await txt()).includes(hub.name), 'enlèvements : regroupés par agence');
await p.screenshot({ path: `${SHOTS}/45-enlevements.png` });
await p.click('[data-testid=onglet-parametres]');
ok(await voir(/Connecté \(jeton présent\)/) && !!(await p.$('[data-testid=table-statuts-jax]')), 'paramètres : connexion, statuts JAX');
await p.screenshot({ path: `${SHOTS}/45-parametres.png`, fullPage: true });
await p.goto(W + `/colis/${cEcran.id}`, { waitUntil: 'networkidle2' });
ok(!!(await p.waitForSelector('[data-testid=carte-jax]', { timeout: 8000 }).catch(() => null)), 'fiche colis : carte « Livraison sous-traitée — JAX »');
ok(await voir(/Confié au partenaire JAX|Créé chez JAX/), 'fiche colis : statut confié à JAX');
ok(!!(await p.$('[data-testid=actions-jax]')) && !/Assigner Livreur/.test(await txt()), 'fiche colis : gestes de livraison Runex masqués pour un colis chez JAX');
await p.screenshot({ path: `${SHOTS}/45-fiche-admin.png` });
const cConfier = await nouveau('Kairouan', 'Kairouan');
await recevoir(cConfier);
await p.goto(W + `/colis/${cConfier.id}`, { waitUntil: 'networkidle2' });
await p.waitForSelector('[data-testid=confier-jax]', { timeout: 8000 });
await p.click('[data-testid=confier-jax]');
ok(await voir(/Confié à JAX \(code/), 'fiche colis : « Confier à JAX » depuis le colis');
await b.close();

const b2 = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const q = await b2.newPage(); await q.setViewport({ width: 1280, height: 900 });
q.on('pageerror', (e) => errs.push(e.message));
await q.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
await q.type('input[type=email]', 'expediteur@bluestar.tn'); await q.type('input[type=password]', 'Exp123!');
await Promise.all([q.waitForNavigation({ waitUntil: 'networkidle2' }), q.keyboard.press('Enter')]);
await q.goto(W + `/expediteur/colis/${cAuto.id}`, { waitUntil: 'networkidle2' });
ok(!!(await q.waitForSelector('[data-testid=expediteur-jax]', { timeout: 8000 }).catch(() => null)), 'portail expéditeur : « Livraison assurée par notre partenaire JAX »');
const tq = await q.evaluate(() => document.body.innerText);
ok(/Livré par JAX/.test(tq) && /Pris en charge par JAX/.test(tq), 'portail expéditeur : étape et chronologie JAX');
await q.screenshot({ path: `${SHOTS}/45-expediteur.png`, fullPage: true });
await q.goto(W + '/expediteur/colis?date=tous', { waitUntil: 'networkidle2' }); await sleep(1500);
ok(!!(await q.$('[data-testid=pastille-jax]')), 'portail expéditeur : pastille JAX dans la liste');
await b2.close();
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
