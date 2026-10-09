/**
 * QA 30 — chaque tableau affiche ses valeurs sous le bon en-tête.
 *
 * Parcourt les écrans de l'exploitation et du portail à 1440, 1024, 768 et
 * 390 px : pour chaque tableau visible, le nombre de cellules visibles de
 * chaque ligne doit égaler le nombre d'en-têtes visibles (une colonne masquée
 * en en-tête mais pas en cellule décale toutes les valeurs). Signale aussi les
 * codes bruts affichés (EN_ATTENTE, ALL, undefined…).
 *
 *   PUPPETEER_CORE=…/puppeteer-core.js CHROME=…/chrome node qa/qa-tableaux-30.mjs [dump]
 * `dump` affiche, pour la première ligne de chaque tableau, « [en-tête] = valeur ».
 * Web sur :3000 (build de production), API sur :4000, comptes de démonstration.
 */
const puppeteer=(await import(process.env.PUPPETEER_CORE)).default;
const W='http://localhost:3000'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:process.env.CHROME,headless:'new',args:['--no-sandbox']});
const STAFF=['/dashboard','/colis','/runsheets','/ramassages','/paiements','/paiements/bordereaux','/paiements/expediteurs','/paiements/livreurs','/inter-depots','/inter-depots/acceptation','/inter-depots/retours','/inventaire','/magasin','/audit','/rapports','/admin/utilisateurs','/admin/livreurs','/admin/expediteurs','/admin/zones','/finance','/recherche?q=2610'];
const PORTAL=['/expediteur/tableau-de-bord','/expediteur/suivi','/expediteur/notifications','/expediteur/profil','/expediteur/colis','/expediteur/ramassages','/expediteur/bordereaux','/expediteur/retours','/expediteur/echanges','/expediteur/activites'];
const dump=process.argv[2]==='dump';
async function audit(p,path,width){
  await p.setViewport({width,height:900}); await p.goto(W+path,{waitUntil:'networkidle2'}); await sleep(1800);
  return p.evaluate((dump)=>{
    const vis=e=>{const cs=getComputedStyle(e);return cs.display!=='none'&&cs.visibility!=='hidden'};
    const out=[];
    document.querySelectorAll('table').forEach((t,ti)=>{
      if(!vis(t)||t.offsetParent===null) return;
      const hr=t.querySelector('thead tr'); if(!hr) return;
      const H=[...hr.children].filter(vis);
      const Hn=H.reduce((s,c)=>s+(c.colSpan||1),0);
      const rows=[...t.querySelectorAll('tbody > tr')].filter(r=>vis(r)&&![...r.children].some(c=>c.colSpan>1));
      rows.forEach((r,ri)=>{const n=[...r.children].filter(vis).length; if(n!==Hn) out.push(`table#${ti} row${ri}: ${n} cellules visibles / ${Hn} en-têtes`);});
      if(dump&&rows[0]){const c=[...rows[0].children].filter(vis); out.push(`table#${ti} `+H.map((h,i)=>`[${h.innerText.trim()||'·'}] = ${(c[i]?.innerText||'').replace(/\s+/g,' ').trim().slice(0,45)}`).join(' | '));}
      if(!rows.length) out.push(`table#${ti}: aucune ligne de données`);
    });
    const txt=document.querySelector('main')?.innerText ?? document.body.innerText;
    const champs=[...document.querySelectorAll('input,select')].filter(vis).map(e=>e.tagName==='SELECT'?e.options[e.selectedIndex]?.text:e.value).join(' ');
    const bruts=(txt+' '+champs).match(/\b(undefined|null|NaN|Invalid Date|\[object Object\]|ALL|[A-Z]{3,}_[A-Z_]{3,}|CONFIRME|EN_ATTENTE|EFFECTUE|ANNULE|LIVRE|CREE)\b/g);
    if(bruts) out.push('TEXTE BRUT : '+[...new Set(bruts)].join(', '));
    return out;
  },dump);
}
async function login(p,url,email,pw){await p.goto(W+url,{waitUntil:'networkidle2'});await p.type('input[type=email]',email);await p.type('input[type=password]',pw);await Promise.all([p.waitForNavigation({waitUntil:'networkidle2'}).catch(()=>{}),p.click('button[type=submit]')]);}
let problems=0;
for (const [who,url,email,pw,pages] of [['admin','/connexion','admin@logixpress.tn','Admin123!',STAFF],['expediteur','/expediteur/login','expediteur@bluestar.tn','Exp123!',PORTAL]]){
  const ctx=await b.createBrowserContext(); const p=await ctx.newPage(); await p.setViewport({width:1440,height:900}); await login(p,url,email,pw);
  for (const path of pages) for (const w of (dump?[1440]:[1440,1024,768,390])){
    const r=await audit(p,path,w); const bad=r.filter(x=>x.includes('cellules')||x.startsWith('TEXTE BRUT'));
    problems+=bad.length;
    if(dump) console.log(`\n## ${path}\n`+r.join('\n')); else if(bad.length) console.log(`✘ ${who} ${path} @${w}: ${bad.slice(0,3).join(' ; ')}`);
  }
}
console.log(dump?'':`\nIncohérences : ${problems}`); await b.close(); process.exit(problems?1:0);
