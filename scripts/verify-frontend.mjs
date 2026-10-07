/**
 * Vérification navigateur : ouvre chaque écran avec une session réelle
 * (jetons obtenus via POST /auth/login) et contrôle que le DOM contient les
 * données effectivement servies par l'API.
 *
 * Usage : node scripts/verify-frontend.mjs
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEB = 'http://localhost:3000';
const API = 'http://localhost:4000/api/v1';
const PORT = 9333;

const chrome = spawn(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/lx-chrome-profile',
  'about:blank',
]);

process.on('exit', () => chrome.kill());

async function cdpTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

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
        reject(new Error(`timeout sur ${method}`));
      }
    }, 30000);
  });
}

async function navigate(url) {
  await send('Page.navigate', { url });
  await sleep(2500);
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'erreur JS');
  }
  return result.result.value;
}

async function domText() {
  return evaluate('document.body.innerText');
}

// Attend que leCDP réponde.
let targets = null;
for (let i = 0; i < 40; i++) {
  try {
    targets = await cdpTargets();
    if (targets.length) break;
  } catch {
    /* le navigateur n'écoute pas encore */
  }
  await sleep(500);
}
if (!targets?.length) {
  console.error('Impossible de démarrer Chrome en mode débogage.');
  process.exit(1);
}

ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
};
await send('Page.enable');
await send('Runtime.enable');

// --- Session réelle, obtenue auprès de l'API ---
console.log('1. Connexion réelle à l\'API…');
const loginResponse = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@logixpress.tn', password: 'Admin123!' }),
});
const session = (await loginResponse.json()).data;
console.log(`   → ${session.user.fullName} (${session.user.role})`);

// Contrôle supplémentaire : des identifiants erronés doivent être refusés.
const badLogin = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@logixpress.tn', password: 'mauvais' }),
});
console.log(`   → mot de passe erroné refusé : HTTP ${badLogin.status}`);

await navigate(WEB);
await evaluate(`
  localStorage.setItem('logixpress_access_token', ${JSON.stringify(session.accessToken)});
  localStorage.setItem('logixpress_refresh_token', ${JSON.stringify(session.refreshToken)});
  'ok'
`);
console.log('2. Jetons injectés dans le navigateur.');

// --- Contrôle de chaque écran ---
const screens = [
  { path: '/dashboard', must: ['Poste de Commandement Logistique'], label: 'Tableau de bord' },
  { path: '/colis', must: ['Gestion'], label: 'Colis' },
  { path: '/runsheets', must: ['Runsheet'], label: 'Runsheets' },
  { path: '/ramassages', must: ['Ramassage'], label: 'Ramassages' },
  { path: '/paiements', must: ['Bordereaux'], label: 'Paiements' },
  { path: '/inter-depots', must: ['Inter-Dépôts'], label: 'Inter-dépôts' },
  { path: '/magasin', must: ['Acceptation Magasin'], label: 'Magasin' },
  { path: '/design-system', must: ['Design System'], label: 'Design system' },
  { path: '/notifications', must: ['Centre de notifications'], label: 'Notifications' },
  { path: '/inventaire', must: ['Inventaire / Historique', 'Exporter CSV'], label: 'Inventaire' },
  { path: '/recherche', must: ['Colis, expéditeurs, livreurs'], label: 'Recherche' },
  { path: '/audit', must: ['Journal d', 'immuable'], label: 'Journal d audit' },
  { path: '/rapports', must: ["Rapports d'exploitation", 'Période appliquée', 'Périmètre'], label: 'Rapports' },
];

let pass = 0;
let fail = 0;

/*
 * Le portail expéditeur ne doit plus figurer parmi les entrées de la
 * navigation interne. Le contrôle porte sur les liens eux-mêmes : une entrée
 * masquée par du CSS, ou rendue puis retirée, laisserait un raccourci
 * exactement comme avant.
 */
console.log('\n3. La navigation interne ne propose plus le portail expéditeur :');
await navigate(`${WEB}/dashboard`);
const entreesNav = await evaluate(`
  [...document.querySelectorAll('nav a, aside a')]
    .map((a) => a.getAttribute('href') || '')
    .join(' ')
`);
const texteNav = await domText();
const lienPortail = entreesNav.includes('/expediteur');
const libellePortail = texteNav.includes('Portail Expéditeur');
const navOk = !lienPortail && !libellePortail;
if (navOk) pass++;
else fail++;
console.log(
  `  ${navOk ? 'OK  ' : 'FAIL'}  aucun lien ni libellé de portail dans la barre latérale` +
    (navOk ? '' : `  <- ${entreesNav}`)
);

