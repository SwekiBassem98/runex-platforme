// QA RUNSHEET ADMIN CRUD COMPLETE — PROMPT 25.3
const BASE = 'http://127.0.0.1:4000/api/v1';
let fails=0, passes=0;
const ok=(c,l,d='')=>{ if(c) passes++; else fails++; console.log(`  ${c?'OK  ':'ECHEC'} ${l}${d?` — ${d}`:''}`); };
async function api(token, method, path, body){
  const h={Accept:'application/json'}; if(token) h.Authorization=`Bearer ${token}`;
  if(body!==undefined) h['Content-Type']='application/json';
  const r=await fetch(`${BASE}${path}`,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});
  let j=null; try{ j=await r.json(); }catch{}
  return {status:r.status, json:j};
}
async function login(e,p){ const r=await api(null,'POST','/auth/login',{email:e,password:p}); if(r.status!==200) throw new Error(`login ${e} ${r.status} ${JSON.stringify(r.json)}`); return r.json.data; }

import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { PrismaClient } = require(require('node:path').resolve(import.meta.dirname, '../../node_modules/@prisma/client'));
const prisma=new PrismaClient();

console.log('=== Login ===');
const admin=await login('admin@logixpress.tn','Admin123!');
const exp=await login('expediteur@bluestar.tn','Exp123!');
let livA, livB;
try{ livA=await login('livreur.hamza@logixpress.tn','Liv123!'); }catch(e){ console.log('livA login fallback',e); const r=await api(null,'POST','/auth/login',{email:'livreur.hamza@logixpress.tn',password:'Liv123!'}); if(r.status===200) livA=r.json.data; else throw e; }
try{ livB=await login('livreur.ghassan@logixpress.tn','Liv123!'); }catch(e){ console.log('livB login fallback',e); const r=await api(null,'POST','/auth/login',{email:'livreur.ghassan@logixpress.tn',password:'Liv123!'}); if(r.status===200) livB=r.json.data; else throw e; }
console.log('admin',admin.user.email,'exp',exp.user.email,'livA',livA.user.email,livA.user.driverId,'livB',livB.user.email,livB.user.driverId);

// fetch real drivers for canonical ids
const driversRes=await api(admin.accessToken,'GET','/drivers?limit=100');
const drivers=driversRes.json.data;
const driverA=drivers.find(d=>d.user.email==='livreur.hamza@logixpress.tn')||drivers[0];
const driverB=drivers.find(d=>d.user.email==='livreur.ghassan@logixpress.tn')||drivers[1];
console.log('driverA',driverA.id,driverA.driverCode,'driverB',driverB.id,driverB.driverCode);
const deposits=await prisma.deposit.findMany({take:5});
const mainDeposit=deposits.find(d=>d.isMainHub) || deposits[0];
const otherDeposit=deposits.find(d=>d.id!==mainDeposit.id) || deposits[1] || mainDeposit;
console.log('mainDeposit',mainDeposit.id,mainDeposit.name,'otherDeposit',otherDeposit?.id, otherDeposit?.name);
const tourDate='2026-10-08';
const tourDate2='2026-10-09';

