import {TARIFFS,money} from './club-data.js?v=20261107';
const $=id=>document.getElementById(id);
const descriptions={standard:'Большой экран. Руль с прямым приводом.',pro:'Панорамный экран. Больше усилия и точности.',vip:'Экран 65″ и шифтер Simagic. Всё под рукой.'};
function menu(open){$('menu-toggle').setAttribute('aria-expanded',String(open));$('menu-toggle').setAttribute('aria-label',open?'Закрыть меню':'Открыть меню');$('navigation').classList.toggle('open',open);document.body.classList.toggle('menu-open',open);}
$('menu-toggle')?.addEventListener('click',()=>menu($('menu-toggle').getAttribute('aria-expanded')!=='true'));
$('navigation')?.addEventListener('click',e=>{if(e.target.closest('a'))menu(false);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')menu(false);});
document.addEventListener('click',e=>{if(!e.target.closest('.site-header'))menu(false);});
function choose(key){const t=TARIFFS[key];if(!t)return;document.querySelectorAll('[data-tariff]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tariff===key)));for(const [id,value] of Object.entries({'equipment-title':t.name,'equipment-tag':t.tag,'equipment-description':descriptions[key],'equipment-base':t.base,'equipment-screen':t.screen,'equipment-extra':t.extra,'equipment-hour':money(t.prices[60]),'equipment-two':money(t.prices[120]),'equipment-stamp':t.name.toUpperCase(),'equipment-caption':t.caption})){if($(id))$(id).textContent=value;}const image=$('equipment-photo');image.src=t.photo;image.alt=t.photoAlt;}
document.querySelectorAll('[data-tariff]').forEach(b=>b.addEventListener('click',()=>choose(b.dataset.tariff)));
document.addEventListener('autosim:book',()=>{menu(false);$('sessions').scrollIntoView({behavior:'smooth'});});
if(location.hash.startsWith('#plan'))location.hash='sessions';
choose('standard');
