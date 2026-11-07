import {setMetrikaConsent} from './yandex-metrika.js';
// First-party, opt-in analytics. No requests or analytics identifiers before consent.
// Never import this module into the private administration page.
const mount=document.getElementById('analytics-consent');
if(mount&&!location.pathname.startsWith('/adminka'))initConsent(mount);

function initConsent(mount){
  if(mount.dataset.analyticsConsentInitialized==='true')return;
  mount.dataset.analyticsConsentInitialized='true';
  const VERSION='2026-11-07',KEY='autosim.analytics.consent.v1',VISITOR='autosim.analytics.visitor.v1',SESSION='autosim.analytics.session.v1';
  let choice=null,visitorId=null,visitorExpires=0,sessionId=null,sessionExpires=0,pageSent=false,lastEvent='',lastAt=0;
  const pending=new Set();
  const storage=name=>{try{return window[name];}catch{return null;}};
  const localStorage=storage('localStorage'),sessionStorage=storage('sessionStorage');
  const read=(storage,key)=>{try{return storage.getItem(key);}catch{return null;}};
  const write=(storage,key,value)=>{try{value===null?storage.removeItem(key):storage.setItem(key,value);}catch{}};
  const consent=read(localStorage,KEY);
  try{const stored=JSON.parse(consent);if(stored?.version===VERSION&&['accepted','declined'].includes(stored.choice))choice=stored.choice;}catch{}
  function randomId(){if(crypto.randomUUID)return crypto.randomUUID();const bytes=crypto.getRandomValues(new Uint8Array(16));return [...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');}
  function identity(){
    // Browser storage failures retain temporary IDs in this page only.
    const now=Date.now();
    if(!visitorId)try{const saved=JSON.parse(read(localStorage,VISITOR));if(saved?.expiresAt>now){visitorId=saved.id;visitorExpires=saved.expiresAt;}}catch{}
    if(!sessionId)try{const saved=JSON.parse(read(sessionStorage,SESSION));if(saved?.expiresAt>now){sessionId=saved.id;sessionExpires=saved.expiresAt;}}catch{}
    if(!visitorId||visitorExpires<=now){visitorId=randomId();visitorExpires=now+30*86400000;}
    if(!sessionId||sessionExpires<=now)sessionId=randomId();
    if(!/^[a-f0-9-]{16,64}$/i.test(visitorId))visitorId=randomId();if(!/^[a-f0-9-]{16,64}$/i.test(sessionId))sessionId=randomId();
    sessionExpires=now+30*60000;
    write(localStorage,VISITOR,JSON.stringify({id:visitorId,expiresAt:visitorExpires}));write(sessionStorage,SESSION,JSON.stringify({id:sessionId,expiresAt:sessionExpires}));
  }
  function cleanCampaign(value){const text=String(value||'').slice(0,80);if(/@|\d[\d\s()+-]{7,}/.test(text))return'';return text.replace(/[^\p{L}\p{N}_. -]/gu,'').slice(0,64);}
  function source(){
    let referrer='';try{referrer=new URL(document.referrer).origin;}catch{}
    const query=new URLSearchParams(location.search),utm={};
    for(const key of ['source','medium','campaign']){const value=cleanCampaign(query.get('utm_'+key));if(value)utm[key]=value;}
    return{referrer,utm};
  }
  function track(event,properties={}){
    if(choice!=='accepted'||document.visibilityState==='prerender'||location.pathname.startsWith('/adminka'))return;
    const signature=event+JSON.stringify(properties),now=Date.now();if(signature===lastEvent&&now-lastAt<700)return;lastEvent=signature;lastAt=now;
    try{identity();}catch{return;}
    const controller=new AbortController();pending.add(controller);const timer=setTimeout(()=>controller.abort(),8000);
    const payload={event,properties,visitorId,sessionId,path:location.pathname.slice(0,160),...source(),consent:true,consentVersion:VERSION,ipConsent:true};
    // No cookies, no form values, URL query/hash or full referrer, no fingerprint.
    // A failed analytics request has no effect on navigation or the club page.
    fetch('/api/analytics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'omit',keepalive:true,signal:controller.signal})
      .catch(()=>{}).finally(()=>{clearTimeout(timer);pending.delete(controller);});
  }
  function pageView(){if(choice==='accepted'&&!pageSent){pageSent=true;track('page_view');}}
  let preferencesOpen=false,notificationDismissed=false,returnFocus=null;
  const style=document.createElement('style');
  style.textContent=`
    #analytics-consent{position:fixed;z-index:70;right:24px;bottom:24px;left:auto;width:min(590px,calc(100% - 48px));max-height:calc(100svh - 48px);overflow:auto;margin:0;padding:21px 23px 20px;border:1px solid #ffffff29;border-radius:20px;background:linear-gradient(135deg,#24272bf5,#17191cf7);color:#c9cdd3;box-shadow:0 14px 60px #0004,inset 0 1px 0 #ffffff08;backdrop-filter:blur(20px);font:12px/1.6 Manrope,Arial,sans-serif;isolation:isolate;box-sizing:border-box}
    #analytics-consent[hidden],#analytics-consent [hidden]{display:none!important}
    #analytics-consent .ac-heading-row{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:8px}
    #analytics-consent h2{margin:0;color:#f4f5f6;font-size:15px;font-weight:700;letter-spacing:-.025em;line-height:1.4}
    #analytics-consent p{margin:0;font-size:12px;line-height:1.65;color:#c2c6ce}
    #analytics-consent .ac-more{display:inline;color:#edf0f4;white-space:nowrap;text-decoration:underline;text-underline-offset:3px;margin-left:4px;font-size:11px}
    #analytics-consent .ac-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:16px}
    #analytics-consent .ac-choice{min-height:42px;padding:11px 19px;border:1px solid #ffffff40;border-radius:100px;background:transparent;color:#edf0f4;font:600 11px/1.3 Manrope,Arial,sans-serif;cursor:pointer;touch-action:manipulation;transition:background .18s,border-color .18s}
    #analytics-consent .ac-choice:hover{background:#ffffff0d;border-color:#ffffff75}
    #analytics-consent .ac-accept{background:#fc7952;border-color:#fc7952;color:#191c20}
    #analytics-consent .ac-accept:hover{background:#ff8d6b;border-color:#ff8d6b}
    #analytics-consent .ac-close{display:grid;place-items:center;width:32px;height:32px;flex:none;padding:6px;border:1px solid #ffffff26;border-radius:50%;background:transparent;color:#dce0e5;cursor:pointer}
    #analytics-consent .ac-close svg{width:16px;height:16px;stroke:currentColor;stroke-width:1.5;fill:none;stroke-linecap:round}
    #analytics-consent .ac-status{margin-top:8px;color:#aeb6c1;font-size:10px}
    #analytics-consent button:focus-visible,#analytics-consent a:focus-visible,#analytics-settings:focus-visible{outline:2px solid #fc7952;outline-offset:4px}
    #analytics-settings{font:inherit;font-size:10px;line-height:1.4;min-height:36px;padding:8px 0;border:0;border-radius:0;background:transparent;color:inherit;text-decoration:underline;text-underline-offset:4px;cursor:pointer;touch-action:manipulation}
    @media(max-width:600px){#analytics-consent{right:16px;bottom:max(16px,env(safe-area-inset-bottom));width:calc(100% - 32px);max-height:calc(100svh - 32px);padding:17px 18px 18px;border-radius:17px}#analytics-consent h2{font-size:14px}#analytics-consent p{font-size:11px;line-height:1.6}#analytics-consent .ac-actions{gap:8px;margin-top:14px}#analytics-consent .ac-choice{padding:11px 13px;flex:1;font-size:10px;min-height:41px}#analytics-settings{font-size:9px}}
    @media(prefers-reduced-motion:reduce){#analytics-consent .ac-choice{transition:none}}
    @media print{#analytics-consent,#analytics-settings{display:none!important}}
  `;
  const headingRow=document.createElement('div');headingRow.className='ac-heading-row';
  const heading=document.createElement('h2');heading.id='analytics-consent-title';
  const close=document.createElement('button');close.type='button';close.className='ac-close';close.id='analytics-dismiss';close.setAttribute('aria-label','Закрыть настройки приватности');
  const closeIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');closeIcon.setAttribute('viewBox','0 0 20 20');closeIcon.setAttribute('aria-hidden','true');
  const closePath=document.createElementNS('http://www.w3.org/2000/svg','path');closePath.setAttribute('d','M5 5 15 15M15 5 5 15');closeIcon.append(closePath);close.append(closeIcon);headingRow.append(heading,close);
  const explanation=document.createElement('p');explanation.id='analytics-consent-copy';explanation.textContent='С твоего согласия используем аналитику сайта и Яндекс Метрику: просмотры, нажатия и источники переходов. На главной работает Вебвизор. Контактные поля скрыты от записи. ';
  const privacy=document.createElement('a');privacy.className='ac-more';privacy.href='/privacy.html';privacy.target='_blank';privacy.rel='noopener';privacy.textContent='Подробнее';explanation.append(privacy);
  const status=document.createElement('p');status.className='ac-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const actions=document.createElement('div');actions.className='ac-actions';
  function button(text,id,className,fn){const button=document.createElement('button');button.type='button';button.id=id;button.className=className;button.textContent=text;button.addEventListener('click',fn);actions.append(button);return button;}
  const accept=button('Принять','analytics-accept','ac-choice ac-accept',()=>choose('accepted'));
  const decline=button('Только необходимые','analytics-decline','ac-choice',()=>choose('declined'));
  const settings=document.createElement('button');settings.type='button';settings.id='analytics-settings';settings.textContent='Cookies и данные';settings.setAttribute('aria-controls','analytics-consent');settings.setAttribute('aria-haspopup','dialog');
  (document.querySelector('.footer-v7')||mount.parentElement).append(settings);
  mount.replaceChildren(style,headingRow,explanation,actions,status);
  mount.setAttribute('aria-labelledby',heading.id);mount.setAttribute('aria-describedby',explanation.id);
  function modalOpen(){return Boolean(document.querySelector('dialog[open]'))||[...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(element=>element!==mount&&!element.hidden&&element.getAttribute('aria-hidden')!=='true');}
  function updateVisibility(){const visible=!modalOpen()&&(preferencesOpen||(choice===null&&!notificationDismissed));if(mount.hidden===visible)mount.hidden=!visible;settings.setAttribute('aria-expanded',String(preferencesOpen&&visible));}
  function update(){
    heading.textContent=preferencesOpen?'Настройки приватности':'Cookies и аналитика';
    close.hidden=!preferencesOpen;status.hidden=!preferencesOpen;
    status.textContent=choice==='accepted'?'Аналитика разрешена. Согласие можно отозвать ниже.':choice==='declined'?'Аналитика отключена. Сайт работает без ограничений.':'Необязательная аналитика пока отключена.';
    decline.textContent=preferencesOpen&&choice==='accepted'?'Отозвать согласие':'Только необходимые';
    mount.setAttribute('role',preferencesOpen?'dialog':'region');
    if(preferencesOpen)mount.setAttribute('aria-modal','false');else mount.removeAttribute('aria-modal');
    mount.dataset.consentState=choice||'undecided';mount.dataset.preferencesOpen=String(preferencesOpen);
    setMetrikaConsent(choice==='accepted');
    updateVisibility();
  }
  function restoreFocus(){const target=returnFocus?.isConnected?returnFocus:settings;returnFocus=null;if(!modalOpen())target.focus({preventScroll:true});}
  function dismiss(){if(!preferencesOpen)return;preferencesOpen=false;notificationDismissed=choice===null;update();restoreFocus();}
  settings.addEventListener('click',()=>{returnFocus=document.activeElement;preferencesOpen=true;notificationDismissed=false;update();if(!mount.hidden)close.focus({preventScroll:true});});
  close.addEventListener('click',dismiss);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&preferencesOpen&&!mount.hidden){event.preventDefault();event.stopPropagation();dismiss();}});
  // Native game/gallery dialogs own the top layer. Observing their lifecycle
  // avoids any banner or preferences panel competing with mobile controls.
  const isModal=element=>element?.nodeType===1&&(element.matches('dialog,[role="dialog"][aria-modal="true"]')||element.querySelector('dialog,[role="dialog"][aria-modal="true"]'));
  const observer=new MutationObserver(records=>{if(records.some(record=>record.type==='childList'?[...record.addedNodes,...record.removedNodes].some(isModal):record.target!==mount&&record.target.matches('dialog,[role="dialog"]')))updateVisibility();});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','hidden','aria-hidden','aria-modal','role']});
  document.addEventListener('close',updateVisibility,true);
  function choose(value){
    const wasPreferencesOpen=preferencesOpen;
    choice=value;write(localStorage,KEY,JSON.stringify({version:VERSION,choice:value,date:new Date().toISOString()}));
    if(value!=='accepted'){for(const controller of pending)controller.abort();pending.clear();write(localStorage,VISITOR,null);write(sessionStorage,SESSION,null);visitorId=sessionId=null;pageSent=false;}
    preferencesOpen=false;notificationDismissed=false;update();if(value==='accepted')pageView();
    if(wasPreferencesOpen||mount.contains(document.activeElement))restoreFocus();
  }
  update();pageView();
  const allowedTargets=new Set(['call','smartgamer','plan','share','calendar','map','vk','telegram','tariff_standard','tariff_pro','tariff_vip','cockpit','coach','booking','directions','guest_card','print','download']);
  const knownIds={'open-plan':'plan','plan-copy':'share','plan-share':'share','plan-calendar':'calendar','plan-png':'download','save-guest':'guest_card','restore-guest':'guest_card','sim-book':'booking'};
  document.addEventListener('click',event=>{
    if(choice!=='accepted')return;const control=event.target.closest?.('a,button');if(!control||mount.contains(control))return;
    let target=control.dataset.analyticsTarget||knownIds[control.id];
    const tariff=control.dataset.tariff;if(['standard','pro','vip'].includes(tariff))target='tariff_'+tariff;
    if(control.matches('a[href^="tel:"]'))target='call';
    if(control.dataset.openDrive)target='cockpit';
    if(!target&&control.tagName==='A')try{const url=new URL(control.href,location.href);if(/(^|\.)smartgamer\./.test(url.hostname))target='smartgamer';else if(/(^|\.)vk\.(com|ru)$/.test(url.hostname))target='vk';else if(url.hostname==='t.me')target='telegram';else if(/(^|\.)yandex\.(ru|com)$/.test(url.hostname)&&url.pathname.startsWith('/maps'))target='map';}catch{}
    if(!allowedTargets.has(target))return;
    const properties={target};if(['standard','pro','vip'].includes(tariff))properties.tariff=tariff;if(['race','drift'].includes(control.dataset.openDrive))properties.mode=control.dataset.openDrive;
    track(['booking','plan','smartgamer'].includes(target)?'booking_intent':'click',properties);
  });
  // Capture only the fact of changing these non-sensitive configuration controls.
  document.addEventListener('change',event=>{if(['duration','people','vr-toggle','vr-count'].includes(event.target.id))track('visit_plan',{target:'plan'});});
  window.addEventListener('storage',event=>{if(event.key!==KEY&&event.key!==null)return;let next=null;try{const value=JSON.parse(read(localStorage,KEY));if(value?.version===VERSION)next=value.choice;}catch{}choice=next==='accepted'?'accepted':next==='declined'?'declined':null;if(choice!=='accepted'){for(const controller of pending)controller.abort();pending.clear();visitorId=sessionId=null;pageSent=false;write(sessionStorage,SESSION,null);}if(choice!==null)preferencesOpen=false;update();pageView();});
}
