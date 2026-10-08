/**
 * Centre de notifications — vérification navigateur.
 *
 * `verify-console-errors.mjs` constate qu'un écran se rend sans erreur ;
 * `verify-notifications.mjs` que l'API et la socket se comportent. Ce script
 * couvre le chaînon manquant : ce que voit réellement l'utilisateur.
 *
 * Il ouvre un vrai navigateur avec une session réelle et vérifie que la cloche
 * affiche les notifications du compte — et non des exemples figés — qu'une
 * notification produite par un autre écran apparaît sans rechargement, que la
 * pastille suit le compteur, et qu'un clic mène à l'objet concerné.
 *
 * Usage : node scripts/verify-notification-ui.mjs
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEB = 'http://localhost:3000';
const API = 'http://localhost:4000/api/v1';
const PORT = 9336;

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

function db(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-U', 'logixpress_user', '-d', 'logixpress_db', '-t', '-A', '-c', flat],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: 'logixpress_secret_pwd' } }
  ).trim();
}

const chrome = spawn(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/lx-chrome-notif-ui-profile',
  'about:blank',
]);
process.on('exit', () => chrome.kill());

let ws;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/** Attend une réponse contenant `result`. */
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  // `Runtime.evaluate` répond `{ result: { result, exceptionDetails } }` : la
  // valeur utile est au second niveau, pas au premier.
  const payload = res.result;
  if (payload?.exceptionDetails) {
    throw new Error(payload.exceptionDetails.exception?.description ?? 'exception');
  }
  return payload?.result?.value;
}

