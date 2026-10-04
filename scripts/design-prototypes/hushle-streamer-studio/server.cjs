const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const port = Number(process.argv[2] || process.env.HUSHLE_PROTOTYPE_PORT || 4318);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid prototype port.');
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.png':'image/png','.md':'text/plain; charset=utf-8'};
const allowed = new Set(['index.html','styles.css','app.js','session.mjs','public.html','public.css','public.js','reference-cards.png','analysis.md','test-notes.md']);
const server = http.createServer((request,response)=>{
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end();return;}
  let file;try{file=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname).replace(/^\//,'')||'index.html';}catch{response.writeHead(400);response.end();return;}
  if(file==='favicon.ico'){response.writeHead(204);response.end();return;}
  if(!allowed.has(file)){response.writeHead(404);response.end();return;}
  fs.readFile(path.join(root,file),(error,data)=>{
    if(error){response.writeHead(404);response.end();return;}
    response.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    response.end(request.method==='HEAD'?undefined:data);
  });
});
server.listen(port,'127.0.0.1',()=>process.stdout.write(`Hushle prototype: http://127.0.0.1:${server.address().port}\n`));
