#!/usr/bin/env node
/**
 * QA 57 — retours JAX (retour client, 23/11) : un colis annulé par le
 * destinataire revient chez Runex. Le dernier statut JAX « Reçu par
 * l'expediteur » (l'expéditeur de JAX, c'est RUNEX) le classait « Reçu au
 * dépôt », sans agence et toujours « chez JAX » : l'exploitation ne pouvait
 * plus rien en faire (9 colis bloqués dans « Colis à affecter »).
 *
 * Attendu : « Retour au dépôt » à l'agence qui l'avait confié, fiche JAX
 * terminée, colis dans « Retours à rendre » et traitable par l'exploitation ;
 * les colis déjà bloqués sont corrigés (relecture JAX, et au démarrage).
 *
 * Prérequis : faux serveur JAX (qa/mock-jax-server.mjs, statut 12) et l'API
 * lancée avec JAX_API_URL=… JAX_API_TOKEN=test-jax JAX_SYNC_MINUTES=0.
 * RESTART_API=1 (optionnel) relance l'API pour vérifier la correction au démarrage.
 *
 *   QA_API_URL=… [QA_DB_URL=…] node qa/qa-jax-retours-recus-57.mjs
 */
import { execFileSync } from 'node:child_process';

const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const JAX = (process.env.QA_JAX_URL ?? 'http://localhost:4010').replace(/\/+$/, '');
const DB = process.env.QA_DB_URL ?? 'postgresql://prod_owner:ownerpw@localhost:5432/runex_qa';
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
let admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hub = (await api(admin, 'GET', '/inter-depots/form-options')).data.deposits.find((d) => d.isMainHub);
const shipperId = (await api(exp, 'GET', '/auth/me')).data.shipperId;
const sfx = Date.now().toString().slice(-4);
let n = 0;
const creer = async () => {
  n++;
  return (await api(exp, 'POST', '/colis', { customerName: `Q57 ${sfx}-${n}`, customerPhone: `9857${sfx}`.slice(0, 7) + (n % 10), governorate: 'Sousse', delegation: 'Akouda', address: `Rue ${n}`, goodsPrice: 45 })).data;
};
const eanDe = async (c) => (await jax('/__control/etat')).colis.find((x) => x.recu?.referenceExterne === c.trackingNumber)?.ean;
const relire = (c) => api(admin, 'POST', '/sous-traitance/jax/sync', { packageIds: [c.id] });
const etat = (id) => sql(`SELECT p.status || '|' || coalesce(p."currentDepositId"::text,'') || '|' || st.etat FROM "Package" p JOIN "SousTraitance" st ON st."packageId"=p.id WHERE p.id='${id}'`);
await api(admin, 'POST', '/sous-traitance/jax/referentiels');

console.log('\n1. Parcours d’un retour chez JAX (comme sur la capture du 23/11)');
const c = await creer();
await api(admin, 'POST', '/depot/reception', { code: c.barcode, depositId: hub.id });
ok(etat(c.id).startsWith('SOUS_TRAITE|'), 'colis confié à JAX', etat(c.id));
const ean = await eanDe(c);
await jax('/__control/statut', { ean, statutId: 4 }); await relire(c);
await jax('/__control/statut', { ean, statutId: 10 }); await relire(c);
await jax('/__control/probleme', { ean, texte: 'Commande annulée par le destinataire' });
await jax('/__control/statut', { ean, statutId: 9 }); await relire(c);
await jax('/__control/statut', { ean, statutId: 11 }); await relire(c);
const pendant = etat(c.id);
ok(pendant.endsWith('|RETOUR_EN_COURS'), 'JAX prépare le retour : retour en cours chez JAX', pendant);
await jax('/__control/statut', { ean, statutId: 12 }); await relire(c);
ok(etat(c.id) === `RETOUR_DEPOT|${hub.id}|RETOURNE`, '« Reçu par l’expediteur » : Retour au dépôt, à l’agence qui l’avait confié, fiche JAX terminée', etat(c.id));
const fiche = (await api(admin, 'GET', `/colis/${c.id}`)).data;
ok(fiche.status === 'RETOUR_DEPOT', 'fiche du colis : « Retour au dépôt »');
const tl = sql(`SELECT title FROM "PackageTimeline" WHERE "packageId"='${c.id}' ORDER BY "createdAt" DESC LIMIT 1`);
ok(/Retour reçu de JAX/.test(tl), 'chronologie : « Retour reçu de JAX à … »', tl);

