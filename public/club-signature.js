import {validState,defaultState,TARIFF_NAMES,quote,validatePlan} from './visit-math.js';

const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const section=$('#inside-club');
const accents={signal:'#fc703b',cobalt:'#91b8ff',silver:'#d4d5d8'};
const storageKey='autosim.personal-garage.v1';
const cleanCallsign=value=>String(value||'').toUpperCase().replace(/[^A-ZА-ЯЁ0-9 _-]/gu,'').slice(0,12);
let identity={callsign:'DRIVER 01',accent:'signal'},plan=defaultState(),saved,stamps=new Set();
try {
  const data=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(data?.version===1&&typeof data.identity?.callsign==='string'&&Object.hasOwn(accents,data.identity.accent)){
    saved={identity:{callsign:cleanCallsign(data.identity.callsign)||'DRIVER 01',accent:data.identity.accent},plan:validState(data.plan)?data.plan:null};
    identity={...saved.identity};
  }
} catch {}

function publishIdentity(){
  identity.callsign=cleanCallsign(identity.callsign)||'DRIVER 01';
  document.documentElement.dataset.driverCallsign=identity.callsign;
  document.documentElement.dataset.driverAccent=identity.accent;
  $('#driver-pass-name').textContent=identity.callsign;
  $('#driver-pass-name').style.fontSize=identity.callsign.length>9?'clamp(19px,2.5vw,32px)':'';
  $('#driver-pass').style.setProperty('--identity-accent',accents[identity.accent]);
  $$('[data-identity-accent]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.identityAccent===identity.accent)));
  document.dispatchEvent(new CustomEvent('autosim:identity',{detail:{...identity}}));
}
function updatePlanLabel(){
  if(!validState(plan))return;
  $('#driver-pass-config').textContent=`${TARIFF_NAMES[plan.tariff]} · ${plan.duration} мин · ${plan.people} чел.`;
}
$('#driver-callsign').value=identity.callsign;
publishIdentity();updatePlanLabel();
$('#garage-restore').disabled=!saved;
$('#driver-callsign').addEventListener('input',event=>{
  const position=event.target.selectionStart;
  const cleaned=cleanCallsign(event.target.value);
  if(cleaned!==event.target.value){event.target.value=cleaned;event.target.setSelectionRange(position,position);}
  identity.callsign=cleaned;publishIdentity();
});
$('#driver-callsign').addEventListener('blur',event=>{event.target.value=identity.callsign;});
$$('[data-identity-accent]').forEach(button=>button.addEventListener('click',()=>{identity.accent=button.dataset.identityAccent;publishIdentity();}));
document.addEventListener('autosim:identity-request',publishIdentity);
document.addEventListener('autosim:visit-state',event=>{if(validState(event.detail)){plan={...event.detail};updatePlanLabel();}});
document.dispatchEvent(new CustomEvent('autosim:visit-state-request'));
$('#garage-save').addEventListener('click',()=>{
  const data={version:1,identity:{...identity},plan:validState(plan)?{...plan}:null};
  try{localStorage.setItem(storageKey,JSON.stringify(data));saved=data;$('#garage-restore').disabled=false;$('#garage-status').textContent='Позывной, цвет и план визита сохранены в этом браузере.';}
  catch{$('#garage-status').textContent='Браузер не разрешил сохранение. Настройки работают до закрытия страницы.';}
});
$('#garage-restore').addEventListener('click',()=>{
  if(!saved)return;
  identity={...saved.identity};$('#driver-callsign').value=identity.callsign;publishIdentity();
  if(saved.plan){plan={...saved.plan};document.dispatchEvent(new CustomEvent('autosim:restore-visit',{detail:{...plan}}));updatePlanLabel();}
  $('#garage-status').textContent='Сетап восстановлен. Дату и доступность времени согласуй с клубом.';
});
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
$('#garage-card').addEventListener('click',async()=>{
  const button=$('#garage-card');button.disabled=true;
  try{
    await document.fonts.ready;
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1500;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
    const gradient=ctx.createLinearGradient(0,0,1200,1500);gradient.addColorStop(0,'#333740');gradient.addColorStop(.55,'#111317');gradient.addColorStop(1,'#232831');ctx.fillStyle=gradient;ctx.fillRect(0,0,1200,1500);
    ctx.strokeStyle='#ffffff10';ctx.lineWidth=1;for(let i=0;i<1200;i+=5){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i+200,1500);ctx.stroke();}
    const color=accents[identity.accent];ctx.strokeStyle='#ffffff30';roundRect(ctx,45,45,1110,1410,38);ctx.stroke();
    ctx.fillStyle='#e9eaef';ctx.font='700 31px Manrope,Arial';ctx.fillText('АВТОСИМ / DRIVER ID',90,125);
    ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(980,165);ctx.lineTo(1050,75);ctx.lineTo(1090,75);ctx.lineTo(1050,165);ctx.lineTo(1018,165);ctx.lineTo(1041,117);ctx.lineTo(1006,165);ctx.fill();
    ctx.fillStyle='#959ba7';ctx.font='400 23px Manrope,Arial';ctx.fillText('ЧУВСТВУЙ. БОЛЬШЕ.',90,320);
    let size=107;ctx.font=`700 ${size}px Manrope,Arial`;while(ctx.measureText(identity.callsign).width>1010){size-=2;ctx.font=`700 ${size}px Manrope,Arial`;}
    ctx.fillStyle=color;ctx.fillText(identity.callsign,85,445);
    // An original racing line: the club identity continues outside the browser.
    ctx.strokeStyle='#ffffff15';ctx.lineWidth=68;ctx.beginPath();ctx.moveTo(-30,970);ctx.bezierCurveTo(730,1060,1060,610,410,645);ctx.bezierCurveTo(130,660,280,850,1160,700);ctx.stroke();
    ctx.strokeStyle=color;ctx.lineWidth=3;ctx.setLineDash([14,12]);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#f1f2f5';ctx.font='700 47px Manrope,Arial';ctx.fillText('ТВОЙ СЛЕДУЮЩИЙ ЗАЕЗД.',90,1080);
    ctx.fillStyle='#b8bdc7';ctx.font='400 27px Manrope,Arial';
    const ready=validState(plan)&&!validatePlan(plan);
    if(ready){ctx.fillText(`${TARIFF_NAMES[plan.tariff]} · ${plan.duration} мин · ${plan.people} чел.${plan.vr?' · VR':''}`,90,1145);ctx.fillText(`${plan.date.split('-').reverse().join('.')} · ${plan.time} / Оренбург`,90,1190);ctx.fillText(`${new Intl.NumberFormat('ru-RU').format(quote(plan).each)} ₽ за участника`,90,1235);}
    else{ctx.fillText('Выбери симулятор. Собери друзей. Найди свой ритм.',90,1150);}
    ctx.font='400 23px Manrope,Arial';ctx.fillStyle='#b8bdc7';ctx.fillText('РЫБАКОВСКАЯ, 59 · ОРЕНБУРГ',90,1330);ctx.fillText('+7 (951) 030-88-56',90,1370);
    ctx.fillStyle='#7e8490';ctx.font='400 17px Manrope,Arial';ctx.fillText('Карточка знакомства. Время нужно согласовать с клубом. Не бронь.',90,1420);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Image not available');
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='AUTOSIM-driver-card.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    $('#garage-status').textContent='Карточка PNG готова. Её можно отправить друзьям.';
  }catch{$('#garage-status').textContent='Не удалось создать PNG. Попробуй ещё раз в обычной вкладке браузера.';}finally{button.disabled=false;}
});

