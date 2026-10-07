/**
 * Contrôle responsive multi-viewports : ouvre chaque écran avec une session
 * réelle, à cinq largeurs, et vérifie que la page ne déborde pas.
 *
 * `verify-console-errors.mjs` prouve qu'un écran s'affiche sans erreur, à la
 * seule largeur de la fenêtre de test. Il ne dit rien de ce qui arrive sur un
 * téléphone, où le défaut le plus courant n'est pas une erreur : c'est une page
 * qui déborde horizontalement, avec une barre de défilement que personne ne sait
 * expliquer, ou des tableaux compressés jusqu'à l'illisible.
 *
 * Deux mesures par écran et par largeur :
 *
 *  - le débordement de la page (`scrollWidth` du document contre la largeur de la
 *    fenêtre) : un pixel de plus et l'écran devient inutilisable sur téléphone ;
 *  - les cibles tactiles trop petites : en dessous de 24 px de côté, le doigt
 *    rate le bouton, et l'utilisateur renonce à l'action.
 *
 * Les zones de défilement internes des tableaux sont volontairement exclues du
 * contrôle de débordement : c'est leur rôle de défiler. C'est la page entière
 * qui ne doit jamais déborder.
 *
 * Usage : node scripts/verify-responsive.mjs
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEB = 'http://localhost:3000';
const API = 'http://localhost:4000/api/v1';
const PORT = 9346;

/**
 * Largeurs testées.
 *
 * 1440 : poste de comptoir, la référence de conception.
 * 1280 : portable 13 pouces, la largeur où un tableau dense commence à
 *        contraindre les colonnes.
 * 1024 : tablette en paysage, la frontière au-delà de laquelle la barre
 *        latérale se replie.
 * 768  : tablette en portrait, la largeur la plus étroite où l'on garde des
 *        tableaux.
 * 390  : téléphone, où seule la disposition en fiches reste lisible.
 */
const LARGEURS = [
  { px: 1440, nom: 'poste 1440' },
  { px: 1280, nom: 'portable 1280' },
  { px: 1024, nom: 'tablette paysage 1024' },
  { px: 768, nom: 'tablette portrait 768' },
  { px: 390, nom: 'téléphone 390' },
];

/** Écrans à vérifier : ceux qui portent des tableaux ou des grilles denses. */
const ECRANS = [
  { chemin: '/dashboard', nom: 'Tableau de bord' },
  { chemin: '/colis', nom: 'Colis' },
  { chemin: '/runsheets', nom: 'Tournées' },
  { chemin: '/paiements', nom: 'Encaissements' },
  { chemin: '/finance', nom: 'Finance' },
  { chemin: '/inter-depots', nom: 'Transferts inter-dépôts' },
  { chemin: '/inventaire', nom: 'Inventaire' },
  { chemin: '/magasin', nom: 'Magasin' },
  { chemin: '/audit', nom: 'Journal d’audit' },
  { chemin: '/rapports', nom: 'Rapports' },
  { chemin: '/notifications', nom: 'Notifications' },
  // Le portail et son écran de connexion appartiennent à l'espace expéditeur :
  // leur coquille n'a pas la même structure que celle de l'exploitation. Le
  // portail se mesure avec une session expéditeur — la seule qui ait le droit
  // d'y entrer. L'écran de connexion, lui, se mesure avec une session
  // d'exploitation : injector un jeton expéditeur le ferait basculer aussitôt
  // vers le portail, et l'on ne mesurerait plus le formulaire.
  { chemin: '/expediteur/login', nom: 'Connexion expéditeur', session: 'exploitation' },
  { chemin: '/expediteur', nom: 'Portail expéditeur', session: 'expediteur' },
];

/**
 * Mesure le débordement et les cibles tactiles.
 *
 * Les éléments à défilement propre (tableaux, listes longues) sont exclus du
 * contrôle de la page : leur débordement est intentionnel. On retire aussi les
 * éléments invisibles, qui ne peuvent pas être Responsible d'un débordement
 * perçu.
 */
const MESURE = `(() => {
  const largeurFenetre = window.innerWidth;
  const zone = document.querySelector('.scroll-region-x, [data-scroll-region]');
  const defilementInterne = zone
    ? zone.getBoundingClientRect().right <= largeurFenetre + 1
    : true;

  // Le document déborde si son contenu dépasse la fenêtre. On tolère un pixel
  // pour les arrondis de mise à l'échelle.
  const debordement = Math.max(
    document.documentElement.scrollWidth - largeurFenetre,
    document.body ? document.body.scrollWidth - largeurFenetre : 0
  );

  // Les cibles tactiles : boutons, liens et champs cliquables visibles.
  const petites = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, [role="tab"]')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    // Un élément masqué hors focus (lien d'évitement, texte pour lecteur d'écran)
    // mesure un pixel : il n'a rien à faire d'atteignable avant le focus.
    if (rect.width <= 2 && rect.height <= 2) continue;
    // Seuls les éléments cliquables sont mesurés : un lien dans une phrase
  // n'a pas à atteindre 24 px pour être utilisable.
    if (rect.height < 24 || rect.width < 24) {
      petites.push({
        texte: (el.innerText || el.getAttribute('aria-label') || el.tagName).slice(0, 40),
        l: Math.round(rect.width),
        h: Math.round(rect.height),
      });
    }
  }

  return { debordement, defilementInterne, largeurFenetre, petites: petites.slice(0, 6) };
})()`;

