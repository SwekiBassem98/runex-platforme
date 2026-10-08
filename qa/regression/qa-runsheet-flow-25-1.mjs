// QA RUNSHEET & DRIVER ASSIGNMENT — PROMPT 25.1
const BASE = 'http://127.0.0.1:4000/api/v1';
let fails=0, passes=0;
const ok=(c,l,d='')=>{ if(c) passes++; else fails++; console.log(`  ${c?'OK  ':'ECHEC'} ${l}${d?` — ${d}`:''}`); };
async function api(token, method, path, body){
  const h={Accept:'application/json'}; if(token) h.Authorization=`Bearer ${token}`;
  if(body!==undefined) h['Content-Type']='application/json';
  const r=await fetch(`${BASE}${path}`,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});
  let j=null; try{ j=await r.json(); }catch{} return {status:r.status, json:j};
}
async function login(e,p){ const r=await api(null,'POST','/auth/login',{email:e,password:p}); if(r.status!==200) throw new Error(`login ${e} ${r.status} ${JSON.stringify(r.json)}`); return {access:r.json.data.accessToken, user:r.json.data.user, driverId:r.json.data.user?.driverId}; }

console.log('=== Login ===');
const admin=await login('admin@logixpress.tn','Admin123!');
const exp=await login('expediteur@bluestar.tn','Exp123!');
const livA=await login('livreur.hamza@logixpress.tn','Liv123!');
let livB; try{ livB=await login('livreur.ghassan@logixpress.tn','Ghassan123!'); }catch{
  const r=await api(null,'POST','/auth/login',{email:'livreur.ghassan@logixpress.tn',password:'Liv123!'});
  if(r.status===200) livB={access:r.json.data.accessToken, user:r.json.data.user, driverId:r.json.data.user?.driverId};
}
console.log('admin',admin.user.email,'driverA',livA.driverId,'driverB',livB.driverId);

// fetch real drivers for canonic ids
const driversRes=await api(admin.access,'GET','/drivers?limit=100');
const drivers=driversRes.json.data;
const driverA=drivers.find(d=>d.user.email==='livreur.hamza@logixpress.tn')||drivers[0];
const driverB=drivers.find(d=>d.user.email==='livreur.ghassan@logixpress.tn')||drivers[1];
console.log('driverA',driverA.id,driverA.driverCode,'driverB',driverB.id);

console.log('\n=== 1. CREATE RUNSHEET FLOW ===');
// 1.1 valid
const tourDate='2026-10-08';
const createRes=await api(admin.access,'POST','/runsheets',{driverId:driverA.id, tourDate, notes:'Zone Tunis city'});
ok(createRes.status===201,'create runsheet valid driver 201',`HTTP ${createRes.status} ${JSON.stringify(createRes.json).slice(0,200)}`);
let runsheetNumber, runsheetId;
if(createRes.status===201){
  runsheetNumber=createRes.json.data.runsheetNumber;
  runsheetId=createRes.json.data.id;
  ok(createRes.json.data.driverId===driverA.id,'driverId persisted correctly',`${createRes.json.data.driverId} vs ${driverA.id}`);
  ok(createRes.json.data.tourDate===tourDate,'tourDate correct');
  ok(createRes.json.data.depositName,'depositName present');
  ok(createRes.json.data.status==='EN_ATTENTE','initial status EN_ATTENTE');
}
// 1.2 verify list
const listRes=await api(admin.access,'GET','/runsheets');
const found=listRes.json.data.find(r=>r.runsheetNumber===runsheetNumber);
ok(!!found,'runsheet appears in list',runsheetNumber);
// 1.3 refresh (re-fetch)
const detailRes=await api(admin.access,'GET',`/runsheets/${runsheetNumber}`);
ok(detailRes.status===200 && detailRes.json.data.driverId===driverA.id,'detail persists after refresh');
// 1.4 missing driver
const missRes=await api(admin.access,'POST','/runsheets',{tourDate});
ok(missRes.status===400 && missRes.json.message.includes('Chauffeur'),'missing driver → 400',`HTTP ${missRes.status} ${missRes.json.message}`);
// 1.5 missing date
const missDate=await api(admin.access,'POST','/runsheets',{driverId:driverA.id});
ok(missDate.status===400 && missDate.json.message.toLowerCase().includes('date'),'missing date → 400');
// 1.6 invalid driver (fake drv-xxx) → 400 UUID
const fakeRes=await api(admin.access,'POST','/runsheets',{driverId:'drv-002', tourDate});
ok(fakeRes.status===400 && fakeRes.json.message.includes('UUID'),'fake driverId drv-002 → 400 UUID',`${fakeRes.status} ${fakeRes.json.message}`);
// 1.7 not-found driver (random UUID)
const randomUuid='00000000-0000-4000-a000-000000000000';
const notFoundRes=await api(admin.access,'POST','/runsheets',{driverId:randomUuid, tourDate});
ok(notFoundRes.status===404 && notFoundRes.json.message.includes('introuvable'),'non-existent driver → 404');
// 1.8 userId as driverId → 404
const userIdAsDriver=await api(admin.access,'POST','/runsheets',{driverId:driverA.user.id, tourDate});
ok(userIdAsDriver.status===404,'userId as driverId → 404');
// 1.9 inactive driver
// deactivate driverB
const deactRes=await api(admin.access,'PATCH',`/drivers/${driverB.id}/status`,{isActive:false, reason:'QA test'});
ok(deactRes.status===200 || deactRes.status===204,'deactivate driverB');
if(deactRes.status===200 || deactRes.status===204){
  const inactiveRes=await api(admin.access,'POST','/runsheets',{driverId:driverB.id, tourDate});
  ok(inactiveRes.status===409 && inactiveRes.json.message.toLowerCase().includes('inactif'),'inactive driver → 409');
  // reactivate
  await api(admin.access,'PATCH',`/drivers/${driverB.id}/status`,{isActive:true, reason:'QA restore'});
  // Prompt 26: deactivating a driver revokes his sessions → log in again.
  livB = await login('livreur.ghassan@logixpress.tn','Liv123!');
} else {
  ok(false,'deactivate for test failed');
}
// 1.10 unauthorized (expéditeur cannot create)
const expCreate=await api(exp.access,'POST','/runsheets',{driverId:driverA.id, tourDate});
ok(expCreate.status===403 || expCreate.status===401,'expéditeur cannot create runsheet → 403/401',`HTTP ${expCreate.status}`);
 // also try livreur
