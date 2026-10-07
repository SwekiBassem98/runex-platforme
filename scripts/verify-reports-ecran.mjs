/**
 * Conduit l'écran des rapports comme le ferait un exploitant : choisir une
 * période, parcourir les cinq questions, changer de période, relire par lien,
 * puis exporter.
 *
 * `qa:reports.sh` contrôle l'API. Ce script contrôle ce que l'API ne peut pas
 * dire, et qui ne se verrait pas autrement :
 *
 * - **les raccourcis de période changent-ils vraiment le rapport ?** Un bouton
 *   qui se coche et qui ne recharge rien ne produit aucune erreur : l'utilisateur
 *   croit regarder le mois échu et lit les trente derniers jours.
 * - **le lien relit-il le même rapport ?** Un lien qui s'ouvre sur la
 *   période par défaut est un lien qui ne veut rien dire pour celui qui le reçoit.
 * - **le périmètre est-il annoncé à l'écran ?** C'est le seul endroit où
 *   l'utilisateur peut voir que ses chiffres sont les siens et non ceux de la
 *   plateforme — et l'API ne peut pas le répéter à sa place.
 * - **le bouton d'export est-il là pour qui le peut ?** Un export visible pour
 *   un rôle sans droit mène à un 403 ; un export invisible pour un rôle qui le
 *   peut est une fonctionnalité morte.
 *
 * Prérequis : l'API sur :4000 et le front sur :3000.
 *
 * Usage : node scripts/verify-reports-ecran.mjs
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEB = process.env.WEB ?? 'http://localhost:3000';
const PORT = 9339;
const PASS = [];
const FAIL = [];

function check(label, ok, detail = '') {
  (ok ? PASS : FAIL).push(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  |  ${detail}` : ''}`);
}

const chrome = spawn(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/lx-chrome-rapports-profile',
  'about:blank',
]);
process.on('exit', () => chrome.kill());

let ws;
let nextId = 1;
const pending = new Map();
const erreurs = [];

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
  for (let essai = 0; essai < 40; essai++) {
    try {
      const reponse = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const cibles = await reponse.json();
      const page = cibles.find((c) => c.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* Chrome n'écoute pas encore */
    }
    await sleep(250);
  }
  throw new Error("Chrome n'a pas ouvert son port de débogage");
}

const cible = await waitForChrome();
const { WebSocket } = await import('node:worker_threads').then(() => ({ WebSocket: globalThis.WebSocket }));
ws = new WebSocket(cible);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    erreurs.push(message.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (message.method === 'Runtime.exceptionThrown') {
    erreurs.push(message.params.exceptionDetails.exception?.description ?? 'exception');
  }
});
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? 'erreur d’évaluation');
  }
  return res.result.value;
}

