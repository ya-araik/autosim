// The server is the sole source of eligibility and the club-week boundary.
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const date=value=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Yekaterinburg',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
export function renderReward(target,reward){
  const state=reward?.state||'unknown', box=node('article',undefined,'leader-reward');box.dataset.state=state;
  box.append(node('p','ПРИВИЛЕГИЯ ЛИДЕРА','eyebrow'));
  const title=state==='available'?'Первое место — твоё.':state==='used'?'Твой час уже использован.':state==='not_leader'?'Стань первым. Приезжай за счёт клуба.':'Заезды за счёт клуба.';
  box.append(node('h2',title));
  if(state==='available'){
    box.append(node('strong','60 минут / 0 ₽','reward-balance'),node('p','Согласуй визит. Покажи профиль в клубе.'));
    const call=node('a','Согласовать бесплатный заезд','primary');call.href='tel:+79510308856';box.append(call);
  }else if(state==='used')box.append(node('p',`Новый час — ${date(reward.resetsAt)} по Оренбургу, пока ты лидер. Или сразу после возвращения на первое место.`));
  else box.append(node('p',state==='unknown'?'Статус награды временно недоступен.':'Побей рекорд — забери бесплатный час.'));
  const play=node('a',state==='available'?'Защитить первое место':state==='used'?'Улучшить свой рекорд':'Побороться за бесплатные заезды','reward-play');play.href='/?challenge=leader#test-drive';box.append(play);
  const details=node('details',undefined,'reward-terms'),summary=node('summary','Как действует награда');
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
  icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M5 12h14M12 5v14');
  icon.append(path);summary.append(icon);details.append(summary);
  const list=node('ul');
  for(const text of [
    '60 минут одному пилоту. Место и время — по согласованию.',
    'Обогнали — час недоступен. Вернул лидерство — получаешь новый, даже в ту же неделю.',
    'Удерживаешь первое место — новый час каждый понедельник, 00:00 Оренбурга. Улучшение своего рекорда час не обновляет.',
    'Лидерство проверяется при списании в клубе. Часы не копятся, не передаются и не обмениваются на деньги.',
    'Только сохранённые чистые заезды текущего сезона. Обходы правил исключаются; при равенстве времени выше более ранний результат.'
  ])list.append(node('li',text));
  const terms=node('a','Полные условия');terms.href='/leader-rules.html?v=23';details.append(list,terms);box.append(details);target.append(box);
}
