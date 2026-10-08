#!/usr/bin/env node
/**
 * QA — bon de livraison (étiquette A4 collée sur chaque pièce du colis).
 *
 * API : contenu exact du bon (numéro, date, taille i/N, agences, expéditeur
 * avec M.F., destinataire, R.A.S / remarque, lignes et PRIX TOTAL, transporteur
 * + MF, cases FRAGILE / ouverture), périmètre (un expéditeur ne lit que ses
 * colis), validation de l'impression groupée.
 *
 * Navigateur : l'expéditeur et l'exploitation impriment depuis la fiche ;
 * une page par pièce ; le QR et le code-barres portent le code de la pièce
 * (le QR est décodé depuis la capture) ; le PDF A4 fait une page par pièce.
 *
 *   QA_WEB_URL=http://localhost:3000 PUPPETEER_CORE=… JSQR=… PNGJS=… node qa/qa-bon-livraison-27.mjs
 * (web servi avec NEXT_PUBLIC_API_URL=/api/v1 et API_PROXY_TARGET ; base seedée)
 */
const WEB = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const API = `${WEB}/api/v1`;
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.QA_SHOTS ?? '';
const puppeteer = (await import(process.env.PUPPETEER_CORE ?? 'puppeteer-core')).default;
const jsQR = process.env.JSQR ? (await import(process.env.JSQR)).default : null;
const PNG = process.env.PNGJS ? (await import(process.env.PNGJS)).PNG : null;

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

console.log('\n1. Contenu du bon (API)');
const created = await api(exp, 'POST', '/colis', {
  customerName: 'Hamdi Lobna', customerPhone: '93329135', governorate: 'Sfax', delegation: 'Sakiet Ezzit',
  address: 'المحمدية طريق قرمدة', totalPrice: 43, pieceCount: 2, sizeCategory: 'LEGERE',
  contentSummary: '108 emballage doypack et 3 sticker', allowOpen: true, isFragile: true,
});
ok(created.status === 201 || created.status === 200, 'création avec isFragile', String(created.status));
const C = created.data;
ok(C.isFragile === true && C.allowOpen === true, 'DTO : isFragile et allowOpen restitués');
const shipper = (await api(admin, 'GET', `/shippers/${C.shipperId}`)).data ?? {};
const bl = (await api(exp, 'GET', `/colis/${C.id}/bon-livraison`)).data;
ok(bl && bl.number === C.trackingNumber, 'N° du bon = numéro de suivi', bl?.number);
ok(bl.barcode === C.barcode, 'code-barres du colis');
ok(new Date(bl.date).getTime() === new Date(C.createdAt).getTime(), 'date = création du colis');
ok(bl.sizeShort === 'LGR' && bl.pieceCount === 2, 'taille LGR, 2 pièces');
ok(bl.pieces.map((p) => p.code).join() === `${C.barcode}-1,${C.barcode}-2`, 'codes des pièces base-1, base-2');
ok(bl.originAgency === C.originDepositName && bl.destinationAgency === C.destinationDepositName, 'agence départ => agence arrivée');
ok(/sfax/i.test(bl.destinationAgency), 'adresse à Sfax livrée par l’agence de Sfax', bl.destinationAgency);
ok(bl.governorate === 'Sfax' && bl.delegation === 'Sakiet Ezzit', 'gouvernorat/délégation');
ok(bl.shipper.name === C.shipperName && bl.shipper.phone && bl.shipper.taxId, 'expéditeur : nom, téléphone, M.F.');
if (shipper.taxId) ok(bl.shipper.taxId === shipper.taxId, 'M.F. = matricule de la fiche expéditeur');
ok(bl.recipient.name === 'Hamdi Lobna' && bl.recipient.phone === '93329135' && bl.recipient.address === 'المحمدية طريق قرمدة', 'destinataire : nom, tél, adresse');
ok(bl.remark === 'R.A.S', 'sans remarque : R.A.S');
ok(bl.allowOpen === true && bl.isFragile === true, 'cases FRAGILE et ouverture');
ok(bl.lines.length === 1 && bl.lines[0].designation === '108 emballage doypack et 3 sticker' && bl.lines[0].quantity === 1
  && bl.lines[0].unitPriceHT === 43 && bl.lines[0].vatRate === 0 && bl.lines[0].vatAmount === 0 && bl.lines[0].totalTTC === 43, 'ligne : désignation, Qté 1, PU HT 43, TVA 0%, MT TTC 43');
ok(bl.total === 43, 'PRIX TOTAL = montant à encaisser');
ok(bl.carrier.name && bl.carrier.taxRegistration, 'transporteur : raison sociale et MF');

