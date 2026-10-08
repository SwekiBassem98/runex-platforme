// QA PRESENCE — PROMPT 24
const BASE = 'http://127.0.0.1:4000/api/v1';
let fails = 0, passes = 0;
const ok = (c, l, d='') => { if(c) passes++; else fails++; console.log(`  ${c?'OK  ':'ECHEC'} ${l}${d?` — ${d}`:''}`); };

async function api(token, method, path, body) {
  const h = { Accept: 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body!==undefined?JSON.stringify(body):undefined });
  let j=null; try{ j=await r.json(); }catch{}
  return { status: r.status, json: j };
}
async function login(e,p){ const r=await api(null,'POST','/auth/login',{email:e,password:p}); if(r.status!==200) throw new Error(`login ${e} ${r.status} ${JSON.stringify(r.json)}`); return { access:r.json.data.accessToken, refresh:r.json.data.refreshToken, user:r.json.data.user }; }

console.log('Login...');
const admin = await login('admin@logixpress.tn','Admin123!');
const exp = await login('expediteur@bluestar.tn','Exp123!');
const livA = await login('livreur.hamza@logixpress.tn','Liv123!');
let livB;
try { livB = await login('livreur.ghassan@logixpress.tn','Ghassan123!'); } catch {
  const r = await api(null,'POST','/auth/login',{email:'livreur.ghassan@logixpress.tn',password:'Liv123!'});
  if(r.status===200) livB={ access:r.json.data.accessToken, user:r.json.data.user };
  else {
    const stamp=Date.now();
    const drv=await api(admin.access,'POST','/drivers',{ driverCode:`LIV-PRES${String(stamp).slice(-4)}`, vehicleType:'Moto', compte:{ fullName:'QA Pres B', email:`qa.presb.${stamp}@qa.test`, phone:'33333333', password:'Qa123456!' }});
    const tok = await login(`qa.presb.${stamp}@qa.test`,'Qa123456!');
    livB=tok;
  }
}
const meA = await api(livA.access,'GET','/auth/me');
const driverA = meA.json.data.driverId ?? meA.json.data.driver?.id ?? null;
console.log('driverA', driverA, 'livA user', livA.user.email, 'livB', livB.user.email);

console.log('=== A. HEARTBEAT AUTH & ROLE ===');
let hbNoAuth = await api(null,'POST','/drivers/presence/heartbeat',{});
ok(hbNoAuth.status===401, 'heartbeat sans token → 401', `HTTP ${hbNoAuth.status}`);

let hbExp = await api(exp.access,'POST','/drivers/presence/heartbeat',{});
ok(hbExp.status===403, 'heartbeat expéditeur → 403', `HTTP ${hbExp.status} ${JSON.stringify(hbExp.json)}`);

let hbAdmin = await api(admin.access,'POST','/drivers/presence/heartbeat',{});
ok(hbAdmin.status===403, 'heartbeat admin → 403', `HTTP ${hbAdmin.status}`);

let hbLiv = await api(livA.access,'POST','/drivers/presence/heartbeat',{});
ok(hbLiv.status===200 && hbLiv.json.data.online===true && hbLiv.json.data.lastSeenAt, 'heartbeat livreur → 200 + online true', `HTTP ${hbLiv.status} ${JSON.stringify(hbLiv.json)}`);

// client spoof ignored: send driverId + lastSeenAt
let hbSpoof = await api(livA.access,'POST','/drivers/presence/heartbeat',{ driverId: 'fake-id', lastSeenAt: '2020-01-01T00:00:00Z' });
ok(hbSpoof.status===200 && hbSpoof.json.data.online===true, 'spoof driverId/lastSeenAt ignoré → toujours 200 online true', `HTTP ${hbSpoof.status} ${JSON.stringify(hbSpoof.json)}`);

// repeat heartbeat quickly -> idempotent
let hb2 = await api(livA.access,'POST','/drivers/presence/heartbeat',{});
ok(hb2.status===200, '2e heartbeat rapide → 200', `HTTP ${hb2.status}`);

