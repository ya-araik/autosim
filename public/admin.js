import {initIntegrations} from './admin-integrations.js?v=23';
import {initClubAdmin} from './admin-club.js?v=17';
const $=id=>document.getElementById(id);
const $$=selector=>[...document.querySelectorAll(selector)];
const TZ='Asia/Yekaterinburg';
const statusNames={draft:'Черновик',confirmed:'Подтверждена',cancelled:'Отменена',completed:'Завершена',active:'Активен',inactive:'Неактивен'};
const tariffNames={standard:'Standard',pro:'Pro',vip:'VIP',mixed:'Компания · разные симуляторы'};
const bookingTransitions={draft:['draft','confirmed','cancelled'],confirmed:['confirmed','cancelled','completed'],cancelled:['cancelled'],completed:['completed']};
const viewNames={overview:'Обзор',bookings:'Бронирования',guests:'Клиенты и профили',events:'Посещения и события',audit:'Журнал действий',settings:'Система',game:'Игра и награды',access:'Команда и роли',smartshell:'SmartShell'};
const eventNames={page_view:'Просмотр страницы',click:'Нажатие',booking_intent:'Намерение связаться',visit_plan:'Настройка визита'};
let csrf='',authenticated=false,view='overview',loadSequence=0,settingsVersion,editing=null;
let club=null,integrations=null,principal=null;
const can=p=>Boolean(principal?.isOwner||principal?.permissions?.includes(p));
const isOwner=()=>principal?.isOwner===true;
const viewPermission={bookings:'bookings.read',guests:'profiles.read',game:'game.read',overview:'analytics.read',events:'analytics.read',audit:'audit.read',settings:'owner',access:'owner'};
const canView=v=>v==='smartshell'?isOwner()||principal?.permissions?.some(p=>p.startsWith('smartshell.')):can(viewPermission[v]);
function applyAccess(){
  $$('[data-view]').forEach(b=>b.hidden=!canView(b.dataset.view));
  for(const id of ['nav-reports','nav-owner'])$(id).hidden=![...$(id).querySelectorAll('[data-view]')].some(b=>!b.hidden);
  $('new-booking').hidden=!can('bookings.write');$('new-guest').hidden=!can('profiles.write');
  $$('[data-export]').forEach(b=>b.hidden=!can('data.export'));
}
const records={bookings:[],guests:[],events:[],audit:[]};
const pages={};
const count=value=>Number.isFinite(Number(value))&&value!==null&&value!==''?new Intl.NumberFormat('ru-RU').format(Number(value)):'—';
const display=value=>value===null||value===undefined||value===''?'—':String(value);
function node(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=display(text);if(className)e.className=className;return e;}
function datetime(value){const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('ru-RU',{timeZone:TZ,dateStyle:'short',timeStyle:'short'}).format(date):'—';}
function clubParts(value=new Date()){
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))return {date:'',time:''};
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
function message(text='',error=false,id='admin-status'){const target=$(id);target.textContent=text;target.classList.toggle('is-error',error);}
function clearPrivateState(){principal=null;integrations?.clear();club?.clear();for(const key of Object.keys(records))records[key]=[];for(const key of Object.keys(pages))delete pages[key];for(const target of ['overview-metrics','daily-chart','referrer-report','device-report','utm-report','bookings-table','guests-table','events-table','audit-table','health-data','game-metrics','game-registrations','game-scores','game-redemptions'])$(target).replaceChildren();for(const target of ['bookings-count','guests-count','events-count','audit-count','admin-identity'])$(target).textContent='';$('settings-form').reset();$('record-fields').replaceChildren();editing=null;settingsVersion=undefined;}
function showLogin(text='Введи логин и пароль.'){
  authenticated=false;csrf='';loadSequence++;$('record-dialog').close();clearPrivateState();$('admin-app').hidden=true;$('admin-login').hidden=false;message(text,false,'login-status');$('login-form').elements.username.focus({preventScroll:true});
}
function signIn(session){if(!session?.authenticated||!session.csrf)throw Error('Сервер не подтвердил авторизацию.');csrf=session.csrf;authenticated=true;$('login-form').reset();$('admin-login').hidden=true;$('admin-app').hidden=false;principal=session.user;$('admin-identity').textContent=display(principal.username)+' · '+(principal.roleName||'');applyAccess();const first=['bookings','guests','game','smartshell','overview','audit','settings','access'].find(canView);if(first)setView(first);else{$$('[data-panel]').forEach(p=>p.hidden=true);$('period-bar').hidden=true;$('view-title').textContent='Нет назначенных разделов';message('Владелец может выдать доступ к нужным функциям.');}$('admin-main').focus({preventScroll:true});void openLinkedBooking();}

