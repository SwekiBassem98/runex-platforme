/**
 * Conduit l'écran de réception comme le ferait un agent de dépôt : saisir un
 * code, demander la réception, lire le verdict, recommencer.
 *
 * `verify-frontend.mjs` contrôle le DOM d'un écran affiché, `qa:reception.sh`
 * le backend. Ni l'un ni l'autre ne prouve qu'un scan fonctionne : la saisie
 * passe par React, la réponse déclenche un rendu, et l'état qui en découle
 * n'est vérifié par personne. C'est ce que fait ce script, et c'est par lui
 * qu'ont été trouvés le vol de focus et la clé d'idempotence qui masquait un
 * second scan.
 *
 * Prérequis : l'API sur :4000 et le front sur :3000.
 *
 * Usage : node scripts/verify-reception-ecran.mjs
 */

import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEB = process.env.WEB ?? 'http://localhost:3000';
const API = process.env.API ?? 'http://localhost:4000/api/v1';
const PORT = 9336;
const PASS = [];
const FAIL = [];

const MARQUE = `Écran Réception ${Date.now()}`;

function check(label, ok, detail = '') {
  (ok ? PASS : FAIL).push(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  |  ${detail}` : ''}`);
}

function q(sql) {
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-U', 'logixpress_user', '-d', 'logixpress_db', '-t', '-A', '-c', sql],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'logixpress_secret_pwd' } }
  ).trim();
}

function cleanup() {
  q(`delete from "Package" where "customerId" in (select id from "Customer" where "fullName" = '${MARQUE}')`);
  // Le journal d'audit n'est pas nettoyé : il est immuable. Les lignes de ce
  // script restent dans l'historique, repérables à leur marque.
}

const chrome = spawn(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/lx-chrome-reception-profile',
  'about:blank',
]);
process.on('exit', () => chrome.kill());