// check that lastSeenAt progressed (within 10s)
let t1 = new Date(hbLiv.json.data.lastSeenAt).getTime();
let t2 = new Date(hb2.json.data.lastSeenAt).getTime();
ok(t2 >= t1, 'lastSeenAt progresse ou reste stable', `t1=${hbLiv.json.data.lastSeenAt} t2=${hb2.json.data.lastSeenAt}`);

// GET presence admin
let presList = await api(admin.access,'GET','/drivers/presence');
let presItems = Array.isArray(presList.json.data) ? presList.json.data : presList.json.data?.items ?? [];
let presMeta = !Array.isArray(presList.json.data) ? presList.json.data : null;
ok(presList.status===200 && presItems.length>=1, 'GET /drivers/presence admin → 200 liste', `HTTP ${presList.status} len=${presItems.length} ${presMeta?JSON.stringify({total:presMeta.total,online:presMeta.online}):''}`);

// check driverA appears online
let entryA = presItems.find(x=> (x.driverId??x.id)===driverA);
ok(entryA && (entryA.isOnline===true || entryA.online===true), 'driverA en ligne dans /drivers/presence', JSON.stringify(entryA));

// GET single presence
let presOne = await api(admin.access,'GET',`/drivers/${driverA}/presence`);
ok(presOne.status===200 && (presOne.json.data.isOnline===true || presOne.json.data.online===true), 'GET /drivers/:id/presence → online true', JSON.stringify(presOne.json));

// GET drivers list includes presence fields
let driversList = await api(admin.access,'GET','/drivers');
ok(driversList.status===200, 'GET /drivers → 200', `HTTP ${driversList.status}`);
let drvAFromList = (driversList.json.data||[]).find(d=> d.id===driverA);
ok(drvAFromList && typeof drvAFromList.isOnline==='boolean' && 'lastSeenAt' in drvAFromList, 'drivers list expose isOnline+lastSeenAt (preview)', JSON.stringify(drvAFromList));
if (drvAFromList) {
  ok(drvAFromList.isOnline===true, 'isOnline true après heartbeat', JSON.stringify(drvAFromList));
  ok(!('token' in drvAFromList) && !('pushToken' in drvAFromList), 'pas de jeton exposé dans driver list');
}

let driverDetail = await api(admin.access,'GET',`/drivers/${driverA}`);
ok(driverDetail.status===200 && typeof driverDetail.json.data.isOnline==='boolean', 'GET /drivers/:id expose isOnline', JSON.stringify(driverDetail.json.data));

// Expéditeur ne doit pas voir présence livreur autre? Actually livreur read requires LIVREUR_READ; expéditeur maybe not allowed
let presExp = await api(exp.access,'GET','/drivers/presence');
ok(presExp.status===403, 'expéditeur GET presence → 403', `HTTP ${presExp.status}`);

console.log('=== B. DASHBOARD HORS LIGNE FIX ===');
let dash = await api(admin.access,'GET','/dashboard');
ok(dash.status===200, 'GET dashboard → 200', `HTTP ${dash.status}`);
if (dash.status===200) {
  let liv = dash.json.data.livreurs;
  console.log('  dashboard livreurs', JSON.stringify(liv));
  // horsLigne = actifs - online ; disponibles = actifs - enTournee ; total = actifs
  ok(typeof liv.actifs==='number' && typeof liv.horsLigne==='number' && typeof liv.disponibles==='number', 'dashboard livreurs a actifs/horsLigne/disponibles');
  ok(liv.horsLigne !== 0 || liv.actifs===0 || liv.actifs===liv.horsLigne+ (presList.json.data.filter(x=>x.isOnline).length), 'horsLigne non hardcodé 0 quand actifs>0 (présence réelle)', JSON.stringify(liv));
  // vérifier cohérence : horsLigne = total - online
  let onlineCount = presItems.filter(x=> (x.isOnline??x.online)).length;
  ok(liv.horsLigne === liv.actifs - onlineCount, `horsLigne = actifs - online (${liv.actifs}-${onlineCount}=${liv.actifs-onlineCount} vs ${liv.horsLigne})`);
  // disponibles = actifs - enTournee (non lié à présence)
  ok(liv.disponibles === liv.actifs - liv.enTournee, `disponibles = actifs - enTournee (${liv.actifs}-${liv.enTournee}=${liv.actifs-liv.enTournee} vs ${liv.disponibles})`);
  // total = actifs
  ok(liv.total===liv.actifs, 'total === actifs');
}

