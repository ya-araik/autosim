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
const context=vm.createContext({document,window,console:{warn:(...a)=>warnings.push(a)},performance:{now:()=>now},localStorage:{getItem(){return null;},setItem(){}},AbortController,setTimeout,clearTimeout,CustomEvent:class{constructor(type){this.type=type;}},
 createCarState,trackPoint,trackLength,trackClosed,respawnCar,createThumbControls,interpolatePose,FINISH_T,createRaceResults:()=>null,
 stepCar(s,i,dt,m){calls.push({up:i.shiftUp,dt});return stepCar(s,i,dt,m);},
 createDrivingScene(){createCount++;if(nextFailure){nextFailure=false;return Promise.reject(Error('Asset HTTP 503'));}if(nextDeferred){const d=nextDeferred;nextDeferred=null;return d;}return Promise.resolve(makeScene());},createEngineAudio:()=>audio,
 ResizeObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){}},requestAnimationFrame(fn){frames.set(++sequence,fn);return sequence;},cancelAnimationFrame(id){frames.delete(id);}});
vm.runInContext(source,context);
const api=await context.initDrivingExperience();
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const frame=time=>{now=time;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));};
const get=id=>elements.get(id);
assert.equal(createCount,0,'No graphics scene before an explicit open');assert.equal(frames.size,0);
nextFailure=true;assert.equal(await api.open('race'),false);assert.equal(get('sim-canvas-mount').dataset.graphics,'error');assert.equal(get('sim-loading').hidden,false);
assert.equal(await api.open('race'),true,'A failed scene can be retried without reinitialising handlers');assert.equal(createCount,2);assert.equal(get('sim-loading').hidden,true);
for(const type of ['selectstart','contextmenu','dragstart']){
  let prevented=false;get('drive-dialog').emit(type,{target:get('sim-view'),preventDefault(){prevented=true;}});
  assert.ok(prevented,type+' cannot take control away from driving');
  prevented=false;get('drive-dialog').emit(type,{target:{closest(){return {};}},preventDefault(){prevented=true;}});
  assert.equal(prevented,false,'Editable fields retain normal interaction');
}
let cleared=0;window.getSelection=()=>({removeAllRanges(){cleared++;}});
get('drive-dialog').emit('pointerdown',{target:get('sim-view')});assert.equal(cleared,1,'Touch clears a preexisting selection');
get('sim-start').emit('click');frame(100);
document.emit('keydown',{code:'KeyE',repeat:false,target:get('sim-view')});frame(100+1000/144);document.emit('keyup',{code:'KeyE',target:get('sim-view')});frame(100+2000/144);frame(125);
assert.equal(calls.filter(c=>c.up).length,1,'Shift delivered exactly once across render-only frames');
get('sim-sound').emit('click');rejectAudio(Error('Audio HTTP 503'));await flush();assert.equal(get('sim-sound').getAttribute('aria-pressed'),'false');assert.equal(audioDisposed,1);
get('sim-pause').emit('click');frame(130);assert.equal(frames.size,0,'Paused scene does not render continuously');
const first=scenes.at(-1);first.canvas.emit('webglcontextlost');assert.equal(get('sim-canvas-mount').dataset.graphics,'error');assert.equal(frames.size,0);assert.equal(get('sim-start').disabled,true);
first.canvas.emit('webglcontextrestored');await flush();assert.equal(first.disposed,1);assert.equal(createCount,3,'Restore builds fresh PMREM/renderer');assert.equal(get('sim-start').disabled,false);frame(140);assert.equal(frames.size,0,'Context restore never silently resumes driving');
scenes.at(-1).failRender=true;observers[0].fn();frame(150);assert.equal(get('sim-canvas-mount').dataset.graphics,'error');assert.equal(frames.size,0,'Render errors stop the loop and expose retry');assert.equal(await api.open('race'),true);
api.close();assert.equal(frames.size,0);observers[0].fn();assert.equal(frames.size,0,'Hidden mount resize cannot schedule a frame');
await api.open('drift');get('sim-start').emit('click');frame(200);frame(220);const physicsBefore=calls.length;document.hidden=true;document.emit('visibilitychange');frame(100000);assert.equal(calls.length,physicsBefore);assert.equal(frames.size,0);
document.hidden=false;document.emit('visibilitychange');frame(100010);assert.equal(calls.length,physicsBefore,'Background wall-clock time must not advance the vehicle');assert.equal(frames.size,0);
let booking=0;document.addEventListener('autosim:book',()=>booking++);get('sim-book').emit('click');frame(100020);assert.equal(booking,1);assert.equal(get('drive-dialog').open,false);
// Repeated opening uses one renderer and one listener set.
const before=createCount;for(let i=0;i<3;i++){await api.open('race');frame(100030+i);api.close();}assert.equal(createCount,before);assert.equal(get('sim-start').listeners.click.length,1);assert.equal(frames.size,0);
await api.open('race');scenes.at(-1).failRender=true;frame(100050);api.close();
let resolveScene;nextDeferred=new Promise(resolve=>resolveScene=resolve);const opening=api.open('race');api.close();resolveScene(makeScene());await opening;assert.equal(frames.size,0,'Finishing a closed load never starts a hidden RAF');assert.equal(get('sim-start').disabled,true,'No successful visible frame yet');
get('sim-canvas-mount').clientWidth=0;await api.open('race');frame(100060);assert.equal(get('sim-start').disabled,true,'Zero-sized render cannot claim ready');assert.equal(get('sim-loading').hidden,false);
get('sim-canvas-mount').clientWidth=390;observers[0].fn();frame(100070);assert.equal(get('sim-start').disabled,false);assert.equal(get('sim-loading').hidden,true);api.close();assert.equal(frames.size,0);
// Real browsers may expose isContextLost during a frame before dispatching the event.
await api.open('race');get('sim-start').emit('click');const lostBeforeEvent=scenes.at(-1);
lostBeforeEvent.render=()=>{const error=Error('WebGL context is unavailable');error.code='WEBGL_CONTEXT_LOST';throw error;};
frame(100080);assert.equal(lostBeforeEvent.disposed,0,'Keep the canvas listener while waiting for context restoration');
assert.equal(frames.size,0);lostBeforeEvent.canvas.emit('webglcontextlost');lostBeforeEvent.canvas.emit('webglcontextrestored');await flush();
assert.equal(lostBeforeEvent.disposed,1);assert.equal(get('sim-canvas-mount').dataset.graphics,'ready');frame(100090);assert.equal(frames.size,0);api.close();
// Leave the sector during a physics step: the warning must not wait for a HUD
// refresh, and returning to asphalt cannot silently restore a valid attempt.
await api.open('race');get('sim-start').emit('click');
const originalStep=context.stepCar;
context.stepCar=(state,input,dt,mode)=>{originalStep(state,input,dt,mode);state.trackDistance=6;};
frame(100100);frame(100120);
assert.equal(get('sim-central-alert').hidden,false);
assert.match(get('sim-central-title').textContent,/не сохранится|не пойдёт/);
assert.equal(get('sim-sector-validity').hidden,false);
assert.ok(frames.size>0,'Invalidation warns without blocking the driving loop');
context.stepCar=originalStep;frame(100140);
assert.equal(get('sim-sector-validity').hidden,false,'Returning to asphalt does not clear invalidity');
get('sim-reset').emit('click');
assert.equal(get('sim-central-alert').hidden,true);assert.equal(get('sim-sector-validity').hidden,true);
get('sim-start').emit('click');
context.stepCar=()=>{throw Error('Input or physics callback failed');};
frame(100160);frame(100180);
assert.match(get('sim-notice').textContent,/сбоя/);frame(100181);assert.equal(frames.size,0,'An exception stops continuous RAF after the paused frame');
assert.equal(get('sim-sector-validity').hidden,false);
context.stepCar=originalStep;get('sim-reset').emit('click');get('sim-start').emit('click');frame(100200);frame(100220);
assert.ok(frames.size>0,'Reset recovers after a callback exception without page reload');api.close();
console.log(JSON.stringify({passed:true,sceneCreations:createCount,expectedFailures:warnings.length,shiftAt144Hz:'one edge',pauseCloseVisibility:'no physics/RAF',restore:'fresh renderer, paused; render-before-event race covered',removedPreviewDependencies:'none'},null,2));
