/**
 * QA 35 (écrans) — tournée : ajouter/retirer un colis au scan (comme le bon
 * de retour) ; menu : ouverture instantanée avec écran d'ouverture ;
 * création de colis : agence de départ et trajet imprimé sur le bon.
 *
 *   PUPPETEER_CORE=…/puppeteer-core.js CHROME=…/chrome SHOTS=/tmp/shots node qa/qa-tournee-nav-bon-35.mjs
 * Web sur :3000 (build de production), API sur :4000, base de démonstration.
 */
const API = process.env.QA_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const W = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? '/tmp';
const ja = async (t, m, p, b) => {
  const r = await fetch(API + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let x = null; try { x = await r.json(); } catch { /* vide */ }
  return { s: r.status, d: x?.data, m: x?.message };
};
const loginApi = async (id, pw) => (await ja(null, 'POST', '/auth/login', { identifier: id, password: pw })).d.accessToken;
let pass = 0, fail = 0;
const ok = (c, l, d = '') => { if (c) { pass++; console.log('  ✔', l); } else { fail++; console.log('  ✘', l, d); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = await loginApi('admin@logixpress.tn', 'Admin123!');
const exp = await loginApi('expediteur@bluestar.tn', 'Exp123!');
const liv = await loginApi('livreur.hamza@logixpress.tn', 'Liv123!');
const did = (await ja(liv, 'GET', '/auth/me')).d.driverId;
const sfx = Date.now().toString(36).slice(-4);
const mk = async (i) => (await ja(exp, 'POST', '/colis', { customerName: `Tournée ${sfx} ${i}`, customerPhone: `9799${String(1000 + i)}`, governorate: 'Ben Arous', delegation: 'Rades', address: `Rue ${i}`, goodsPrice: 15, pieceCount: 1 })).d;
const A = await mk(1);
await ja(admin, 'POST', `/colis/${A.id}/assign`, { driverId: did });
const rs = (await ja(liv, 'GET', '/runsheets/driver/active')).d;
const B = await mk(2);

const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 1000 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const txt = () => p.evaluate(() => document.body.innerText);
const attendre = async (re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await txt())) return true; await sleep(150); } return false; };
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);

console.log('1. Menu : ouverture instantanée');
await sleep(2500); // préchargement des routes du menu
const cliquerMenu = (libelle) => p.evaluate((l) => { const e = [...document.querySelectorAll('nav button, aside button, nav a, aside a')].find((x) => x.innerText.trim() === l); if (e) { e.click(); return true; } return false; }, libelle);
for (const [libelle, chemin, re] of [
  ['Runsheets Livreurs', '/runsheets', /Tournée|Runsheet/i],
  ['Caisse société & livreurs', '/caisse', /À faire maintenant/],
  ['Retours expéditeur', '/retours-expediteur', /Liste des bons de retour/],
  ['Gestion des Colis', '/colis', /Colis/],
]) {
  const t0 = Date.now();
  ok(await cliquerMenu(libelle), `menu « ${libelle} » cliqué`);
  // Réaction immédiate : l'écran d'ouverture ou la page elle-même.
  let reaction = 0;
  while (Date.now() - t0 < 3000) {
    const vu = await p.evaluate(() => !!document.querySelector('[data-testid=page-en-chargement]') || location.pathname !== '/dashboard');
    if (vu) { reaction = Date.now() - t0; break; }
    await sleep(20);
  }
  ok(reaction > 0 && reaction < 600, `réaction au clic < 600 ms (${reaction} ms)`);
  ok(await attendre(re, 10000) && (await p.evaluate(() => location.pathname)) === chemin, `page ${chemin} ouverte (${Date.now() - t0} ms)`);
  await p.goto(W + '/dashboard', { waitUntil: 'networkidle2' }); await sleep(800);
}

console.log('2. Tournée : ajouter / retirer au scan');
await p.goto(W + '/runsheets', { waitUntil: 'networkidle2' }); await sleep(1500);
await p.evaluate((n) => { const e = [...document.querySelectorAll('td, button, a, span')].find((x) => x.innerText.trim() === n); e?.click(); }, rs.runsheetNumber);
ok(await attendre(/Ajouter des colis à la tournée/), 'carte de scan dans la fiche de tournée');
await p.type('[data-testid=tournee-scan-code]', B.barcode); await p.keyboard.press('Enter');
ok(await attendre(/ajouté à la tournée/), 'scan : colis ajouté');
await p.screenshot({ path: `${SHOTS}/35-tournee.png`, fullPage: true });
await p.click('[data-testid=tournee-scan-mode-retirer]');
ok(await attendre(/Retirer des colis de la tournée/), 'bascule « Retirer »');
await p.type('[data-testid=tournee-scan-code]', 'CODE-INCONNU'); await p.keyboard.press('Enter');
ok(await attendre(/ne figure pas dans la tournée/), 'code absent : motif affiché');
await p.type('[data-testid=tournee-scan-code]', B.trackingNumber); await p.keyboard.press('Enter');
ok(await attendre(/retiré de la tournée/), 'scan : colis retiré (le code refusé est remplacé)');
const statutB = (await ja(admin, 'GET', `/colis/${B.id}`)).d?.status;
ok(['RECU_DEPOT', 'CREE'].includes(statutB) && !(await ja(admin, 'GET', `/colis/${B.id}`)).d?.assignedDriverId, 'colis retiré : plus dans la tournée', statutB);
await p.screenshot({ path: `${SHOTS}/35-tournee-retrait.png` });
// Retrait direct depuis la ligne (×), sans fenêtre de confirmation.
await p.evaluate((n) => document.querySelector(`button[aria-label="Retirer le colis ${n} de la tournée"]`)?.click(), A.trackingNumber);
await sleep(1500);
ok(!(await ja(liv, 'GET', '/runsheets/driver/active')).d?.packages?.some((x) => x.id === A.id), 'retrait direct depuis la ligne (×)');

console.log('3. Création de colis : agence de départ et trajet');
await p.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
const ctx = await b.createBrowserContext(); const e = await ctx.newPage(); await e.setViewport({ width: 1280, height: 1000 });
await e.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
await e.type('input[type=email]', 'expediteur@bluestar.tn'); await e.type('input[type=password]', 'Exp123!');
await Promise.all([e.waitForNavigation({ waitUntil: 'networkidle2' }), e.keyboard.press('Enter')]);
await e.goto(W + '/expediteur/colis/nouveau', { waitUntil: 'networkidle2' }); await sleep(1500);
const gouv = await e.$('select');
if (gouv) await e.evaluate(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'Sfax')); if (s) { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'Sfax'); s.dispatchEvent(new Event('change', { bubbles: true })); } });
await sleep(1200);
const depart = await e.$eval('[data-testid=agence-depart]', (x) => x.options[x.selectedIndex]?.text ?? '').catch(() => '');
ok(depart.length > 1, 'agence de départ pré-remplie', depart);
await e.select('[data-testid=agence-depart]', await e.$eval('[data-testid=agence-depart]', (x) => [...x.options].find((o) => o.text.startsWith('Agence Nabeul'))?.value ?? ''));
await sleep(400);
const trajet = await e.$eval('[data-testid=trajet-bon]', (x) => x.innerText).catch(() => '');
ok(/Agence Nabeul => Agence Sfax => Sfax/.test(trajet), 'trajet du bon affiché', trajet);
await e.screenshot({ path: `${SHOTS}/35-creation.png`, fullPage: true });
ok(!errs.length, 'aucune erreur JavaScript', errs.join(' | '));
console.log(`\n${pass} réussis, ${fail} échoués`);
await b.close();
process.exit(fail ? 1 : 0);
