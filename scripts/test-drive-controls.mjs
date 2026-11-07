import assert from 'node:assert/strict';
import {thumbSteering,thumbPedals,createThumbControls,interpolatePose} from '../public/drive-controls.js';
class Pad {
  constructor(){this.listeners={};this.dataset={};this.attributes={};this.captures=new Set();this.style={setProperty(){}};this.classList={add(){},remove(){},toggle(){}};}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  removeEventListener(type,fn){this.listeners[type]=this.listeners[type].filter(f=>f!==fn);}
  emit(type,event){for(const fn of this.listeners[type]||[])fn({button:0,preventDefault(){},...event});}
  getBoundingClientRect(){return{left:0,top:0,width:164,height:124};}
  setAttribute(key,value){this.attributes[key]=value;}
  setPointerCapture(id){this.captures.add(id);}
  releasePointerCapture(id){this.captures.delete(id);}
  hasPointerCapture(id){return this.captures.has(id);}
}
const left=new Pad(),right=new Pad(),shifts=[];
let enabled=true;
const input=createThumbControls({steeringPad:left,powerPad:right,enabled:()=>enabled,onShift:value=>shifts.push(value)});
const pointer=(id,x,y)=>({pointerId:id,clientX:x,clientY:y});
left.emit('pointerdown',pointer(1,70,70));
right.emit('pointerdown',pointer(2,90,5));
left.emit('pointermove',pointer(1,113,70));
let state=input.read();
assert(state.steering>.3 && state.steering<.8);
assert.equal(state.throttle,1);
const steer=state.steering;
left.emit('pointermove',pointer(1,113,30));
left.emit('pointermove',pointer(1,113,20));
assert.deepEqual(shifts,[1],'One shift per vertical flick');
assert.equal(input.read().steering,steer,'Shift must preserve steering');
assert.equal(input.read().throttle,1,'Shift must preserve independent throttle');
left.emit('pointermove',pointer(1,113,70));
left.emit('pointermove',pointer(1,113,111));
assert.deepEqual(shifts,[1,-1]);
left.emit('pointerup',pointer(1,113,111));
assert.equal(input.read().steering,0,'Steering recentres on release');
assert.equal(input.read().throttle,1,'Releasing steering must not release gas');
right.emit('pointermove',pointer(2,90,111));
assert(input.read().brake>.8 && input.read().throttle===0);
right.emit('pointermove',pointer(2,25,111));
assert.equal(input.read().handbrake,1,'Handbrake is a separate lateral axis');
right.emit('pointercancel',pointer(2,25,111));
assert.equal(input.read().brake,0);assert.equal(input.read().handbrake,0);
right.emit('pointerdown',pointer(3,90,0)); input.release();
assert.equal(input.read().throttle,0); assert.equal(right.captures.size,0);
enabled=false;right.emit('pointerdown',pointer(4,90,0));assert.equal(input.read().throttle,0);
assert.equal(thumbSteering(-1000,70),-1);assert.equal(thumbSteering(1000,70),1);
assert.deepEqual(thumbPedals(62,124),{throttle:0,brake:0});
const pose=interpolatePose({x:0,z:10,heading:Math.PI-.01},{x:10,z:0,heading:-Math.PI+.01},.5);
assert.equal(pose.x,5);assert.equal(pose.z,5);assert(Math.abs(pose.heading-Math.PI)<1e-10);
input.dispose();
// Native iPhone sequence: both fingers down, Safari cancels pointer capture,
// one thumb leaves the pad, then the system cancels the remaining touch.
const touchDoc=new Pad();touchDoc.defaultView=new Pad();
const touchLeft=new Pad(),touchRight=new Pad();touchLeft.ownerDocument=touchRight.ownerDocument=touchDoc;
const mobile=createThumbControls({steeringPad:touchLeft,powerPad:touchRight,enabled:()=>true,onShift(){}});
const touch=(identifier,clientX,clientY)=>({identifier,clientX,clientY});
let l=touch(31,40,70),r=touch(74,100,0);
touchLeft.emit('pointerdown',{...pointer(31,40,70),pointerType:'touch'});
assert.equal(mobile.read().steeringHeld,false,'Native touch must not double-bind as a captured pointer');
touchLeft.emit('touchstart',{changedTouches:[l],touches:[l]});
touchRight.emit('touchstart',{changedTouches:[r],touches:[l,r]});
l=touch(31,102,70);touchLeft.emit('touchmove',{touches:[l,r],cancelable:true});
assert(mobile.read().steering>.7);assert.equal(mobile.read().throttle,1);
touchLeft.emit('lostpointercapture',pointer(31,102,70));
assert(mobile.read().steering>.7,'Pointer cancellation does not kill the still-active native touch');
touchDoc.emit('touchend',{changedTouches:[l],touches:[r]});
assert.equal(mobile.read().steering,0,'Release outside the pad resets only that thumb');assert.equal(mobile.read().throttle,1);
touchDoc.emit('touchcancel',{changedTouches:[r],touches:[]});
assert.equal(mobile.read().throttle,0);assert.equal(mobile.read().powerHeld,false);
touchRight.emit('touchstart',{changedTouches:[r],touches:[r]});
touchDoc.emit('touchstart',{changedTouches:[l],touches:[l]});
assert.equal(mobile.read().throttle,0,'A later contact reconciles a missing Safari touchend');
touchRight.emit('touchstart',{changedTouches:[r],touches:[r]});touchDoc.defaultView.emit('blur');assert.equal(mobile.read().throttle,0);
touchRight.setPointerCapture=()=>{throw Error('NotFoundError');};
touchRight.emit('pointerdown',{...pointer(99,100,0),pointerType:'mouse'});assert.equal(mobile.read().throttle,1);
touchDoc.emit('pointerup',pointer(99,100,0));assert.equal(mobile.read().throttle,0,'Capture failure still has a document release path');
touchLeft.hasPointerCapture=()=>true;touchLeft.releasePointerCapture=()=>{throw Error('NotFoundError');};
touchLeft.emit('pointerdown',pointer(98,40,70));assert.doesNotThrow(()=>mobile.release());assert.equal(mobile.read().steeringHeld,false);
mobile.dispose();assert.equal(Object.values(touchDoc.listeners).flat().length,0);
console.log(JSON.stringify({result:'PASS',simultaneousPointers:true,gearGesturePreservesAxes:true,analogPedals:true,handbrakeAxis:true,cancelAndPauseRelease:true,shortestAngleInterpolation:true}));
