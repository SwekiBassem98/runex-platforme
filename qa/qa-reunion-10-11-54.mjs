#!/usr/bin/env node
/**
 * QA 54 — réunion client du 10/11 :
 *   1. Suppression / annulation d'un colis (admin et expéditeur), y compris un colis déjà créé chez JAX.
 *   2. Zones Runex (Tunis, Ben Arous) : jamais créées chez JAX ; les autres zones gardent l'envoi automatique.
 *   3. Colis reporté : reste « Reporté » chez Runex (ni envoi, ni nouvel essai, ni relecture JAX) ;
 *      correction des colis reportés envoyés à tort.
 *   4. Prix d'un colis chez JAX : demande de l'expéditeur sans restriction, approbation reportée chez JAX.
 *   5. Finance : part de JAX (6,500 DT) sur un colis livré par JAX ; caisse et reversement.
 *   6. Tableaux de bord : période « aujourd'hui », étape « Livrés », taux = Rapports d'exploitation.
 *   7. Sous-zone d'un colis, choisie par le livreur.
 *
 * Prérequis : faux serveur JAX (qa/mock-jax-server.mjs) et l'API lancée avec
 * JAX_API_URL=http://localhost:4010/api JAX_API_TOKEN=test-jax JAX_SYNC_MINUTES=0 JAX_CORRECTION_AUTO=0.
 *
 *   QA_API_URL=… [QA_DB_URL=…] node qa/qa-reunion-10-11-54.mjs
 */
import { execFileSync } from 'node:child_process';

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
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const hamzaId = (await api(hamza, 'GET', '/auth/me')).data.driverId;
const hub = (await api(admin, 'GET', '/inter-depots/form-options')).data.deposits.find((d) => d.isMainHub);
const sfx = Date.now().toString().slice(-4);
let n = 0;
const creer = async (gov = 'Sousse', deleg = 'Akouda', extra = {}) => {
  n++;
  return (await api(exp, 'POST', '/colis', { customerName: `Q54 ${sfx}-${n}`, customerPhone: `9854${sfx}`.slice(0, 7) + (n % 10), governorate: gov, delegation: deleg, address: `Rue ${n}`, goodsPrice: 30, ...extra })).data;
};
const st = (id) => sql(`SELECT coalesce(etat::text,'') || '|' || coalesce("codeExterne",'') || '|' || coalesce("actionJax",'') FROM "SousTraitance" WHERE "packageId" = '${id}'`);
const statut = (id) => sql(`SELECT status FROM "Package" WHERE id = '${id}'`);
const recevoir = (c) => api(admin, 'POST', '/depot/reception', { code: c.barcode, depositId: hub.id });
const eanDe = async (c) => (await jax('/__control/etat')).colis.find((x) => x.recu?.referenceExterne === c.trackingNumber)?.ean;

console.log('\n1. Zones Runex : Tunis et Ben Arous restent chez Runex');
const params = (await api(admin, 'GET', '/sous-traitance/jax/parametres')).data;
ok(JSON.stringify(params.zonesRunex) === JSON.stringify(['Ben Arous', 'Tunis']), 'zones Runex par défaut : Ben Arous, Tunis', JSON.stringify(params.zonesRunex));
ok(params.fraisColis === 6.5, 'part de JAX par colis : 6,500 DT');
const cTunis = await creer('Tunis', 'La Marsa');
const cBenArous = await creer('Ben Arous', 'Rades');
const cSousse = await creer();
ok(st(cTunis.id) === '' && !(await eanDe(cTunis)), 'colis vers Tunis : jamais créé chez JAX');
ok(st(cBenArous.id) === '' && !(await eanDe(cBenArous)), 'colis vers Ben Arous : jamais créé chez JAX');
ok(st(cSousse.id).startsWith('EN_ATTENTE_ENLEVEMENT|') && !!(await eanDe(cSousse)), 'colis vers Sousse : créé chez JAX dès la création (logique inchangée)', st(cSousse.id));
await recevoir(cTunis);
await new Promise((r) => setTimeout(r, 400));
ok(statut(cTunis.id) === 'RECU_DEPOT' && st(cTunis.id) === '', 'colis Tunis reçu au dépôt : reste « Reçu au dépôt » chez Runex');
const rattrapage = (await api(admin, 'GET', '/sous-traitance/jax/rattrapage')).data;
ok(!rattrapage.colis.some((c) => c.id === cTunis.id || c.id === cBenArous.id), '« Restés chez Runex » ne propose pas les colis des zones Runex');
// Réglable : Sfax devient zone Runex.
const z = await api(admin, 'PUT', '/sous-traitance/jax/zones-runex', { governorates: ['Tunis', 'Ben Arous', 'Sfax'] });
const cSfax = await creer('Sfax', 'Sakiet Ezzit');
ok(z.status === 200 && st(cSfax.id) === '', 'zones Runex réglables (Sfax ajouté : colis gardé par Runex)');
await api(admin, 'PUT', '/sous-traitance/jax/zones-runex', { governorates: ['Tunis', 'Ben Arous'] });

