/**
 * QA 38 — tarif par expéditeur et page Finance.
 *
 *   1. Dossier expéditeur : prix par type de colis (légère, normale, lourde,
 *      volumineuse), frais de retour, frais de gestion, R.A.S. 3 %.
 *   2. Création de colis : frais du type choisi ajoutés au prix ; changement
 *      de type → nouveau tarif.
 *   3. Paiement : net = encaissé − livraison − retours − gestion, R.A.S. sur le
 *      net ; bordereau, paiement avec le code.
 *   4. Finance : recherche d'un expéditeur, fiche, cloisonnement.
 *   5. Écrans : formulaire du dossier (section tarif, exemple), page Finance.
 *
 *   PUPPETEER_CORE=…/puppeteer-core.js CHROME=…/chrome node qa/qa-tarifs-finance-38.mjs
 * API sur :4000, web sur :3000 (build de production), base de démonstration.
 */
const API = process.env.QA_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const W = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? '/tmp';
let pass = 0, fail = 0;
const ok = (c, l, d = '') => { if (c) { pass++; console.log('  ✔', l); } else { fail++; console.log('  ✘', l, d); } return c; };
async function api(token, method, path, body) {
  const h = { Accept: 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* vide */ }
  return { status: r.status, data: j?.data, message: j?.message };
}
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data?.accessToken;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001;
const r3 = (n) => Math.round(n * 1000) / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sfx = Date.now().toString(36).slice(-5).toUpperCase();

