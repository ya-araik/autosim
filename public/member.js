import {TARIFFS,money} from './club-data.js?v=20261107';
import {pendingResult,pendingAttempt,gameTime} from './game-results.js';
import {initialMemberSession} from './member-session.js?v=21';
const $=id=>document.getElementById(id),$$=s=>[...document.querySelectorAll(s)];
let gameHistory;
let clubProfileRequired=false;
let session=null,dashboard=null,authMode='login',cancelTarget=null,refreshing=false;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const date=value=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Yekaterinburg',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
function checkPassword(value){if([...value].length<8||[...value].length>128||!/[\p{P}\p{S}]/u.test(value))throw Error('От 8 до 128 символов и хотя бы один спецсимвол: например, @, ! или #.');}
function status(id,text='',error=false){$(id).textContent=text;$(id).classList.toggle('is-error',error);}
function signedOut(){gameHistory?.stopGameHistory();document.getElementById('member-game')?.replaceChildren();session=null;dashboard=null;$('member-loading').hidden=true;$('club-profile-status').hidden=true;$('club-verification').reset();$('member-view').hidden=true;$('auth-view').hidden=false;$('auth-submit').disabled=false;$('logout').hidden=true;$('bookings-list').replaceChildren();$('pilot-name').textContent='';$('pilot-number').textContent='';$('profile-form').reset();$('password-form').reset();$('cancel-dialog').close();}
async function api(path,{method='GET',body}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  try{
    const headers={Accept:'application/json'};if(body!==undefined)headers['Content-Type']='application/json';if(method!=='GET'&&session?.csrf)headers['X-CSRF-Token']=session.csrf;
    const r=await fetch('/api/member/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',cache:'no-store',signal:controller.signal});
    let data;try{data=await r.json();}catch{}
    if(!r.ok){if(r.status===401&&data?.error?.code==='member_unauthorized')signedOut();const error=new Error(data?.error?.message||'Сервис временно недоступен. Можно записаться по телефону.');error.status=r.status;throw error;}
    if(!data||typeof data!=='object')throw Error('Не удалось прочитать ответ сервера.');return data;
  }catch(error){if(error.name==='AbortError')throw Error('Сервер отвечает дольше обычного. Повтори попытку — сохранённая заявка не создастся дважды.');throw error;}
  finally{clearTimeout(timer);}
}
function showAuth(mode){
  authMode=mode;
  $('club-registration-fields').hidden=mode!=='register'||!clubProfileRequired;for(const key of ['phone','birthDate'])$('auth-form').elements[key].required=mode==='register'&&clubProfileRequired;
  $$('[data-auth]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.auth===mode)));
  $('name-field').hidden=mode!=='register';$('auth-form').elements.name.required=mode==='register';
  $('register-consent').hidden=mode!=='register';$('auth-form').elements.consent.required=mode==='register';
  $('recovery-field').hidden=mode!=='recover';$('auth-form').elements.recoveryCode.required=mode==='recover';
  $('password-hint').hidden=mode==='login';$('auth-form').elements.password.minLength=mode==='login'?1:8;
  $('auth-form').elements.password.autocomplete=mode==='login'?'current-password':'new-password';
  $('auth-title').textContent={login:'С возвращением.',register:'Твой первый круг.',recover:'Вернёмся за руль.'}[mode];
  $('auth-description').textContent={login:'Твои заезды и карточка пилота — здесь.',register:'Один профиль — для твоих заездов и клубной истории.',recover:'Введи код, который сохранил при регистрации, и новый пароль.'}[mode];
  const pending=pendingAttempt();if(pending&&mode!=='recover')$('auth-description').textContent='Твоё время '+gameTime(pending.timeMs)+' ждёт сохранения. '+(mode==='register'?'Создай профиль, чтобы сохранить попытку.':'Войди, чтобы сохранить попытку в свой профиль.');
  $('password-label').textContent=mode==='recover'?'Новый пароль':'Пароль';
  $('auth-submit').firstChild.textContent={login:'Войти ',register:'Создать профиль ',recover:'Восстановить вход '}[mode];
  $('forgot').textContent=mode==='recover'?'Назад ко входу':'Забыл пароль';status('auth-status');
}
function recovery(code){$('recovery-code').textContent=code;status('recovery-copy-status');$('recovery-dialog').showModal();}
function applyUser(user){
  session.user=user;$('welcome').textContent='Привет, '+user.name+'.';$('pilot-name').textContent=user.name;
  $('pilot-initial').textContent=Array.from(user.name)[0]?.toUpperCase()||'А';$('pilot-number').textContent=user.pilotNumber;
  $('pilot-since').textContent=new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Yekaterinburg',month:'2-digit',year:'numeric'}).format(new Date(user.createdAt));
  if(!document.activeElement?.closest('#profile-form')){const f=$('profile-form');f.elements.name.value=user.name;f.elements.phone.value=user.phone;f.elements.birthDate.value=user.birthDate||'';}
}
async function signIn(value){
  if(!value.authenticated||!value.csrf||!value.user)throw Error('Сервер не подтвердил вход.');
  session={authenticated:true,user:value.user,csrf:value.csrf};$('auth-form').reset();$('auth-view').hidden=true;$('member-loading').hidden=true;$('member-view').hidden=false;$('logout').hidden=false;
  applyUser(value.user);status('app-status');status('bookings-status','Загружаем твои записи…');
  void refresh();void loadGameHistory(session);
  if(location.hash.startsWith('#book'))$('booking').scrollIntoView({behavior:'instant',block:'start'});
  if(value.recoveryCode)recovery(value.recoveryCode);
}
async function loadGameHistory(expected){
  $('member-game').textContent='Загружаем твои рекорды…';
  try{
    gameHistory=await import('./game-account.js?v=21');
    if(session!==expected)return;
    await gameHistory.showGameHistory(expected,null,{saveOnArrival:new URLSearchParams(location.search).get('from')==='game'});
    if(session===expected&&(pendingAttempt()||location.hash==='#member-game'||new URLSearchParams(location.search).get('from')==='game'))$('member-game').scrollIntoView({behavior:'instant',block:'start'});
  }catch{
    if(session!==expected)return;
    $('member-game').replaceChildren(el('p','История заездов пока недоступна. Запись в клуб работает.'),actionButton('Обновить историю',()=>void loadGameHistory(expected)));
  }
}
function actionButton(text,fn,cls='quiet'){const b=el('button',text,cls);b.type='button';b.addEventListener('click',fn);return b;}
function calendar(row){
  const stamp=d=>new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'');
  const confirmed=row.status==='confirmed';
  const content=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AUTOSIM//Club Visit//RU','BEGIN:VEVENT','UID:'+row.id+'@autosim.club','DTSTAMP:'+stamp(new Date()),'DTSTART:'+stamp(row.startsAt),'DTEND:'+stamp(row.endsAt),'SUMMARY:АВТОСИМ — '+(confirmed?'заезд подтверждён':'заявка на заезд'),'LOCATION:Оренбург\\, Рыбаковская\\, 59','STATUS:'+(confirmed?'CONFIRMED':'TENTATIVE'),'END:VEVENT','END:VCALENDAR'].join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([content],{type:'text/calendar;charset=utf-8'})),a=el('a');a.href=url;a.download='autosim-'+row.reference+'.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderBookings(rows){
  const list=$('bookings-list');list.replaceChildren();
  if(!rows.length){const empty=el('div',undefined,'empty-bookings');const copy=el('div');copy.append(el('strong','Первый заезд впереди.'),el('p','Оставь заявку — согласуем время по телефону.'));empty.append(copy);list.append(empty);return;}
  const now=Date.now();const ordered=[...rows].sort((a,b)=>{const active=r=>['draft','confirmed'].includes(r.status)&&new Date(r.endsAt).getTime()>now;return Number(active(b))-Number(active(a))||(active(a)?new Date(a.startsAt)-new Date(b.startsAt):new Date(b.startsAt)-new Date(a.startsAt));});
  for(const row of ordered){
    const article=el('article',undefined,'booking-card'),top=el('div',undefined,'booking-card-top');
    const remoteSync=dashboard?.smartshell?.find(j=>j.bookingId===row.id);
    const label=row.status==='cancelled'&&remoteSync&&!['synced','not_needed'].includes(remoteSync.state)?'Отмену согласовываем с клубом':['draft','confirmed'].includes(row.status)&&remoteSync&&remoteSync.state!=='synced'?(['conflict','error','uncertain'].includes(remoteSync.state)?'Нужна помощь клуба':'Проверяем место'):row.proposal?'Другое время':({draft:'Ждёт подтверждения',confirmed:'Подтверждён',cancelled:'Отменён',completed:'Завершён'}[row.status]||'Заявка');
    top.append(el('span',row.reference),el('span',label,'booking-badge '+row.status));
    article.append(top,el('h3',date(row.startsAt)),el('p',`${row.tariff==='mixed'?'Компания':TARIFFS[row.tariff]?.name||row.tariff} · ${row.duration} минут · гостей: ${row.participants} · VR: ${row.vrCount}`),el('p',money(row.priceRub),'booking-amount'));
    if(row.seatLabels?.length)article.append(el('p',row.seatLabels.join(' · '),'seat-booking-label'));if(['conflict','error','uncertain'].includes(remoteSync?.state)&&row.status!=='cancelled')article.append(el('p','Место пока не подтверждено. Клуб получил уведомление.','owner-message'));else if(row.ownerMessage&&row.status!=='confirmed')article.append(el('p',row.ownerMessage,'owner-message'));
    if(row.proposal){const box=el('div',undefined,'proposal-box');box.append(el('strong','Владелец предлагает: '+date(row.proposal.startsAt)),el('p','Подтверди перенос.'));box.append(actionButton('Мне подходит это время',async event=>{const b=event.currentTarget;b.disabled=true;try{await api('bookings/'+row.id+'/accept-proposal',{method:'POST',body:{version:row.version}});await refresh();status('bookings-status','Перенос отправлен клубу.');}catch(error){status('bookings-status',error.message,true);await refresh();}finally{b.disabled=false;}},'secondary'));article.append(box);}
    const actions=el('div',undefined,'booking-card-actions');
    if(row.status==='confirmed'&&(!remoteSync||remoteSync.state==='synced'))actions.append(actionButton('В календарь',()=>calendar(row)));
    if(['draft','confirmed'].includes(row.status)&&new Date(row.startsAt).getTime()>now)actions.append(actionButton('Отменить',()=>{cancelTarget=row;status('cancel-status');$('cancel-dialog').showModal();}));
    if(actions.childNodes.length)article.append(actions);list.append(article);
  }
}
async function refresh(){
  if(!session||refreshing)return;const expected=session;refreshing=true;$('refresh-bookings').disabled=true;
  try{const data=await api('me');if(session!==expected)return;dashboard=data;applyUser(data.user);const profileSync=data.smartshell?.find(j=>j.kind==='profile');$('club-profile-status').hidden=profileSync?.state!=='needs_verification';$('club-verification').hidden=profileSync?.state!=='needs_verification';$('integration-test-note').textContent='Подтверди телефон для клубного профиля. Заявку на заезд можно оставить уже сейчас.';renderBookings(data.bookings);$('completed-visits').textContent=String(data.completedVisits);$('skill-note').textContent=data.skill?.note||'После заезда здесь появится первая проверенная рекомендация.';$('skill-date').textContent=data.skill?'Проверено сотрудником · '+new Intl.DateTimeFormat('ru-RU').format(new Date(data.skill.verifiedAt)):'Клубная карточка хранит реальные визиты и наблюдения.';status('app-status');status('bookings-status');if(data.historyTruncated)status('bookings-status','Показаны последние записи. Полную историю можно уточнить у клуба.');}
  catch(error){if(session===expected)status('bookings-status','Не удалось обновить записи: '+error.message,true);}
  finally{refreshing=false;$('refresh-bookings').disabled=false;}
}
$$('[data-auth]').forEach(b=>b.addEventListener('click',()=>showAuth(b.dataset.auth)));
$('forgot').addEventListener('click',()=>showAuth(authMode==='recover'?'login':'recover'));
$('show-password').addEventListener('click',()=>{const p=$('auth-form').elements.password;p.type=p.type==='password'?'text':'password';$('show-password').textContent=p.type==='password'?'Показать':'Скрыть';$('show-password').setAttribute('aria-label',p.type==='password'?'Показать пароль':'Скрыть пароль');});
$('auth-form').addEventListener('submit',async event=>{
  event.preventDefault();const f=$('auth-form');if(!f.reportValidity())return;$('auth-submit').disabled=true;status('auth-status','Проверяем…');
  try{if(authMode!=='login')checkPassword(f.elements.password.value);const body={username:f.elements.username.value.trim().toLowerCase(),password:f.elements.password.value};if(authMode==='register')Object.assign(body,{...(clubProfileRequired?{phone:f.elements.phone.value,birthDate:f.elements.birthDate.value}:{}),name:f.elements.name.value.trim(),consent:f.elements.consent.checked,...(pendingResult()?{gameEntry:pendingResult().token}:{})});if(authMode==='recover')body.recoveryCode=f.elements.recoveryCode.value.trim();const data=await api(authMode,{method:'POST',body});if(authMode==='recover'){f.reset();showAuth('login');status('auth-status','Пароль обновлён. Войди с новым паролем.');recovery(data.recoveryCode);}else await signIn(data);}
  catch(error){status('auth-status',error.message,true);}finally{$('auth-submit').disabled=false;}
});
$('logout').addEventListener('click',async()=>{try{await api('logout',{method:'POST',body:{}});signedOut();showAuth('login');status('app-status','Ты вышел из кабинета.');window.scrollTo({top:0,behavior:'instant'});}catch(error){status('app-status',error.message,true);}});
$('copy-recovery').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('recovery-code').textContent);status('recovery-copy-status','Код скопирован. Сохрани его в безопасном месте.');}catch{status('recovery-copy-status','Скопируй код вручную: браузер не разрешил доступ к буферу.',true);}});
$('close-recovery').addEventListener('click',()=>{$('recovery-dialog').close();$('recovery-code').textContent='';});
$('recovery-dialog').addEventListener('cancel',()=>{$('recovery-code').textContent='';});
$('refresh-bookings').addEventListener('click',()=>void refresh());
$('keep-booking').addEventListener('click',()=>$('cancel-dialog').close());
$('confirm-cancel').addEventListener('click',async()=>{if(!cancelTarget)return;$('confirm-cancel').disabled=true;try{await api('bookings/'+cancelTarget.id+'/cancel',{method:'POST',body:{version:cancelTarget.version}});$('cancel-dialog').close();cancelTarget=null;await refresh();status('bookings-status','Запись отменена. Владелец получит обновление.');}catch(error){status('cancel-status',error.message,true);}finally{$('confirm-cancel').disabled=false;}});
$('profile-form').addEventListener('submit',async event=>{event.preventDefault();if(!session)return;const f=$('profile-form'),button=event.submitter;button.disabled=true;try{const data=await api('me',{method:'PATCH',body:{name:f.elements.name.value.trim(),phone:f.elements.phone.value.trim(),birthDate:f.elements.birthDate.value,version:session.user.version}});applyUser(data.user);status('profile-status','Профиль обновлён.');}catch(error){status('profile-status',error.message,true);if(error.status===409)await refresh();}finally{button.disabled=false;}});
$('password-form').addEventListener('submit',async event=>{event.preventDefault();const f=$('password-form'),button=event.submitter;button.disabled=true;try{checkPassword(f.elements.password.value);const data=await api('password',{method:'POST',body:{currentPassword:f.elements.currentPassword.value,password:f.elements.password.value}});session={authenticated:true,user:data.user,csrf:data.csrf};f.reset();applyUser(data.user);recovery(data.recoveryCode);status('password-status','Пароль обновлён. Остальные сеансы завершены.');}catch(error){status('password-status',error.message,true);}finally{button.disabled=false;}});
showAuth(location.hash==='#register'?'register':'login');
window.addEventListener('focus',()=>void refresh());document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
setInterval(()=>{if(session&&!document.hidden)void refresh();},60000);
try{
  const result=await initialMemberSession;
  if(result.error)throw result.error;
  const value=result.data;clubProfileRequired=!!value.clubProfileRequired;showAuth(authMode);
  if(value.authenticated)await signIn(value);else{signedOut();status('app-status');}
}catch(error){
  $('member-loading').setAttribute('aria-busy','false');
  $('member-loading-status').textContent=error.message||'Не удалось проверить вход. Повтори попытку.';
  $('member-loading-error').hidden=false;
}

async function confirmClubPhone(action,button){
  if(!session)return;button.disabled=true;status('club-verification-status','Проверяем…');
  try{const data=await api('smartshell/verification',{method:'POST',body:{action,...(action==='verify'?{code:$('club-verification').elements.code.value.trim()}:{})}});status('club-verification-status',data.state==='synced'?'Клубный профиль готов.':data.message);if(data.state==='synced')$('club-verification').reset();await refresh();}
  catch(e){status('club-verification-status',e.message,true);}finally{button.disabled=false;}
}
$('club-verification').addEventListener('submit',e=>{e.preventDefault();confirmClubPhone('verify',e.submitter);});
$('club-send-code').addEventListener('click',e=>confirmClubPhone('send',e.currentTarget));
