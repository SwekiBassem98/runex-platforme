import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

async function login(e,p){
  const r=await fetch('http://127.0.0.1:4000/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:p})});
  const j=await r.json();
  return j.data.accessToken;
}

const tokA = await login('livreur.hamza@logixpress.tn','Liv123!');
const tokB = await login('livreur.ghassan@logixpress.tn','Ghassan123!').catch(async()=> (await fetch('http://127.0.0.1:4000/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'livreur.ghassan@logixpress.tn',password:'Liv123!'})}).then(r=>r.json()).then(j=>j.data?.accessToken)) );

let fails=0, passes=0;
const ok=(c,l,d='')=>{ if(c) passes++; else fails++; console.log(`  ${c?'OK  ':'ECHEC'} ${l}${d?` — ${d}`:''}`); };

// 1. Sans token → doit échouer
await new Promise(res=>{
  const s=io('http://127.0.0.1:4000',{ path:'/socket.io', transports:['websocket'] });
  let done=false;
  s.on('connect_error', err=>{
    if(!done){ done=true; ok(err.message.includes('Jeton')||err.message.includes('401')||err.data?.code==='4401','socket sans token rejeté',err.message.slice(0,80)); s.close(); res(); }
  });
  s.on('connect', ()=>{ if(!done){ done=true; ok(false,'socket sans token ne doit pas connecter'); s.close(); res(); }});
  setTimeout(()=>{ if(!done){ done=true; ok(false,'timeout sans token'); s.close(); res(); }}, 3000);
});

// 2. Avec token valide → connecte et reçoit READY
let sockA;
await new Promise(res=>{
  sockA=io('http://127.0.0.1:4000',{ path:'/socket.io', auth:{token:tokA}, transports:['websocket'] });
  sockA.on('socket:ready', d=>{ ok(d.userId, 'socket A reçoit socket:ready', JSON.stringify(d).slice(0,60)); res(); });
  sockA.on('connect_error', e=>{ ok(false,'socket A connect_error',e.message); res(); });
  setTimeout(()=>{ ok(false,'timeout socket A'); res(); },3000);
});

// 3. A ne doit pas recevoir notif de B : on envoie une notif à B via API (assign colis à B), A ne doit pas la voir
await new Promise(async res=>{
  let aGot=false;
  const handler = (payload)=>{ aGot=true; };
  sockA.on('notification:new', handler);
  // créer colis et l'assigner à B
  const adminTok=await login('admin@logixpress.tn','Admin123!');
  const expTok=await login('expediteur@bluestar.tn','Exp123!');
  const meB=await fetch('http://127.0.0.1:4000/api/v1/auth/me',{headers:{Authorization:`Bearer ${tokB}`}}).then(r=>r.json());
  const driverB=meB.data.driverId;
  const c=await fetch('http://127.0.0.1:4000/api/v1/colis',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${expTok}`},body:JSON.stringify({customerName:'Sock Test',customerPhone:'55555555',address:'Rue Sock',totalPrice:10})}).then(r=>r.json());
  await fetch(`http://127.0.0.1:4000/api/v1/colis/${c.data.id}/assign`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${adminTok}`},body:JSON.stringify({driverId:driverB})});
  // attendre 1s pour voir si A reçoit quelque chose destiné à B
  setTimeout(()=>{
    ok(!aGot, 'A ne reçoit pas la notif destinée à B (cloisonnement rooms)');
    sockA.off('notification:new', handler);
    res();
  }, 1500);
});

sockA.close();
console.log(`\n${fails===0?'TOUT PASSE':'DES ÉCHECS'} — ${passes} contrôles, ${fails} échec(s)`);
process.exit(fails===0?0:1);