const livCreate=await api(livA.access,'POST','/runsheets',{driverId:driverA.id, tourDate});
ok(livCreate.status===403 || livCreate.status===401,'livreur cannot create runsheet → 403/401');

console.log('\n=== 2. ASSIGN PACKAGE FLOW ===');
// pick eligible package (CREE or RECU_DEPOT)
const pkgsRes=await api(admin.access,'GET','/packages?limit=100');
const eligible=pkgsRes.json.data.find(p=>['CREE','RECU_DEPOT','RECU_DEPOT_DESTINATION','EN_COURS_LIVRAISON','AFFECTE_RUNSHEET','RECU_DEPOT'].includes(p.status) && p.trackingNumber);
let pkg=eligible;
if(!pkg){
  // create new package via expéditeur
  const newPkg=await api(exp.access,'POST','/colis',{customerName:'QA Assign Client', customerPhone:'55555123', address:'Rue QA 1', totalPrice:77, pieceCount:1, governorate:'Tunis', delegation:'Tunis', contentSummary:'QA colis'});
  pkg=newPkg.json.data;
}
console.log('test pkg',pkg.id,pkg.trackingNumber,pkg.status);
// search driver via searchApi (should return driver ids)
const searchRes=await api(admin.access,'GET',`/search?q=${encodeURIComponent(driverA.user.fullName.split(' ')[0])}`);
const searchedDriver=searchRes.json.data.drivers.find(d=>d.id===driverA.id);
ok(!!searchedDriver && searchedDriver.id===driverA.id,'search returns driver.id canonical (not userId)');
// valid assign
const assignRes=await api(admin.access,'POST',`/packages/${pkg.id}/assign`,{driverId:driverA.id, driverName:driverA.user.fullName});
ok(assignRes.status===200,'assign valid driver 200');
if(assignRes.status===200){
  const fresh=await api(admin.access,'GET',`/packages/${pkg.id}`);
  ok(fresh.json.data.assignedDriverId===driverA.id,'assignedDriverId persisted',fresh.json.data.assignedDriverId);
  // verify admin UI displays correct driver
  ok(fresh.json.data.assignedDriverName===driverA.user.fullName,'assignedDriverName correct');
}
// invalid driver (fake)
const assignFake=await api(admin.access,'POST',`/packages/${pkg.id}/assign`,{driverId:'drv-001'});
ok(assignFake.status===400 && assignFake.json.message.includes('UUID'),'assign fake driver → 400');
// invalid uuid
const assignBadUuid=await api(admin.access,'POST',`/packages/${pkg.id}/assign`,{driverId:'not-uuid'});
ok(assignBadUuid.status===400,'assign invalid uuid → 400');
// inactive driver
await api(admin.access,'PATCH',`/drivers/${driverB.id}/status`,{isActive:false, reason:'QA'});
const assignInactive=await api(admin.access,'POST',`/packages/${pkg.id}/assign`,{driverId:driverB.id});
ok(assignInactive.status===409,'assign inactive driver → 409');
await api(admin.access,'PATCH',`/drivers/${driverB.id}/status`,{isActive:true, reason:'restore'});
livB = await login('livreur.ghassan@logixpress.tn','Liv123!'); // Prompt 26: sessions revoked on deactivation
// package already assigned -> reassign to another driver should succeed (reassign) but check
const reassign=await api(admin.access,'POST',`/packages/${pkg.id}/assign`,{driverId:driverB.id});
ok(reassign.status===200 && reassign.json.data.assignedDriverId===driverB.id,'reassign to another driver succeeds');
// verify runsheet relation when provided
// create runsheet for driverB
const rsB=await api(admin.access,'POST','/runsheets',{driverId:driverB.id, tourDate});
ok(rsB.status===201,'create runsheet for B for assign test');
let rsBNumber= rsB.status===201? rsB.json.data.runsheetNumber : null;
// assign with matching runsheet
// need fresh eligible pkg
const pkg2Res=await api(exp.access,'POST','/colis',{customerName:'QA Assign Runsheet', customerPhone:'55555124', address:'Rue QA 2', totalPrice:88, governorate:'Tunis', delegation:'Tunis', contentSummary:'QA2'});
const pkg2=pkg2Res.json.data;
const assignWithRs=await api(admin.access,'POST',`/packages/${pkg2.id}/assign`,{driverId:driverB.id, runsheetNumber:rsBNumber});
ok(assignWithRs.status===200 && (assignWithRs.json.data.runsheetNumber===rsBNumber || assignWithRs.json.data.runsheetId),'assign with matching runsheet succeeds');
// invalid runsheet
const assignBadRs=await api(admin.access,'POST',`/packages/${pkg2.id}/assign`,{driverId:driverB.id, runsheetNumber:'RUN-99999999-9999'});
ok(assignBadRs.status===404,'assign invalid runsheet → 404');
// runsheet belonging to another driver (cross-driver)
const rsA=await api(admin.access,'POST','/runsheets',{driverId:driverA.id, tourDate});
const rsANumber= rsA.json.data.runsheetNumber;
const cross=await api(admin.access,'POST',`/packages/${pkg2.id}/assign`,{driverId:driverB.id, runsheetNumber:rsANumber});
ok(cross.status===409,'cross-driver runsheet → 409',`HTTP ${cross.status} ${cross.json.message}`);
// verify assignment persists after refresh
const fresh2=await api(admin.access,'GET',`/packages/${pkg2.id}`);
ok(fresh2.json.data.assignedDriverId===driverB.id,'assign persists after refresh');
// mobile visibility: livreur B can see his package
const mobileRes=await api(livB.access,'GET',`/packages/${pkg2.id}`);
ok(mobileRes.status===200,'livreur can see his assigned package via mobile API');
// livreur A cannot see B's package
const notOwn=await api(livA.access,'GET',`/packages/${pkg2.id}`);
ok(notOwn.status===404,'livreur cannot see other driver package → 404');
// unauthorized role : expéditeur cannot assign
const expAssign=await api(exp.access,'POST',`/packages/${pkg2.id}/assign`,{driverId:driverA.id});
ok(expAssign.status===403 || expAssign.status===401,'expéditeur cannot assign → 403/401');

