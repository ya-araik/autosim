import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createCarState,stepCar,trackPoint,trackLength,trackClosed,respawnCar} from '../public/drive-physics.js';
import {createThumbControls,interpolatePose} from '../public/drive-controls.js';
import {FINISH_T} from '../public/track-data.js';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../public/drive-experience.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace('export async function initDrivingExperience()','async function initDrivingExperience()');
class Element{
  constructor(id=''){this.id=id;this.listeners={};this.attributes={};this.dataset={};this.style={setProperty(){}};this.firstChild={textContent:''};this.previousElementSibling={textContent:''};this.children=new Map();this.classList={add(){},remove(){},toggle(){}};this.isConnected=true;this.clientWidth=390;this.clientHeight=640;}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(f=>f!==fn);}
  emit(type,extra={}){const e={type,target:this,preventDefault(){},stopPropagation(){},...extra};for(const fn of [...this.listeners[type]||[]])fn(e);}
  dispatchEvent(event){this.emit(event.type,event);}
  setAttribute(k,v){this.attributes[k]=v;} getAttribute(k){return this.attributes[k];} removeAttribute(k){delete this.attributes[k];}
  querySelector(s){if(!this.children.has(s))this.children.set(s,new Element(s));return this.children.get(s);}
  querySelectorAll(s){if(s==='[data-sim-mode]')return ['race','drift'].map(v=>{const e=new Element();e.dataset.simMode=v;return e;});if(s==='.sim-rev-bars i')return Array.from({length:12},()=>new Element());return [];}
  appendChild(e){this.children.set(e.id||e.textContent,e);return e;}
  focus(){document.activeElement=this;} hasPointerCapture(){return false;} releasePointerCapture(){} setPointerCapture(){} closest(){return null;}
  getBoundingClientRect(){return{left:0,top:0,width:200,height:200};}
  showModal(){this.open=true;} close(){const was=this.open;this.open=false;if(was)this.emit('close');}
}
const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
// A game must not depend on the removed live preview or hero controls.
for(const id of ['lab-preview','lab-preview-mount','lab-placeholder','lab-render-label','hero-wheel','steering','steering-value','booking-dialog'])elements.delete(id);
const document=new Element('document');document.getElementById=id=>{assert.ok(elements.has(id),'Existing game DOM id: '+id);return elements.get(id);};
document.createElement=()=>new Element();document.body=new Element();document.activeElement=new Element('launcher');document.hidden=false;
document.querySelector=s=>s==='dialog[open]'&&elements.get('drive-dialog').open?elements.get('drive-dialog'):null;
const window=new Element();window.matchMedia=()=>({matches:false,addEventListener(){}});
const frames=new Map(),observers=[],scenes=[],calls=[],warnings=[];let sequence=0,now=0,createCount=0,nextFailure=false,nextDeferred=null;
const makeScene=()=>{const s={canvas:new Element(),disposed:0,renders:0,failRender:false,setMount(){},setNight(){},setEngineering(){},resize(){},clearTrails(){},render(){if(this.failRender)throw Error('GPU render failed');if(elements.get('sim-canvas-mount').clientWidth<2)return false;this.renders++;return true;},dispose(){this.disposed++;}};scenes.push(s);return s;};
let rejectAudio,audioDisposed=0;const audio={ready:new Promise((_,reject)=>rejectAudio=reject),resume(){return this.ready;},suspend(){},update(){},dispose(){audioDisposed++;}};
let releaseStart,requests=0;
const context=vm.createContext({document,window,console:{warn:(...a)=>warnings.push(a)},performance:{now:()=>now},localStorage:{getItem(){return null;},setItem(){}},AbortController,setTimeout,clearTimeout,CustomEvent:class{constructor(type){this.type=type;}},
 createCarState,trackPoint,trackLength,trackClosed,respawnCar,createThumbControls,interpolatePose,FINISH_T,createRaceResults:()=>({isOpen:()=>false,close(){},reset(){},sample(){},begin(){requests++;return new Promise(resolve=>releaseStart=resolve);}}),
 stepCar(s,i,dt,m){calls.push({up:i.shiftUp,dt});return stepCar(s,i,dt,m);},
 createDrivingScene(){createCount++;if(nextFailure){nextFailure=false;return Promise.reject(Error('Asset HTTP 503'));}if(nextDeferred){const d=nextDeferred;nextDeferred=null;return d;}return Promise.resolve(makeScene());},createEngineAudio:()=>audio,
 ResizeObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){}},requestAnimationFrame(fn){frames.set(++sequence,fn);return sequence;},cancelAnimationFrame(id){frames.delete(id);}});
vm.runInContext(source,context);
const api=await context.initDrivingExperience();
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const frame=time=>{now=time;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));};
const get=id=>elements.get(id);
assert.equal(createCount,0,'No graphics scene before an explicit open');assert.equal(frames.size,0);
await api.open('race');frame(1);calls.length=0;
get('sim-start').emit('click');frame(20);frame(40);
assert.equal(requests,1);assert.equal(calls.length,0,'No physics before server start');assert.equal(get('sim-start').disabled,true);
get('sim-start').emit('click');assert.equal(requests,1,'Double click cannot duplicate start');
releaseStart({error:Error('Start limit reached')});await flush();frame(60);
assert.equal(calls.length,0);assert.equal(get('sim-start').disabled,false);assert.match(get('sim-start-status').textContent,/limit/);
get('sim-start').emit('click');assert.equal(requests,2);get('sim-reset').emit('click');
releaseStart({token:'a'.repeat(43)});await flush();frame(80);frame(100);
assert.equal(calls.length,0,'Late start reply cannot restart a reset attempt');assert.equal(get('sim-start').disabled,false);
get('sim-start').emit('click');releaseStart({token:'b'.repeat(43)});await flush();frame(120);frame(145);
assert.ok(calls.length>0,'Physics starts after server acknowledgment');
api.close();console.log('PASS: server start gate, double-click, retry, reset race and acknowledged motion.');
