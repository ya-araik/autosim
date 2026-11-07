// Entry-state regression checks with delayed responses, no network or real account.
import {JSDOM} from 'jsdom';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const scenario=process.argv[2];
if(!scenario){
  for(const name of ['signed-in','signed-out','network-error','session-expired']){
    const child=spawnSync(process.execPath,[import.meta.filename,name],{encoding:'utf8'});
    process.stdout.write(child.stdout);process.stderr.write(child.stderr);
    assert.equal(child.status,0,name);
  }
  process.exit();
}
const dom=new JSDOM(fs.readFileSync('public/cabinet.html','utf8'),{url:'https://qa.test/cabinet',pretendToBeVisual:true});
for(const key of ['window','document','location','localStorage','HTMLElement','HTMLDialogElement'])globalThis[key]=dom.window[key];
globalThis.IntersectionObserver=class{observe(){} disconnect(){}};
globalThis.setInterval=()=>0;
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
dom.window.HTMLElement.prototype.scrollIntoView=function(){};
const auth=document.getElementById('auth-view'),member=document.getElementById('member-view'),loading=document.getElementById('member-loading');
let finishSession,failSession,finishDashboard,requests=[],authRevealed=0;
const hidden=Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype,'hidden');
Object.defineProperty(auth,'hidden',{get(){return hidden.get.call(this)},set(value){if(!value)authRevealed++;hidden.set.call(this,value);}});
globalThis.fetch=async path=>{
  requests.push(path);
  if(path==='/api/member/session')return new Promise((resolve,reject)=>{finishSession=data=>resolve({ok:true,json:async()=>data});failSession=reject;});
  if(path==='/api/member/me')return new Promise(resolve=>{finishDashboard=data=>resolve({ok:true,status:200,json:async()=>data});});
  return {ok:false,status:503,json:async()=>({error:{message:'QA secondary service unavailable'}})};
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const boot=import('../public/member.js?qa='+scenario);
for(let n=0;n<100&&!finishSession;n++)await tick();
assert.ok(finishSession,'session request started');
assert.ok(auth.hidden&&member.hidden&&!loading.hidden,'only neutral loading until session resolves');
assert.deepEqual(requests,['/api/member/session'],'no schedule/history requests ahead of identity');
const user={name:'QA Pilot',phone:'',birthDate:'',pilotNumber:'AS-TEST',createdAt:'2026-09-20T00:00:00Z',version:1};
if(scenario==='signed-in')finishSession({authenticated:true,csrf:'test',user});
else if(scenario==='network-error')failSession(new Error('QA offline'));
else finishSession({authenticated:false,clubProfileRequired:true});
await boot;
if(scenario==='signed-in'){
  assert.ok(auth.hidden&&!member.hidden&&loading.hidden,'profile opens before slow dashboard');
  assert.equal(authRevealed,0,'login never flashes for an existing session');
  assert.equal(document.getElementById('welcome').textContent,'Привет, QA Pilot.');
  assert.ok(finishDashboard,'dashboard loads independently');
  finishDashboard({user,bookings:[],completedVisits:0,smartshell:[]});
}else if(scenario==='network-error'){
  assert.ok(auth.hidden&&member.hidden&&!loading.hidden,'network error does not imply logout');
  assert.equal(document.getElementById('member-loading-error').hidden,false);
}else{
  assert.ok(!auth.hidden&&member.hidden&&loading.hidden,'signed-out guest can enter credentials');
  assert.equal(document.getElementById('auth-submit').disabled,false);
}
console.log('PASS',scenario);
// Pending synthetic secondary requests must not keep the test process open.
setTimeout(()=>process.exit(0),25);
