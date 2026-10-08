/**
 * Contrôle des erreurs navigateur : ouvre chaque écran avec une session réelle
 * et collecte ce que la console affiche réellement — messages d'erreur, exceptions
 * non rattrapées et requêtes réseau en échec.
 *
 * `verify-frontend.mjs` vérifie que le DOM contient les données de l'API ; il
 * n'écoute ni `Log.entryAdded` ni `Runtime.exceptionThrown`, donc un écran peut
 * rendre correctement tout en loguant des erreurs. Ce script couvre ce angle.
 *
 * Usage : node scripts/verify-console-errors.mjs
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEB = 'http://localhost:3000';
const API = 'http://localhost:4000/api/v1';
const PORT = 9334;

const chrome = spawn(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/lx-chrome-console-profile',
  'about:blank',
]);

process.on('exit', () => chrome.kill());

let ws;
let nextId = 1;
const pending = new Map();

/** Erreurs relevées depuis la dernière remise à zéro, par écran. */
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
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      return await res.json();
    } catch {
      await sleep(200);
    }
  }
  throw new Error("Chrome ne répond pas sur le port de débogage.");
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
    return;
  }
  switch (msg.method) {
    case 'Log.entryAdded':
      if (msg.params.entry.level === 'error') {
        events.push({ kind: 'console.error', text: msg.params.entry.text, url: msg.params.entry.url });
      }
      break;
    case 'Runtime.exceptionThrown': {
      const d = msg.params.exceptionDetails;
      events.push({
        kind: 'exception',
        text: d.exception?.description ?? d.text,
        url: d.url,
      });
      break;
    }
    case 'Network.loadingFailed':
      if (!msg.params.canceled) {
        events.push({ kind: 'network', text: msg.params.errorText, url: msg.params.requestId });
      }
      break;
    case 'Network.responseReceived': {
      const { status, url } = msg.params.response;
      if (status >= 400) events.push({ kind: 'http', text: `HTTP ${status}`, url });
      break;
    }
    default:
      break;
  }
});

await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Page.enable');

/** Ouvre une page, collecte ce que la console émet, puis rend la liste. */
async function inspect(url, evaluate) {
  events.length = 0;
  await send('Page.navigate', { url });
  // Laisse le temps au rendu client, aux appels API et à l'hydratation.
  await sleep(3500);
  const res = await send('Runtime.evaluate', { expression: evaluate, returnByValue: true });
  return { value: res.result.value, events: [...events] };
}

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@logixpress.tn', password: 'Admin123!' }),
});
const session = (await login.json()).data;

await send('Page.navigate', { url: `${WEB}/connexion` });
await sleep(1500);
// Les clés doivent être celles de `tokenStorage` dans `apps/web/src/lib/api.ts`.
// Sinon le jeton est écrit dans le vide, l'application ne trouve pas de
// session, et chaque écran passe au décompte en affichant… l'écran de
// connexion, dont le texte suffit largement à passer les assertions.
await send('Runtime.evaluate', {
  expression: `(() => {
    localStorage.setItem('logixpress_access_token', ${JSON.stringify(session.accessToken)});
    localStorage.setItem('logixpress_refresh_token', ${JSON.stringify(session.refreshToken)});
  })()`,
});

// Un écran qui renvoie l'utilisateur vers la connexion est un échec, pas une
// page valide. Le simple fait d'afficher du texte ne prouve rien : l'écran de
// connexion en affiche beaucoup. D'où le contrôle explicite, appliqué à tous
// les écrans, plus une reconnaissance propre à chacun.
const notLogin =
  "document.body.innerText.includes('Se Connecter') ? false : document.body.innerText.length > 200";