async function api(path,{method='GET',body,blob=false}={}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),60000);
  try{
    const headers={Accept:blob?'text/csv':'application/json'};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(method!=='GET'&&csrf)headers['X-CSRF-Token']=csrf;
    const response=await fetch('/api/admin/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',cache:'no-store',signal:controller.signal});
    if(!response.ok){
      let data;try{data=await response.json();}catch{}
      if(response.status===401&&path!=='login'&&path!=='session')showLogin('Сессия завершилась. Войди ещё раз.');
      const text=typeof data?.error==='string'?data.error:data?.error?.message||data?.message;
      const error=new Error(text||(response.status===409?'Запись уже изменена. Обнови данные и открой её заново.':response.status===429?'Слишком много запросов. Подожди и попробуй снова.':`Сервис ответил ошибкой ${response.status}.`));
      error.status=response.status;throw error;
    }
    if(blob)return response.blob();
    if(response.status===204)return{};
    return await response.json();
  }catch(error){if(error.name==='AbortError')throw Error('Сервер не ответил вовремя. Попробуй ещё раз.');throw error;}
  finally{clearTimeout(timer);}
}

function presetDates(){const preset=$('period-preset').value;if(preset==='custom')return;const today=clubParts().date;const start=new Date(today+'T12:00:00Z');start.setUTCDate(start.getUTCDate()-(preset==='30d'?29:preset==='7d'?6:0));$('period-from').value=start.toISOString().slice(0,10);$('period-to').value=today;}
function periodQuery(){
  const from=$('period-from').value,to=$('period-to').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Error('Укажи корректный период: начальная дата должна быть не позже конечной.');
  return new URLSearchParams({from,to});
}
function empty(target,title='Пока нет записей',copy='Данные появятся после реальных действий.'){
  const block=node('div',undefined,'empty-state');block.append(node('strong',title),node('span',copy));target.replaceChildren(block);
}
function setView(next){
  if(!Object.hasOwn(viewNames,next)||!authenticated||!canView(next))return;
  view=next;$('view-title').textContent=viewNames[view];
  $$('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==view);
  $$('[data-view]').forEach(button=>button.dataset.view===view?button.setAttribute('aria-current','page'):button.removeAttribute('aria-current'));
  $('period-bar').hidden=['guests','settings','access','smartshell'].includes(view);
  void refresh();
}
function metric(label,value,note){const box=node('article',undefined,'metric');box.append(node('p',label),node('strong',count(value)),node('small',note));return box;}
function breakdown(id,items){
  const target=$(id);target.replaceChildren();
  if(!Array.isArray(items)||!items.length)return empty(target,'Нет данных','За выбранный период.');
  items.slice(0,12).forEach(item=>{const row=node('div',undefined,'report-row');row.append(node('span',item.label||'Прямой переход'),node('strong',count(item.count)));target.append(row);});
}
function overview(data){
  $('overview-metrics').replaceChildren(
    metric('Просмотры страниц',data.visits,'С согласием на аналитику'),metric('Сессии',data.sessions,'Случайные идентификаторы'),metric('Посетители',data.consentedUsers,'Идентификаторы с согласием'),
    metric('Нажатия «Позвонить»',data.callClicks,'Не подтверждённые звонки'),metric('Подтверждённые брони',data.confirmedBookings,'Записи сотрудников'),metric('Гости в базе',data.guestsTotal,'Карточки клуба')
  );
  breakdown('referrer-report',data.referrers);breakdown('device-report',data.devices);breakdown('utm-report',data.utmCampaigns);
  const chart=$('daily-chart');chart.replaceChildren();const days=Array.isArray(data.byDay)?data.byDay:[];
  if(!days.length)empty(chart,'Нет просмотров','Выбранный период пока пуст.');
  else{const max=Math.max(1,...days.map(d=>Number(d.visits)||0));for(const day of days){const column=node('div',undefined,'chart-column');const bar=node('span'),fill=node('i');fill.style.height=(Math.max(0,Number(day.visits)||0)/max*100)+'%';bar.append(fill);const label=display(day.date);column.title=`${label}: ${count(day.visits)} просмотров`;column.setAttribute('role','img');column.setAttribute('aria-label',column.title);column.append(bar,node('small',label.slice(5)));chart.append(column);}}
  if(data.truncated)message('Большой объём: показана ограниченная выборка. Сократи период, чтобы получить полные показатели.',true);
}
function cellPair(main,sub){const span=node('span');span.append(node('strong',main));if(sub)span.append(node('small',sub,'cell-sub'));return span;}
function badge(status){return node('span',statusNames[status]||display(status),'badge '+(Object.hasOwn(statusNames,status)?status:''));}
function table(target,headers,rows){
  target.replaceChildren();if(!rows.length)return empty(target);
  const t=node('table'),head=node('thead'),body=node('tbody'),header=node('tr');
  headers.forEach(text=>{const th=node('th',text);th.scope='col';header.append(th);});head.append(header);
  for(const values of rows){const tr=node('tr');values.forEach(value=>{const td=node('td');if(value instanceof Node){td.className='wrap-cell';td.append(value);}else{td.textContent=display(value);if(td.textContent.length>80)td.className='wrap-cell';}tr.append(td);});body.append(tr);}
  t.append(head,body);target.append(t);target.tabIndex=0;target.setAttribute('aria-label','Таблица. На узком экране можно прокрутить по горизонтали.');
}
function editButton(kind,item){const button=node('button','Открыть','row-action');button.type='button';button.setAttribute('aria-label','Открыть '+display(kind==='bookings'?item.guestName:item.name));button.addEventListener('click',()=>openRecord(kind,item));return button;}
function renderBookings(){
  const filter=$('booking-status-filter').value;
  const items=records.bookings.filter(item=>!filter||item.status===filter);
  table($('bookings-table'),['Дата · UTC+5','Гость','Формат','Участники','Статус','Сумма',''],items.map(item=>[
    cellPair(datetime(item.startsAt),`${display(item.duration)} мин`),cellPair(item.guestName,item.phone),cellPair((item.seatLabels||[]).join(' · ')||tariffNames[item.tariff]||item.tariff,Number(item.vrCount??(item.vr?item.participants:0))>0?'VR: '+(item.vrCount??item.participants)+' из '+item.participants:'Без VR'),display(item.participants),badge(item.status),Number.isFinite(Number(item.priceRub))?count(item.priceRub)+' ₽':'—',editButton('bookings',item)
  ]));
}
function renderGuests(){club.renderProfiles(records.guests);}
function shortId(value){const text=display(value);return text.length>17?text.slice(0,8)+'…'+text.slice(-6):text;}
function utmLabel(utm){const parts=[utm?.source,utm?.medium,utm?.campaign];return parts.some(value=>value!==null&&value!==undefined&&value!=='')?'UTM: '+parts.map(display).join(' / '):'';}
function propertiesLabel(value){if(!value||typeof value!=='object')return'—';return Object.entries(value).filter(([key])=>['target','section','tariff','mode'].includes(key)).map(([key,v])=>key+': '+String(v)).join(' · ')||'—';}
function renderEvents(){
  if($('events-dataset').value==='visitors')table($('events-table'),['Посетитель','Сессии / события','Последний визит · UTC+5','IP','Устройство','Источник / UTM'],records.events.map(item=>[
    cellPair(shortId(item.visitorId),'Первый: '+datetime(item.firstSeen)),count(item.sessions)+' / '+count(item.eventCount),datetime(item.lastSeen),display(item.ip),cellPair(item.device,item.browser),cellPair(item.referrer||'Прямой переход',utmLabel(item.utm))
  ]));
  else table($('events-table'),['Время · UTC+5','Событие','Страница / действие','IP','Сессия','Источник / UTM','Устройство'],records.events.map(item=>[
    datetime(item.createdAt||item.timestamp),eventNames[item.event]||item.event,cellPair(item.path,propertiesLabel(item.properties)),item.ip,shortId(item.sessionId),cellPair(item.referrer||'Прямой переход',utmLabel(item.utm)),cellPair(item.device,item.browser)
  ]));
}
function renderAudit(){table($('audit-table'),['Время · UTC+5','Сотрудник','Операция','Запись','Детали'],records.audit.map(item=>[datetime(item.createdAt),item.actor,item.action,cellPair(item.entity,shortId(item.entityId)),typeof item.details==='object'?JSON.stringify(item.details):item.details]));}
function renderCollection(kind){({bookings:renderBookings,guests:renderGuests,events:renderEvents,audit:renderAudit})[kind]();const p=pages[kind]||{};$(`${kind}-count`).textContent=`Загружено ${records[kind].length}${Number.isFinite(Number(p.total))?' из '+count(p.total):''}.`;const more=document.querySelector(`[data-more="${kind}"]`);more.hidden=p.nextOffset===null||p.nextOffset===undefined;}
function health(data){
  $('health-data').replaceChildren();for(const [label,value] of [['Backend',data.ok===true?'Отвечает':data.ok===false?'Есть ошибка':'Нет статуса'],['База данных',data.database?.status],['Тип базы',data.database?.version],['Версия сервиса',data.version],['Время сервера',datetime(data.serverTime)],['Проверено',datetime(new Date())]]){const row=node('div');row.append(node('dt',label),node('dd',display(value)));$('health-data').append(row);}
  const c=data.bookingChannel;if(c)for(const [label,value] of [['Канал онлайн-записи',c.configured?'Настроен · владельцев: '+(c.ownerCount||1):'Не настроен'],['Последняя проверка ботом',c.lastPoll?datetime(c.lastPoll):'Пока нет'],['Ожидают доставки',c.pending],['Повторные попытки доставки',c.retrying],['Кабинеты пилотов',c.accounts]]){const row=node('div');row.append(node('dt',label),node('dd',display(value)));$('health-data').append(row);}
}
function gameReport(data){
  $('game-metrics').replaceChildren(metric('Регистрации из игры',data.registrationCount,'Новые профили за выбранный период'),metric('Пилоты в рейтинге',data.racers,'За весь текущий сезон · только Про'),metric('Бесплатные часы',data.redeemedHours,'Списано за выбранный период'));
  table($('game-registrations'),['Позывной','Регистрация · UTC+5','Первый заезд'],data.registrations.map(r=>[r.username,datetime(r.createdAt),r.board==='pro'?'Про':'Тренировка']));
  table($('game-scores'),['Позывной','Время, сек','Дата','Публикация',''],data.scores.map(r=>{
    const action=node('button',r.hidden?'Вернуть в рейтинг':'Скрыть','row-action');
    action.addEventListener('click',async()=>{action.disabled=true;try{await api('game',{method:'PATCH',body:{key:r.key,hidden:!r.hidden}});await refresh();}catch(error){message(error.message,true);action.disabled=false;}});
    const actions=node('div',undefined,'toolbar-actions');const profile=node('button','Карточка пилота','row-action');profile.type='button';profile.addEventListener('click',async()=>{try{await club.profile(r.guestId);}catch(error){message(error.message,true);}});if(can('profiles.read'))actions.append(profile);if(can('game.write'))actions.append(action);return [r.username,(r.timeMs/1000).toFixed(3),datetime(r.createdAt),r.hidden?'Скрыт':'В рейтинге',actions];
  }));
  table($('game-redemptions'),['Пилот','Списано','Время посещения · UTC+5'],(data.redemptions||[]).map(r=>[r.username,r.minutes+' минут',datetime(r.redeemedAt)]));
}
async function refresh(append=false){
  if(!authenticated)return;const seq=++loadSequence,current=view;message('Загружаем данные…');$('refresh-button').disabled=true;
  try{
    const query=['settings','guests','access','smartshell'].includes(current)?new URLSearchParams():periodQuery();
    if(current==='access'){await integrations.access();message('Права сотрудников проверяются сервером при каждом запросе.');}
    else if(current==='smartshell'){await integrations.connection();message('SmartShell · подключение, симуляторы и синхронизация.');}
    else if(current==='overview'){const data=await api('overview?'+query);if(seq!==loadSequence||!authenticated)return;overview(data);if(!data.truncated)message('Данные обновлены · '+datetime(new Date()));}
    else if(current==='game'){const data=await api('game?'+query);if(seq!==loadSequence||!authenticated)return;gameReport(data);await club.loadGame();message('Данные обновлены · '+datetime(new Date()));}
    else if(current==='settings'){
      const [system,settings]=await Promise.all([api('health'),api('settings')]);if(seq!==loadSequence||!authenticated)return;health(system);settingsVersion=settings.version;$('settings-form').elements.operationalNotes.value=settings.operationalNotes||'';$('settings-form').elements.analyticsEnabled.checked=settings.analyticsEnabled===true;$('settings-form').elements.collectFullIp.checked=settings.collectFullIp===true;message('Проверка завершена · '+datetime(new Date()));
    }else{
      const endpoint=current==='events'?$('events-dataset').value:current==='guests'?'profiles':current;
      if(current==='guests'){query.delete('from');query.delete('to');query.set('q',$('guest-search').value.trim());}
      query.set('limit','100');if(append&&pages[current]?.nextOffset!==undefined&&pages[current]?.nextOffset!==null)query.set('offset',pages[current].nextOffset);
      const data=await api(endpoint+'?'+query);if(seq!==loadSequence||!authenticated)return;
      if(!Array.isArray(data.items))throw Error('Сервер вернул неполную коллекцию.');
      records[current]=append?[...records[current],...data.items]:data.items;pages[current]={total:data.total,nextOffset:data.nextOffset};renderCollection(current);message('Данные обновлены · '+datetime(new Date()));
    }
  }catch(error){if(seq===loadSequence&&authenticated){message(error.message||'Не удалось загрузить данные.',true);if(!['settings','overview','game','access','smartshell'].includes(current)&&!records[current].length)empty($(current+'-table'),'Не удалось загрузить','Нажми «Обновить данные», чтобы повторить.');}}
  finally{if(seq===loadSequence)$('refresh-button').disabled=false;}
}

function field(name,label,type='text',value='',options={}){
  const wrap=node('label',undefined,options.wide?'field-wide':'');wrap.append(node('span',label));let input;
  if(type==='select'){input=node('select');for(const [id,title] of options.choices||[]){const option=node('option',title);option.value=id;input.append(option);}}
  else if(type==='textarea'){input=node('textarea');input.rows=options.rows||3;}
  else{input=node('input');input.type=type;}
  input.name=name;input.value=value??'';if(options.required)input.required=true;if(options.maxLength)input.maxLength=options.maxLength;if(options.min!==undefined)input.min=options.min;if(options.max!==undefined)input.max=options.max;
  if(type==='checkbox'){input.checked=Boolean(value);wrap.classList.add('checkbox-label');wrap.prepend(input);}else wrap.append(input);
  return wrap;
}
function openRecord(kind,item=null){
  if(!can(kind==='bookings'?'bookings.read':'profiles.read'))return;
  editing={kind,item:item?{...item}:null};$('record-kind').textContent=kind==='bookings'?'Бронирование · время клуба UTC+5':'Карточка гостя';$('record-title').textContent=item?'Редактирование':kind==='bookings'?'Новая бронь':'Новый гость';
  const fields=$('record-fields');fields.replaceChildren();message('',false,'record-status');$('record-delete').hidden=!item;$('delete-confirm').hidden=true;
  if(kind==='bookings'){
    const date=clubParts(item?.startsAt||new Date());
    if(item?.source==='website')fields.append(node('p','Онлайн-заявка '+(item.reference||'')+'. Изменения появятся в кабинете гостя.','field-wide'));
    if(item?.proposal)fields.append(node('p','На согласовании у гостя: '+datetime(item.proposal.startsAt)+'. Подтверждение доступно после его ответа.','field-wide'));
    fields.append(field('guestName','Имя гостя','text',item?.guestName,{required:true,maxLength:120}),field('phone','Телефон — или email','tel',item?.phone,{maxLength:40}),field('email','Email — необязательно','email',item?.email,{maxLength:200}),field('guestId','ID карточки гостя — необязательно','text',item?.guestId,{maxLength:100}),field('date','Дата в Оренбурге','date',date.date,{required:true}),field('time','Время начала · UTC+5','time',date.time,{required:true}),field('duration','Продолжительность','select',item?.duration||60,{choices:[[30,'30 минут'],[60,'1 час'],[120,'2 часа']]}),field('tariff','Тариф','select',item?.tariff||'standard',{choices:Object.entries(tariffNames).filter(([key])=>key!=='mixed'||item?.tariff==='mixed')}),field('participants','Число гостей','number',item?.participants||1,{required:true,min:1,max:10}),field('status','Статус','select',item?.status||'draft',{choices:Object.entries(statusNames).filter(([key])=>(item?bookingTransitions[item.status]||[]:['draft']).includes(key))}),field('vrCount','Гостей с VR','number',item?.vrCount??(item?.vr?item.participants:0),{required:true,min:0,max:item?.participants||1}),field('notes','Заметка к брони','textarea',item?.notes,{wide:true,maxLength:2000}));
    const participantsField=fields.querySelector('[name="participants"]'),vrCountField=fields.querySelector('[name="vrCount"]');
    participantsField.addEventListener('input',()=>{vrCountField.max=participantsField.value;if(Number(vrCountField.value)>Number(participantsField.value))vrCountField.value=participantsField.value;});
    // Replace the optional ID field with a server-backed guest picker.
    const idInput=fields.querySelector('[name="guestId"]');
    if(can('profiles.read'))club.bookingPicker(fields,item);else idInput.closest('label').hidden=true;
    if(!item)fields.append(node('p','Сначала сохрани черновик. Затем открой запись и подтверди бронь после согласования с гостем.','section-note field-wide'));
  }else{
    fields.append(field('name','Имя','text',item?.name,{required:true,maxLength:120}),field('phone','Телефон','tel',item?.phone,{maxLength:40}),field('email','Email — необязательно','email',item?.email,{maxLength:200}),field('status','Статус карточки','select',item?.status||'active',{choices:[['active','Активен'],['inactive','Неактивен']]}),field('preferences','Предпочтения гостя','textarea',item?.preferences,{wide:true,maxLength:2000}),field('notes','Рабочая заметка','textarea',item?.notes,{wide:true,maxLength:2000}),field('skillNote','Наблюдение о навыках — необязательно','textarea',item?.skillNote,{wide:true,maxLength:2000}),field('skillVerified','Эту заметку о навыках лично проверил сотрудник','checkbox',item?.skillVerified,{wide:true}));
    fields.querySelector('[name="skillNote"]').addEventListener('input',()=>{fields.querySelector('[name="skillVerified"]').checked=false;});
    fields.append(node('p','Это ручная заметка сотрудника. Она не назначает уровень и не является автоматической оценкой водителя.','section-note field-wide'));
  }
  if(kind==='guests'&&item){const reward=node('section',undefined,'admin-reward field-wide');fields.prepend(reward);void loadGuestReward(item.id,reward,editing);}
  if(kind==='bookings'&&item?.source==='website'){const delivery=node('section',undefined,'admin-reward field-wide');fields.prepend(delivery);void loadBookingDelivery(item,delivery,editing);}
  const writable=can(kind==='bookings'?'bookings.write':'profiles.write');$('record-save').hidden=!writable;$('record-delete').hidden=!writable||!item;fields.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=!writable);if(item?.tariff==='mixed'){fields.querySelector('[name=tariff]').disabled=true;fields.querySelector('[name=participants]').disabled=true;}$('record-dialog').showModal();fields.querySelector('input,select,textarea')?.focus();
}

