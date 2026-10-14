#!/usr/bin/env node
/**
 * QA 33 — retours client du 14/10 : agences, inter-dépôt depuis le hub, 8 DT de
 * livraison, agence de sortie, filtres, affectation → tournée visible du
 * livreur, ajout/retrait en tournée en cours, 3 tentatives → retour auto,
 * changement de prix soumis à approbation, bons de retour avec code,
 * bordereaux avec code de retrait, caisse et gains livreur (3 DT).
 *
 *   QA_API_URL=http://localhost:4000/api/v1 node qa/qa-retours-client-33.mjs   (base seedée fraîche)
 */
const API = (process.env.QA_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
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
  return { status: r.status, data: j?.data, json: j, message: j?.message };
}
const login = async (e, p) => (await api(null, 'POST', '/auth/login', { identifier: e, password: p })).data.accessToken;
const enc = encodeURIComponent;
const sfx = Date.now().toString(36).slice(-5);
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001;

const admin = await login('admin@logixpress.tn', 'Admin123!');
const exp = await login('expediteur@bluestar.tn', 'Exp123!');
const hamza = await login('livreur.hamza@logixpress.tn', 'Liv123!');
const meH = (await api(hamza, 'GET', '/auth/me')).data;
const hamzaId = meH.driverId ?? meH.driver?.id;
const hamzaCode = (await api(hamza, 'GET', '/drivers/me')).data?.driverCode;
const pkg = async (id) => (await api(admin, 'GET', `/colis/${id}`)).data;
let n = 0;
const nouveau = async (extra = {}) => {
  n++;
  const r = await api(exp, 'POST', '/colis', {
    customerName: `Client ${sfx} ${n}`, customerPhone: `97${String(100000 + n).slice(-6)}`, governorate: 'Ben Arous',
    delegation: 'Rades', address: `Rue ${n}`, goodsPrice: 20, pieceCount: 1, ...extra,
  });
  if (r.status !== 201) console.log('    création', r.status, r.message);
  return r.data;
};

console.log('\n1. Agences et inter-dépôt');
const ag = (await api(exp, 'GET', '/colis/agences-livraison?governorate=Gafsa')).data;
const noms = (ag?.agences ?? []).map((a) => a.name);
for (const nom of ['Agence Gafsa', 'Agence Médenine', 'Agence Sfax', 'Agence Sousse', 'Agence Siliana', 'Agence Nabeul', 'Agence Tunis']) {
  ok(noms.includes(nom), `agence « ${nom} » présente`);
}
ok(noms.includes('Hub Central Ben Arous'), 'hub renommé « Hub Central Ben Arous »');
ok(ag?.agences?.find((a) => a.id === ag.suggestion)?.name === 'Agence Gafsa', 'Gafsa → Agence Gafsa proposée');
const sug = async (g) => (await api(exp, 'GET', `/colis/agences-livraison?governorate=${enc(g)}`)).data;
const nomDe = (r) => r?.agences?.find((a) => a.id === r.suggestion)?.name;
ok(nomDe(await sug('Kasserine')) === 'Agence Gafsa', 'Kasserine → Agence Gafsa (carte régionale)');
ok(nomDe(await sug('Bizerte')) === 'Agence Tunis', 'Bizerte → Agence Tunis');
ok(nomDe(await sug('Gabès')) === 'Agence Médenine', 'Gabès → Agence Médenine');
ok(near(ag?.deliveryFee, 8), 'frais de livraison par défaut : 8 DT', String(ag?.deliveryFee));
const opts = (await api(admin, 'GET', '/inter-depots/form-options')).data;
const hub = opts?.deposits?.find((d) => d.isMainHub);
const sfax = opts?.deposits?.find((d) => d.name === 'Agence Sfax');
const transporteur = (opts?.drivers ?? opts?.transporters ?? [])[0];
const id1 = await api(admin, 'POST', '/inter-depots', { type: 'LIVRAISON', destinationDepositId: sfax?.id, transporterDriverId: transporteur?.id });
ok(id1.status === 201 && (id1.data?.sourceDepositId === hub?.id || id1.data?.sourceDepositName === hub?.name), 'inter-dépôt sans agence de départ → depuis le hub', `${id1.status} ${id1.message ?? ''} ${id1.data?.sourceDepositName ?? ''}`);

