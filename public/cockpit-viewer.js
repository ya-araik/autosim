const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const wrap = value => Math.atan2(Math.sin(value),Math.cos(value));
const tariffs = new Set(['standard','pro','vip']);

export function initCockpitViewer(root) {
  if (!root || root.dataset.cvInitialized) return;
  root.dataset.cvInitialized='true';
  const get=selector=>root.querySelector(selector),all=selector=>[...root.querySelectorAll(selector)];
  const mount=get('[data-cv-canvas]'),reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const initial=document.documentElement.dataset;
  let tariff=tariffs.has(initial.cockpitTariff)?initial.cockpitTariff:'standard',vr=initial.cockpitVr==='true';
  let renderer,scene,camera,model,environment,screenTexture,sun,ground,THREE;
  let visible=false,loading=false,destroyed=false,lost=false,frame=0,previousTime=0,requestId=0,statsAt=0;
  let animationNeeded=false,preset='overview',pointer=null,dragged=false,discovered=false;
  let rotateStartX=0,rotateStartY=0,angleStart=0,elevationStart=0;
  const current={angle:2.29,elevation:.37,distance:3.7,x:0,y:.77,z:.05};
  const target={...current},listeners=[],canvasListeners=[];
  const listen=(element,type,fn,options)=>{element.addEventListener(type,fn,options);listeners.push([element,type,fn,options]);};
  function discovery(){if(discovered)return;discovered=true;document.dispatchEvent(new CustomEvent('autosim:discovery',{detail:{key:'cockpit'}}));}
  function stop(){cancelAnimationFrame(frame);frame=0;previousTime=0;}
  function updateLabel(){get('[data-cv-config]').textContent=({standard:'STANDARD / MOZA R5',pro:'PRO / MOZA R12',vip:'VIP / MOZA R9'})[tariff]+(vr?' + VR':'');}
  function drawRacingIllustration(canvas){
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    const sky=ctx.createLinearGradient(0,0,0,h*.65);sky.addColorStop(0,'#87afc3');sky.addColorStop(1,'#dce6df');ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
    ctx.fillStyle='#6c805d';ctx.beginPath();ctx.moveTo(0,h*.44);for(let x=0;x<=w;x+=8)ctx.lineTo(x,h*(.38+.02*Math.sin(x*.009)+.018*Math.sin(x*.027)));ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.fill();
    for(let i=0;i<74;i++){
      const x=i*w/73,treeH=h*(.13+.05*Math.sin(i*4.3)),y=h*.48+Math.sin(i*1.7)*h*.02;
      ctx.fillStyle=i%2?'#354d3a':'#405e43';ctx.beginPath();ctx.moveTo(x,y-treeH);ctx.lineTo(x-w*.019,y);ctx.lineTo(x+w*.020,y);ctx.closePath();ctx.fill();
      ctx.fillStyle='#485044';ctx.fillRect(x-1,y-5,3,16);
    }
    const road=ctx.createLinearGradient(0,h*.46,0,h);road.addColorStop(0,'#626c6d');road.addColorStop(1,'#3e484b');ctx.fillStyle=road;
    ctx.beginPath();ctx.moveTo(w*.48,h*.46);ctx.bezierCurveTo(w*.39,h*.59,w*.46,h*.60,w*.11,h);ctx.lineTo(w*.95,h);ctx.bezierCurveTo(w*.60,h*.68,w*.61,h*.58,w*.53,h*.46);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#e8e8d6';ctx.lineWidth=w*.003;ctx.beginPath();ctx.moveTo(w*.48,h*.46);ctx.bezierCurveTo(w*.39,h*.59,w*.46,h*.60,w*.11,h);ctx.stroke();ctx.beginPath();ctx.moveTo(w*.53,h*.46);ctx.bezierCurveTo(w*.61,h*.58,w*.60,h*.68,w*.95,h);ctx.stroke();
    ctx.strokeStyle='#d9dfdb';ctx.lineWidth=w*.004;ctx.beginPath();ctx.moveTo(w*.56,h*.455);ctx.bezierCurveTo(w*.71,h*.54,w*.70,h*.64,w,h*.86);ctx.stroke();ctx.lineWidth=w*.002;ctx.beginPath();ctx.moveTo(w*.56,h*.44);ctx.bezierCurveTo(w*.71,h*.52,w*.70,h*.61,w,h*.82);ctx.stroke();
    ctx.fillStyle='#111c21';ctx.beginPath();ctx.moveTo(0,h);ctx.quadraticCurveTo(w*.25,h*.91,w*.5,h*.94);ctx.quadraticCurveTo(w*.76,h*.9,w,h);ctx.fill();
    ctx.fillStyle='#0d1821c9';ctx.fillRect(w*.025,h*.04,w*.22,h*.095);ctx.fillStyle='#eef4f5';ctx.font=`600 ${h*.026}px Arial`;ctx.fillText('AUTOSIM / CLUB DRIVE',w*.04,h*.075);ctx.font=`400 ${h*.018}px Arial`;ctx.fillStyle='#b4c7d0';ctx.fillText('BRÜNNCHEN — PFLANZGARTEN',w*.04,h*.109);
    ctx.fillStyle='#0e1921bf';ctx.fillRect(w*.825,h*.73,w*.145,h*.19);ctx.fillStyle='#f0f6f6';ctx.font=`500 ${h*.10}px Arial`;ctx.fillText('142',w*.838,h*.835);ctx.fillStyle='#fc7446';ctx.font=`600 ${h*.033}px Arial`;ctx.fillText('D4',w*.846,h*.885);ctx.fillStyle='#c6d6dd';ctx.font=`400 ${h*.018}px Arial`;ctx.fillText('KM/H',w*.91,h*.887);
    for(let i=0;i<12;i++){ctx.fillStyle=i<9?'#fa8151':'#536069';ctx.fillRect(w*(.838+i*.0103),h*.745,w*.006,h*.007);}
    ctx.fillStyle='#ffffff9e';ctx.font=`400 ${h*.017}px Arial`;ctx.fillText('RACING ILLUSTRATION',w*.028,h*.97);
  }
  function disposeGraphics(){
    stop();canvasListeners.splice(0).forEach(([element,type,fn])=>element.removeEventListener(type,fn));
    model?.dispose();model=null;ground?.geometry.dispose();ground?.material.dispose();ground=null;
    environment?.dispose();environment=null;screenTexture?.dispose();screenTexture=null;sun?.shadow.dispose();sun=null;
    if(renderer){renderer.dispose();renderer.domElement.remove();renderer=null;}scene=null;camera=null;
  }
  function fail(error){
    if(destroyed)return;loading=false;lost=false;disposeGraphics();
    get('[data-cv-loading]').hidden=false;get('[data-cv-loading-text]').textContent='3D пока не открылось. Можно попробовать ещё раз.';get('[data-cv-retry]').hidden=false;
    console.warn('Autosim cockpit viewer:',error);
  }
  async function createGraphics(){
    if(loading||destroyed||renderer)return;
    loading=true;const generation=++requestId;get('[data-cv-loading]').hidden=false;get('[data-cv-retry]').hidden=true;
    get('[data-cv-loading-text]').textContent='Собираем твой симулятор…';
    try{
      const [threeModule,{createCockpitModel}]=await Promise.all([import('./vendor/three.module.min.js'),import('./cockpit-model.js')]);
      if(destroyed||generation!==requestId)return;THREE=threeModule;
      renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,mount.clientWidth<500?1.5:1.8));renderer.setClearColor(0x000000,0);
      renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
      renderer.domElement.setAttribute('aria-hidden','true');mount.appendChild(renderer.domElement);
      scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(40,1,.03,30);
      const studio=new THREE.Scene();studio.background=new THREE.Color(0xaeb8be);
      for(const [x,y,z,w,h,color] of [[-3,4,2,5,5,0xf8fbff],[4,2,-1,3,6,0xffffff],[0,5,-4,7,3,0xdfeeff],[0,2,5,5,2,0xffe5cb]]){
        const panel=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));panel.position.set(x,y,z);panel.lookAt(0,.7,0);studio.add(panel);
      }
      const pmrem=new THREE.PMREMGenerator(renderer);environment=pmrem.fromScene(studio,.03,.1,20);pmrem.dispose();
      studio.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});scene.environment=environment.texture;scene.environmentIntensity=.82;
      scene.add(new THREE.HemisphereLight(0xffffff,0x6b737c,2.1));
      sun=new THREE.DirectionalLight(0xfff8eb,4);sun.position.set(2.6,4,2.5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-2;sun.shadow.camera.right=2;sun.shadow.camera.top=2.2;sun.shadow.camera.bottom=-2;sun.shadow.camera.near=.1;sun.shadow.camera.far=12;sun.shadow.normalBias=.015;sun.shadow.bias=-.0002;scene.add(sun);
      const rim=new THREE.DirectionalLight(0xe3f0ff,1.8);rim.position.set(-3,2,-2);scene.add(rim);
      const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=tariff==='pro'?288:576;drawRacingIllustration(canvas);
      screenTexture=new THREE.CanvasTexture(canvas);screenTexture.colorSpace=THREE.SRGBColorSpace;screenTexture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
      model=createCockpitModel(THREE,{tariff,vr,screenTexture});scene.add(model.group);
      ground=new THREE.Mesh(new THREE.PlaneGeometry(9,9),new THREE.ShadowMaterial({color:0x263948,opacity:.17}));ground.rotation.x=-Math.PI/2;ground.position.y=-.006;ground.receiveShadow=true;scene.add(ground);
      const contextLost=event=>{event.preventDefault();lost=true;stop();get('[data-cv-loading]').hidden=false;get('[data-cv-loading-text]').textContent='Восстанавливаем 3D…';};
      const contextRestored=()=>{lost=false;disposeGraphics();loading=false;createGraphics();};
      for(const [type,fn]of[['webglcontextlost',contextLost],['webglcontextrestored',contextRestored]]){renderer.domElement.addEventListener(type,fn);canvasListeners.push([renderer.domElement,type,fn]);}
      loading=false;updateLabel();resize();stop();model.settle();renderFrame(performance.now());
      if(renderer)get('[data-cv-loading]').hidden=true;
    }catch(error){if(generation===requestId)fail(error);}
  }
  function resize(){
    if(!renderer||lost)return;
    const w=Math.max(1,mount.clientWidth),h=Math.max(1,mount.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
    if(preset==='overview'){target.distance=w<400?4.5:w<520?4.15:3.7;if(reduced.matches)Object.assign(current,target);}
    animationNeeded=true;schedule();
  }
  function schedule(){if(!frame&&renderer&&!lost&&visible&&!document.hidden&&!destroyed)frame=requestAnimationFrame(renderFrame);}
  function renderFrame(now){
    frame=0;if(!renderer||lost||!visible||document.hidden||destroyed)return;
    try{
      const dt=previousTime?Math.min(.05,(now-previousTime)/1000):1/60;previousTime=now;
      const blend=reduced.matches?1:1-Math.exp(-dt*9);let moving=false;
      for(const key of ['distance','elevation','x','y','z']){const delta=target[key]-current[key];current[key]+=delta*blend;if(Math.abs(delta)>.0005)moving=true;else current[key]=target[key];}
      const angleDelta=wrap(target.angle-current.angle);current.angle+=angleDelta*blend;if(Math.abs(angleDelta)>.0005)moving=true;
      if(reduced.matches){model.settle();Object.assign(current,target);moving=false;}
      const animateModel=model.update(dt);
      const horizontal=Math.cos(current.elevation)*current.distance;
      camera.position.set(current.x+Math.sin(current.angle)*horizontal,current.y+Math.sin(current.elevation)*current.distance,current.z+Math.cos(current.angle)*horizontal);
      camera.lookAt(current.x,current.y,current.z);renderer.render(scene,camera);
      if(now-statsAt>900){renderer.domElement.dataset.drawCalls=String(renderer.info.render.calls);renderer.domElement.dataset.triangles=String(renderer.info.render.triangles);statsAt=now;}
      animationNeeded=moving||animateModel;
      if(animationNeeded)schedule();else previousTime=0;
    }catch(error){fail(error);}
  }
  function setPreset(name){
    preset=name;all('[data-cv-preset]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.cvPreset===name)));
    // Look down between the bridge uprights. The previous low side angle put
    // the steering support directly between the camera and the pedal faces.
    const views={overview:{angle:2.29,elevation:.37,distance:mount.clientWidth<400?4.5:mount.clientWidth<520?4.15:3.7,x:0,y:.77,z:.05},pedals:{angle:2.95,elevation:1.06,distance:1.30,x:0,y:.31,z:.67},rear:{angle:3.12,elevation:.29,distance:2.6,x:0,y:.72,z:-.34}};
    Object.assign(target,views[name]||views.overview);animationNeeded=true;schedule();
  }
  function configuration(event){
    const detail=event.detail||{};tariff=tariffs.has(detail.tariff)?detail.tariff:tariff;
    if(typeof detail.vr==='boolean')vr=detail.vr;
    updateLabel();if(model){
      const canvas=screenTexture.image,height=tariff==='pro'?288:576;
      if(canvas.height!==height){canvas.height=height;drawRacingIllustration(canvas);screenTexture.needsUpdate=true;}
      model.setConfiguration(tariff,vr);animationNeeded=true;schedule();
    }
  }
  listen(document,'autosim:cockpit',configuration);updateLabel();
  all('[data-cv-preset]').forEach(button=>listen(button,'click',()=>{setPreset(button.dataset.cvPreset);discovery();}));
  all('[data-cv-zoom]').forEach(button=>listen(button,'click',()=>{target.distance=clamp(target.distance*(button.dataset.cvZoom==='in'?.82:1.22),.68,6.2);animationNeeded=true;schedule();discovery();}));
  listen(mount,'pointerdown',event=>{
    if(event.button!==0||pointer!==null||!renderer)return;
    pointer=event.pointerId;dragged=false;rotateStartX=event.clientX;rotateStartY=event.clientY;angleStart=target.angle;elevationStart=target.elevation;
    if(event.pointerType!=='touch')mount.setPointerCapture(pointer);
  });
  listen(mount,'pointermove',event=>{
    if(event.pointerId!==pointer)return;
    const dx=event.clientX-rotateStartX,dy=event.clientY-rotateStartY;
    if(event.pointerType==='touch'&&!dragged){if(Math.abs(dy)>Math.abs(dx)*1.2&&Math.abs(dy)>8){pointer=null;return;}if(Math.abs(dx)<8)return;dragged=true;mount.setPointerCapture(pointer);}
    if(Math.hypot(dx,dy)<3&&!dragged)return;
    dragged=true;mount.classList.add('is-dragging');target.angle=angleStart-dx*.009;
    if(event.pointerType!=='touch')target.elevation=clamp(elevationStart+dy*.007,.04,1.2);
    all('[data-cv-preset]').forEach(button=>button.setAttribute('aria-pressed','false'));preset='custom';
    get('[data-cv-hint]').textContent='Рассмотри то, что важно тебе';animationNeeded=true;schedule();discovery();
  });
  function release(event){if(event.pointerId!==pointer)return;const id=pointer;pointer=null;if(mount.hasPointerCapture(id))mount.releasePointerCapture(id);mount.classList.remove('is-dragging');}
  for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(mount,type,release);
  listen(mount,'keydown',event=>{
    if(event.ctrlKey||event.altKey||event.metaKey)return;let changed=true;
    if(event.key==='ArrowLeft')target.angle+=.16;else if(event.key==='ArrowRight')target.angle-=.16;
    else if(event.key==='ArrowUp')target.elevation=clamp(target.elevation+.09,.04,1.2);else if(event.key==='ArrowDown')target.elevation=clamp(target.elevation-.09,.04,1.2);
    else if(event.key==='+'||event.key==='=')target.distance=clamp(target.distance*.88,.68,6.2);else if(event.key==='-')target.distance=clamp(target.distance*1.14,.68,6.2);else changed=false;
    if(changed){event.preventDefault();animationNeeded=true;schedule();discovery();}
  });
  listen(get('[data-cv-retry]'),'click',()=>createGraphics());
  listen(document,'visibilitychange',()=>{if(document.hidden)stop();else{previousTime=0;schedule();}});
  listen(reduced,'change',()=>{animationNeeded=true;schedule();});
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible)stop();else{if(!renderer&&!loading)createGraphics();else schedule();}});
  observer.observe(root);
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(mount);
  return {setConfiguration:(nextTariff,nextVr)=>configuration({detail:{tariff:nextTariff,vr:nextVr}}),
    destroy(){destroyed=true;++requestId;observer.disconnect();resizeObserver.disconnect();listeners.forEach(([element,type,fn,options])=>element.removeEventListener(type,fn,options));disposeGraphics();}};
}

if(typeof document!=='undefined')initCockpitViewer(document.getElementById('cockpit-viewer'));
