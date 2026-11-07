import {PHONE,TARIFFS,money} from './club-data.js?v=20261107';

const $=id=>document.getElementById(id);
const $$=selector=>[...document.querySelectorAll(selector)];
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');

function text(id,value){const node=$(id);if(node)node.textContent=value;}
function scrollToHeading(section,heading){
  section.scrollIntoView({behavior:reducedMotion.matches?'instant':'smooth',block:'start'});
  if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}
}
function menu(open,returnFocus=false){
  $('menu-toggle').setAttribute('aria-expanded',String(open));
  $('menu-toggle').setAttribute('aria-label',open?'Закрыть меню':'Открыть меню');
  $('navigation').classList.toggle('open',open);
  document.body.classList.toggle('menu-open',open);
  if(returnFocus)$('menu-toggle').focus();
}
function showTariff(key){
  if(!Object.hasOwn(TARIFFS,key))return;
  const tariff=TARIFFS[key],photo=$('equipment-photo');
  $$('[data-tariff]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tariff===key)));
  if(photo.getAttribute('src')!==tariff.photo)photo.src=tariff.photo;
  photo.alt=tariff.photoAlt;
  text('equipment-stamp',tariff.name.toUpperCase());
  text('equipment-base',tariff.base);
  text('equipment-screen',tariff.screen);
  text('equipment-rate-value',money(tariff.prices[60]));
}
// Old shared plans lead to the actual booking flow; no planner or export remains.
function routeOldPlan(){
  if(location.hash==='#leader-challenge'){
    history.replaceState(null,'',location.pathname+location.search+'#test-drive');
    $('test-drive').scrollIntoView({block:'start'});
    return;
  }
  if(location.hash==='#plan'||location.hash.startsWith('#plan?')){
    history.replaceState(null,'',location.pathname+location.search+'#sessions');
    $('sessions').scrollIntoView({block:'start'});
  }
}
if($('equipment-photo')){
  $$('a[href^="tel:"]').forEach(anchor=>anchor.href='tel:'+PHONE);
  $('menu-toggle').addEventListener('click',()=>menu($('menu-toggle').getAttribute('aria-expanded')!=='true'));
  $('navigation').addEventListener('click',event=>{if(event.target.closest('a'))menu(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('menu-toggle').getAttribute('aria-expanded')==='true')menu(false,true);});
  document.addEventListener('click',event=>{if(!event.target.closest('.site-header')&&$('menu-toggle').getAttribute('aria-expanded')==='true')menu(false);});
  $$('[data-tariff]').forEach(button=>button.addEventListener('click',()=>showTariff(button.dataset.tariff)));
  document.addEventListener('autosim:book',()=>{menu(false);scrollToHeading($('prices'),$('prices-title'));});
  window.addEventListener('hashchange',routeOldPlan);
  showTariff('standard');routeOldPlan();
}
