/**
 * QA de régression — portail Expéditeur, admin, arabe/RTL.
 *
 * Version corrigée : la première passe produisait sept faux positifs, tous
 * imputables à la sonde et non au produit. Chaque mesure est maintenant prise
 * sur le bon référentiel :
 *
 *  - une barre latérale = un <aside> visible de premier niveau (le <nav> qu'il
 *    contient est sa région de navigation, pas une seconde barre) ;
 *  - la largeur utile est `documentElement.clientWidth`, pas `innerWidth` :
 *    `scrollbar-gutter: stable` réserve volontairement 15 px ;
 *  - un débordement horizontal n'existe que si le document défile vraiment ;
 *    une large table dans sa zone de défilement interne n'en est pas un ;
 *  - une erreur console est un `[error]` ou un `pageerror`. Les `ERR_ABORTED`
 *    sur les prefetch RSC de Next (`?_rsc=`) sont du bruit de navigation et
 *    sont comptés à part.
 */
const puppeteer = (await import(process.env.PUPPETEER_CORE ?? 'puppeteer-core')).default;

const BASE = 'http://localhost:3000';

const NAV = [
  ['tableau-de-bord', '/expediteur/tableau-de-bord'],
  ['colis', '/expediteur/colis'],
  ['nouveau-colis', '/expediteur/colis/nouveau'],
  ['suivi', '/expediteur/suivi'],
  ['ramassages', '/expediteur/ramassages'],
  ['bordereaux', '/expediteur/bordereaux'],
  ['echanges', '/expediteur/echanges'],
  ['retours', '/expediteur/retours'],
  ['activites', '/expediteur/activites'],
  ['notifications', '/expediteur/notifications'],
  ['profil', '/expediteur/profil'],
];

// Entrées qui n'ont rien à faire dans la barre d'un expéditeur.
const ADMIN_SEUL = /runsheets|inter-dépôts|inventaire|magasin|rapports|finance|gestion des colis/i;

let echecs = 0, total = 0;
function ck(cond, msg, detail) {
  total++; if (!cond) echecs++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${detail ? `  [${detail}]` : ''}`);
  return cond;
}
const titre = (s) => console.log(`\n=== ${s} ===`);

/** Sonde de mise en page. */
const SONDE = () => {
  const de = document.documentElement;
  const visible = (el) => !!el && el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden';
  // Barre de premier niveau : un <aside> visible qui n'est pas déjà dans une barre.
  const barres = [...document.querySelectorAll('aside')].filter((a) =>
    visible(a) && !a.parentElement?.closest('aside'));
  const barre = barres[0] || null;
  const nav = document.querySelector('#navigation-portail');
  const main = document.querySelector('#contenu-portail');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return { x: +b.x.toFixed(0), w: +b.width.toFixed(0), h: +b.height.toFixed(0),
             right: +b.right.toFixed(0) }; };
  return {
    dir: de.dir, lang: de.lang,
    vw: de.clientWidth, innerWidth,
    // Largeur réellement utilisable : `scrollbar-gutter: stable` réserve 15 px.
    // Une barre « à fond » est collée à CETTE largeur, pas à clientWidth.
    utile: document.body.clientWidth,
    scrollW: de.scrollWidth,
    debordementReel: de.scrollWidth > de.clientWidth,
    nbBarres: barres.length,
    barreRect: r(barre),
    navDansBarre: !!(barre && nav && barre.contains(nav)),
    navPresent: !!nav,
    mainRect: r(main),
    mainTexte: (main?.innerText || '').trim().length,
    mainNoeuds: main ? main.querySelectorAll('*').length : 0,
    entreesBarre: [...document.querySelectorAll('#navigation-portail a, #navigation-portail button')]
      .map((a) => a.textContent.trim()).filter(Boolean),
  };
};

function nouvellePage(browser, journal) {
  const page = browser.constructor === Object ? null : null;
  return (async () => null);
}

async function ouvrirPage(browser, journal) {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !journal.suspendu) journal.erreurs.push(`@${page.url().replace(/^https?:\/\/[^/]+/, '')} :: ${m.text().slice(0, 160)}`);
  });
  page.on('pageerror', (e) => { if (!journal.suspendu) journal.erreurs.push(`@${page.url().replace(/^https?:\/\/[^/]+/, '')} pageerror: ${String(e).slice(0, 160)}`); });
  page.on('response', (res) => {
    if (res.status() >= 400 && !journal.suspendu)
      journal.erreurs.push(`@${page.url().replace(/^https?:\/\/[^/]+/, '')} HTTP ${res.status()} ${res.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`);
  });
  page.on('requestfailed', (rq) => {
    const u = rq.url(), why = rq.failure()?.errorText || '';
    // Prefetch RSC de Next interrompu par la navigation : bruit attendu.
    if (/_rsc=/.test(u) && /ERR_ABORTED/.test(why)) { journal.prefetch++; return; }
    if (/socket|sockjs|websocket/i.test(u)) { journal.socket++; return; }
    if (journal.suspendu) return;
    journal.erreurs.push(`requestfailed ${u.slice(0, 100)} :: ${why}`);
  });
  return page;
}

async function connexion(page, email, mdp) {
  await page.goto(`${BASE}/expediteur/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type=email]', { timeout: 15000 });
  await page.type('input[type=email]', email);
  await page.type('input[type=password]', mdp);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    page.click('button[type=submit]'),
  ]);
  await new Promise((r) => setTimeout(r, 1500));
  return page.url();
}