const tours={
  cockpit:{image:'IND04212.webp',alt:'Ряд симуляторов с рулями, экранами и коробками передач в Автосим',points:[
    [59,29,'ЭКРАН','Дорога\nперед тобой.','Большой экран помогает читать поворот заранее. Перед заездом подстроим посадку и положение относительно руля.'],
    [40,45,'УПРАВЛЕНИЕ','Всё начинается\nс рук.','Руль, педали, коробка. Можно доверить переключения автоматике или управлять передачами самому — подберём настройки под твой опыт.'],
    [55,60,'КОРОБКА','Ещё одно\nощущение.','Отдельный рычаг добавляет переключениям физический характер. Конкретный симулятор и доступное оборудование помогут выбрать в клубе.']]},
  wheel:{image:'IND04324.webp',alt:'Крупный план металлических органов управления и кожаного обода руля MOZA',points:[
    [15,44,'ОБОД','Держаться\nза ощущения.','В руках — физический руль с обратной связью. Усилие настраиваем под тебя: знакомство с симрейсингом не должно начинаться с борьбы с техникой.'],
    [39,48,'НАСТРОЙКИ','Точность\nпод пальцами.','Кнопки и поворотные переключатели находятся рядом с хватом. Администратор покажет, какие функции назначены в выбранной игре.'],
    [57,57,'МАТЕРИАЛ','Характер\nв металле.','Металлическая лицевая панель, крепёж и отдельные органы управления. Это настоящее фото нашего оборудования — включи лупу и рассмотри.']]},
  vr:{image:'IND04559.webp',alt:'Гостья клуба в VR-шлеме за рулём симулятора',points:[
    [58,45,'VR','Поверни голову.\nТы внутри.','В виртуальной реальности можно смотреть в поворот и по сторонам. VR — отдельная опция: если хочется привычного экрана, оставим экран.'],
    [73,39,'ПОСАДКА','Удобно.\nС первого круга.','Сначала настроим кресло и расстояние до органов управления. Потом объясним управление и поможем освоиться в выбранной машине.'],
    [31,61,'ОБЩИЙ ЗАЕЗД','Своя гонка.\nОбщий мир.','В совместном VR-заезде могут участвовать до пяти человек. Собери план вечера и уточни у клуба подходящие симуляторы на одно время.']]}
};
let tour='cockpit',point=0,lensEnabled=false,lensX=.5,lensY=.5;
const photo=$('.tour-photo'),lens=$('#tour-lens');
function updateLens(){
  lens.hidden=!lensEnabled;
  if(!lensEnabled)return;
  const rect=photo.getBoundingClientRect(),size=lens.offsetWidth||130,zoom=2.2;
  lens.style.left=Math.max(5,Math.min(rect.width-size-5,lensX*rect.width-size/2))+'px';
  lens.style.top=Math.max(5,Math.min(rect.height-size-5,lensY*rect.height-size/2))+'px';
  lens.style.backgroundImage=`url('/assets/${tours[tour].image}')`;
  const image=$('#tour-image'),scale=Math.max(rect.width/(image.naturalWidth||rect.width),rect.height/(image.naturalHeight||rect.height));
  const width=(image.naturalWidth||rect.width)*scale,height=(image.naturalHeight||rect.height)*scale;
  const offsetX=(rect.width-width)/2,offsetY=(rect.height-height)/2;
  lens.style.backgroundSize=`${width*zoom}px ${height*zoom}px`;
  lens.style.backgroundPosition=`${size/2-(lensX*rect.width-offsetX)*zoom}px ${size/2-(lensY*rect.height-offsetY)*zoom}px`;
}
function selectDetail(index){
  point=index;const detail=tours[tour].points[index];
  $('#tour-coordinate').textContent=`0${index+1} / ${detail[2]}`;
  $('#tour-detail-title').replaceChildren(...detail[3].split('\n').flatMap((line,i)=>i?[document.createElement('br'),document.createTextNode(line)]:[document.createTextNode(line)]));
  $('#tour-detail-copy').textContent=detail[4];
  $$('.tour-spot').forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  $$('#tour-detail-pips i').forEach((pip,i)=>pip.classList.toggle('active',i===index));
  lensX=detail[0]/100;lensY=detail[1]/100;updateLens();
}
function selectTour(key,focus=false){
  tour=key;const data=tours[key];$('#tour-image').src='/assets/'+data.image;$('#tour-image').alt=data.alt;
  $$('[data-tour]').forEach(button=>{const active=button.dataset.tour===key;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;if(active&&focus)button.focus();});
  $('#tour-panel').setAttribute('aria-labelledby','tour-tab-'+key);
  $('#tour-hotspots').replaceChildren(...data.points.map((detail,index)=>{const button=document.createElement('button');button.className='tour-spot';button.style.left=detail[0]+'%';button.style.top=detail[1]+'%';button.textContent='0'+(index+1);button.setAttribute('aria-label',detail[2]+': показать подробности');button.setAttribute('aria-controls','tour-panel');button.addEventListener('click',()=>selectDetail(index));return button;}));
  selectDetail(0);
}
const tourTabs=$$('[data-tour]');
tourTabs.forEach((button,index)=>{
  button.addEventListener('click',()=>selectTour(button.dataset.tour));
  button.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%3;if(event.key==='ArrowLeft')next=(index+2)%3;if(event.key==='Home')next=0;if(event.key==='End')next=2;if(next!==undefined){event.preventDefault();selectTour(tourTabs[next].dataset.tour,true);}});
});
$('#tour-lens-toggle').addEventListener('click',()=>{lensEnabled=!lensEnabled;$('#tour-lens-toggle').setAttribute('aria-pressed',String(lensEnabled));$('#tour-lens-toggle').setAttribute('aria-label',lensEnabled?'Выключить лупу для фотографии':'Включить лупу для фотографии');$('#tour-lens-hint').textContent=lensEnabled?'Веди по фото или нажми на деталь. Лупа увеличивает в 2,2 раза.':'Три метки на каждом фото. У каждой — своя история.';updateLens();});
photo.addEventListener('pointermove',event=>{if(!lensEnabled)return;const rect=photo.getBoundingClientRect();lensX=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));lensY=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));updateLens();});
new ResizeObserver(updateLens).observe(photo);$('#tour-image').addEventListener('load',updateLens);selectTour('cockpit');

