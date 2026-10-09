/**
 * QA 29 — mot de passe : changement (connecté) et réinitialisation par courriel.
 *
 * Prérequis : API locale sur :4000, base de démonstration fraîche, et un faux
 * Brevo qui écrit chaque requête dans <dossier>/mails.jsonl :
 *   BREVO_API_KEY=test-key MAIL_FROM_EMAIL=noreply@runex.test
 *   BREVO_API_URL=http://127.0.0.1:4599/v3/smtp/email
 *   WEB_APP_URL=https://runex-platforme.vercel.app
 */
import fs from 'fs';
// Usage : node qa/qa-mot-de-passe-29.mjs <dossier>  — <dossier>/mails.jsonl reçoit les courriels
// d'un faux Brevo (BREVO_API_URL=http://127.0.0.1:4599/v3/smtp/email, voir l'en-tête).
const S=process.argv[2]; const B='http://127.0.0.1:4000/api/v1';
let pass=0,fail=0; const ok=(c,l,d='')=>{ if(c){pass++;console.log('  ✔',l)} else {fail++;console.log('  ✘',l,d)} };
const j=async(t,m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});let x=null;try{x=await r.json()}catch{};return {s:r.status,d:x?.data,m:x?.message}};
const login=async(id,pw)=>{const r=await j(null,'POST','/auth/login',{identifier:id,password:pw});return r.d?.accessToken??null};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mails=()=>fs.existsSync(S+'/mails.jsonl')?fs.readFileSync(S+'/mails.jsonl','utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
const EMAIL='expediteur@bluestar.tn', P0='Exp123!', P1='Nouveau-Pass-2026', P2='Encore-Un-2026!';

console.log('1. Changement de mot de passe (connecté)');
const t1=await login(EMAIL,P0); const t2=await login(EMAIL,P0); ok(t1&&t2,'deux sessions ouvertes');
ok((await j(null,'POST','/auth/change-password',{currentPassword:P0,newPassword:P1})).s===401,'sans session : 401');
let r=await j(t1,'POST','/auth/change-password',{currentPassword:'faux-faux',newPassword:P1}); ok(r.s===400 && /actuel est incorrect/.test(r.m),'mot de passe actuel faux : 400',r.m);
r=await j(t1,'POST','/auth/change-password',{currentPassword:P0,newPassword:'court'}); ok(r.s===400 && /8 caractères/.test(r.m),'trop court : 400',r.m);
r=await j(t1,'POST','/auth/change-password',{currentPassword:P0,newPassword:P0+'x'.repeat(0)}); ok(r.s===400,'identique à l’actuel : 400',r.m);
r=await j(t1,'POST','/auth/change-password',{currentPassword:P0,newPassword:P1}); ok(r.s===200 && r.d?.otherSessionsClosed>=1,'changement accepté, autres sessions fermées',JSON.stringify(r));
ok((await j(t1,'GET','/auth/me')).s===200,'la session courante reste ouverte');
ok((await j(t2,'GET','/auth/me')).s===401,'l’autre session est fermée');
ok(!(await login(EMAIL,P0)),'l’ancien mot de passe ne marche plus');
ok(!!(await login(EMAIL,P1)),'le nouveau mot de passe marche');

console.log('2. Réinitialisation par courriel');
const n0=mails().length;
r=await j(null,'POST','/auth/password-reset/request',{email:'EXPEDITEUR@bluestar.tn '}); ok(r.s===200,'demande acceptée (casse/espaces)',r.m);
await sleep(800);
let ms=mails(); ok(ms.length===n0+1,'un courriel envoyé à Brevo',ms.length-n0);
const mail=ms.at(-1);
ok(mail?.headers['api-key']==='test-key','clé API Brevo transmise');
ok(mail?.body.to?.[0]?.email===EMAIL && mail.body.sender?.email==='noreply@runex.test','destinataire et expéditeur corrects',JSON.stringify(mail?.body.to));
ok(/Réinitialisation/.test(mail?.body.subject) && /إعادة/.test(mail?.body.htmlContent),'sujet et contenu bilingues');
const link=(mail?.body.textContent.match(/https:\/\/\S+/)||[])[0]; ok(link?.startsWith('https://runex-platforme.vercel.app/reinitialisation?token=') && /espace=expediteur/.test(link),'lien vers le site, espace expéditeur',link);
const token=decodeURIComponent(new URL(link).searchParams.get('token'));
r=await j(null,'POST','/auth/password-reset/request',{email:'personne@nulle-part.tn'}); ok(r.s===200,'adresse inconnue : même réponse');
await sleep(500); ok(mails().length===n0+1,'aucun courriel pour une adresse inconnue');
r=await j(null,'POST','/auth/password-reset/confirm',{token,newPassword:'court'}); ok(r.s===400,'confirmation trop courte refusée');
r=await j(null,'POST','/auth/password-reset/confirm',{token:token+'x',newPassword:P2}); ok(r.s===400,'jeton altéré refusé');
const t3=await login(EMAIL,P1);
r=await j(null,'POST','/auth/password-reset/confirm',{token,newPassword:P2}); ok(r.s===200,'nouveau mot de passe enregistré',r.m);
ok((await j(t3,'GET','/auth/me')).s===401,'toutes les sessions sont fermées');
ok(!!(await login(EMAIL,P2)),'connexion avec le mot de passe réinitialisé');
r=await j(null,'POST','/auth/password-reset/confirm',{token,newPassword:'Troisieme-2026'}); ok(r.s===400,'le lien ne sert qu’une fois');

console.log('3. Livreur : lien « espace=livreur »');
await j(null,'POST','/auth/password-reset/request',{email:'livreur.hamza@logixpress.tn'}); await sleep(800);
const ml=mails().at(-1); ok(ml?.body.to?.[0]?.email==='livreur.hamza@logixpress.tn' && /espace=livreur/.test(ml.body.textContent) && /application RUNEX Livreur/.test(ml.body.htmlContent),'courriel livreur avec consigne appli');

// Le mot de passe de démonstration (7 caractères) ne peut plus être choisi :
// le compte garde P2. Réinitialiser la base de QA pour revenir aux comptes de démo.
const t4=await login(EMAIL,P2); r=await j(t4,'POST','/auth/change-password',{currentPassword:P2,newPassword:P0});
ok(r.s===400,'un mot de passe de moins de 8 caractères est refusé',r.m);
console.log('  ℹ compte '+EMAIL+' laissé avec le mot de passe '+P2);
console.log(`\n${pass} réussis, ${fail} échoués`); process.exit(fail?1:0);