console.log('\n2. Création : prix + 8 DT, agence de sortie');
const c1 = await nouveau({ goodsPrice: 50, governorate: 'Sfax', delegation: 'Sfax Ville' });
ok(near(c1?.goodsPrice, 50) && near(c1?.deliveryFee, 8) && near(c1?.totalPrice, 58), 'prix 50 → à encaisser 58 (8 DT ajoutés)', JSON.stringify([c1?.goodsPrice, c1?.deliveryFee, c1?.totalPrice]));
ok(c1?.destinationDepositName === 'Agence Sfax', 'Sfax → agence de sortie Agence Sfax', c1?.destinationDepositName);
const sousse = opts?.deposits?.find((d) => d.name === 'Agence Sousse');
const c2 = await nouveau({ governorate: 'Sfax', delegation: 'Sakiet', destinationDepositId: sousse?.id });
ok(c2?.destinationDepositName === 'Agence Sousse', 'agence de sortie choisie respectée', c2?.destinationDepositName);
const bad = await api(exp, 'POST', '/colis', { customerName: 'X', customerPhone: '97000001', governorate: 'Sfax', delegation: 'S', address: 'r', goodsPrice: 5, pieceCount: 1, destinationDepositId: '00000000-0000-0000-0000-000000000000' });
ok(bad.status === 400, 'agence de sortie inconnue refusée', String(bad.status));
const legacy = await nouveau({ goodsPrice: undefined, totalPrice: 40 });
ok(near(legacy?.totalPrice, 40) && near(legacy?.goodsPrice, 32), 'ancien champ totalPrice : total 40, prix 32', JSON.stringify([legacy?.totalPrice, legacy?.goodsPrice]));

// Bon de livraison : départ et sortie tels qu'indiqués à la saisie.
const agTunis = opts?.deposits?.find((d) => d.name === 'Agence Tunis');
const agNabeul = opts?.deposits?.find((d) => d.name === 'Agence Nabeul');
const sugD = (await api(exp, 'GET', '/colis/agences-livraison?governorate=Sfax')).data?.suggestionDepart;
ok(!!sugD, 'agence de départ proposée (celle de l’expéditeur)', String(sugD));
const cR = await nouveau({ governorate: 'Sfax', delegation: 'Hancha', originDepositId: agNabeul?.id, destinationDepositId: sfax?.id });
const bl = (await api(exp, 'GET', `/colis/${cR?.id}/bon-livraison`)).data;
ok(bl?.originAgency === 'Agence Nabeul' && bl?.destinationAgency === 'Agence Sfax' && bl?.governorate === 'Sfax' && bl?.delegation === 'Hancha',
  'bon de livraison : Agence Nabeul => Agence Sfax => Sfax/Hancha', JSON.stringify([bl?.originAgency, bl?.destinationAgency, bl?.governorate, bl?.delegation]));