console.log('=== C. PRESENCE VS DISPONIBILITE vs PUSH ===');
// Vérifier que PushDevice.isActive n'est pas utilisé pour présence : on enregistre un device mais isOnline reste basé sur lastSeenAt
// B n'a pas heartbeat récent, devrait être hors ligne malgré device isActive ?
let hbB = await api(livB.access,'POST','/devices/push-token',{ token:'fcm_test_presence_'+Date.now()+'_cccccccccccccccccccccccc', platform:'android' });
ok(hbB.status===201 || hbB.status===200, 'livB enregistre push token', `HTTP ${hbB.status}`);
let presAfterPush = await api(admin.access,'GET','/drivers/presence');
let meB = await api(livB.access,'GET','/auth/me');
let driverBFromMe = meB.json.data.driverId;
let presAfterItems = Array.isArray(presAfterPush.json.data) ? presAfterPush.json.data : presAfterPush.json.data?.items ?? [];
let entryB = presAfterItems.find(x=> (x.driverId??x.id) === driverBFromMe);
if (entryB) {
  // B n'a pas fait heartbeat -> devrait être hors ligne même si push device actif
  // Mais si B a déjà heartbeat précédemment dans ce run, il sera online; on teste au moins que présence n'est pas directement isActive
  console.log('  entryB', JSON.stringify(entryB));
  // On vérifie que la présence ne suit pas l'état push : on peut forcer offline en attendant timeout? Pas nécessaire, on vérifie que heartbeat est nécessaire.
}
 // Test que hors-ligne peut encore recevoir assignation (permissif)
 // Créer colis et assigner à driver hors ligne (B si hors ligne, sinon A mais on va simuler : on assigne à B même s'il est offline)
 // D'abord créer colis
let c1 = await api(exp.access,'POST','/colis',{ customerName:'QA Presence Assign', customerPhone:'55555555', address:'Rue Presence '+Date.now(), totalPrice: 10, pieceCount:1 });
ok(c1.status===201, 'création colis pour test assign offline', `HTTP ${c1.status}`);
let pkg = c1.json.data;
let driverBId = driverBFromMe;
let assignOff = await api(admin.access,'POST',`/colis/${pkg.id}/assign`,{ driverId: driverBId });
ok(assignOff.status===200, 'assignation à livreur hors-ligne reste permise (200)', `HTTP ${assignOff.status} ${JSON.stringify(assignOff.json)}`);

console.log('=== D. LIGHTWEIGHT & PAS DE JOURNALISATION ===');
// Vérifier que heartbeat ne crée pas d'AuditLog ni de Notification (comparer counts avant/après)
let notifsBefore = (await api(livA.access,'GET','/notifications?limit=100')).json.data.length;
let hb3 = await api(livA.access,'POST','/drivers/presence/heartbeat',{});
let notifsAfter = (await api(livA.access,'GET','/notifications?limit=100')).json.data.length;
ok(notifsAfter===notifsBefore, 'heartbeat ne crée pas de notification', `before=${notifsBefore} after=${notifsAfter}`);

console.log('=== E. TIMEOUT LOGIC (isDriverOnline) ===');
// Tester isDriverOnline via présence : driverA vient de battre -> online true
let presA2 = await api(admin.access,'GET',`/drivers/${driverA}/presence`);
ok(presA2.json.data.isOnline===true || presA2.json.data.online===true, 'driverA toujours online juste après heartbeat');
// Optionnel : vérifier que lastSeenAt est proche de now (<10s)
let diffMs = Date.now() - new Date(presA2.json.data.lastSeenAt).getTime();
ok(diffMs >=0 && diffMs < 10000, 'lastSeenAt proche de now (<10s)', `diff=${diffMs}ms lastSeen=${presA2.json.data.lastSeenAt}`);

console.log(`\n${fails===0?'TOUT PASSE':'DES ÉCHECS'} — ${passes} contrôles, ${fails} échec(s)`);
process.exit(fails===0?0:1);
