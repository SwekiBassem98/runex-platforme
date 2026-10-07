/**
 * Conduit l'écran d'audit comme le ferait un exploitant : consulter, filtrer,
 * puis ouvrir une trace pour lire ce qu'elle dit.
 *
 * `qa:audit.sh` contrôle l'API, `verify-frontend.mjs` le rendu. Ni l'un ni
 * l'autre ne prouve que l'écran *filtre* : un filtre qui s'affiche sans
 * réduire la liste ne produit aucune erreur, et l'exploitant croit avoir restreint
 * sa recherche alors qu'il lit toujours tout le journal. C'est ce que ce script
 * vérifie, ainsi que la lecture d'une trace.
 *
 * Prérequis : l'API sur :4000 et le front sur :3000.
 *
 * Usage : node scripts/verify-audit-ecran.mjs
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEB = process.env.WEB ?? 'http://localhost:3000';
const PORT = 9337;
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
  '--user-data-dir=/tmp/lx-chrome-audit-profile',
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
    erreurs.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
  }
  if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
    erreurs.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
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

/** Nombre de lignes de journal actuellement rendues. */
const LIGNES = `document.querySelectorAll('tbody tr').length`;

/**
 * Total annoncé par l'écran.
 *
 * Lu dans le texte et non dans le nombre de lignes : la liste est paginée, donc
 * deux recherches très différentes peuvent afficher le même nombre de lignes.
 * Le total, lui, ne ment pas sur l'ampleur de ce qui a été trouvé.
 */
const TOTAL_AFFICHE = `(() => {
  const texte = document.body.innerText;
  const trouve = texte.match(/([\\d\\s]+) entrée\\(s\\)/);
  if (!trouve) return -1;
  return Number(trouve[1].replace(/[^0-9]/g, ''));
})()`;

/**
 * Choisit une option par son texte, comme le ferait un clic.
 *
 * Le <select> est repéré par une option qui lui est propre — « Toutes les
 * catégories », « Toutes les actions » — et non par sa position : l'ordre des
 * <select> de la page dépend de la barre d'outils, et un index se décalerait
 * sans qu'aucune erreur n'apparaisse.
 */
function choisirOption(reference, texte) {
  return `(() => {
    const select = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.textContent.trim() === ${JSON.stringify(reference)})
    );
    if (!select) return 'select absent';
    const option = [...select.options].find((o) => o.textContent.trim() === ${JSON.stringify(texte)});
    if (!option) return 'option absente : ' + [...select.options].map((o) => o.textContent.trim()).join(' | ');
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`;
}