const badO = await api(exp, 'POST', '/colis', { customerName: 'X', customerPhone: '97000002', governorate: 'Sfax', delegation: 'S', address: 'r', goodsPrice: 5, pieceCount: 1, originDepositId: 'pas-un-id' });
ok(badO.status === 400 && /départ/.test(badO.message ?? ''), 'agence de départ invalide refusée', `${badO.status} ${badO.message}`);
// Changement d'adresse : l'agence de sortie choisie est conservée.
const cS = await nouveau({ governorate: 'Sfax', delegation: 'Hancha', destinationDepositId: agTunis?.id });
await api(exp, 'PUT', `/colis/${cS?.id}`, { governorate: 'Sousse', delegation: 'Sahloul' });
ok((await pkg(cS.id))?.destinationDepositName === 'Agence Tunis', 'adresse modifiée : agence de sortie choisie conservée', (await pkg(cS.id))?.destinationDepositName);
const cT = await nouveau({ governorate: 'Sfax', delegation: 'Hancha' });
await api(exp, 'PUT', `/colis/${cT?.id}`, { governorate: 'Sousse', delegation: 'Sahloul' });
ok((await pkg(cT.id))?.destinationDepositName === 'Agence Sousse', 'adresse modifiée : agence déduite suit la nouvelle adresse', (await pkg(cT.id))?.destinationDepositName);

console.log('\n3. Filtres de gestion des colis');
const shipperId = c1?.shipperId;
const fs = await api(admin, 'GET', `/colis?shipper=${shipperId}&limit=100`);
ok(fs.status === 200 && fs.data.length > 0 && fs.data.every((p) => p.shipperId === shipperId), 'filtre expéditeur');
const fv = await api(admin, 'GET', '/colis?city=sfax&limit=100');
ok(fv.status === 200 && fv.data.some((p) => p.id === c1.id), 'filtre ville insensible à la casse');
for (const ps of ['NON_REGLE', 'EN_BORDEREAU', 'PAYE']) ok((await api(admin, 'GET', `/colis?paymentStatus=${ps}`)).status === 200, `filtre règlement ${ps}`);
ok((await api(admin, 'GET', '/colis?type=nimporte')).status === 200, 'type inconnu : pas d’erreur');

console.log('\n4. Affectation sans tournée → visible dans l’application');
const a1 = await nouveau();
const asg = await api(admin, 'POST', `/colis/${a1.id}/assign`, { driverId: hamzaId });
ok(asg.status === 200, 'colis affecté au livreur', `${asg.status} ${asg.message}`);
let active = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
ok(active?.packages?.some((p) => p.id === a1.id), 'la tournée active du livreur contient le colis', active?.runsheetNumber);
const rsNum = active?.runsheetNumber;
const a2 = await nouveau({ goodsPrice: 30 });
await api(admin, 'POST', `/colis/${a2.id}/assign`, { driverId: hamzaId });
active = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
ok(active?.runsheetNumber === rsNum && active.packages.some((p) => p.id === a2.id), '2e affectation : même tournée');
// La base de démonstration peut déjà avoir une tournée en cours pour ce
// livreur : l'affectation l'y place (priorité à la tournée en cours).
if (active?.status !== 'EN_COURS') {
  const go = await api(admin, 'POST', `/runsheets/${rsNum}/status`, { status: 'EN_COURS' });
  ok(go.status === 200 && go.data?.status === 'EN_COURS', 'départ de la tournée', `${go.status} ${go.message}`);
} else {
  ok(true, 'tournée déjà en cours : le colis y a été ajouté');
}

console.log('\n5. Ajout / retrait dans une tournée en cours');
const a3 = await nouveau({ goodsPrice: 15 });
const add = await api(admin, 'POST', `/runsheets/${rsNum}/add-package`, { packageIdentifier: a3.trackingNumber });
ok(add.status === 200, 'ajout dans la tournée en cours', `${add.status} ${add.message}`);
ok((await pkg(a3.id))?.status === 'AFFECTE_RUNSHEET', 'colis ajouté : dans la tournée (le livreur le démarre)');
ok((await api(hamza, 'GET', '/runsheets/driver/active')).data?.packages?.some((p) => p.id === a3.id), 'le livreur voit le colis ajouté');
const a4 = await nouveau();
await api(admin, 'POST', `/colis/${a4.id}/assign`, { driverId: hamzaId });
active = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
ok(active?.runsheetNumber === rsNum && active.packages.some((p) => p.id === a4.id), 'affectation pendant la tournée : rejoint la tournée en cours');
const dem4 = await api(hamza, 'POST', `/colis/${a4.id}/start`, {});
ok(dem4.status === 200 && dem4.data?.status === 'EN_COURS_LIVRAISON', 'le livreur démarre le colis ajouté', `${dem4.status} ${dem4.message}`);
const rm = await api(admin, 'POST', `/runsheets/${rsNum}/remove-package`, { packageIdentifier: a4.trackingNumber });
ok(rm.status === 200, 'retrait d’un colis en route', `${rm.status} ${rm.message}`);
const a4b = await pkg(a4.id);
ok(a4b?.status === 'RECU_DEPOT' && !a4b?.assignedDriverId, 'colis retiré : au dépôt, sans livreur', a4b?.status);
active = (await api(hamza, 'GET', '/runsheets/driver/active')).data;
ok(!active?.packages?.some((p) => p.id === a4.id), 'le livreur ne le voit plus');

