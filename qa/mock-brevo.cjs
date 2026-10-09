// Faux Brevo pour la QA : node qa/mock-brevo.cjs <fichier.jsonl> (port 4599).
const http=require('http');const fs=require('fs');
http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{
 fs.appendFileSync(process.argv[2], JSON.stringify({headers:req.headers,body:JSON.parse(b||'{}')})+'\n');
 res.writeHead(201,{'content-type':'application/json'});res.end('{"messageId":"<x@mock>"}');});}).listen(4599,()=>console.log('mock brevo 4599'));