console.log('\n2. L’exploitation peut le traiter');
const aRendre = (await api(admin, 'GET', '/retours-expediteur/a-rendre')).data;
const ligne = (aRendre?.expediteurs ?? aRendre ?? []).find?.((x) => x.shipperId === shipperId);
ok(!!ligne && ligne.colis >= 1, 'listé dans « Retours à rendre » de son expéditeur', JSON.stringify(ligne));
const aAffecter = (await api(admin, 'GET', `/colis?status=RECU_DEPOT&unassigned=1&limit=200`)).data ?? [];
ok(!aAffecter.some?.((x) => x.id === c.id), 'plus dans « Colis à affecter »');
const sync2 = await relire(c);
ok(etat(c.id) === `RETOUR_DEPOT|${hub.id}|RETOURNE`, 'une nouvelle relecture JAX ne le change plus', `${sync2.status} ${etat(c.id)}`);
const bon = await api(admin, 'POST', '/retours-expediteur/bons', { shipperId, driverId: null });
ok(bon.status < 300, 'bon de retour créé pour l’expéditeur', `${bon.status} ${bon.message}`);
if (bon.data?.id) {
  const scan = await api(admin, 'POST', `/retours-expediteur/bons/${bon.data.id}/scan`, { code: c.barcode });
  ok(scan.status < 300, 'colis scanné sur le bon de retour (aucun blocage « chez JAX »)', `${scan.status} ${scan.message}`);
}

console.log('\n3. Colis déjà bloqués « Reçu au dépôt » (avant le correctif)');
const bloque = async () => {
  const b = await creer();
  await api(admin, 'POST', '/depot/reception', { code: b.barcode, depositId: hub.id });
  const e = await eanDe(b);
  await jax('/__control/statut', { ean: e, statutId: 12 });
  // État laissé par l'ancienne correspondance : « Reçu au dépôt », sans agence, retour en cours chez JAX.
  sql(`UPDATE "Package" SET status='RECU_DEPOT', "currentDepositId"=NULL WHERE id='${b.id}'`);
  sql(`UPDATE "SousTraitance" SET etat='RETOUR_EN_COURS', "statutExterne"='Reçu par l''expediteur', "statutExterneCode"='12', problemes='Commande annulée par le destinataire' WHERE "packageId"='${b.id}'`);
  return b;
};
// Ancienne correspondance automatique enregistrée pour ce statut.
sql(`UPDATE "PartenaireStatut" SET etat='PRIS_EN_CHARGE', manuel=false WHERE code='12'`);
const b1 = await bloque();
ok(etat(b1.id) === 'RECU_DEPOT||RETOUR_EN_COURS', 'reproduit : « Reçu au dépôt » sans agence, bloqué chez JAX', etat(b1.id));
await relire(b1);
ok(etat(b1.id) === `RETOUR_DEPOT|${hub.id}|RETOURNE`, 'relecture JAX : corrigé en « Retour au dépôt » (malgré l’ancienne correspondance enregistrée)', etat(b1.id));
const b2 = await bloque();
if (process.env.RESTART_API) {
  execFileSync('bash', [process.env.RESTART_API], { env: { ...process.env, JAX_CORRECTION_DELAI_MS: '1500' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { await sleep(1000); if ((await fetch(`${API}/health`).catch(() => null))?.ok) break; }
  await sleep(6000);
  ok(etat(b2.id) === `RETOUR_DEPOT|${hub.id}|RETOURNE`, 'au démarrage de l’API : corrigé sans appel à JAX', etat(b2.id));
  admin = await login('admin@logixpress.tn', 'Admin123!');
} else console.log('  (RESTART_API absent : correction au démarrage non vérifiée)');

console.log('\n4. Les autres statuts ne changent pas');
const r2 = await creer();
await api(admin, 'POST', '/depot/reception', { code: r2.barcode, depositId: hub.id });
const e2 = await eanDe(r2);
await jax('/__control/statut', { ean: e2, statutId: 5 }); await relire(r2);
ok(etat(r2.id).startsWith('LIVRE||LIVRE'), '« Livré » : toujours Livré');
const r3 = await creer();
await api(admin, 'POST', '/depot/reception', { code: r3.barcode, depositId: hub.id });
const e3 = await eanDe(r3);
await jax('/__control/statut', { ean: e3, statutId: 11 }); await relire(r3);
ok(etat(r3.id).endsWith('|RETOUR_EN_COURS'), '« en cours de préparation au retour » : encore chez JAX (retour en cours)', etat(r3.id));

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