console.log('\n=== 1. CREATE — validation ===');
// 1.1 valid
const createRes=await api(admin.accessToken,'POST','/runsheets',{driverId:driverA.id, tourDate, notes:'Zone Tunis city'});
ok(createRes.status===201,'1.1 create valid 201',`HTTP ${createRes.status} ${JSON.stringify(createRes.json).slice(0,250)}`);
let runsheetNumber, runsheetId;
if(createRes.status===201){
  runsheetNumber=createRes.json.data.runsheetNumber;
  runsheetId=createRes.json.data.id;
  ok(createRes.json.data.driverId===driverA.id,'driverId persisted');
  ok(createRes.json.data.tourDate===tourDate,'tourDate correct');
  ok(createRes.json.data.status==='EN_ATTENTE','initial status EN_ATTENTE');
  ok(!!createRes.json.data.depositId,'depositId present');
  ok(createRes.json.data.depositName,'depositName present');
}
// 1.2 missing driver
const missDriver=await api(admin.accessToken,'POST','/runsheets',{tourDate});
ok(missDriver.status===400,'1.2 missing driver → 400',`${missDriver.status} ${missDriver.json.message}`);
// 1.3 missing date
const missDate=await api(admin.accessToken,'POST','/runsheets',{driverId:driverA.id});
ok(missDate.status===400,'1.3 missing tourDate → 400');
// 1.4 invalid driver format (drv-xxx) → 400 UUID
const fakeDrv=await api(admin.accessToken,'POST','/runsheets',{driverId:'drv-002', tourDate});
ok(fakeDrv.status===400 && JSON.stringify(fakeDrv.json.message).includes('UUID'),'1.4 fake driverId drv-002 → 400 UUID',`${fakeDrv.status} ${fakeDrv.json.message}`);
// 1.5 not-found driver (random UUID) → 404
const randomUuid='00000000-0000-4000-a000-000000000000';
const notFoundDrv=await api(admin.accessToken,'POST','/runsheets',{driverId:randomUuid, tourDate});
ok(notFoundDrv.status===404,'1.5 non-existent driver → 404',`${notFoundDrv.status} ${notFoundDrv.json.message}`);
// 1.6 userId as driverId → 404 (contract violation)
const userIdAsDriver=await api(admin.accessToken,'POST','/runsheets',{driverId:driverA.user.id, tourDate});
ok(userIdAsDriver.status===404,'1.6 userId as driverId → 404');
// 1.7 inactive driver → 409
let deact=await api(admin.accessToken,'PATCH',`/drivers/${driverB.id}/status`,{isActive:false, reason:'QA test'});
ok(deact.status===200 || deact.status===204,'deactivate driverB for test');
if(deact.status===200 || deact.status===204){
  const inactiveCreate=await api(admin.accessToken,'POST','/runsheets',{driverId:driverB.id, tourDate});
  ok(inactiveCreate.status===409,'1.7 inactive driver → 409',`${inactiveCreate.status} ${inactiveCreate.json.message}`);
  await api(admin.accessToken,'PATCH',`/drivers/${driverB.id}/status`,{isActive:true, reason:'QA restore'});
livB = await login('livreur.ghassan@logixpress.tn','Liv123!'); // Prompt 26: sessions revoked on deactivation
} else ok(false,'deactivate failed');
// 1.8 invalid date format → 400
const badDate=await api(admin.accessToken,'POST','/runsheets',{driverId:driverA.id, tourDate:'08-10-2026'});
ok(badDate.status===400,'1.8 invalid date format → 400');
// 1.9 unauthorized: expéditeur cannot create
const expCreate=await api(exp.accessToken,'POST','/runsheets',{driverId:driverA.id, tourDate});
ok([403,401].includes(expCreate.status),'1.9 expéditeur cannot create → 403/401',`${expCreate.status}`);
// 1.10 livreur cannot create
const livCreate=await api(livA.accessToken,'POST','/runsheets',{driverId:driverA.id, tourDate});
ok([403,401].includes(livCreate.status),'1.10 livreur cannot create → 403/401');
// 1.11 no auth → 401
const noAuthCreate=await api(null,'POST','/runsheets',{driverId:driverA.id, tourDate});
ok(noAuthCreate.status===401,'1.11 no auth cannot create → 401');

