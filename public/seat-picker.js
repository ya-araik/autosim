import {TARIFFS} from './club-data.js?v=20261107';
import {createBookingCalendar} from './booking-calendar.js?v=23';
// One public schedule for the home page and member booking form.
const names={standard:'Standard',pro:'Pro',vip:'VIP'};
const prices=Object.fromEntries(Object.entries(TARIFFS).map(([key,tariff])=>[key,tariff.prices]));
const positions={V01:[1,1],S01:[1,2],S02:[1,3],S03:[1,4],S04:[2,1],S05:[2,2],S06:[2,3],S07:[2,4],P01:[3,2],P02:[3,3]};
const cockpit='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 5h20M8 8h16M11 16v-5h10v5M10 19l-2 9h16l-2-9Z"/><ellipse cx="16" cy="16" rx="7" ry="3"/></svg>';
const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const today=()=>new Date(Date.now()+5*3600000).toISOString().slice(0,10);

export class SeatPicker {
  constructor(root,{date=today(),duration=60,time='',selected=[],onChange=()=>{},onInspect=()=>{}}={}){
    this.root=root;this.day=date||today();this.duration=duration===120?120:60;this.time=time;this.selected=[...selected];this.onChange=onChange;this.onInspect=onInspect;this.sequence=0;this.data=null;this.visible=false;
    root.classList.add('seat-picker');
    root.innerHTML='<div class="seat-picker-top"><span class="eyebrow">01 / ДАТА И СЕАНС</span><span>Оренбург · UTC+5</span></div><div class="seat-date-controls"><label>Дата<input type="date" class="seat-date" required></label><div class="seat-length" role="group" aria-label="Длительность"><button type="button" data-minutes="60">1 час</button><button type="button" data-minutes="120">2 часа</button></div></div><div class="seat-sessions" role="group" aria-label="Начало заезда"></div><div class="seat-picker-top"><span class="eyebrow">02 / ВЫБЕРИ СИМУЛЯТОРЫ</span></div><div class="hall-map" role="group" aria-label="Схема зала: 7 Standard, 2 Pro и 1 VIP"></div><div class="seat-selection" aria-live="polite"></div><p class="seat-feedback" role="status" aria-live="polite"></p>';
    const calendar=make('div',undefined,'seat-picker-calendar'),hall=make('div',undefined,'seat-picker-hall');
    const nodes=[...root.children];calendar.append(...nodes.slice(0,3));hall.append(...nodes.slice(3,5));hall.append(make('p','*Можно несколько','seat-map-caption'));root.prepend(calendar,hall);
    this.date=root.querySelector('.seat-date');this.date.value=this.day;this.date.min=today();this.date.max=new Date(Date.now()+90*86400000+5*3600000).toISOString().slice(0,10);
    this.calendar=createBookingCalendar(this.date);
    this.date.addEventListener('change',()=>{this.day=this.date.value;this.time='';this.selected=[];void this.load();});
    root.querySelectorAll('[data-minutes]').forEach(b=>b.addEventListener('click',()=>{this.duration=Number(b.dataset.minutes);this.selected=[];void this.load();}));
    this.observer=new IntersectionObserver(entries=>{this.visible=entries[0].isIntersecting;if(this.visible&&!this.data)void this.load();},{rootMargin:'120px'});this.observer.observe(root);
    this.timer=setInterval(()=>{if(this.visible&&!document.hidden)void this.load(true);},25000);
    this.focus=()=>{if(this.visible&&!document.hidden)void this.load(true);};window.addEventListener('focus',this.focus);document.addEventListener('visibilitychange',this.focus);
    this.render();
  }
  value(){const seats=this.data?.seats.filter(s=>this.selected.includes(s.id))||[];return{date:this.day,time:this.time,duration:this.duration,seatIds:seats.map(s=>s.id),tariff:new Set(seats.map(s=>s.tariff)).size>1?'mixed':seats[0]?.tariff||'standard',items:seats,people:seats.length,total:seats.reduce((sum,s)=>sum+prices[s.tariff][this.duration],0),ready:!!(this.data&&this.time&&seats.length&&!this.loading)};}
  async load(quiet=false){
    if(!this.day){this.data=null;this.render();return;}
    const before=JSON.stringify([this.data?.sessions,this.selected]);
    const seq=++this.sequence;this.controller?.abort();this.controller=new AbortController();this.loading=!quiet||!this.data;
    const controller=this.controller,timeout=setTimeout(()=>controller.abort(),18000);if(!quiet)this.render();if(!quiet)this.message('Проверяем свободные места…');
    try{
      const response=await fetch('/api/member/availability?'+new URLSearchParams({date:this.day,duration:this.duration}),{cache:'no-store',signal:this.controller.signal});
      const data=await response.json();if(!response.ok)throw Error(data?.error?.message||'Расписание недоступно. Попробуй обновить.');if(seq!==this.sequence)return;
      this.data=data;const session=data.sessions.find(s=>s.time===this.time);
      if(!session)this.time=data.sessions.find(s=>s.seats.some(s=>s.available))?.time||'';
      const current=data.sessions.find(s=>s.time===this.time);const old=this.selected.length;
      this.selected=this.selected.filter(id=>current?.seats.some(s=>s.id===id&&s.available));
      this.message(old!==this.selected.length?'Занятость изменилась. Выбери свободное место.':'');
    }catch(error){if(seq!==this.sequence)return;this.data=null;this.selected=[];this.message(error.name==='AbortError'?'Не удалось обновить места. Повтори попытку.':error.message,true);}
    finally{clearTimeout(timeout);if(seq===this.sequence){this.loading=false;if(!quiet||before!==JSON.stringify([this.data?.sessions,this.selected]))this.render();}}
  }
  message(text,error=false){const n=this.root.querySelector('.seat-feedback');n.textContent=text;n.classList.toggle('is-error',error);}
  render(){
    this.root.setAttribute('aria-busy',String(!!this.loading));this.root.querySelectorAll('[data-minutes]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.minutes)===this.duration)));
    const sessions=this.root.querySelector('.seat-sessions');sessions.replaceChildren();
    for(const row of this.data?.sessions||[]){const free=row.seats.filter(s=>s.available).length,b=make('button',undefined,'seat-session');b.type='button';b.disabled=!free||!!this.loading;b.setAttribute('aria-pressed',String(row.time===this.time));b.append(make('strong',row.time),make('small',free?free+' '+(free===1?'место':free<5?'места':'мест'):'Нет мест'));b.addEventListener('click',()=>{this.time=row.time;this.selected=[];this.render();});sessions.append(b);}
    const current=this.data?.sessions.find(s=>s.time===this.time),map=this.root.querySelector('.hall-map');map.querySelectorAll('.hall-seat').forEach(n=>n.remove());
    // The schematic always retains its shape, including during a network error.
    const all=this.data?.seats||Object.keys(positions).map(id=>({id,label:(id[0]==='V'?'VIP':id[0]==='P'?'Pro':'Standard')+' '+Number(id.slice(1)),tariff:id[0]==='V'?'vip':id[0]==='P'?'pro':'standard'}));
    for(const seat of all){
      const [column,row]=positions[seat.id]||[1,1],available=current?.seats.find(s=>s.id===seat.id)?.available,selected=this.selected.includes(seat.id);
      const b=make('button',undefined,'hall-seat '+seat.tariff);b.type='button';b.style.gridColumn=column;b.style.gridRow=row;b.disabled=!available||!!this.loading;
      b.setAttribute('aria-pressed',String(selected));b.setAttribute('aria-label',seat.label+(available?' · '+prices[seat.tariff][this.duration]+' рублей':' · занято'));
      b.innerHTML=cockpit;b.append(make('span',names[seat.tariff],'seat-class'),make('strong',String(Number(seat.id.slice(1))).padStart(2,'0'),'seat-number'),make('small',available?prices[seat.tariff][this.duration]+' ₽':this.loading?'…':'Занято','seat-cost'));
      const check=make('span',undefined,'seat-check');check.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';b.append(check);
      b.addEventListener('click',()=>{this.message('');this.selected=selected?this.selected.filter(id=>id!==seat.id):[...this.selected,seat.id];this.render();if(!selected)this.onInspect(seat.tariff);});map.append(b);
    }
    const value=this.value(),summary=this.root.querySelector('.seat-selection');summary.replaceChildren();
    if(value.people){summary.append(make('strong',value.items.map(s=>s.label).join(' · ')),make('span',this.time+' · '+(this.duration===60?'1 час':'2 часа')),make('b',new Intl.NumberFormat('ru-RU').format(value.total)+' ₽'));}
    else if(this.data&&!this.time&&!this.loading)summary.append(make('span','На эту дату нет свободных сеансов'));
    summary.hidden=!summary.hasChildNodes();
    this.onChange(value);
  }
  set(value){this.day=value.date||today();this.date.value=this.day;this.calendar.update();this.duration=value.duration===120?120:60;this.time=value.time||'';this.selected=value.seatIds||[];void this.load();}
}

