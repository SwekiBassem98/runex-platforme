/** QA 31 — panneau « Retour sonore » (FR/AR, dans l'écran à 390/1024/1440 px) et déconnexion confirmée (portail, profil, exploitation). Web :3000, API :4000, comptes de démonstration. */
const S='/tmp/claude-0/-home-claude/35f819eb-4d88-570b-807e-fc35cd52813c/scratchpad';
const puppeteer=(await import(S+'/e2e/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js')).default;
const W='http://localhost:3000'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0; const ok=(c,l,d='')=>{ if(c){pass++;console.log('  ✔',l)} else {fail++;console.log('  ✘',l,d)} };
const b=await puppeteer.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',headless:'new',args:['--no-sandbox']});
const errs=[];
async function ctx(lang,w,h,mobile){const c=await b.createBrowserContext();const p=await c.newPage();await p.setViewport({width:w,height:h,isMobile:mobile,hasTouch:mobile});await p.evaluateOnNewDocument(l=>{try{localStorage.setItem('runex.langue',l)}catch{}},lang);p.on('pageerror',e=>errs.push(e.message));return p;}
async function login(p,url,e,pw,dest){await p.goto(W+url,{waitUntil:'networkidle2'});await p.type('input[type=email]',e);await p.type('input[type=password]',pw);await Promise.all([p.waitForNavigation({waitUntil:'networkidle2'}).catch(()=>{}),p.click('button[type=submit]')]);await sleep(1500);}
async function popupCheck(p,label,shot){
  await p.click('[data-testid=sound-settings]'); await sleep(400);
  const r=await p.$eval('[data-testid=sound-popup]',e=>{const b=e.getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom,vw:innerWidth,vh:innerHeight,txt:e.innerText}});
  ok(r.l>=0&&r.r<=r.vw&&r.t>=0&&r.b<=r.vh,`${label} : panneau dans l'écran`,JSON.stringify({l:r.l,r:r.r,t:r.t,b:r.b,vw:r.vw}));
  await p.screenshot({path:S+'/'+shot}); return r;
}
console.log('1. Portail, téléphone, arabe');
let p=await ctx('ar',390,844,true); await login(p,'/expediteur/login','expediteur@bluestar.tn','Exp123!');
let r=await popupCheck(p,'AR 390','son-ar-390.png');
ok(/التنبيهات الصوتية/.test(r.txt)&&/مستوى الصوت/.test(r.txt)&&!/Retour sonore|Volume|Succès|Erreur|iPhone, le/.test(r.txt),'panneau en arabe',r.txt.slice(0,120));
await p.click('[aria-label="إغلاق"]'); await sleep(300); ok(!(await p.$('[data-testid=sound-popup]')),'bouton fermer');
console.log('2. Portail, ordinateur, arabe et français');
let q=await ctx('ar',1440,900,false); await login(q,'/expediteur/login','expediteur@bluestar.tn','Exp123!'); await popupCheck(q,'AR 1440','son-ar-1440.png');
let q2=await ctx('fr',1024,768,false); await login(q2,'/expediteur/login','expediteur@bluestar.tn','Exp123!'); r=await popupCheck(q2,'FR 1024','son-fr-1024.png'); ok(/Retour sonore/.test(r.txt),'panneau en français');
console.log('3. Exploitation, téléphone');
let a=await ctx('fr',390,844,true); await login(a,'/connexion','admin@logixpress.tn','Admin123!'); await popupCheck(a,'staff 390','son-staff-390.png');
console.log('4. Déconnexion confirmée');
// portail desktop arabe : barre latérale
await q.keyboard.press('Escape'); await sleep(200);
const btn=await q.$('aside [aria-label]:is([aria-label*="خروج"],[aria-label*="déconnect"])') ?? (await q.$$('button')).at(-1);
const lab=await q.$$eval('button',bs=>bs.map(b=>b.getAttribute('aria-label')).filter(Boolean)); 
const dec=(await q.$$('button')); let clicked=false;
for(const x of dec){const l=await x.evaluate(e=>e.getAttribute('aria-label')||''); if(/خروج|connect/i.test(l)){await x.click();clicked=true;break;}}
await sleep(500); let t=await q.evaluate(()=>document.body.innerText);
ok(clicked&&/تسجيل الخروج؟/.test(t)&&/البقاء متصلًا/.test(t),'portail AR : confirmation affichée',lab.join('|').slice(0,200));
await q.screenshot({path:S+'/logout-ar.png'});
for(const x of await q.$$('button')){if((await x.evaluate(e=>e.innerText.trim()))==='البقاء متصلًا'){await x.click();break;}}
await sleep(800); ok(q.url().includes('/expediteur/tableau-de-bord'),'« rester connecté » : session conservée',q.url());
// profil : bouton se déconnecter
await q2.goto(W+'/expediteur/profil',{waitUntil:'networkidle2'}); await sleep(800);
for(const x of await q2.$$('main button')){if(/Se déconnecter/.test(await x.evaluate(e=>e.innerText))){await x.click();break;}}
await sleep(500); t=await q2.evaluate(()=>document.body.innerText); ok(/Se déconnecter \?/.test(t),'profil FR : confirmation affichée');
const conf=(await q2.$$('[role=dialog] button')); for(const x of conf){if((await x.evaluate(e=>e.innerText.trim()))==='Se déconnecter'){await x.click();break;}}
await sleep(2500); ok(/login/.test(q2.url()),'confirmer : déconnecté',q2.url());
// exploitation desktop
let d=await ctx('fr',1440,900,false); await login(d,'/connexion','admin@logixpress.tn','Admin123!');
for(const x of await d.$$('button')){const l=await x.evaluate(e=>e.getAttribute('aria-label')||''); if(/connect/i.test(l)){await x.click();break;}}
await sleep(500); t=await d.evaluate(()=>document.body.innerText); ok(/Se déconnecter \?/.test(t),'exploitation : confirmation affichée');
await d.screenshot({path:S+'/logout-staff.png'});
for(const x of await d.$$('[role=dialog] button')){if((await x.evaluate(e=>e.innerText.trim()))==='Se déconnecter'){await x.click();break;}}
await sleep(2500); ok(/connexion/.test(d.url()),'exploitation : déconnecté après confirmation',d.url());
console.log('Erreurs JS :',errs); console.log(`${pass} réussis, ${fail} échoués`); await b.close();