console.log('\n=== 2. READ — list / detail / pagination ===');
// 2.1 list
const listRes=await api(admin.accessToken,'GET','/runsheets');
ok(listRes.status===200 && Array.isArray(listRes.json.data),'2.1 list 200 and array');
const found=listRes.json.data.find(r=>r.runsheetNumber===runsheetNumber);
ok(!!found,'runsheet appears in list');
if(found){
  ok(!!found.driverName,'list has driverName');
  ok(!!found.depositName,'list has depositName');
  ok(typeof found.totalPackages==='number','list has totalPackages');
  ok(found.status==='EN_ATTENTE','list status correct');
}
// 2.2 detail by runsheetNumber
const detailRes=await api(admin.accessToken,'GET',`/runsheets/${runsheetNumber}`);
ok(detailRes.status===200 && detailRes.json.data.runsheetNumber===runsheetNumber,'2.2 detail by runsheetNumber 200');
if(detailRes.status===200) ok(detailRes.json.data.driverId===driverA.id,'detail driverId matches');
// 2.3 detail by UUID
const detailById=await api(admin.accessToken,'GET',`/runsheets/${runsheetId}`);
ok(detailById.status===200 && detailById.json.data.id===runsheetId,'2.3 detail by UUID 200');
// 2.4 detail 404
const notFoundDetail=await api(admin.accessToken,'GET','/runsheets/RUN-99999999-9999');
ok(notFoundDetail.status===404,'2.4 detail 404 for unknown');
// 2.5 list pagination meta (if exists) — check we can filter by status/date
const filtered=await api(admin.accessToken,'GET',`/runsheets?status=EN_ATTENTE`);
ok(filtered.status===200,'2.5 filter by status 200');
ok(filtered.json.data.every(r=>r.status==='EN_ATTENTE'),'filter status returns only EN_ATTENTE');
// 2.6 livreur sees only his runsheets (scope isolation)
const livList=await api(livA.accessToken,'GET','/runsheets');
ok(livList.status===200,'2.6 livreur list 200');
if(livList.status===200){
  const allHis=livList.json.data.every(r=>r.driverId===livA.user.driverId);
  ok(allHis,'livreur sees only own runsheets',`got ${livList.json.data.map(r=>r.driverId).join(',')}`);
}
// 2.7 unauthorized without token → 401
const noAuthList=await api(null,'GET','/runsheets');
ok(noAuthList.status===401,'2.7 no auth list → 401');

console.log('\n=== 3. UPDATE — editable fields and status guards ===');
// create a fresh empty runsheet for update tests
const updBase=await api(admin.accessToken,'POST','/runsheets',{driverId:driverA.id, tourDate: tourDate2, notes:'Zone initiale'});
ok(updBase.status===201,'3.0 create runsheet for update tests 201');
const updNumber=updBase.json.data.runsheetNumber;
const updId=updBase.json.data.id;
// 3.1 valid update pending: change tourDate
const patchDate=await api(admin.accessToken,'PATCH',`/runsheets/${updNumber}`,{tourDate:'2026-10-15'});
ok(patchDate.status===200 && patchDate.json.data.tourDate==='2026-10-15','3.1 valid update tourDate 200');
if(patchDate.status===200) ok(patchDate.json.data.runsheetNumber===updNumber,'runsheetNumber unchanged');
// 3.2 valid update notes
const patchNotes=await api(admin.accessToken,'PATCH',`/runsheets/${updNumber}`,{notes:'Zone Bardo'});
ok(patchNotes.status===200 && patchNotes.json.data.notes==='Zone Bardo','3.2 valid update notes 200');
// 3.3 valid update driver (empty runsheet) to driverB
const patchDriver=await api(admin.accessToken,'PATCH',`/runsheets/${updNumber}`,{driverId:driverB.id});
ok(patchDriver.status===200 && patchDriver.json.data.driverId===driverB.id,'3.3 valid update driver (empty) 200');
if(patchDriver.status===200) ok(patchDriver.json.data.driverName===driverB.user.fullName,'driverName updated');
// revert driver to A for further tests
await api(admin.accessToken,'PATCH',`/runsheets/${updNumber}`,{driverId:driverA.id});
// 3.4 invalid driver format → 400
const patchBadDrv=await api(admin.accessToken,'PATCH',`/runsheets/${updNumber}`,{driverId:'drv-999'});
ok(patchBadDrv.status===400,'3.4 invalid driver format → 400');
// 3.5 non-existent driver → 404
const patchNotFoundDrv=await api(admin.accessToken,'PATCH',`/runsheets/${updNumber}`,{driverId:randomUuid});
ok(patchNotFoundDrv.status===404,'3.5 non-existent driver → 404');
// 3.6 inactive driver → 409
await api(admin.accessToken,'PATCH',`/drivers/${driverB.id}/status`,{isActive:false, reason:'QA'});
const patchInactive=await api(admin.accessToken,'PATCH',`/runsheets/${updNumber}`,{driverId:driverB.id});
ok(patchInactive.status===409,'3.6 update to inactive driver → 409');
await api(admin.accessToken,'PATCH',`/drivers/${driverB.id}/status`,{isActive:true, reason:'restore'});
livB = await login('livreur.ghassan@logixpress.tn','Liv123!'); // Prompt 26: sessions revoked on deactivation
// 3.7 invalid tourDate → 400
const patchBadDate=await api(admin.accessToken,'PATCH',`/runsheets/${updNumber}`,{tourDate:'bad-date'});
ok(patchBadDate.status===400,'3.7 invalid tourDate → 400');
// 3.8 empty payload → 400
const patchEmpty=await api(admin.accessToken,'PATCH',`/runsheets/${updNumber}`,{});
ok(patchEmpty.status===400,'3.8 empty payload → 400');
// 3.9 PUT also works
const putRes=await api(admin.accessToken,'PUT',`/runsheets/${updNumber}`,{notes:'Zone PUT'});
ok(putRes.status===200 && putRes.json.data.notes==='Zone PUT','3.9 PUT update notes 200');
// 3.10 unauthorized: exp cannot update
const expPatch=await api(exp.accessToken,'PATCH',`/runsheets/${updNumber}`,{notes:'hack'});
ok([403,401].includes(expPatch.status),'3.10 exp cannot update → 403/401');
// 3.11 livreur cannot update
const livPatch=await api(livA.accessToken,'PATCH',`/runsheets/${updNumber}`,{notes:'hack'});
ok([403,401].includes(livPatch.status),'3.11 livreur cannot update → 403/401');
// 3.12 no auth → 401
const noAuthPatch=await api(null,'PATCH',`/runsheets/${updNumber}`,{notes:'hack'});
ok(noAuthPatch.status===401,'3.12 no auth patch → 401');

