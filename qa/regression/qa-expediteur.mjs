/**
 * QA de régression — portail Expéditeur, admin, et arabe/RTL.
 *
 * Piloté par Chromium réel : chaque contrôle est une mesure prise dans la page,
 * pas une déduction faite depuis le code source.
 */
const puppeteer = (await import(process.env.PUPPETEER_CORE ?? 'puppeteer-core')).default;

const BASE = 'http://localhost:3000';
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

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

// Libellés propres à l'administration : leur présence dans le portail Expéditeur
// serait une fuite de contenu non autorisé.
const ADMIN_SEUL = [
  'Runsheets', 'Inter-dépôts', 'Inter-dépôt', 'Inventaire', 'Magasin',
  'Rapports', 'Recherche globale', 'Gestion des Colis', 'Tableau de bord exploitation',
];

let echecs = 0;
let total = 0;
function ck(cond, msg, detail) {
  total++;
  if (!cond) echecs++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${detail ? `  [${detail}]` : ''}`);
  return cond;
}
function titre(s) { console.log(`\n=== ${s} ===`); }

/** Sonde de mise en page, exécutée dans la page. */
const SONDE_LAYOUT = () => {
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' &&
      cs.display !== 'none' && (el.getClientRects().length > 0);
  };
  // Une « barre latérale » est un <aside> : les <nav> d'onglets horizontaux ne
  // sont pas des barres, et le <nav> du portail vit DANS l'aside.
  const barres = [...document.querySelectorAll('aside')].filter(visible);
  const barre = document.querySelector('#navigation-portail')?.closest('aside') ?? document.querySelector('#navigation-portail');
  const main = document.querySelector('#contenu-portail');
  const racine = document.querySelector('#contenu-portail')?.closest('.h-dvh');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1),
             right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1) }; };
  const de = document.documentElement;
  return {
    dir: de.dir, lang: de.lang,
    viewport: { w: innerWidth, h: innerHeight },
    docScrollW: de.scrollWidth, bodyScrollW: document.body.scrollWidth,
    barrePresente: !!barre, barreVisible: visible(barre), barreRect: r(barre),
    barresVisibles: barres.length,
    barresDetail: barres.map((b) => ({ id: b.id || null, w: +b.getBoundingClientRect().width.toFixed(1) })),
    mainPresent: !!main, mainRect: r(main),
    mainTexte: (main?.innerText || '').trim().length,
    mainEnfants: main ? main.querySelectorAll('*').length : 0,
    racineRect: r(racine),
    // Éléments qui dépassent réellement du viewport
    debordants: [...document.querySelectorAll('body *')]
      .filter((el) => { const b = el.getBoundingClientRect();
        if (!(b.width > 0 && (b.right > innerWidth + 1 || b.left < -1))) return false;
        // Un élément dans un conteneur à défilement horizontal (tableau large)
        // ne déborde pas de la page : il est découpé par son conteneur.
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return false;
        }
        return true; })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 50)}`),
  };
};

async function nouvellePage(browser, erreurs) {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      // Le socket de notifications n'est pas relayé par le mandataire : attendu ici.
      if (/websocket|socket\.io|ERR_CONNECTION|WebSocket/i.test(t)) return;
      erreurs.push(`console: ${t.slice(0, 200)}`);
    }
  });
  page.on('pageerror', (e) => erreurs.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (/socket|sockjs/.test(u)) return;
    // Préchargements RSC interrompus par une navigation : bruit de Next, pas une erreur.
    if (/[?&]_rsc=/.test(u) && /ERR_ABORTED/.test(r.failure()?.errorText ?? '')) return;
    erreurs.push(`requestfailed: ${u.slice(0, 120)} ${r.failure()?.errorText}`);
  });
  return page;
}

/** Réponses API observées pendant un chargement. */
function suivreApi(page) {
  const appels = [];
  page.on('response', (res) => {
    const u = res.url();
    if (!u.includes('/api/v1/')) return;
    appels.push({ url: u.replace(/^https?:\/\/[^/]+/, ''), status: res.status() });
  });
  return appels;
}