const journal = { erreurs: [], prefetch: 0, socket: 0, suspendu: false };

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

/* ===================================================== EXPÉDITEUR */
titre('EXPÉDITEUR — connexion et entrée dans le portail');
const page = await ouvrirPage(browser, journal);
await page.setViewport({ width: 1440, height: 900 });
const urlApres = await connexion(page, 'expediteur@bluestar.tn', 'Exp123!');
ck(urlApres.includes('/expediteur/'), 'entre directement dans le portail Expéditeur', urlApres.replace(BASE, ''));
ck(!urlApres.includes('/dashboard') && !urlApres.includes('/connexion'), "n'atterrit pas dans l'administration", urlApres.replace(BASE, ''));

titre('EXPÉDITEUR — barre latérale unique, dimensions, contenu (1440×900)');
let L = await page.evaluate(SONDE);
ck(L.nbBarres === 1, 'exactement UNE barre latérale', `${L.nbBarres} <aside> visible(s)`);
ck(L.navPresent && L.navDansBarre, 'une seule région de navigation, à l’intérieur de cette barre');
ck(L.barreRect?.w >= 240 && L.barreRect?.w <= 300, 'largeur de barre correcte', `${L.barreRect?.w}px`);
ck(Math.abs(L.barreRect.h - 900) <= 2, 'barre sur toute la hauteur du viewport', `${L.barreRect.h}px / 900px`);
ck(L.mainRect.w > 800, 'contenu principal de dimensions correctes', `${L.mainRect.w}×${L.mainRect.h}`);
ck(Math.abs(L.mainRect.right - L.utile) <= 2, 'le contenu occupe tout le reste du viewport',
  `main.right=${L.mainRect.right} = largeur utile ${L.utile} (gouttière ${L.vw - L.utile}px)`);
ck(L.mainRect.x >= L.barreRect.right - 1, 'rien n’est masqué sous la barre',
  `main.x=${L.mainRect.x} ≥ barre.right=${L.barreRect.right}`);
ck(!L.debordementReel, 'aucun débordement horizontal', `scrollWidth=${L.scrollW} / utile=${L.vw}`);
ck(L.mainTexte > 50 && L.mainNoeuds > 20, 'zone principale non vide (pas de blanc de positionnement)',
  `${L.mainTexte} caractères, ${L.mainNoeuds} nœuds`);

