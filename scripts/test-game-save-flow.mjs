import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
class Element {
 constructor(){this.children=[];this.events={};this.dataset={};this.hidden=true;this.textContent='';this.isConnected=true;this.attrs={};}
 append(...items){this.children.push(...items);}prepend(...items){this.children.unshift(...items);}replaceChildren(...items){this.children=items;this.textContent='';}
 addEventListener(type,fn){this.events[type]=fn;}setAttribute(k,v){this.attrs[k]=v;}querySelector(){return null;}focus(){}after(){}
}
const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
get('sim-results-panel').parentElement={children:[get('sim-results-panel'),new Element()]};
const storage=new Map(),token='a'.repeat(43),second='b'.repeat(43),expiresAt=new Date(Date.now()+86400000).toISOString();
const receipt={token,board:'pro',timeMs:107000,season:'e60-sector-2',expiresAt};
let resolveFinish,finishFails=true,savedCalls=0;const requests=[];
const context=vm.createContext({document:{getElementById:id=>id==='drive-leader'?null:get(id),createElement:()=>new Element()},location:{search:''},URLSearchParams,Date,Intl,Map,Number,JSON,Promise,AbortController,setTimeout,clearTimeout,
 RACE_SEASON:'e60-sector-2',localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 fetch:async(url,options)=>{requests.push({url,body:options.body&&JSON.parse(options.body)});let body={};
 if(url.endsWith('/start'))body={token,season:'e60-sector-2'};
 if(url.endsWith('/session'))body={authenticated:false};
 if(url.endsWith('/leaders'))body={items:[]};
 if(url.endsWith('/finish'))return new Promise(resolve=>resolveFinish=()=>resolve({ok:!finishFails,status:finishFails?503:200,json:async()=>finishFails?{error:{message:'Сбой сети'}}:receipt}));
 if(url.endsWith('/save')){savedCalls++;body={saved:true,result:{board:'pro'},rank:1,reward:{available:true}};}
 return {ok:true,status:200,json:async()=>body};
 }});
vm.runInContext(fs.readFileSync('public/game-results.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function').replaceAll('export const','const'),context);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const game=context.createRaceResults({pause(){},retry(){}});
await game.begin({x:0,z:0},'pro','race');
const finishing=game.finish({elapsed:107,x:10,z:10},true,'race');await flush();
assert.equal(get('sim-result-account').hidden,true,'Cannot leave to save before server finish verification');
assert.equal(context.pendingFinish().timeMs,107000,'Durable finish exists before the network response');
resolveFinish();await finishing;
assert.equal(context.pendingResult(),null);assert.equal(context.pendingAttempt().timeMs,107000);
assert.equal(get('sim-result-account').hidden,true);assert.equal(get('sim-verify-result').hidden,false);
// Return to the profile after a failed verification; retry the actual trace,
// never manufacture a score from the local-best HUD number.
finishFails=false;const auth={authenticated:true,csrf:'test-csrf'};
const save1=context.savePendingResult(auth),save2=context.savePendingResult(auth);assert.equal(save1,save2);await flush();resolveFinish();
const saved=await save1;assert.equal(saved.rank,1);assert.equal(savedCalls,1);
assert.equal(context.pendingAttempt(),null);assert.equal(requests.filter(r=>r.url.endsWith('/finish')).length,2);
assert.ok(requests.find(r=>r.url.endsWith('/save')).body.publish);
// A late reply for an earlier finish cannot replace a more recent pending run.
storage.set('autosim.game.finish.v1',JSON.stringify({...receipt,token:second,samples:[[0,0,0],[107000,10,10]]}));
const older=context.verifyPendingFinish({...receipt,samples:[[0,0,0],[107000,10,10]]});await flush();resolveFinish();await older;
assert.equal(context.pendingAttempt().token,second);
storage.clear();await game.finish({elapsed:107,x:10,z:10},false,'race');await flush();assert.equal(get('sim-result-account').hidden,true,'Invalid route cannot offer login-and-save');

const text=e=>e.textContent+' '+e.children.map(text).join(' '),target=new Element();let pending=receipt,autoSaves=0,failSave=false;
const profile=vm.createContext({document:{getElementById:()=>target,createElement:()=>new Element(),addEventListener(){},removeEventListener(){}},RACE_SEASON:'e60-sector-2',Date,gameTime:()=> '01:47.000',pendingAttempt:()=>pending,
 savePendingResult:async()=>{autoSaves++;if(failSave)throw Error('Ошибка сохранения');pending=null;return {saved:true};},renderSavedResult:(el)=>el.append(Object.assign(new Element(),{textContent:'Подтверждено'})),renderReward(){},gameApi:async()=>({history:[],best:[],reward:null}),setInterval:()=>1,clearInterval(){}});
vm.runInContext(fs.readFileSync('public/game-account.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function'),profile);
await profile.showGameHistory(auth,null,{saveOnArrival:true});assert.equal(autoSaves,1);assert.match(text(target),/Подтверждено/);
pending=receipt;failSave=true;await profile.showGameHistory(auth,null,{saveOnArrival:true});assert.match(text(target),/Повторить сохранение/);assert.match(text(target),/Ошибка сохранения/);assert.ok(pending);
await profile.showGameHistory(auth);assert.equal(autoSaves,2,'Ordinary cabinet visit does not publish without an explicit save action');
console.log('PASS: finish-before-login, durable failed finish, profile auto-save with existing session, one save on double-click, visible retry, invalid finish, newer-attempt race.');