console.log('\n2. Modifications reportées sur le bon');
await api(exp, 'PUT', `/colis/${C.id}`, { notes: 'Appeler avant 14h', isFragile: false });
let b2 = (await api(exp, 'GET', `/colis/${C.id}/bon-livraison`)).data;
ok(b2.remark === 'Appeler avant 14h' && b2.isFragile === false, 'remarque et case FRAGILE modifiées', JSON.stringify([b2.remark, b2.isFragile]));
await api(exp, 'PUT', `/colis/${C.id}`, { notes: '', isFragile: true });
b2 = (await api(exp, 'GET', `/colis/${C.id}/bon-livraison`)).data;
ok(b2.remark === 'R.A.S' && b2.isFragile === true, 'remarque effacée → R.A.S');

console.log('\n3. Périmètre et validation');
const tous = (await api(admin, 'GET', '/colis?limit=100')).data;
const autre = tous.find((c) => c.shipperId !== C.shipperId);
ok((await api(exp, 'GET', `/colis/${autre.trackingNumber}/bon-livraison`)).status === 404, 'expéditeur : colis d’un autre → 404');
ok((await api(null, 'GET', `/colis/${C.id}/bon-livraison`)).status === 401, 'sans jeton → 401');
const ids = tous.map((c) => c.id);
const lotExp = (await api(exp, 'POST', '/colis/bons-livraison', { identifiers: ids })).data;
ok(lotExp.length > 0 && lotExp.every((b) => b.shipper.name === C.shipperName), 'groupé : seulement ses propres colis', String(lotExp.length));
const lotAdm = (await api(admin, 'POST', '/colis/bons-livraison', { identifiers: [C.trackingNumber, autre.barcode] })).data;
ok(lotAdm.length === 2 && lotAdm[0].number === C.trackingNumber && lotAdm[1].number === autre.trackingNumber, 'groupé : ordre demandé, numéro ou code-barres');
ok((await api(admin, 'POST', '/colis/bons-livraison', { identifiers: 'x' })).status === 400, 'corps invalide → 400');
ok((await api(admin, 'POST', '/colis/bons-livraison', { identifiers: Array(201).fill('x') })).status === 400, 'plus de 200 → 400');