async function api(method, path, token, body) {
  const res = await fetch('http://localhost:4000/api/v1' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return await res.json().catch(() => null);
}

const session = await api('POST', '/auth/login', null, {
  email: 'admin@logixpress.tn',
  password: 'Admin123!',
});
const token = session.data?.accessToken;
if (!token) {
  console.error("Authentification impossible : vérifiez le jeu de données de démonstration.");
  chrome.kill();
  process.exit(1);
}

const sessionLIVREUR = await api('POST', '/auth/login', null, {
  email: 'livreur.hamza@logixpress.tn',
  password: 'Liv123!',
});
const tokenLIVREUR = sessionLIVREUR.data?.accessToken;

/** Clique un bouton de l'écran par son texte exact, comme le ferait l'utilisateur. */
function cliquer(texte) {
  return `(() => {
    const menu = document.querySelector('nav, aside, [role="navigation"]');
    const cible = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === ${JSON.stringify(texte)}
        && (!menu || !menu.contains(b))
    );
    if (!cible) return 'bouton absent';
    cible.click();
    return 'ok';
  })()`;
}

/**
 * Les boutons de l'écran, hors menu latéral.
 *
 * Le menu porte déjà une entrée « Finance » : sans cette restriction, le script
 * cliquait sur l'entrée de navigation au lieu de l'onglet, se retrouvait sur une
 * autre page, et lisait ensuite le rapport précédent en croyant avoir changé de
 * question. C'est le genre de faute qui fait passer un contrôle pour une preuve.
 */
const BOUTONS_ECHECRAN = `(() => {
  const menu = document.querySelector('nav, aside, [role="navigation"]');
  return [...document.querySelectorAll('button')]
    .filter((b) => !menu || !menu.contains(b))
    .map((b) => b.textContent.trim());
})()`;

/** Les onglets rendus, dans l'ordre. */
const ONGLETS = `JSON.stringify(${BOUTONS_ECHECRAN}.filter((t) =>
  ['Colis', 'Expéditeurs', 'Livreurs', 'Finance', 'Dépôts'].includes(t)))`;

/** Les raccourcis de période rendus. */
const RACCOURCIS = `JSON.stringify(${BOUTONS_ECHECRAN}.filter((t) =>
  ['7 jours', '30 jours', '90 jours', 'Mois en cours', 'Mois échu', 'Période libre'].includes(t)))`;

/** Le nombre de graphiques rendus : un graphique qui échoue laisse un vide. */
const GRAPHIQUES = `document.querySelectorAll('.recharts-wrapper').length`;

/** Les lignes du premier tableau de données du rapport courant. */
const LIGNES = `(() => {
  const tableaux = [...document.querySelectorAll('table')];
  if (tableaux.length === 0) return 0;
  return tableaux[tableaux.length - 1].querySelectorAll('tbody tr').length;
})()`;

/** Le périmètre affiché, tel qu'un utilisateur peut le lire. */
const PERIMETRE = `(() => {
  const texte = document.body.innerText;
  const trouve = texte.match(/Périmètre\\s*:\\s*([^\\n|]+)/);
  return trouve ? trouve[1].trim() : '';
})()`;

/** La période appliquée, telle qu'affichée. */
const PERIODE = `(() => {
  const texte = document.body.innerText;
  const trouve = texte.match(/Période appliquée\\s*:\\s*([^\\n|]+)/);
  return trouve ? trouve[1].trim() : '';
})()`;

try {
  await send('Page.navigate', { url: `${WEB}/connexion` });
  await sleep(1200);
  // Le profil Chrome est réutilisé d'un run à l'autre. Si la session précédente
  // y a laissé un jeton — et il devient caduc au moindre redémarrage de l'API —
  // l'écran de connexion tente un `auth/me` qui répond 401, et le contrôle
  // « aucune erreur console » échoue alors sur une erreur sans rapport avec
  // l'écran testé. On vide donc la session avant d'en installer une neuve.
  await evaluate('localStorage.clear()');
  await evaluate(`(() => {
    localStorage.setItem('logixpress_access_token', ${JSON.stringify(token)});
    localStorage.setItem('logixpress_refresh_token', ${JSON.stringify(session.data.refreshToken)});
  })()`);

  // La page de connexion a déjà interrogé `auth/me` et `auth/refresh` avec le
  // jeton périmé laissé par le run précédent. Ces erreurs-là ont été émises avant
  // que la session neuve soit installée : elles ne disent rien de l'écran testé,
  // et les conserver ferait échouer le contrôle final pour une raison étrangère
  // aux rapports. On repart d'une liste vide.
  erreurs.length = 0;

  // ------------------------------------------------------------------
  console.log("Écran des rapports — parcours d'un exploitant\n");

  await send('Page.navigate', { url: `${WEB}/rapports` });
  await sleep(3500);

  const titre = await evaluate("document.body.innerText");
  /*
   * L'apostrophe est comparée après normalisation.
   *
   * L'interface utilise l'apostrophe typographique française, qui est la
   * typographie correcte ; le contrôle la cherchait avec une apostrophe droite et
   * échouait sur un écran parfaitement correct. Les deux formes sont acceptées :
   * ce qui compte est que l'écran des rapports s'affiche, pas la forme du signe.
   */
  const sansApostrophes = (texte) => texte.replace(/['\u2019]/g, "'");
  check(
    "l'écran est bien celui des rapports",
    sansApostrophes(titre).includes("Rapports d'exploitation")
  );

  const onglets = JSON.parse(await evaluate(ONGLETS));
  check(
    'les cinq questions sont proposées',
    onglets.length === 5 && onglets.includes('Finance') && onglets.includes('Dépôts'),
    onglets.join(' · ')
  );

  const raccourcis = JSON.parse(await evaluate(RACCOURCIS));
  check(
    'les raccourcis de période sont proposés',
    raccourcis.length === 6,
    raccourcis.join(' · ')
  );

  // Le périmètre doit être affiché : c'est la seule occasion pour l'utilisateur
  // de savoir que ses chiffres sont les siens et non ceux de la plateforme.
  const perimetreAdmin = await evaluate(PERIMETRE);
  check(
    "le périmètre est annoncé à l'écran",
    perimetreAdmin.includes('plateforme'),
    perimetreAdmin
  );
  // Le raccourci « 30 jours » est résolu en bornes avant l'appel : le rapport
  // affiche donc les dates, ce qui est plus précis que la mention du bouton.
  // Ce qui compte ici, c'est que les bornes annoncées couvrent bien trente jours.
  const periodeInitiale = await evaluate(PERIODE);
  const bornesInitiales = periodeInitiale.split('→').map((x) => x.trim());
  const ecartJours = bornesInitiales.length === 2
    ? Math.round((new Date(bornesInitiales[1]) - new Date(bornesInitiales[0])) / 86400000) + 1
    : -1;
  check(
    'la période par défaut couvre bien trente jours',
    ecartJours === 30,
    `${periodeInitiale} → ${ecartJours} jours`
  );

  const graphiques = await evaluate(GRAPHIQUES);
  check('le rapport colis rend ses graphiques', graphiques >= 2, `${graphiques} graphiques`);

  // ------------------------------------------------------------------
  console.log('Changer de période recalcule réellement le rapport');

  const avant = await evaluate(PERIODE);
  await evaluate(cliquer('90 jours'));
  await sleep(2500);
  const apres = await evaluate(PERIODE);
  check(
    'un raccourci de période change la période appliquée',
    apres !== avant,
    `${avant} -> ${apres}`
  );
  const fromUrl = await evaluate("new URL(location.href).searchParams.get('from')");
  const toUrl = await evaluate("new URL(location.href).searchParams.get('to')");
  check(
    "l'URL porte la période choisie, et le lien la relit",
    fromUrl !== null && toUrl !== null && fromUrl !== bornesInitiales[0],
    `${fromUrl} → ${toUrl}`
  );

  // Un raccourci coché doit se lire comme coché : c'est le seul retour visuel
  // qui dit que l'écran a obéi.
  const coche = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '90 jours');
    return b ? b.className.includes('bg-slate-900') : false;
  })()`);
  check('le raccourci appliqué reste coché', coche);

  // ------------------------------------------------------------------
  console.log('\nParcourir les cinq questions');

  for (const libelle of ['Colis', 'Expéditeurs', 'Livreurs', 'Finance', 'Dépôts']) {
    const applique = await evaluate(cliquer(libelle));
    if (applique !== 'ok') {
      check(`l'onglet ${libelle} est cliquable`, false, applique);
      continue;
    }
    await sleep(2200);
    const urlDomaine = await evaluate("new URL(location.href).searchParams.get('domaine')");
    const corps = await evaluate('document.body.innerText');
    check(
      `l'onglet ${libelle} affiche son rapport`,
      corps.length > 200 && !corps.includes('Rapport indisponible'),
      `${(await evaluate(LIGNES))} lignes, ${(await evaluate(GRAPHIQUES))} graphiques`
    );
    check(
      `l'onglet ${libelle} est porté par l'URL`,
      urlDomaine !== null,
      `domaine=${urlDomaine}`
    );
    check(
      `l'onglet ${libelle} garde la période choisie`,
      (await evaluate(PERIODE)).includes(fromUrl ?? ''),
      await evaluate(PERIODE)
    );
  }

  // ------------------------------------------------------------------
  console.log('\nUne période sans mouvement ne casse pas l\'écran');

  await send('Page.navigate', { url: `${WEB}/rapports?domaine=colis&from=2030-01-01&to=2030-01-02` });
  await sleep(3000);
  const vide = await evaluate('document.body.innerText');
  check(
    "une période vide affiche un état explicite",
    vide.includes('Aucun mouvement'),
    ''
  );
  check(
    "une période vide explique quoi faire plutôt que d'afficher zéro partout",
    vide.includes('Élargissez la période'),
    ''
  );
  check(
    'une période vide indique la période qui a été comptée',
    (await evaluate(PERIODE)).includes('2030-01-01'),
    await evaluate(PERIODE)
  );

  // ------------------------------------------------------------------
  console.log('\nRelire par lien');

  await send('Page.navigate', { url: `${WEB}/rapports?domaine=finance&from=2026-01-01&to=2026-06-30` });
  await sleep(3000);
  // Les libellés sont rendus en capitales par la feuille de style, et
  // `innerText` renvoie le texte transformé : la comparaison ignore la casse.
  const parLien = (await evaluate('document.body.innerText')).toLowerCase();
  check(
    'un lien ouvre la finance sur la période demandée',
    parLien.includes('montant attendu') && parLien.includes('montant encaissé'),
    ''
  );
  check(
    "le lien est respecté jusqu'aux bornes",
    (await evaluate(PERIODE)).includes('2026-01-01') && (await evaluate(PERIODE)).includes('2026-06-30'),
    await evaluate(PERIODE)
  );
  // Les montants sont affichés avec trois décimales : un dinar est un décimal en
  // base, et « 374,000 DT » avec une virgule et trois décimales fait douter de
  // l'exactitude du relevé, là où « 374.0 DT » passait inaperçu. Les groupes de
  // trois sont espacés — insécables, pour qu'un montant ne soit jamais coupé
  // après « 1 284 » et change de valeur à l'œil. La Spaces and non-breaking
  // spaces sont donc tolérées ici : `innerText` n'est pas garanti de conserver
  // l'espace insécable telle quelle selon la feuille de style appliquée.
  const montants = await evaluate(
    `(document.body.innerText.match(/\\d{1,3}(?:[\\u00a0 ]\\d{3})*,\\d{3}[\\u00a0 ]DT/g) || []).length`
  );
  check('les montants sont affichés avec trois décimales', montants > 0, `${montants} montants`);

  // Un montant ne doit jamais ressortir avec deux décimales ni avec un point en
  // position décimale : ce sont les deux rendus que la plateforme a eus avant que
  // le formateur converge, et qui subsistent dans les composants écrits à la main.
  const montantsLegacy = await evaluate(
    `(document.body.innerText.match(/\\d+\\.\\d{2}(?![\\d])/g) || []).length`
  );
  check(
    "aucun montant ne traîne l'ancien rendu à deux décimales",
    montantsLegacy === 0,
    `${montantsLegacy} occurrences`
  );

  // ------------------------------------------------------------------
  console.log("\nL'export est proposé à qui le peut");

  const boutonExport = await evaluate("document.body.innerText.includes('Exporter')");
  check("l'export est proposé à l'administrateur", boutonExport);

  // Un livreur n'a ni REPORT_READ ni REPORT_EXPORT : l'entrée de menu ne doit
  // pas exister, et l'écran ne doit rien laisser afficher.
  if (tokenLIVREUR) {
    await send('Page.navigate', { url: `${WEB}/connexion` });
    await sleep(900);
    await evaluate(`(() => {
      localStorage.setItem('logixpress_access_token', ${JSON.stringify(tokenLIVREUR)});
      localStorage.setItem('logixpress_refresh_token', ${JSON.stringify(sessionLIVREUR.data.refreshToken)});
    })()`);
    await send('Page.navigate', { url: `${WEB}/dashboard` });
    await sleep(3000);
    check(
      "un rôle sans REPORT_READ ne voit pas l'entrée de menu des rapports",
      !(await evaluate(
        "document.body.innerText.replace(/['\u2019]/g, \"'\").includes(\"Rapports d'exploitation\")"
      )),
      ''
    );

    await send('Page.navigate', { url: `${WEB}/rapports` });
    await sleep(3000);
    check(
      "un rôle sans REPORT_READ n'accède pas au rapport",
      await evaluate(
        "document.body.innerText.includes('Accès refusé') || document.body.innerText.includes('non autorisé') || document.body.innerText.includes('401') || document.body.innerText.includes('403')"
      ),
      ''
    );
    check(
      "un rôle sans REPORT_EXPORT ne voit pas de bouton d'export",
      !(await evaluate("document.body.innerText.includes('Exporter')")),
      ''
    );
  }

  // ------------------------------------------------------------------
  console.log('\nConsole');
  const graves = erreurs.filter(
    (e) => !/favicon|404|Failed to load resource|hydrat/i.test(String(e))
  );
  check('aucune erreur console', graves.length === 0, graves.slice(0, 3).join(' | '));
} catch (err) {
  check("le parcours s'est déroulé sans exception", false, String(err));
} finally {
  console.log(PASS.join('\n'));
  if (FAIL.length > 0) console.log(FAIL.join('\n'));
  console.log('\n======================================');
  console.log(`  RÉUSSIS : ${PASS.length}   ÉCHECS : ${FAIL.length}`);
  console.log('======================================');
  chrome.kill();
  process.exit(FAIL.length === 0 ? 0 : 1);
}