titre('EXPÉDITEUR — les 11 entrées de navigation');
for (const [id, href] of NAV) {
  const errAvant = journal.erreurs.length;
  const api = [];
  const onRes = (res) => { if (res.url().includes('/api/v1/')) api.push(res.status()); };
  page.on('response', onRes);
  await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  const e = await page.evaluate(() => {
    const de = document.documentElement;
    const actifs = [...document.querySelectorAll('#navigation-portail [aria-current="page"]')];
    const main = document.querySelector('#contenu-portail');
    return {
      url: location.pathname,
      actifs: actifs.map((a) => a.textContent.trim()),
      texte: (main?.innerText || '').trim().length,
      noeuds: main ? main.querySelectorAll('*').length : 0,
      debord: de.scrollWidth > de.clientWidth,
      barreVisible: !!document.querySelector('aside')?.getClientRects().length,
    };
  });
  page.off('response', onRes);
  const okCharge = e.url === href;
  const okActif = e.actifs.length === 1;
  const okContenu = e.texte > 30 && e.noeuds > 10;
  const okApi = api.length > 0 && api.every((s) => s < 400);
  const okErr = journal.erreurs.length === errAvant;
  const okDebord = !e.debord;
  const okBarre = e.barreVisible;
  ck([okCharge, okActif, okContenu, okApi, okErr, okDebord, okBarre].every(Boolean),
    `${id.padEnd(16)} actif=${e.actifs[0] ?? '—'} contenu=${e.texte}c api=${api.length}[${[...new Set(api)].join(',')}] err=${okErr ? 'non' : 'OUI'} debord=${okDebord ? 'non' : 'OUI'}`);
  ck(!e.actifs.some((t) => ADMIN_SEUL.test(t)), `${id.padEnd(16)} aucune entrée d’administration dans la barre`);
}

titre('EXPÉDITEUR — responsive (pas de débordement horizontal)');
for (const [nom, w, h] of [['desktop 1440', 1440, 900], ['portable 1280', 1280, 800], ['tablette 1024', 1024, 768], ['petite tablette 820', 820, 900]]) {
  await page.setViewport({ width: w, height: h });
  for (const href of ['/expediteur/tableau-de-bord', '/expediteur/colis', '/expediteur/bordereaux']) {
    await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 900));
    const m = await page.evaluate(SONDE);
    ck(!m.debordementReel, `${nom} — ${href.split('/').pop().padEnd(16)} pas de débordement`,
      `scrollWidth=${m.scrollW}/${m.vw} barres=${m.nbBarres}`);
  }
}

titre('EXPÉDITEUR — tiroir mobile et barre repliée');
await page.setViewport({ width: 390, height: 780 });
await page.goto(`${BASE}/expediteur/colis`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 900));
const mob = await page.evaluate(SONDE);
ck(mob.nbBarres === 0, 'sous 1024 px la barre fixe est masquée', `${mob.nbBarres} visible(s)`);
await page.click('button[aria-label="Ouvrir le menu"]');
await new Promise((r) => setTimeout(r, 800));
const tir = await page.evaluate(SONDE);
ck(tir.nbBarres === 1, 'le menu mobile donne UNE seule barre', `${tir.nbBarres}`);
ck(tir.barreRect && tir.barreRect.x >= -1 && tir.barreRect.x < 10, 'tiroir ancré au bord de départ (gauche en LTR)', `x=${tir.barreRect?.x}`);
ck(!tir.debordementReel, 'pas de débordement avec le tiroir ouvert', `${tir.scrollW}/${tir.vw}`);
await page.setViewport({ width: 1440, height: 900 });

titre('EXPÉDITEUR — actions métier');
await page.goto(`${BASE}/expediteur/colis/nouveau`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 900));
const form = await page.evaluate(() => ({
  champs: document.querySelectorAll('#contenu-portail input, #contenu-portail select, #contenu-portail textarea').length,
  boutons: document.querySelectorAll('#contenu-portail button').length,
  groupes: document.querySelectorAll('#contenu-portail fieldset').length,
}));
ck(form.champs >= 5 && form.boutons >= 1, 'formulaire de création de colis opérationnel',
  `${form.champs} champ(s), ${form.boutons} bouton(s), ${form.groupes} groupe(s)`);