async function loadBookingDelivery(item,target,owner){
  target.replaceChildren(node('p','Проверяем доставку в бот…','section-note'));
  try{
    const data=await api('bookings/'+item.id+'/notification');
    if(editing!==owner||!$('record-dialog').open)return;
    target.replaceChildren(node('h3','Уведомления владельцам'));
    for(const recipient of data.recipients||[data]){
      const delivered=recipient.state==='sent'&&recipient.deliveredVersion===item.version&&recipient.recipientMatches;
      const text=recipient.testFixture?'Автоматический тест: уведомления отключены.':delivered?'Telegram принял карточку · '+datetime(recipient.deliveredAt):recipient.state==='missing'?'Заявка не попала в очередь уведомлений.':recipient.attempts>1?'Доставка повторяется. Попыток: '+recipient.attempts:'В очереди на отправку.';
      target.append(node('p','@'+(recipient.username||'owner')+' · '+text,'section-note'));
    }
    target.append(node('p','Доставка в чат не означает, что владелец прочитал сообщение.','section-note'));
    const refresh=node('button','Обновить доставку','secondary');refresh.type='button';refresh.addEventListener('click',()=>void loadBookingDelivery(item,target,owner));target.append(refresh);
    if(principal?.isOwner&&!data.testFixture){
      const retry=node('button','Отправить владельцам ещё раз','secondary');retry.type='button';target.append(retry);
      retry.addEventListener('click',async()=>{retry.disabled=true;try{await api('bookings/'+item.id+'/notification',{method:'POST',body:{version:item.version}});await loadBookingDelivery(item,target,owner);}catch(error){if(editing===owner){target.append(node('p',error.message,'section-note'));retry.disabled=false;}}});
    }
  }catch(error){if(editing===owner)target.replaceChildren(node('p','Не удалось проверить доставку: '+error.message,'section-note'));}
}

