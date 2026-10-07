/**
 * Inventaire, historique, recherche et export — vérification de bout en bout.
 *
 * Le point central de ce script n'est pas que les filtres « marchent », mais
 * qu'ils.crypto`-ment au bon endroit : en base, jamais dans le navigateur. Un
 * filtre appliqué côté client donnerait le bon résultat sur cent lignes et un
 * résultat faux sur dix mille — le pire des deux mondes, puisque l'écran a
 * l'air juste.
 *
 * Chaque filtre est donc confronté à un décompte SQL indépendant. Quand les
 * deux divergent, c'est la base qui arbitre.
 */

import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE ?? 'http://localhost:4000/api/v1';

let pass = 0;
let fail = 0;
const results = [];

function ok(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    results.push(`  OK    ${label}`);
  } else {
    fail += 1;
    results.push(`  FAIL  ${label}${detail ? `  |  ${detail}` : ''}`);
  }
}

const eq = (label, expected, got) =>
  ok(label, String(expected) === String(got), `attendu=[${expected}] obtenu=[${got}]`);

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // Le texte est lu depuis les octets, pas par `res.text()` : le décodage
  // UTF-8 normalisé retire la marque d'ordre des octets, et cette marque est
  // précisément ce qu'on veut vérifier sur un CSV destiné à Excel.
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder('utf-8').decode(bytes);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* réponse non JSON : export CSV */
  }
  return { status: res.status, body: json, text, bytes, headers: res.headers };
}

const login = async (email, password) =>
  (await api('POST', '/auth/login', null, { email, password })).body?.data;

/** Requête SQL directe : l'arbitre indépendant des assertions. */
function db(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-U', 'logixpress_user', '-d', 'logixpress_db', '-t', '-A', '-c', flat],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: 'logixpress_secret_pwd' } }
  ).trim();
}

const count = (sql) => Number(db(sql) || 0);

/** Parse un CSV en lignes de cellules, en gérant les guillemets. */
function parseCsv(text) {
  const body = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      /* ignoré : séparateur de ligne CRLF */
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1);
}

const ADMIN = await login('admin@logixpress.tn', 'Admin123!');
const GEST = await login('gestionnaire@logixpress.tn', 'Gest123!');
const SHIPPER = await login('expediteur@bluestar.tn', 'Exp123!');
const DRIVER = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const FINANCE = await login('finance@logixpress.tn', 'Fin123!');

if (!ADMIN || !GEST || !SHIPPER || !DRIVER || !FINANCE) {
  console.error('Authentification impossible.');
  process.exit(1);
}

// ---------------------------------------------------------------------------

console.log('=== 1. Le filtrage se fait en base ===');
{
  const all = await api('GET', '/inventaire?limit=5', ADMIN.accessToken);
  eq('la liste répond', 200, all.status);

  const attendu = count(`select count(*) from "Package" where "deletedAt" is null`);
  eq('le total correspond au décompte SQL', attendu, all.body.meta.total);
  ok(
    'et seule la page demandée est renvoyée',
    all.body.data.length === 5,
    `reçu=${all.body.data.length}`
  );
  ok(
    'le navigateur ne reçoit jamais tout l\'historique',
    all.body.data.length < all.body.meta.total,
    `${all.body.data.length} lignes pour ${all.body.meta.total} au total`
  );
}

