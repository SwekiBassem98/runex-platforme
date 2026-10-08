#!/usr/bin/env node
/**
 * QA — écrans inter-dépôts et ramassages, pilotés au navigateur.
 *
 *  - « Ajouter un inter dépôt » : en-tête (agence, livreur → matricule auto),
 *    candidats, scan accepté / refusé (mauvaise destination), Retirer ;
 *  - « Acceptation inter dépôt » : pièce par pièce, compteurs reçus / partiels ;
 *  - listes livraison et retours avec leurs compteurs ;
 *  - « Organiser un ramassage », Effectuer, Annuler.
 *
 *   QA_WEB_URL=http://localhost:3000 PUPPETEER_CORE=… node qa/qa-interdepot-ui-26.mjs
 * (web servi avec NEXT_PUBLIC_API_URL=/api/v1 et API_PROXY_TARGET ; base fraîchement seedée)
 */
const WEB = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const API = `${WEB}/api/v1`;
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const puppeteer = (await import(process.env.PUPPETEER_CORE ?? 'puppeteer-core')).default;

let pass = 0;
const failures = [];
const ok = (c, l, d = '') => {
  if (c) { pass++; console.log(`  ✔ ${l}`); } else { failures.push(l); console.log(`  ✘ ${l}${d ? ` — ${d}` : ''}`); }
  return c;
};
async function api(token, method, path, body) {
  const h = { Accept: 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${API}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* vide */ }
  return { status: r.status, data: j?.data, json: j };
}
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { email: e, password: p })).data.accessToken;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const deposits = (await api(admin, 'GET', '/inter-depots/form-options')).data.deposits;
const HUB = deposits.find((d) => d.isMainHub);
const SFAX = deposits.find((d) => /sfax/i.test(d.name));

let n = 0;
async function colisRecu(gov, pieces = 1) {
  n++;
  const c = (await api(exp, 'POST', '/colis', { customerName: `UI ID ${n}`, customerPhone: `9766${1000 + n}`, address: `Rue UI ${n}`, governorate: gov, delegation: gov, totalPrice: 15, pieceCount: pieces })).data;
  await api(admin, 'POST', '/warehouse/scan-accept', { barcode: c.trackingNumber, depositId: HUB.id });
  return c;
}
const P2 = await colisRecu('Sfax', 2);
const P1 = await colisRecu('Sfax', 1);
const PSO = await colisRecu('Sousse', 1);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
async function session(email, password) {
  // Contexte isolé : chaque compte a son propre stockage (jetons).
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  page.on('pageerror', (e) => errors.push(`${email}: ${String(e)}`));
  page.on('response', (r) => { if (r.url().includes('/api/v1/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${WEB}/connexion`, { waitUntil: 'networkidle2' });
  await page.type('input[type=email]', email);
  await page.type('input[type=password]', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type=submit]')]);
  return page;
}
const click = (page, re) => page.evaluate((src) => {
  const el = [...document.querySelectorAll('button, a')].find((x) => new RegExp(src, 'i').test((x.textContent || '').trim()) && x.getClientRects().length > 0 && !x.disabled);
  el?.click();
  return !!el;
}, re.source);
const selectByText = (page, placeholder, re) => page.evaluate((ph, src) => {
  const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.text.trim() === ph));
  if (!sel) return 'select absent';
  const opt = [...sel.options].find((o) => new RegExp(src, 'i').test(o.text) && o.value);
  if (!opt) return 'option absente';
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  set.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
}, placeholder, re.source);
const text = (page) => page.evaluate(() => document.body.innerText);
async function scanField(page, id, value) {
  const input = await page.$(`#${id}`);
  await input.click({ clickCount: 3 });
  await input.type(value);
  await page.keyboard.press('Enter');
  await pause(1200);
}

console.log('=== Agent du hub : nouveau bordereau ===');
const agent = await session('agent.magasin@logixpress.tn', 'Agent123!');
await agent.goto(`${WEB}/inter-depots`, { waitUntil: 'networkidle2' });
await pause(800);
const liste = await text(agent);
ok(/Liste des inter dépôts/.test(liste) && /envoyés en attentes/.test(liste) && /pour réception/.test(liste), 'liste avec ses 4 compteurs');
ok(await click(agent, /Ajouter un inter dépôt/), 'bouton « Ajouter un inter dépôt »');
await agent.waitForFunction(() => location.pathname.endsWith('/nouveau'), { timeout: 8000 }).catch(() => {});
await pause(1200);
ok((await selectByText(agent, 'Choisissez agence', /Sfax/)) === 'ok', 'agence Sfax choisie');
const drv = await agent.evaluate(() => {
  const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.text.trim() === 'Choisissez livreur'));
  return [...sel.options].filter((o) => o.value).map((o) => o.text);
});
ok(drv.length > 0 && drv.every((l) => / - /.test(l)), 'livreurs affichés « Nom - Agence »', drv[0]);
await selectByText(agent, 'Choisissez livreur', /Hamza/);
await pause(300);
const plate = await agent.$eval('input[placeholder="Matricule"]', (i) => i.value);
ok(/TUN/.test(plate), 'matricule rempli automatiquement', plate);
ok(await click(agent, /^Enregistrer$/), 'Enregistrer');
await agent.waitForFunction(() => /\/inter-depots\/ID-D-/.test(location.pathname), { timeout: 10000 }).catch(() => {});
await pause(1500);
const numero = decodeURIComponent((await agent.evaluate(() => location.pathname)).split('/').pop());
ok(/^ID-D-/.test(numero), `bordereau créé ${numero}`);
let t = await text(agent);
ok(/Inter dépôt vers l.agence\s+Agence Sfax/.test(t), 'titre « Inter dépôt vers l’agence Agence Sfax »');
ok(t.includes(P2.barcode) && t.includes(P1.barcode) && !t.includes(PSO.barcode), 'panneau gauche : colis pour Sfax uniquement');

