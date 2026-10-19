/**
 * QA 39 — validation d'une tournée par la caisse (comme ADEX) et fiche
 * d'encaissement de la caisse livreurs.
 *
 *   API  : écran de validation (totaux, écarts), scan Reporté / Retour
 *          définitif, correction d'un montant, validation (conforme /
 *          déficit), encaissements validés ou écartés, tournée rangée dans
 *          l'historique, cloisonnement.
 *   Écran: compteurs et bouton « Valider » de la liste, page de validation,
 *          historique, fiche d'encaissement imprimable.
 *
 *   PUPPETEER_CORE=…/puppeteer-core.js CHROME=…/chrome node qa/qa-validation-tournee-39.mjs
 * API sur :4000, web sur :3000 (build de production), base de démonstration.
 */
const API = process.env.QA_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const W = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? '/tmp';
let pass = 0, fail = 0;
const ok = (c, l, d = '') => { if (c) { pass++; console.log('  ✔', l); } else { fail++; console.log('  ✘', l, d); } return c; };
async function api(t, m, p, b) {
  const h = { Accept: 'application/json' };
  if (t) h.Authorization = `Bearer ${t}`;
  if (b !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = null; try { j = await r.json(); } catch { /* vide */ }
  return { s: r.status, d: j?.data, m: j?.message, meta: j?.meta };
}
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).d?.accessToken;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const liv = await login('livreur.ghassan@logixpress.tn', 'Liv123!');
const me = (await api(liv, 'GET', '/auth/me')).d;
const lid = me.driverId ?? me.driver?.id;

console.log('1. Préparation : tournée de 5 colis');
const colis = [];
for (let i = 0; i < 5; i++) {
  const c = (await api(exp, 'POST', '/colis', { customerName: `Val ${i}`, customerPhone: `9811100${i}`, governorate: 'Ben Arous', delegation: 'Rades', address: `Rue ${i}`, goodsPrice: 20 + i * 10, pieceCount: 1 })).d;
  colis.push(c);
  await api(admin, 'POST', `/colis/${c.id}/assign`, { driverId: lid });
}
const rs = (await api(liv, 'GET', '/runsheets/driver/active')).d;
const N = rs?.runsheetNumber;
ok(rs && rs.packages.length >= 5, `tournée ${N} avec les colis`, String(rs?.packages?.length));
await api(admin, 'POST', `/runsheets/${N}/status`, { status: 'EN_COURS' });
for (const c of colis.slice(0, 3)) await api(liv, 'POST', `/colis/${c.id}/deliver`, { collectedAmount: Number(c.totalPrice) });
const soldeAvant = Number((await api(admin, 'GET', `/drivers/${lid}`)).d?.currentBalance ?? NaN);

console.log('2. Écran de validation');
let v = (await api(admin, 'GET', `/runsheets/${N}/validation`)).d;
const attenduLivres = colis.slice(0, 3).reduce((s, c) => s + Number(c.totalPrice), 0);
ok(v && v.validable && v.totaux.livres === 3, '3 livrés, tournée validable', JSON.stringify(v?.totaux));
ok(near(v?.totaux.totalColisLivres, attenduLivres) && near(v?.totaux.totalReglement, attenduLivres) && near(v?.totaux.recetteEspece, attenduLivres), `total des colis livrés = réglé = espèces = ${attenduLivres}`);
ok(v?.totaux.nonTraites >= 2 && v.driver.code && v.depositName, 'non traités, livreur et agence');
const tot = await api(admin, 'POST', `/runsheets/${N}/validation`, {});
ok(tot.s === 409 && /non traité/.test(tot.m ?? ''), 'validation refusée tant qu’il reste des colis non traités', `${tot.s} ${tot.m}`);

