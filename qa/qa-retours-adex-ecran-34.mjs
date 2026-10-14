/**
 * QA 34 (écrans) — retours expéditeur comme ADEX, et caisse lisible.
 *
 * Données préparées par l'API (colis retournés après 3 reports, colis livrés),
 * puis parcours à l'écran : ajouter un bon → choisir l'expéditeur →
 * enregistrer → choisir le livreur (matricule repris) → ajouter un colis par
 * « + » et un autre au scan → retirer au scan → lancer la livraison → marquer
 * remis ; liste avec filtres et état. Caisse : « À faire », bilan, livreurs,
 * détail d'un livreur, paiement.
 *
 *   PUPPETEER_CORE=…/puppeteer-core.js CHROME=…/chrome SHOTS=/tmp/shots node qa/qa-retours-adex-ecran-34.mjs
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

// --- Données
const admin = await loginApi('admin@logixpress.tn', 'Admin123!');
const exp = await loginApi('expediteur@bluestar.tn', 'Exp123!');
const liv = await loginApi('livreur.hamza@logixpress.tn', 'Liv123!');
const did = (await ja(liv, 'GET', '/auth/me')).d.driverId;
const sfx = Date.now().toString(36).slice(-4);
const mk = async (i) => (await ja(exp, 'POST', '/colis', { customerName: `Retour ${sfx} ${i}`, customerPhone: `9788${String(1000 + i)}`, governorate: 'Nabeul', delegation: 'Hammamet', address: `Avenue ${i}`, goodsPrice: 20 + i, pieceCount: 1, contentSummary: `Article ${i}` })).d;
const retours = [];
for (let i = 1; i <= 3; i++) {
  const c = await mk(i);
  await ja(admin, 'POST', `/colis/${c.id}/assign`, { driverId: did });
  for (let k = 0; k < 3; k++) { await ja(liv, 'POST', `/colis/${c.id}/start`, {}); await ja(liv, 'POST', `/colis/${c.id}/postpone`, { reason: 'Client injoignable' }); }
  retours.push(c);
}
const livre = await mk(9); await ja(admin, 'POST', `/colis/${livre.id}/assign`, { driverId: did }); await ja(liv, 'POST', `/colis/${livre.id}/deliver`, {});
const shipperId = retours[0].shipperId;

const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 1100 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const txt = () => p.evaluate(() => document.body.innerText);
const attendre = async (re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await txt())) return true; await sleep(200); } return false; };
const cliquerTexte = (sel, t) => p.evaluate((sel, t) => { const e = [...document.querySelectorAll(sel)].find((x) => x.innerText.trim().includes(t)); if (e) { e.click(); return true; } return false; }, sel, t);

await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);

console.log('1. Liste des bons de retour');
await p.goto(W + '/retours-expediteur', { waitUntil: 'networkidle2' }); await sleep(1200);
let t = await txt();
ok(/Liste des bons de retour/.test(t) && /Ajouter un bon de retour/.test(t), 'liste + bouton « Ajouter un bon de retour »');
ok(/colis retourné.*attend/.test(t) && t.includes('BlueStar'), 'bandeau : colis retournés en attente, par expéditeur');
await p.screenshot({ path: `${SHOTS}/34-liste.png`, fullPage: true });

console.log('2. Ajouter un bon : expéditeur');
await p.click('[data-testid=ajouter-bon]'); await p.waitForSelector('[data-testid=liste-expediteurs]');
await p.type('#recherche-expediteur', 'Blue'); await sleep(300);
await cliquerTexte('[data-testid=liste-expediteurs] button', 'BlueStar');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.click('[data-testid=enregistrer-expediteur]')]);
ok(await attendre(/Bon de retour N° BR-/), 'bon créé, fiche ouverte');
t = await txt();
ok(/Colis au dépôt/.test(t) && retours.every((c) => t.includes(c.trackingNumber)), 'la fiche liste les colis au dépôt de l’expéditeur');
ok(/Produits d'échange au dépôt/.test(t), 'section produits d’échange');
const idBon = p.url().split('/').pop();

console.log('3. Livreur et véhicule');
await p.select('[data-testid=choix-livreur]', did); await sleep(200);
const plaque = await p.$eval('[data-testid=entete-livreur] input', (e) => e.value);
ok(plaque.length > 0, 'matricule repris du livreur', plaque);
await p.click('[data-testid=enregistrer-livreur]'); await sleep(1200);
ok((await ja(admin, 'GET', `/retours-expediteur/bons/${idBon}`)).d?.driverId === did, 'livreur enregistré');

console.log('4. Ajouter / retirer des colis');
await p.evaluate(() => document.querySelector('[data-testid=colis-au-depot] li button')?.click()); await sleep(1200);
await p.type('[data-testid=code-barre]', retours[1].barcode); await p.keyboard.press('Enter');
ok(await attendre(/ajouté au bon/), 'scan : colis ajouté (message)');
await sleep(500);
t = await txt();
ok(/2\s*colis · \d+\s*pièces?/.test(t.replace(/\n/g, ' ')), 'totaux du bon : 2 colis');
await p.type('[data-testid=code-barre]', livre.barcode); await p.keyboard.press('Enter');
ok(await attendre(/seul un colis retourné au dépôt/), 'colis livré refusé avec motif clair');
await p.click('[data-testid=mode-retirer]');
await p.type('[data-testid=code-barre]', retours[1].trackingNumber); await p.keyboard.press('Enter');
ok(await attendre(/retiré du bon/), 'mode retirer : colis retiré');
await p.click('[data-testid=mode-ajouter]');
await p.type('[data-testid=code-barre]', retours[2].trackingNumber); await p.keyboard.press('Enter');
await attendre(/ajouté au bon/);
await sleep(600);
await p.screenshot({ path: `${SHOTS}/34-fiche.png`, fullPage: true });

console.log('5. Lancer la livraison, puis remis');
await p.click('[data-testid=lancer-livraison]'); await sleep(400);
await p.click('[data-testid=confirmer-etat]');
ok(await attendre(/En route avec/), 'bon en cours de livraison');
ok((await ja(admin, 'GET', `/colis/${retours[2].id}`)).d?.status === 'EN_RUNSHEET_RETOUR', 'colis en cours de restitution');
await p.click('[data-testid=marquer-remis]'); await sleep(400);
await p.type('.fixed input', 'Karim');
await p.click('[data-testid=confirmer-etat]');
ok(await attendre(/Remis le/), 'bon remis à l’expéditeur');
ok((await ja(admin, 'GET', `/colis/${retours[2].id}`)).d?.status === 'RETOURNE_EXPEDITEUR', 'colis restitué');
await p.screenshot({ path: `${SHOTS}/34-fiche-remis.png`, fullPage: true });

console.log('6. Liste : filtres et état');
await p.goto(W + '/retours-expediteur', { waitUntil: 'networkidle2' }); await sleep(1200);
await p.select('[data-testid=filtres-bons] select[aria-label="État"]', 'REMIS'); await sleep(1200);
t = await txt();
const bon = (await ja(admin, 'GET', `/retours-expediteur/bons/${idBon}`)).d;
ok(t.includes(bon.slipNumber) && !/En préparation ▾/.test(t), 'filtre état « Remis »');
await p.select('[data-testid=filtres-bons] select[aria-label="État"]', ''); await sleep(1000);
// Bon vide créé depuis le bandeau, puis annulé depuis la liste.
const vide = await ja(admin, 'POST', '/retours-expediteur/bons', { shipperId });
await p.reload({ waitUntil: 'networkidle2' }); await sleep(1200);
await p.select(`select[aria-label="Changer l'état du bon ${vide.d.slipNumber}"]`, 'ANNULE'); await sleep(300);
await p.click('[data-testid=confirmer-etat]'); await sleep(1500);
ok((await ja(admin, 'GET', `/retours-expediteur/bons/${vide.d.id}`)).d?.status === 'ANNULE', 'état changé depuis la liste (annulé)');

console.log('7. Caisse lisible');
await p.goto(W + '/caisse', { waitUntil: 'networkidle2' }); await sleep(1500);
t = await txt();
ok(/À faire maintenant/.test(t) && /Espèces à valider/.test(t) && /À reverser aux expéditeurs/.test(t) && /À payer aux livreurs/.test(t), 'section « À faire maintenant » (3 actions)');
ok(/Encaissé pour les colis livrés/.test(t) && /Part des expéditeurs/.test(t) && /Frais de livraison gagnés/.test(t) && /Bénéfice net/.test(t), 'bilan lisible de haut en bas');
ok(/Où va l'argent encaissé/.test(t), 'répartition visuelle');
await cliquerTexte('[role=radio]', 'Depuis le début'); await sleep(1200);
await p.screenshot({ path: `${SHOTS}/34-caisse.png`, fullPage: true });
await p.waitForSelector('[data-testid^=caisse-livreur-] button');
await p.click('[data-testid^=caisse-livreur-] button');
ok((await attendre(/Gagné depuis le début[\s\S]*Déjà payé/)) && /derniers paiements/i.test(await txt()), 'détail d’un livreur (gagné, payé, historique)');
const payer = await p.$('[data-testid=caisse-payer]');
if (payer) {
  await payer.click(); await sleep(400);
  await p.click('[data-testid=caisse-confirmer-paiement]');
  ok(await attendre(/Paiement enregistré/), 'paiement d’un livreur');
} else ok(false, 'bouton Payer');
ok(!errs.length, 'aucune erreur JavaScript', errs.join(' | '));
console.log(`\n${pass} réussis, ${fail} échoués`);
await b.close();
process.exit(fail ? 1 : 0);