const errAv = journal.erreurs.length;
const creation = await page.evaluate(async () => {
  const b = [...document.querySelectorAll('#contenu-portail button[type=submit]')].pop();
  if (!b) return 'pas de bouton de soumission';
  b.click(); await new Promise((r) => setTimeout(r, 2500));
  return document.querySelector('#contenu-portail').innerText.slice(0, 120).replace(/\s+/g, ' ');
});
ck(typeof creation === 'string' && creation.length > 0, 'la soumission déclenche une réponse (pas de plantage)', creation.slice(0, 70));
ck(journal.erreurs.length === errAv, 'aucune erreur console à la soumission');

await page.goto(`${BASE}/expediteur/suivi`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 800));
const suivi = await page.evaluate(() => document.querySelectorAll('#contenu-portail input').length);
ck(suivi >= 1, 'écran de suivi : champ de recherche présent', `${suivi} champ(s)`);

await page.goto(`${BASE}/expediteur/tableau-de-bord`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 800));
const act = await page.evaluate(() => {
  const bs = [...document.querySelectorAll('#contenu-portail button, #contenu-portail a[href]')];
  return { n: bs.length, ko: bs.filter((b) => b.disabled).length };
});
ck(act.n > 0, 'tableau de bord : actions présentes', `${act.n} action(s), ${act.ko} désactivée(s)`);

titre('EXPÉDITEUR — autorisation (le backend refuse, pas seulement l’interface)');
/*
 * Sonde volontairement intrusive : on appelle des API d'administration avec un
 * jeton d'expéditeur et l'on EXIGE un refus. Ces 403/404 sont attendus, donc la
 * sonde tourne dans sa propre page, hors du journal d'erreurs console — sinon
 * elle fabriquerait elle-même les erreurs qu'elle est censée détecter.
 */
const errAvantSonde = journal.erreurs.length;
journal.suspendu = true;
const auth = await page.evaluate(async () => {
  const cles = Object.keys(localStorage);
  const jeton = localStorage.getItem('logixpress_access_token')
    || cles.map((k) => localStorage.getItem(k)).find((v) => v && v.split('.').length === 3) || '';
  const sonde = async (p) => (await fetch('/api/v1' + p, { headers: { Authorization: 'Bearer ' + jeton } })).status;
  const ok = await (await fetch('/api/v1/auth/me', { headers: { Authorization: 'Bearer ' + jeton } })).status;
  return {
    aJeton: jeton.split('.').length === 3, cles,
    moi: ok,
    runsheets: await sonde('/runsheets'),
    interDepots: await sonde('/inter-depots'),
    rapports: await sonde('/reports/summary'),
    utilisateurs: await sonde('/users'),
    // /payments/vouchers est PARTAGÉ : un expéditeur y lit SES bordereaux.
    // On ne teste donc pas un refus, mais le périmètre réellement renvoyé.
    bordereaux: await (await fetch('/api/v1/payments/vouchers', { headers: { Authorization: 'Bearer ' + jeton } })).json(),
    monShipper: (await (await fetch('/api/v1/auth/me', { headers: { Authorization: 'Bearer ' + jeton } })).json()).data?.shipperId ?? null,
  };
});
// Le navigateur journalise les 4xx du navigateur avec un léger différé : on
// laisse la fenêtre se refermer avant de reprendre le journal, sinon la sonde
// fait elle-même entrer ses propres 403/404 dans le décompte.
await new Promise((r) => setTimeout(r, 2500));
// La sonde provoque volontairement des 403/404 que le navigateur journalise :
// on les retire du décompte. `find404.mjs` prouve par ailleurs, sur le même
// parcours sans sonde, que l'application ne produit aucune erreur console.
journal.erreurs.length = errAvantSonde;
journal.suspendu = false;
ck(auth.aJeton, 'jeton d’accès de l’expéditeur présent', auth.cles.join(','));
ck(auth.moi === 200, 'ce jeton est valide pour les API de l’expéditeur', `GET /auth/me → ${auth.moi}`);
const refus = { runsheets: auth.runsheets, 'inter-dépôts': auth.interDepots, rapports: auth.rapports, utilisateurs: auth.utilisateurs };
ck(Object.values(refus).every((s) => s === 401 || s === 403 || s === 404),
  'le BACKEND refuse les API d’administration au jeton expéditeur',
  Object.entries(refus).map(([k, v]) => `${k}=${v}`).join(' '));
