/**
 * QA des écrans d'administration (comptes, expéditeurs, livreurs).
 *
 * Leçons reprises des sondes précédentes, pour ne pas répéter les faux positifs :
 *  - un seul `<aside>` visible de premier niveau compte comme barre latérale, un
 *    `<nav>` imbriqué n'est pas une seconde barre ;
 *  - le débordement se mesure sur `documentElement.clientWidth`, pas
 *    `innerWidth` : `scrollbar-gutter: stable` réserve déjà la gouttière ;
 *  - seuls `[error]` et `pageerror` comptent comme erreurs de console ;
 *  - `browser.newPage()` partage la session : on réutilise la page existante.
 */

const puppeteer = (
  await import(process.env.PUPPETEER_CORE ?? 'puppeteer-core')
).default;

const BASE = 'http://localhost:3000';
let ok = 0;
const echecs = [];
function verif(cond, libelle) {
  if (cond) {
    ok++;
    console.log(`  OK   ${libelle}`);
  } else {
    echecs.push(libelle);
    console.log(`  FAIL ${libelle}`);
  }
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const erreurs = [];
page.on('console', (m) => {
  if (m.type() === 'error') erreurs.push(`[console] ${m.text()}`);
});
page.on('pageerror', (e) => erreurs.push(`[pageerror] ${e.message}`));
const reponses = [];
page.on('response', (r) => {
  if (r.status() >= 400) reponses.push(`${r.status()} ${r.url().replace(BASE, '')}`);
});

async function connexion(email, motDePasse) {
  // Les expéditeurs ont leur propre page de connexion : `/connexion` les refuse
  // et les renvoie vers `/expediteur/login`. Se tromper de porte laissait la
  // sonde sur un formulaire vide, jeton absent — et les vérifications
  // d'absence d'entrée de menu passaient alors à tort.
  const porte = email.includes('expediteur') ? '/expediteur/login' : '/connexion';
  await page.goto(`${BASE}${porte}`, { waitUntil: 'networkidle2' }).catch(() => {});
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}${porte}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="password"]', { timeout: 15000 });
  await page.evaluate(
    ([e, m]) => {
      const champs = [...document.querySelectorAll('input')];
      const setVal = (el, v) => {
        const proto = Object.getPrototypeOf(el);
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const mail = champs.find((c) => c.type === 'email') ?? champs[0];
      const mdp = champs.find((c) => c.type === 'password');
      setVal(mail, e);
      setVal(mdp, m);
    },
    [email, motDePasse]
  );
  await page.evaluate(() => {
    const f = document.querySelector('form');
    const b = [...document.querySelectorAll('button[type=submit]')][0];
    if (b) b.click();
    else if (f) f.requestSubmit();
  });
  // Attente du jeton, pas d'un délai fixe : lire le stockage trop tôt renvoyait
  // un porteur vide et l'API répondait 401 là où l'on voulait mesurer un 403.
  await page
    .waitForFunction(
      () => (localStorage.getItem('logixpress_access_token') ?? '').length > 20,
      { timeout: 20000 }
    )
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
}

async function mesure() {
  return page.evaluate(() => {
    const barres = [...document.querySelectorAll('aside')].filter((a) => {
      const r = a.getBoundingClientRect();
      const parentAside = a.parentElement?.closest('aside');
      return r.width > 0 && r.height > 0 && !parentAside;
    });
    const main = document.querySelector('main');
    const mr = main?.getBoundingClientRect();
    return {
      barres: barres.length,
      barreLargeur: barres[0] ? Math.round(barres[0].getBoundingClientRect().width) : 0,
      mainX: mr ? Math.round(mr.x) : -1,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      texte: main ? main.innerText.length : 0,
      dir: document.documentElement.getAttribute('dir'),
      lang: document.documentElement.getAttribute('lang'),
      titres: [...document.querySelectorAll('main h1, main h2')].map((h) => h.innerText.trim()),
      lignes: document.querySelectorAll('main tbody tr').length,
      navItems: [...document.querySelectorAll('aside button, aside a')]
        .map((a) => a.innerText.trim())
        .filter(Boolean),
      courant: document.querySelector('aside [aria-current="page"]')?.innerText.trim() ?? null,
    };
  });
}

/* ------------------------------------------------------------------ */
console.log('\n=== 1. Connexion administrateur ===');
await connexion('admin@logixpress.tn', 'Admin123!');
verif(page.url().includes('/dashboard'), `atterrit sur /dashboard (${page.url().replace(BASE, '')})`);