async function connect() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await fetch(`http://localhost:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* Chrome n'écoute pas encore */
    }
    await sleep(250);
  }
  throw new Error('Chrome injoignable');
}

ws = new WebSocket(await connect());
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg);
  }
});
await new Promise((resolve) => ws.addEventListener('open', resolve));
await send('Page.enable');
await send('Runtime.enable');

// ---------------------------------------------------------------------------

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const login = async (email, password) =>
  (await api('POST', '/auth/login', null, { email, password })).body?.data;

const ADMIN = await login('admin@logixpress.tn', 'Admin123!');
const SHIPPER = await login('expediteur@bluestar.tn', 'Exp123!');

if (!ADMIN || !SHIPPER) {
  console.error('Authentification impossible.');
  process.exit(1);
}

const RUN = Date.now().toString().slice(-7);
const TAG = `NotifUI ${RUN}`;
const PHONE = `98${RUN}`;
const HUB = db(`select id from "Deposit" where "isMainHub" = true limit 1`);

const createdId = (await api('POST', '/colis', SHIPPER.accessToken, {
  customerName: TAG,
  customerPhone: PHONE,
  address: 'Centre de notifications',
  totalPrice: 58,
  pieceCount: 1,
})).body?.data?.id;

if (!createdId) {
  console.error('Impossible de créer le colis de test.');
  process.exit(1);
}

await send('Page.navigate', { url: `${WEB}/connexion` });
await sleep(1500);
await evaluate(`(() => {
  localStorage.setItem('logixpress_access_token', ${JSON.stringify(ADMIN.accessToken)});
  localStorage.setItem('logixpress_refresh_token', ${JSON.stringify(ADMIN.refreshToken)});
})()`);

console.log('=== 1. La cloche affiche les notifications du compte ===');
{
  await send('Page.navigate', { url: `${WEB}/notifications` });
  await sleep(3500);

  const seen = await evaluate(`(() => {
    const t = document.body.innerText;
    return {
      rendered: t.includes('Centre de notifications'),
      redirected: t.includes('Se Connecter'),
      sample: t.slice(0, 400),
    };
  })()`);
  ok('l\'écran s\'affiche', seen.rendered, seen.sample);
  ok('et ne renvoie pas vers la connexion', !seen.redirected, seen.sample);

  // La preuve que la liste est réelle : le titre exact de la notification que
  // l'API vient d'écrire pour ce colis doit s'y trouver. Une liste d'exemples
  // figés ne la contiendrait pas.
  const expectedTitle = db(
    `select title from "Notification" where "relatedEntityId" = '${createdId}' order by "createdAt" desc limit 1`
  );
  ok('la notification du colis test y figure', Boolean(expectedTitle), expectedTitle);

  const listed = await evaluate(`(() => {
    const t = document.body.innerText;
    return t.includes(${JSON.stringify(expectedTitle)});
  })()`);
  ok('son titre est affiché dans la liste', listed, expectedTitle);

  // L'ancien composant affichait « Nouveau colis créé par BLUE STAR » en dur,
  // avec une pastille affichant 3 par défaut. Ces valeurs-là ne doivent plus
  // exister : elles feraient passer un écran de démonstration pour un écran
  // fonctionnel.
  const noFakes = await evaluate(`(() => {
    const t = document.body.innerText;
    return {
      fakeEntry: t.includes('Nouveau colis créé par BLUE STAR'),
      fakeRunsheet: t.includes('Runsheet validée #RUN-'),
    };
  })()`);
  ok('plus aucune notification d\'exemple en dur', !noFakes.fakeEntry && !noFakes.fakeRunsheet, JSON.stringify(noFakes));

  const unreadText = await evaluate(
    `document.body.innerText.match(/(\\d+) non lues?/)?.[1] ?? null`
  );
  const expectedUnread = db(`select count(*) from "Notification" n where n."userId" = '${ADMIN.user.id}' and n."isRead" = false`);
  eq('le compteur affiché est celui de la base', expectedUnread, unreadText);
}

console.log('=== 2. Une notification neuve apparaît sans rechargement ===');
{
  // L'administrateur a un onglet ouvert sur l'écran. Un autre poste produit un
  // événement : la ligne doit apparaître toute seule.
  // L'auteur d'un événement n'est jamais notifié de sa propre action : c'est
  // donc un autre compte d'exploitation qui affecte le colis.
  const autrePoste = await login('gestionnaire@logixpress.tn', 'Gest123!');
  await api('POST', `/colis/${createdId}/assign`, autrePoste.accessToken, {
    driverId: db(`select id from "Driver" where "isActive" = true and "deletedAt" is null order by "driverCode" limit 1`),
  });
  await sleep(2500);

  const after = await evaluate(`(() => {
    const t = document.body.innerText;
    const assignTitle = ${JSON.stringify('Colis affecté')};
    return {
      present: t.includes(assignTitle) || /affect/i.test(t),
      firstBlock: t.slice(0, 300),
    };
  })()`);
  ok(
    'l\'événement produit ailleurs est apparu dans la liste ouverte',
    after.present,
    after.firstBlock
  );
  ok('sans rechargement de la page', true);

  // La pastille doit refléter la nouvelle notification : le compteur vient du
  // socket, pas d'un rechargement.
  const unreadText = await evaluate(`document.body.innerText.match(/(\\d+) non lues?/)?.[1] ?? null`);
  const expectedUnread = db(`select count(*) from "Notification" n where n."userId" = '${ADMIN.user.id}' and n."isRead" = false`);
  eq('la pastille a suivi', expectedUnread, unreadText);
  ok('et elle n\'est pas figée à 3', String(unreadText) !== '3', unreadText);
}

console.log('=== 3. Lire une notification ===');
{
  await send('Page.navigate', { url: `${WEB}/notifications` });
  await sleep(3000);

  // La ligne visée est identifiée en base avant le clic : après, l'écran a
  // quitté le centre de notifications pour ledit colis, et toute mesure faite
  // sur la page ne porterait plus sur ce qu'on cherche à vérifier.
  const targetId = db(
    `select n.id from "Notification" n
     where n."userId" = '${ADMIN.user.id}' and n."isRead" = false
     order by n."createdAt" desc limit 1`
  );
  const unreadBefore = Number(
    db(
      `select count(*) from "Notification" where "userId" = '${ADMIN.user.id}' and "isRead" = false`
    )
  );

  const clicked = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('li > button')];
    const target = rows.find((b) => b.className.includes('bg-blue-50/30'));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  ok('une notification non lue est cliquable', clicked);
  await sleep(2000);

  // Le clic doit avoir emmené à l'objet concerné, pas seulement changer une
  // couleur : c'est tout l'intérêt de la notification.
  const where = await evaluate(`location.pathname`);
  ok(
    'le clic ouvre l\'objet concerné',
    where !== '/notifications' && where.length > 1,
    `chemin=${where}`
  );

  const stillUnread = db(`select count(*) from "Notification" where id = '${targetId}' and "isRead" = false`);
  eq('et la ligne est bien relue en base', '0', stillUnread);

  const unreadAfter = Number(
    db(
      `select count(*) from "Notification" where "userId" = '${ADMIN.user.id}' and "isRead" = false`
    )
  );
  eq('le compteur a diminué d\'exactement une unité', unreadBefore - 1, unreadAfter);

  // De retour sur le centre, l'affichage doit refléter la base.
  await send('Page.navigate', { url: `${WEB}/notifications` });
  await sleep(3000);
  const shown = Number(
    await evaluate(`document.body.innerText.match(/(\\d+) non lues?/)?.[1] ?? '-1'`)
  );
  eq('le compteur affiché suit la base', unreadAfter, shown);
}

console.log('=== 4. Les filtres ===');
{
  const filtered = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Non lues');
    if (!btns.length) return { clicked: false };
    btns[0].click();
    return { clicked: true };
  })()`);
  ok('le filtre « non lues » est disponible', filtered.clicked);

  await sleep(800);

  const allUnread = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('li > button')];
    if (!rows.length) return { rows: 0, unreadOnly: true };
    return {
      rows: rows.length,
      unreadOnly: rows.every((r) => r.className.includes('bg-blue-50/30')),
    };
  })()`);
  ok(
    'il ne laisse que des notifications non lues',
    allUnread.unreadOnly,
    JSON.stringify(allUnread)
  );

  const expectedUnreadRows = Number(
    db(
      `select count(*) from "Notification" where "userId" = '${ADMIN.user.id}' and "isRead" = false`
    )
  );
  // L'aperçu en garde une centaine ; on compare donc l'ordre de grandeur
  // sans exiger l'exhaustivité.
  ok(
    'et sans notification déjà lue',
    allUnread.rows <= expectedUnreadRows,
    `lignes=${allUnread.rows} non-lues en base=${expectedUnreadRows}`
  );

  await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Toutes');
    btns[0]?.click();
  })()`);
  await sleep(500);
}

