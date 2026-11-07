const format=date=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
const key=date=>date.toISOString().slice(0,10);
const parse=date=>new Date(date+'T12:00:00Z');
const shift=(date,days)=>{const value=parse(date);value.setUTCDate(value.getUTCDate()+days);return key(value);};
const svg=direction=>'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+(direction==='calendar'?'M7 3v4m10-4v4M4 10h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z':direction==='left'?'m14 6-6 6 6 6':'m10 6 6 6-6 6')+'"/></svg>';
let sequence=0;
export function createBookingCalendar(input){
  input.hidden=true;input.tabIndex=-1;
  const wrap=document.createElement('div');wrap.className='booking-calendar';input.after(wrap);
  const trigger=document.createElement('button');trigger.type='button';trigger.className='calendar-trigger';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
  const popup=document.createElement('div');popup.id='booking-calendar-'+(++sequence);popup.className='calendar-popup';popup.hidden=true;popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Выбрать дату заезда');popup.setAttribute('popover','manual');trigger.setAttribute('aria-controls',popup.id);
  wrap.append(trigger,popup);let opened=false,month='',focusDate=input.value;
  const allowed=value=>(!input.min||value>=input.min)&&(!input.max||value<=input.max);
  const clamp=value=>value<input.min?input.min:value>input.max?input.max:value;
  const update=()=>{trigger.innerHTML='<span>'+format(input.value)+'</span>'+svg('calendar');trigger.setAttribute('aria-label','Дата заезда: '+format(input.value));};
  const position=()=>{if(!opened)return;const r=trigger.getBoundingClientRect(),viewport=document.documentElement.clientWidth||window.innerWidth,width=Math.min(330,viewport-24);popup.style.width=width+'px';const height=popup.offsetHeight;popup.style.left=Math.max(12,Math.min(r.left,viewport-width-12))+'px';popup.style.top=Math.max(12,r.bottom+10+height>window.innerHeight&&r.top>height+10?r.top-height-10:Math.min(r.bottom+10,window.innerHeight-height-12))+'px';};
  function close(focus=true){if(!opened)return;opened=false;if(popup.hidePopover&&popup.matches(':popover-open'))popup.hidePopover();popup.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus({preventScroll:true});}
  function choose(value){if(!allowed(value))return;input.value=value;update();close();input.dispatchEvent(new Event('change',{bubbles:true}));}
  function render(){
    const first=parse(month+'-01'),year=first.getUTCFullYear(),m=first.getUTCMonth(),last=key(new Date(Date.UTC(year,m+1,0,12)));
    const previous=key(new Date(Date.UTC(year,m,0,12))),next=key(new Date(Date.UTC(year,m+1,1,12)));
    const title=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(first).replace(' г.','');
    popup.innerHTML='<div class="calendar-head"><button type="button" data-month="-1" aria-label="Предыдущий месяц" '+(previous<input.min?'disabled':'')+'>'+svg('left')+'</button><strong>'+title+'</strong><button type="button" data-month="1" aria-label="Следующий месяц" '+(next>input.max?'disabled':'')+'>'+svg('right')+'</button></div><div class="calendar-week" aria-hidden="true"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div><div class="calendar-grid" role="grid" aria-label="'+title+'"></div><div class="calendar-quick"><button type="button" data-quick="0">Сегодня</button><button type="button" data-quick="1">Завтра</button></div>';
    const grid=popup.querySelector('.calendar-grid'),offset=(first.getUTCDay()+6)%7,start=shift(month+'-01',-offset),rows=Math.ceil((offset+Number(last.slice(-2)))/7);
    for(let row=0;row<rows;row++){
      const line=document.createElement('div');line.setAttribute('role','row');
      for(let col=0;col<7;col++){
        const value=shift(start,row*7+col),cell=document.createElement('div');cell.setAttribute('role','gridcell');cell.setAttribute('aria-selected',String(value===input.value));
        const b=document.createElement('button');b.type='button';b.textContent=Number(value.slice(-2));b.dataset.date=value;b.disabled=!allowed(value);b.tabIndex=value===focusDate?0:-1;b.setAttribute('aria-label',format(value));
        if(value.slice(0,7)!==month)b.classList.add('is-adjacent');if(value===input.value)b.classList.add('is-selected');if(value===input.min)b.setAttribute('aria-current','date');
        b.addEventListener('click',()=>choose(value));cell.append(b);line.append(cell);
      }grid.append(line);
    }
    popup.querySelectorAll('[data-month]').forEach(b=>b.addEventListener('click',()=>{const d=parse(month+'-01');d.setUTCMonth(d.getUTCMonth()+Number(b.dataset.month));month=key(d).slice(0,7);focusDate=clamp(month+'-01');render();position();popup.querySelector('[data-month="'+b.dataset.month+'"]')?.focus({preventScroll:true});}));
    popup.querySelectorAll('[data-quick]').forEach(b=>{const d=shift(input.min,Number(b.dataset.quick));b.disabled=!allowed(d);b.addEventListener('click',()=>choose(d));});
  }
  function open(){if(opened)return;opened=true;month=input.value.slice(0,7);focusDate=input.value;render();popup.hidden=false;if(popup.showPopover)popup.showPopover();trigger.setAttribute('aria-expanded','true');position();popup.querySelector('[data-date="'+focusDate+'"]')?.focus({preventScroll:true});}
  trigger.addEventListener('click',()=>opened?close():open());
  trigger.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();open();}});
  popup.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();close();return;}
    const current=e.target.dataset.date;if(!current)return;
    let target;const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
    if(e.key in delta)target=shift(current,delta[e.key]);
    if(e.key==='Home')target=shift(current,-((parse(current).getUTCDay()+6)%7));
    if(e.key==='End')target=shift(current,6-((parse(current).getUTCDay()+6)%7));
    if(e.key==='PageUp'||e.key==='PageDown'){const d=parse(current);d.setUTCMonth(d.getUTCMonth()+(e.key==='PageUp'?-1:1));target=key(d);}
    if(target){e.preventDefault();focusDate=clamp(target);month=focusDate.slice(0,7);render();position();popup.querySelector('[data-date="'+focusDate+'"]')?.focus({preventScroll:true});}
  });
  document.addEventListener('pointerdown',e=>{if(opened&&!wrap.contains(e.target))close(false);});
  document.addEventListener('focusin',e=>{if(opened&&!wrap.contains(e.target))close(false);});
  window.addEventListener('resize',position);window.addEventListener('scroll',position,{passive:true,capture:true});
  input.addEventListener('change',update);update();return {update,close};
}
