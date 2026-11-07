import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
class Element {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.attrs={};this.events={};this.isConnected=true;this.textContent='';}
 append(...values){this.children.push(...values);}prepend(...values){this.children.unshift(...values);}replaceChildren(...values){this.children=values;this.textContent='';}
 setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,v){this.events[k]=v;}
 querySelector(selector){return this.children.find(c=>c.tagName===selector)||this.children.map(c=>c.querySelector?.(selector)).find(Boolean)||null;}
}
const text=e=>e.textContent+e.children.map(text).join(' ');
const doc={createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};
const context=vm.createContext({document:doc,Intl,Date});
vm.runInContext(fs.readFileSync('public/leader-reward.js','utf8').replace('export function','function'),context);
for(const state of ['available','used','not_leader','unknown']){
 const target=new Element();context.renderReward(target,state==='unknown'?null:{state,resetsAt:'2026-09-20T19:00:00Z'});
 const copy=text(target);assert.ok(copy.includes('Улучшение своего рекорда'));
 assert.equal(copy.includes('60 минут / 0 ₽'),state==='available');
 assert.ok(copy.includes('Вернул лидерство'));
 if(state==='used')assert.ok(copy.includes('21 сентября'),'Week reset displayed in Orenburg, not local computer zone');
 assert.ok(target.querySelector('details'));
 assert.equal(target.querySelector('summary').querySelector('svg').attrs['aria-hidden'],'true');
}
const target=new Element();const timers=new Set();const listeners=new Map();let response={history:[],best:[],reward:{state:'available'}},resolveLate;
const accountDoc={...doc,hidden:false,getElementById:id=>id==='member-game'?target:null,addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)};
const account=vm.createContext({document:accountDoc,Date,renderReward:context.renderReward,RACE_SEASON:'e60-sector-2',gameTime:()=>'',pendingAttempt:()=>null,gameApi:async()=>response,setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)});
const source=fs.readFileSync('public/game-account.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function');
vm.runInContext(source,account);
await account.showGameHistory({csrf:'test'});assert.equal(timers.size,1);assert.ok(text(target).includes('60 минут / 0 ₽'));
response={...response,reward:{state:'not_leader'}};await [...timers][0]();assert.ok(!text(target).includes('60 минут / 0 ₽'),'Poll removes stale available benefit');
accountDoc.hidden=true;response={...response,reward:{state:'available'}};await [...timers][0]();assert.ok(!text(target).includes('60 минут / 0 ₽'),'Hidden page does not poll');
accountDoc.hidden=false;listeners.get('visibilitychange')();await new Promise(resolve=>setImmediate(resolve));assert.ok(text(target).includes('60 минут / 0 ₽'),'Returning to tab refreshes state');
account.gameApi=()=>new Promise(resolve=>resolveLate=resolve);
const loading=account.showGameHistory({csrf:'test'});account.stopGameHistory();target.replaceChildren();resolveLate(response);await loading;
assert.equal(target.children.length,0,'A late profile request cannot reinsert private data after logout');assert.equal(timers.size,0);assert.equal(listeners.size,0);
console.log('Reward UI: 4 honest states, Orenburg date, polling, hidden-tab pause, resume and logout races passed. No browser layout assertions.');

const results=vm.createContext({document:{...doc,getElementById:()=>null},location:{search:''},URLSearchParams});
vm.runInContext(fs.readFileSync('public/game-results.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function').replaceAll('export const','const'),results);
for(const [rank,reward,state] of [[1,{available:true},'leader'],[1,{state:'used'},'used'],[2,{available:false},'chase'],[null,null,'saved']]){
 const data={result:{board:'pro'},rank,reward};const output=new Element();results.renderSavedResult(output,data);
 assert.equal(output.dataset.state,state);assert.equal(text(output).includes('уже доступен'),state==='leader');
 if(state==='chase')assert.ok(text(output).includes('Попробуй ещё раз'));
 if(state==='leader')assert.equal(output.querySelector('a').href,'/cabinet#member-game');
}
assert.equal(results.savedResultMessage({result:{board:'novice'},rank:1,reward:{available:true}}).state,'training');
console.log('Save feedback: server-confirmed leader, used reward, chase, unknown and training states passed.');