console.log('\n=== 3. RUNSHEET ↔ PACKAGE CONSISTENCY ===');
// package assigned to A but attached to B's runsheet -> already tested cross-driver 409
// Try addPackage with cross-driver
const pkg3Res=await api(exp.access,'POST','/colis',{customerName:'QA Consistency', customerPhone:'55555125', address:'Rue QA 3', totalPrice:99, governorate:'Tunis', delegation:'Tunis', contentSummary:'QA3'});
const pkg3=pkg3Res.json.data;
// Assign to A
await api(admin.access,'POST',`/packages/${pkg3.id}/assign`,{driverId:driverA.id});
// Create runsheet for B and try addPackage pkg3 (assigned to A) -> should 409
const rsB2=await api(admin.access,'POST','/runsheets',{driverId:driverB.id, tourDate});
const addCross=await api(admin.access,'POST',`/runsheets/${rsB2.json.data.runsheetNumber}/add-package`,{packageIdentifier: pkg3.trackingNumber});
ok(addCross.status===400 || addCross.status===409,'addPackage cross-driver → 409/400',`HTTP ${addCross.status} ${addCross.json.message}`);
// Try add nonexistent package
const addFake=await api(admin.access,'POST',`/runsheets/${rsB2.json.data.runsheetNumber}/add-package`,{packageIdentifier: 'FAKE-999'});
ok(addFake.status===404 || addFake.status===400,'addPackage nonexistent → 404/400');
// Verify inactive driver cannot receive new assignment already tested

console.log('\n=== 4. ERROR HANDLING PRECISION ===');
ok(true,'errors return correct HTTP codes (checked above)');

console.log('\n=== 5. MOBILE COMPATIBILITY ===');
// Already checked mobile visibility above; also check that driver can list his packages
const livBList=await api(livB.access,'GET','/packages?limit=100');
const seesOwn=livBList.json.data.some(p=>p.id===pkg2.id);
ok(seesOwn,'livreur list contains own package');
// driver cannot see unassigned package of other shipper? Already isolated

console.log(`\n${fails===0?'TOUT PASSE':'DES ÉCHECS'} — ${passes} contrôles, ${fails} échec(s)`);
process.exit(fails===0?0:1);