const admin = await login('admin@logixpress.tn', 'Admin123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const meH = (await api(hamza, 'GET', '/auth/me')).data;
const hamzaId = meH.driverId ?? meH.driver?.id;

console.log('1. Dossier expéditeur avec tarif');
const TARIF = { livraison: { LEGERE: 6, MOYENNE: 8, LOURDE: 12.5, VOLUMINEUSE: 18 }, retour: 4, gestion: 2, rasActive: true, tauxRas: 3 };
const emailCompte = `tarif.${sfx.toLowerCase()}@test.tn`;
const cree = await api(admin, 'POST', '/shippers', {
  code: `EXP-T${sfx}`, companyName: `Tarif ${sfx} SARL`, phone: '22333444', email: `dossier.${sfx.toLowerCase()}@test.tn`,
  governorate: 'Ben Arous', address: 'Rue des tests', tarif: TARIF,
  compte: { fullName: `Contact ${sfx}`, email: emailCompte, phone: '22333444', password: 'Tarif123!', role: 'EXPEDITEUR_ADMIN' },
});
ok(cree.status === 201 || cree.status === 200, 'dossier créé', `${cree.status} ${cree.message}`);
const sid = cree.data?.id;
const t = cree.data?.tarif;
ok(t && near(t.livraison.LEGERE, 6) && near(t.livraison.MOYENNE, 8) && near(t.livraison.LOURDE, 12.5) && near(t.livraison.VOLUMINEUSE, 18), 'prix par type enregistrés', JSON.stringify(t?.livraison));
ok(t && near(t.retour, 4) && near(t.gestion, 2) && t.rasActive && near(t.tauxRas, 3), 'retour 4 DT, gestion 2 DT, R.A.S. 3 %', JSON.stringify(t));
const mauvais = await api(admin, 'POST', '/shippers', { code: `EXP-X${sfx}`, companyName: 'X', phone: '1', email: `x${sfx.toLowerCase()}@t.tn`, governorate: 'Tunis', address: 'x', tarif: { livraison: { LEGERE: -1 } } });
ok(mauvais.status === 400 && /léger/i.test(mauvais.message ?? ''), 'montant négatif refusé', `${mauvais.status} ${mauvais.message}`);
ok(near((await api(admin, 'GET', `/shippers/${sid}`)).data?.tarif?.livraison?.LOURDE, 12.5), 'tarif relu sur la fiche');

console.log('2. Colis : frais selon le type');
const exp = await login(emailCompte, 'Tarif123!');
ok(!!exp, 'connexion du compte expéditeur');
const ag = (await api(exp, 'GET', '/colis/agences-livraison?governorate=Ben%20Arous')).data;
ok(ag && near(ag.tarifs?.LEGERE, 6) && near(ag.tarifs?.VOLUMINEUSE, 18) && near(ag.deliveryFee, 8), 'formulaire : tarifs par type renvoyés', JSON.stringify(ag?.tarifs));
let k = 0;
const colis = async (taille, prix = 50) => {
  k++;
  const r = await api(exp, 'POST', '/colis', { customerName: `Client T${k}`, customerPhone: `9844${String(1000 + k)}`, governorate: 'Ben Arous', delegation: 'Rades', address: `Rue ${k}`, goodsPrice: prix, pieceCount: 1, sizeCategory: taille });
  if (r.status !== 201) console.log('   création', r.status, r.message);
  return r.data;
};
const attendu = { LEGERE: 6, MOYENNE: 8, LOURDE: 12.5, VOLUMINEUSE: 18 };
const crees = {};
for (const taille of Object.keys(attendu)) {
  const c = await colis(taille);
  crees[taille] = c;
  ok(near(c?.deliveryFee, attendu[taille]) && near(c?.totalPrice, 50 + attendu[taille]), `${taille} : ${attendu[taille]} DT ajoutés (total ${50 + attendu[taille]})`, JSON.stringify([c?.deliveryFee, c?.totalPrice]));
}
const sansType = (await api(exp, 'POST', '/colis', { customerName: 'Sans type', customerPhone: '98449999', governorate: 'Ben Arous', delegation: 'Rades', address: 'Rue', goodsPrice: 10, pieceCount: 1 })).data;
ok(near(sansType?.deliveryFee, 8), 'sans type : tarif « normale »', String(sansType?.deliveryFee));
const maj = await api(exp, 'PUT', `/colis/${crees.LEGERE.id}`, { sizeCategory: 'LOURDE' });
ok(maj.status === 200 && near(maj.data?.deliveryFee ?? maj.data?.package?.deliveryFee, 12.5) && near(maj.data?.totalPrice ?? maj.data?.package?.totalPrice, 62.5), 'type changé (légère → lourde) : 12,5 DT, total 62,5', JSON.stringify([maj.status, maj.data?.deliveryFee, maj.data?.totalPrice, maj.message]));

console.log('3. Paiement : déductions et R.A.S. sur le net');
// Deux colis livrés : MOYENNE (58) et VOLUMINEUSE (68).
for (const c of [crees.MOYENNE, crees.VOLUMINEUSE]) {
  const a = await api(admin, 'POST', `/colis/${c.id}/assign`, { driverId: hamzaId });
  ok(a.status === 200, `colis ${c.trackingNumber} affecté`, `${a.status} ${a.message}`);
  const d = await api(hamza, 'POST', `/colis/${c.id}/deliver`, { collectedAmount: Number(c.totalPrice) });
  ok(d.status === 200, 'livré', `${d.status} ${d.message}`);
}
const pays = (await api(admin, 'GET', '/payments?status=EN_ATTENTE&limit=200')).data ?? [];
for (const p of pays.filter((x) => [crees.MOYENNE.id, crees.VOLUMINEUSE.id].includes(x.packageId))) {
  await api(admin, 'POST', `/payments/${p.id}/validate`, {});
}
// Un retour : 3 reports → retour au dépôt → bon de retour remis.
const cr = crees.LOURDE;
await api(admin, 'POST', `/colis/${cr.id}/assign`, { driverId: hamzaId });
for (let i = 1; i <= 3; i++) {
  const st = (await api(admin, 'GET', `/colis/${cr.id}`)).data?.status;
  if (st === 'REPORTE') await api(hamza, 'POST', `/colis/${cr.id}/start`, {});
  await api(hamza, 'POST', `/colis/${cr.id}/postpone`, { reason: `Absent ${i}` });
}
const bon = await api(admin, 'POST', '/retours-expediteur/bons', { shipperId: sid, driverId: hamzaId, plannedDate: new Date().toISOString().slice(0, 10) });
const bonId = bon.data?.id;
await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/scan`, { code: (await api(admin, 'GET', `/colis/${cr.id}`)).data?.barcode, mode: 'ajouter' });
await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/etat`, { status: 'EN_COURS' });
await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/etat`, { status: 'REMIS', receiverName: 'Contact' });
ok((await api(admin, 'GET', `/colis/${cr.id}`)).data?.status === 'RETOURNE_EXPEDITEUR', 'colis retourné à l’expéditeur');

const encaisse = 58 + 68;
const avantRas = r3(encaisse - 8 - 18 - 4 - 2);
const ras = r3(avantRas * 0.03);
const net = r3(avantRas - ras);
const cand = (await api(admin, 'GET', `/payments/vouchers/candidats?shipperId=${sid}`)).data?.[0];
ok(cand && cand.livres === 2 && cand.retournes === 1, 'à régler : 2 livrés, 1 retour', JSON.stringify(cand && [cand.livres, cand.retournes]));
ok(cand && near(cand.fraisRetour, 4) && near(cand.fraisGestion, 2) && near(cand.ras, ras) && near(cand.netEstime, net),
  `estimation : (126 − 26 − 4 − 2) × 97 % = ${net}`, JSON.stringify(cand));

console.log('4. Finance : recherche et fiche');
const f = await api(admin, 'GET', `/payments/finance/expediteurs?search=${encodeURIComponent(`Tarif ${sfx}`)}`);
ok(f.status === 200 && f.data?.items?.length === 1 && f.data.items[0].id === sid, 'recherche par nom : 1 résultat');
ok(near(f.data?.items?.[0]?.aRegler?.net, net), 'ligne : à régler = net estimé');
ok((await api(admin, 'GET', `/payments/finance/expediteurs?search=T${sfx}`)).data?.items?.some((i) => i.id === sid), 'recherche par code');
ok((await api(admin, 'GET', '/payments/finance/expediteurs?search=zzzz-inconnu')).data?.items?.length === 0, 'recherche sans résultat');
ok(f.data?.totals && typeof f.data.totals.toSettle === 'number', 'totaux globaux présents');
ok((await api(exp, 'GET', '/payments/finance/expediteurs')).status === 403, 'expéditeur : 403');

const vb = await api(admin, 'POST', '/payments/vouchers', { shipperId: sid });
ok(vb.status === 201, 'bordereau créé', `${vb.status} ${vb.message}`);
const v = vb.data;
ok(v && near(v.grossCashCollected, encaisse) && near(v.deliveryFeesTotal, 26) && near(v.returnFeesTotal, 4) && near(v.managementFeesTotal, 2), 'bordereau : encaissé 126, livraison 26, retour 4, gestion 2', JSON.stringify(v && [v.grossCashCollected, v.deliveryFeesTotal, v.returnFeesTotal, v.managementFeesTotal]));
ok(v && near(v.withholdingTaxTotal, ras) && near(v.withholdingTaxRate, 0.03) && near(v.netPayable, net), `bordereau : R.A.S. ${ras}, net ${net}`, JSON.stringify(v && [v.withholdingTaxTotal, v.netPayable]));
ok(near((await api(admin, 'GET', `/payments/vouchers/${v.id}`)).data?.colis?.find((c) => c.id === cr.id)?.returnFee, 4), 'frais de retour figés sur le colis du bordereau');
const fiche = await api(admin, 'GET', `/payments/finance/expediteurs/${sid}`);
ok(fiche.status === 200 && fiche.data?.aRegler === null && fiche.data?.aPayer?.count === 1 && near(fiche.data.aPayer.net, net), 'fiche : à payer = bordereau');
ok(fiche.data?.vouchers?.[0]?.voucherNumber === v.voucherNumber && fiche.data.monthly.length === 6, 'fiche : historique et 6 mois');
const code = (await api(exp, 'GET', '/payments/vouchers')).data?.find((x) => x.id === v.id)?.withdrawalCode;
const pv = await api(admin, 'POST', `/payments/vouchers/${v.voucherNumber}/validate`, { secretCode: code });
ok(pv.status === 200, 'bordereau payé avec le code', `${pv.status} ${pv.message}`);
const apres = (await api(admin, 'GET', `/payments/finance/expediteurs/${sid}`)).data;
ok(apres?.paye?.count === 1 && near(apres.paye.net, net) && apres.aPayer.count === 0, 'fiche : payé');
ok(near(apres?.monthly?.[5]?.paid, net), 'mois en cours : montant payé');

const modif = await api(admin, 'PATCH', `/shippers/${sid}`, { tarif: { livraison: { MOYENNE: 9 }, rasActive: false } });
ok(modif.status === 200 && near(modif.data?.tarif?.livraison?.MOYENNE, 9) && modif.data.tarif.rasActive === false && near(modif.data.tarif.livraison.LEGERE, 6), 'modification du tarif (normale 9 DT, sans R.A.S.)', JSON.stringify(modif.data?.tarif));
ok(near((await colis('MOYENNE', 20))?.deliveryFee, 9), 'nouveau colis : nouveau tarif');

console.log('5. Écrans');
const puppeteer = (await import(process.env.PUPPETEER_CORE)).default;
const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const txt = () => p.evaluate(() => document.body.innerText);
const attendre = async (re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await txt())) return true; await sleep(150); } return false; };
await p.goto(W + '/connexion', { waitUntil: 'networkidle2' });
await p.type('input[type=email]', 'admin@logixpress.tn'); await p.type('input[type=password]', 'Admin123!');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.keyboard.press('Enter')]);

await p.goto(W + '/admin/expediteurs', { waitUntil: 'networkidle2' }); await sleep(800);
const boutons = await p.$$('button');
for (const bt of boutons) { if (/Nouvel expéditeur|Ajouter|Nouveau/.test(await bt.evaluate((n) => n.innerText))) { await bt.click(); break; } }
ok(!!(await p.waitForSelector('[data-testid=section-tarif]', { timeout: 5000 }).catch(() => null)), 'formulaire : section « Prix de livraison par type de colis »');
const remplir = async (sel, val) => { await p.click(sel, { clickCount: 3 }); await p.keyboard.press('Backspace'); await p.type(sel, val); };
await remplir('[data-testid=tarif-MOYENNE]', '10');
await remplir('[data-testid=tarif-retour]', '5');
await remplir('[data-testid=tarif-gestion]', '3');
await p.click('[data-testid=tarif-ras-active]');
await sleep(300);
// 10 colis normaux : 600 encaissés − 100 − 5 − 3 = 492 ; R.A.S. 3 % = 14,76 → 477,24.
const netEx = await p.$eval('[data-testid=tarif-exemple-net]', (n) => n.innerText);
ok(/477,240/.test(netEx), 'exemple recalculé : net 477,240 DT', netEx);
await p.screenshot({ path: `${SHOTS}/38-formulaire-tarif.png` });
await p.keyboard.press('Escape');

await p.goto(W + '/finance', { waitUntil: 'networkidle2' });
ok(await attendre(/Paiements des expéditeurs/), 'Finance : titre');
ok(await attendre(/À régler[\s\S]*Bordereaux à payer[\s\S]*Payé ce mois[\s\S]*Retenu ce mois/), 'Finance : 4 chiffres');
await p.type('[data-testid=recherche-expediteur]', `Tarif ${sfx}`);
await sleep(1500);
const nb = (await p.$$('[data-testid=liste-expediteurs] li')).length;
ok(nb === 1, 'recherche : un seul expéditeur', String(nb));
await p.click(`[data-testid="ligne-EXP-T${sfx}"]`);
ok(!!(await p.waitForSelector('[data-testid=fiche-finance]', { timeout: 5000 }).catch(() => null)), 'fiche ouverte');
ok(await attendre(new RegExp(v.voucherNumber)), 'fiche : bordereau listé');
ok(await attendre(/Gestion : [\s\S]*paiement/), 'fiche : tarif affiché');
await p.screenshot({ path: `${SHOTS}/38-finance-fiche.png` });
await p.keyboard.press('Escape'); await sleep(300);
await p.click('[data-testid=recherche-expediteur]', { clickCount: 3 }); await p.keyboard.press('Backspace');
await p.type('[data-testid=recherche-expediteur]', 'zzzz-inconnu'); await sleep(1500);
ok(!!(await p.$('[data-testid=aucun-expediteur]')), 'recherche vide : message');
await p.setViewport({ width: 390, height: 844 }); await sleep(600);
ok((await p.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'téléphone : pas de défilement horizontal');
ok(!errs.length, 'aucune erreur JavaScript', errs.join(' | '));
await b.close();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