async function loadGuestReward(guestId,target,owner){
  target.replaceChildren(node('p','Проверяем награду лидера…','section-note'));
  try{
    const data=await api('game-reward?'+new URLSearchParams({guestId}));
    if(editing!==owner||!$('record-dialog').open)return;
    target.replaceChildren(node('h3','Бесплатный час лидера'));
    if(!data.linked){target.append(node('p','Эта карточка не связана с игровым профилем.','section-note'));return;}
    const r=data.reward;
    target.append(node('strong',data.username),node('p',r.available?'Доступно 60 минут. Лидерство проверится ещё раз при списании.':r.state==='used'?'Час этого периода уже использован. Следующее обновление: '+datetime(r.resetsAt):'Сейчас не на первом месте. Награда недоступна.','section-note'));
    const refresh=node('button','Обновить статус','secondary');refresh.type='button';refresh.addEventListener('click',()=>void loadGuestReward(guestId,target,owner));target.append(refresh);
    if(r.available&&can('rewards.redeem')){
      const redeem=node('button','Списать 60 минут','primary');redeem.type='button';target.append(redeem);
      redeem.addEventListener('click',()=>{
        redeem.disabled=true;const confirm=node('div',undefined,'reward-confirm');confirm.append(node('p','Пилот уже в клубе и получает этот бесплатный заезд?'));
        const yes=node('button','Да, списать час','primary'),no=node('button','Назад','secondary');yes.type=no.type='button';confirm.append(yes,no);target.append(confirm);
        no.addEventListener('click',()=>{confirm.remove();redeem.disabled=false;});
        yes.addEventListener('click',async()=>{yes.disabled=no.disabled=refresh.disabled=true;try{await api('game-reward',{method:'POST',body:{guestId,week:r.week,epoch:r.epoch}});await loadGuestReward(guestId,target,owner);}catch(error){if(editing===owner){confirm.replaceChildren(node('p',error.message,'form-message'));refresh.disabled=false;}}});
      });
    }
    if(data.history.length){const list=node('ul',undefined,'reward-history');for(const row of data.history)list.append(node('li',datetime(row.redeemedAt)+' · '+row.minutes+' минут'));target.append(node('h4','Списания'),list);}
  }catch(error){if(editing===owner)target.replaceChildren(node('p',error.message,'form-message'));}
}