console.log('3. Scan Reporté / Retour définitif');
let sc = await api(admin, 'POST', `/runsheets/${N}/validation/scan`, { code: colis[3].barcode, mode: 'REPORTE' });
ok(sc.s === 200 && sc.d?.colis?.find((c) => c.id === colis[3].id)?.etat === 'REPORTE', 'colis scanné en « Reporté »', `${sc.s} ${sc.m}`);
sc = await api(admin, 'POST', `/runsheets/${N}/validation/scan`, { code: colis[4].trackingNumber, mode: 'RETOUR' });
ok(sc.s === 200 && sc.d?.colis?.find((c) => c.id === colis[4].id)?.etat === 'RETOUR', 'colis scanné en « Retour définitif »', `${sc.s} ${sc.m}`);
ok((await api(admin, 'POST', `/runsheets/${N}/validation/scan`, { code: colis[0].barcode, mode: 'REPORTE' })).s === 409, 'colis livré : refusé');
ok((await api(admin, 'POST', `/runsheets/${N}/validation/scan`, { code: 'INCONNU-999', mode: 'REPORTE' })).s === 404, 'code inconnu : 404');
ok((await api(admin, 'POST', `/runsheets/${N}/validation/scan`, { code: colis[4].barcode, mode: 'REPORTE' })).s === 409, 'retour définitif ne redevient pas reporté');
ok((await api(admin, 'POST', `/runsheets/${N}/validation/scan`, { code: colis[3].barcode, mode: 'REPORTE' })).s === 200, 'double scan reporté : sans erreur');

console.log('4. Correction d’un montant payé');
ok((await api(admin, 'PATCH', `/runsheets/${N}/validation/colis/${colis[1].id}`, { montant: 9999 })).s === 400, 'montant supérieur au prix : refusé');
const corr = await api(admin, 'PATCH', `/runsheets/${N}/validation/colis/${colis[1].id}`, { montant: Number(colis[1].totalPrice) - 5 });
ok(corr.s === 200 && near(corr.d?.totaux.ecart, 5) && near(corr.d?.colis?.find((c) => c.id === colis[1].id)?.ecart, 5), 'montant corrigé : écart de 5 DT signalé', JSON.stringify(corr.d?.totaux));
ok((await api(exp, 'GET', `/runsheets/${N}/validation`)).s === 403, 'expéditeur : 403');

console.log('5. Validation');
// Les autres colis éventuels de la tournée (données de démonstration) sont reportés.
v = (await api(admin, 'GET', `/runsheets/${N}/validation`)).d;
for (const c of v.colis.filter((x) => x.etat === 'NON_TRAITE')) await api(admin, 'POST', `/runsheets/${N}/validation/scan`, { code: c.barcode, mode: 'REPORTE' });
v = (await api(admin, 'GET', `/runsheets/${N}/validation`)).d;
const especes = v.totaux.recetteEspece;
const fin = await api(admin, 'POST', `/runsheets/${N}/validation`, { especesRemises: especes - 2, notes: 'QA 39' });
ok(fin.s === 200 && fin.d?.status === 'CLOTUREE_DEFICIT' && near(fin.d.totaux.deficit, 2), 'validée en déficit de 2 DT', `${fin.s} ${fin.m}`);
ok(fin.d?.validable === false && fin.d?.validatedBy, 'tournée en lecture seule, validée par l’utilisateur');
ok((await api(admin, 'POST', `/runsheets/${N}/validation`, {})).s === 409, 'deuxième validation refusée');
const actives = await api(admin, 'GET', '/runsheets?vue=actives');
ok(!actives.d.some((r) => r.runsheetNumber === N), 'retirée de la liste des tournées en cours');
ok((await api(admin, 'GET', '/runsheets?vue=historique')).d.some((r) => r.runsheetNumber === N && r.deficitAmount > 0), 'présente dans l’historique avec son déficit');
ok(actives.meta?.compteurs && actives.meta.compteurs.deficit >= 1, 'compteurs : non soldées (déficit)', JSON.stringify(actives.meta?.compteurs));
const pays = ((await api(admin, 'GET', '/payments?limit=300')).d ?? []).filter((p) => colis.slice(0, 3).some((c) => c.id === p.packageId));
ok(pays.filter((p) => p.status === 'VALIDE').length === 2 && pays.filter((p) => p.status === 'ECARTE').length === 1, 'encaissements : 2 validés, 1 en écart', JSON.stringify(pays.map((p) => p.status)));
const soldeApres = Number((await api(admin, 'GET', `/drivers/${lid}`)).d?.currentBalance ?? NaN);
ok(Number.isFinite(soldeAvant) ? soldeApres < soldeAvant : true, 'solde espèces du livreur diminué', `${soldeAvant} → ${soldeApres}`);
const rep = (await api(admin, 'GET', `/colis/${colis[3].id}`)).d;
ok(rep?.status === 'REPORTE' && !rep.currentRunsheetId, 'colis reporté libéré de la tournée');
const relu = (await api(admin, 'GET', `/runsheets/${N}/validation`)).d;
ok(relu?.colis?.find((c) => c.id === colis[3].id)?.etat === 'REPORTE' && relu.totaux.livres === 3, 'historique relu tel qu’à la validation');