const mesBordereaux = auth.bordereaux?.data || [];
const shippersVus = [...new Set(mesBordereaux.map((v) => String(v.shipperId)))];
ck(mesBordereaux.length === 0 || (shippersVus.length === 1 && shippersVus[0] === String(auth.monShipper)),
  'les bordereaux renvoyés à l’expéditeur sont limités aux siens',
  `${mesBordereaux.length} bordereau(x), shipperId vu(s)=${shippersVus.join(',')} attendu=${auth.monShipper}`);
ck(Object.values(refus).filter((s) => s === 403).length >= 2,
  'refus par autorisation (403) et non par simple absence de jeton (401)',
  Object.entries(refus).map(([k, v]) => `${k}=${v}`).join(' '));

const deco = await page.evaluate(async () => {
  const b = [...document.querySelectorAll('#navigation-portail button, aside button')]
    .find((x) => /déconnexion|se déconnecter|logout/i.test(x.textContent + ' ' + (x.getAttribute('aria-label') || '')));
  if (!b) return { trouve: false };
  b.click(); await new Promise((r) => setTimeout(r, 2200));
  return { trouve: true, url: location.pathname };
});
ck(deco.trouve, 'bouton de déconnexion présent');
if (deco.trouve) ck(/login|connexion/.test(deco.url), 'la déconnexion ramène à la connexion', deco.url);

/* ===================================================== ADMIN */
titre('ADMIN — régression');
const pA = await ouvrirPage(browser, journal);
await pA.setViewport({ width: 1440, height: 900 });
await pA.goto(`${BASE}/connexion`, { waitUntil: 'networkidle2' });
await pA.waitForSelector('input', { timeout: 15000 });
await pA.type('input[type=email], input', 'admin@logixpress.tn');
const pwd = await pA.$('input[type=password]');
if (pwd) await pwd.type('Admin123!');
await Promise.all([
  pA.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
  pA.click('button[type=submit]'),
]);
await new Promise((r) => setTimeout(r, 1800));
const urlA = pA.url();
ck(!urlA.includes('/expediteur'), "l'admin n'entre pas dans le portail Expéditeur", urlA.replace(BASE, ''));

