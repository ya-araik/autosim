import * as THREE from './vendor/three.module.min.js';
import {createHeroWheelModel} from './hero-wheel-model.js';

const instances = new WeakMap();
const ACCENTS = {signal:'#fc703b',cobalt:'#91b8ff',silver:'#d4d5d8'};
const icon = name => {
  const paths = {reset:'<path d="M4 9a8 8 0 1 1 1 8M4 3v6h6"/>',photo:'<path d="M4 7h4l2-3h4l2 3h4v13H4Z"/><circle cx="12" cy="13" r="4"/>',plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',orbit:'<ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="4" ry="9" transform="rotate(30 12 12)"/>',front:'<circle cx="12" cy="12" r="9"/><path d="M4 10h16M9 10l3 10 3-10"/>'};
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.front}</svg>`;
};

export async function initHeroWheel(mount = document.getElementById('hero-wheel-mount')) {
  if(!mount)return null;if(instances.has(mount))return instances.get(mount);
  mount.classList.add('hero-wheel-viewer');mount.dataset.wheelReady='loading';
  const controls=document.createElement('div');controls.className='hw-interface';
  controls.innerHTML=`<div class="hw-title"><span>КОНЦЕПТ КЛУБА</span><strong>AUTOSIM A–01</strong></div><div class="hw-upper-tools"><button type="button" data-hw="zoom-in" aria-label="Приблизить руль">${icon('plus')}</button><button type="button" data-hw="zoom-out" aria-label="Отдалить руль">${icon('minus')}</button><button type="button" data-hw="reset" aria-label="Вернуть исходный вид">${icon('reset')}</button></div><div class="hw-bottom"><div class="hw-shifts"><button type="button" data-hw="down" aria-label="Левый лепесток, понизить передачу">−<span>ЛЕПЕСТОК</span></button><output class="hw-state" aria-live="polite" aria-atomic="true">D1 · TRACK</output><button type="button" data-hw="up" aria-label="Правый лепесток, повысить передачу"><span>ЛЕПЕСТОК</span>+</button></div><div class="hw-tools" role="group" aria-label="Осмотр концепта руля"><button type="button" data-hw="front" aria-label="Вид спереди">Спереди</button><button type="button" data-hw="rear" aria-label="Вид сзади">Сзади</button><button type="button" data-hw="orbit" aria-pressed="false" title="Свободно вращать руль во все стороны">${icon('orbit')}<span>Осмотр</span></button><button type="button" data-hw="finish" aria-label="Сменить карбон на титан">Карбон</button><button type="button" data-hw="photo" aria-label="Сохранить изображение своего руля">${icon('photo')}</button></div><p class="hw-hint">Поверни вбок. Или нажми на лепесток.</p></div><p class="hw-notice" role="status" aria-live="polite"></p>`;
  mount.appendChild(controls);
  const status=controls.querySelector('.hw-state'),notice=controls.querySelector('.hw-notice'),finishButton=controls.querySelector('[data-hw="finish"]');
  const steering=document.getElementById('steering'),reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let renderer,scene,camera,model,environment,destroyed=false,lost=false,visible=true,raf=0,lastTime=0,drag=null,orbitTouch=false,discovered=false;
  const target={yaw:-.28,pitch:.13,distance:6.3},view={...target},listeners=[];
  const listen=(object,type,fn,options)=>{object.addEventListener(type,fn,options);listeners.push([object,type,fn,options]);};
  function reportDiscovery(){if(discovered)return;discovered=true;document.dispatchEvent(new CustomEvent('autosim:discovery',{detail:{key:'wheel'}}));}
  function cancelFrame(){if(raf)cancelAnimationFrame(raf);raf=0;lastTime=0;}
  function unavailable(){cancelFrame();mount.dataset.wheelReady='unavailable';notice.textContent='Концепт AUTOSIM A–01. Показываем эскиз руля.';controls.querySelectorAll('button').forEach(button=>button.disabled=true);}
  function rebuildEnvironment(){
    const studio=new THREE.Scene();studio.background=new THREE.Color(0x9ca8b4);
    const studioAssets=[];
    for(const [x,y,z,w,h,power]of[[-3,3,3,4,5,5],[4,1,1,2,6,4],[0,5,-2,5,3,4],[0,-2,4,4,1,2],[0,2,-4,6,4,2]]){
      const geometry=new THREE.PlaneGeometry(w,h),material=new THREE.MeshBasicMaterial({color:new THREE.Color(power,power,power),side:THREE.DoubleSide});const panel=new THREE.Mesh(geometry,material);panel.position.set(x,y,z);panel.lookAt(0,0,0);studio.add(panel);studioAssets.push(geometry,material);
    }
    const pmrem=new THREE.PMREMGenerator(renderer);environment?.dispose();environment=pmrem.fromScene(studio,.035);scene.environment=environment.texture;scene.environmentIntensity=.88;pmrem.dispose();studioAssets.forEach(asset=>asset.dispose());
  }
  try{
    renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.16;
    renderer.setClearColor(0x000000,0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.domElement.className='hw-canvas';renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','Трёхмерный концепт руля AUTOSIM A–01. Стрелки поворачивают вид, плюс и минус меняют масштаб.');mount.prepend(renderer.domElement);
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(34,1,.1,50);
    const ambient=new THREE.HemisphereLight(0xf2f6fc,0x626b76,2.25);scene.add(ambient);
    const key=new THREE.DirectionalLight(0xfff4e9,3.8);key.position.set(-3,5,6);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-3;key.shadow.camera.right=3;key.shadow.camera.top=3;key.shadow.camera.bottom=-3;key.shadow.camera.near=.1;key.shadow.camera.far=18;key.shadow.normalBias=.015;key.shadow.bias=-.0001;scene.add(key);
    const edge=new THREE.DirectionalLight(0xbcd5ef,2.4);edge.position.set(4,1,-3);scene.add(edge);
    const fill=new THREE.DirectionalLight(0xffffff,.7);fill.position.set(0,-2,4);scene.add(fill);
    rebuildEnvironment();
    model=createHeroWheelModel(THREE);scene.add(model.group);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(12,12),new THREE.ShadowMaterial({color:0x304050,opacity:.12}));ground.rotation.x=-Math.PI/2;ground.position.y=-1.56;ground.receiveShadow=true;scene.add(ground);
  }catch(error){unavailable();console.warn('AUTOSIM wheel preview unavailable',error);return null;}
  const canvas=renderer.domElement,raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  function getAction(event){const box=canvas.getBoundingClientRect();pointer.set((event.clientX-box.left)/box.width*2-1,1-(event.clientY-box.top)/box.height*2);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObject(model.group,true)[0];if(!hit)return null;for(let object=hit.object;object&&object!==model.group;object=object.parent)if(object.userData.action)return object.userData.action;return null;}
  function updateStatus(){const state=model.getState();status.textContent='D'+state.gear+' · '+state.mode;controls.querySelector('[data-hw="down"]').disabled=state.gear===1;controls.querySelector('[data-hw="up"]').disabled=state.gear===7;finishButton.textContent=state.finish==='carbon'?'Карбон':'Титан';finishButton.setAttribute('aria-label',state.finish==='carbon'?'Сменить карбон на титан':'Сменить титан на карбон');}
  function invalidate(){if(!raf&&!destroyed&&!lost&&visible&&!document.hidden)raf=requestAnimationFrame(frame);}
  function frame(time){raf=0;if(destroyed||lost||!visible||document.hidden)return;const dt=lastTime?Math.min(.05,(time-lastTime)/1000):1/60;lastTime=time;const blend=reduced.matches?1:1-Math.exp(-dt*12);for(const key of ['yaw','pitch','distance']){view[key]+=(target[key]-view[key])*blend;if(Math.abs(target[key]-view[key])<.0002)view[key]=target[key];}
    if(reduced.matches)model.settle();const active=model.update(dt);const cp=Math.cos(view.pitch);camera.position.set(Math.sin(view.yaw)*cp*view.distance,Math.sin(view.pitch)*view.distance+.05,Math.cos(view.yaw)*cp*view.distance);camera.lookAt(0,.02,0);try{renderer.render(scene,camera);}catch(error){lost=true;unavailable();console.warn('AUTOSIM wheel render unavailable',error);return;}
    mount.dataset.wheelReady='true';canvas.dataset.drawCalls=String(renderer.info.render.calls);canvas.dataset.triangles=String(renderer.info.render.triangles);
    if(!reduced.matches&&(active||Object.keys(target).some(key=>Math.abs(target[key]-view[key])>.0002)))invalidate();else lastTime=0;
  }
  function resize(){if(destroyed||lost)return;const width=Math.max(1,mount.clientWidth),height=Math.max(1,mount.clientHeight-(parseFloat(getComputedStyle(mount).getPropertyValue('--hw-deck'))||104));renderer.setSize(width,height,false);camera.aspect=width/height;camera.fov=width<440?38:34;camera.updateProjectionMatrix();invalidate();}
  function setView(preset){const desired=preset==='rear'?Math.PI+.25:0;target.yaw=view.yaw+Math.atan2(Math.sin(desired-view.yaw),Math.cos(desired-view.yaw));target.pitch=preset==='rear'?.12:.035;target.distance=6.3;invalidate();}
  function activate(action){if(lost||destroyed)return;reportDiscovery();notice.textContent='';if(action==='up'||action==='down')model.shift(action==='up'?1:-1);else if(action==='mode')model.cycleMode();else if(action==='view'){target.yaw+=.36;}else if(action==='front'||action==='rear')setView(action);else if(action==='finish')model.setFinish(model.getState().finish==='carbon'?'titanium':'carbon');else if(action==='reset'){Object.assign(target,{yaw:view.yaw+Math.atan2(Math.sin(-.28-view.yaw),Math.cos(-.28-view.yaw)),pitch:.13,distance:6.3});if(steering){steering.value='0';steering.dispatchEvent(new Event('input',{bubbles:true}));}}else if(action==='zoom-in')target.distance=Math.max(4.3,target.distance-.5);else if(action==='zoom-out')target.distance=Math.min(9,target.distance+.5);else if(action==='orbit'){orbitTouch=!orbitTouch;controls.querySelector('[data-hw="orbit"]').setAttribute('aria-pressed',String(orbitTouch));canvas.style.touchAction=orbitTouch?'none':'pan-y';controls.querySelector('.hw-hint').textContent=orbitTouch?'Свободный осмотр · тяни в любую сторону':'Поверни вбок. Или нажми на лепесток.';}else if(action==='photo')exportImage();updateStatus();invalidate();}
  listen(controls,'click',event=>{const button=event.target.closest('[data-hw]');if(button&&!button.disabled)activate(button.dataset.hw);});
  listen(canvas,'pointerdown',event=>{if(event.button!==0||lost||drag)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,moved:false,type:event.pointerType,cancelled:false};if(event.pointerType==='mouse'||orbitTouch)canvas.setPointerCapture(event.pointerId);});
  listen(canvas,'pointermove',event=>{
    if(!drag||drag.id!==event.pointerId){canvas.style.cursor=getAction(event)?'pointer':'grab';return;}
    if(drag.cancelled)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.moved&&Math.hypot(dx,dy)>7){if(drag.type==='touch'&&!orbitTouch&&Math.abs(dy)>Math.abs(dx)){drag.cancelled=true;return;}drag.moved=true;canvas.setPointerCapture(event.pointerId);reportDiscovery();}
    if(drag.moved){event.preventDefault();target.yaw-=(event.clientX-drag.lastX)*.008;if(drag.type!=='touch'||orbitTouch)target.pitch=THREE.MathUtils.clamp(target.pitch+(event.clientY-drag.lastY)*.006,-.65,.85);invalidate();canvas.style.cursor='grabbing';}
    drag.lastX=event.clientX;drag.lastY=event.clientY;
  });
  function release(event){if(!drag||event.pointerId!==drag.id)return;const old=drag;drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);canvas.style.cursor='grab';if(event.type==='pointerup'&&!old.moved&&!old.cancelled){const action=getAction(event);if(action)activate(action);}}
  for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(canvas,type,release);
  listen(canvas,'wheel',event=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();target.distance=THREE.MathUtils.clamp(target.distance+event.deltaY*.006,4.3,9);reportDiscovery();invalidate();},{passive:false});
  listen(canvas,'keydown',event=>{const actions={'+':'zoom-in','=':'zoom-in','-':'zoom-out','f':'front','r':'rear'};if(actions[event.key]){event.preventDefault();activate(actions[event.key]);return;}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();reportDiscovery();if(event.key==='ArrowLeft')target.yaw-=.15;if(event.key==='ArrowRight')target.yaw+=.15;if(event.key==='ArrowUp')target.pitch=Math.min(.85,target.pitch+.12);if(event.key==='ArrowDown')target.pitch=Math.max(-.65,target.pitch-.12);invalidate();}});
  if(steering)listen(steering,'input',()=>{model.setSteering(Number(steering.value));reportDiscovery();invalidate();});
  function identity(detail={}){const accent=ACCENTS[detail.accent]||detail.accent;model.setIdentity({callsign:detail.callsign,accent});if(/^#[0-9a-f]{6}$/i.test(accent))mount.style.setProperty('--hw-accent',accent);invalidate();}
  listen(document,'autosim:identity',event=>identity(event.detail));identity({callsign:document.documentElement.dataset.driverCallsign||'DRIVER 01',accent:document.documentElement.dataset.driverAccent||'signal'});
  listen(document,'visibilitychange',()=>{if(document.hidden){cancelFrame();model.settle();drag=null;}else invalidate();});
  listen(reduced,'change',()=>{model.settle();invalidate();});
  listen(canvas,'webglcontextlost',event=>{event.preventDefault();lost=true;unavailable();});
  listen(canvas,'webglcontextrestored',()=>{try{lost=false;rebuildEnvironment();notice.textContent='';controls.querySelectorAll('button').forEach(button=>button.disabled=false);updateStatus();resize();}catch(error){lost=true;unavailable();console.warn('AUTOSIM wheel recovery unavailable',error);}});
  const observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);if(visible)invalidate();else{cancelFrame();model.settle();}},{rootMargin:'100px'});observer.observe(mount);
  const resizer=new ResizeObserver(resize);resizer.observe(mount);
  async function exportImage(){const button=controls.querySelector('[data-hw="photo"]');button.disabled=true;
    try{renderer.render(scene,camera);const image=document.createElement('canvas');image.width=canvas.width;image.height=canvas.height;const context=image.getContext('2d');const background=context.createLinearGradient(0,0,image.width,image.height);background.addColorStop(0,'#f8fafb');background.addColorStop(1,'#dde4e8');context.fillStyle=background;context.fillRect(0,0,image.width,image.height);context.drawImage(canvas,0,0);
      const margin=Math.max(24,image.width*.055);context.fillStyle='#18202a';context.font=`600 ${Math.max(20,image.width*.027)}px Arial`;context.fillText('AUTOSIM  /  A–01',margin,image.height-margin);context.textAlign='right';context.fillStyle='#6b7b89';context.font=`500 ${Math.max(15,image.width*.018)}px Arial`;context.fillText(model.getState().callsign,image.width-margin,image.height-margin);
      const blob=await new Promise(resolve=>image.toBlob(resolve,'image/png'));if(!blob)throw new Error('Empty image');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='AUTOSIM-A01-'+model.getState().callsign.replace(/[^a-z0-9а-яё_-]+/gi,'-')+'.png';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);notice.textContent='Снимок концепта сохранён.';
    }catch(error){notice.textContent='Не удалось сохранить снимок. Попробуй ещё раз.';}finally{button.disabled=false;}}
  function dispose(){if(destroyed)return;destroyed=true;cancelFrame();observer.disconnect();resizer.disconnect();listeners.forEach(([object,type,fn,options])=>object.removeEventListener(type,fn,options));model.dispose();environment?.dispose();scene.traverse(object=>{if(object.isMesh&&object.parent===scene){object.geometry.dispose();object.material.dispose();}});renderer.dispose();canvas.remove();controls.remove();delete mount.dataset.wheelReady;instances.delete(mount);}
  const api={setView,shift:direction=>activate(direction>0?'up':'down'),setFinish:finish=>{model.setFinish(finish);updateStatus();invalidate();},setIdentity:identity,exportImage,dispose,getState:()=>model.getState()};instances.set(mount,api);mount.heroWheel=api;
  model.setSteering(Number(steering?.value)||0);updateStatus();resize();return api;
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>initHeroWheel(),{once:true});else initHeroWheel();
}