console.log('\n4. Impression au navigateur');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
async function session(email, password, chemin = '/connexion') {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  page.on('pageerror', (e) => errors.push(`${email}: ${String(e)}`));
  await page.goto(`${WEB}${chemin}`, { waitUntil: 'networkidle2' });
  await page.type('input[type=email]', email);
  await page.type('input[type=password]', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type=submit]')]);
  return { page, context };
}
const clickText = (page, re) => page.evaluate((src) => {
  const el = [...document.querySelectorAll('button, a, tr')].find((x) => new RegExp(src, 'i').test((x.textContent || '').trim()) && x.getClientRects().length > 0 && !x.disabled);
  el?.click();
  return Boolean(el);
}, re.source);
async function popupApres(context, action) {
  const target = new Promise((resolve) => context.once('targetcreated', resolve));
  await action();
  const t = await Promise.race([target, pause(8000).then(() => null)]);
  if (!t) return null;
  const p = await t.page();
  await p.waitForSelector('section.page', { timeout: 8000 }).catch(() => {});
  await pause(500);
  return p;
}
function decodeQr(buf) {
  if (!jsQR || !PNG) return undefined;
  const png = PNG.sync.read(Buffer.from(buf));
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
}
async function verifierBon(pop, attendu, label) {
  ok(Boolean(pop), `${label} : fenêtre du bon ouverte`);
  if (!pop) return;
  await pop.setViewport({ width: 900, height: 1100 });
  const info = await pop.evaluate(() => ({
    pages: [...document.querySelectorAll('section.page')].map((s) => ({
      code: s.dataset.code,
      numero: s.querySelector('[data-champ=numero]')?.textContent?.trim(),
      date: s.querySelector('[data-champ=date]')?.textContent?.trim(),
      taille: s.querySelector('[data-champ=taille]')?.textContent?.replace(/\s+/g, ''),
      route: s.querySelector('[data-champ=route]')?.textContent?.trim(),
      zone: s.querySelector('[data-champ=zone]')?.textContent?.trim(),
      exp: s.querySelector('[data-champ=expediteur]')?.textContent?.replace(/\s+/g, ' ').trim(),
      dest: s.querySelector('[data-champ=destinataire]')?.textContent?.replace(/\s+/g, ' ').trim(),
      total: s.querySelector('[data-champ=total]')?.textContent?.trim(),
      transp: s.querySelector('[data-champ=transporteur]')?.textContent?.replace(/\s+/g, ' ').trim(),
      fragile: s.querySelector('[data-champ=fragile]')?.dataset.coche,
      ouverture: s.querySelector('[data-champ=ouverture]')?.dataset.coche,
      lignes: [...s.querySelectorAll('table.lignes tbody td')].map((td) => td.textContent.trim()),
      logo: s.querySelector('.logo img')?.naturalWidth ?? 0,
    })),
  }));
  ok(info.pages.length === attendu.pieceCount, `${label} : une page par pièce (${info.pages.length})`);
  const p1 = info.pages[0];
  const jour = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(attendu.date));
  ok(p1.numero === attendu.number && p1.date === jour, `${label} : N° et date`, `${p1.numero} ${p1.date}`);
  ok(info.pages.every((p, i) => p.taille === `${attendu.sizeShort}(${i + 1}/${attendu.pieceCount})` && p.code === attendu.pieces[i].code), `${label} : LGR(i/N) et code de chaque pièce`);
  ok(p1.route === `${attendu.originAgency} => ${attendu.destinationAgency}` && p1.zone === `=> ${attendu.governorate}/${attendu.delegation}`, `${label} : agences et zone`, `${p1.route} | ${p1.zone}`);
  ok(p1.exp.includes(attendu.shipper.name) && p1.exp.includes(attendu.shipper.phone) && p1.exp.includes(`M.F. :${attendu.shipper.taxId}`), `${label} : bloc expéditeur`);
  ok(p1.dest.includes('DESTINATAIRE') && p1.dest.includes(attendu.recipient.name) && p1.dest.includes(`Tel:${attendu.recipient.phone}`) && p1.dest.includes(attendu.remark)
    && (attendu.allowOpen ? p1.dest.includes('Autorisation d’ouvrir le colis') : true), `${label} : bloc destinataire, remarque, ouverture`);
  ok(p1.lignes.join('|') === `${attendu.lines[0].designation}|1|${attendu.total.toFixed(3)}|0%|0.000|${attendu.total.toFixed(3)}`, `${label} : ligne du tableau`, p1.lignes.join('|'));
  ok(p1.total === `${attendu.total.toFixed(3)} DT`, `${label} : PRIX TOTAL`, p1.total);
  ok(p1.transp.includes(attendu.carrier.name) && p1.transp.includes(`MF: ${attendu.carrier.taxRegistration}`), `${label} : transporteur et MF`);
  ok(p1.fragile === String(attendu.isFragile) && p1.ouverture === String(attendu.allowOpen), `${label} : cases cochées`);
  ok(p1.logo > 0, `${label} : logo chargé`);
  const sections = await pop.$$('section.page');
  for (let i = 0; i < sections.length; i++) {
    const qr = await sections[i].$('.qr');
    const lu = decodeQr(await qr.screenshot({ type: 'png' }));
    if (lu !== undefined) ok(lu === attendu.pieces[i].code, `${label} : QR pièce ${i + 1} lisible = ${attendu.pieces[i].code}`, String(lu));
  }
  if (SHOTS) await pop.screenshot({ path: `${SHOTS}/${label.replace(/\W+/g, '-')}.png`, fullPage: true });
  await pop.emulateMediaType('print');
  const pdf = await pop.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
  const pagesPdf = (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok(pagesPdf === attendu.pieceCount, `${label} : PDF A4, ${pagesPdf} page(s)`);
  if (SHOTS) (await import('node:fs')).writeFileSync(`${SHOTS}/${label.replace(/\W+/g, '-')}.pdf`, pdf);
  await pop.close();
}

const attendu = (await api(exp, 'GET', `/colis/${C.id}/bon-livraison`)).data;
{
  const { page, context } = await session('expediteur@bluestar.tn', 'Exp123!', '/expediteur/login');
  await page.goto(`${WEB}/expediteur/colis/${C.id}`, { waitUntil: 'networkidle2' });
  const pop = await popupApres(context, () => clickText(page, /^Bon de livraison$/));
  await verifierBon(pop, attendu, 'expediteur fiche');
  await page.goto(`${WEB}/expediteur/colis`, { waitUntil: 'networkidle2' });
  await pause(800);
  const pop2 = await popupApres(context, () => clickText(page, /^Bons de livraison \(\d+\)$/));
  const pages = pop2 ? await pop2.evaluate(() => document.querySelectorAll('section.page').length) : 0;
  ok(pages >= 2, 'expéditeur liste : bons de la page imprimés', String(pages));
  await pop2?.close();
  await context.close();
}
{
  const { page, context } = await session('admin@logixpress.tn', 'Admin123!');
  await page.goto(`${WEB}/colis`, { waitUntil: 'networkidle2' });
  await pause(800);
  const vu = await clickText(page, new RegExp(C.trackingNumber));
  ok(vu, 'exploitation : colis trouvé dans la liste');
  await page.waitForFunction(() => /Bon de livraison/.test(document.body.innerText), { timeout: 8000 }).catch(() => {});
  const pop = await popupApres(context, () => clickText(page, /^Bon de livraison$/));
  await verifierBon(pop, attendu, 'exploitation fiche');
  await context.close();
}
ok(errors.length === 0, 'aucune erreur JavaScript', errors.join(' ; '));
await browser.close();

console.log(`\n${pass} vérifications réussies, ${failures.length} échec(s)`);
if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