console.log('6. Écrans');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 1000 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const txt = () => p.evaluate(() => document.body.innerText);
const attendre = async (re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await txt())) return true; await sleep(150); } return false; };
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);

// Une 2e tournée pour l'écran : Hamza (tournée de démonstration en cours).
await p.goto(W + '/runsheets', { waitUntil: 'networkidle2' });
ok(!!(await p.waitForSelector('[data-testid=compteurs-tournees]', { timeout: 8000 }).catch(() => null)), 'liste : compteurs (à valider, déficit, correctes, toutes)');
const boutonValider = await p.waitForSelector('[data-testid^=valider-RUN]', { timeout: 8000 }).catch(() => null);
ok(!!boutonValider, 'liste : bouton « Valider » sur une tournée en cours');
await p.screenshot({ path: `${SHOTS}/39-liste.png` });
const numero = boutonValider ? (await boutonValider.evaluate((n) => n.getAttribute('data-testid'))).replace('valider-', '') : '';
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => null), boutonValider?.click()]);
await sleep(1200);
ok(/\/validation$/.test(p.url()) && (await attendre(new RegExp(numero))), 'page de validation ouverte', p.url());
ok(await attendre(/Clôture[\s\S]*Recette \(calculée automatiquement\)/), 'sections Clôture et Recette');
const etatsGauche = await p.$$eval('[data-testid=table-colis-validation] tbody tr[data-testid]', (l) => l.map((n) => n.getAttribute('data-testid')));
const vueGauche = (await api(admin, 'GET', `/runsheets/${(p.url().match(/runsheets\/([^/]+)\/validation/) ?? [])[1]}/validation`)).d;
ok(vueGauche && etatsGauche.length === vueGauche.totaux.livres, 'tableau de gauche : uniquement les colis livrés', `${etatsGauche.length} / ${vueGauche?.totaux.livres}`);
const vueUi = (await api(admin, 'GET', `/runsheets/${numero}/validation`)).d;
if (vueUi.totaux.nonTraites > 0) {
  ok(await p.$eval('[data-testid=bouton-valider]', (n) => n.disabled), 'bouton Valider désactivé tant qu’il reste des non traités');
  const premier = vueUi.colis.find((c) => c.etat === 'NON_TRAITE');
  await p.type('[data-testid=scan-validation]', premier.barcode); await p.keyboard.press('Enter');
  ok(await attendre(new RegExp(`${premier.trackingNumber} : reporté`)), 'scan à l’écran : reporté');
  await sleep(500);
  ok(!!(await p.$(`[data-testid=liste-reportes] [data-testid="lateral-${premier.trackingNumber}"]`)), 'colis scanné : ajouté à la liste de droite (reportés / retours)');
  ok(!(await p.$(`[data-testid=table-colis-validation] [data-testid="ligne-${premier.trackingNumber}"]`)), 'colis scanné : absent du tableau de gauche');
  ok(!(await p.$(`[data-testid=liste-a-scanner] [data-testid="lateral-${premier.trackingNumber}"]`)), 'colis scanné : retiré des colis à scanner');
  if (vueUi.totaux.nonTraites > 1) {
    await p.click('[data-testid=traiter-tous]');
    await p.waitForFunction(() => !document.querySelector('[data-testid=traiter-tous]'), { timeout: 20000 }).catch(() => null);
  }
}
await p.screenshot({ path: `${SHOTS}/39-validation.png`, fullPage: true });
await p.click('[data-testid=bouton-valider]');
await p.waitForSelector('[data-testid=confirmer-validation]', { timeout: 5000 });
await p.click('[data-testid=confirmer-validation]');
ok(!!(await p.waitForSelector('[data-testid=bandeau-validee]', { timeout: 10000 }).catch(() => null)), 'validation à l’écran : bandeau « Tournée validée »');
await p.goto(W + '/runsheets', { waitUntil: 'networkidle2' }); await sleep(1200);
ok(!(await p.$(`[data-testid=valider-${numero}]`)), 'liste en cours : tournée retirée');
await p.click('[data-testid=onglet-historique]'); await sleep(1500);
ok(await attendre(new RegExp(numero)), 'onglet Historique : tournée présente');

