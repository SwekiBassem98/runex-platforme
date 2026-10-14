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

console.log('\n9. Bons de retour expéditeur');
const groupes = (await api(admin, 'GET', '/retours-expediteur/a-rendre')).data ?? [];
const g = groupes.find((x) => x.shipperId === shipperId);
ok(g?.colis?.some((c) => c.id === a2.id), 'le retour automatique est « à rendre »');
const bon = await api(admin, 'POST', '/retours-expediteur/bons', { shipperId });
ok(bon.status === 201 && !bon.data?.handoverCode && bon.data?.colis?.some((c) => c.id === a2.id), 'bon préparé (code non exposé au staff)', `${bon.status} ${bon.message}`);
ok((await api(admin, 'POST', '/retours-expediteur/bons', { shipperId })).status === 409, 'pas deux bons pour les mêmes colis');
const codeBon = (await api(exp, 'GET', '/retours-expediteur/bons')).data?.find((b) => b.id === bon.data?.id)?.handoverCode;
ok(/^\d{6}$/.test(codeBon ?? ''), 'l’expéditeur voit le code du bon');
ok((await api(admin, 'POST', `/retours-expediteur/bons/${bon.data?.id}/remettre`, { code: codeBon === '000000' ? '111111' : '000000' })).status === 400, 'mauvais code refusé');
const rem = await api(admin, 'POST', `/retours-expediteur/bons/${bon.data?.id}/remettre`, { code: codeBon, receiverName: 'Karim' });
ok(rem.status === 200 && rem.data?.status === 'REMIS', 'remise confirmée par le code', `${rem.status} ${rem.message}`);
ok((await pkg(a2.id))?.status === 'RETOURNE_EXPEDITEUR', 'colis restitué à l’expéditeur');
ok((await api(exp, 'GET', `/retours-expediteur/bons/${bon.data?.id}`)).status === 200, 'l’expéditeur consulte son bon');
ok((await api(exp, 'GET', '/retours-expediteur/a-rendre')).status === 403, '« à rendre » réservé à l’exploitation');

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