console.log('\n6. 3 tentatives → retour automatique');
let st;
for (let i = 1; i <= 3; i++) {
  if ((await pkg(a2.id))?.status === 'REPORTE') await api(hamza, 'POST', `/colis/${a2.id}/start`, {});
  const p = await api(hamza, 'POST', `/colis/${a2.id}/postpone`, { reason: `Client absent ${i}` });
  st = p.data?.status;
  ok(p.status === 200, `report n°${i} accepté`, `${p.status} ${p.message}`);
}
ok(st === 'RETOUR_DEPOT', '3e report : colis retourné automatiquement', st);

console.log('\n7. Changement de prix soumis à l’approbation');
const u = await api(exp, 'PUT', `/colis/${a3.id}`, { goodsPrice: 25, priceChangeReason: 'erreur' });
ok(u.status === 200 && near(u.data?.totalPrice, 23) && near(u.data?.pendingPriceChange?.newGoodsPrice, 25), 'expéditeur : prix inchangé, demande en attente', JSON.stringify([u.status, u.data?.totalPrice, u.data?.pendingPriceChange]));
const dem = (await api(admin, 'GET', `/colis/demandes-prix?status=EN_ATTENTE&packageId=${a3.id}`)).data?.[0];
ok(!!dem && near(dem.newTotal, 33), 'demande visible de l’administration', JSON.stringify(dem));
ok((await api(exp, 'POST', `/colis/demandes-prix/${dem?.id}/approuver`, {})).status === 403, 'l’expéditeur ne peut pas approuver');
const rsAvant = (await api(admin, 'GET', `/runsheets/${rsNum}`)).data?.expectedCash;
const ap = await api(admin, 'POST', `/colis/demandes-prix/${dem?.id}/approuver`, {});
ok(ap.status === 200, 'approbation', `${ap.status} ${ap.message}`);
const a3b = await pkg(a3.id);
ok(near(a3b?.goodsPrice, 25) && near(a3b?.totalPrice, 33) && !a3b?.pendingPriceChange, 'nouveau prix appliqué (25 + 8 = 33)');
const rsApres = (await api(admin, 'GET', `/runsheets/${rsNum}`)).data?.expectedCash;
ok(near(Number(rsApres) - Number(rsAvant), 10), 'attendu de la tournée +10 DT', `${rsAvant} → ${rsApres}`);
const u2 = await api(exp, 'PUT', `/colis/${a1.id}`, { goodsPrice: 99 });
const dem2 = (await api(admin, 'GET', `/colis/demandes-prix?status=EN_ATTENTE&packageId=${a1.id}`)).data?.[0];
const rf = await api(admin, 'POST', `/colis/demandes-prix/${dem2?.id}/refuser`, { note: 'non' });
ok(u2.status === 200 && rf.status === 200 && near((await pkg(a1.id))?.goodsPrice, 20), 'refus : prix inchangé');