document.addEventListener('autosim:discovery',event=>{
  const key=event.detail?.key;if(!['wheel','engineering','visit'].includes(key))return;
  stamps.add(key);$$('[data-stamp-link]').forEach(a=>{const done=stamps.has(a.dataset.stampLink);a.classList.toggle('is-done',done);if(done)a.setAttribute('aria-label',a.textContent.trim()+': попробовано');});
  $('#discovery-progress').textContent=stamps.size===3?'Все три шага пройдены. Дальше — настоящий симулятор.':`Уже попробовано: ${stamps.size} из 3.`;
});

const quick=$('#quick-nav-dialog'),query=$('#quick-nav-query');
const commands=[
  ['Фирменный руль A‑01','#main','3d модель материалы лепестки'],
  ['Тест-драйв BMW M5','#test-drive','машина гонка трек дрифт'],
  ['Пять ощущений техники','#engineering','тормоз реакция старт экран обзор'],
  ['Симуляторы и стоимость','#prices','моза оборудование телевизор монитор тариф'],
  ['Собрать визит с друзьями','#visit-planner','цена компания план календарь время бронь'],
  ['Рассмотреть настоящий клуб','#inside-club','фото лупа vr'],
  ['Личный гараж и позывной','#my-garage','имя цвет карточка сохранить сетап'],
  ['Адрес и контакты','#contacts','телефон позвонить где маршрут часы']
];
let filtered=[],current=0;
function markCurrent(){ $$('#quick-nav-results button').forEach((button,i)=>button.dataset.current=String(i===current)); }
function go(command){quick.close();const target=$(command[1]);target?.scrollIntoView({behavior:reduced.matches?'instant':'smooth',block:'start'});const heading=target?.querySelector('h1,h2,h3');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
function renderCommands(){
  const words=query.value.toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean);filtered=commands.filter(command=>words.every(word=>command.join(' ').toLocaleLowerCase('ru').includes(word)));current=0;
  const buttons=filtered.map((command,index)=>{const button=document.createElement('button');const number=document.createElement('span');number.textContent=String(commands.indexOf(command)+1).padStart(2,'0');const label=document.createElement('span');label.textContent=command[0];button.append(number,label);button.addEventListener('click',()=>go(command));button.addEventListener('focus',()=>{current=index;markCurrent();});return button;});
  if(!buttons.length){const empty=document.createElement('p');empty.textContent='Пока не нашли. Попробуй «руль», «друзья» или «адрес».';buttons.push(empty);}
  $('#quick-nav-results').replaceChildren(...buttons);markCurrent();
}
function openQuick(){if(document.querySelector('dialog[open]'))return;quick.showModal();query.value='';renderCommands();query.focus();}
$('#quick-nav-trigger').addEventListener('click',openQuick);$('#quick-nav-close').addEventListener('click',()=>quick.close());query.addEventListener('input',renderCommands);
quick.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(filtered.length){current=(current+(event.key==='ArrowDown'?1:filtered.length-1))%filtered.length;markCurrent();if(event.target!==query)$$('#quick-nav-results button')[current]?.focus();}}if(event.key==='Enter'&&event.target===query&&filtered[current]){event.preventDefault();go(filtered[current]);}});
quick.addEventListener('click',event=>{if(event.target!==quick)return;const b=quick.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)quick.close();});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(quick.open)quick.close();else openQuick();}});
const trigger=$('#quick-nav-trigger');
function updateQuickVisibility(){trigger.hidden=!!document.querySelector('dialog[open]');}
document.querySelectorAll('dialog').forEach(dialog=>new MutationObserver(updateQuickVisibility).observe(dialog,{attributes:true,attributeFilter:['open']}));
updateQuickVisibility();