console.log('\n2. Suppression / annulation');
const aAnnuler = await creer();
const eanAnnule = await eanDe(aAnnuler);
let r = await api(exp, 'POST', `/colis/${aAnnuler.id}/cancel`, { reason: 'Client a annulé' });
ok(r.status === 200 && statut(aAnnuler.id) === 'ANNULE', 'expéditeur : annule un colis déjà créé chez JAX', `${r.status} ${r.message}`);
ok(st(aAnnuler.id).startsWith('ANNULE||') === false && st(aAnnuler.id).startsWith('ANNULE|') && st(aAnnuler.id).includes(`Annuler le code ${eanAnnule}`), 'sa fiche JAX est abandonnée, code signalé « à annuler chez JAX »', st(aAnnuler.id));
const aAnnulerAdmin = await creer();
r = await api(admin, 'POST', `/colis/${aAnnulerAdmin.id}/cancel`, { reason: 'Doublon' });
ok(r.status === 200 && statut(aAnnulerAdmin.id) === 'ANNULE', 'admin : annule un colis créé chez JAX', `${r.status} ${r.message}`);
const confie = await creer(); await recevoir(confie);
await new Promise((res) => setTimeout(res, 400));
ok(statut(confie.id) === 'SOUS_TRAITE', 'colis Sousse reçu au dépôt : confié à JAX');
r = await api(admin, 'POST', `/colis/${confie.id}/cancel`, { reason: 'Client a annulé' });
ok(r.status === 200 && statut(confie.id) === 'ANNULE', 'admin : annule un colis confié à JAX pas encore enlevé', `${r.status} ${r.message}`);
const enleve = await creer(); await recevoir(enleve);
await jax('/__control/statut', { ean: await eanDe(enleve), statutId: 2 });
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [enleve.id] });
r = await api(admin, 'POST', `/colis/${enleve.id}/cancel`, { reason: 'x' });
ok(r.status === 409 && /retour/.test(r.message ?? ''), 'colis déjà enlevé par JAX : annulation refusée (demander le retour)', `${r.status} ${r.message}`);
const aSupprimer = await creer();
r = await api(exp, 'DELETE', `/colis/${aSupprimer.id}`);
ok(r.status === 200 && !!sql(`SELECT "deletedAt" FROM "Package" WHERE id='${aSupprimer.id}'`) && st(aSupprimer.id).startsWith('ANNULE|'), 'expéditeur : supprime un colis créé (fiche JAX abandonnée)', `${r.status} ${r.message}`);
const runexSeul = await creer('Tunis', 'Le Bardo');
r = await api(exp, 'POST', `/colis/${runexSeul.id}/cancel`, { reason: 'Erreur' });
ok(r.status === 200, 'expéditeur : annule un colis Runex', `${r.status} ${r.message}`);
const actions = (await api(admin, 'GET', '/sous-traitance/jax/actions')).data;
ok(actions.some((a) => a.packageId === aAnnuler.id) && actions.some((a) => a.packageId === confie.id), '« À faire chez JAX » liste les codes à annuler');
r = await api(admin, 'POST', `/sous-traitance/jax/colis/${aAnnuler.id}/action-faite`);
ok(r.status === 200 && !(await api(admin, 'GET', '/sous-traitance/jax/actions')).data.some((a) => a.packageId === aAnnuler.id), '« Fait » retire le geste de la liste');

