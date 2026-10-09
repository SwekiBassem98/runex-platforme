/**
 * QA 32 — suppression définitive des comptes (utilisateur, livreur, expéditeur).
 * API locale sur :4000, base de démonstration fraîche.
 */
const B = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
let pass = 0, fail = 0;
const ok = (c, l, d = '') => { if (c) { pass++; console.log('  ✔', l); } else { fail++; console.log('  ✘', l, d); } };
const j = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let x = null; try { x = await r.json(); } catch {} return { s: r.status, d: x?.data, m: x?.message }; };
const login = async (id, pw) => (await j(null, 'POST', '/auth/login', { identifier: id, password: pw })).d?.accessToken;
const admin = await login('admin@logixpress.tn', 'Admin123!');
const gest = await login('gestionnaire@logixpress.tn', 'Gest123!');
const sfx = Date.now().toString(36);
const CONF = { confirmation: 'SUPPRIMER' };

console.log('1. Utilisateur sans historique');
const u = await j(admin, 'POST', '/users', { fullName: 'Test Suppr ' + sfx, email: `suppr.${sfx}@runex.test`, phone: '20' + String(Date.now()).slice(-6), password: 'Motdepasse-2026', role: 'CAISSIER' });
ok(u.s === 201, 'compte créé', u.m);
const tu = await login(`suppr.${sfx}@runex.test`, 'Motdepasse-2026'); ok(!!tu, 'il se connecte');
let a = await j(admin, 'GET', `/users/${u.d.id}/suppression`);
ok(a.s === 200 && a.d.possible === true && a.d.obstacles.length === 0, 'aperçu : suppression possible', JSON.stringify(a.d));
ok(a.d.consequences.some((c) => /session/.test(c)), 'aperçu : sa session sera fermée', JSON.stringify(a.d.consequences));
ok((await j(gest, 'GET', `/users/${u.d.id}/suppression`)).s === 403, 'gestionnaire : aperçu refusé (403)');
ok((await j(gest, 'DELETE', `/users/${u.d.id}`, CONF)).s === 403, 'gestionnaire : suppression refusée (403)');
ok((await j(admin, 'DELETE', `/users/${u.d.id}`, {})).s === 400, 'sans confirmation : 400');
ok((await j(admin, 'DELETE', `/users/${u.d.id}`, { confirmation: 'oui' })).s === 400, 'mauvaise confirmation : 400');
let d = await j(admin, 'DELETE', `/users/${u.d.id}`, CONF);
ok(d.s === 200 && /supprimé définitivement/.test(d.m), 'supprimé', d.m);
ok((await j(admin, 'GET', `/users/${u.d.id}`)).s === 404, 'introuvable ensuite');
ok((await j(tu, 'GET', '/auth/me')).s === 401, 'sa session ne fonctionne plus');
ok(!(await login(`suppr.${sfx}@runex.test`, 'Motdepasse-2026')), 'il ne peut plus se connecter');
ok((await j(admin, 'DELETE', `/users/${u.d.id}`, CONF)).s === 404, 'deuxième suppression : 404');
const re = await j(admin, 'POST', '/users', { fullName: 'Test Suppr bis', email: `suppr.${sfx}@runex.test`, phone: '21' + String(Date.now()).slice(-6), password: 'Motdepasse-2026', role: 'CAISSIER' });
ok(re.s === 201, 'l’adresse est de nouveau libre', re.m);

console.log('2. Compte ayant laissé des traces dans le journal');
const adm2 = await j(admin, 'POST', '/users', { fullName: 'Admin Temporaire ' + sfx, email: `adm.${sfx}@runex.test`, phone: '24' + String(Date.now()).slice(-6), password: 'Motdepasse-2026', role: 'ADMIN_GENERAL' });
ok(adm2.s === 201, 'second administrateur créé', adm2.m);
const t2 = await login(`adm.${sfx}@runex.test`, 'Motdepasse-2026');
const zm = await j(t2, 'POST', '/users', { fullName: 'Créé par admin temporaire', email: `cree.${sfx}@runex.test`, phone: '25' + String(Date.now()).slice(-6), password: 'Motdepasse-2026', role: 'CAISSIER' });
ok(zm.s === 201, 'il agit (création de compte tracée à son nom)', zm.m);
await j(admin, 'PATCH', `/users/${adm2.d.id}`, { fullName: 'Admin Temporaire bis ' + sfx });
d = await j(admin, 'DELETE', `/users/${adm2.d.id}`, CONF);
ok(d.s === 200, 'supprimé malgré ses traces d’audit (journal intact)', d.m);
const journal = await j(admin, 'GET', `/audit?entityType=USER&entityId=${adm2.d.id}`);
const lignes = Array.isArray(journal.d) ? journal.d : [];
ok(lignes.some((l) => l.action === 'USER_SUPPRIME') && lignes.some((l) => l.action === 'USER_MODIFIE'), 'historique du compte conservé + entrée de suppression', JSON.stringify(lignes.map((l) => l.action)));
const auteurSupprime = ((await j(admin, 'GET', `/audit?userId=${adm2.d.id}&limit=50`)).d ?? []).find((e) => e.action === 'USER_CREE');
ok(auteurSupprime && /Admin Temporaire bis .* \(compte supprimé\)/.test(auteurSupprime.userName), 'ses actions restent au journal, à son nom (compte supprimé)', auteurSupprime?.userName);