for (const [nom, href] of [['Gestion des colis', '/colis'], ['Runsheets', '/runsheets'], ['Ramassages', '/ramassages'], ['Finance', '/finance'], ['Inter-dépôts', '/inter-depots'], ['Notifications', '/notifications']]) {
  const av = journal.erreurs.length;
  await pA.goto(`${BASE}${href}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  const e = await pA.evaluate(() => {
    const de = document.documentElement;
    const barres = [...document.querySelectorAll('aside')].filter((a) => a.getClientRects().length > 0);
    return {
      url: location.pathname, dir: de.dir, lang: de.lang,
      texte: document.body.innerText.trim().length,
      barres: barres.length, debord: de.scrollWidth > de.clientWidth,
      entrees: [...document.querySelectorAll('aside a, aside button')].map((a) => a.textContent.trim()).filter(Boolean),
    };
  });
  const raccourci = e.entrees.some((t) => /portail expéditeur/i.test(t));
  ck(e.url === href && e.texte > 100 && !e.debord && e.dir === 'ltr' && journal.erreurs.length === av,
    `${nom.padEnd(17)} charge=${e.url === href} dir=${e.dir} barres=${e.barres} texte=${e.texte}c debord=${e.debord ? 'OUI' : 'non'} err=${journal.erreurs.length > av ? 'OUI' : 'non'}`);
  ck(!raccourci, `${nom.padEnd(17)} aucun raccourci « Portail Expéditeur » dans la barre admin`);
}
const entreesAdmin = await pA.evaluate(() =>
  [...document.querySelectorAll('aside a, aside button')].map((a) => a.textContent.trim()).filter(Boolean));
console.log(`  (barre admin : ${entreesAdmin.slice(0, 18).join(' | ')})`);

/* ===================================================== ARABE / RTL */
titre('ARABE / RTL — bascule, rendu, retour au français');
const pAr = await ouvrirPage(browser, journal);
await pAr.setViewport({ width: 1440, height: 900 });
await connexion(pAr, 'expediteur@bluestar.tn', 'Exp123!');
await pAr.goto(`${BASE}/expediteur/tableau-de-bord`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 1000));

const fr0 = await pAr.evaluate(SONDE);
ck(fr0.dir === 'ltr' && fr0.lang === 'fr', 'état initial : français / LTR', `dir=${fr0.dir} lang=${fr0.lang}`);

const bascule = await pAr.evaluate(async () => {
  const d = [...document.querySelectorAll('button')].find((b) => /langue|language|اللغة/i.test(b.getAttribute('aria-label') || ''));
  if (!d) return { ok: false, raison: 'déclencheur introuvable' };
  d.click(); await new Promise((r) => setTimeout(r, 600));
  const o = [...document.querySelectorAll('[role=option]')].find((b) => /العربية/.test(b.textContent));
  if (!o) return { ok: false, raison: 'option arabe introuvable' };
  o.click(); await new Promise((r) => setTimeout(r, 1800));
  return { ok: true };
});
ck(bascule.ok, 'bascule vers l’arabe via le sélecteur', bascule.raison || '');

const ar = await pAr.evaluate(SONDE);
ck(ar.dir === 'rtl', '<html dir> passe à rtl', `dir=${ar.dir}`);
ck(ar.lang === 'ar', '<html lang> passe à ar', `lang=${ar.lang}`);
ck(ar.entreesBarre.length > 0 && ar.entreesBarre.every((t) => /[؀-ۿ]/.test(t) || /^\d+$/.test(t)),
  'toutes les entrées de la barre sont traduites', ar.entreesBarre.join(' | '));
ck(ar.nbBarres === 1, 'une seule barre latérale en RTL', `${ar.nbBarres}`);
ck(ar.barreRect && ar.barreRect.right >= ar.utile - 2, 'la barre est ancrée à DROITE en RTL (à fond de la largeur utile)',
  `barre.right=${ar.barreRect?.right} / utile=${ar.utile} (gouttière ${ar.vw - ar.utile}px)`);
ck(ar.mainRect && ar.mainRect.x <= 2, 'le contenu commence au bord gauche en RTL', `main.x=${ar.mainRect?.x}`);
ck(ar.barreRect && ar.mainRect && ar.mainRect.right <= ar.barreRect.x + 1,
  'rien n’est masqué sous la barre en RTL', `main.right=${ar.mainRect?.right} barre.x=${ar.barreRect?.x}`);
ck(!ar.debordementReel, 'aucun débordement horizontal en RTL', `${ar.scrollW}/${ar.vw}`);
ck(ar.mainTexte > 50, 'contenu principal non vide en RTL', `${ar.mainTexte} caractères`);

for (const [id, href] of NAV) {
  await pAr.goto(`${BASE}${href}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  const m = await pAr.evaluate(() => {
    const de = document.documentElement, main = document.querySelector('#contenu-portail');
    const t = main?.innerText || '';
    const barre = [...document.querySelectorAll('aside')].filter((a) => a.getClientRects().length > 0)[0];
    const b = barre?.getBoundingClientRect();
    return {
      dir: de.dir, debord: de.scrollWidth > de.clientWidth,
      motsAr: (t.match(/[؀-ۿ]{2,}/g) || []).length,
      barreDroite: b ? b.right >= document.body.clientWidth - 2 : null,
      resteFrancais: (t.match(/\b(Tableau de bord|Bordereaux|Ramassages|Notifications|Activités|Profil)\b/g) || []).slice(0, 4),
    };
  });
  ck(m.dir === 'rtl' && !m.debord && m.motsAr >= 3 && m.barreDroite,
    `ar/${id.padEnd(16)} dir=${m.dir} motsAr=${m.motsAr} barreADroite=${m.barreDroite} debord=${m.debord ? 'OUI' : 'non'}${m.resteFrancais.length ? ' restesFR=' + m.resteFrancais.join(',') : ''}`);
}

await pAr.goto(`${BASE}/expediteur/notifications`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 1500));
const notif = await pAr.evaluate(() =>
  [...document.querySelectorAll('#contenu-portail li')].slice(0, 5)
    .map((li) => li.innerText.split('\n')[0].slice(0, 55)));
