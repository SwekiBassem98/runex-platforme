#!/usr/bin/env node
/**
 * QA 47 — demandes du client (06/11) :
 *  1. Colis à 0 DT : l'exploitation saisit un prix négatif, jusqu'à « − frais
 *     de livraison » (−7 + 7 de frais = 0 à encaisser), à la création comme à
 *     la modification ; le bon de livraison imprime PRIX TOTAL 0.000 DT.
 *     L'expéditeur aussi (création directe ; modification = demande de prix
 *     approuvée par l'admin), y compris depuis la fiche « Modifier le colis ».
 *  2. Bon de livraison : logo clair (variante d'impression), le logo de
 *     l'application reste inchangé ailleurs.
 *
 *   QA_API_URL=… QA_WEB_URL=… PUPPETEER_CORE=… CHROME=… [QA_SHOTS=…] node qa/qa-prix-zero-logo-47.mjs
 */
const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const W = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const SHOTS = process.env.QA_SHOTS ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const failures = [];
const ok = (c, l, d = '') => {
  if (c) { pass++; console.log(`  ✔ ${l}`); } else { failures.push(l); console.log(`  ✘ ${l}${d ? ` — ${d}` : ''}`); }
};
async function api(token, method, p, body) {
  const h = { Accept: 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${API}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* vide */ }
  return { status: r.status, data: j?.data, message: j?.message };
}
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const bluestar = (await api(admin, 'GET', '/shippers?limit=50')).data.find((s) => s.code === 'EXP-BLUESTAR');
const base = { shipperId: bluestar.id, customerPhone: '98470001', governorate: 'Tunis', delegation: 'La Marsa', address: 'Rue 47' };

console.log('\n1. Création (API)');
let r = await api(admin, 'POST', '/colis', { ...base, customerName: 'Q47 référence', goodsPrice: 10 });
const frais = r.data?.deliveryFee;
ok(r.status === 201 && frais > 0, `frais de livraison de l’expéditeur : ${frais}`);
r = await api(admin, 'POST', '/colis', { ...base, customerName: 'Q47 zéro', goodsPrice: -frais });
const zero = r.data;
ok(r.status === 201, 'admin : colis créé avec prix = − frais', `${r.status} ${r.message}`);
ok(zero?.goodsPrice === -frais && zero?.totalPrice === 0 && zero?.deliveryFee === frais, 'prix −frais + frais = 0 à encaisser', JSON.stringify({ g: zero?.goodsPrice, t: zero?.totalPrice, f: zero?.deliveryFee }));
r = await api(admin, 'POST', '/colis', { ...base, customerName: 'Q47 partiel', goodsPrice: -2 });
ok(r.status === 201 && r.data.totalPrice === Math.round((frais - 2) * 1000) / 1000, 'admin : prix −2 → total = frais − 2', String(r.data?.totalPrice));
r = await api(admin, 'POST', '/colis', { ...base, customerName: 'Q47 trop', goodsPrice: -(frais + 1) });
ok(r.status === 400 && /ne peut pas descendre/.test(r.message ?? ''), 'admin : sous − frais → refusé (total négatif)', `${r.status} ${r.message}`);
r = await api(exp, 'POST', '/colis', { ...base, customerName: 'Q47 exp zéro', goodsPrice: -frais });
ok(r.status === 201 && r.data.totalPrice === 0 && r.data.goodsPrice === -frais, 'expéditeur : colis créé à 0 DT (prix − frais)', `${r.status} ${r.message}`);
r = await api(exp, 'POST', '/colis', { ...base, customerName: 'Q47 exp trop', goodsPrice: -(frais + 1) });
ok(r.status === 400, 'expéditeur : sous − frais refusé', `${r.status} ${r.message}`);
r = await api(exp, 'POST', '/colis', { ...base, customerName: 'Q47 exp ok', goodsPrice: 0 });
ok(r.status === 201 && r.data.totalPrice === frais, 'expéditeur : prix 0 → total = frais (inchangé)');
const colisExp = r.data;