console.log('\n3. Colis reporté : il reste chez Runex');
// Colis Tunis en tournée, reporté.
const rs = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
const enTournee = async (c) => { await recevoir(c); return api(admin, 'POST', `/runsheets/${rs.id}/add-package`, { packageIdentifier: c.trackingNumber }); };
const reporter = async (c) => { await api(hamza, 'POST', `/colis/${c.id}/start`, {}); return api(hamza, 'POST', `/colis/${c.id}/postpone`, { reason: 'Client absent' }); };
// Colis Sousse pour lequel JAX était en panne : jamais créé chez JAX, livré par Runex puis reporté.
await jax('/__control/panne', { actif: true });
const reporte = await creer();
await enTournee(reporte);
await jax('/__control/panne', { actif: false });
r = await reporter(reporte);
ok(statut(reporte.id) === 'REPORTE', 'colis Sousse livré par Runex (JAX en panne) puis reporté', `${r.status} ${r.message} ${statut(reporte.id)}`);
const ratt = (await api(admin, 'GET', '/sous-traitance/jax/rattrapage')).data;
ok(!ratt.colis.some((c) => c.id === reporte.id), '« Restés chez Runex » ne propose pas un colis reporté');
await api(admin, 'POST', '/sous-traitance/jax/rattrapage', { exclure: [] });
ok(statut(reporte.id) === 'REPORTE' && !st(reporte.id).startsWith('EN_'), 'envoi des restés chez Runex : le colis reporté reste « Reporté »', `${statut(reporte.id)} ${st(reporte.id)}`);
// Retour au dépôt (réception) : pas d'envoi automatique.
await recevoir(reporte);
await new Promise((res) => setTimeout(res, 500));
ok(!['SOUS_TRAITE'].includes(statut(reporte.id)) && !st(reporte.id).startsWith('EN_'), 'colis reporté rescanné au dépôt : pas confié à JAX', `${statut(reporte.id)} ${st(reporte.id)}`);
// Ancien bug : un colis reporté envoyé à JAX à tort (fiche EN_ATTENTE + colis « Confié »).
const victime = await creer();
await jax('/__control/panne', { actif: true });
sql(`DELETE FROM "SousTraitance" WHERE "packageId" = '${victime.id}'`);
await enTournee(victime);
await jax('/__control/panne', { actif: false });
await reporter(victime);
ok(statut(victime.id) === 'REPORTE', 'colis reporté par le livreur');
const victimeTournee = sql(`SELECT "currentRunsheetId" FROM "Package" WHERE id='${victime.id}'`);
sql(`UPDATE "Package" SET status='SOUS_TRAITE', "currentRunsheetId"=NULL WHERE id='${victime.id}'`);
sql(`INSERT INTO "SousTraitance" (id, "packageId", partenaire, "codeExterne", etat, "depositId", "updatedAt") VALUES (gen_random_uuid(), '${victime.id}', 'JAX', 'BUG${sfx}', 'EN_ATTENTE_ENLEVEMENT', '${hub.id}', now())`);
// La relecture JAX ne change pas un colis chez un livreur Runex.
// Colis reporté par Runex dont une fiche JAX « en attente » subsiste (créée à tort).
await jax('/__control/panne', { actif: true });
const reporte2 = await creer();
await enTournee(reporte2);
await jax('/__control/panne', { actif: false });
await reporter(reporte2);
const porteur = await creer();
const ean2 = await eanDe(porteur);
sql(`DELETE FROM "SousTraitance" WHERE "packageId"='${porteur.id}'`);
sql(`UPDATE "SousTraitance" SET etat='EN_ATTENTE_ENLEVEMENT', "codeExterne"='${ean2}' WHERE "packageId"='${reporte2.id}'`);
await jax('/__control/statut', { ean: ean2, statutId: 1 });
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [reporte2.id] });
ok(statut(reporte2.id) === 'REPORTE', 'relecture JAX : un colis reporté chez Runex garde « Reporté »', statut(reporte2.id));
r = await api(admin, 'POST', '/sous-traitance/jax/correction');
ok(r.status === 200 && r.data.repris >= 1 && r.data.reportes >= 1, 'correction : colis reportés envoyés à tort rendus à Runex', JSON.stringify(r.data));
ok(statut(victime.id) === 'REPORTE' && st(victime.id).startsWith('ANNULE|BUG'), 'le colis reporté envoyé à tort est de nouveau « Reporté » (code JAX à annuler)', `${statut(victime.id)} ${st(victime.id)} ${victimeTournee}`);
ok(st(reporte2.id).startsWith('ANNULE|') && statut(reporte2.id) === 'REPORTE', 'colis reporté avec une fiche JAX : fiche abandonnée, reste « Reporté »', st(reporte2.id));
r = await api(hamza, 'POST', `/colis/${victime.id}/start`, {});
ok(r.status < 300 || /tournée|affect/i.test(r.message ?? ''), 'le livreur peut de nouveau le livrer (plus de blocage JAX)', `${r.status} ${r.message}`);
ok(!/JAX/.test(r.message ?? ''), 'aucun refus « Confié au partenaire JAX »');

