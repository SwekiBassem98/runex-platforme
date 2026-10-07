/**
 * Vérifie le centre de notifications de bout en bout.
 *
 * Le parcours de référence est celui de l'énoncé : un expéditeur passe un colis
 * de 58 à 65 DT, et le livreur affecté doit l'apprendre — écrit en base, poussé
 * en temps réel, et consultable depuis l'écran d'administration.
 *
 * Les contrôles portent sur les cinq rapports du système : la base, l'audit,
 * la notification persistée, le socket, et le compteur.
 */

import { execFileSync } from 'node:child_process';
import { io } from 'socket.io-client';

const BASE = process.env.BASE ?? 'http://localhost:4000/api/v1';
const WS = process.env.WS ?? 'http://localhost:4000';

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
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* corps non JSON */
  }
  return { status: res.status, body: json, raw: text };
}

const login = async (email, password) =>
  (await api('POST', '/auth/login', null, { email, password })).body?.data?.accessToken;

/**
 * Requête SQL directe.
 *
 * Volontairement synchrone et non `async`. `psql` est lui-même synchrone :
 * une fonction asynchrone n'ajouterait qu'une promesse à ne pas attendre, et
 * c'est exactement ce qui manquait à un endroit — les résultats étaient des
 * promesses, la comparaison renvoyait « faux » partout, et rien ne le disait.
 * Le SQL est réduit sur une ligne car un retour à la ligne transmis tel quel
 * devient un `\n` littéral dans la requête.
 */
function db(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-U', 'logixpress_user', '-d', 'logixpress_db', '-t', '-A', '-c', flat],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: 'logixpress_secret_pwd' } }
  ).trim();
}

/** Ouvre une socket authentifiée et enregistre ce qui arrive. */
function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(WS, { auth: { token }, transports: ['websocket'], forceNew: true });
    const received = [];
    const unreadUpdates = [];
    const timer = setTimeout(() => reject(new Error('Connexion socket expirée')), 8000);

    socket.on('connect', () => {
      clearTimeout(timer);
      resolve({
        socket,
        received,
        unreadUpdates,
        close: () => socket.close(),
      });
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on('notification:new', (n) => received.push(n));
    socket.on('notification:unread-count', (p) => unreadUpdates.push(p));
  });
}

