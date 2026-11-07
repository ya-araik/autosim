// Verified against https://auto-sim.ru/prices on 2026-09-19.
// Generation, display make, pedal model and VR headset model are not confirmed.
export const PHONE = '+79510308856';
// Confirmed directly by the club owner during the v7 revision.
export const VR_MODEL = 'Meta Quest 2';
export const TARIFFS = Object.freeze({
  standard: {name:'Standard',base:'MOZA R5',screen:'55″ · 4K-телевизор',diagonal:55,ratio:16/9,tag:'Для первого знакомства',description:'Прямой привод и большой экран — для твоего первого старта.',photo:'/assets/IND04212.webp',photoAlt:'Реальные симуляторы и большие экраны в клубе АВТОСИМ',caption:'Симуляторы клуба · общий вид',extra:'Руль и педали · настройка посадки',prices:{30:350,60:650,90:900,120:1150,180:1550},pass5:2500,pass10:4400},
  pro: {name:'Pro',base:'MOZA R12',screen:'49″ · ultrawide',diagonal:49,ratio:32/9,tag:'Больше дороги перед тобой',description:'Больше обзора. Больше усилия. Точнее каждый поворот.',photo:'/assets/v7/club-pro-drive.webp',photoAlt:'Гость клуба за рулём перед изогнутым ультрашироким экраном с гонкой',caption:'Ультраширокий экран · реальный заезд в клубе',extra:'Руль и педали · настройка посадки',prices:{30:500,60:800,90:1200,120:1500,180:2100},pass5:3300,pass10:5800},
  vip: {name:'VIP',base:'MOZA R9',screen:'65″ · телевизор',diagonal:65,ratio:16/9,tag:'Большой экран. Свой ритм.',description:'Экран 65″ и шифтер Simagic — всё в твоих руках.',photo:'/assets/v7/club-rig.webp',photoAlt:'Настоящий симулятор АВТОСИМ: кресло, руль MOZA, рычаг и включённый большой экран',caption:'Симулятор клуба · фотография установки',extra:'Шифтер Simagic · руль и педали',prices:{30:500,60:800,90:1200,120:1500,180:2100},pass5:3300,pass10:5800}
});
export const DURATIONS = [30,60,120];
export const VR_PRICES = Object.freeze({30:300,60:400,120:800});
export const DRAFT_VERSION = 1;
export const STORAGE_KEY = 'autosim.guest-plan.v7';
export const GOALS = Object.freeze({first:'Первое знакомство',precision:'Точность на трассе',drift:'Дрифт',friends:'Гонка с друзьями'});
export const durationLabel = n => n===30?'30 минут':n===60?'1 час':n===90?'1,5 часа':n===120?'2 часа':'3 часа';
export const money = n => new Intl.NumberFormat('ru-RU').format(n)+' ₽';
export const defaultDraft = () => ({version:1,status:'draft',tariff:'standard',duration:60,people:1,vrCount:0,date:'',time:'',alias:'',goal:'first'});
const DRAFT_KEYS = Object.keys(defaultDraft());
export function isDate(s) { return typeof s==='string' && /^20\d{2}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s; }
export function localDate(now=new Date()) { return new Date(new Date(now).getTime()+5*3600000).toISOString().slice(0,10); }
export function validDraft(s) {
  return !!s && Object.getPrototypeOf(s)===Object.prototype && Object.keys(s).length===DRAFT_KEYS.length && DRAFT_KEYS.every(k=>Object.hasOwn(s,k))
    && s.version===1 && s.status==='draft' && Object.hasOwn(TARIFFS,s.tariff) && DURATIONS.includes(s.duration)
    && Number.isInteger(s.people) && s.people>=1 && s.people<=7 && Number.isInteger(s.vrCount) && s.vrCount>=0 && s.vrCount<=s.people
    && typeof s.alias==='string' && s.alias.length<=24 && !/[<>\u0000-\u001f]/u.test(s.alias)
    && Object.hasOwn(GOALS,s.goal)
    && (s.date==='' || isDate(s.date)) && (s.time==='' || /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time));
}
export function parseSavedDraft(text) {
  if(typeof text!=='string'||text.length>2048)return null;
  try {const s=JSON.parse(text);return validDraft(s)?Object.fromEntries(DRAFT_KEYS.map(k=>[k,s[k]])):null;}catch{return null;}
}
export function quoteDraft(s) {
  if(!validDraft(s)) throw new RangeError('Invalid draft');
  const base=TARIFFS[s.tariff].prices[s.duration],vrEach=VR_PRICES[s.duration];
  return {base,vrEach,baseTotal:base*s.people,vrTotal:vrEach*s.vrCount,total:base*s.people+vrEach*s.vrCount};
}
export function visitTimes(s) {
  if(!validDraft(s)||!s.date||!s.time) return null;
  const start=new Date(s.date+'T'+s.time+':00+05:00');
  return {start,end:new Date(start.getTime()+s.duration*60000)};
}
export function dateError(s,now=new Date()) {
  if(!validDraft(s)) return 'Проверь параметры плана.';
  if(!s.date&&!s.time) return '';
  if(!s.date||!s.time) return 'Укажи дату и желаемое время вместе.';
  const [h,m]=s.time.split(':').map(Number),minutes=h*60+m,dayMinutes=minutes<120?minutes+1440:minutes;
  if(m%15!==0) return 'Выбери время с шагом 15 минут.';
  if(dayMinutes<840||dayMinutes+s.duration>1560) return 'Клуб работает с 14:00 до 02:00. Выбери время, чтобы успеть закончить заезд.';
  if(visitTimes(s).start<=new Date(now)) return 'Это время уже прошло. Выбери другое или убери дату.';
  if(s.date>localDate(new Date(new Date(now).getTime()+366*86400000))) return 'Выбери дату в течение ближайшего года.';
  return '';
}
export function timeChoices(s,now=new Date()) {
  if(!s.date) return [];
  const values=[];
  for(let m=0;m<1440;m+=15){const time=String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');if(!dateError({...s,time},now)) values.push(time);}
  return values;
}
export function cleanAlias(s) { return String(s).replace(/[<>\u0000-\u001f]/gu,'').trim().slice(0,24); }
export function shareDraft(s) {
  if(!validDraft(s)) throw new RangeError('Invalid draft');
  // Guest nickname is intentionally excluded from a shareable link.
  return '#plan?'+new URLSearchParams({v:1,t:s.tariff,m:s.duration,p:s.people,vr:s.vrCount,d:s.date,at:s.time,g:s.goal});
}
export function parseDraftHash(hash) {
  if(typeof hash!=='string'||!hash.startsWith('#plan?')||hash.length>400) return null;
  const p=new URLSearchParams(hash.slice(6)),keys=['v','t','m','p','vr','d','at','g'];
  if(p.size!==keys.length||keys.some(k=>p.getAll(k).length!==1)||p.get('v')!=='1'||!/^([1-7])$/.test(p.get('p'))||!/^([0-7])$/.test(p.get('vr'))||! /^(30|60|120)$/.test(p.get('m'))) return null;
  const s={...defaultDraft(),tariff:p.get('t'),duration:Number(p.get('m')),people:Number(p.get('p')),vrCount:Number(p.get('vr')),date:p.get('d'),time:p.get('at'),goal:p.get('g')};
  return validDraft(s)?s:null;
}
export function draftText(s) {
  const q=quoteDraft(s),when=s.date&&s.time?new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(s.date+'T12:00:00Z'))+' в '+s.time+' (Оренбург, UTC+5)':'Дату согласуем по телефону';
  return ['АВТОСИМ · план визита, не бронь',...(s.alias?['Гость: '+s.alias]:[]),when,TARIFFS[s.tariff].name+' · '+TARIFFS[s.tariff].base+' · '+TARIFFS[s.tariff].screen,durationLabel(s.duration)+' · гостей: '+s.people+' · VR: '+s.vrCount,'Пожелание: '+GOALS[s.goal],'Симуляторы: '+s.people+' × '+money(q.base)+(s.vrCount?' + VR: '+s.vrCount+' × '+money(q.vrEach):''),'Итого: '+money(q.total)+(s.vrCount&&s.duration===120?' (VR: 2 × 400 ₽/ч, согласовать)':''),'Места и время подтверждает администратор.','Оренбург, Рыбаковская, 59','+7 (951) 030-88-56'].join('\n');
}
export function buildDraftICS(s,now=new Date()) {
  const error=dateError(s,now),times=visitTimes(s);if(error||!times)throw new RangeError(error||'Выбери дату и время.');
  const stamp=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const escape=t=>t.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AUTOSIM//Guest Plan//RU','CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:autosim-draft-'+stamp(times.start)+'-'+s.tariff+'-'+s.duration+'@autosim.local','DTSTAMP:'+stamp(new Date(now)),'DTSTART:'+stamp(times.start),'DTEND:'+stamp(times.end),'SUMMARY:АВТОСИМ — план визита (не бронь)','LOCATION:Оренбург\\, Рыбаковская\\, 59','DESCRIPTION:'+escape(draftText(s)),'STATUS:TENTATIVE','TRANSP:TRANSPARENT','END:VEVENT','END:VCALENDAR'];
  const enc=new TextEncoder();return lines.map(line=>{let out='',n=0;for(const char of line){const size=enc.encode(char).length;if(n+size>75){out+='\r\n ';n=1;}out+=char;n+=size;}return out;}).join('\r\n')+'\r\n';
}