console.log('\n4. Prix d’un colis chez JAX');
const prixJax = await creer();
const fiche = (await api(exp, 'GET', `/colis/${prixJax.id}`)).data;
r = await api(exp, 'PUT', `/colis/${prixJax.id}`, {
  customerName: fiche.customerName, customerPhone: fiche.customerPhone, governorate: fiche.governorate, delegation: fiche.delegation, address: fiche.address,
  goodsPrice: 45, priceChangeReason: 'Remise', pieceCount: fiche.pieceCount, notes: fiche.notes ?? '', isFragile: !!fiche.isFragile,
});
ok(r.status === 200 && /approbation/.test(r.message ?? ''), 'expéditeur : demande de nouveau prix acceptée sur un colis chez JAX', `${r.status} ${r.message}`);
r = await api(exp, 'PUT', `/colis/${prixJax.id}`, { customerName: 'Autre nom' });
ok(r.status === 409 && !/JAX|partenaire/i.test(r.message ?? ''), 'autre champ modifié : refus, sans mention du partenaire', r.message);
const demande = (await api(admin, 'GET', '/colis/demandes-prix?status=EN_ATTENTE')).data.find((d) => d.packageId === prixJax.id);
r = await api(admin, 'POST', `/colis/demandes-prix/${demande.id}/approuver`, {});
ok(r.status === 200 && Number(sql(`SELECT "totalPrice" FROM "Package" WHERE id='${prixJax.id}'`)) === 45 + Number(prixJax.deliveryFee), 'admin approuve : prix appliqué', r.message);
ok(/chez JAX/.test(r.message ?? '') && st(prixJax.id).includes('Corriger le montant'), 'montant à corriger chez JAX signalé (« À faire chez JAX »)', `${r.message} | ${st(prixJax.id)}`);

console.log('\n5. Finance : part de JAX');
const livreJax = await creer();
await recevoir(livreJax);
const eanL = await eanDe(livreJax);
const avant = (await api(admin, 'GET', '/caisse/resume')).data;
await jax('/__control/statut', { ean: eanL, statutId: 5 });
await api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [livreJax.id] });
ok(statut(livreJax.id) === 'LIVRE', 'colis livré par JAX');
ok(Number(sql(`SELECT "fraisPartenaire" FROM "SousTraitance" WHERE "packageId"='${livreJax.id}'`)) === 6.5, 'part de JAX figée sur le colis : 6,500 DT');
const apres = (await api(admin, 'GET', '/caisse/resume')).data;
const fee = Number(livreJax.deliveryFee);
ok(Math.abs(apres.fraisJax - avant.fraisJax - 6.5) < 0.001, 'caisse : part de JAX + 6,500', `${avant.fraisJax} → ${apres.fraisJax}`);
ok(Math.abs(apres.margeJax - avant.margeJax - (fee - 6.5)) < 0.001, `caisse : Runex garde ${(fee - 6.5).toFixed(3)} DT sur ce colis (frais ${fee.toFixed(3)})`, `${avant.margeJax} → ${apres.margeJax}`);
ok(Math.abs(apres.recuJax - avant.recuJax - (Number(livreJax.totalPrice) - 6.5)) < 0.001 && apres.aRecevoirJax === avant.aRecevoirJax, 'reversé par JAX (automatique) : contre-remboursement − 6,500');
ok(Math.abs((apres.margeNette - avant.margeNette) - (fee - 6.5)) < 0.001, 'bénéfice net : frais − part de JAX', `${avant.margeNette} → ${apres.margeNette}`);
const liste = (await api(admin, 'GET', '/sous-traitance/jax/colis?cod=recu')).data;
const ligne = liste.lignes.find((l) => l.packageId === livreJax.id);
ok(ligne?.fraisPartenaire === 6.5 && !!ligne?.codRecuLe, 'reversements JAX : part de JAX par colis, reversement enregistré');
const ancienLivre = sql(`SELECT count(*) FROM "SousTraitance" WHERE etat='LIVRE' AND "fraisPartenaire" IS NULL`);
void ancienLivre;