/** Attend qu'une condition devienne vraie, sans figer le test. */
async function waitFor(predicate, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// ---------------------------------------------------------------------------

const RUN = Date.now().toString().slice(-7);
const TAG = `Notif ${RUN}`;
const PHONE = `99${RUN}`;
const created = { packages: [], ids: [] };

const ADMIN = await login('admin@logixpress.tn', 'Admin123!');
const AGENT = await login('agent.magasin@logixpress.tn', 'Agent123!');
const SHIPPER = await login('expediteur@bluestar.tn', 'Exp123!');
const DRIVER_EMAIL = db(
  `select u.email from "Driver" d join "User" u on u.id = d."userId"
   where d."isActive" = true and d."deletedAt" is null order by d."driverCode" limit 1`
);
const DRIVER = await login(DRIVER_EMAIL, 'Liv123!');
const FINANCE = await login('finance@logixpress.tn', 'Fin123!');

if (!ADMIN || !AGENT || !SHIPPER || !DRIVER || !FINANCE) {
  console.error('Authentification impossible : vérifiez le jeu de démonstration.');
  process.exit(1);
}

const HUB = db(`select id from "Deposit" where "isMainHub" = true limit 1`);
const DRIVER_ID = db(`select id from "Driver" where "isActive" = true order by "driverCode" limit 1`);

/** Crée un colis prêt à être livré, affecté au livreur principal. */
async function makeReadyPackage(price) {
  const made = await api('POST', '/colis', SHIPPER, {
    customerName: TAG,
    customerPhone: PHONE,
    address: 'Route de la notification',
    totalPrice: price,
    pieceCount: 1,
  });
  const id = made.body?.data?.id;
  const barcode = made.body?.data?.barcode;
  if (!id) throw new Error(`Création du colis impossible : ${made.raw.slice(0, 200)}`);
  created.packages.push(id);
  created.ids.push(id);
  await api('POST', '/warehouse/scan-accept', AGENT, { barcode, depositId: HUB });
  await api('POST', `/colis/${id}/assign`, ADMIN, { driverId: DRIVER_ID });
  return id;
}

console.log('=== 1. Connexion temps réel ===');
{
  const rejected = await new Promise((resolve) => {
    const bad = io(WS, { auth: { token: 'jeton-bidon' }, transports: ['websocket'], forceNew: true });
    bad.on('connect', () => { bad.close(); resolve(false); });
    bad.on('connect_error', () => resolve(true));
    setTimeout(() => { bad.close(); resolve(false); }, 5000);
  });
  ok('une socket sans jeton valide est refusée', rejected);

  const okConn = await connect(DRIVER);
  ok('une socket avec jeton est acceptée', okConn.socket.connected);
  okConn.close();
}

console.log('=== 2. Le parcours de référence : 58 → 65 DT ===');
{
  const pkgId = await makeReadyPackage(58);
  const driverLink = await connect(DRIVER);
  const adminLink = await connect(ADMIN);

  // L'auteur est l'expéditeur ; il ne doit pas être notifié de son propre geste.
  const updated = await api('PUT', `/colis/${pkgId}`, SHIPPER, { totalPrice: 65 });

  eq('le colis passe à 65 DT', 200, updated.status);

  eq("le montant est écrit en base", '65.000', db(`select "totalPrice" from "Package" where id = '${pkgId}'`));

  const audit = db(
    `select count(*) from "AuditLog" where "entityType"='PACKAGE' and "entityId"='${pkgId}'
     and action = 'UPDATE_CRITICAL_FIELDS'`
  );
  ok('le journal d\'audit enregistre la modification', audit === '1', `count=${audit}`);
  ok(
    'l\'audit conserve l\'ancien montant',
    db(
      `select "previousValues"->>'totalPrice' from "AuditLog" where "entityId"='${pkgId}'
       and action = 'UPDATE_CRITICAL_FIELDS' limit 1`
    ) === '58'
  );

  // Qui a été prévenu, exactement. On interroge le destinataire réel plutôt
  // que de compter : un compte d'un geste fait par l'expéditeur ne doit pas
  // être compté comme une notification de cet événement.
  const reached = db(
    `select u.email from "Notification" n join "User" u on u.id = n."userId"
     where n."relatedEntityId" = '${pkgId}' and n.type = 'AMOUNT_CHANGED'
     order by u.email`
  ).split('\n').filter(Boolean);
  const expectedRecipients = ['admin@logixpress.tn', 'gestionnaire@logixpress.tn'];
  ok(
    'l\'événement atteint le livreur et l\'exploitation',
    reached.includes('livreur.hamza@logixpress.tn') &&
      expectedRecipients.every((e) => reached.includes(e)),
    `atteints=${JSON.stringify(reached)}`
  );
  ok(
    'et personne d\'autre',
    reached.length === 3,
    `atteints=${JSON.stringify(reached)}`
  );
  ok(
    'en particulier pas l\'expéditeur, auteur du changement',
    !reached.includes('expediteur@bluestar.tn'),
    `atteints=${JSON.stringify(reached)}`
  );

  const title = db(
    `select title from "Notification" where "relatedEntityId" = '${pkgId}'
     and type = 'AMOUNT_CHANGED' limit 1`
  );
  ok('la notification est en français', /Montant modifié/.test(title), title);
  const body = db(
    `select content from "Notification" where "relatedEntityId" = '${pkgId}'
     and type = 'AMOUNT_CHANGED' limit 1`
  );
  ok('le contenu cite les deux montants', body.includes('58.000') && body.includes('65.000'), body);

  // Le livreur affecté doit recevoir la notification en temps réel.
  const got = await waitFor(() => driverLink.received.some((n) => n.relatedEntityId === pkgId));
  ok('le livreur reçoit la notification en temps réel', got, `reçu=${JSON.stringify(driverLink.received.map((n) => n.type))}`);
  const pushed = driverLink.received.find((n) => n.relatedEntityId === pkgId);
  ok('le message poussé porte le type AMOUNT_CHANGED', pushed?.type === 'AMOUNT_CHANGED', pushed?.type);
  ok('le message poussé est-il destiné au bon colis', pushed?.relatedEntityId === pkgId);
  ok('le message poussé permet de naviguer', pushed?.href === `/colis/${pkgId}`, pushed?.href);
  ok(
    'le compteur de non-lus est poussé avec la notification',
    driverLink.unreadUpdates.length > 0,
    `count=${driverLink.unreadUpdates.length}`
  );

  const adminGot = await waitFor(() => adminLink.received.some((n) => n.relatedEntityId === pkgId));
  ok('l\'administration reçoit aussi l\'événement', adminGot);

  // Le livreur affecté est l'interlocuteur direct : c'est lui qui doit
  // demander 65 DT et non 58 DT au client.
  const driverNotified = db(
    `select count(*) from "Notification" n
     join "Driver" d on d."userId" = n."userId"
     where n."relatedEntityId" = '${pkgId}' and d.id = '${DRIVER_ID}'
     and n.type = 'AMOUNT_CHANGED'`
  );
  eq('le livreur affecté est bien le destinataire', '1', driverNotified);

  // L'expéditeur, lui, reçoit bien d'autres notifications sur ce colis
  // (confirmation de dépôt, suivi) : c'est normal. Ce qui ne doit pas
  // arriver, c'est qu'il soit prévenu du changement qu'il vient de faire.
  const shipperOwnChange = db(
    `select count(*) from "Notification" n join "User" u on u.id = n."userId"
     where n."relatedEntityId" = '${pkgId}' and n.type = 'AMOUNT_CHANGED'
     and u.email = 'expediteur@bluestar.tn'`
  );
  eq("l'auteur n'est pas notifié de son propre geste", '0', shipperOwnChange);

  driverLink.close();
  adminLink.close();
}

console.log('=== 3. Chaque événement atteint son public ===');
{
  const pkgId = await makeReadyPackage(80);
  await api('POST', `/colis/${pkgId}/start`, DRIVER, {});

  const adminLink = await connect(ADMIN);
  const financeLink = await connect(FINANCE);
  const shipperLink = await connect(SHIPPER);

  const delivered = await api('POST', `/colis/${pkgId}/deliver`, DRIVER, {
    collectedAmount: 80,
    paymentMethod: 'ESPECE',
  });
  eq('la livraison aboutit', 200, delivered.status);

  const paymentId = db(`select id from "Payment" where "packageId" = '${pkgId}'`);
  ok('un encaissement est ouvert', Boolean(paymentId), paymentId);

  // La caisse valide l'encaissement : c'est ce geste qui la concerne.
  const cashierNotified = await waitFor(() =>
    financeLink.received.some((n) => n.relatedEntityId === paymentId)
  );
  ok(
    'la caisse est prévenue d\'un encaissement',
    cashierNotified,
    `reçu=${JSON.stringify(financeLink.received.map((n) => n.type))}`
  );
  const paymentNotice = financeLink.received.find((n) => n.relatedEntityId === paymentId);
  eq('le canal visé par la caisse est bien PAYMENT_RECEIVED', 'PAYMENT_RECEIVED', paymentNotice?.type);
  ok(
    'la caisse n\'est pas prévenue des événements qui ne la concernent pas',
    financeLink.received.every((n) => n.relatedEntityId === paymentId)
  );

  // L'expéditeur, lui, n'a rien à faire : il doit quand même apprendre la
  // validation de son propre encaissement.
  const validated = await api('POST', `/payments/${paymentId}/validate`, FINANCE, {});
  eq('la caisse valide', 200, validated.status);

  const shipperGot = await waitFor(() =>
    shipperLink.received.some((n) => n.type === 'PAYMENT_VALIDATED' && n.relatedEntityId === paymentId)
  );
  ok(
    'l\'expéditeur apprend que son encaissement est validé',
    shipperGot,
    `reçu=${JSON.stringify(shipperLink.received.map((n) => n.type))}`
  );

  const adminGot = await waitFor(() => adminLink.received.length > 0);
  ok('l\'administration suit la même transaction', adminGot);

  // La livraison est notifiée par un chemin d'écriture antérieur au centre de
  // notifications. Il devait converging vers le même diffuseur : sinon la
  // ligne arrivait en base sans jamais être poussée, et l'utilisateur ne
  // l'apprenait qu'en rechargeant la page.
  const deliveryNotice = adminLink.received.find((n) => n.relatedEntityId === pkgId);
  ok(
    'l\'annonce de livraison atteint l\'exploitation en temps réel',
    Boolean(deliveryNotice),
    `reçu=${JSON.stringify(adminLink.received.map((n) => n.type))}`
  );
  eq(
    'et porte l\'événement du catalogue, pas son ancien nom',
    'DELIVERY_STATUS_CHANGED',
    deliveryNotice?.type
  );
  ok(
    'elle est consignée au registre de diffusion',
    db(
      `select count(*) from "NotificationDelivery" d
       join "Notification" n on n.id = d."notificationId"
       where n."relatedEntityId" = '${pkgId}' and d.status = 'sent'`
    ) !== '0'
  );

  adminLink.close();
  financeLink.close();
  shipperLink.close();
}

console.log('=== 4. Filtrage et lecture ===');
{
  const list = await api('GET', '/notifications?limit=5', ADMIN);
  eq('la liste répond', 200, list.status);
  ok('la liste est paginée', list.body?.meta?.hasMore === true || list.body?.data.length <= 5);

  const unreadOnly = await api('GET', '/notifications?isRead=false&limit=5', ADMIN);
  ok(
    'le filtre « non lues » ne rend que des non-lues',
    unreadOnly.body?.data.every((n) => n.isRead === false)
  );

  const financeOnly = await api('GET', '/notifications?category=finance&limit=5', ADMIN);
  ok(
    'le filtre par catégorie ne rend que de cette catégorie',
    financeOnly.body?.data.every((n) => n.category === 'finance'),
    JSON.stringify(financeOnly.body?.data.map((n) => n.category))
  );

  const contradictory = await api(
    'GET',
    '/notifications?category=finance&type=COLIS_ASSIGNED',
    ADMIN
  );
  eq(
    'deux filtres contradictoires rendent une liste vide, pas une liste ignorée',
    0,
    contradictory.body?.data.length
  );

  const badFilter = await api('GET', '/notifications?isRead=peut-être', ADMIN);
  ok(
    'un filtre mal orthographié est ignoré plutôt qu\'interprété',
    badFilter.status === 200 && Array.isArray(badFilter.body?.data)
  );

  // Marquer comme lue.
  const before = (await api('GET', '/notifications?isRead=false&limit=1', ADMIN)).body.meta.unread;
  const unreadBefore = before;
  const target = (await api('GET', '/notifications?isRead=false&limit=1', ADMIN)).body.data[0];
  const link = await connect(ADMIN);
  const read = await api('POST', `/notifications/${target.id}/read`, ADMIN);
  eq('marquer comme lue répond 200', 200, read.status);
  ok('la notification est marquée lue', read.body?.data?.isRead === true);
  ok('la date de lecture est posée', Boolean(read.body?.data?.readAt));
  eq(
    'le compteur de non-lus diminue',
    unreadBefore - 1,
    read.body?.meta?.unread
  );

  // Les autres onglets du même compte doivent perdre la pastille sans
  // recharger : c'est ce qui distingue une diffusion réelle d'un simple
  // rafraîchissement de la liste.
  const pushedRead = await waitFor(() => link.unreadUpdates.length > 0);
  ok('le nouveau compteur est poussé aux autres onglets', pushedRead);

  const foreign = await api('POST', `/notifications/${target.id}/read`, SHIPPER);
  eq('on ne peut pas relire la notification d\'autrui', 404, foreign.status);

  const stillUnread = await api('GET', '/notifications?isRead=false&limit=1', ADMIN);
  ok(
    'la tentative étrangère n\'a rien modifié',
    stillUnread.body?.data.every((n) => n.id !== target.id)
  );

  // Tout marquer comme lu.
  const allRead = await api('POST', '/notifications/read-all', ADMIN);
  eq('tout marquer comme lu répond 200', 200, allRead.status);
  const after = await api('GET', '/notifications?isRead=false&limit=1', ADMIN);
  eq('il ne reste aucune non-lue', 0, after.body?.meta?.unread);
  link.close();
}

console.log('=== 5. Registre de diffusion ===');
{
  const notifId = db(
    `select id from "Notification" where "relatedEntityId" in
     (select id::text from "Package" where id::text in ('${created.ids.join("','")}'))
     order by "createdAt" desc limit 1`
  );
  const channels = db(
    `select string_agg(channel || ':' || status, ', ' order by channel)
     from "NotificationDelivery" where "notificationId" = '${notifId}'`
  );
  ok(
    'la diffusion est journalisée par canal',
    Boolean(channels),
    `notifId=${notifId} ids=${JSON.stringify(created.ids)} channels=${channels}`
  );
  ok('le canal in_app est marqué envoyé', /in_app:sent/.test(channels), channels);
}

console.log('=== 6. Aucune fuite entre comptes ===');
{
  const shipperList = await api('GET', '/notifications?limit=10', SHIPPER);
  const ids = new Set(shipperList.body?.data.map((n) => n.id) ?? []);
  const adminList = await api('GET', '/notifications?limit=10', ADMIN);
  const overlap = (adminList.body?.data ?? []).filter((n) => ids.has(n.id));
  eq('un expéditeur ne voit que ses notifications', 0, overlap.length);

  const badRead = await api('POST', '/notifications/read-all', SHIPPER);
  eq('un expéditeur peut vider sa propre boîte', 200, badRead.status);
}

console.log('=== 7. Nettoyage ===');
{
  const ids = created.ids.map((i) => `'${i}'`).join(',');
  db(`delete from "NotificationDelivery" where "notificationId" in
      (select id from "Notification" where "relatedEntityId" in (${ids}))`);
  db(`delete from "Notification" where "relatedEntityId" in (${ids})`);
  db(`delete from "Notification" where "relatedEntity"='PACKAGE' and "relatedEntityId" in
      (select p.id::text from "Package" p join "Customer" c on c.id = p."customerId"
       where c."fullName" = '${TAG}')`);
  db(`delete from "Notification" where title like '%${TAG}%'`);
  db(`delete from "PackageTimeline" where "packageId" in (${ids})`);
  db(`delete from "PackageItem" where "packageId" in (${ids})`);
  db(`delete from "DeliveryAttempt" where "packageId" in (${ids})`);
  db(`delete from "Payment" where "packageId" in (${ids})`);
  // Le journal d'audit n'est pas nettoyé : il est immuable.
  db(`delete from "Notification" where "relatedEntity"='PAYMENT' and "relatedEntityId" not in
      (select id::text from "Payment")`);
  db(`delete from "Package" where id in (${ids})`);
  db(`delete from "Customer" where "fullName" = '${TAG}'`);
  const left = db(
    `select count(*) from "Package" p join "Customer" c on c.id = p."customerId"
     where c."fullName" = '${TAG}'`
  );
  eq('aucun colis de test ne subsiste', '0', left);
}

console.log(results.join('\n'));
console.log();
console.log('======================================');
console.log(`  RÉUSSIS : ${pass}   ÉCHECS : ${fail}`);
console.log('======================================');
process.exit(fail === 0 ? 0 : 1);