console.log('\n2. Modification (API)');
r = await api(admin, 'POST', '/colis', { ...base, customerName: 'Q47 modif', goodsPrice: 25 });
const m = r.data;
const methode = 'PUT';
r = await api(admin, methode, `/colis/${m.id}`, { goodsPrice: -frais });
let fiche = (await api(admin, 'GET', `/colis/${m.id}`)).data;
ok(r.status === 200 && fiche.totalPrice === 0 && fiche.goodsPrice === -frais, 'admin : prix modifié à − frais → 0 à encaisser', `${r.status} ${r.message} ${fiche.totalPrice}/${fiche.goodsPrice}`);
r = await api(admin, methode, `/colis/${m.id}`, { totalPrice: 15 });
fiche = (await api(admin, 'GET', `/colis/${m.id}`)).data;
ok(fiche.totalPrice === 15 && fiche.goodsPrice === Math.round((15 - frais) * 1000) / 1000, 'admin : montant à encaisser 15 → prix suit', `${fiche.totalPrice}/${fiche.goodsPrice}`);
r = await api(admin, methode, `/colis/${m.id}`, { totalPrice: 0 });
fiche = (await api(admin, 'GET', `/colis/${m.id}`)).data;
ok(fiche.totalPrice === 0 && fiche.goodsPrice === -frais, 'admin : montant à encaisser 0 → prix = − frais (plus de prix ramené à 0)', `${fiche.totalPrice}/${fiche.goodsPrice}`);
r = await api(admin, methode, `/colis/${m.id}`, { goodsPrice: -(frais + 0.5) });
ok(r.status === 400, 'admin : modification sous − frais refusée', `${r.status}`);
r = await api(admin, methode, `/colis/${m.id}`, { totalPrice: -1 });
ok(r.status === 400, 'admin : montant à encaisser négatif refusé', `${r.status}`);
r = await api(exp, methode, `/colis/${colisExp.id}`, { goodsPrice: -(frais + 1) });
ok(r.status === 400, 'expéditeur : demande sous − frais refusée', `${r.status} ${r.message}`);
r = await api(exp, methode, `/colis/${colisExp.id}`, { goodsPrice: -frais });
const dem = (await api(admin, 'GET', `/colis/demandes-prix?status=EN_ATTENTE&packageId=${colisExp.id}`)).data?.[0];
ok(r.status === 200 && Number(dem?.newTotal) === 0 && Number(dem?.newGoodsPrice) === -frais, 'expéditeur : demande de prix − frais (0 DT) enregistrée', `${r.status} ${r.message} ${JSON.stringify(dem ?? null).slice(0, 120)}`);
r = await api(admin, 'POST', `/colis/demandes-prix/${dem?.id}/approuver`, {});
fiche = (await api(admin, 'GET', `/colis/${colisExp.id}`)).data;
ok(r.status === 200 && fiche.totalPrice === 0 && fiche.goodsPrice === -frais, 'admin approuve : colis à 0 DT', `${r.status} ${fiche.totalPrice}/${fiche.goodsPrice}`);

console.log('\n3. Bon de livraison (API)');
const bon = (await api(admin, 'GET', `/colis/${zero.id}/bon-livraison`)).data;
ok(bon?.total === 0, 'bon : total 0', String(bon?.total));
ok(bon?.lines?.length === 1 && bon.lines[0].totalTTC === 0, 'bon : ligne à 0', JSON.stringify(bon?.lines));

console.log('\n4. Écrans');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const ctx = await b.createBrowserContext();
const p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);
const clickText = (re) => p.evaluate((src) => {
  const el = [...document.querySelectorAll('button, a, tr')].find((x) => new RegExp(src, 'i').test((x.textContent || '').trim()) && x.getClientRects().length > 0 && !x.disabled);
  el?.click(); return Boolean(el);
}, re.source);

// Formulaire « Nouveau colis » : − frais → 0.000 à encaisser.
await p.goto(W + '/colis', { waitUntil: 'networkidle2' }); await sleep(800);
await clickText(/^Nouveau Colis$/); await sleep(800);
const selShipper = await p.$('form select');
if (selShipper) await selShipper.select(bluestar.id);
await sleep(1500);
const prix = await p.$('[data-testid=prix-colis]');
ok(Boolean(prix), 'formulaire : champ « Prix du colis »');
const min = await prix?.evaluate((x) => x.min);
ok(Number(min) === -frais, `formulaire : minimum = − frais (${min})`);
await prix?.click({ clickCount: 3 }); await prix?.type(String(-frais)); await sleep(400);
let tot = await p.$eval('[data-testid=total-encaisser]', (x) => x.innerText).catch(() => '');
ok(/0\.000 DT/.test(tot.split('\n').pop() ?? ''), 'formulaire : − frais → Montant à encaisser 0.000 DT', tot.replace(/\s+/g, ' '));
const valide = await prix?.evaluate((x) => x.checkValidity());
ok(valide === true, 'formulaire : saisie − frais acceptée par le champ');
if (SHOTS) await p.screenshot({ path: `${SHOTS}/47-formulaire-zero.png` });
await prix?.click({ clickCount: 3 }); await prix?.type(String(-(frais + 1))); await sleep(300);
tot = await p.$eval('[data-testid=total-encaisser]', (x) => x.innerText).catch(() => '');
ok(/—/.test(tot) && (await prix?.evaluate((x) => x.checkValidity())) === false, 'formulaire : sous − frais → refusé');