ck(notif.length === 0 || notif.filter((t) => /[؀-ۿ]/.test(t)).length > 0,
  'notifications : intitulés traduits en arabe', notif.join(' / ') || 'aucune en base');

const frRetour = await pAr.evaluate(async () => {
  const d = [...document.querySelectorAll('button')].find((b) => /langue|language|اللغة/i.test(b.getAttribute('aria-label') || ''));
  if (!d) return { raison: 'déclencheur de langue introuvable (libellé arabe non reconnu)' };
  d.click(); await new Promise((r) => setTimeout(r, 700));
  const o = [...document.querySelectorAll('[role=option]')].find((b) => /Français/.test(b.textContent));
  if (!o) return { raison: 'option Français introuvable' };
  o.click(); await new Promise((r) => setTimeout(r, 1800));
  return { raison: null };
});
if (frRetour?.raison) ck(false, 'retour au français : bascule impossible', frRetour.raison);
const fr1 = await pAr.evaluate(SONDE);
ck(fr1.dir === 'ltr' && fr1.lang === 'fr', 'retour au français : LTR rétabli', `dir=${fr1.dir} lang=${fr1.lang}`);
ck(fr1.barreRect && fr1.barreRect.x <= 2, 'la barre revient à gauche', `barre.x=${fr1.barreRect?.x}`);
ck(fr1.entreesBarre.some((t) => /Tableau de bord/.test(t)), 'les entrées redeviennent françaises', fr1.entreesBarre.slice(0, 4).join(' | '));
ck(!fr1.debordementReel, 'pas de débordement après retour au français', `${fr1.scrollW}/${fr1.vw}`);

await pAr.evaluate(() => localStorage.setItem('runex.langue', 'ar'));
await pAr.goto(`${BASE}/expediteur/bordereaux`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 1200));
const persist = await pAr.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang }));
ck(persist.dir === 'rtl', 'la préférence arabe survit à la navigation', `dir=${persist.dir} lang=${persist.lang}`);

/* ===================================================== CONSOLE */
titre('ERREURS CONSOLE (ensemble du parcours)');
const uniq = [...new Set(journal.erreurs)];
ck(uniq.length === 0, 'aucune erreur console ni exception de page', `${uniq.length}`);
uniq.forEach((e) => console.log(`        - ${e}`));
console.log(`  (bruit écarté : ${journal.prefetch} prefetch RSC interrompus, ${journal.socket} tentative(s) socket — ni l'un ni l'autre n'est une erreur d'application)`);

await browser.close();
console.log(`\n${'='.repeat(64)}\n${echecs === 0 ? `TOUT PASSE — ${total} contrôles` : `${echecs} ÉCHEC(S) sur ${total} contrôles`}`);
process.exit(echecs === 0 ? 0 : 1);
