#!/usr/bin/env node
/**
 * QA — retour sonore du web (format téléphone).
 *
 * - les 7 sons sont servis et décodables par le navigateur (Web Audio) ;
 * - connexion refusée → erreur ;
 * - réception dépôt : reçu → succès, déjà reçu → avertissement, code faux → erreur ;
 * - acceptation inter-dépôt : code faux → erreur ;
 * - ramassages : « Organiser » → succès, « Effectuer » → arpège (complete) ;
 * - réglage : sons coupés → plus rien n'est joué ; réglage conservé au rechargement.
 *
 * Chaque son joué est tracé dans `window.__runexSounds` (déclaré par le test).
 *
 *   QA_WEB_URL=http://localhost:3000 PUPPETEER_CORE=… node qa/qa-sounds-28.mjs
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
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { email: e, password: p })).data.accessToken;
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const admin = await login('admin@logixpress.tn', 'Admin123!');
const C = (await api(exp, 'POST', '/colis', { customerName: 'Son QA', customerPhone: '93300111', governorate: 'Ben Arous', delegation: 'Rades', address: 'Rue son', totalPrice: 12, pieceCount: 1 })).data;

console.log('\n1. Fichiers sonores');
for (const k of ['scan', 'success', 'complete', 'error', 'warning', 'notify', 'remove']) {
  const r = await fetch(`${WEB}/sounds/${k}.wav`);
  ok(r.status === 200 && /audio\/(wav|x-wav|wave)/.test(r.headers.get('content-type') ?? ''), `/sounds/${k}.wav servi en audio`, `${r.status} ${r.headers.get('content-type')}`);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => { window.__runexSounds = []; });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const sounds = () => page.evaluate(() => window.__runexSounds.slice());
const resetSounds = () => page.evaluate(() => { window.__runexSounds.length = 0; });
const waitSound = async (kind, timeout = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if ((await sounds()).includes(kind)) return true; await pause(150); }
  return false;
};
const tap = (re) => page.evaluate((src) => {
  const el = [...document.querySelectorAll('button')].find((b) => new RegExp(src).test((b.innerText || '').trim()) && b.getClientRects().length && !b.disabled);
  el?.click();
  return !!el;
}, re.source);

console.log('\n2. Décodage Web Audio');
await page.goto(`${WEB}/connexion`, { waitUntil: 'networkidle2' });
const decoded = await page.evaluate(async () => {
  const c = new AudioContext();
  const out = {};
  for (const k of ['scan', 'success', 'complete', 'error', 'warning', 'notify', 'remove']) {
    try { const b = await c.decodeAudioData(await (await fetch(`/sounds/${k}.wav`)).arrayBuffer()); out[k] = b.duration; } catch (e) { out[k] = String(e); }
  }
  return out;
});
ok(Object.values(decoded).every((d) => typeof d === 'number' && d > 0.1 && d < 1.2), 'les 7 sons se décodent (0,1 s – 1,2 s)', JSON.stringify(decoded));

console.log('\n3. Connexion refusée');
await page.type('input[type=email]', 'admin@logixpress.tn');
await page.type('input[type=password]', 'mauvais-mdp');
await page.click('button[type=submit]');
ok(await waitSound('error'), 'mot de passe faux → son « error »', JSON.stringify(await sounds()));
await page.$eval('input[type=password]', (el) => { el.value = ''; });
await page.click('input[type=password]', { clickCount: 3 });
await page.keyboard.press('Backspace');
await page.type('input[type=password]', 'Admin123!');
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type=submit]')]);

console.log('\n4. Réception dépôt');
await page.goto(`${WEB}/magasin`, { waitUntil: 'networkidle2' });
const input = 'input[placeholder^="Scanner un code-barres"]';
await page.waitForSelector(input);
const scanCode = async (code) => {
  await resetSounds();
  await page.click(input, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(input, code);
  await page.keyboard.press('Enter');
};
await scanCode(C.barcode);
ok(await waitSound('success'), 'colis reçu → « success »', JSON.stringify(await sounds()));
await scanCode(C.barcode);
ok(await waitSound('warning'), 'déjà reçu → « warning »', JSON.stringify(await sounds()));
await scanCode('123');
ok(await waitSound('error'), 'code illisible → « error »', JSON.stringify(await sounds()));

console.log('\n5. Acceptation inter-dépôt');
await page.goto(`${WEB}/inter-depots/acceptation`, { waitUntil: 'networkidle2' });
await page.waitForSelector('#code-barre-acceptation');
await resetSounds();
await page.type('#code-barre-acceptation', '26010199999999');
await page.keyboard.press('Enter');
ok(await waitSound('error'), 'code inconnu → « error »', JSON.stringify(await sounds()));

console.log('\n6. Ramassages');
const drivers = (await api(admin, 'GET', '/inter-depots/form-options')).data.drivers;
const shippers = (await api(admin, 'GET', '/shippers?limit=50')).data;
const benh = (shippers.items ?? shippers).find((s) => /benhcine/i.test(s.companyName ?? s.brandName));
const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const pk = await api(admin, 'POST', '/ramassages', { shipperId: benh.id, scheduledDate: demain, timeSlotStartHour: 8, timeSlotEndHour: 10, assignedDriverId: drivers[0].id, address: 'Avenue Habib Bourguiba, Tunis', estimatedPackageCount: 1 });
ok(pk.status === 201 || pk.status === 200, 'données : ramassage affecté', pk.json?.message);
await page.goto(`${WEB}/ramassages`, { waitUntil: 'networkidle2' });
await resetSounds();
const effectuer = await page.evaluate((ref) => {
  const row = [...document.querySelectorAll('tr')].find((r) => r.innerText?.includes(ref) && /Effectuer/.test(r.innerText));
  const b = row && [...row.querySelectorAll('button')].find((x) => /Effectuer/i.test(x.innerText || ''));
  b?.click();
  return !!b;
}, pk.data.shipperName);
if (effectuer) ok(await waitSound('complete'), '« Effectuer » → « complete »', JSON.stringify(await sounds()));
else ok(false, 'bouton « Effectuer » trouvé');

console.log('\n7. Réglage du son');
await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle2' });
await page.click('[data-testid="sound-settings"]');
await page.waitForSelector('[data-testid="sound-enabled"]');
ok(await page.$eval('[data-testid="sound-enabled"]', (el) => el.checked), 'sons activés par défaut');
await resetSounds();
await tap(/^Succès$/);
ok(await waitSound('success'), '« Tester » joue le son');
await page.click('[data-testid="sound-enabled"]');
await resetSounds();
await tap(/^Erreur$/); // bouton désactivé : aucun son
await page.goto(`${WEB}/magasin`, { waitUntil: 'networkidle2' });
await page.waitForSelector(input);
await scanCode('123');
await pause(1500);
ok(!(await sounds()).includes('error'), 'sons coupés → aucun son joué', JSON.stringify(await sounds()));
await page.reload({ waitUntil: 'networkidle2' });
ok(await page.evaluate(() => JSON.parse(localStorage.getItem('runex.feedback.v1') || '{}').enabled === false), 'réglage conservé au rechargement');
await page.evaluate(() => localStorage.removeItem('runex.feedback.v1'));

console.log('\n8. Portail expéditeur');
const ctx2 = await browser.createBrowserContext();
const p2 = await ctx2.newPage();
await p2.setViewport({ width: 360, height: 780, isMobile: true, hasTouch: true });
await p2.goto(`${WEB}/expediteur/login`, { waitUntil: 'networkidle2' });
await p2.type('input[type=email]', 'expediteur@bluestar.tn');
await p2.type('input[type=password]', 'Exp123!');
await Promise.all([p2.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p2.click('button[type=submit]')]);
await p2.goto(`${WEB}/expediteur/colis`, { waitUntil: 'networkidle2' });
ok(!!(await p2.$('[data-testid="sound-settings"]')), 'réglage du son présent dans l’en-tête du portail (360 px)');
const box = await (await p2.$('[data-testid="sound-settings"]')).boundingBox();
ok(box && box.x >= 0 && box.x + box.width <= 360, 'bouton visible dans la largeur du téléphone', JSON.stringify(box));

ok(errors.length === 0, 'aucune erreur JavaScript', errors.join(' | '));
await browser.close();
console.log(`\n${pass} vérifications réussies, ${failures.length} échec(s)`);
if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