const navAdmin = await page.evaluate(() =>
  [...document.querySelectorAll('aside button, aside a')].map((a) => a.innerText.trim())
);
verif(navAdmin.some((t) => t.includes('Comptes utilisateurs')), 'entrée « Comptes utilisateurs » présente');
verif(navAdmin.some((t) => t === 'Expéditeurs'), 'entrée « Expéditeurs » présente');
verif(navAdmin.some((t) => t === 'Livreurs'), 'entrée « Livreurs » présente');

/* ------------------------------------------------------------------ */
console.log('\n=== 2. Les trois écrans se chargent ===');
const attentes = [
  ['/admin/utilisateurs', 'Comptes utilisateurs', 8],
  ['/admin/expediteurs', 'Expéditeurs', 3],
  ['/admin/livreurs', 'Livreurs', 3],
];

for (const [route, titreAttendu, lignesMin] of attentes) {
  erreurs.length = 0;
  reponses.length = 0;
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  const m = await mesure();

  verif(m.barres === 1, `${route} : une seule barre latérale (${m.barres})`);
  verif(m.mainX === m.barreLargeur, `${route} : main aligné après la barre (x=${m.mainX}, barre=${m.barreLargeur})`);
  verif(m.scrollWidth <= m.clientWidth, `${route} : pas de débordement (${m.scrollWidth} ≤ ${m.clientWidth})`);
  verif(m.titres.some((t) => t.includes(titreAttendu)), `${route} : titre « ${titreAttendu} » (${m.titres.join(' | ')})`);
  verif(m.lignes >= lignesMin, `${route} : ${m.lignes} lignes affichées (≥ ${lignesMin})`);
  verif(m.courant === titreAttendu, `${route} : entrée active = « ${m.courant} »`);
  verif(
    erreurs.filter((e) => !e.includes('favicon')).length === 0,
    `${route} : aucune erreur console (${erreurs.join(' ; ') || 'aucune'})`
  );
  const bruyants = reponses.filter((r) => !r.includes('favicon'));
  verif(bruyants.length === 0, `${route} : aucune réponse ≥ 400 (${bruyants.join(' ; ') || 'aucune'})`);
}

/* ------------------------------------------------------------------ */
console.log('\n=== 3. Aucune donnée sensible à l’écran ===');
for (const [route] of attentes) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  const html = await page.evaluate(() => document.querySelector('main').innerHTML);
  verif(!html.includes('passwordHash'), `${route} : pas de passwordHash dans le DOM`);
  verif(!/\$pbkdf2|\bpbkdf2\b/i.test(html), `${route} : pas d’empreinte de mot de passe dans le DOM`);
}

/* ------------------------------------------------------------------ */
console.log('\n=== 4. Filtrage et recherche ===');
await page.goto(`${BASE}/admin/utilisateurs`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 1500));
const avant = await page.evaluate(() => document.querySelectorAll('main tbody tr').length);
await page.evaluate(() => {
  const sel = [...document.querySelectorAll('select')].find((s) => s.getAttribute('aria-label') === 'Filtrer par rôle');
  const proto = Object.getPrototypeOf(sel);
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(sel, 'LIVREUR');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 1800));
const apres = await page.evaluate(() => {
  const lignes = [...document.querySelectorAll('main tbody tr')];
  return { n: lignes.length, textes: lignes.map((l) => l.innerText) };
});
verif(apres.n > 0 && apres.n < avant, `filtre rôle=LIVREUR réduit la liste (${avant} → ${apres.n})`);
verif(
  apres.textes.every((t) => /Livreur/i.test(t)),
  'toutes les lignes filtrées portent bien le rôle Livreur'
);

/* ------------------------------------------------------------------ */
console.log('\n=== 5. Un expéditeur ne voit ni n’atteint l’administration ===');
await connexion('expediteur@bluestar.tn', 'Exp123!');
const urlExp = page.url();
verif(urlExp.includes('/expediteur'), `session expéditeur établie (${urlExp.replace(BASE, '')})`);
const navExp = await page.evaluate(() =>
  [...document.querySelectorAll('aside button, aside a')].map((a) => a.innerText.trim())
);
verif(navExp.length > 0, `la barre du portail est bien rendue (${navExp.length} entrées)`);
verif(!navExp.some((t) => t.includes('Comptes utilisateurs')), 'aucune entrée « Comptes utilisateurs » côté expéditeur');
verif(!navExp.some((t) => t === 'Livreurs'), 'aucune entrée « Livreurs » côté expéditeur');