console.log('\n8. Livraison, encaissement, bordereau avec code');
const dl = await api(hamza, 'POST', `/colis/${a1.id}/deliver`, { collectedAmount: 28 });
ok(dl.status === 200 && dl.data?.status === 'LIVRE', 'livraison', `${dl.status} ${dl.message}`);
const dl3 = await api(hamza, 'POST', `/colis/${a3.id}/deliver`, { collectedAmount: 33 });
ok(dl3.status === 200, 'livraison 2');
let cand = (await api(admin, 'GET', '/payments/vouchers/candidats')).data?.find((c) => c.shipperId === shipperId);
const avant = cand?.livres ?? 0;
const pays = (await api(admin, 'GET', '/payments?status=EN_ATTENTE&limit=100')).data ?? [];
for (const p of pays.filter((x) => [a1.id, a3.id].includes(x.packageId))) {
  const v = await api(admin, 'POST', `/payments/${p.id}/validate`, {});
  ok(v.status === 200, `encaissement ${p.paymentNumber ?? ''} validé`, `${v.status} ${v.message}`);
}
cand = (await api(admin, 'GET', '/payments/vouchers/candidats')).data?.find((c) => c.shipperId === shipperId);
ok((cand?.livres ?? 0) >= avant + 2, 'colis validés : éligibles au bordereau', `${avant} → ${cand?.livres}`);
const vb = await api(admin, 'POST', '/payments/vouchers', { shipperId });
ok(vb.status === 201 && !vb.data?.withdrawalCode, 'bordereau créé, code non exposé au staff', `${vb.status} ${vb.message}`);
const code = (await api(exp, 'GET', '/payments/vouchers')).data?.find((v) => v.id === vb.data?.id)?.withdrawalCode;
ok(/^\d{6}$/.test(code ?? ''), 'l’expéditeur voit le code de retrait (6 chiffres)');
ok((await api(admin, 'POST', `/payments/vouchers/${vb.data?.voucherNumber}/validate`, { secretCode: code === '000000' ? '111111' : '000000' })).status === 400, 'mauvais code refusé');
const pv = await api(admin, 'POST', `/payments/vouchers/${vb.data?.voucherNumber}/validate`, { secretCode: code });
ok(pv.status === 200, 'paiement avec le code de l’expéditeur', `${pv.status} ${pv.json?.message}`);
ok(!(await api(exp, 'GET', '/payments/vouchers')).data?.find((v) => v.id === vb.data?.id)?.withdrawalCode, 'code masqué une fois payé');