console.log('7. Caisse : fiche d’encaissement');
await p.goto(W + '/caisse', { waitUntil: 'networkidle2' }); await sleep(1200);
const imp = await p.waitForSelector('[data-testid=caisse-imprimer]', { timeout: 8000 }).catch(() => null);
ok(!!imp, 'bouton d’impression sur la ligne du livreur');
await imp?.click();
ok(!!(await p.waitForSelector('[data-testid=fiche-encaissement]', { timeout: 5000 }).catch(() => null)), 'fiche ouverte');
await p.type('[data-testid=compte-0]', '2'); // 2 × 50
await p.type('[data-testid=compte-2]', '3'); // 3 × 10
await sleep(300);
ok(/130,000/.test(await p.$eval('[data-testid=fiche-total]', (n) => n.innerText)), 'total compté : 130 DT');
const opsTxt = await p.$eval('[data-testid=fiche-total-operations]', (n) => n.innerText);
const ops = Number(opsTxt.replace(/\s|DT/g, '').replace(',', '.'));
await p.type('[data-testid=fiche-fond]', '10'); await sleep(300);
const dec = await p.$eval('[data-testid=fiche-decalage]', (n) => n.innerText);
ok(near(Number(dec.replace(/\s|DT/g, '').replace(',', '.')), 130 - ops - 10), 'décalage = compté − opérations − fond', `${dec} (ops ${ops})`);
await p.screenshot({ path: `${SHOTS}/39-fiche.png` });
const popup = new Promise((r) => b.once('targetcreated', async (t) => r(await t.page())));
await p.click('[data-testid=fiche-imprimer]');
const fen = await Promise.race([popup, sleep(6000).then(() => null)]);
if (fen) {
  await sleep(800);
  const html = await fen.evaluate(() => document.body.innerText).catch(() => '');
  ok(/ENCAISSEMENT/.test(html) && /FOND DE CAISSE/.test(html) && /DÉCALAGE/.test(html), 'document imprimé : ENCAISSEMENT, fond de caisse, décalage');
  await fen.setViewport({ width: 900, height: 1200 }).catch(() => null);
  await fen.screenshot({ path: `${SHOTS}/39-fiche-imprimee.png` }).catch(() => null);
} else ok(false, 'fenêtre d’impression ouverte');
ok(!errs.length, 'aucune erreur JavaScript', errs.join(' | '));
await b.close();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
