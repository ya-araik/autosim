import {RACE_SEASON} from './race-config.js';
// Small account/ranking client. No WebGL imports and no invented leaderboard data.
const PENDING = 'autosim.game.pending.v1';
const FINISH_PENDING = 'autosim.game.finish.v1';
export const gameTime = ms => {
  const n = Math.max(0, Math.floor(ms));
  return `${String(Math.floor(n / 60000)).padStart(2,'0')}:${String(Math.floor(n / 1000)%60).padStart(2,'0')}.${String(n%1000).padStart(3,'0')}`;
};
export function pendingResult() {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING));
    if (value && /^[\w-]{43}$/.test(value.token) && Number.isFinite(value.timeMs) && Date.parse(value.expiresAt)>Date.now() && value.season===RACE_SEASON) return value;
    localStorage.removeItem(PENDING);
  } catch { /* Storage is optional. */ }
  return null;
}
export function clearPending(token) { try { if(!token||pendingResult()?.token===token)localStorage.removeItem(PENDING); } catch {} }
export function pendingFinish(){
  try{const r=JSON.parse(localStorage.getItem(FINISH_PENDING));if(r?.season===RACE_SEASON&&/^[\w-]{43}$/.test(r.token)&&Date.parse(r.expiresAt)>Date.now()&&Array.isArray(r.samples)&&r.samples.length<=602&&Number.isFinite(r.timeMs))return r;localStorage.removeItem(FINISH_PENDING);}catch{}
  return null;
}
export function pendingAttempt(){return pendingFinish()||pendingResult();}
export async function verifyPendingFinish(attempt){
  const data=await gameApi('finish',{body:{token:attempt.token,timeMs:attempt.timeMs,samples:attempt.samples}});
  const verified={...data,token:attempt.token};
  try{
    // A late reply from an older attempt must not overwrite a newer finish.
    if(pendingFinish()?.token===attempt.token){localStorage.setItem(PENDING,JSON.stringify(verified));localStorage.removeItem(FINISH_PENDING);}
  }catch{}
  return verified;
}
const savingResults = new Map();
export function savePendingResult(session, receipt = pendingAttempt()) {
  if(!session?.authenticated||!session.csrf||!receipt?.token)return Promise.reject(Error('Нет подтверждённого результата для сохранения.'));
  const key=receipt.token+':'+session.csrf;
  if(!savingResults.has(key)) {
    const task=(receipt.samples?verifyPendingFinish(receipt):Promise.resolve(receipt))
      .then(verified=>gameApi('save',{csrf:session.csrf,body:{token:verified.token,publish:verified.board==='pro'}}))
      .then(result=>{if(result.saved!==true)throw Error('Сервер не подтвердил сохранение. Попробуй ещё раз.');clearPending(receipt.token);return result;})
      .finally(()=>savingResults.delete(key));
    savingResults.set(key,task);
  }
  return savingResults.get(key);
}
export async function gameApi(path, {body, csrf, member = false} = {}) {
  const abort = new AbortController(), timer = setTimeout(()=>abort.abort(),['start','finish','save','session'].includes(path)?25000:12000);
  try {
    const response = await fetch('/api/'+(member?'member/':'game/')+path, {
      method:body===undefined?'GET':'POST', credentials:'same-origin', cache:'no-store', signal:abort.signal,
      headers:{Accept:'application/json', ...(body===undefined?{}:{'Content-Type':'application/json'}), ...(csrf?{'X-CSRF-Token':csrf}:{})},
      body:body===undefined?undefined:JSON.stringify(body)
    });
    let data;try{data=await response.json();}catch{}
    if(!response.ok){const error=Error(data?.error?.message||'Рейтинг временно недоступен. Попробуй ещё раз.');error.status=response.status;throw error;}
    if(!data||typeof data!=='object')throw Error('Не удалось прочитать результат.');
    return data;
  } catch(error) { if(error.name==='AbortError')throw Error('Сервер не ответил. Повтори попытку сохранения.');throw error; }
  finally { clearTimeout(timer); }
}
export async function submitResultReview(session, attempt=pendingAttempt()) {
  if(!session?.authenticated||!attempt)throw Error('Войди в профиль и открой незачтённый результат.');
  const requestId=attempt.reviewRequestId||crypto.randomUUID();
  const data=await gameApi('review',{csrf:session.csrf,body:{requestId,token:attempt.token,timeMs:attempt.timeMs,samples:attempt.samples,season:RACE_SEASON,comment:'Финиш не удалось сохранить обычным способом.'}});
  try{if(pendingFinish()?.token===attempt.token)localStorage.removeItem(FINISH_PENDING);}catch{}
  clearPending(attempt.token);
  return data;
}
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function savedResultMessage(result) {
  if(result.result?.board!=='pro')return {state:'training',title:'Тренировка сохранена.',text:'Пройди рейтинговый заезд: первое место в рейтинге открывает бесплатные заезды в клубе.'};
  if(result.rank===1&&result.reward?.available)return {state:'leader',title:'Ты на первом месте!',text:'Бесплатный заезд уже доступен в профиле. Открой награду, согласуй визит и активируй её у администратора клуба.',link:'Открыть награду в профиле'};
  if(result.rank===1&&result.reward?.state==='used')return {state:'used',title:'Ты удерживаешь первое место!',text:'Результат сохранён. Бесплатный час уже использован; новый появится с началом недели или после возвращения на первое место. Условия — в профиле.',link:'Моя награда'};
  if(Number.isInteger(result.rank)&&result.rank>1)return {state:'chase',title:`Твоё место — ${result.rank}.`,text:'Попробуй ещё раз: побей рекорд лидера и получи бесплатный заезд в клубе. В рейтинге сохраняется твоё лучшее время.'};
  return {state:'saved',title:'Заезд сохранён.',text:'Статус места и награды сейчас не подтверждён. Проверь их в профиле.',link:'Открыть профиль'};
}
export function renderSavedResult(target,result,{profileLink=true}={}) {
  const copy=savedResultMessage(result);target.replaceChildren();target.className='race-save-feedback';target.dataset.state=copy.state;
  target.setAttribute('role','status');target.append(node('strong',copy.title),node('p',copy.text));
  if(copy.link&&profileLink){const link=node('a',copy.link,'reward-play');link.href='/cabinet#member-game';target.append(link);}
}
export function renderLeaders(target, data) {
  target.replaceChildren();
  if(!data.items.length){target.append(node('p','Первое место пока свободно. Пройди сектор и задай время.','game-empty'));return;}
  const list=node('ol',undefined,'game-ranking');
  for(const row of data.items){const li=node('li');li.append(node('span',String(row.rank).padStart(2,'0'),'game-rank'),node('strong',row.username),node('time',gameTime(row.timeMs)));list.append(li);}
  target.append(list);
}
export async function refreshLeaderCard() {
  const target=document.getElementById('drive-leader');if(!target)return;
  try {
    const data=await gameApi('leaders'), top=data.items[0];
    target.querySelector('strong').textContent=top?top.username:'Твоё имя может быть первым';
    target.querySelector('time').textContent=top?gameTime(top.timeMs):'—';
    target.querySelector('small').textContent=top?'Рекорд сектора · Про':'Общий рейтинг · Про';
    target.querySelector('button').firstChild.textContent=top?'Побить рекорд ':'Установить рекорд ';
    const pilot=document.getElementById('challenge-record-pilot'),time=document.getElementById('challenge-record-time'),label=document.getElementById('challenge-record-label');
    if(pilot)pilot.textContent=top?top.username:'Первое место свободно';
    if(time)time.textContent=top?gameTime(top.timeMs):'ТВОЙ СТАРТ';
    if(label)label.textContent=top?'Сейчас на 1 месте':'Поставь первый рекорд';
    const perk=document.getElementById('challenge-record-perk');if(perk)perk.hidden=!top;
    const invitePilot=document.getElementById('invite-record-pilot'),inviteTime=document.getElementById('invite-record-time'),inviteLabel=document.getElementById('invite-record-label');
    if(invitePilot)invitePilot.textContent=top?top.username:'Первое место свободно';
    if(inviteTime)inviteTime.textContent=top?gameTime(top.timeMs):'—';
    if(inviteLabel)inviteLabel.textContent=top?'Цель — время лидера':'Твой шанс задать время';
  } catch {
    target.querySelector('strong').textContent='Твой следующий вызов';
    target.querySelector('time').textContent='';
    target.querySelector('small').textContent='Не удалось обновить рекорд';
    const pilot=document.getElementById('challenge-record-pilot'),label=document.getElementById('challenge-record-label'),time=document.getElementById('challenge-record-time');
    if(pilot)pilot.textContent='Узнай время в таблице лидеров';
    if(label)label.textContent='Рейтинг временно недоступен';
    const perk=document.getElementById('challenge-record-perk');if(perk)perk.hidden=true;
    if(time)time.textContent='—';
    const invitePilot=document.getElementById('invite-record-pilot'),inviteTime=document.getElementById('invite-record-time');
    if(invitePilot)invitePilot.textContent='Рейтинг временно недоступен';
    if(inviteTime)inviteTime.textContent='—';
  }
}

