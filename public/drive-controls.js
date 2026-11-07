const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function thumbSteering(delta, travel) {
  const value = clamp(delta / Math.max(30, travel), -1, 1);
  return Math.abs(value) < .025 ? 0 : Math.sign(value) * Math.pow((Math.abs(value) - .025) / .975, 1.35);
}

export function thumbPedals(y, height) {
  const value = clamp((height / 2 - y) / (height * .42), -1, 1);
  const amount = Math.max(0, (Math.abs(value) - .12) / .88);
  return { throttle: value > 0 ? amount : 0, brake: value < 0 ? amount : 0 };
}

// iPhone uses native touch identifiers through the entire contact. Pointer
// capture is reserved for mouse/pen: Safari can cancel a captured pointer during
// multi-touch even though the corresponding finger is still on the surface.
export function createThumbControls({ steeringPad, powerPad, enabled, onShift }) {
  const state = { steering: 0, throttle: 0, brake: 0, handbrake: 0 };
  let steeringPointer = null, powerPointer = null;
  let startX = 0, startY = 0, powerStartX = 0, gestureArmed = true;
  const listeners = [], root=steeringPad.ownerDocument;
  const listen = (target, type, fn, options) => { if(!target)return;target.addEventListener(type, fn, options); listeners.push([target, type, fn, options]); };
  const capture=(pad,id)=>{try{pad.setPointerCapture(id);}catch{/* Global release/move handlers remain active. */}};
  const uncapture=(pad,id)=>{if(typeof id!=='number')return;try{if(pad.hasPointerCapture(id))pad.releasePointerCapture(id);}catch{/* A cancelled contact may already be gone in WebKit. */}};
  function paint() {
    steeringPad.style.setProperty('--thumb-steer', state.steering.toFixed(3));
    steeringPad.setAttribute('aria-valuenow', String(Math.round(state.steering * 100)));
    powerPad.style.setProperty('--thumb-power', (state.throttle - state.brake).toFixed(3));
    powerPad.style.setProperty('--throttle-fill', (state.throttle * 100).toFixed(1) + '%');
    powerPad.style.setProperty('--brake-fill', (state.brake * 100).toFixed(1) + '%');
    powerPad.classList.toggle('is-handbrake', !!state.handbrake);
    powerPad.setAttribute('aria-valuenow', String(Math.round((state.throttle - state.brake) * 100)));
  }
  function steerMove(event) {
    if (event.pointerId !== steeringPointer) return;
    const bounds = steeringPad.getBoundingClientRect();
    state.steering = thumbSteering(event.clientX - startX, Math.min(82, bounds.width * .43));
    const vertical = event.clientY - startY;
    if (gestureArmed && Math.abs(vertical) > 34) {
      onShift(vertical < 0 ? 1 : -1);
      gestureArmed = false;
      steeringPad.dataset.shift = vertical < 0 ? 'up' : 'down';
    } else if (!gestureArmed && Math.abs(vertical) < 13) {
      gestureArmed = true;
      steeringPad.dataset.shift = '';
    }
    paint();
  }
  function powerMove(event) {
    if (event.pointerId !== powerPointer) return;
    const bounds = powerPad.getBoundingClientRect();
    Object.assign(state, thumbPedals(event.clientY - bounds.top, bounds.height));
    state.handbrake = clamp((powerStartX - event.clientX - 30) / 26, 0, 1);
    paint();
  }
  const startSteer=event=>{
    if (!enabled() || event.button !== 0 || steeringPointer !== null || event.target?.closest('button')) return;
    event.preventDefault(); steeringPointer = event.pointerId;
    startX = event.clientX; startY = event.clientY; gestureArmed = true;
    if(typeof event.pointerId==='number')capture(steeringPad,event.pointerId);
    steeringPad.classList.add('is-held');
    steerMove(event);
  };
  const startPower=event=>{
    if (!enabled() || event.button !== 0 || powerPointer !== null) return;
    event.preventDefault(); powerPointer = event.pointerId; powerStartX = event.clientX;
    if(typeof event.pointerId==='number')capture(powerPad,event.pointerId); powerPad.classList.add('is-held');
    powerMove(event);
  };
  listen(steeringPad,'pointerdown',e=>{if(e.pointerType!=='touch')startSteer(e);});
  listen(powerPad,'pointerdown',e=>{if(e.pointerType!=='touch')startPower(e);});
  function releaseSteer(event) {
    if (event.pointerId !== steeringPointer) return;
    steeringPointer = null; state.steering = 0;
    uncapture(steeringPad,event.pointerId);
    steeringPad.classList.remove('is-held'); steeringPad.dataset.shift = ''; paint();
  }
  function releasePower(event) {
    if (event.pointerId !== powerPointer) return;
    powerPointer = null; state.throttle = state.brake = state.handbrake = 0;
    uncapture(powerPad,event.pointerId);
    powerPad.classList.remove('is-held'); paint();
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    listen(steeringPad, type, releaseSteer); listen(powerPad, type, releasePower);
  }
  for(const type of ['pointerup','pointercancel'])listen(root,type,e=>{releaseSteer(e);releasePower(e);},true);
  const movePointer=e=>{
    // Recover a missed mouse-up without clearing the other input channel.
    if(e.buttons===0&&e.pointerType!=='touch'){releaseSteer(e);releasePower(e);return;}
    steerMove(e);powerMove(e);
  };
  if(root)listen(root,'pointermove',movePointer,true);
  else{listen(steeringPad,'pointermove',movePointer);listen(powerPad,'pointermove',movePointer);}
  const touchEvent=(event,touch)=>({pointerId:'touch:'+touch.identifier,clientX:touch.clientX,clientY:touch.clientY,button:0,target:event.target,preventDefault:()=>event.preventDefault()});
  for(const [pad,start] of [[steeringPad,startSteer],[powerPad,startPower]]){
    listen(pad,'touchstart',event=>{const touch=event.changedTouches[0];if(touch)start(touchEvent(event,touch));},{passive:false});
    listen(pad,'touchmove',event=>{
      if(!enabled()){release();return;}
      if(steeringPointer===null&&powerPointer===null)return;
      if(event.cancelable)event.preventDefault();
      for(const touch of event.touches){const e=touchEvent(event,touch);steerMove(e);powerMove(e);}
    },{passive:false});
  }
  function reconcileTouches(event){
    const live=new Set(Array.from(event.touches,t=>'touch:'+t.identifier));
    if(typeof steeringPointer==='string'&&!live.has(steeringPointer))releaseSteer({pointerId:steeringPointer});
    if(typeof powerPointer==='string'&&!live.has(powerPointer))releasePower({pointerId:powerPointer});
  }
  // Document capture also sees releases outside the pad and system cancellation.
  for(const type of ['touchend','touchcancel','touchstart']){
    if(root)listen(root,type,reconcileTouches,true);
    else{listen(steeringPad,type,reconcileTouches);listen(powerPad,type,reconcileTouches);}
  }
  function release() {
    const left = steeringPointer, right = powerPointer;
    steeringPointer = powerPointer = null;
    Object.assign(state, { steering: 0, throttle: 0, brake: 0, handbrake: 0 });
    uncapture(steeringPad,left);uncapture(powerPad,right);
    steeringPad.classList.remove('is-held'); powerPad.classList.remove('is-held');
    steeringPad.dataset.shift = ''; paint();
  }
  listen(root?.defaultView,'blur',release);
  listen(root?.defaultView,'pagehide',release);
  listen(root,'visibilitychange',()=>{if(root.hidden)release();});
  paint();
  return { read: () => ({ ...state, steeringHeld: steeringPointer !== null, powerHeld: powerPointer !== null }), release,
    dispose() { release(); for (const [target, type, fn, options] of listeners) target.removeEventListener(type, fn, options); } };
}

export function interpolatePose(previous, current, amount) {
  const alpha = clamp(amount, 0, 1);
  const result = { ...current };
  for (const key of ['x', 'y', 'z', 'steering', 'steeringAngle', 'roadPitch', 'roadBank', 'roadGrade']) {
    if (Number.isFinite(previous[key]) && Number.isFinite(current[key])) result[key] = previous[key] + (current[key] - previous[key]) * alpha;
  }
  const delta = Math.atan2(Math.sin(current.heading - previous.heading), Math.cos(current.heading - previous.heading));
  result.heading = previous.heading + delta * alpha;
  return result;
}
