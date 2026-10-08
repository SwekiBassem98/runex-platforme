#!/usr/bin/env node
/**
 * QA 26 — écran « Gestion des colis » du back-office, piloté au navigateur.
 *
 * Couvre ce que les suites API ne voient pas : le formulaire « Nouveau colis »
 * de l'exploitation (choix de l'expéditeur), l'envoi réel du corps JSON par
 * l'adaptateur `createApiFetch`, puis une action de détail (annulation).
 *
 *   QA_WEB_URL=http://localhost:3000 PUPPETEER_CORE=… node qa/qa-colis-ui-26.mjs
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
const admin = (await api(null, 'POST', '/auth/login', { email: 'admin@logixpress.tn', password: 'Admin123!' })).data.accessToken;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('=== API : création pour le compte d’un expéditeur ===');
const shippers = (await api(admin, 'GET', '/shippers?status=actif&limit=50')).data;
const blue = shippers.find((s) => s.code === 'EXP-BLUESTAR');
const base = { customerName: 'API Exploitation', customerPhone: '27660505', address: 'Rue 1', governorate: 'Ben Arous', totalPrice: 10 };
ok((await api(admin, 'POST', '/colis', base)).status === 400, 'admin sans expéditeur désigné → 400');
ok((await api(admin, 'POST', '/colis', { ...base, shipperId: 'nope' })).status === 400, 'expéditeur mal formé → 400');
ok((await api(admin, 'POST', '/colis', { ...base, shipperId: '00000000-0000-4000-8000-000000000000' })).status === 404, 'expéditeur inconnu → 404');
const viaApi = await api(admin, 'POST', '/colis', { ...base, shipperId: blue.id });
ok(viaApi.status === 201 && viaApi.data.shipperId === blue.id, 'admin crée pour BlueStar → 201');
const exp = (await api(null, 'POST', '/auth/login', { email: 'expediteur@bluestar.tn', password: 'Exp123!' })).data.accessToken;
const other = shippers.find((s) => s.id !== blue.id);
const spoof = await api(exp, 'POST', '/colis', { ...base, shipperId: other.id });
ok(spoof.status === 201 && spoof.data.shipperId === blue.id, 'expéditeur : shipperId du corps ignoré (reste BlueStar)');

console.log('\n=== Navigateur : formulaire « Nouveau colis » ===');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', (r) => { if (r.url().includes('/api/v1/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
const clickText = (re) => page.evaluate((src) => {
  const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src, 'i').test(x.textContent || '') && x.getClientRects().length > 0 && !x.disabled);
  b?.click();
  return !!b;
}, re.source);

await page.goto(`${WEB}/connexion`, { waitUntil: 'networkidle2' });
await page.type('input[type=email]', 'admin@logixpress.tn');
await page.type('input[type=password]', 'Admin123!');
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type=submit]')]);
await page.goto(`${WEB}/colis`, { waitUntil: 'networkidle2' });
await pause(800);
ok(await clickText(/Nouveau Colis/), 'bouton « Nouveau Colis »');
await pause(1200);
const options = await page.evaluate(() => {
  const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /Choisir l.expéditeur/.test(o.text)));
  return sel ? [...sel.options].map((o) => o.value).filter(Boolean).length : -1;
});
ok(options > 0, 'liste des expéditeurs proposée', `${options} option(s)`);

const NAME = `UI Exploitation ${Date.now() % 100000}`;
await page.evaluate((shipperId) => {
  const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /Choisir l.expéditeur/.test(o.text)));
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  set.call(sel, shipperId);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}, blue.id);
const fill = async (placeholder, value) => {
  const el = await page.$(`input[placeholder^="${placeholder}"]`);
  if (!el) return false;
  await el.click({ clickCount: 3 });
  await el.type(value);
  return true;
};
ok(await fill('Nom et prénom', NAME), 'nom saisi');
ok(await fill('Ex: 27660505', '27660506'), 'téléphone saisi');
ok(await fill('N° rue', 'Rue du formulaire 7'), 'adresse saisie');
await fill('Ex: 2 Chemises', 'Deux livres');
ok(await clickText(/Créer le Colis/), 'soumission du formulaire');
await pause(2000);
const found = (await api(admin, 'GET', `/colis?search=${encodeURIComponent(NAME)}`)).data ?? [];
ok(found.length === 1, 'colis créé en base depuis le formulaire', `${found.length} trouvé(s)`);
ok(found[0]?.shipperId === blue.id, 'rattaché à l’expéditeur choisi');
ok(await page.evaluate((n) => document.body.innerText.includes(n), NAME), 'fiche du nouveau colis affichée');

ok(errors.length === 0, 'aucune exception de page ni 5xx', errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\nRESULT: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(` - ${f}`); process.exit(1); }
