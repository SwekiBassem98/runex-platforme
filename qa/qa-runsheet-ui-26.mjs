#!/usr/bin/env node
/**
 * QA 26 — cycle de vie d'une tournée piloté depuis l'interface web.
 *
 * Le colis est préparé par l'API (expéditeur → réception dépôt), la tournée
 * est créée par l'API, puis chaque étape du bandeau « Workflow » est cliquée
 * dans le navigateur : départ → (livraison faite par le livreur via l'API, comme
 * l'application mobile) → déclaration de caisse → validation caisse.
 *
 *   QA_WEB_URL=http://localhost:3000 node qa/qa-runsheet-ui-26.mjs
 *
 * Prérequis : web servi avec le relais /api/v1 (API_PROXY_TARGET) et
 * puppeteer-core résolvable (PUPPETEER_CORE=/chemin/vers/puppeteer-core).
 * CHROME = binaire Chromium (défaut : Chromium Playwright).
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

const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const liv = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const hub = (await api(admin, 'GET', '/depots')).data.find((d) => d.isMainHub);
const hamza = (await api(admin, 'GET', '/drivers?limit=50')).data.find((d) => d.driverCode === 'LIV-BEN-001');

const pkg = (await api(exp, 'POST', '/colis', {
  customerName: 'Client UI 26', customerPhone: '98765400', address: 'Rue de la tournée', governorate: 'Ben Arous', city: 'Ben Arous', totalPrice: 42.5,
})).data;
await api(admin, 'POST', '/warehouse/scan-accept', { barcode: pkg.trackingNumber, depositId: hub.id });
const rs = await api(admin, 'POST', '/runsheets', { driverId: hamza.id, depositId: hub.id, tourDate: new Date().toISOString().slice(0, 10), packageIds: [pkg.id] });
ok(rs.status === 201, 'tournée créée avec 1 colis', `HTTP ${rs.status} ${JSON.stringify(rs.json)?.slice(0, 160)}`);
const NUM = rs.data.runsheetNumber;
const statut = async () => (await api(admin, 'GET', `/runsheets/${NUM}`)).data?.status;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', async (r) => { if (r.url().includes('/api/v1/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); if (process.env.QA_DEBUG && r.url().includes('/runsheets/') && r.request().method() !== 'GET') console.log('    [net]', r.request().method(), r.url().replace(WEB, ''), r.status(), (await r.text().catch(() => '')).slice(0, 200)); });

const clickText = async (re) => page.evaluate((src) => {
  const rx = new RegExp(src, 'i');
  const b = [...document.querySelectorAll('button')].find((x) => rx.test(x.textContent || '') && x.getClientRects().length > 0 && !x.disabled);
  if (b) b.click();
  return !!b;
}, re.source);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await pause(250); } return false; };

await page.goto(`${WEB}/connexion`, { waitUntil: 'networkidle2' });
await page.type('input[type=email]', 'admin@logixpress.tn');
await page.type('input[type=password]', 'Admin123!');
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type=submit]')]);
await page.goto(`${WEB}/runsheets`, { waitUntil: 'networkidle2' });
await pause(1000);

const opened = await page.evaluate((num) => {
  const cell = [...document.querySelectorAll('tr, [role=row], div')].find((el) => el.children.length && (el.textContent || '').includes(num) && el.tagName === 'TR');
  if (!cell) return false;
  cell.click();
  return true;
}, NUM);
ok(opened, `ligne ${NUM} trouvée dans la liste`);
await pause(1200);
ok(await page.evaluate((num) => document.body.innerText.includes(num) && /Workflow/i.test(document.body.innerText), NUM), 'détail de la tournée ouvert');

console.log('\n=== Départ ===');
ok(await clickText(/Valider le départ/), 'bouton « Valider le départ » présent');
await pause(400);
ok(await clickText(/Confirmer l.étape/), 'confirmation de l’étape');
ok(await waitFor(async () => (await statut()) === 'EN_COURS'), 'tournée EN_COURS après clic', await statut());
ok((await api(admin, 'GET', `/colis/${pkg.id}`)).data.status === 'EN_COURS_LIVRAISON', 'colis parti en livraison');

console.log('\n=== Livraison (application mobile) ===');
const d = await api(liv, 'POST', `/colis/${pkg.id}/deliver`, { collectedAmount: 42.5 });
ok(d.status === 200, 'livreur livre le colis', `HTTP ${d.status} ${JSON.stringify(d.json)?.slice(0, 160)}`);

console.log('\n=== Retour chauffeur : caisse ===');
await page.reload({ waitUntil: 'networkidle2' });
await pause(800);
if (!(await page.evaluate(() => /Workflow/i.test(document.body.innerText)))) {
  await page.evaluate((num) => { const tr = [...document.querySelectorAll('tr')].find((el) => (el.textContent || '').includes(num)); tr?.click(); }, NUM);
  await pause(1200);
}
ok(await clickText(/déclarer la caisse/), 'bouton « déclarer la caisse » présent');
await pause(500);
const typed = await page.evaluate(() => {
  const input = [...document.querySelectorAll('input[type=number]')].find((i) => i.getClientRects().length > 0);
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '42.5');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
});
ok(typed, 'montant remis saisi');
ok(await clickText(/Confirmer Caisse/), 'clôture de caisse confirmée');
ok(await waitFor(async () => (await statut()) === 'RETOUR_DEPOT'), 'tournée RETOUR_DEPOT', await statut());

console.log('\n=== Validation caisse ===');
await pause(800);
ok(await clickText(/Valider la caisse/), 'bouton « Valider la caisse » présent');
await pause(400);
await clickText(/^\s*Confirmer|Valider$/);
ok(await waitFor(async () => ['CLOTUREE_CONFORME', 'CLOTUREE_DEFICIT'].includes(await statut())), 'tournée clôturée', await statut());
ok((await statut()) === 'CLOTUREE_CONFORME', 'caisse conforme (42,500 remis pour 42,500 encaissés)', await statut());
await pause(800);
ok(await page.evaluate(() => /clôturée/i.test(document.body.innerText)), 'badge de clôture affiché');

ok(errors.length === 0, 'aucune exception de page ni réponse 5xx', errors.slice(0, 3).join(' | '));
await browser.close();

console.log(`\nRESULT: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(` - ${f}`); process.exit(1); }