const SCREENS = [
  ['/dashboard', notLogin],
  ['/colis', notLogin],
  ['/runsheets', notLogin],
  ['/ramassages', notLogin],
  ['/paiements', `${notLogin} && document.body.innerText.includes('Encaissements clients')`],
  [
    '/paiements/expediteurs',
    `${notLogin} && document.body.innerText.includes('Caisse par expéditeur')`,
  ],
  ['/paiements/livreurs', `${notLogin} && document.body.innerText.includes('Caisse par livreur')`],
  ['/finance', `${notLogin} && document.body.innerText.includes('Bilan de la caisse')`],
  ['/inter-depots', notLogin],
  ['/magasin', notLogin],
  ['/audit', `${notLogin} && document.body.innerText.includes('Journal d')`],
  [
    '/notifications',
    `${notLogin} && document.body.innerText.includes('Centre de notifications')`,
  ],
  [
    '/inventaire',
    `${notLogin} && document.body.innerText.includes('Inventaire / Historique')`,
  ],
  [
    '/recherche',
    /*
     * Cette page est légitimement vide tant qu'aucune recherche n'est lancée :
     * son texte visible tient dans une centaine de caractères. Le seuil
     * générique de 200 caractères, prévu pour écarter l'écran de connexion,
     * la déclarait donc non rendue alors qu'elle l'était parfaitement. On
     * contrôle son contenu réel, comme les autres écrans.
     */
    `!document.body.innerText.includes('Se Connecter') && document.body.innerText.includes('Recherche') && document.body.innerText.includes('Colis, expéditeurs, livreurs')`,
  ],
  [
    '/rapports',
    `${notLogin} && document.body.innerText.includes('Période appliquée')`,
  ],
];

/*
 * Parcours joués sur les écrans à tableau.
 *
 * Un écran qui s'affiche au chargement peut se casser à la première
 * interaction : c'est ainsi qu'un état remis à `null` entre deux rendus est
 * passé inaperçu, alors que la page devenait blanche dès qu'on cliquait une
 * ligne. Ces parcours ouvrent donc une fiche réelle et vérifient qu'aucune
 * exception n'est levée pendant le clic.
 */
const INTERACTIONS = [
  {
    route: '/colis',
    nom: 'ouverture de la fiche colis',
    etapes: [
      `document.querySelector('tbody tr')?.click()`,
      `document.body.innerText.includes('Suivre') || document.body.innerText.includes('Tracking') || document.querySelectorAll('h1, h2').length > 0`,
    ],
  },
  {
    route: '/colis',
    nom: 'ouverture du formulaire d’affectation et recherche d’un livreur',
    etapes: [
      `document.querySelector('tbody tr')?.click()`,
      `[...document.querySelectorAll('button')].find((b) => b.innerText.includes('Assigner Livreur'))?.click()`,
      // Deux caractères : l'API de recherche n'en accepte pas moins.
      `(() => {
        const champ = [...document.querySelectorAll('input')].find((i) =>
          (i.placeholder || '').includes('matricule')
        );
        if (!champ) return 'champ introuvable';
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        ).set;
        setter.call(champ, 'ha');
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        return 'saisi';
      })()`,
      `document.body.innerText.length > 100`,
    ],
  },
  {
    route: '/runsheets',
    nom: 'ouverture de la fiche tournée',
    etapes: [
      `document.querySelector('tbody tr')?.click()`,
      `document.querySelectorAll('h1, h2').length > 0`,
    ],
  },
  {
    route: '/paiements',
    nom: 'ouverture d’un encaissement',
    etapes: [
      `document.querySelector('tbody tr')?.click()`,
      `document.querySelectorAll('h1, h2').length > 0`,
    ],
  },
];

let pass = 0;
let fail = 0;
const lines = [];

for (const [route, evaluate] of SCREENS) {
  const { value, events: found } = await inspect(`${WEB}${route}`, evaluate);
  const rendered = Boolean(value);
  if (rendered && found.length === 0) {
    pass++;
    lines.push(`  OK   ${route}  rendu, console propre`);
  } else {
    fail++;
    lines.push(
      `  FAIL ${route}  rendu=${rendered}  erreurs=${found.length}`
    );
    for (const e of found) {
      lines.push(`         [${e.kind}] ${e.text}${e.url ? ` — ${e.url}` : ''}`);
    }
  }
}

console.log('\n3. Erreurs console / réseau par écran :');
console.log(lines.join('\n'));

