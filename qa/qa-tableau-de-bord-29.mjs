/** QA 29 — `GET /shipper/dashboard` : cloisonnement et périodes. API locale sur :4000. */
const B='http://127.0.0.1:4000/api/v1';
const j=async(t,p)=>{const r=await fetch(B+p,{headers:t?{Authorization:'Bearer '+t}:{}});return {s:r.status,b:await r.json().catch(()=>null)}};
const login=async(id,pw)=>{const r=await fetch(B+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:id,password:pw})});return (await r.json()).data.accessToken};
const exp=await login('expediteur@bluestar.tn','Exp123!'); const admin=await login('admin@logixpress.tn','Admin123!');
const r=await j(exp,'/shipper/dashboard?days=14'); console.log(r.s, JSON.stringify(r.b?.data ?? r.b, null, 1).slice(0,2500));
console.log('admin', (await j(admin,'/shipper/dashboard')).s, 'anon', (await j(null,'/shipper/dashboard')).s);
for (const d of [7,30,90,5]) { const x=await j(exp,'/shipper/dashboard?days='+d); console.log(d, x.s, x.b?.data?.periodDays, x.b?.data?.daily?.length); }