console.log('3. Garde-fous');
const me = (await j(admin, 'GET', '/auth/me')).d;
a = await j(admin, 'GET', `/users/${me.id}/suppression`);
ok(a.d.possible === false && a.d.obstacles.some((o) => /propre compte/.test(o.libelle)), 'son propre compte : impossible', JSON.stringify(a.d.obstacles));
ok((await j(admin, 'DELETE', `/users/${me.id}`, CONF)).s === 409, 'son propre compte : 409');
ok((await j(admin, 'GET', '/users/pas-un-uuid/suppression')).s === 400, 'identifiant invalide : 400');

console.log('4. Livreur');
const liv = await j(admin, 'POST', '/drivers', { driverCode: 'LIV-DEL-' + sfx.slice(-4).toUpperCase(), vehicleType: 'MOTO', compte: { fullName: 'Livreur Suppr', email: `liv.${sfx}@runex.test`, phone: '22' + String(Date.now()).slice(-6), password: 'Motdepasse-2026' } });
ok(liv.s === 201, 'livreur créé', liv.m);
a = await j(admin, 'GET', `/drivers/${liv.d.id}/suppression`);
ok(a.d.possible && a.d.consequences.some((c) => /compte de connexion/.test(c)), 'aperçu : fiche + compte', JSON.stringify(a.d));
const zones = (await j(admin, 'GET', '/zones')).d ?? [];
if (zones[0]) await j(admin, 'PUT', `/drivers/${liv.d.id}/zones`, { zoneIds: [zones[0].id] });
d = await j(admin, 'DELETE', `/drivers/${liv.d.id}`, CONF);
ok(d.s === 200, 'livreur supprimé (avec ses zones)', d.m);
ok((await j(admin, 'GET', `/drivers/${liv.d.id}`)).s === 404 && !(await login(`liv.${sfx}@runex.test`, 'Motdepasse-2026')), 'fiche et compte disparus');
const hamza = ((await j(admin, 'GET', '/drivers?search=LIV-BEN-001')).d ?? [])[0];
a = await j(admin, 'GET', `/drivers/${hamza.id}/suppression`);
ok(a.d.possible === false && a.d.obstacles.length > 0, 'livreur avec historique : impossible, raisons listées', JSON.stringify(a.d.obstacles));
d = await j(admin, 'DELETE', `/drivers/${hamza.id}`, CONF);
ok(d.s === 409 && /Désactivez/.test(d.m), 'livreur avec historique : 409 + conseil', d.m);
ok((await j(admin, 'GET', `/drivers/${hamza.id}`)).s === 200, 'il est toujours là');

console.log('5. Expéditeur');
const exp = await j(admin, 'POST', '/shippers', { code: 'EXP-DEL-' + sfx.toUpperCase(), companyName: 'Suppr SARL ' + sfx, phone: '71' + String(Date.now()).slice(-6), email: `exp.${sfx}@runex.test`, governorate: 'Tunis', address: 'Rue test', compte: { fullName: 'Gérant Suppr', email: `gerant.${sfx}@runex.test`, phone: '23' + String(Date.now()).slice(-6), password: 'Motdepasse-2026' } });
ok(exp.s === 201, 'expéditeur créé avec son compte', exp.m);
a = await j(admin, 'GET', `/shippers/${exp.d.id}/suppression`);
ok(a.d.possible && a.d.consequences.some((c) => /1 compte de connexion supprimé/.test(c)), 'aperçu : entreprise + 1 compte', JSON.stringify(a.d.consequences));
d = await j(admin, 'DELETE', `/shippers/${exp.d.id}`, CONF);
ok(d.s === 200, 'expéditeur supprimé', d.m);
ok((await j(admin, 'GET', `/shippers/${exp.d.id}`)).s === 404 && !(await login(`gerant.${sfx}@runex.test`, 'Motdepasse-2026')), 'entreprise et compte disparus');
const blue = ((await j(admin, 'GET', '/shippers?search=BlueStar')).d ?? [])[0];
a = await j(admin, 'GET', `/shippers/${blue.id}/suppression`);
ok(a.d.possible === false && a.d.obstacles.some((o) => /colis/.test(o.libelle)), 'expéditeur avec colis : impossible', JSON.stringify(a.d.obstacles));
ok((await j(admin, 'DELETE', `/shippers/${blue.id}`, CONF)).s === 409, 'expéditeur avec colis : 409');
ok(!!(await login('expediteur@bluestar.tn', 'Exp123!')), 'ses comptes fonctionnent toujours');

console.log('6. Journal');
const recent = await j(admin, 'GET', '/audit?limit=30');
const entries = Array.isArray(recent.d) ? recent.d : [];
ok(entries.some((e) => e.action === 'SHIPPER_SUPPRIME') && entries.some((e) => e.action === 'DRIVER_SUPPRIME'), 'suppressions tracées');

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