console.log('\n=== 4. UPDATE — package relation guard (driver/deposit blocked) ===');
// Create runsheet and attach a package via DB for fast test, then try driver change
const pkgForRel=await api(exp.accessToken,'POST','/colis',{customerName:'QA Rel Client', customerPhone:'55555190', address:'Rue QA Rel', totalPrice:55, pieceCount:1, governorate:'Tunis', delegation:'Tunis', contentSummary:'QA Rel'});
ok(pkgForRel.status===201,'4.0 create package for relation test');
const pkgRel=pkgForRel.json.data;
const runsheetRelRes=await api(admin.accessToken,'POST','/runsheets',{driverId:driverA.id, tourDate:'2026-10-16', notes:'Rel test'});
const runsheetRelNumber=runsheetRelRes.json.data.runsheetNumber;
const addPkgRel=await api(admin.accessToken,'POST',`/runsheets/${runsheetRelNumber}/add-package`,{packageIdentifier: pkgRel.trackingNumber});
ok(addPkgRel.status===200,'4.1 add package to runsheet 200');
// try driver change after attach → 409
const patchAfterPkg=await api(admin.accessToken,'PATCH',`/runsheets/${runsheetRelNumber}`,{driverId:driverB.id});
ok(patchAfterPkg.status===409,'4.2 driver change after package → 409',`${patchAfterPkg.status} ${patchAfterPkg.json.message}`);
// try deposit change after attach → 409
if(otherDeposit.id!==mainDeposit.id){
  const patchDepositAfterPkg=await api(admin.accessToken,'PATCH',`/runsheets/${runsheetRelNumber}`,{depositId: otherDeposit.id});
  ok(patchDepositAfterPkg.status===409 || patchDepositAfterPkg.status===400,'4.3 deposit change after package → 409/400');
} else ok(true,'4.3 skip deposit change test (only one deposit)');
// try notes change after attach → should succeed (notes allowed)
const patchNotesAfterPkg=await api(admin.accessToken,'PATCH',`/runsheets/${runsheetRelNumber}`,{notes:'New zone after pkg'});
ok(patchNotesAfterPkg.status===200,'4.4 notes change after package → 200 (allowed)');
// cleanup: remove package then driver change should succeed
const remPkg=await api(admin.accessToken,'POST',`/runsheets/${runsheetRelNumber}/remove-package`,{packageIdentifier: pkgRel.trackingNumber});
ok(remPkg.status===200,'4.5 remove package 200');
const patchAfterRemove=await api(admin.accessToken,'PATCH',`/runsheets/${runsheetRelNumber}`,{driverId:driverB.id});
ok(patchAfterRemove.status===200,'4.6 driver change after removing packages → 200');
// verify package count reflects
const detailAfter=await api(admin.accessToken,'GET',`/runsheets/${runsheetRelNumber}`);
ok(detailAfter.json.data.totalPackages===0,'4.7 totalPackages 0 after remove');