/* ------------------------------------------------------------------ */
/*
 * Le portail expéditeur se vérifie avec une session expéditeur : c'est la seule
 * qui ait le droit d'y entrer. Le même écran contrôlé avec une session
 * d'exploitation le serait à tort — il n'y rendrait qu'un refus.
 */
console.log('\n4. Portail expéditeur, session expéditeur :');
{
  const expLogin = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'expediteur@bluestar.tn', password: 'Exp123!' }),
  });
  const expSession = (await expLogin.json()).data;

  await send('Page.navigate', { url: `${WEB}/expediteur/login` });
  await sleep(1500);
  await send('Runtime.evaluate', {
    expression: `(() => {
      localStorage.setItem('logixpress_access_token', ${JSON.stringify(expSession.accessToken)});
      localStorage.setItem('logixpress_refresh_token', ${JSON.stringify(expSession.refreshToken)});
    })()`,
  });

  events.length = 0;
  await send('Page.navigate', { url: `${WEB}/expediteur` });
  await sleep(3500);
  const rendered = await send('Runtime.evaluate', {
    expression: `(() => {
      const t = document.body.innerText;
      return t.includes('Portail expéditeur') || t.includes('Espace Expéditeur') || /Mes colis/i.test(t);
    })()`,
    returnByValue: true,
  });
  const found = [...events];
  const ok = Boolean(rendered.result.value) && found.length === 0;
  if (ok) {
    pass++;
    console.log('  OK   /expediteur  portail rendu, console propre');
  } else {
    fail++;
    console.log(
      `  FAIL /expediteur  rendu=${Boolean(rendered.result.value)}  erreurs=${found.length}`
    );
    for (const e of found) {
      console.log(`         [${e.kind}] ${e.text}${e.url ? ` — ${e.url}` : ''}`);
    }
  }
}

/* ------------------------------------------------------------------ */
console.log("\n5. Parcours d'interaction :");

/*
 * La passe expéditeur a laissé ses jetons dans le navigateur. Les parcours
 * ci-dessous ouvrent des écrans de l'exploitation : sans cette remise en place,
 * ils se dérouleraient avec une session de portail et échoueraient sur des 403
 * sans rapport avec ce qu'ils contrôlent.
 */
await send('Page.navigate', { url: `${WEB}/connexion` });
await sleep(1500);
await send('Runtime.evaluate', {
  expression: `(() => {
    localStorage.setItem('logixpress_access_token', ${JSON.stringify(session.accessToken)});
    localStorage.setItem('logixpress_refresh_token', ${JSON.stringify(session.refreshToken)});
  })()`,
});

let passages = 0;
let pannes = 0;
const lignesParcours = [];

for (const parcours of INTERACTIONS) {
  events.length = 0;
  await send('Page.navigate', { url: `${WEB}${parcours.route}` });
  await sleep(3500);
  for (const etape of parcours.etapes) {
    await send('Runtime.evaluate', { expression: etape, returnByValue: true });
    // Laisse le temps au rendu et aux appels produits par le clic.
    await sleep(1800);
  }
  const exceptions = events.filter(
    (e) => e.kind === 'exception' || e.kind === 'console.error'
  );
  if (exceptions.length === 0) {
    passages++;
    lignesParcours.push(`  OK   ${parcours.route}  ${parcours.nom}`);
  } else {
    pannes++;
    lignesParcours.push(`  FAIL ${parcours.route}  ${parcours.nom}`);
    for (const e of exceptions) {
      lignesParcours.push(`         [${e.kind}] ${e.text.split('\n')[0]}`);
    }
  }
}
console.log(lignesParcours.join('\n'));

console.log(`\n======================================`);
console.log(`  ÉCRANS PROPRES : ${pass}   AVEC ERREURS : ${fail}`);
console.log(`  PARCOURS OK : ${passages}   EN PANNE : ${pannes}`);
console.log('======================================');

ws.close();
chrome.kill();
process.exit(fail === 0 && pannes === 0 ? 0 : 1);