let ws;
let nextId = 1;
const pending = new Map();
/** Ce que le navigateur a signalé depuis la dernière remise à zéro. */
const events = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} a expiré`));
      }
    }, 30000);
  });
}

async function waitForChrome() {
  for (let i = 0; i < 50; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    } catch {
      await sleep(200);
    }
  }
  throw new Error('Chrome ne répond pas sur le port de débogage.');
}

const targets = await waitForChrome();
ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve));

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    events.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
  }
  if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
    events.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
  }
});

await send('Runtime.enable');
await send('Network.enable');
await send('Page.enable');

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? "erreur d'évaluation");
  }
  return res.result.value;
}

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return await res.json().catch(() => null);
}

const session = await api('POST', '/auth/login', null, {
  email: 'agent.magasin@logixpress.tn',
  password: 'Agent123!',
});
const sender = await api('POST', '/auth/login', null, {
  email: 'expediteur@bluestar.tn',
  password: 'Exp123!',
});

// Le colis est créé par l'API, comme le ferait un expéditeur : le code testé est
// donc celui que le système produit réellement, pas une valeur fabriquée ici.
const cree = await api('POST', '/colis', sender.data.accessToken, {
  customerName: MARQUE,
  customerPhone: `5${String(Date.now()).slice(-7)}`,
  address: 'Route QA écran',
  totalPrice: 60,
  pieceCount: 1,
});
const colis = cree.data;

try {
  check('un colis de test est disponible', Boolean(colis?.barcode), colis?.trackingNumber ?? 'aucun');

  await send('Page.navigate', { url: `${WEB}/connexion` });
  await sleep(1500);
  // Le profil Chrome est réutilisé d'un run à l'autre. Si la session précédente
  // y a laissé un jeton — et il devient caduc au moindre redémarrage de l'API —
  // l'écran de connexion tente un `auth/me` qui répond 401, et le contrôle
  // « aucune erreur console » échoue alors sur une erreur sans rapport avec
  // l'écran testé. On vide donc la session avant d'en installer une neuve.
  await evaluate('localStorage.clear()');
  await evaluate(`(() => {
    localStorage.setItem('logixpress_access_token', ${JSON.stringify(session.data.accessToken)});
    localStorage.setItem('logixpress_refresh_token', ${JSON.stringify(session.data.refreshToken)});
  })()`);

  // La page de connexion a déjà interrogé `auth/me` puis `auth/refresh` avec le
  // jeton périmé qu'elle trouvait dans le profil : ces 401-là ont été émis avant
  // même que la session neuve soit installée. Ils ne disent rien de l'écran
  // testé, et les garder ferait échouer le contrôle final pour une raison
  // étrangère à la réception — un échec que l'on ne peut ni reproduire ni
  // corriger. On repart donc d'une liste vide : tout ce qui est noté ensuite
  // appartient bien au parcours testé.
  events.length = 0;

  await send('Page.navigate', { url: `${WEB}/magasin` });
  await sleep(3500);

  check(
    "l'écran est bien celui de la réception",
    await evaluate("document.body.innerText.includes('Acceptation Magasin')")
  );
  check(
    'le dépôt de l\'opérateur est proposé',
    await evaluate("document.body.innerText.includes('Hub Central Ben Arous')")
  );
  check(
    "l'historique des réceptions est rendu",
    await evaluate("document.body.innerText.includes('Réceptions récentes')")
  );

  /**
   * Le champ de lecture.
   *
   * Ciblé par son texte d'invite : la barre de recherche de l'en-tête est
   * elle aussi un formulaire, et le premier `input` du document n'est donc pas
   * forcément celui du lecteur.
   */
  const CHAMP = `document.querySelector('input[placeholder*="code-barres"]')`;

  /** Saisit un code comme le ferait le lecteur optique : frappe puis *Entrée*. */
  const scanner = async (code) => {
    await evaluate(`(() => {
      const champ = ${CHAMP};
      if (!champ) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(champ, ${JSON.stringify(code)});
      champ.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(300);
    await evaluate(`(() => {
      const champ = ${CHAMP};
      champ.form.requestSubmit();
    })()`);
    await sleep(2500);
  };

  // Un code illisible ne peut pas passer pour une réception.
  await scanner('SCAN-INCONNU-001');
  check(
    'un code illisible affiche un refus lisible',
    await evaluate("document.body.innerText.includes('Code illisible')")
  );
  check(
    'le refus ne prétend pas avoir enregistré quoi que ce soit',
    await evaluate("!document.body.innerText.includes('Réception enregistrée')")
  );

  // Le scan valide, lui, doit aboutir et nommer le colis.
  await scanner(colis.barcode);
  check(
    'le scan d\'un code-barres valide confirme la réception',
    await evaluate("document.body.innerText.includes('Réception enregistrée')")
  );
  check(
    'le colis reçu est identifié',
    await evaluate(`document.body.innerText.includes(${JSON.stringify(colis.trackingNumber)})`)
  );
  check(
    'le destinataire est rappelé',
    await evaluate(`document.body.innerText.includes(${JSON.stringify(MARQUE)})`)
  );
  check(
    'le champ est vidé pour le scan suivant',
    await evaluate(`${CHAMP}.value === ''`)
  );

  // Le focus doit revenir au lecteur : c'est ce qui permet d'enchaîner les
  // colis sans reprendre la souris.
  check(
    'le focus revient au lecteur après le scan',
    await evaluate(`document.activeElement === ${CHAMP}`)
  );

  check(
    'la réception rejoint l\'historique affiché',
    await evaluate(`(() => {
      const ligne = [...document.querySelectorAll('tbody tr')]
        .find((tr) => tr.innerText.includes(${JSON.stringify(colis.trackingNumber)}));
      if (!ligne) return false;
      // Colis, destinataire, expéditeur, opérateur, dépôt : une ligne pleine.
      return ligne.querySelectorAll('td').length >= 6 && ligne.innerText.trim().length > 20;
    })()`)
  );

  // Un second scan volontaire doit être signalé comme un doublon — et non
  // birdsé par la protection d'idempotence, qui n'est faite que pour les
  // rejeux réseau d'une même requête.
  await scanner(colis.barcode);
  check(
    'un second scan du même colis est signalé comme déjà reçu',
    await evaluate("document.body.innerText.includes('Déjà reçu en dépôt')")
  );
  check(
    "le doublon ne réécrit pas l'historique",
    q(`select count(*) from "PackageTimeline" where "packageId" = '${colis.id}' and title = 'Colis accepté au dépôt'`) === '1'
  );

  // La recherche manuelle ne doit rien enregistrer.
  await evaluate(`(() => {
    const champ = ${CHAMP};
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(champ, '26100399999999');
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Chercher').click();
  })()`);
  await sleep(2000);
  check(
    'la recherche signale un code sans colis',
    await evaluate("document.body.innerText.includes('Aucun colis ne porte le code')")
  );
  check(
    "la recherche n'a rien enregistré",
    q(`select status from "Package" where id = '${colis.id}'`) === 'RECU_DEPOT'
  );

  // Un 404 ou un 409 sur ces deux routes est le mode de réponse prévu pour un
  // refus motivé, pas une panne. Le reste ne pardonne pas.
  const attendus = /\/depot\/reception($|\?)/;
  const reels = events.filter((e) => {
    // L'icône du site n'existe pas dans ce projet ; ce 404-là ne dit rien de
    // l'écran, et tous les autres scripts le rencontrent aussi.
    if (/favicon/.test(e)) return false;
    const m = /HTTP (\d+) (\S+)/.exec(e);
    if (m && attendus.test(m[2]) && (m[1] === '404' || m[1] === '409')) return false;
    return true;
  });
  check('aucune erreur navigateur sur l\'écran', reels.length === 0, reels.slice(0, 3).join(' | '));
} catch (error) {
  check("l'écran reste utilisable jusqu'au bout", false, error.message);
} finally {
  cleanup();
  console.log([...PASS, ...FAIL].join('\n'));
  console.log('\n======================================');
  console.log(`  RÉUSSIS : ${PASS.length}   ÉCHECS : ${FAIL.length}`);
  console.log('======================================');
  ws?.close();
  chrome.kill();
  process.exit(FAIL.length ? 1 : 0);
}