// Fiche du colis à 0 DT, puis impression du bon.
await p.goto(W + '/colis', { waitUntil: 'networkidle2' }); await sleep(800);
await clickText(new RegExp(zero.trackingNumber)); await sleep(1500);
const t = await p.evaluate(() => document.body.innerText);
ok(new RegExp(`Prix du colis :\\s*-\\s*${frais.toFixed(3).replace('.', '[.,]')}|Prix du colis :\\s*−`).test(t) || t.includes(`-${frais.toFixed(3)}`) || /-\s?7[,.]000/.test(t), 'fiche : prix du colis négatif affiché');
const target = new Promise((resolve) => ctx.once('targetcreated', resolve));
await clickText(/^Bon de livraison$/);
const tg = await Promise.race([target, sleep(8000).then(() => null)]);
const pop = tg ? await tg.page() : null;
ok(Boolean(pop), 'bon : fenêtre ouverte');
if (pop) {
  await pop.waitForSelector('section.page', { timeout: 8000 }).catch(() => {});
  await pop.setViewport({ width: 900, height: 1100 });
  await sleep(800);
  const info = await pop.evaluate(() => {
    const img = document.querySelector('.logo img');
    return { total: document.querySelector('[data-champ=total]')?.textContent?.trim(), src: img?.getAttribute('src'), w: img?.naturalWidth, h: img?.getBoundingClientRect().height };
  });
  ok(info.total === '0.000 DT', 'bon imprimé : PRIX TOTAL 0.000 DT', info.total);
  ok(/runex-logo-impression\.png$/.test(info.src ?? ''), 'bon : logo clair (variante d’impression)', info.src);
  ok(info.w > 0, 'bon : logo chargé');
  // Logo clair : fond majoritairement blanc.
  const clair = await pop.$eval('.logo img', (img) => {
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let blanc = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) blanc++;
    return blanc / (d.length / 4);
  });
  ok(clair > 0.5, `bon : logo sur fond clair (${Math.round(clair * 100)} % blanc)`);
  if (SHOTS) {
    await pop.screenshot({ path: `${SHOTS}/47-bon-zero.png` });
    await pop.emulateMediaType('print');
    (await import('node:fs')).writeFileSync(`${SHOTS}/47-bon-zero.pdf`, await pop.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true }));
  }
  await pop.close();
}
// Portail expéditeur, fiche « Modifier le colis » (téléphone) : − frais accepté.
{
  const c2 = await b.createBrowserContext();
  const e = await c2.newPage(); await e.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  e.on('pageerror', (x) => errs.push(x.message));
  const cible = (await api(exp, 'POST', '/colis', { ...base, customerName: 'Q47 portail', goodsPrice: 30 })).data;
  await e.goto(W + '/expediteur/login', { waitUntil: 'networkidle2' });
  await e.type('input[type=email]', 'expediteur@bluestar.tn'); await e.type('input[type=password]', 'Exp123!');
  await Promise.all([e.waitForNavigation({ waitUntil: 'networkidle2' }), e.keyboard.press('Enter')]);
  await e.goto(`${W}/expediteur/colis/${cible.id}`, { waitUntil: 'networkidle2' }); await sleep(1200);
  await e.evaluate(() => { const bt = [...document.querySelectorAll('button')].find((x) => /^Modifier$/.test(x.innerText.trim()) && x.getClientRects().length); bt?.click(); });
  const champ = await e.waitForSelector('[data-testid=prix-colis-edition]', { timeout: 8000 }).catch(() => null);
  ok(Boolean(champ), 'portail : fiche « Modifier le colis » ouverte');
  if (champ) {
    await champ.evaluate((x) => { x.scrollIntoView({ block: 'center' }); x.focus(); x.select(); });
    await e.keyboard.press('Backspace'); await e.keyboard.type(String(-frais)); await sleep(300);
    ok((await champ.evaluate((x) => x.checkValidity())) === true, `portail : prix −${frais} accepté (plus de « supérieure ou égale à 0 »)`, await champ.evaluate((x) => x.validationMessage));
    const aide = await e.evaluate(() => document.body.innerText);
    ok(/Colis à 0 DT : saisissez −/.test(aide), 'portail : aide « Colis à 0 DT »');
    ok(/0[.,]000/.test(await e.$eval('[data-testid=avertissement-prix]', (x) => x.innerText).catch(() => '')), 'portail : montant à encaisser 0.000 annoncé');
    if (SHOTS) await e.screenshot({ path: `${SHOTS}/47-portail-modifier.png` });
    await e.evaluate(() => { const bt = [...document.querySelectorAll('button')].find((x) => /^Enregistrer$/.test(x.innerText.trim())); bt?.click(); });
    await sleep(1500);
    const d2 = (await api(admin, 'GET', `/colis/demandes-prix?status=EN_ATTENTE&packageId=${cible.id}`)).data?.[0];
    ok(d2 && Number(d2.newTotal) === 0, 'portail : demande « 0 DT » envoyée à l’admin', JSON.stringify(d2 ?? null).slice(0, 120));
  }
  await c2.close();
}
// Le logo de l'application reste celui d'origine.
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' }).catch(() => {});
const logos = await p.evaluate(() => [...document.images].map((i) => i.getAttribute('src') ?? ''));
ok(!logos.some((s) => s.includes('runex-logo-impression')), 'écrans : logo de l’application inchangé');
await b.close();
ok(errs.length === 0, 'aucune erreur JavaScript', errs.join(' | '));

console.log(`\n${pass} réussis, ${failures.length} échoués`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