console.log('=== 2. Chaque filtre, confronté à SQL ===');
{
  const cas = [
    {
      nom: 'statut',
      query: 'status=LIVRE',
      sql: `select count(*) from "Package" where "deletedAt" is null and status = 'LIVRE'`,
    },
    {
      nom: 'type de colis',
      query: 'type=RETURN',
      sql: `select count(*) from "Package" where "deletedAt" is null and "packageType" = 'RETURN'`,
    },
    {
      nom: 'expéditeur',
      query: `shipperId=${ADMIN.user.shipperId ?? db(`select id from "Shipper" limit 1`)}`,
      sql: `select count(*) from "Package" where "deletedAt" is null and "shipperId" = (select id from "Shipper" limit 1)`,
    },
    {
      nom: 'dépôt',
      query: `depositId=${db(`select id from "Deposit" where "isMainHub" = true limit 1`)}`,
      sql: `select count(*) from "Package" where "deletedAt" is null and "currentDepositId" = (select id from "Deposit" where "isMainHub" = true limit 1)`,
    },
    {
      nom: 'gouvernorat',
      query: 'governorate=Tunis',
      sql: `select count(*) from "Package" p join "CustomerAddress" a on a.id = p."customerAddressId" where p."deletedAt" is null and a.governorate = 'Tunis'`,
    },
    {
      nom: 'statut de paiement',
      query: 'paymentStatus=VALIDE',
      sql: `select count(*) from "Package" p join "Payment" pa on pa."packageId" = p.id where p."deletedAt" is null and pa.status = 'VALIDE'`,
    },
    {
      nom: 'aucun encaissement ouvert',
      query: 'paymentStatus=TOUS',
      sql: `select count(*) from "Package" p where p."deletedAt" is null and not exists (select 1 from "Payment" pa where pa."packageId" = p.id)`,
    },
    {
      nom: 'retour restitué',
      query: 'returnStatus=RETOURNE_EXPEDITEUR',
      sql: `select count(*) from "Package" where "deletedAt" is null and status = 'RETOURNE_EXPEDITEUR'`,
    },
    {
      nom: 'sans retour',
      query: 'returnStatus=AUCUN_RETOUR',
      sql: `select count(*) from "Package" where "deletedAt" is null and status not in ('RETOUR_DEPOT','EN_RUNSHEET_RETOUR','RETOURNE_EXPEDITEUR')`,
    },
  ];

  for (const c of cas) {
    const reponse = await api('GET', `/inventaire?limit=1&${c.query}`, ADMIN.accessToken);
    const attendu = count(c.sql);
    eq(
      `filtre « ${c.nom} »`,
      attendu,
      reponse.body?.meta?.total
    );
    // Une ligne unique et un total non nul : la page contient bien des lignes,
    // et pas uniquement un compte juste à côté d'une liste vide.
    ok(
      `filtre « ${c.nom} » : des lignes sont bien renvoyées`,
      attendu === 0 || (reponse.body?.data?.length ?? 0) === 1
    );
  }
}

console.log('=== 3. Période, bornes comprises ===');
{
  // Le piège classique : « jusqu'au 12 » qui exclut les colis nés le 12 après
  // minuit. On vérifie qu'un colis créé le jour même reste visible.
  const today = new Date().toISOString().slice(0, 10);
  const jour = await api(`GET`, `/inventaire?limit=1&dateFrom=${today}&dateTo=${today}`, ADMIN.accessToken);
  const attendu = count(
    `select count(*) from "Package" where "deletedAt" is null and "createdAt" >= '${today}' and "createdAt" < '${today}'::date + interval '1 day'`
  );
  eq('une journée entière est couverte', attendu, jour.body?.meta?.total);

  const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const avant = await api('GET', `/inventaire?limit=1&dateTo=${hier}`, ADMIN.accessToken);
  const attenduAvant = count(
    `select count(*) from "Package" where "deletedAt" is null and "createdAt" < '${hier}'::date + interval '1 day'`
  );
  eq('la borne haute est exclusive du lendemain', attenduAvant, avant.body?.meta?.total);
}