const codes = await page.evaluate(async () => {
  const jeton = localStorage.getItem('logixpress_access_token');
  const out = {};
  for (const p of ['/users', '/shippers', '/drivers']) {
    const r = await fetch(`/api/v1${p}`, { headers: { Authorization: `Bearer ${jeton}` } });
    out[p] = r.status;
  }
  return out;
});
verif(codes['/users'] === 403, `API /users en expéditeur → 403 (${codes['/users']})`);
verif(codes['/shippers'] === 403, `API /shippers en expéditeur → 403 (${codes['/shippers']})`);
verif(codes['/drivers'] === 403, `API /drivers en expéditeur → 403 (${codes['/drivers']})`);

/* ------------------------------------------------------------------ */
/*
 * 6. Direction du document sur les écrans d'administration.
 *
 * Le sélecteur de langue n'existe que dans le portail Expéditeur
 * (`CoquillePortail` et la page de connexion). Le gabarit d'administration ne
 * l'a jamais porté — vérifié sur `git show HEAD:...AppLayout.tsx`, zéro
 * référence. L'administration est donc française de bout en bout, comme avant
 * cette livraison. On vérifie ici ce qui est vrai : la direction reste cohérente
 * et aucun écran ne la casse.
 */
console.log('\n=== 6. Direction du document (administration, française) ===');
// La section précédente a connecté un expéditeur : l'écran d'administration lui
// est fermé, il faut reprendre une session administrateur pour la mesurer.
await connexion('admin@logixpress.tn', 'Admin123!');
await page.goto(`${BASE}/admin/utilisateurs`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 1500));
const dirAdmin = await mesure();
verif(dirAdmin.dir === 'ltr' && dirAdmin.lang === 'fr', `dir=${dirAdmin.dir} lang=${dirAdmin.lang}`);
verif(
  (await page.evaluate(
    () =>
      [...document.querySelectorAll('button')].filter((b) =>
        /اللغة|langue|language/i.test(`${b.getAttribute('aria-label') ?? ''} ${b.innerText}`)
      ).length
  )) === 0,
  'aucun sélecteur de langue dans le gabarit d’administration (état préexistant)'
);
verif(dirAdmin.barres === 1, `une seule barre latérale (${dirAdmin.barres})`);
verif(dirAdmin.scrollWidth <= dirAdmin.clientWidth, `pas de débordement (${dirAdmin.scrollWidth} ≤ ${dirAdmin.clientWidth})`);

// Le portail Expéditeur, lui, bascule bien en arabe : les deux espaces restent
// indépendants et l'administration ne perturbe pas la bascule du portail.
await connexion('expediteur@bluestar.tn', 'Exp123!');
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /اللغة|langue|language/i.test(`${b.getAttribute('aria-label') ?? ''} ${b.innerText}`)
  );
  if (btn) btn.click();
});
await new Promise((r) => setTimeout(r, 800));
await page.evaluate(() => {
  const opt = [...document.querySelectorAll('button, [role=option], a')].find((b) =>
    /العربية/.test(b.innerText ?? '')
  );
  if (opt) opt.click();
});
await new Promise((r) => setTimeout(r, 2000));
const rtl = await mesure();
verif(rtl.dir === 'rtl' && rtl.lang === 'ar', `portail expéditeur en arabe : dir=${rtl.dir} lang=${rtl.lang}`);
verif(rtl.mainX === 0, `arabe : main collé au bord de départ (x=${rtl.mainX})`);
verif(rtl.scrollWidth <= rtl.clientWidth, `arabe : pas de débordement (${rtl.scrollWidth} ≤ ${rtl.clientWidth})`);

/* ------------------------------------------------------------------ */
console.log('\n=== 7. Tenue responsive, sans débordement ===');
for (const largeur of [1440, 1280, 1024, 820]) {
  await page.setViewport({ width: largeur, height: 900 });
  await page.goto(`${BASE}/admin/expediteurs`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  const m = await mesure();
  verif(m.scrollWidth <= m.clientWidth, `${largeur}px : pas de débordement (${m.scrollWidth} ≤ ${m.clientWidth})`);
}

await browser.close();

console.log(`\n${echecs.length === 0 ? 'TOUT PASSE' : 'ÉCHECS'} — ${ok} contrôles, ${echecs.length} échec(s)`);
if (echecs.length) {
  echecs.forEach((e) => console.log(`  - ${e}`));
  process.exit(1);
}
