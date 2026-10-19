#!/usr/bin/env node
/**
 * QA 41 — agence de rattachement de l'expéditeur (demande du client, 19/10).
 *
 * Un expéditeur de Sousse avait ses colis « déclarés » au Hub Central Ben
 * Arous : l'agence de départ était déduite d'un gouvernorat saisi librement et
 * retombait sur le hub. L'agence est maintenant choisie sur le dossier.
 *
 *  1. Dossiers de démonstration : Ben Arous / Tunis → hub, Sousse → Agence Sousse ;
 *  2. Proposition d'agence d'après le gouvernorat (accents, agences régionales) ;
 *  3. Création d'un dossier : agence par défaut, agence choisie, agence refusée ;
 *  4. Colis créé par le compte de l'expéditeur : départ et dépôt actuel = son agence ;
 *  5. Acceptations : Magasin refuse, Agence Sousse accepte, inter-dépôt vers le hub ;
 *  6. Changement d'agence : les colis pas encore reçus suivent ;
 *  7. Reprise des données (migration) sur des dossiers anciens.
 *
 *   QA_API_URL=http://localhost:4000/api/v1 QA_DB_URL=postgresql://… node qa/qa-agence-rattachement-41.mjs
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
  return { status: r.status, data: j?.data, message: j?.message, json: j };
}
const sql = (q) => execFileSync('psql', [DB, '-qAtc', q], { encoding: 'utf8' }).trim();
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const admin = await login('admin@logixpress.tn', 'Admin123!');
const opts = (await api(admin, 'GET', '/inter-depots/form-options')).data;
const dep = (nom) => opts.deposits.find((d) => d.name === nom);
const hub = opts.deposits.find((d) => d.isMainHub);
const sousse = dep('Agence Sousse');
const nabeul = dep('Agence Nabeul');
const medenine = dep('Agence Médenine');
const stamp = Date.now().toString().slice(-6);

console.log('\n1. Dossiers de démonstration');
const liste = (await api(admin, 'GET', '/shippers?limit=50')).data ?? [];
const par = (gov) => liste.find((s) => s.governorate === gov);
ok(par('Ben Arous')?.depositId === hub.id && par('Ben Arous')?.depositName === hub.name, 'BlueStar (Ben Arous) → hub central');
ok(par('Tunis')?.depositId === hub.id, 'Benhcine (Tunis) → hub central (zone du hub)');
ok(par('Sousse')?.depositId === sousse.id && par('Sousse')?.depositName === 'Agence Sousse', 'TechStore (Sousse) → Agence Sousse');

console.log('\n2. Agence proposée d’après le gouvernorat');
const propose = async (g) => (await api(admin, 'GET', `/colis/agences-livraison?governorate=${encodeURIComponent(g)}`)).data?.suggestionRattachement;
ok((await propose('Sousse')) === sousse.id, 'Sousse → Agence Sousse');
ok((await propose('Ben Arous')) === hub.id && (await propose('Tunis')) === hub.id, 'Ben Arous, Tunis → hub central');
ok((await propose('Monastir')) === sousse.id, 'Monastir (sans agence) → Agence Sousse (régionale)');
ok((await propose('Medenine')) === medenine.id && (await propose('Médenine')) === medenine.id, 'Médenine avec ou sans accent → Agence Médenine');
ok((await propose('Gabès')) === medenine.id, 'Gabès → Agence Médenine (régionale)');

console.log('\n3. Création du dossier');
const base = (suffixe, extra = {}) => ({
  code: `EXP-Q41${suffixe}${stamp}`, companyName: `Sangour ${suffixe} ${stamp}`, phone: '73111222', email: `q41${suffixe.toLowerCase()}${stamp}@test.tn`,
  governorate: 'Sousse', address: 'Kantaoui, Sousse', ...extra,
});
let r = await api(admin, 'POST', '/shippers', base('A', {
  compte: { fullName: 'Sangour', email: `compte.q41${stamp}@test.tn`, phone: '73111222', password: 'Sangour123!' },
}));
const sangour = r.data;
ok(r.status === 201 && sangour?.depositId === sousse.id, 'sans agence indiquée : Agence Sousse (gouvernorat)', `${r.status} ${r.message} ${sangour?.depositName}`);
r = await api(admin, 'POST', '/shippers', base('B', { depositId: nabeul.id }));
ok(r.status === 201 && r.data?.depositName === 'Agence Nabeul', 'agence choisie : Agence Nabeul retenue', `${r.status} ${r.message}`);
r = await api(admin, 'POST', '/shippers', base('C', { depositId: '00000000-0000-4000-8000-000000000000' }));
ok(r.status === 400 && /Agence de rattachement/.test(r.message ?? ''), 'agence inconnue : refusée', `${r.status} ${r.message}`);
ok((await api(admin, 'GET', `/shippers/${sangour.id}`)).data?.depositName === 'Agence Sousse', 'détail du dossier : agence affichée');

console.log('\n4. Colis déclaré par l’expéditeur');
const exp = await login(`compte.q41${stamp}@test.tn`, 'Sangour123!');
ok(!!exp, 'connexion du compte expéditeur');
let n = 0;
const colis = async (token, extra = {}) => {
  n++;
  const res = await api(token, 'POST', '/colis', { customerName: `Kantaoui ${n}`, customerPhone: `9641${String(1000 + n)}`, governorate: 'Sousse', delegation: 'Hammam Sousse', address: `Kantaoui ${n}`, goodsPrice: 30, pieceCount: 1, ...extra });
  if (res.status !== 201) throw new Error(`création colis → ${res.status} ${res.message}`);
  return res.data;
};
const lire = async (id) => (await api(admin, 'GET', `/colis/${id}`)).data;
// Destinataire à Sfax : le colis passe par le hub (inter-dépôt).
const c1 = await colis(exp, { originDepositId: hub.id, governorate: 'Sfax', delegation: 'Sfax Ville' });
let d = await lire(c1.id);
ok(d.originDepositId === sousse.id && d.currentDepositId === sousse.id, 'départ et dépôt actuel = Agence Sousse (pas le hub)', `${d.originDepositName} / ${d.currentDepositName}`);
ok(d.currentDepositName === 'Agence Sousse', '« Agence de dépôt actuelle » : Agence Sousse');
const c2 = await colis(admin, { shipperId: sangour.id });
d = await lire(c2.id);
ok(d.originDepositId === sousse.id && d.currentDepositId === sousse.id, 'colis saisi par l’exploitation pour cet expéditeur : Agence Sousse');
const sugg = (await api(admin, 'GET', `/colis/agences-livraison?shipperId=${sangour.id}`)).data?.suggestionDepart;
ok(sugg === sousse.id, 'formulaire de colis : agence de départ proposée = Agence Sousse');

console.log('\n5. Acceptations et inter-dépôt');
r = await api(admin, 'POST', '/depot/reception', { code: c1.barcode, depositId: hub.id });
ok(r.status === 409 && r.data?.outcome === 'WRONG_CHANNEL' && /Agence Sousse/.test(r.message ?? ''), 'Acceptation Magasin (hub) : refusé, expéditeur rattaché à l’Agence Sousse', `${r.status} ${r.message}`);
r = await api(admin, 'POST', '/inter-depots/acceptance/scan', { code: c1.barcode, type: 'LIVRAISON', depositId: sousse.id });
ok(r.status === 200, 'Agence Sousse : colis accepté (inter dépôt livraison)', `${r.status} ${r.message}`);
d = await lire(c1.id);
ok(d.status === 'RECU_DEPOT' && d.currentDepositId === sousse.id, 'colis reçu à l’Agence Sousse');
// Agent de l'Agence Sousse : son bordereau vers le hub propose le colis.
const agentMail = `agent.sousse.q41${stamp}@test.tn`;
r = await api(admin, 'POST', '/users', { fullName: 'Agent Sousse', email: agentMail, phone: '73999888', password: 'Agent123!', role: 'MAGASINIER', depositId: sousse.id });
ok(r.status === 201, 'agent de l’Agence Sousse créé', `${r.status} ${r.message}`);
const agent = await login(agentMail, 'Agent123!');
const optsAgent = (await api(agent, 'GET', '/inter-depots/form-options')).data;
ok(optsAgent?.operatingDepositId === sousse.id, 'l’agent opère depuis l’Agence Sousse');
r = await api(agent, 'POST', '/inter-depots', { type: 'LIVRAISON', destinationDepositId: hub.id, transporterDriverId: optsAgent.drivers[0].id });
ok(r.status === 201, 'inter dépôt livraison Agence Sousse → hub créé', `${r.status} ${r.message}`);
const cand = (await api(agent, 'GET', `/inter-depots/${r.data.transferNumber}/candidates`)).data;
const candListe = Array.isArray(cand) ? cand : cand?.items ?? cand?.packages ?? [];
ok(candListe.some((p) => p.trackingNumber === c1.trackingNumber), 'le colis de l’expéditeur est proposé dans le bordereau', JSON.stringify(cand).slice(0, 160));

console.log('\n6. Changement d’agence');
r = await api(admin, 'PATCH', `/shippers/${sangour.id}`, { depositId: nabeul.id });
if (r.status === 404 || r.status === 405) r = await api(admin, 'PUT', `/shippers/${sangour.id}`, { depositId: nabeul.id });
ok(r.status === 200 && r.data?.depositName === 'Agence Nabeul', 'dossier passé à l’Agence Nabeul', `${r.status} ${r.message}`);
d = await lire(c2.id);
ok(d.originDepositId === nabeul.id && d.currentDepositId === nabeul.id, 'colis pas encore reçu : suit la nouvelle agence');
d = await lire(c1.id);
ok(d.currentDepositId === sousse.id && d.originDepositId === nabeul.id, 'colis déjà à Sousse : reste à Sousse, ses retours iront à Nabeul');
r = await api(admin, 'PATCH', `/shippers/${sangour.id}`, { depositId: null });
if (r.status === 404 || r.status === 405) r = await api(admin, 'PUT', `/shippers/${sangour.id}`, { depositId: null });
ok(r.status === 400, 'agence vidée : refusée', `${r.status}`);

console.log('\n7. Reprise des données anciennes (migration)');
const migration = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations', '20261019100000_agence_rattachement_expediteur', 'migration.sql');
const ancien = (code, gov) => sql(`UPDATE "Shipper" SET "depositId" = NULL, governorate = '${gov}' WHERE code = '${code}' RETURNING id`);
const idA = ancien(sangour.code, ' sousse ');
const idB = ancien(`EXP-Q41B${stamp}`, 'Gabès');
// Colis « déclarés au hub » comme dans la base du client.
sql(`UPDATE "Package" SET "originDepositId" = '${hub.id}', "currentDepositId" = '${hub.id}' WHERE id = '${c2.id}'`);
sql(`UPDATE "Package" SET "originDepositId" = '${hub.id}' WHERE id = '${c1.id}'`);
execFileSync('psql', [DB, '-q', '-v', 'ON_ERROR_STOP=1', '-1', '-f', migration], { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
ok(sql(`SELECT "depositId" FROM "Shipper" WHERE id = '${idA}'`) === sousse.id, '« sousse » (minuscules, espaces) → Agence Sousse');
ok(sql(`SELECT "depositId" FROM "Shipper" WHERE id = '${idB}'`) === medenine.id, '« Gabès » → Agence Médenine (régionale)');
ok(sql(`SELECT "depositId" FROM "Shipper" WHERE code = 'EXP-BLUESTAR'`) === hub.id, 'dossier déjà renseigné : inchangé');
ok(sql(`SELECT "originDepositId" || '/' || "currentDepositId" FROM "Package" WHERE id = '${c2.id}'`) === `${sousse.id}/${sousse.id}`, 'colis non reçu : départ et dépôt actuel corrigés');
ok(sql(`SELECT "originDepositId" || '/' || "currentDepositId" FROM "Package" WHERE id = '${c1.id}'`) === `${sousse.id}/${sousse.id}`, 'colis reçu : origine corrigée, position réelle conservée');
execFileSync('psql', [DB, '-q', '-v', 'ON_ERROR_STOP=1', '-1', '-f', migration], { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
ok(true, 'migration rejouable sans erreur');

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
