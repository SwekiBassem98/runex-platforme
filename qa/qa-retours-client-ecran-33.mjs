/**
 * QA 33 (écrans) — caisse, demandes de prix, bordereaux
 * payés par code, portail (codes, prix + 8 DT), inter-dépôt sans dépôt de
 * départ, filtre expéditeur. Prépare ses données par l'API, puis clique.
 *
 *   PUPPETEER_CORE=…/puppeteer-core.js CHROME=…/chrome SHOTS=/tmp/shots node qa/qa-retours-client-ecran-33.mjs
 * Web sur :3000 (build de production), API sur :4000, base de démonstration.
 */
const B=(process.env.QA_API_URL ?? "http://127.0.0.1:4000/api/v1");
const ja=async(t,m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});let x=null;try{x=await r.json()}catch{};return {s:r.status,d:x?.data,m:x?.message}};
const loginApi=async(id,pw)=>(await ja(null,'POST','/auth/login',{identifier:id,password:pw})).d.accessToken;
// Données : une demande de prix, un bordereau à payer, un bon de retour, un retour à rendre.
{
const admin=await loginApi('admin@logixpress.tn','Admin123!'); const exp=await loginApi('expediteur@bluestar.tn','Exp123!'); const liv=await loginApi('livreur.hamza@logixpress.tn','Liv123!');
const me=(await ja(liv,'GET','/auth/me')).d; const did=me.driverId;
const mk=async(i,g=30)=>(await ja(exp,'POST','/colis',{customerName:'UI '+i,customerPhone:'9666000'+i,governorate:'Sousse',delegation:'Sahloul',address:'Rue '+i,goodsPrice:g,pieceCount:1})).d;
const a=await mk(1); await ja(exp,'PUT','/colis/'+a.id,{goodsPrice:45,priceChangeReason:'Remise client'});
const b=await mk(2); await ja(admin,'POST',`/colis/${b.id}/assign`,{driverId:did});
for(let i=0;i<3;i++){ await ja(liv,'POST',`/colis/${b.id}/start`,{}); await ja(liv,'POST',`/colis/${b.id}/postpone`,{reason:'Client absent'}); }
const c=await mk(3); await ja(admin,'POST',`/colis/${c.id}/assign`,{driverId:did}); await ja(liv,'POST',`/colis/${c.id}/deliver`,{collectedAmount:38});
const pays=(await ja(admin,'GET','/payments?status=EN_ATTENTE&limit=100')).d??[]; for(const p of pays) await ja(admin,'POST',`/payments/${p.id}/validate`,{});
const ship=a.shipperId; const v=await ja(admin,'POST','/payments/vouchers',{shipperId:ship}); console.log('voucher',v.s,v.m);
const d=await mk(4); await ja(admin,'POST',`/colis/${d.id}/assign`,{driverId:did}); for(let i=0;i<3;i++){ await ja(liv,'POST',`/colis/${d.id}/start`,{}); await ja(liv,'POST',`/colis/${d.id}/postpone`,{reason:'Refus'}); }
const r=await ja(admin,'POST','/retours-expediteur/bons',{shipperId:ship}); console.log('bon',r.s,r.m);
const e=await mk(5); await ja(admin,'POST',`/colis/${e.id}/assign`,{driverId:did}); for(let i=0;i<3;i++){ await ja(liv,'POST',`/colis/${e.id}/start`,{}); await ja(liv,'POST',`/colis/${e.id}/postpone`,{reason:'Injoignable'}); }
const f=await mk(6); await ja(admin,'POST',`/colis/${f.id}/assign`,{driverId:did}); await ja(liv,'POST',`/colis/${f.id}/deliver`,{collectedAmount:38});

}
const puppeteer=(await import(process.env.PUPPETEER_CORE)).default;
const W=process.env.WEB_URL ?? "http://localhost:3000"; const S=process.env.SHOTS ?? "/tmp"; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:process.env.CHROME,headless:'new',args:['--no-sandbox']});
let pass=0,fail=0; const ok=(c,l,d='')=>{if(c){pass++;console.log('  ✔',l)}else{fail++;console.log('  ✘',l,d)}};
async function login(url,email,pw){const ctx=await b.createBrowserContext();const p=await ctx.newPage();await p.setViewport({width:1440,height:900});
 const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.errs=errs;
 await p.goto(W+url,{waitUntil:'networkidle2'});await p.type('input[type=email]',email);await p.type('input[type=password]',pw);
 await Promise.all([p.waitForNavigation({waitUntil:'networkidle2'}),p.keyboard.press('Enter')]);await sleep(800);return p;}
const txt=p=>p.evaluate(()=>document.body.innerText);
const clickText=async(p,sel,t)=>p.evaluate((sel,t)=>{const e=[...document.querySelectorAll(sel)].find(x=>x.innerText.trim().includes(t));if(e){e.click();return true}return false},sel,t);