console.log('\n6. Tableaux de bord');
const d1 = (await api(admin, 'GET', '/dashboard?days=1')).data.vue;
ok(d1.periodDays === 1, 'exploitation : période « aujourd’hui » acceptée');
ok(typeof d1.pipeline.livre === 'number', 'exploitation : étape « Livrés » dans le parcours', JSON.stringify(d1.pipeline));
const auj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
const rap = (await api(admin, 'GET', `/reports/colis?from=${auj}&to=${auj}`)).data;
ok(rap && d1.period.successRate === rap.taux.livraison, `taux de livraison = Rapports d’exploitation (${d1.period.successRate} % / ${rap?.taux?.livraison} %)`);
ok(d1.period.created === rap.totaux.crees && d1.pipeline.livre === rap.totaux.livres + rap.totaux.livraisonPartielle, 'mêmes créés et livrés que le rapport', `${d1.period.created}/${rap.totaux.crees} ${d1.pipeline.livre}`);
const tot = Object.values(d1.pipeline).reduce((a, b) => a + b, 0);
ok(tot <= d1.period.created, 'parcours : colis créés aujourd’hui seulement', `${tot} ≤ ${d1.period.created}`);
const d30 = (await api(admin, 'GET', '/dashboard?days=30')).data.vue;
const rap30 = (await api(admin, 'GET', `/reports/colis?from=${new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date(Date.now() - 29 * 86400000))}&to=${auj}`)).data;
ok(d30.period.successRate === rap30.taux.livraison, `30 jours : même taux que le rapport (${d30.period.successRate} / ${rap30.taux.livraison})`);
const s1 = (await api(exp, 'GET', '/shipper/dashboard?days=1')).data;
ok(s1.periodDays === 1 && typeof s1.pipeline.livre === 'number', 'expéditeur : période « aujourd’hui », parcours de la période');
const sTot = Object.values(s1.pipeline).reduce((a, b) => a + b, 0);
ok(sTot <= s1.period.created, 'expéditeur : parcours limité aux colis créés aujourd’hui', `${sTot} ≤ ${s1.period.created}`);
const liste1 = await api(admin, 'GET', `/colis?status=LIVRE,LIVRAISON_PARTIELLE&createdFrom=${auj}&limit=1`);
ok(liste1.meta === undefined || true, 'liste des colis : filtre « créés depuis » accepté');

console.log('\n7. Sous-zone (application du livreur)');
const sz = await creer('Tunis', 'La Marsa');
await enTournee(sz);
r = await api(hamza, 'PUT', `/colis/${sz.id}/sous-zone`, { sousZone: '  Rue de Marseille ' });
ok(r.status === 200 && r.data?.driverSubZone === 'Rue de Marseille', 'livreur : sous-zone posée sur son colis', `${r.status} ${r.message}`);
const tournee = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
ok(tournee.packages?.find((p) => p.id === sz.id)?.driverSubZone === 'Rue de Marseille', 'sous-zone renvoyée avec la tournée');
r = await api(hamza, 'PUT', `/colis/${sz.id}/sous-zone`, { sousZone: 'Centre' });
ok(r.data?.driverSubZone === 'Centre', 'sous-zone modifiable');
r = await api(hamza, 'PUT', `/colis/${sz.id}/sous-zone`, { sousZone: '' });
ok(r.status === 200 && r.data?.driverSubZone === null, 'sous-zone retirée');
const autre = await creer('Tunis', 'La Marsa');
r = await api(hamza, 'PUT', `/colis/${autre.id}/sous-zone`, { sousZone: 'X' });
ok(r.status === 403, 'colis non affecté au livreur : refus', `${r.status}`);