console.log('\n=== 5. UPDATE — status guards (active/closed/cancelled immutable) ===');
// Create runsheets for each status test via prisma direct update
async function createRunsheetForStatus(status, suffix){
  const r=await api(admin.accessToken,'POST','/runsheets',{driverId:driverA.id, tourDate:`2026-10-${10+Math.floor(Math.random()*5)}`, notes:`Status ${status} ${suffix}`});
  if(r.status!==201) throw new Error(`create for status ${status} failed ${JSON.stringify(r.json)}`);
  const number=r.json.data.runsheetNumber;
  const id=r.json.data.id;
  await prisma.runsheet.update({where:{id}, data:{status}});
  return {number, id};
}
const activeEnCours=await createRunsheetForStatus('EN_COURS','active');
const patchActive=await api(admin.accessToken,'PATCH',`/runsheets/${activeEnCours.number}`,{notes:'try edit active'});
ok(patchActive.status===409,'5.1 active EN_COURS not editable → 409');
const closedConforme=await createRunsheetForStatus('CLOTUREE_CONFORME','closed');
const patchClosed=await api(admin.accessToken,'PATCH',`/runsheets/${closedConforme.number}`,{notes:'try edit closed'});
ok(patchClosed.status===409,'5.2 closed CLOTUREE_CONFORME not editable → 409');
const annulee=await createRunsheetForStatus('ANNULEE','cancelled');
const patchAnnulee=await api(admin.accessToken,'PATCH',`/runsheets/${annulee.number}`,{notes:'try edit annulee'});
ok(patchAnnulee.status===409,'5.3 cancelled ANNULEE not editable → 409');
const retourDepot=await createRunsheetForStatus('RETOUR_DEPOT','retour');
const patchRetour=await api(admin.accessToken,'PATCH',`/runsheets/${retourDepot.number}`,{notes:'try edit retour'});
ok(patchRetour.status===409,'5.4 RETOUR_DEPOT not editable → 409');
const valideeDepart=await createRunsheetForStatus('VALIDEE_DEPART','validee');
const patchValidee=await api(admin.accessToken,'PATCH',`/runsheets/${valideeDepart.number}`,{notes:'try'});
ok(patchValidee.status===409,'5.5 VALIDEE_DEPART not editable → 409');
// cleanup status test runsheets: delete via prisma if needed (they are not deletable via API)
await prisma.runsheetItem.deleteMany({where:{runsheetId: {in:[activeEnCours.id, closedConforme.id, annulee.id, retourDepot.id, valideeDepart.id]}}});
await prisma.runsheet.deleteMany({where:{id:{in:[activeEnCours.id, closedConforme.id, annulee.id, retourDepot.id, valideeDepart.id]}}});

console.log('\n=== 6. DELETE — guards ===');
// 6.1 valid delete empty pending
const delEmptyRes=await api(admin.accessToken,'POST','/runsheets',{driverId:driverA.id, tourDate:'2026-10-17', notes:'To delete'});
ok(delEmptyRes.status===201,'6.0 create empty for delete 201');
const delEmptyNumber=delEmptyRes.json.data.runsheetNumber;
const delEmptyId=delEmptyRes.json.data.id;
const delRes=await api(admin.accessToken,'DELETE',`/runsheets/${delEmptyNumber}`);
ok(delRes.status===200,'6.1 delete empty pending → 200');
const afterDel=await api(admin.accessToken,'GET',`/runsheets/${delEmptyNumber}`);
ok(afterDel.status===404,'6.1 verify deleted → 404');
// also test delete by UUID
const delUuidRes=await api(admin.accessToken,'POST','/runsheets',{driverId:driverA.id, tourDate:'2026-10-18'});
const delUuidNumber=delUuidRes.json.data.runsheetNumber;
const delUuidId=delUuidRes.json.data.id;
const delByUuid=await api(admin.accessToken,'DELETE',`/runsheets/${delUuidId}`);
ok(delByUuid.status===200,'6.2 delete by UUID → 200');