console.log('\n=== Scan de chargement ===');
await scanField(agent, 'code-barre-id', PSO.barcode);
t = await agent.$eval('[role=alert]', (e) => e.textContent).catch(() => '');
ok(/destiné à l'agence Agence Sousse/.test(t), 'colis pour Sousse refusé avec motif', t);
await scanField(agent, 'code-barre-id', P2.barcode);
t = await agent.$eval('[role=status]', (e) => e.textContent).catch(() => '');
ok(/ajouté \(2 pièce/.test(t), 'colis 2 pièces ajouté', t);
ok(await agent.evaluate((b) => { const btn = [...document.querySelectorAll('button[aria-label]')].find((x) => x.getAttribute('aria-label')?.includes('Ajouter') && x.closest('tr')?.textContent.includes(b)); btn?.click(); return !!btn; }, P1.barcode), 'ajout du 2e colis depuis le panneau');
await pause(1400);
t = await text(agent);
ok(/2 commande\(s\) · 3 pièce\(s\)/.test(t), 'bordereau : 2 commandes / 3 pièces');
await agent.click('button[role=switch]');
await pause(300);
ok(await agent.evaluate(() => [...document.querySelectorAll('button[type=submit]')].some((b) => /Retirer de l’inter dépôt/.test(b.textContent))), 'interrupteur sur « Retirer »');
await scanField(agent, 'code-barre-id', P1.barcode);
t = await text(agent);
ok(/retiré du bordereau/.test(t) && /1 commande\(s\) · 2 pièce\(s\)/.test(t), 'colis retiré');
await agent.click('button[role=switch]');
await pause(300);
await scanField(agent, 'code-barre-id', P1.barcode);
t = await text(agent);
ok(/2 commande\(s\) · 3 pièce\(s\)/.test(t), 'colis rajouté');
ok(await agent.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Imprimer le bordereau/.test(b.textContent))), 'bordereau imprimable');