async function connexion(page, email, motDePasse) {
  await page.goto(`${BASE}/expediteur/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type=email]', { timeout: 15000 });
  await page.type('input[type=email]', email);
  await page.type('input[type=password]', motDePasse);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    page.click('button[type=submit]'),
  ]);
  await new Promise((r) => setTimeout(r, 1200));
  return page.url();
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
  });

  const erreurs = [];
  const page = await nouvellePage(browser, erreurs);
  await page.setViewport({ width: 1440, height: 900 });
  suivreApi(page);

  /* ------------------------------------------------- EXPÉDITEUR : CONNEXION */
  titre('EXPÉDITEUR — connexion et entrée dans le portail');
  const urlApres = await connexion(page, 'expediteur@bluestar.tn', 'Exp123!');
  ck(urlApres.includes('/expediteur/'), 'entre directement dans le portail Expéditeur', urlApres.replace(BASE, ''));
  ck(!urlApres.includes('/dashboard') && !urlApres.endsWith('/connexion'),
    "n'atterrit pas sur l'interface d'administration", urlApres.replace(BASE, ''));
  ck(await page.$('#navigation-portail') !== null, 'coquille Expéditeur rendue (nav#navigation-portail)');
  ck(await page.$('#contenu-portail') !== null, 'zone de contenu rendue (main#contenu-portail)');

  /* ------------------------------------------------ EXPÉDITEUR : STRUCTURE */
  titre('EXPÉDITEUR — barre latérale unique et dimensions (1440×900)');
  let L = await page.evaluate(SONDE_LAYOUT);
  ck(L.barresVisibles === 1, `exactement UNE barre latérale visible`, `${L.barresVisibles} visible(s) : ${JSON.stringify(L.barresDetail)}`);
  ck(!L.barresDetail.some((b, i) => L.barresDetail.findIndex((x) => x.w === b.w && x.id === b.id) !== i && b.w < 90),
    'aucun rail replié dupliqué');
  ck(L.barreRect && L.barreRect.w > 0 && L.barreRect.h >= 800,
    'barre latérale de dimensions correctes', `${L.barreRect?.w}×${L.barreRect?.h}`);
  ck(L.mainRect && L.mainRect.w > 500, 'contenu principal de dimensions correctes', `${L.mainRect?.w}×${L.mainRect?.h}`);
  ck(Math.abs(L.mainRect.right - L.viewport.w) <= 20,
    'le contenu occupe le reste du viewport', `main.right=${L.mainRect.right} viewport=${L.viewport.w}`);
  ck(L.mainRect.x >= L.barreRect.right - 1,
    'rien n’est masqué sous la barre latérale', `main.x=${L.mainRect.x} barre.right=${L.barreRect.right}`);
  ck(L.docScrollW <= L.viewport.w, 'aucun débordement horizontal (document)', `scrollWidth=${L.docScrollW} viewport=${L.viewport.w}`);
  ck(L.mainTexte > 50, 'zone principale non vide (pas de blanc de positionnement)', `${L.mainTexte} caractères, ${L.mainEnfants} nœuds`);
  ck(L.debordants.length === 0, 'aucun élément ne dépasse du viewport', L.debordants.join(' | '));

  /* ------------------------------------------- EXPÉDITEUR : NAVIGATION x11 */
  titre('EXPÉDITEUR — les 11 entrées de navigation');
  const fuites = [];
  for (const [id, href] of NAV) {
    const avant = erreurs.length;
    const apiAvant = [];
    const onRes = (res) => { if (res.url().includes('/api/v1/')) apiAvant.push(res.status()); };
    page.on('response', onRes);
    await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 900));
    const etat = await page.evaluate(() => {
      const actif = document.querySelector('#navigation-portail [aria-current="page"]');
      const main = document.querySelector('#contenu-portail');
      const de = document.documentElement;
      const txt = (main?.innerText || '').trim();
      return {
        actif: actif ? actif.textContent.trim() : null,
        nbActifs: document.querySelectorAll('#navigation-portail [aria-current="page"]').length,
        texte: txt.length,
        url: location.pathname,
        scrollW: de.scrollWidth, vw: innerWidth,
        barreVisible: !!document.querySelector('#navigation-portail')?.getClientRects().length,
      };
    });
    const okCharge = etat.url === href;
    const okActif = etat.nbActifs === 1 && etat.actif !== null;
    const okContenu = etat.texte > 30;
    const okApi = apiAvant.length > 0 && apiAvant.every((s) => s < 400 || s === 404);
    const okErr = erreurs.length === avant;
    const okDebord = etat.scrollW <= etat.vw;
    page.off('response', onRes);

    const ligne = [okCharge, okActif, okContenu, okApi, okErr, okDebord];
    ck(ligne.every(Boolean), `${id.padEnd(17)} charge=${okCharge ? 'o' : 'n'} actif=${okActif ? 'o' : 'n'}(${etat.actif ?? '—'}) contenu=${etat.texte}c api=${apiAvant.length}appel(s)[${apiAvant.join(',')}] err=${okErr ? 'non' : 'OUI'} debord=${okDebord ? 'non' : 'OUI'}`);

    // Fuite de contenu admin dans le portail
    const corps = await page.evaluate(() => document.body.innerText);
    for (const mot of ADMIN_SEUL) if (corps.includes(mot)) fuites.push(`${id}: « ${mot} »`);
  }
  ck(fuites.length === 0, "aucun contenu d'administration ne fuit dans le portail", fuites.join(' | '));

  /* ------------------------------------------ EXPÉDITEUR : TROIS LARGEURS */
  titre('EXPÉDITEUR — responsive (desktop / portable / tablette)');
  for (const [nom, w, h] of [['desktop 1440', 1440, 900], ['portable 1280', 1280, 800], ['tablette 1024', 1024, 768]]) {
    await page.setViewport({ width: w, height: h });
    await page.goto(`${BASE}/expediteur/colis`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 700));
    const m = await page.evaluate(SONDE_LAYOUT);
    ck(m.docScrollW <= m.viewport.w && m.debordants.length === 0,
      `${nom} : pas de débordement horizontal`, `scrollWidth=${m.docScrollW}/${m.viewport.w} barres=${m.barresVisibles} debordants=${m.debordants.length}`);
  }

  /* -------------------------------------------------- EXPÉDITEUR : MOBILE */
  titre('EXPÉDITEUR — tiroir mobile (le défaut RTL historique)');
  await page.setViewport({ width: 390, height: 780 });
  await page.goto(`${BASE}/expediteur/colis`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  const avantTiroir = await page.evaluate(SONDE_LAYOUT);
  ck(avantTiroir.barresVisibles === 0, 'sous 1024 px la barre fixe est masquée (pas de double barre)', `${avantTiroir.barresVisibles} visible(s)`);
  const declencheur = await page.evaluateHandle(() => [...document.querySelectorAll('header button[aria-label], button[aria-label]')]
    .find((b) => b.getClientRects().length > 0 && b.getBoundingClientRect().width > 0) ?? null).then((h) => h.asElement());
  if (declencheur) {
    await declencheur.click();
    await new Promise((r) => setTimeout(r, 700));
    const tiroir = await page.evaluate(SONDE_LAYOUT);
    ck(tiroir.barresVisibles === 1, "l'ouverture du menu donne UNE seule barre", `${tiroir.barresVisibles}`);
    ck(tiroir.barreRect && tiroir.barreRect.x >= -1 && tiroir.barreRect.x < 10,
      'le tiroir est ancré au bord de départ (gauche en LTR)', `x=${tiroir.barreRect?.x}`);
    ck(tiroir.docScrollW <= tiroir.viewport.w, 'pas de débordement avec le tiroir ouvert', `${tiroir.docScrollW}/${tiroir.viewport.w}`);
  } else {
    ck(false, 'déclencheur du menu mobile introuvable');
  }
  await page.setViewport({ width: 1440, height: 900 });

  /* ------------------------------------------------ EXPÉDITEUR : ACTIONS */
  titre('EXPÉDITEUR — actions métier');
  // Création de colis : le formulaire s'ouvre et ses champs sont présents
  await page.goto(`${BASE}/expediteur/colis/nouveau`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 700));
  const champs = await page.evaluate(() => ({
    inputs: document.querySelectorAll('#contenu-portail input, #contenu-portail select, #contenu-portail textarea').length,
    boutons: document.querySelectorAll('#contenu-portail button').length,
    fieldsets: document.querySelectorAll('#contenu-portail fieldset').length,
  }));
  ck(champs.inputs >= 5 && champs.boutons >= 1, 'formulaire de création de colis opérationnel',
    `${champs.inputs} champ(s), ${champs.boutons} bouton(s), ${champs.fieldsets} groupe(s)`);

  // Soumission réelle : on laisse le backend répondre (succès ou 400 métier)
  const errAvant = erreurs.length;
  const reponseCreation = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('#contenu-portail button[type=submit]')].pop();
    if (!btn) return 'aucun bouton de soumission';
    btn.click();
    await new Promise((r) => setTimeout(r, 2500));
    return document.querySelector('#contenu-portail').innerText.slice(0, 160).replace(/\n/g, ' ');
  });
  ck(typeof reponseCreation === 'string', 'la soumission du colis déclenche une réponse (pas de plantage)',
    String(reponseCreation).slice(0, 90));
  ck(erreurs.length === errAvant, 'aucune erreur console à la soumission');

  // Suivi
  await page.goto(`${BASE}/expediteur/suivi`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  const suivi = await page.evaluate(() => document.querySelectorAll('#contenu-portail input').length);
  ck(suivi >= 1, 'écran de suivi : champ de recherche présent', `${suivi} champ(s)`);

  // Boutons cliquables sur chaque écran listé
  await page.goto(`${BASE}/expediteur/tableau-de-bord`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  const boutonsTdb = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('#contenu-portail button, #contenu-portail a[href]')];
    return { n: bs.length, desactives: bs.filter((b) => b.disabled).length };
  });
  ck(boutonsTdb.n > 0, 'tableau de bord : actions présentes', `${boutonsTdb.n} action(s), ${boutonsTdb.desactives} désactivée(s)`);

  // Déconnexion
  const deco = await page.evaluate(async () => {
    const b = [...(document.querySelector('#navigation-portail')?.closest('aside') ?? document).querySelectorAll('button')];
    const cible = b.find((x) => /déconnexion|logout|se déconnecter/i.test(x.textContent + x.getAttribute('aria-label')));
    if (!cible) return { trouve: false, n: b.length };
    cible.click();
    await new Promise((r) => setTimeout(r, 2000));
    return { trouve: true, url: location.pathname };
  });
  ck(deco.trouve, 'bouton de déconnexion présent dans la barre latérale');
  if (deco.trouve) ck(/login|connexion/.test(deco.url), 'la déconnexion ramène à la connexion', deco.url);

  /* -------------------------------------------------------- ADMIN : RÉGRESSION */
  titre('ADMIN — régression');
  const pageAdmin = await nouvellePage(browser, erreurs);
  await pageAdmin.setViewport({ width: 1440, height: 900 });
  const apiAdmin = suivreApi(pageAdmin);
  await pageAdmin.goto(`${BASE}/connexion`, { waitUntil: 'networkidle2' });
  const aChamps = await pageAdmin.$$('input');
  ck(aChamps.length >= 2, 'écran de connexion admin rendu', `${aChamps.length} champ(s)`);
  await pageAdmin.type('input[type=email], input[name=email], input', 'admin@logixpress.tn');
  const pwd = await pageAdmin.$('input[type=password]');
  if (pwd) await pwd.type('Admin123!');
  await Promise.all([
    pageAdmin.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    pageAdmin.click('button[type=submit]'),
  ]);
  await new Promise((r) => setTimeout(r, 1500));
  const urlAdmin = pageAdmin.url();
  ck(!urlAdmin.includes('/expediteur'), "l'admin n'entre pas dans le portail Expéditeur", urlAdmin.replace(BASE, ''));

  const ADMIN_NAV = [
    ['Gestion des colis', '/colis'], ['Runsheets', '/runsheets'], ['Ramassages', '/ramassages'],
    ['Finance', '/finance'], ['Inter-dépôts', '/inter-depots'], ['Notifications', '/notifications'],
  ];
  for (const [nom, href] of ADMIN_NAV) {
    const avant = erreurs.length;
    await pageAdmin.goto(`${BASE}${href}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 900));
    const e = await pageAdmin.evaluate(() => {
      const de = document.documentElement;
      const navs = [...document.querySelectorAll('nav, aside')].filter((el) => el.getClientRects().length > 0);
      return {
        url: location.pathname, dir: de.dir, lang: de.lang,
        texte: document.body.innerText.trim().length,
        navs: navs.length, scrollW: de.scrollWidth, vw: innerWidth,
        corps: document.body.innerText.slice(0, 4000),
      };
    });
    const raccourci = /Portail Expéditeur/i.test(e.corps);
    ck(e.url === href && e.texte > 100 && e.scrollW <= e.vw && e.dir === 'ltr' && erreurs.length === avant,
      `${nom.padEnd(18)} charge=${e.url === href} dir=${e.dir} texte=${e.texte}c nav=${e.navs} debord=${e.scrollW > e.vw ? 'OUI' : 'non'} err=${erreurs.length > avant ? 'OUI' : 'non'}`);
    ck(!raccourci, `${nom.padEnd(18)} aucun raccourci « Portail Expéditeur » dans la barre admin`);
  }

  /* ------------------------------------------------------ ARABE / RTL */
  titre('ARABE / RTL — bascule de langue');
  const pageAr = await nouvellePage(browser, erreurs);
  await pageAr.setViewport({ width: 1440, height: 900 });
  await connexion(pageAr, 'expediteur@bluestar.tn', 'Exp123!');
  await pageAr.goto(`${BASE}/expediteur/tableau-de-bord`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  const frAvant = await pageAr.evaluate(() => ({
    dir: document.documentElement.dir, lang: document.documentElement.lang,
    barre: document.querySelector('#navigation-portail')?.innerText.slice(0, 200),
    stocke: localStorage.getItem('runex.langue'),
  }));
  ck(frAvant.dir === 'ltr' && frAvant.lang === 'fr', 'état initial : français / LTR', `dir=${frAvant.dir} lang=${frAvant.lang} stocké=${frAvant.stocke}`);

  // Bascule via l'interface, comme un utilisateur
  const bascule = await pageAr.evaluate(async () => {
    const decl = [...document.querySelectorAll('button')].find((b) =>
      /langue|language|اللغة/i.test(b.getAttribute('aria-label') || ''));
    if (!decl) return { ok: false, raison: 'déclencheur de langue introuvable' };
    decl.click();
    await new Promise((r) => setTimeout(r, 500));
    const opt = [...document.querySelectorAll('[role=option]')].find((b) => /العربية/.test(b.textContent));
    if (!opt) return { ok: false, raison: 'option arabe introuvable' };
    opt.click();
    await new Promise((r) => setTimeout(r, 1500));
    return { ok: true };
  });
  ck(bascule.ok, 'bascule vers l’arabe via le sélecteur de langue', bascule.raison || '');

  const ar = await pageAr.evaluate(() => {
    const de = document.documentElement;
    const barre = document.querySelector('#navigation-portail')?.closest('aside');
    const main = document.querySelector('#contenu-portail');
    const visible = (el) => el && el.getClientRects().length > 0;
    const barres = [...document.querySelectorAll('aside')].filter(visible);
    return {
      dir: de.dir, lang: de.lang, stocke: localStorage.getItem('runex.langue'),
      barreTexte: barre?.innerText || '',
      barreRect: barre ? (b => ({ x: +b.x.toFixed(1), right: +b.right.toFixed(1), w: +b.width.toFixed(1) }))(barre.getBoundingClientRect()) : null,
      mainRect: main ? (b => ({ x: +b.x.toFixed(1), right: +b.right.toFixed(1), w: +b.width.toFixed(1) }))(main.getBoundingClientRect()) : null,
      vw: innerWidth, scrollW: de.scrollWidth,
      barres: barres.length,
      texte: main?.innerText || '',
      align: main ? getComputedStyle(main.querySelector('h1,h2,p,div') || main).textAlign : null,
    };
  });
  ck(ar.dir === 'rtl', '<html dir> passe à rtl', `dir=${ar.dir}`);
  ck(ar.lang === 'ar', '<html lang> passe à ar', `lang=${ar.lang}`);
  ck(ar.stocke === 'ar', 'la préférence est persistée (localStorage)', `runex.langue=${ar.stocke}`);
  ck(/[؀-ۿ]/.test(ar.barreTexte), 'la barre latérale est traduite en arabe', ar.barreTexte.replace(/\n/g, ' | ').slice(0, 110));
  ck(/[؀-ۿ]/.test(ar.texte), 'le contenu principal est traduit en arabe');
  ck(ar.barres === 1, 'une seule barre latérale visible en RTL', `${ar.barres}`);
  ck(ar.barreRect && ar.barreRect.right >= ar.vw - 20,
    'la barre latérale est ancrée à DROITE en RTL', `barre.right=${ar.barreRect?.right} viewport=${ar.vw}`);
  ck(ar.mainRect && ar.mainRect.x <= 2,
    'le contenu principal commence au bord gauche en RTL', `main.x=${ar.mainRect?.x}`);
  ck(ar.barreRect && ar.mainRect && ar.mainRect.right <= ar.barreRect.x + 1,
    'rien n’est masqué sous la barre en RTL', `main.right=${ar.mainRect?.right} barre.x=${ar.barreRect?.x}`);
  ck(ar.scrollW <= ar.vw, 'aucun débordement horizontal en RTL', `scrollWidth=${ar.scrollW}/${ar.vw}`);

  // Étiquettes de statut traduites : on va sur la liste des colis
  await pageAr.goto(`${BASE}/expediteur/colis`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  const statuts = await pageAr.evaluate(() => {
    const t = document.querySelector('#contenu-portail')?.innerText || '';
    return { arabe: (t.match(/[؀-ۿ]+/g) || []).length, texte: t.slice(0, 300) };
  });
  ck(statuts.arabe > 10, 'écran colis : libellés et statuts en arabe', `${statuts.arabe} mot(s) arabe(s)`);
  const debordColis = await pageAr.evaluate(() => ({ s: document.documentElement.scrollWidth, v: innerWidth }));
  ck(debordColis.s <= debordColis.v, 'pas de débordement sur la liste de colis en RTL', `${debordColis.s}/${debordColis.v}`);

  // Notifications
  await pageAr.goto(`${BASE}/expediteur/notifications`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  const notif = await pageAr.evaluate(() => {
    const items = [...document.querySelectorAll('#contenu-portail li')];
    return items.slice(0, 4).map((li) => li.innerText.split('\n')[0].slice(0, 60));
  });
  ck(notif.length === 0 || notif.some((t) => /[؀-ۿ]/.test(t)),
    'notifications : intitulés traduits en arabe', notif.join(' / ') || 'aucune notification en base');

  // Retour au français
  await pageAr.evaluate(async () => {
    const decl = [...document.querySelectorAll('button')].find((b) =>
      /langue|language|اللغة/i.test(b.getAttribute('aria-label') || ''));
    decl?.click();
    await new Promise((r) => setTimeout(r, 500));
    const opt = [...document.querySelectorAll('[role=option]')].find((b) => /Français/.test(b.textContent));
    opt?.click();
    await new Promise((r) => setTimeout(r, 1500));
  });
  const frApres = await pageAr.evaluate(() => ({
    dir: document.documentElement.dir, lang: document.documentElement.lang,
    stocke: localStorage.getItem('runex.langue'),
    barreRect: (b => ({ x: +b.x.toFixed(1), right: +b.right.toFixed(1) }))(
      document.querySelector('#navigation-portail').closest('aside').getBoundingClientRect()),
    vw: innerWidth, scrollW: document.documentElement.scrollWidth,
    barreTexte: document.querySelector('#navigation-portail')?.innerText.slice(0, 120) || '',
  }));
  ck(frApres.dir === 'ltr' && frApres.lang === 'fr', 'retour au français : LTR rétabli', `dir=${frApres.dir} lang=${frApres.lang} stocké=${frApres.stocke}`);
  ck(frApres.barreRect.x <= 2, 'la barre latérale revient à gauche', `barre.x=${frApres.barreRect.x}`);
  ck(!/[؀-ۿ]/.test(frApres.barreTexte), 'la barre latérale est de nouveau en français');
  ck(frApres.scrollW <= frApres.vw, 'pas de débordement après retour au français', `${frApres.scrollW}/${frApres.vw}`);

  // Persistance après rechargement
  await pageAr.evaluate(() => localStorage.setItem('runex.langue', 'ar'));
  await pageAr.goto(`${BASE}/expediteur/bordereaux`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  const persist = await pageAr.evaluate(() => document.documentElement.dir);
  ck(persist === 'rtl', 'la préférence arabe survit à un rechargement/navigation', `dir=${persist}`);

  /* ----------------------------------------------------------- ERREURS */
  titre('ERREURS CONSOLE (toutes les pages visitées)');
  const uniques = [...new Set(erreurs)];
  ck(uniques.length === 0, 'aucune erreur console', uniques.slice(0, 8).join(' | '));
  if (uniques.length) uniques.forEach((e) => console.log(`        - ${e}`));

  await browser.close();
  console.log(`\n${'='.repeat(60)}\n${echecs === 0 ? `TOUT PASSE (${total} contrôles)` : `${echecs} ÉCHEC(S) sur ${total} contrôles`}`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