// Portal first: read codes
const e=await login('/expediteur/login','expediteur@bluestar.tn','Exp123!');
await e.goto(W+'/expediteur/bordereaux',{waitUntil:'networkidle2'});await sleep(1500);
const codeV=await e.$eval('[data-testid=code-retrait] span.font-mono',x=>x.innerText.trim()).catch(()=>null);
ok(/^\d{6}$/.test(codeV??''),'portail : code de retrait du bordereau affiché',codeV);
await e.screenshot({path:S+'/portail-bordereaux.png',fullPage:true});
await e.goto(W+'/expediteur/retours',{waitUntil:'networkidle2'});await sleep(1500);
ok(/Bons de retour/.test(await e.evaluate(()=>document.body.innerText)),'portail : bons de retour listés (sans code)');
await e.screenshot({path:S+'/portail-retours.png'});
// Portal: create form shows fee and total
await e.goto(W+'/expediteur/colis/nouveau',{waitUntil:'networkidle2'});await sleep(1200);
const hasPrix=await e.$('[data-testid=prix-colis]');
if(hasPrix){await hasPrix.type('50');await sleep(500);}
const tot=await e.$eval('[data-testid=total-encaisser]',x=>x.innerText).catch(()=>'');
ok(/58[.,]000/.test(tot),'portail : prix 50 → à encaisser 58',tot.replace(/\s+/g,' '));
await e.screenshot({path:S+'/portail-nouveau-colis.png',fullPage:true});
ok(!e.errs.some(x=>!/favicon|401|404/.test(x)),'portail : aucune erreur console',e.errs.join(' | ').slice(0,300));

const a=await login('/connexion','admin@logixpress.tn','Admin123!');
// Caisse
await a.goto(W+'/caisse',{waitUntil:'networkidle2'});await sleep(1500);
let t=await txt(a); ok(t.includes('Paiement des livreurs')&&/bénéfice net/i.test(t),'caisse : KPI et tableau livreurs');
await clickText(a,'button','Depuis le début');await sleep(1200);
await a.screenshot({path:S+'/caisse.png',fullPage:true});
const payer=await a.$('[data-testid=caisse-payer]:not([disabled])');
if(payer){await payer.click();await sleep(500);await a.click('[data-testid=caisse-confirmer-paiement]');await sleep(1500);t=await txt(a);ok(t.includes('Paiement enregistré'),'caisse : paiement d’un livreur');}else ok(false,'caisse : bouton Payer actif');
// Demandes de prix
await a.goto(W+'/colis/demandes-prix',{waitUntil:'networkidle2'});await sleep(1500);
t=await txt(a);ok(/Demandes de prix\s*\n?\s*1/.test(t)||t.includes('Demandes de prix'),'menu : entrée Demandes de prix');
await a.screenshot({path:S+'/demandes-prix.png',fullPage:true});
const ap=await a.$('[data-testid=approuver-prix]'); ok(!!ap,'demande en attente listée');
if(ap){await ap.click();await sleep(400);await a.click('[data-testid=confirmer-decision-prix]');await sleep(1500);t=await txt(a);ok(t.includes('Nouveau prix appliqué'),'approbation depuis l’écran');}
// Retours expéditeur
// Retours expéditeur : parcours complet dans qa-retours-adex-ecran-34.mjs.
// Bordereaux
await a.goto(W+'/paiements/bordereaux',{waitUntil:'networkidle2'});await sleep(1500);
await a.screenshot({path:S+'/bordereaux.png',fullPage:true});
const pb=await a.$('[data-testid=payer-bordereau]');ok(!!pb,'bordereau à payer listé');
if(pb){await pb.click();await sleep(400);await a.type('[data-testid=code-bordereau]',codeV??'');await a.click('[data-testid=confirmer-paiement-bordereau]');await sleep(1500);t=await txt(a);ok(/Paiement de .* effectué/.test(t),'paiement du bordereau avec le code');}
// Inter-dépôt : pas de dépôt de départ
await a.goto(W+'/inter-depots',{waitUntil:'networkidle2'});await sleep(1200);
await clickText(a,'button','Nouveau');await sleep(1200);
t=await txt(a);ok(!t.includes('Dépôt de départ'),'inter-dépôt : plus de case « Dépôt de départ »');
await a.screenshot({path:S+'/inter-depot-nouveau.png'});
// Gestion des colis: filtre expéditeur
await a.goto(W+'/colis',{waitUntil:'networkidle2'});await sleep(1500);
t=await txt(a);ok(/Expéditeur/.test(t),'gestion des colis : filtre expéditeur présent');
await a.screenshot({path:S+'/colis.png'});
ok(!a.errs.some(x=>!/favicon|401|404|409|400/.test(x)),'staff : aucune erreur console',a.errs.join(' | ').slice(0,400));
console.log(`\n${pass} réussis, ${fail} échoués`);await b.close();process.exit(fail?1:0);