console.log('\n9. Bons de retour expéditeur (comme ADEX)');
// Un échange : l'article repris revient aussi à l'expéditeur par le bon.
const ex = await nouveau({ goodsPrice: 12, packageType: 'EXCHANGE' });
await api(admin, 'POST', `/colis/${ex.id}/assign`, { driverId: hamzaId });
const exr = await api(hamza, 'POST', `/colis/${ex.id}/exchange`, { oldPackageBarcode: `OLD-${sfx}`, returnedItemSummary: 'Pull noir', newPackageBarcode: ex.barcode });
const exl = await api(hamza, 'POST', `/colis/${ex.id}/deliver`, {});
ok(exr.status === 200 && exl.data?.status === 'LIVRE', 'échange effectué et livré par le livreur', `${exr.status} ${exr.message} / ${exl.status} ${exl.message}`);
const resume = (await api(admin, 'GET', '/retours-expediteur/a-rendre')).data ?? [];
const g = resume.find((x) => x.shipperId === shipperId);
ok(g?.colis >= 1 && g?.echanges >= 1, 'à rendre : colis retournés et articles d’échange par expéditeur', JSON.stringify(g));
const bon = await api(admin, 'POST', '/retours-expediteur/bons', { shipperId });
const bonId = bon.data?.id;
ok(bon.status === 201 && bon.data?.status === 'PREPARE' && bon.data?.colisCount === 0, 'bon créé vide, en préparation', `${bon.status} ${bon.message}`);
ok(bon.data?.colisAuDepot?.some((c) => c.id === a2.id) && bon.data?.echangesAuDepot?.some((c) => c.barcode === `OLD-${sfx}`), 'la fiche liste les colis et échanges au dépôt de l’expéditeur');
let lance = await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/etat`, { status: 'EN_COURS' });
ok(lance.status === 409, 'impossible de lancer sans livreur', lance.message);
const md = await api(admin, 'PATCH', `/retours-expediteur/bons/${bonId}`, { driverId: hamzaId, plannedDate: new Date().toISOString().slice(0, 10) });
ok(md.status === 200 && md.data?.driverId === hamzaId && !!md.data?.vehiclePlate, 'livreur choisi, matricule repris du livreur', `${md.status} ${md.data?.vehiclePlate}`);
lance = await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/etat`, { status: 'EN_COURS' });
ok(lance.status === 409, 'impossible de lancer un bon vide', lance.message);
let sc = await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/scan`, { code: (await pkg(a2.id)).barcode, mode: 'ajouter' });
ok(sc.status === 200 && sc.data?.colis?.some((c) => c.id === a2.id) && !sc.data?.colisAuDepot?.some((c) => c.id === a2.id), 'scan : colis ajouté (et retiré de la liste du dépôt)', `${sc.status} ${sc.message}`);
ok((await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/scan`, { code: (await pkg(a2.id)).trackingNumber, mode: 'ajouter' })).status === 409, 'scan en double refusé');
sc = await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/scan`, { code: `OLD-${sfx}`, mode: 'ajouter' });
ok(sc.status === 200 && sc.data?.colis?.some((c) => c.kind === 'ECHANGE'), 'scan : article d’échange ajouté', `${sc.status} ${sc.message}`);
const autre = await nouveau();
const refus = await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/scan`, { code: autre.barcode, mode: 'ajouter' });
ok(refus.status === 409 && /retourné au dépôt/.test(refus.message ?? ''), 'colis non retourné refusé, motif clair', refus.message);
ok((await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/scan`, { code: 'INCONNU-XYZ', mode: 'ajouter' })).status === 404, 'code inconnu → 404');
sc = await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/scan`, { code: `OLD-${sfx}`, mode: 'retirer' });
ok(sc.status === 200 && !sc.data?.colis?.some((c) => c.kind === 'ECHANGE'), 'mode retirer : article retiré du bon');
await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/scan`, { code: `OLD-${sfx}`, mode: 'ajouter' });
ok((await api(admin, 'POST', '/retours-expediteur/bons', { shipperId })).status === 201, 'un 2e bon peut être ouvert pour le même expéditeur');
const liste = (await api(admin, 'GET', `/retours-expediteur/bons?shipperId=${shipperId}&driverId=${hamzaId}`)).data ?? [];
const ligne = liste.find((b) => b.id === bonId);
ok(ligne?.colisCount === 2 && ligne?.driverName && ligne?.nextStatuses?.some((n) => n.status === 'EN_COURS'), 'liste : livreur, colis, états suivants', JSON.stringify(ligne && { c: ligne.colisCount, d: ligne.driverName }));
lance = await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/etat`, { status: 'EN_COURS' });
ok(lance.status === 200 && lance.data?.status === 'EN_COURS', 'lancer la livraison', `${lance.status} ${lance.message}`);
ok((await pkg(a2.id))?.status === 'EN_RUNSHEET_RETOUR', 'colis « en cours de restitution »');
ok((await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/scan`, { code: (await pkg(a2.id)).barcode, mode: 'retirer' })).status === 409, 'bon parti : plus modifiable');
const revenu = await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/etat`, { status: 'PREPARE' });
ok(revenu.status === 200 && (await pkg(a2.id))?.status === 'RETOUR_DEPOT', 'revenu au dépôt (non remis) : colis de nouveau au dépôt', `${revenu.status} ${revenu.message}`);
await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/etat`, { status: 'EN_COURS' });
const remis = await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/etat`, { status: 'REMIS', receiverName: 'Karim' });
ok(remis.status === 200 && remis.data?.status === 'REMIS', 'bon remis à l’expéditeur', `${remis.status} ${remis.message}`);
ok((await pkg(a2.id))?.status === 'RETOURNE_EXPEDITEUR', 'colis restitué à l’expéditeur');
ok(!((await api(admin, 'GET', '/retours-expediteur/a-rendre')).data ?? []).find((x) => x.shipperId === shipperId)?.echanges, 'article d’échange rendu : plus en attente');
ok((await api(admin, 'POST', `/retours-expediteur/bons/${bonId}/etat`, { status: 'ANNULE' })).status === 409, 'un bon remis ne s’annule plus');
const vue = await api(exp, 'GET', '/retours-expediteur/bons');
ok(vue.status === 200 && vue.data?.some((b) => b.id === bonId && b.status === 'REMIS' && b.handoverCode === undefined), 'l’expéditeur voit ses bons (sans code)');
ok((await api(exp, 'GET', '/retours-expediteur/a-rendre')).status === 403, '« à rendre » réservé à l’exploitation');
ok((await api(exp, 'POST', `/retours-expediteur/bons/${bonId}/etat`, { status: 'ANNULE' })).status === 403, 'l’expéditeur ne change pas l’état');

