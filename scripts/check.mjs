import {readFile,access,readdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('public');
const html=await readFile('public/index.html','utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'Duplicate HTML IDs');
for(const [,url] of html.matchAll(/(?:href|src)="([^"]+)"/g)){
  if(url.startsWith('#')&&url.length>1) assert(ids.includes(url.slice(1)),`Missing anchor ${url}`);
}
assert(!html.includes('avtosimbot'),'No bot integration in this site');
assert(html.includes('com.smartgamer.app')&&html.includes('tel:+79510308856'),'Booking channels missing');
let links=0;
const files=await readdir(root,{recursive:true,withFileTypes:true});
for(const entry of files.filter(e=>e.isFile()&&/\.(html|css|js)$/.test(e.name))){
  const file=resolve(entry.parentPath,entry.name);
  if(process.argv.includes('--current')&&relative(root,file).split(/[\\/]/)[0]==='editions')continue;
  const text=await readFile(file,'utf8');
  const refs=entry.name.endsWith('.html')?[...text.matchAll(/(?:href|src)="([^"]+)"/g)]:entry.name.endsWith('.css')?[...text.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)]:[...text.matchAll(/(?:from\s*|import\s*\(|new URL\s*\()\s*['"]([^'"]+)['"]/g)];
  for(const [,ref]of refs){
    if(!ref.startsWith('/')&&!ref.startsWith('./')&&!ref.startsWith('../'))continue;
    if(ref.startsWith('//'))continue;
    const url=ref.split(/[?#]/)[0];if(!url)continue;
    if(url.startsWith('/api/'))continue;
    const alias={'/source':'/source.html','/source/':'/source.html','/cabinet':'/cabinet.html','/cabinet/':'/cabinet.html','/osn':'/osn.html','/osn/':'/osn.html','/old':'/old.html','/old/':'/old.html','/adminka':'/adminka.html'}[url]||url;
    const target=ref.startsWith('/')?resolve(root,'.'+alias):resolve(dirname(file),alias);
    assert(!relative(root,target).startsWith('..'),`Public reference escapes root: ${ref}`);
    try{await access(target);}catch{throw new Error(`Missing local dependency ${ref} in ${relative(root,file)}`);}
    links++;
  }
}
console.log(`Public assets, anchors, ${links} local references and booking links verified.`);