function recordBody(){
  const values=new FormData($('record-form'));const value=name=>String(values.get(name)||'').trim();let body;
  if(editing.kind==='bookings')body={guestName:value('guestName'),phone:value('phone'),email:value('email'),guestId:value('guestId')||null,startsAt:value('date')+'T'+value('time')+':00+05:00',duration:Number(value('duration')),tariff:value('tariff'),participants:Number(value('participants')),status:value('status'),vrCount:Number(value('vrCount')),vr:Number(value('vrCount'))>0,notes:value('notes')};
  if(editing.kind==='bookings'&&editing.item?.tariff==='mixed')body.seatIds=editing.item.seatIds;
  else{body={name:value('name'),phone:value('phone'),email:value('email'),status:value('status'),preferences:value('preferences'),notes:value('notes'),skillNote:value('skillNote'),skillVerified:values.has('skillVerified')};if(body.skillVerified&&!body.skillNote)throw Error('Добавь наблюдение о навыках или сними отметку проверки.');}
  if(editing.kind==='guests'&&editing.item&&body.skillNote===editing.item.skillNote&&body.skillVerified===editing.item.skillVerified)delete body.skillVerified;
  if(editing.kind==='bookings'&&(!Number.isInteger(body.vrCount)||body.vrCount<0||body.vrCount>body.participants))throw Error('Число гостей с VR должно быть от 0 до общего числа гостей.');
  if(editing.kind==='bookings'&&body.status==='confirmed'&&(!body.guestName||(!body.phone&&!body.email)))throw Error('Для подтверждения укажи гостя и телефон или email.');
  if(editing.item)body.version=editing.item.version;return body;
}
function lockEditor(locked){$('record-save').disabled=locked;$('record-delete').disabled=locked;$('delete-yes').disabled=locked;$('record-close').disabled=locked;$('record-cancel').disabled=locked;}
async function saveRecord(event){
  event.preventDefault();if(!editing||!$('record-form').reportValidity())return;
  try{const body=recordBody();lockEditor(true);message('Сохраняем…',false,'record-status');const {kind,item}=editing;await api(kind+(item?'/'+encodeURIComponent(item.id):''),{method:item?'PATCH':'POST',body});$('record-dialog').close();await refresh();message('Запись сохранена.');}
  catch(error){if(authenticated)message(error.message,true,'record-status');}finally{lockEditor(false);}
}
async function deleteRecord(){if(!editing?.item)return;lockEditor(true);try{await api(editing.kind+'/'+encodeURIComponent(editing.item.id),{method:'DELETE',body:{version:editing.item.version}});$('record-dialog').close();await refresh();message('Запись удалена.');}catch(error){if(authenticated)message(error.message,true,'record-status');}finally{lockEditor(false);}}
async function exportCSV(resource,button){
  button.disabled=true;
  try{const query=resource==='guests'?new URLSearchParams():periodQuery();query.set('resource',resource==='events'?$('events-dataset').value:resource);const blob=await api('export?'+query,{blob:true});const url=URL.createObjectURL(blob);const link=node('a');link.href=url;link.download='autosim-'+query.get('resource')+'-'+clubParts().date+'.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);message('CSV подготовлен сервером.');}
  catch(error){if(authenticated)message(error.message,true);}finally{button.disabled=false;}
}

$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!$('login-form').reportValidity())return;$('login-submit').disabled=true;message('Входим…',false,'login-status');
  try{const values=new FormData($('login-form'));const session=await api('login',{method:'POST',body:{username:String(values.get('username')||'').trim(),password:String(values.get('password')||'')}});signIn(session);}
  catch(error){$('login-form').elements.password.value='';message(error.message||'Не удалось войти.',true,'login-status');}
  finally{$('login-submit').disabled=false;}
});
$('logout-button').addEventListener('click',async()=>{try{await api('logout',{method:'POST',body:{}});showLogin('Вы вышли из системы.');}catch(error){message('Не удалось завершить серверную сессию: '+error.message,true);}});
$$('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
$('refresh-button').addEventListener('click',()=>void refresh());
$('period-preset').addEventListener('change',()=>{presetDates();if($('period-preset').value!=='custom')void refresh();});
for(const id of ['period-from','period-to'])$(id).addEventListener('change',()=>{$('period-preset').value='custom';});
$('period-apply').addEventListener('click',()=>void refresh());
$('booking-status-filter').addEventListener('change',renderBookings);let searchTimer;$('guest-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>void refresh(),250);});$('events-dataset').addEventListener('change',()=>void refresh());
$$('[data-more]').forEach(button=>button.addEventListener('click',()=>void refresh(true)));$$('[data-export]').forEach(button=>button.addEventListener('click',()=>void exportCSV(button.dataset.export,button)));
$('new-booking').addEventListener('click',()=>openRecord('bookings'));$('new-guest').addEventListener('click',()=>openRecord('guests'));$('record-form').addEventListener('submit',saveRecord);
for(const id of ['record-close','record-cancel'])$(id).addEventListener('click',()=>$('record-dialog').close());
$('record-delete').addEventListener('click',()=>{$('delete-confirm').hidden=false;$('delete-no').focus();});$('delete-no').addEventListener('click',()=>{$('delete-confirm').hidden=true;$('record-delete').focus();});$('delete-yes').addEventListener('click',()=>void deleteRecord());
$('record-dialog').addEventListener('cancel',event=>{if($('record-save').disabled)event.preventDefault();});
$('settings-form').addEventListener('submit',async event=>{event.preventDefault();const form=$('settings-form');if(!form.reportValidity())return;const button=event.submitter||form.querySelector('[type="submit"]');button.disabled=true;try{const settings=await api('settings',{method:'PATCH',body:{analyticsEnabled:form.elements.analyticsEnabled.checked,collectFullIp:form.elements.collectFullIp.checked,operationalNotes:form.elements.operationalNotes.value.trim(),version:settingsVersion}});settingsVersion=settings.version;form.elements.analyticsEnabled.checked=settings.analyticsEnabled===true;form.elements.collectFullIp.checked=settings.collectFullIp===true;form.elements.operationalNotes.value=settings.operationalNotes||'';message('Настройки сохранены.');}catch(error){if(authenticated)message(error.message,true);}finally{button.disabled=false;}});
integrations=initIntegrations({api,node,field,table,datetime,can,isOwner});
club=initClubAdmin({api,node,table,datetime,message,openRecord,field,can,profileLink:integrations.profileLink});
presetDates();
try{const session=await api('session');if(session.authenticated)signIn(session);else showLogin();}catch(error){showLogin('Сервис входа пока недоступен. Попробуй войти ещё раз.');message(error.message,true,'login-status');}

async function openLinkedBooking(){if(!authenticated)return;const match=/^#booking=([a-f0-9-]{36})$/.exec(location.hash);if(!match)return;try{const item=await api('bookings/'+match[1]);if(authenticated)openRecord('bookings',item);}catch(error){message(error.message,true);}}
window.addEventListener('hashchange',()=>void openLinkedBooking());