console.log('\n4. Rendu des écrans avec session :');
for (const screen of screens) {
  await navigate(`${WEB}${screen.path}`);
  const text = await domText();
  const url = await evaluate('location.pathname');
  const found = screen.must.some((needle) => text.includes(needle));
  const shell = text.includes('Se Connecter');
  const ok = found && !shell;
  if (ok) pass++;
  else fail++;
  console.log(
    `   ${ok ? 'OK  ' : 'FAIL'} ${screen.path.padEnd(16)} ${screen.label.padEnd(22)} url=${url}${
      shell ? ' [RETOUR CONNEXION !]' : ''
    }`
  );
}

// --- Preuve que les chiffres proviennent de l'API et non de valeurs codées ---
await navigate(`${WEB}/dashboard`);
const dashboardText = await domText();
const apiDashboard = (await (await fetch(`${API}/dashboard`, {
  headers: { Authorization: `Bearer ${session.accessToken}` },
})).json()).data;

const totalColis = String(apiDashboard.colis.total);
// innerText reflète les transformations CSS : les libellés en capitales
// (uppercase) doivent être comparés sans tenir compte de la casse.
const apiShowsTotal = dashboardText.toLowerCase().includes(`total : ${totalColis}`.toLowerCase());
const successRate = String(apiDashboard.colis.tauxReussite);
const showsRate = dashboardText.includes(`${successRate}%`);
console.log(
  `\n5. Données du tableau de bord issues de l'API : total colis API=${totalColis} → ` +
    `présent dans le DOM : ${apiShowsTotal ? 'oui' : 'non'} ; taux de réussite API=${successRate}% → ` +
    `présent : ${showsRate ? 'oui' : 'non'}`
);
if (!apiShowsTotal || !showsRate) fail++;

// --- Expéditeur : accès séparé, vérifié côté rendu ---
const shipperLogin = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'expediteur@bluestar.tn', password: 'Exp123!' }),
});
const shipperSession = (await shipperLogin.json()).data;

/*
 * Trois contrôles, dans l'ordre où ils protègent quelque chose.
 *
 * 1. La session d'exploitation ne doit pas tomber sur le portail : ni en
 *    acceptant de le rendre, ni en le renvoyant vers la connexion. Un accès
 *    accordé par la seule présence d'une session est exactement ce que la
 *    séparation interdit.
 * 2. Une session expéditeur, elle, doit obtenir le portail — la porte ne doit
 *    pas être fermée à son légitime titulaire.
 * 3. Le portail ne doit plus porter la navigation de l'exploitation : ce sont
 *    deux espaces distincts, pas deux onglets du même.
 */
await navigate(`${WEB}/expediteur`);
const adminSurPortail = await domText();
const adminRefuse =
  adminSurPortail.includes('réservé') && !adminSurPortail.includes('Mes Colis');
console.log(
  `7. Session d'exploitation sur /expediteur : refus explicite = ${adminRefuse ? 'oui' : 'non'}` +
    (adminRefuse ? '' : `  <- ${adminSurPortail.slice(0, 120).replace(/\n/g, ' ')}`)
);
if (!adminRefuse) fail++;

await navigate(WEB);
await evaluate(`
  localStorage.setItem('logixpress_access_token', ${JSON.stringify(shipperSession.accessToken)});
  localStorage.setItem('logixpress_refresh_token', ${JSON.stringify(shipperSession.refreshToken)});
  'ok'
`);
await navigate(`${WEB}/expediteur`);
const shipperText = await domText();
const shipperOk =
  shipperText.includes('Portail expéditeur') || shipperText.includes('Mes Colis');
console.log(`8. Portail expéditeur rendu pour ${shipperSession.user.fullName} : ${shipperOk ? 'oui' : 'non'}`);
if (!shipperOk) fail++;

const navInterne =
  shipperText.includes('Poste de Commandement') ||
  shipperText.includes('Runsheets Livreurs') ||
  shipperText.includes('Journal d');
console.log(
  `9. Portail expéditeur sans navigation d'exploitation : ${navInterne ? 'NON' : 'oui'}`
);
if (navInterne) fail++;

console.log(`\n======================================`);
console.log(`  ÉCRANS OK : ${pass}   ÉCHECS : ${fail}`);
console.log(`======================================`);

chrome.kill();
process.exit(fail === 0 ? 0 : 1);
