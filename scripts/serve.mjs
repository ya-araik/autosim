import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve('public');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml'};
const aliases={'/':'/index.html','/old':'/old.html','/old/':'/old.html','/osn':'/osn.html','/osn/':'/osn.html','/cabinet':'/cabinet.html','/cabinet/':'/cabinet.html'};
createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const path=resolve(root,'.'+(Object.hasOwn(aliases,pathname)?aliases[pathname]:pathname));if(!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404);res.end('Not found');}}).listen(4178,'127.0.0.1',()=>console.log('Autosim preview: http://127.0.0.1:4178'));