console.log('\n=== Acceptation à Sfax (exploitation) ===');
const ops = await session('admin@logixpress.tn', 'Admin123!');
await ops.goto(`${WEB}/inter-depots/acceptation?type=LIVRAISON`, { waitUntil: 'networkidle2' });
await pause(1000);
await ops.evaluate((id) => {
  const sel = document.querySelector('select[aria-label="Dépôt qui réceptionne"]');
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  set.call(sel, id);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}, SFAX.id);
await pause(1500);
t = await text(ops);
ok(/\d+\s*colis/.test(t) && t.includes(P2.barcode) && t.includes(P1.barcode), 'colis attendus listés');
await scanField(ops, 'code-barre-acceptation', P2.barcode);
t = await ops.$eval('[role=alert]', (e) => e.textContent).catch(() => '');
ok(/scannez l'étiquette de chaque pièce/.test(t), 'colis multi-pièces : étiquette de pièce exigée', t);
await scanField(ops, 'code-barre-acceptation', `${P2.barcode}-1`);
ok((await ops.$eval('[data-testid=compteur-partiels]', (e) => e.textContent)) === '1', 'compteur « partiellement reçus » = 1');
await scanField(ops, 'code-barre-acceptation', `${P2.barcode}-2`);
await scanField(ops, 'code-barre-acceptation', P1.barcode);
ok((await ops.$eval('[data-testid=compteur-recus]', (e) => e.textContent)) === '2', 'compteur « reçus » = 2');
ok((await ops.$eval('[data-testid=compteur-partiels]', (e) => e.textContent)) === '0', 'plus aucun partiel');
const detail = (await api(admin, 'GET', `/inter-depots/${numero}`)).data;
ok(detail.status === 'RECU', 'bordereau « Reçu » en base');

console.log('\n=== Listes ===');
await agent.goto(`${WEB}/inter-depots`, { waitUntil: 'networkidle2' });
await pause(1200);
t = await text(agent);
ok(t.includes(numero) && /Reçu/.test(t) && /Envoi/.test(t), 'bordereau listé « Reçu », type Envoi');
await agent.goto(`${WEB}/inter-depots/retours`, { waitUntil: 'networkidle2' });
await pause(1000);
t = await text(agent);
ok(/Liste des inter dépôts retours/.test(t) && /Ajouter un inter dépôt retours/.test(t) && /Acceptation inter dépôt retours/.test(t), 'écran retours et ses actions');
await click(agent, /Ajouter un inter dépôt retours/);
await pause(2000);
t = await text(agent);
ok(/Agence source/.test(t) && /colis retour dans votre dépôt/i.test(t), 'formulaire retours : « Agence source »');

console.log('\n=== Organiser un ramassage ===');
await ops.goto(`${WEB}/ramassages`, { waitUntil: 'networkidle2' });
await pause(1000);
t = await text(ops);
ok(/Ramassages : En attente/.test(t) && /Ramassages : Effectué/.test(t) && /Ramassages : Annulé/.test(t), 'compteurs des ramassages');
ok(await click(ops, /Organiser un ramassage/), 'bouton « Organiser un ramassage »');
await pause(1500);
ok((await selectByText(ops, 'Choisissez expéditeur', /BlueStar/)) === 'ok', 'expéditeur choisi');
await pause(300);
const adresse = await ops.evaluate(() => document.querySelector('[role=dialog] textarea')?.value ?? '');
ok(adresse.length > 3, 'adresse reprise de l’expéditeur', adresse);
ok((await selectByText(ops, 'Choisissez livreur', /Hamza/)) === 'ok', 'livreur choisi');
await click(ops, /^Enregistrer$/);
await pause(1800);
t = await text(ops);
ok(/déjà demandé pour ce créneau/.test(t), 'créneau déjà pris chez BlueStar (14h–15h) : refus expliqué');
ok((await selectByText(ops, 'Choisissez expéditeur', /Benhcine/)) === 'ok', 'autre expéditeur choisi');
await click(ops, /^Enregistrer$/);
await pause(1800);
t = await text(ops);
ok(/Benhcine/.test(t) && /En attente/.test(t), 'ramassage listé « En attente »');
ok(await click(ops, /Effectuer/), 'bouton « Effectuer »');
await pause(1500);
const pick = (await api(admin, 'GET', '/ramassages')).data.find((p) => p.assignedDriverName && /Hamza/.test(p.assignedDriverName) && p.status === 'EFFECTUE');
ok(!!pick, 'ramassage effectué en base');

ok(errors.length === 0, 'aucune exception de page ni 5xx', errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\nRESULT: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(` - ${f}`); process.exit(1); }