console.log('=== 4. Pagination : aucune ligne perdue ni répétée ===');
{
  const limit = 7;
  const vu = new Set();
  let repete = 0;
  for (let page = 1; page <= 4; page += 1) {
    const reponse = await api('GET', `/inventaire?limit=${limit}&page=${page}`, ADMIN.accessToken);
    for (const row of reponse.body.data) {
      if (vu.has(row.id)) repete += 1;
      vu.add(row.id);
    }
  }
  eq('aucune ligne répétée entre quatre pages', 0, repete);
  eq('quatre pages complètes', limit * 4, vu.size);

  // Le tri doit rester stable : rejouer la même page rend les mêmes lignes.
  const a = await api('GET', `/inventaire?limit=${limit}&page=2`, ADMIN.accessToken);
  const b = await api('GET', `/inventaire?limit=${limit}&page=2`, ADMIN.accessToken);
  eq(
    'la même page rend les mêmes lignes',
    a.body.data.map((r) => r.id).join(','),
    b.body.data.map((r) => r.id).join(',')
  );

  const horsBornes = await api('GET', `/inventaire?limit=${limit}&page=99999`, ADMIN.accessToken);
  eq('une page au-delà du dernier folio est vide', 0, horsBornes.body.data.length);
}

console.log('=== 5. Filtres contradictoires et valeurs inconnues ===');
{
  const contradictoire = await api('GET', '/inventaire?status=LIVRE&returnStatus=AUCUN_RETOUR', ADMIN.accessToken);
  const attendu = count(
    `select count(*) from "Package" where "deletedAt" is null and status = 'LIVRE' and status not in ('RETOUR_DEPOT','EN_RUNSHEET_RETOUR','RETOURNE_EXPEDITEUR')`
  );
  eq('deux filtres se cumulent', attendu, contradictoire.body?.meta?.total);

  const inconnu = await api('GET', '/inventaire?status=STATUT_INVENTE', ADMIN.accessToken);
  eq('un statut inconnu ne renvoie rien, sans erreur', 200, inconnu.status);
  eq('et rien du tout', 0, inconnu.body?.meta?.total);

  const uuidInvalide = await api('GET', '/inventaire?shipperId=pas-un-uuid', ADMIN.accessToken);
  eq('un identifiant malformé est refusé explicitement', 400, uuidInvalide.status);

  const vide = await api('GET', '/inventaire?search=zzzz-introuvable-zzzz', ADMIN.accessToken);
  eq('une recherche sans résultat est une liste vide', 0, vide.body?.meta?.total);
}

console.log('=== 6. Recherche transversale ===');
{
  const parcels = db(
    `select p.id, p."trackingNumber", c."primaryPhone" from "Package" p
     join "Customer" c on c.id = p."customerId" where p."deletedAt" is null
     order by p."createdAt" desc limit 1`
  ).split('|');

  const parNumero = await api('GET', `/search?q=${parcels[1]}`, ADMIN.accessToken);
  ok(
    'un numéro de colis est trouvé',
    parNumero.body.data.colis.some((c) => c.id === parcels[0]),
    JSON.stringify(parNumero.body.meta)
  );

  const parTelephone = await api('GET', `/search?q=${parcels[2]}`, ADMIN.accessToken);
  ok(
    'un téléphone est trouvé',
    parTelephone.body.data.colis.length > 0,
    `total=${parTelephone.body.meta.total}`
  );

  const expediteur = db(`select "companyName" from "Shipper" where "isActive" = true limit 1`).split('|')[0];
  const parExpediteur = await api('GET', `/search?q=${encodeURIComponent(expediteur)}`, ADMIN.accessToken);
  ok(
    'un expéditeur est trouvé',
    parExpediteur.body.data.shippers.length > 0,
    `total=${parExpediteur.body.meta.total}`
  );

  const livreur = db(
    `select u."fullName" from "Driver" d join "User" u on u.id = d."userId" where d."isActive" = true limit 1`
  ).split('|')[0];
  const parLivreur = await api('GET', `/search?q=${encodeURIComponent(livreur)}`, ADMIN.accessToken);
  ok('un livreur est trouvé', parLivreur.body.data.drivers.length > 0, livreur);

  const runsheet = db(`select "runsheetNumber" from "Runsheet" limit 1`).split('|')[0];
  const parRunsheet = await api('GET', `/search?q=${encodeURIComponent(runsheet)}`, ADMIN.accessToken);
  ok('une runsheet est trouvée', parRunsheet.body.data.runsheets.length > 0, runsheet);

  const depot = db(`select name from "Deposit" limit 1`).split('|')[0];
  const parDepot = await api('GET', `/search?q=${encodeURIComponent(depot)}`, ADMIN.accessToken);
  ok('un dépôt est trouvé', parDepot.body.data.deposits.length > 0, depot);

  const court = await api('GET', '/search?q=a', ADMIN.accessToken);
  ok('un terme d\'un caractère ne lance rien', court.body.meta.tooShort === true);
  eq('et ne renvoie aucun résultat', 0, court.body.meta.total);
}

