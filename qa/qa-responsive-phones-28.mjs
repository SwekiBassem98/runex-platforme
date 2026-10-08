#!/usr/bin/env node
/**
 * QA — tous les écrans web, aux largeurs des téléphones courants.
 *
 * 320 (petits Android, iPhone SE 1re gén.), 360 (Android le plus courant),
 * 375 (iPhone SE/8), 390 (iPhone 12-15), 412 (Pixel, Galaxy), 430 (Pro Max),
 * 768 (tablette). Pour chaque écran : aucune barre de défilement horizontale
 * de la page, et la liste des éléments qui dépassent du bord (hors zones de
 * défilement prévues, comme les tableaux).
 *
 *   QA_WEB_URL=http://localhost:3000 PUPPETEER_CORE=… node qa/qa-responsive-phones-28.mjs
 */
const WEB = (process.env.QA_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const API = `${WEB}/api/v1`;
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.QA_SHOTS ?? '';
const WIDTHS = (process.env.QA_WIDTHS ?? '320,360,375,390,412,430,768').split(',').map(Number);
const puppeteer = (await import(process.env.PUPPETEER_CORE ?? 'puppeteer-core')).default;

let pass = 0;
const failures = [];
const ok = (c, l, d = '') => {
  if (c) { pass++; } else { failures.push(`${l}${d ? ` — ${d}` : ''}`); console.log(`  ✘ ${l}${d ? ` — ${d}` : ''}`); }
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

const colisExp = (await api(exp, 'GET', '/colis?limit=1')).data[0];
const transfer = (await api(admin, 'GET', '/inter-depots?limit=1')).data?.[0];
const voucher = (await api(admin, 'GET', '/payments?limit=1')).data?.[0];

const OPS = [
  '/dashboard', '/colis', '/runsheets', '/magasin', '/inventaire', '/inter-depots', '/inter-depots/retours',
  '/inter-depots/nouveau', '/inter-depots/acceptation', '/ramassages', '/paiements', '/paiements/bordereaux',
  '/paiements/expediteurs', '/paiements/livreurs', '/finance', '/rapports', '/audit', '/notifications', '/recherche?q=26',
  '/admin/utilisateurs', '/admin/livreurs', '/admin/expediteurs',
  ...(transfer?.transferNumber ? [`/inter-depots/${transfer.transferNumber}`] : []),
  ...(voucher?.id ? [`/paiements/${voucher.id}`] : []),
];
const SHIPPER = [
  '/expediteur/tableau-de-bord', '/expediteur/colis', '/expediteur/colis/nouveau', '/expediteur/suivi',
  '/expediteur/ramassages', '/expediteur/retours', '/expediteur/echanges', '/expediteur/bordereaux',
  '/expediteur/activites', '/expediteur/notifications', '/expediteur/profil',
  ...(colisExp ? [`/expediteur/colis/${colisExp.id}`] : []),
];
const PUBLIC = ['/connexion', '/expediteur/login'];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function session(email, password, loginPath) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  if (email) {
    await page.goto(`${WEB}${loginPath}`, { waitUntil: 'networkidle2' });
    await page.type('input[type=email]', email);
    await page.type('input[type=password]', password);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type=submit]')]);
  }
  return { page, context };
}

async function audit(page, path, width) {
  await page.setViewport({ width, height: 800, isMobile: width < 768, hasTouch: width < 768, deviceScaleFactor: 1 });
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  const res = await page.evaluate(() => {
    const W = window.innerWidth;
    const pageOverflow = document.documentElement.scrollWidth - W;
    const scrollable = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p !== document.body && p !== document.documentElement) return true;
      }
      return false;
    };
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > W + 1 && !scrollable(el) && getComputedStyle(el).position !== 'fixed') {
        const name = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className?.baseVal ?? el.className ?? '').split(' ').slice(0, 3).join('.')}`;
        offenders.push(`${name} [${Math.round(r.right - W)}px] « ${(el.innerText || '').trim().slice(0, 30)} »`);
      }
    }
    return { pageOverflow, offenders: offenders.slice(0, 4), url: location.pathname };
  });
  return res;
}

async function run(label, pages, email, password, loginPath) {
  const { page, context } = await session(email, password, loginPath);
  for (const width of WIDTHS) {
    for (const p of pages) {
      const r = await audit(page, p, width);
      ok(r.pageOverflow <= 1 && r.offenders.length === 0, `${label} ${p} @${width}`, r.pageOverflow > 1 ? `page +${r.pageOverflow}px ; ${r.offenders.join(' | ')}` : r.offenders.join(' | '));
      if (SHOTS && width === 360) await page.screenshot({ path: `${SHOTS}/${label}-${p.replace(/\W+/g, '_')}-${width}.png`, fullPage: false });
    }
  }
  await context.close();
}

await run('public', PUBLIC);
await run('ops', OPS, 'admin@logixpress.tn', 'Admin123!', '/connexion');
await run('expediteur', SHIPPER, 'expediteur@bluestar.tn', 'Exp123!', '/expediteur/login');
await browser.close();
console.log(`\n${pass} vérifications réussies, ${failures.length} échec(s)`);
if (failures.length) process.exit(1);