console.log('\n10. Caisse et gains livreur (3 DT)');
const gains = (await api(hamza, 'GET', '/drivers/me/gains')).data;
ok(gains?.tarif === 3 && gains.aujourdhui.livres >= 2 && near(gains.aujourdhui.gain, (gains.aujourdhui.livres + gains.aujourdhui.ramassages) * 3), 'gains du jour = 3 DT × (livrés + ramassages)', JSON.stringify(gains?.aujourdhui));
const res = (await api(admin, 'GET', '/caisse/resume')).data;
ok(res && res.colisLivres >= 2 && res.fraisLivraison > 0 && near(res.margeNette, res.fraisLivraison + res.fraisRetour - res.remunerationLivreurs), 'résumé de caisse cohérent', JSON.stringify(res));
const lignes = (await api(admin, 'GET', '/caisse/livreurs')).data ?? [];
const lh = lignes.find((l) => l.driverId === hamzaId);
ok(lh && lh.resteAPayer >= 6, 'ligne du livreur : reste à payer', JSON.stringify(lh));
ok((await api(exp, 'GET', '/caisse/resume')).status === 403, 'caisse refusée à l’expéditeur');
ok((await api(hamza, 'GET', '/caisse/livreurs')).status === 403, 'caisse refusée au livreur');
const trop = await api(admin, 'POST', `/caisse/livreurs/${hamzaId}/paiements`, { amount: (lh?.resteAPayer ?? 0) + 1 });
ok(trop.status === 409, 'payer plus que le reste : refusé', String(trop.status));
const pay = await api(admin, 'POST', `/caisse/livreurs/${hamzaId}/paiements`, {});
ok(pay.status === 201 && near(pay.data?.amount, lh?.resteAPayer) && near(pay.data?.resteAPayer, 0), 'paiement du reste', `${pay.status} ${pay.message}`);
const g2 = (await api(hamza, 'GET', '/drivers/me/gains')).data;
ok(near(g2?.resteAPayer, 0) && !!g2?.dernierPaiement, 'le livreur voit son paiement');
ok((await api(admin, 'GET', `/caisse/livreurs/${hamzaId}/paiements`)).data?.length >= 1, 'historique des paiements');
ok(hamzaCode && (await api(admin, 'GET', `/colis?driver=${hamzaCode}`)).data?.length > 0, 'filtre livreur par code');

console.log(`\n${pass} vérifications réussies, ${failures.length} échec(s).`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