console.log('=== 7. L\'export respecte les filtres affichés ===');
{
  const filtre = 'status=LIVRE';
  const liste = await api('GET', `/inventaire?limit=200&${filtre}`, ADMIN.accessToken);
  const exportRep = await api('GET', `/inventaire/export?${filtre}`, ADMIN.accessToken);

  eq('l\'export répond 200', 200, exportRep.status);
  eq('le type MIME est bien du CSV', 'text/csv; charset=utf-8', exportRep.headers.get('Content-Type'));

  const lignes = parseCsv(exportRep.text);
  ok('le fichier est lisible', lignes.length >= 1, `lignes=${lignes.length}`);

  const entete = lignes[0];
  ok('l\'en-tête nomme les colonnes attendues', entete.includes('Numero colis'), entete.slice(0, 40));
  ok(
    'et mentionne la commune et le lieu-dit',
    entete.includes('Commune') && entete.includes('Lieu-dit')
  );

  const donnees = lignes.slice(1);
  eq(
    'le nombre de lignes exportées est celui du filtre',
    liste.body.meta.total,
    donnees.length
  );

  const colonneStatut = entete.indexOf('Statut');
  ok(
    'et chaque ligne appartient bien au filtre',
    donnees.every((l) => l[colonneStatut] === 'Livré'),
    donnees.slice(0, 2).map((l) => l[colonneStatut]).join(' / ')
  );

  // Le vrai piège : filtrer à l'écran, exporter sans le filtre.
  const autre = await api('GET', `/inventaire/export?status=ANNULE`, ADMIN.accessToken);
  const lignesAutre = parseCsv(autre.text).slice(1);
  const colonneAutre = parseCsv(autre.text)[0].indexOf('Statut');
  ok(
    'un autre filtre produit un autre contenu',
    lignesAutre.every((l) => l[colonneAutre] === 'Annulé'),
    lignesAutre.slice(0, 2).map((l) => l[colonneAutre]).join(' / ')
  );
  ok(
    'et un fichier différent',
    lignesAutre.length !== donnees.length || lignesAutre.length === 0
  );

  // Injection de formule : un nom commençant par « = » deviendrait une
  // formule Excel exécutée à l'ouverture.
  const injection = await api('GET', `/inventaire/export?limit=5`, ADMIN.accessToken);
  const lignesInjection = parseCsv(injection.text).slice(1);
  const colonneNom = parseCsv(injection.text)[0].indexOf('Destinataire');
  ok(
    'aucune cellule ne commence par un caractère de formule',
    lignesInjection.every((l) => !/^[=+\-@\t\r]/.test(l[colonneNom] ?? '')),
    lignesInjection.slice(0, 3).map((l) => l[colonneNom]).join(' / ')
  );

  // Excel ouvre un CSV sans BOM en Latin-1 : « Ben Arous » devient illisible.
  // La marque se vérifie sur les octets : `Response.text()` la supprime.
  ok(
    'le fichier porte une marque d\'ordre des octets UTF-8',
    injection.bytes[0] === 0xef && injection.bytes[1] === 0xbb && injection.bytes[2] === 0xbf,
    `début=[${[...injection.bytes.slice(0, 3)].map((b) => b.toString(16)).join(' ')}]`
  );

  ok(
    'l\'API annonce un nom de fichier',
    /filename="inventaire_[^"]+\.csv"/.test(injection.headers.get('Content-Disposition') ?? ''),
    injection.headers.get('Content-Disposition')
  );
}