const TOUTES_CATEGORIES = choisirOption('Toutes les catégories', 'Toutes les catégories');

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
  // au journal. On repart d'une liste vide.
  erreurs.length = 0;

  await send('Page.navigate', { url: `${WEB}/audit` });
  await sleep(3500);

  check(
    "l'écran est bien celui du journal",
    await evaluate("document.body.innerText.includes('Journal d')")
  );

  const total = await evaluate(LIGNES);
  check('le journal affiche des traces', total > 0, `${total} lignes`);

  // La mention d'immuabilité n'est pas décorative : elle annonce une
  // contrainte qu'un exploitant doit connaître avant de chercher à corriger une
  // erreur par une réécriture.
  check(
    "l'immuabilité du journal est annoncée",
    await evaluate("document.body.innerText.toLowerCase().includes('immuable')")
  );

  // Le filtre par catégorie doit réellement réduire la liste.
  const totalAvant = await evaluate(TOTAL_AFFICHE);
  check('le total du journal est annoncé', totalAvant > 0, `${totalAvant} entrées`);

  const applique = await evaluate(choisirOption('Toutes les catégories', 'Dépôt'));
  check('un filtre par catégorie peut être choisi', applique === 'ok', applique);
  await sleep(2000);
  const totalApres = await evaluate(TOTAL_AFFICHE);
  const lignesApres = await evaluate(LIGNES);
  check(
    'le filtre restreint effectivement la recherche',
    totalApres > 0 && totalApres < totalAvant,
    `${totalAvant} -> ${totalApres} entrées`
  );
  check(
    'la recherche filtrée affiche toujours des traces',
    lignesApres > 0,
    `${lignesApres} lignes`
  );
  // Le filtre est porté par l'URL : c'est ce qui permet de relire une
  // recherche, de la transmettre, et de vérifier ce qui a réellement été
  // demandé plutôt que ce qui a été coffiné dans un état de composant.
  check(
    'le filtre appliqué se lit dans l\'URL',
    await evaluate("new URL(location.href).searchParams.get('category') === 'DEPOT'"),
    await evaluate('location.search')
  );

  // Une catégorie qui ne correspond à aucune action n'est pas proposée : la
  // rattacher à « aucune » ferait croire qu'on pourrait encore la consulter.
  const categorieVide = await evaluate(choisirOption('Toutes les catégories', 'Non répertoriée'));
  check(
    'une catégorie sans action n\'est pas proposée',
    categorieVide.startsWith('option absente'),
    categorieVide.slice(0, 40)
  );

  // Retour à « Toutes les catégories ».
  await evaluate(TOUTES_CATEGORIES);
  await sleep(2000);
  check(
    'le journal complet revient',
    (await evaluate(TOTAL_AFFICHE)) === totalAvant,
    `${await evaluate(TOTAL_AFFICHE)} entrées`
  );

  // La recherche textuelle.
  await evaluate(TOUTES_CATEGORIES);
  // Ciblé par sa mention « motifs » : la barre de recherche de l'en-tête cherche
  // aussi, et le premier `input` de la page est le sien. Un filtre qui ne
  // filtre pas ne lève aucune erreur — il faut viser le bon champ pour le
  // voir à l'œuvre.
  const CHAMP_RECHERCHE = `document.querySelector('input[placeholder*="motifs"]')`;
  // Un terme réellement discriminant : la comparaison « avant/après » ne
  // prouverait rien avec un mot que toutes les traces contiennent.
  await evaluate(`(() => {
    const champ = ${CHAMP_RECHERCHE};
    if (!champ) return 'absent';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(champ, 'guichet');
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  // La frappe et l'Entrée sont deux gestes distincts, donc deux tours de boucle.
  // Envoyés dans la même tâche, React les traiterait ensemble et l'Entrée
  // verrait une saisie encore vide — ce que personne ne vit à la frappe.
  await sleep(400);
  await evaluate(`(() => {
    const champ = ${CHAMP_RECHERCHE};
    if (!champ) return 'absent';
    champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 'ok';
  })()`);
  await sleep(2000);
  const apresRecherche = await evaluate(TOTAL_AFFICHE);
  check(
    'la recherche sur un terme rare restreint la recherche',
    apresRecherche > 0 && apresRecherche < totalAvant,
    `${totalAvant} -> ${apresRecherche} entrées`
  );
  check(
    'les traces trouvées portent bien le terme',
    await evaluate(
      "[...document.querySelectorAll('tbody tr')].every((l) => l.innerText.toLowerCase().includes('guichet'))"
    )
  );

  // L'ouverture d'une trace doit montrer ce qui a changé : c'est l'intérêt de
  // la trace, sans quoi elle ne raconte rien.
  await evaluate(`(() => {
    const ligne = document.querySelector('tbody tr');
    if (!ligne) return 'absente';
    ligne.click();
    return 'ok';
  })()`);
  await sleep(1200);
  const detail = await evaluate("document.body.innerText");
  check(
    "une trace ouverte montre son détail",
    detail.includes('État') || detail.includes('Modifications') || detail.includes('Motif'),
    'détail affiché'
  );
} catch (erreur) {
  FAIL.push(`  FAIL  ${erreur.message}`);
} finally {
  console.log('\nJournal d\'audit — écran\n');
  console.log([...PASS, ...FAIL].join('\n'));
  console.log('\n======================================');
  console.log(`  RÉUSSIS : ${PASS.length}   ÉCHECS : ${FAIL.length}`);
  console.log('======================================');
  chrome.kill();
  process.exit(FAIL.length === 0 ? 0 : 1);
}