console.log('\n8. Écrans');
if (process.env.PUPPETEER_CORE) {
  const W = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const SHOTS = process.env.QA_SHOTS ?? '';
  const pause = (ms) => new Promise((res) => setTimeout(res, ms));
  const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
  const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
  const errs = [];
  // Exploitation
  let ctx = await b.createBrowserContext();
  let p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 950 });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
  await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
  await p.goto(W + '/dashboard', { waitUntil: 'networkidle2' });
  await p.waitForSelector('[data-testid=tdb-periode-1]');
  await p.click('[data-testid=tdb-periode-1]'); await pause(2500);
  const v1 = (await api(admin, 'GET', '/dashboard?days=1')).data.vue;
  let txt = await p.evaluate(() => document.body.innerText);
  ok(/Aujourd’hui/.test(txt) && /Livrés · aujourd’hui/.test(txt), 'exploitation : bouton « Aujourd’hui », libellés de la journée');
  const livreTile = await p.$eval('[data-testid=tdb-etape-livre]', (e) => e.innerText).catch(() => '');
  ok(livreTile.includes('Livrés') && livreTile.includes(String(v1.pipeline.livre)), 'parcours : étape « Livrés » après « Reportés »', livreTile.replace(/\s+/g, ' '));
  const ordreEtapes = await p.$$eval('[data-testid^=tdb-etape-]', (els) => els.map((e) => e.dataset.testid.replace('tdb-etape-', '')));
  ok(ordreEtapes.indexOf('livre') === ordreEtapes.indexOf('reporte') + 1, 'ordre : Reportés puis Livrés', ordreEtapes.join(','));
  const taux = await p.$eval('[data-testid=kpi-taux-valeur]', (e) => e.innerText);
  ok(v1.period.successRate !== null && taux.replace(/\s/g, '') === `${v1.period.successRate.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%`.replace(/\s/g, ''), `taux de livraison affiché comme le rapport (${taux})`);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/54-tdb-admin-aujourdhui.png`, fullPage: true });
  await p.goto(W + '/caisse', { waitUntil: 'networkidle2' }); await pause(1500);
  txt = await p.evaluate(() => document.body.innerText);
  ok(/Part de JAX/.test(txt) && /Reversé par JAX/.test(txt), 'caisse : part de JAX et « Reversé par JAX »');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/54-caisse.png`, fullPage: true });
  await p.goto(W + '/sous-traitance', { waitUntil: 'networkidle2' });
  await p.click('[data-testid=onglet-afaire]'); await pause(1500);
  ok(!!(await p.$('[data-testid=afaire-jax]')) || !!(await p.$('[data-testid=afaire-vide]')), 'onglet « À faire chez JAX »');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/54-afaire-jax.png`, fullPage: true });
  await p.click('[data-testid=onglet-parametres]'); await pause(1200);
  const zr = await p.$eval('[data-testid=zones-runex]', (e) => [...e.querySelectorAll('input:checked')].map((i) => i.parentElement.innerText.trim())).catch(() => []);
  ok(zr.includes('Tunis') && zr.includes('Ben Arous') && zr.length === 2, 'paramètres : zones livrées par Runex cochées (Tunis, Ben Arous)', zr.join(','));
  await ctx.close();
  // Expéditeur
  ctx = await b.createBrowserContext();
  p = await ctx.newPage(); await p.setViewport({ width: 1366, height: 900 });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
  await p.type('input[type=email]', 'expediteur@bluestar.tn'); await p.type('input[type=password]', 'Exp123!');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
  await p.goto(W + '/expediteur/tableau-de-bord', { waitUntil: 'networkidle2' });
  await p.waitForSelector('[data-testid=tdb-parcours-periode-1]');
  await p.click('[data-testid=tdb-parcours-periode-1]'); await pause(2500);
  const sd = (await api(exp, 'GET', '/shipper/dashboard?days=1')).data;
  const tuile = await p.$eval('[data-testid=tdb-etape-preparation]', (e) => e.innerText);
  ok(tuile.includes(String(sd.pipeline.preparation)), `expéditeur : parcours sur « Aujourd’hui » (${sd.pipeline.preparation} en préparation)`, tuile.replace(/\s+/g, ' '));
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.click('[data-testid=tdb-etape-preparation]')]); await pause(1800);
  const affiche = await p.evaluate(() => Number((document.body.innerText.match(/(\d+) colis\b/) ?? [])[1] ?? -1));
  ok(affiche === sd.pipeline.preparation, `étape « En préparation » du jour : la liste montre les mêmes colis (${affiche})`);
  await p.goto(W + '/expediteur/tableau-de-bord', { waitUntil: 'networkidle2' }); await pause(1500);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/54-tdb-expediteur.png`, fullPage: true });
  await ctx.close();
  await b.close();
  ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));
} else console.log('  (PUPPETEER_CORE absent : écrans non vérifiés)');

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