export function createRaceResults({pause, retry}) {
  const $=id=>document.getElementById(id), panel=$('sim-results-panel');
  if(!panel)return null; // Historical /old keeps its own simpler interface.
  let run=null, generation=0, accountGeneration=0, session=null, receipt=pendingResult(), finishBody=null, loading=false;
  const message=text=>$('sim-result-status').textContent=text;
  const reviewButton=$('sim-review-result');
  let feedback=$('sim-save-feedback');
  if(!feedback){feedback=node('div');feedback.id='sim-save-feedback';feedback.hidden=true;$('sim-result-status').after(feedback);}
  const displayResult=()=>{
    $('sim-result-time').textContent=receipt?gameTime(receipt.timeMs):'—';
    $('sim-result-type').textContent=receipt?.board==='pro'?'ПРО · РЕЙТИНГОВЫЙ СЕКТОР':'АРХИВНАЯ ТРЕНИРОВКА';
    $('sim-result-publication').textContent=receipt?.board==='pro'
      ? 'При сохранении твой позывной и лучшее время появятся в общем рейтинге.'
      : 'Тренировка сохранится в личной истории. Общий рейтинг — только для режима Про.';
  };
  function close(){panel.hidden=true;for(const e of [...panel.parentElement.children])e.inert=false;$('sim-start').focus({preventScroll:true});}
  function open(result=false){
    pause();panel.hidden=false;for(const e of [...panel.parentElement.children])if(e!==panel)e.inert=true;
    $('sim-results-title').textContent=result?'Финиш. Твоё время.':'Таблица лидеров.';
    $('sim-result-retry').textContent=result?'Попробовать заново':'Новый заезд';
    $('sim-finish-summary').hidden=!result;displayResult();
    $('sim-results-close').focus({preventScroll:true});void leaders();
  }
  async function leaders(){
    $('sim-ranking-status').textContent='Обновляем рейтинг…';
    try{renderLeaders($('sim-ranking-list'),await gameApi('leaders'));$('sim-ranking-status').textContent='Один лучший результат каждого пилота · Про';}
    catch(error){$('sim-ranking-status').textContent=error.message;}
  }
  async function account(canSave=true){
    const current=generation,accountRequest=++accountGeneration;let loaded=null;
    try{loaded=await gameApi('session',{member:true});}catch{}
    if(current!==generation||accountRequest!==accountGeneration)return;
    session=loaded;
    // Login must never offer to save an unverified/invalid finish. A visitor can
    // leave for the cabinet before the finish request completes otherwise.
    $('sim-result-account').hidden=!canSave||!receipt?.token||Boolean(session?.authenticated);
    $('sim-save-result').hidden=!session?.authenticated||!canSave;
    $('sim-save-result').textContent=receipt?.board==='pro'?'Зачесть время в рейтинге':'Сохранить тренировку';
    $('sim-result-account')?.querySelector('[data-reward-reminder]')?.remove();
    if(!session?.authenticated){const reminder=node('p','Стань первым — приезжай за счёт клуба. Создай профиль, сохраняй чистые заезды Про и борись за бесплатные посещения.','game-reward-reminder');reminder.dataset.rewardReminder='';$('sim-result-account').prepend(reminder);}
  }
  async function verify(){
    if(!finishBody||loading)return;loading=true;
    const current=generation;
    $('sim-verify-result').hidden=true;message('Проверяем прохождение сектора…');
    try {
      const data=await verifyPendingFinish(finishBody);if(current!==generation)return;
      receipt=data;
      displayResult();await account();if(current!==generation)return;
      message(receipt.board==='pro'?'Сохрани время, чтобы узнать своё место и открыть награду за лидерство. Результат доступен для сохранения 24 часа.':'Время готово к сохранению. Оно останется доступным на этом устройстве 24 часа.');
    }catch(error){if(current===generation){message(error.message);$('sim-verify-result').hidden=false;if(reviewButton)reviewButton.hidden=false;}}
    finally{if(current===generation)loading=false;}
  }
  $('sim-results-close').addEventListener('click',close);
  $('sim-leaderboard').addEventListener('click',()=>open(false));
  $('sim-ranking-refresh').addEventListener('click',()=>void leaders());
  $('sim-result-retry').addEventListener('click',()=>{close();retry(false);});
  $('sim-result-pro').addEventListener('click',()=>{close();retry(true);});
  $('sim-verify-result').addEventListener('click',()=>void verify());
  reviewButton?.addEventListener('click',async()=>{
    if(!session?.authenticated){location.href='/cabinet?from=game#member-game';return;}
    reviewButton.disabled=true;
    try{await submitResultReview(session);message('Результат отправлен администратору. Решение появится в профиле.');reviewButton.hidden=true;$('sim-verify-result').hidden=true;}
    catch(error){message(error.message);}finally{reviewButton.disabled=false;}
  });
  $('sim-save-result').addEventListener('click',async()=>{
    if(!receipt||!session?.authenticated)return;
    const button=$('sim-save-result'),current=generation;button.disabled=true;
    try {
      const result=await savePendingResult(session,receipt);
      if(current!==generation)return;message('');$('sim-result-publication').textContent='Результат сохранён в твоём профиле.';
      renderSavedResult(feedback,result);feedback.hidden=false;
      button.textContent='Сохранено';void leaders();void refreshLeaderCard();
    }catch(error){if(current!==generation)return;message(error.message);button.disabled=false;if(error.status===401)await account();}
  });
  return {
    isOpen:()=>!panel.hidden, close,
    reset(){generation++;run=null;finishBody=null;loading=false;feedback.hidden=true;feedback.replaceChildren();if(reviewButton)reviewButton.hidden=true;close();},
    begin(state,board,mode){
      if(run)return run.promise;
      if(mode!=='race')return;
      const point=[0,Math.round(state.x*10),Math.round(state.z*10)];
      const attempt={board:'pro',startedAt:Date.now(),samples:[point],next:1};run=attempt;
      attempt.promise=gameApi('start',{body:{board:'pro',season:RACE_SEASON}}).catch(error=>{if(run===attempt)run=null;return {error};});
      return run.promise;
    },
    sample(state){
      if(!run||state.elapsed<run.next||state.elapsed>600)return;
      run.samples.push([Math.round(state.elapsed*1000),Math.round(state.x*10),Math.round(state.z*10)]);run.next+=1;
    },
    async finish(state, valid, mode){
      const current=generation;
      if(reviewButton)reviewButton.hidden=true;
      receipt={timeMs:Math.round(state.elapsed*1000),board:run?.board||state.assistMode};
      feedback.hidden=true;feedback.replaceChildren();
      $('sim-result-account').hidden=true;$('sim-save-result').hidden=true;$('sim-verify-result').hidden=true;
      $('sim-save-result').disabled=false;open(true);displayResult();
      void account(false);
      if(!valid||!run||mode!=='race') { message('Тренировочный результат без зачёта: возврат на трассу, смена режима или выход за границы сектора. Для сохранения начни новый чистый заезд.');return; }
      message('Фиксируем финиш…');
      const issued=await run.promise;if(current!==generation)return;
      if(issued.error){message('Сервер не подтвердил старт. Это время не попадёт в рейтинг. Новый заезд можно начать после восстановления связи.');return;}
      const last=run.samples.at(-1), sample=[receipt.timeMs,Math.round(state.x*10),Math.round(state.z*10)];
      if(sample[0]>last[0])run.samples.push(sample);else run.samples[run.samples.length-1]=sample;
      finishBody={token:issued.token,timeMs:receipt.timeMs,samples:run.samples,board:run.board,season:RACE_SEASON,expiresAt:new Date(run.startedAt+2*3600000).toISOString()};
      try{localStorage.setItem(FINISH_PENDING,JSON.stringify(finishBody));}catch{}
      await verify();
    }
  };
}

if(document.getElementById('drive-leader')) void refreshLeaderCard();

if(new URLSearchParams(location.search).get('challenge')==='leader'){const card=document.getElementById('drive-leader');if(card)card.classList.add('is-challenge');}