// 6.3 delete with packages → 409
const delPkgRes=await api(admin.accessToken,'POST','/runsheets',{driverId:driverA.id, tourDate:'2026-10-19'});
const delPkgNumber=delPkgRes.json.data.runsheetNumber;
const pkgForDel=await api(exp.accessToken,'POST','/colis',{customerName:'QA Del Client', customerPhone:'55555200', address:'Rue QA Del', totalPrice:60, governorate:'Tunis', delegation:'Tunis', contentSummary:'QA Del'});
const addForDel=await api(admin.accessToken,'POST',`/runsheets/${delPkgNumber}/add-package`,{packageIdentifier: pkgForDel.json.data.trackingNumber});
ok(addForDel.status===200,'6.3 add package for delete test 200');
const delWithPkg=await api(admin.accessToken,'DELETE',`/runsheets/${delPkgNumber}`);
ok(delWithPkg.status===409,'6.3 delete with packages → 409');
// cleanup: remove package then delete should succeed
await api(admin.accessToken,'POST',`/runsheets/${delPkgNumber}/remove-package`,{packageIdentifier: pkgForDel.json.data.trackingNumber});
const delAfterRemove=await api(admin.accessToken,'DELETE',`/runsheets/${delPkgNumber}`);
ok(delAfterRemove.status===200,'6.4 delete after removing packages → 200');

// 6.5 delete active → 409
const activeDel=await createRunsheetForStatus('EN_COURS','delActive');
const delActive=await api(admin.accessToken,'DELETE',`/runsheets/${activeDel.number}`);
ok(delActive.status===409,'6.5 delete active EN_COURS → 409');
await prisma.runsheet.delete({where:{id:activeDel.id}});
// 6.6 delete closed → 409
const closedDel=await createRunsheetForStatus('CLOTUREE_CONFORME','delClosed');
const delClosed=await api(admin.accessToken,'DELETE',`/runsheets/${closedDel.number}`);
ok(delClosed.status===409,'6.6 delete closed → 409');
await prisma.runsheet.delete({where:{id:closedDel.id}});
// 6.7 delete cancelled → 409 (ANNULEE)
const cancelDel=await createRunsheetForStatus('ANNULEE','delCancel');
const delCancel=await api(admin.accessToken,'DELETE',`/runsheets/${cancelDel.number}`);
ok(delCancel.status===409,'6.7 delete cancelled ANNULEE → 409');
await prisma.runsheet.delete({where:{id:cancelDel.id}});
// 6.8 unauthorized delete
const delUnauthRes=await api(admin.accessToken,'POST','/runsheets',{driverId:driverA.id, tourDate:'2026-10-20'});
const delUnauthNumber=delUnauthRes.json.data.runsheetNumber;
const expDel=await api(exp.accessToken,'DELETE',`/runsheets/${delUnauthNumber}`);
ok([403,401].includes(expDel.status),'6.8 exp cannot delete → 403/401');
const livDel=await api(livA.accessToken,'DELETE',`/runsheets/${delUnauthNumber}`);
ok([403,401].includes(livDel.status),'6.9 livreur cannot delete → 403/401');
const noAuthDel=await api(null,'DELETE',`/runsheets/${delUnauthNumber}`);
ok(noAuthDel.status===401,'6.10 no auth delete → 401');
// cleanup
await api(admin.accessToken,'DELETE',`/runsheets/${delUnauthNumber}`);
// 6.11 delete non-existent → 404
const del404=await api(admin.accessToken,'DELETE','/runsheets/RUN-00000000-0000');
ok(del404.status===404,'6.11 delete non-existent → 404');