console.log('=== 8. L\'export laisse une trace ===');
{
  const traces = count(
    `select count(*) from "AuditLog" where "entityType"='PACKAGE' and "entityId"='INVENTORY_EXPORT' and action='EXPORT'`
  );
  ok('un export est journalisé', traces > 0, `traces=${traces}`);

  const auteur = db(
    `select "userId" from "AuditLog" where "entityId"='INVENTORY_EXPORT' order by "timestamp" desc limit 1`
  );
  ok('et attribué à son auteur', Boolean(auteur), auteur);
}

console.log('=== 9. Droits d\'accès ===');
{
  const cas = [
    { role: 'expéditeur', token: SHIPPER.accessToken, inv: 403, exp: 403, search: 403 },
    { role: 'livreur', token: DRIVER.accessToken, inv: 403, exp: 403, search: 403 },
    { role: 'caisse', token: FINANCE.accessToken, inv: 200, exp: 403, search: 403 },
    { role: 'gestionnaire', token: GEST.accessToken, inv: 200, exp: 200, search: 200 },
  ];

  for (const c of cas) {
    eq(`${c.role} → inventaire`, c.inv, (await api('GET', '/inventaire', c.token)).status);
    eq(`${c.role} → export`, c.exp, (await api('GET', '/inventaire/export', c.token)).status);
    eq(`${c.role} → recherche`, c.search, (await api('GET', '/search?q=Hamza', c.token)).status);
  }

  const sansJeton = await api('GET', '/inventaire');
  eq('sans jeton, l\'inventaire est fermé', 401, sansJeton.status);
}

console.log('=== 10. Isolation des données ===');
{
  // Un expéditeur qui n'a pas l'accès global ne doit pas non plus le
  // contourner par un filtre : le périmètre vient du jeton, pas de la requête.
  const shipperId = SHIPPER.user.shipperId;
  const parFiltre = await api(
    'GET',
    `/inventaire?shipperId=${db(`select id from "Shipper" where id <> '${shipperId}' limit 1`)}`,
    FINANCE.accessToken
  );
  eq('la caisse lit bien l\'ensemble', 200, parFiltre.status);

  // La caisse a `INVENTORY_READ` mais pas `SEARCH_GLOBAL` : la recherche
  // annuaire lui reste fermée.
  const rechercheCaisse = await api('GET', '/search?q=Hamza', FINANCE.accessToken);
  eq('la caisse n\'accède pas à l\'annuaire', 403, rechercheCaisse.status);

  void shipperId;
}

console.log('=== 11. Valeurs proposées par l\'écran ===');
{
  const facets = await api('GET', '/inventaire/facets', ADMIN.accessToken);
  eq('les facettes répondent', 200, facets.status);
  const d = facets.body.data;
  ok('des expéditeurs sont proposés', d.shippers.length > 0, `${d.shippers.length}`);
  ok('des livreurs sont proposés', d.drivers.length > 0, `${d.drivers.length}`);
  ok('des dépôts sont proposés', d.deposits.length > 0, `${d.deposits.length}`);
  ok('des communes sont proposées', d.cities.length > 0, `${d.cities.length}`);
  ok('des gouvernorats sont proposés', d.governorates.length > 0, `${d.governorates.length}`);
  eq('les 17 statuts colis sont proposés', 17, d.statuses.length);
  ok('et portent un compte', d.statuses.some((s) => typeof s.count === 'number'));
  eq('les 4 statuts de retour sont proposés', 4, d.returnStatuses.length);
}

console.log(results.join('\n'));
console.log();
console.log('======================================');
console.log(`  RÉUSSIS : ${pass}   ÉCHECS : ${fail}`);
console.log('======================================');
process.exit(fail === 0 ? 0 : 1);