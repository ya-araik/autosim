// Progressive visual enhancement only. Existing booking/auth handlers own actions.
// One finite scheduler, no layout reads or blur animation in its frame loop.
export function springStep(value, velocity, target, dt) {
  velocity += ((target-value)*420-velocity*39)*dt;
  return [value+velocity*dt,velocity];
}

if (typeof document !== 'undefined' && document.body.classList.contains('glass-edition')) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Set(), springs = new Set(), resets = new Set();
  let frame=0, previous=0;
  const tick = now => {
    const dt=Math.min((now-previous)/1000 || 1/60,1/32);previous=now;
    for (const spring of active) spring.step(dt,now);
    frame=active.size?requestAnimationFrame(tick):0;
  };
  class Spring {
    constructor(node,values,render) {this.node=node;this.values=[...values];this.target=[...values];this.velocity=values.map(()=>0);this.render=render;this.releaseAt=0;springs.add(this);render(values);}
    to(values,snap=false) {
      this.target=[...values];
      if(snap || reduced.matches){this.values=[...values];this.velocity.fill(0);active.delete(this);this.node.style.willChange='';this.render(this.values);return;}
      active.add(this);this.node.style.willChange='transform';
      if(!frame){previous=performance.now();frame=requestAnimationFrame(tick);}
    }
    step(dt,now) {
      if(!this.node.isConnected){active.delete(this);springs.delete(this);return;}
      if(this.releaseAt && now>=this.releaseAt){this.releaseAt=0;this.target=this.target.map(()=>1);}
      let settled=true;
      this.values=this.values.map((value,i)=>{
        const [next,v]=springStep(value,this.velocity[i],this.target[i],dt);this.velocity[i]=v;
        if(Math.abs(next-this.target[i])>.0005 || Math.abs(v)>.005)settled=false;
        return next;
      });
      if(settled&&!this.releaseAt){this.values=[...this.target];this.velocity.fill(0);active.delete(this);this.node.style.willChange='';}
      this.render(this.values);
    }
  }
  const disposers=new Map();
  function dispose(node,callback){const set=disposers.get(node)||new Set();set.add(callback);disposers.set(node,set);}
  function cleanup(){for(const [node,callbacks] of disposers)if(!node.isConnected){for(const callback of callbacks)callback();disposers.delete(node);}for(const spring of springs)if(!spring.node.isConnected){active.delete(spring);springs.delete(spring);}}
  function press(target,skin,enabled=()=>true) {
    const controller=new AbortController();
    const on=(node,type,handler)=>node.addEventListener(type,handler,{signal:controller.signal});
    const spring=new Spring(skin,[1,1],([x,y])=>skin.style.transform=`scale(${x},${y})`);
    let pointer=null,key=null,downAt=0;
    const reset=()=>{pointer=null;key=null;spring.releaseAt=0;spring.to([1,1],true);};resets.add(reset);
    const down=()=>{downAt=performance.now();spring.releaseAt=0;spring.to([.975,.94]);};
    const up=cancel=>{
      if(cancel||reduced.matches){spring.releaseAt=0;spring.to([1,1],true);return;}
      // A quick tap still renders a short press; no delayed business action.
      spring.releaseAt=Math.max(performance.now(),downAt+65);
      spring.to([.975,.94]);
    };
    on(target,'pointerdown',e=>{if(e.button!==0||!e.isPrimary||!enabled(e))return;pointer=e.pointerId;down();});
    on(window,'pointerup',e=>{if(pointer===e.pointerId){pointer=null;up(false);}});
    on(window,'pointercancel',e=>{if(pointer===e.pointerId){pointer=null;up(true);}});
    on(target,'pointerleave',()=>{if(pointer!==null){pointer=null;up(true);}});
    on(target,'lostpointercapture',e=>{if(e.target===target&&pointer===e.pointerId){pointer=null;up(true);}});
    on(target,'keydown',e=>{if(!e.repeat&&(e.key==='Enter'||e.key===' ')&&enabled(e)){key=e.key;down();}});
    on(target,'keyup',e=>{if(key===e.key){key=null;up(false);}});
    on(target,'focusout',()=>{if(key){key=null;up(true);}});
    dispose(target,()=>{controller.abort();resets.delete(reset);active.delete(spring);springs.delete(spring);});
  }
  const groups=new WeakSet(), controls=new WeakSet();
  const layouts=new Set();let layoutFrame=0;
  function flushLayouts(){layoutFrame=0;const writes=[...layouts].map(read=>read());layouts.clear();for(const write of writes)write?.();}
  function schedule(read){layouts.add(read);if(!layoutFrame)layoutFrame=requestAnimationFrame(flushLayouts);}
  function segment(group) {
    if(groups.has(group))return;groups.add(group);
    const buttons=[...group.querySelectorAll(':scope > button')];if(!buttons.length)return;
    const lens=document.createElement('span'),skin=document.createElement('span');
    lens.className='glass-lens';skin.className='glass-lens-skin';lens.setAttribute('aria-hidden','true');lens.append(skin);
    group.classList.add('glass-segments');group.append(lens);
    let selected=null,first=true;
    const spring=new Spring(lens,[0,0],([x,y])=>lens.style.transform=`translate3d(${x}px,${y}px,0)`);
    const read=()=>{
      const button=buttons.find(b=>b.getAttribute('aria-selected')==='true'||b.getAttribute('aria-pressed')==='true');
      if(!button)return;
      const parent=group.getBoundingClientRect(),rect=button.getBoundingClientRect();
      if(!rect.width)return;
      const x=rect.left-parent.left-group.clientLeft+group.scrollLeft,y=rect.top-parent.top-group.clientTop+group.scrollTop;
      const snap=first||button===selected;first=false;selected=button;
      return ()=>{lens.style.width=rect.width+'px';lens.style.height=rect.height+'px';spring.to([x,y],snap);lens.classList.add('is-ready');};
    };
    const mutations=new MutationObserver(()=>schedule(read)),resize=new ResizeObserver(()=>schedule(read));
    mutations.observe(group,{subtree:true,attributes:true,attributeFilter:['aria-selected','aria-pressed']});resize.observe(group);
    dispose(group,()=>{mutations.disconnect();resize.disconnect();layouts.delete(read);});
    document.fonts.ready.then(()=>schedule(read));schedule(read);
    press(group,skin,event=>{const button=event.target.closest('button');return buttons.includes(button)&&!button.disabled&&button.getAttribute('aria-selected')!=='true'&&button.getAttribute('aria-pressed')!=='true';});
  }
  const pressSelector='.hero-v40-book,.header-account,.header-call,.menu-button,.booking-choice-close,.booking-choice-online,.member-invitation .button,.optional-drive-copy .button,.booking-finish-action .button,.glass-app button.primary,.glass-app button.secondary,.glass-app .member-header .quiet,.glass-app .close-button';
  function enhance(root) {
    const find=selector=>[...(root.matches?.(selector)?[root]:[]),...root.querySelectorAll(selector)];
    for(const group of find('.club-tabs,.tariff-tabs,.seat-length,.member-glass .tabs'))segment(group);
    for(const button of find(pressSelector)) {
      if(controls.has(button)&&button.querySelector(':scope > .glass-skin'))continue;
      if(controls.has(button)){for(const cleanup of disposers.get(button)||[])cleanup();disposers.delete(button);}
      controls.add(button);
      const skin=document.createElement('span');skin.className='glass-skin';skin.setAttribute('aria-hidden','true');button.append(skin);button.classList.add('glass-press');
      press(button,skin,()=>!button.disabled&&button.getAttribute('aria-disabled')!=='true');
    }
  }
  enhance(document);
  new MutationObserver(records=>{cleanup();for(const record of records){if(record.target.matches?.(pressSelector))enhance(record.target);for(const node of record.addedNodes)if(node.nodeType===1)enhance(node);}}).observe(document.body,{childList:true,subtree:true});
  const cancel=()=>{for(const reset of resets)reset();for(const spring of springs)spring.to(spring.target,true);if(frame){cancelAnimationFrame(frame);frame=0;}};
  window.addEventListener('blur',cancel);
  window.addEventListener('scroll',()=>{for(const reset of resets)reset();},{passive:true,capture:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  reduced.addEventListener('change',cancel);
  window.addEventListener('pagehide',cancel);
}