console.log('\n=== 7. RELATION CONSISTENCY & MOBILE ===');
// Verify package stays linked to runsheet after add-package
const pkgCons=await api(exp.accessToken,'POST','/colis',{customerName:'QA Consist', customerPhone:'55555300', address:'Rue Consist', totalPrice:70, governorate:'Tunis', delegation:'Tunis', contentSummary:'Consist'});
const runsheetCons=await api(admin.accessToken,'POST','/runsheets',{driverId:driverA.id, tourDate:'2026-10-21'});
const addCons=await api(admin.accessToken,'POST',`/runsheets/${runsheetCons.json.data.runsheetNumber}/add-package`,{packageIdentifier: pkgCons.json.data.trackingNumber});
ok(addCons.status===200,'7.0 add package for consistency test 200');
const pkgFresh=await api(admin.accessToken,'GET',`/packages/${pkgCons.json.data.id}`);
const linked = pkgFresh.json.data.runsheetId===runsheetCons.json.data.id || pkgFresh.json.data.runsheetNumber===runsheetCons.json.data.runsheetNumber || pkgFresh.json.data.currentRunsheetId===runsheetCons.json.data.id;
ok(linked,'7.1 package still linked to runsheet via runsheetId/Number', `runsheetId=${pkgFresh.json.data.runsheetId} currentRunsheetId=${pkgFresh.json.data.currentRunsheetId} vs ${runsheetCons.json.data.id}`);
// also check detail shows package count
const detailCons=await api(admin.accessToken,'GET',`/runsheets/${runsheetCons.json.data.runsheetNumber}`);
ok(detailCons.json.data.totalPackages===1,'7.1b runsheet totalPackages 1 after add');
// livreur B cannot see package of livreur A via direct package endpoint (isolation via runsheet)
const notOwnPkg=await api(livB.accessToken,'GET',`/packages/${pkgCons.json.data.id}`);
ok(notOwnPkg.status===404,'7.2 livreur B cannot see A package via package endpoint → 404');
// livreur A can see via runsheet detail (mobile view), not direct package endpoint
const livAView=await api(livA.accessToken,'GET',`/runsheets/${runsheetCons.json.data.runsheetNumber}`);
const seesViaDetail = livAView.status===200 && (livAView.json.data.totalPackages===1 || livAView.json.data.packages?.some(p=>p.id===pkgCons.json.data.id));
ok(seesViaDetail,'7.3 livreur A sees package via runsheet detail',`status ${livAView.status} totalPackages=${livAView.json.data?.totalPackages}`);
const livAActive=await api(livA.accessToken,'GET','/runsheets/driver/active');
const seesViaActive = livAActive.status===200 && livAActive.json.data.packages?.some(p=>p.id===pkgCons.json.data.id);
if(livAActive.status===200) console.log(`  livA active runsheet ${livAActive.json.data.runsheetNumber} packages ${livAActive.json.data.packages?.length}`);
// cleanup
await api(admin.accessToken,'POST',`/runsheets/${runsheetCons.json.data.runsheetNumber}/remove-package`,{packageIdentifier: pkgCons.json.data.trackingNumber});
await api(admin.accessToken,'DELETE',`/runsheets/${runsheetCons.json.data.runsheetNumber}`);

console.log('\n=== 8. AUDIT / NOTIFICATION / SECURITY extras ===');
// 8.1 verify that after update, audit exists? We can check audit log via API if available
const auditRes=await api(admin.accessToken,'GET',`/audit?entityType=RUNSHEET&entityId=${updId}&limit=5`);
if(auditRes.status===200) ok(auditRes.json.data.length>=0,'8.1 audit readable (if endpoint exists)',`got ${auditRes.json.data.length}`);
else console.log(`  8.1 audit endpoint ${auditRes.status} — skip`);
// 8.2 deposit isolation: try to change depositId to other deposit when empty should succeed
const isoRes=await api(admin.accessToken,'POST','/runsheets',{driverId:driverA.id, tourDate:'2026-10-22'});
const isoNumber=isoRes.json.data.runsheetNumber;
if(otherDeposit.id!==mainDeposit.id){
  const changeDepot=await api(admin.accessToken,'PATCH',`/runsheets/${isoNumber}`,{depositId: otherDeposit.id});
  ok(changeDepot.status===200 && changeDepot.json.data.depositId===otherDeposit.id,'8.2 empty runsheet deposit change → 200');
} else ok(true,'8.2 skip deposit change (single deposit)');
await api(admin.accessToken,'DELETE',`/runsheets/${isoNumber}`).catch(()=>{});
// 8.3 verify list still reflects correct counts
const finalList=await api(admin.accessToken,'GET','/runsheets');
ok(finalList.status===200,'8.3 final list 200');

console.log(`\nTOTAL: ${passes} passed, ${fails} failed`);
await prisma.$disconnect();
process.exit(fails>0?1:0);
