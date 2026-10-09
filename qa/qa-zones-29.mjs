/**
 * QA 29 — zones de livraison : création automatique à la saisie d'un colis,
 * déduplication, concurrence, statistiques, zones des livreurs, suggestions
 * d'affectation, administration. API locale sur :4000, base de démonstration.
 */
const B='http://127.0.0.1:4000/api/v1';
let pass=0,fail=0; const ok=(c,l,d='')=>{ if(c){pass++;console.log('  ✔',l)} else {fail++;console.log('  ✘',l,d)} };
const j=async(t,m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});let x=null;try{x=await r.json()}catch{};return {s:r.status,d:x?.data,m:x?.message,meta:x?.meta}};
const login=async(id,pw)=>(await j(null,'POST','/auth/login',{identifier:id,password:pw})).d.accessToken;
const admin=await login('admin@logixpress.tn','Admin123!'); const exp=await login('expediteur@bluestar.tn','Exp123!'); const liv=await login('50123456','Liv123!'); const agent=await login('agent.magasin@logixpress.tn','Agent123!');
const sfx=Date.now().toString(36);
const deleg='Hammam Chatt '+sfx;
let SHIPPER=null;
const mk=(t,d,g='Ben Arous')=>j(t,'POST','/colis',{...(t===admin&&SHIPPER?{shipperId:SHIPPER}:{}),customerName:'Zone '+sfx,customerPhone:'93'+String(Date.now()).slice(-6),governorate:g,delegation:d,address:'Rue zone',totalPrice:20,pieceCount:1});
console.log('1. Création automatique');
const before=(await j(admin,'GET','/zones')).d.length;
const c1=await mk(exp,deleg); SHIPPER=c1.d?.shipperId; ok(c1.s===201,'expéditeur crée un colis vers une délégation nouvelle',c1.m);
ok(c1.d?.zoneName===deleg && !!c1.d?.zoneId,'le colis porte sa zone',JSON.stringify([c1.d?.zoneId,c1.d?.zoneName]));
const z1=(await j(admin,'GET','/zones')).d; ok(z1.length===before+1,'une zone de plus dans la liste',`${before}→${z1.length}`);
const zone=z1.find(z=>z.id===c1.d.zoneId); ok(zone?.autoCreated===true && zone.depositName==='Hub Central Ben Arous','zone auto, rattachée à l’agence du gouvernorat',JSON.stringify(zone));
const c2=await mk(admin,deleg.toUpperCase()+'  '); ok(c2.d?.zoneId===c1.d.zoneId,'même délégation (casse/espaces différents) → même zone');
ok((await j(admin,'GET','/zones')).d.length===before+1,'pas de doublon');
const c3=await mk(exp,'Rades '+sfx,'Tunis'); const z3=(await j(admin,'GET','/zones')).d.find(z=>z.id===c3.d.zoneId); ok(z3?.depositName==='Agence Tunis','Tunis → Agence Tunis',z3?.depositName);
const par=await Promise.all([mk(exp,'Parallele '+sfx),mk(exp,'Parallele '+sfx),mk(admin,'parallele '+sfx)]);
ok(new Set(par.map(p=>p.d?.zoneId)).size===1 && par.every(p=>p.s===201),'3 créations simultanées → une seule zone',JSON.stringify(par.map(p=>[p.s,p.m,p.d?.zoneId])));
console.log('2. Liste, statistiques, suggestions');
const zs=(await j(admin,'GET','/zones?search='+encodeURIComponent(deleg))).d; ok(zs.length===1 && zs[0].openPackages===2,'recherche + 2 colis en cours',JSON.stringify(zs[0]&&{o:zs[0].openPackages,t:zs[0].totalPackages}));
const sug=(await j(exp,'GET','/zones/suggestions?governorate=Ben%20Arous')).d; ok(sug.some(s=>s.delegation===deleg),'suggestions du formulaire (expéditeur)');
ok((await j(exp,'GET','/zones')).s===403,'liste complète refusée à l’expéditeur');
ok((await j(admin,'GET','/colis?zone='+c1.d.zoneId)).d.length===2,'filtre des colis par zone');
ok((await j(admin,'GET','/colis?zone=nimporte')).s===200,'filtre zone invalide : pas d’erreur');
console.log('3. Livreurs et zones');
const me=(await j(liv,'GET','/drivers/me')).d; ok(Array.isArray(me.zones),'profil livreur : zones');
const lz=(await j(liv,'GET','/zones')).d; ok(lz.length>0 && lz[0].drivers===undefined,'le livreur voit les zones actives, sans collègues');
const put=await j(liv,'PUT','/drivers/me/zones',{zoneIds:[c1.d.zoneId,c3.d.zoneId]}); ok(put.s===200 && put.d.length===2,'le livreur choisit ses zones',put.m);
ok((await j(liv,'GET','/drivers/me')).d.zones.length===2,'zones relues dans le profil');
ok((await j(liv,'PUT','/drivers/me/zones',{zoneIds:['00000000-0000-0000-0000-000000000000']})).s===400,'zone inconnue refusée');
const sugg=(await j(admin,'GET','/colis/'+c1.d.id+'/driver-suggestions')).d; ok(sugg.zone?.id===c1.d.zoneId && sugg.drivers[0].id===me.id && sugg.drivers[0].coversZone,'affectation : livreur de la zone proposé en premier',JSON.stringify(sugg.drivers.slice(0,2)));
ok((await j(exp,'GET','/colis/'+c1.d.id+'/driver-suggestions')).s===403,'suggestions refusées à l’expéditeur');
console.log('4. Administration');
const upd=await j(admin,'PATCH','/zones/'+c1.d.zoneId,{name:'Hammam Chatt plage',baseDeliveryFee:8.5}); ok(upd.s===200 && upd.d.name==='Hammam Chatt plage' && upd.d.baseDeliveryFee===8.5,'renommer + tarif',upd.m);
ok((await j(agent,'PATCH','/zones/'+c1.d.zoneId,{name:'x'})).s===403,'agent de dépôt : modification refusée');
ok((await j(admin,'PATCH','/zones/'+c1.d.zoneId,{baseDeliveryFee:-1})).s===400,'tarif négatif refusé');
const off=await j(admin,'PATCH','/zones/'+c3.d.zoneId,{isActive:false}); ok(off.s===200 && off.d.isActive===false,'désactiver une zone');
ok(!(await j(liv,'GET','/zones')).d.some(z=>z.id===c3.d.zoneId),'zone désactivée absente pour le livreur');
const drv=await j(admin,'PATCH','/zones/'+c1.d.zoneId,{driverIds:[]}); ok(drv.s===200 && drv.d.drivers.length===0,'retirer les livreurs depuis la zone');
const audit=(await j(admin,'GET','/audit?entityType=ZONE&limit=20')); ok(audit.s===200,'journal accessible');
console.log(`\n${pass} vérifications réussies, ${fail} échec(s)`); process.exit(fail?1:0);