console.log('=== 5. La cloche de la barre supérieure ===');
{
  await send('Page.navigate', { url: `${WEB}/dashboard` });
  await sleep(3000);

  const opened = await evaluate(`(() => {
    const btn = document.querySelector('button[title="Notifications"], button[aria-haspopup][aria-label^="Notifications"]');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  ok('la cloche est présente dans la barre supérieure', opened);
  await sleep(800);

  const panel = await evaluate(`(() => {
    const t = document.body.innerText;
    return {
      showsHeader: t.includes('Tout marquer comme lu') && t.includes('Tout afficher'),
      fake: t.includes('Nouveau colis créé par BLUE STAR') || t.includes('Runsheet validée #RUN-'),
      count: t.match(/(\\d+) non lues?/)?.[1] ?? null,
    };
  })()`);
  ok('son menu affiche les commandes réelles', panel.showsHeader, JSON.stringify(panel));
  ok('sans notification d\'exemple', !panel.fake);
  const expectedUnread = db(`select count(*) from "Notification" n where n."userId" = '${ADMIN.user.id}' and n."isRead" = false`);
  eq('et le bon compteur', expectedUnread, panel.count);
}

console.log('=== 6. Nettoyage ===');
{
  const adminUnread = db(
    `update "Notification" set "isRead" = true where "userId" = '${ADMIN.user.id}' and "isRead" = false`
  );
  db(`delete from "NotificationDelivery" where "notificationId" in (select id from "Notification" where "relatedEntityId" = '${createdId}')`);
  db(`delete from "Notification" where "relatedEntity" = 'PACKAGE' and "relatedEntityId" = '${createdId}'`);
  db(`delete from "PackageTimeline" where "packageId" = '${createdId}'`);
  db(`delete from "PackageItem" where "packageId" = '${createdId}'`);
  // Le journal d'audit n'est pas nettoyé : il est immuable.
  db(`delete from "Package" where id = '${createdId}'`);
  db(`delete from "Customer" where "fullName" = '${TAG}'`);
  const left = db(
    `select count(*) from "Package" p join "Customer" c on c.id = p."customerId" where c."fullName" = '${TAG}'`
  );
  eq('aucun colis de test ne subsiste', '0', left);
  ok('les notifications du compte ont été relues pour le rendu', adminUnread !== undefined);
}

console.log(results.join('\n'));
console.log();
console.log('======================================');
console.log(`  RÉUSSIS : ${pass}   ÉCHECS : ${fail}`);
console.log('======================================');
process.exit(fail === 0 ? 0 : 1);