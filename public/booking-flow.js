import {SeatPicker} from './seat-picker.js?v=30';
import {VR_PRICES,money} from './club-data.js?v=23';

const root=document.querySelector('[data-public-seat-picker]');
if(root){
  const action=document.querySelector('[data-seat-book]'),vr=document.getElementById('public-vr'),summary=document.getElementById('public-booking-summary');
  let selection={people:0,items:[],total:0,duration:60,ready:false};
  function update(value=selection){
    selection=value;
    const old=Number(vr.value)||0;
    if(vr.options.length!==value.people+1){
      vr.replaceChildren(...Array.from({length:value.people+1},(_,n)=>{
        const option=document.createElement('option');option.value=String(n);
        option.textContent=n?n+' '+(n===1?'гость':n<5?'гостя':'гостей')+' · +'+money(n*VR_PRICES[value.duration]):'Без VR';return option;
      }));
    }else for(const option of vr.options){const n=Number(option.value);option.textContent=n?n+' '+(n===1?'гость':n<5?'гостя':'гостей')+' · +'+money(n*VR_PRICES[value.duration]):'Без VR';}
    vr.value=String(Math.min(old,value.people));vr.disabled=!value.people;
    const total=value.total+Number(vr.value)*VR_PRICES[value.duration];
    action.setAttribute('aria-disabled',String(!value.ready));
    action.href=value.ready?'/cabinet#book?'+new URLSearchParams({v:2,m:value.duration,vr:vr.value,d:value.date,at:value.time,seats:value.seatIds.join(',')}):'#sessions';
    const date=value.date?new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(value.date+'T12:00:00Z')):'';
    action.dataset.bookingSummary=value.ready?[date+' · '+value.time,value.items.map(s=>s.label).join(', '),value.duration/60+' ч'+(Number(vr.value)?' · VR: '+vr.value:''),money(total)].join(' · '):'';
    summary.textContent=value.people?value.people+' '+(value.people===1?'место':value.people<5?'места':'мест')+' · '+value.duration/60+' ч · '+money(total):'';
    summary.hidden=!value.people;
  }
  new SeatPicker(root,{onChange:update,onInspect:tariff=>document.querySelector('[data-tariff="'+tariff+'"]')?.click()});
  vr.addEventListener('change',()=>update());
}