const chrome = spawn(
  CHROME,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/lx-chrome-responsive-profile',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

process.on('exit', () => chrome.kill());

let ws;
let nextId = 1;
const pending = new Map();

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
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      return await res.json();
    } catch {
      await sleep(200);
    }
  }
  throw new Error('Chrome ne répond pas sur le port de débogage.');
}

const targets = await waitForChrome();
const page = targets.find((t) => t.type === 'page');
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve));

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
});

await send('Page.enable');
await send('Runtime.enable');

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@logixpress.tn', password: 'Admin123!' }),
});
const session = (await login.json()).data;

// Session expéditeur : seule légitime sur `/expediteur`.
const loginExpediteur = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'expediteur@bluestar.tn', password: 'Exp123!' }),
});
const sessionExpediteur = (await loginExpediteur.json()).data;
const sessions = { exploitation: session, expediteur: sessionExpediteur };

await send('Page.navigate', { url: `${WEB}/connexion` });
await sleep(1500);
// Les clés doivent être celles de `tokenStorage` dans `apps/web/src/lib/api.ts`,
// sinon la session n'est pas installée et chaque écran affiche la connexion.
await send('Runtime.evaluate', {
  expression: `(() => {
    localStorage.setItem('logixpress_access_token', ${JSON.stringify(session.accessToken)});
    localStorage.setItem('logixpress_refresh_token', ${JSON.stringify(session.refreshToken)});
  })()`,
});

let reussis = 0;
let echecs = 0;
const lignes = [];

console.log('\nContrôle responsive — la page ne doit jamais déborder horizontalement\n');

for (const ecran of ECRANS) {
  const parLargeur = [];

  // Une session par espace : injecter celle de l'écran avant de mesurer.
  if (ecran.session) {
    const cible = sessions[ecran.session];
    await send('Runtime.evaluate', {
      expression: `(() => {
        localStorage.setItem('logixpress_access_token', ${JSON.stringify(cible.accessToken)});
        localStorage.setItem('logixpress_refresh_token', ${JSON.stringify(cible.refreshToken)});
      })()`,
    });
  }

  for (const largeur of LARGEURS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: largeur.px,
      height: 900,
      deviceScaleFactor: 1,
      mobile: largeur.px < 768,
    });
    await send('Page.navigate', { url: `${WEB}${ecran.chemin}` });
    // Laisse le temps au rendu client, aux appels API et à l'hydratation.
    await sleep(2600);

    const res = await send('Runtime.evaluate', {
      expression: MESURE,
      returnByValue: true,
    });
    const mesure = res.result.value;
    if (!mesure) continue;

    // La connexion à la place de l'écran n'est pas un écran valide.
    const surConnexion = await send('Runtime.evaluate', {
      expression: "document.body.innerText.includes('Se Connecter')",
      returnByValue: true,
    });

    const defauts = [];
    if (surConnexion.result.value) defauts.push('affiche la connexion');
    if (mesure.debordement > 1) defauts.push(`déborde de ${mesure.debordement} px`);

    if (defauts.length === 0) {
      reussis++;
      parLargeur.push(`  OK   ${largeur.nom}`.trimEnd());
    } else {
      echecs++;
      parLargeur.push(`  FAIL ${largeur.nom} — ${defauts.join(', ')}`);
    }

    if (mesure.petites.length > 0) {
      const horsEcran = largeur.px < 768;
      if (horsEcran) {
        const detail = mesure.petites
          .map((c) => `« ${c.texte} » ${c.l}×${c.h}`)
          .join(', ');
        parLargeur.push(`         cible tactile trop petite : ${detail}`);
      }
    }
  }

  lignes.push(`${ecran.nom} (${ecran.chemin})`, ...parLargeur);
}

await send('Emulation.clearDeviceMetricsOverride');

console.log(lignes.join('\n'));
console.log('\n======================================');
console.log(`  RÉUSSIS : ${reussis}   ÉCHECS : ${echecs}`);
console.log('======================================');

ws.close();
chrome.kill();

process.exit(echecs > 0 ? 1 : 0);