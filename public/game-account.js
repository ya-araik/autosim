import {renderReward} from './leader-reward.js';
import {RACE_SEASON} from './race-config.js';
import {gameApi,gameTime,pendingAttempt,savePendingResult,submitResultReview,renderSavedResult} from './game-results.js';
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
let historyGeneration=0,rewardTimer=null,rewardWake=null;
export function stopGameHistory(){historyGeneration++;clearInterval(rewardTimer);rewardTimer=null;if(rewardWake)document.removeEventListener('visibilitychange',rewardWake);rewardWake=null;}
function watchReward(target,version){
  let busy=false;
  const update=async()=>{
    if(document.hidden||busy||version!==historyGeneration||!target.isConnected)return;
    busy=true;
    try{const data=await gameApi('me');if(version!==historyGeneration)return;const open=target.querySelector('details')?.open;target.replaceChildren();renderReward(target,data.reward);if(open)target.querySelector('details').open=true;}
    catch{if(version===historyGeneration){target.replaceChildren();renderReward(target,null);}}
    finally{busy=false;}
  };
  rewardTimer=setInterval(update,30000);rewardWake=()=>{if(!document.hidden)void update();};document.addEventListener('visibilitychange',rewardWake);
}
export async function showGameHistory(session,saved=null,{saveOnArrival=false}={}){
  const target=document.getElementById('member-game');if(!target||!session)return;
  stopGameHistory();const version=historyGeneration;
  target.replaceChildren();
  let saveError='';
  const arriving=pendingAttempt();
  if(saveOnArrival&&arriving){
    const saving=node('p','Сохраняем твой заезд…','form-status');saving.setAttribute('role','status');target.append(saving);
    try{saved=await savePendingResult(session,arriving);}catch(error){saveError=error.message;}
    if(version!==historyGeneration)return;
    target.replaceChildren();
  }
  target.append(node('p','БРАУЗЕРНЫЙ ЗАЕЗД','eyebrow'),node('h2','Твой сектор.'));
  if(saved){const feedback=node('div');renderSavedResult(feedback,saved,{profileLink:false});target.append(feedback);}
  const pending=pendingAttempt();
  if(pending){
    const box=node('div',undefined,'game-account-pending');box.append(node('strong',gameTime(pending.timeMs)),node('p',pending.samples?'Проверить и сохранить результат.':'Сохрани своё время.'));
    const button=node('button',saveError?'Повторить сохранение':pending.samples?'Проверить и сохранить':'Сохранить время','primary'),status=node('p',saveError);status.setAttribute('role','status');
    button.addEventListener('click',async()=>{button.disabled=true;try{const saved=await savePendingResult(session,pending);if(version!==historyGeneration)return;await showGameHistory(session,saved);}catch(error){if(version!==historyGeneration)return;status.textContent=error.message;button.disabled=false;}});
    const review=node('button','Отправить администратору на проверку','secondary');review.type='button';review.hidden=!saveError;
    button.addEventListener('click',()=>{review.hidden=false;});
    review.addEventListener('click',async()=>{review.disabled=button.disabled=true;try{await submitResultReview(session,pending);await showGameHistory(session);}catch(error){status.textContent=error.message;review.disabled=button.disabled=false;}});
    box.append(button,review,status);target.append(box);
  }
  if(saveOnArrival&&!arriving&&!saved)target.append(node('p','На этом устройстве нет нового результата.','form-status'));
  const link=node('a','Побороться за бесплатные заезды','text-button');link.href='/?challenge=leader#test-drive';target.append(link);
  try{
    const data=await gameApi('me');if(version!==historyGeneration)return;
    const reward=document.createElement('div');reward.id='member-reward';renderReward(reward,data.reward);target.prepend(reward);watchReward(reward,version);
    if(data.reviews?.length){const section=node('section',undefined,'game-account-pending');section.append(node('h3','Проверка результатов'));for(const r of data.reviews){section.append(node('strong',gameTime(r.timeMs)+' · '+({pending:'На проверке',approved:'Зачтён',rejected:'Отклонён',resolved:'Сохранён'}[r.status]||r.status)),node('p',r.decisionNote||'Администратор проверит результат. До решения он не участвует в рейтинге.'));}target.append(section);}
    if(!data.history.length){target.append(node('p','Твой первый рекорд впереди.','muted'));return;}
    if(data.best[0])target.append(node('p',`Личный рекорд · ${gameTime(data.best[0].timeMs)} · место ${data.best[0].rank}`,'game-personal-best'));
    const list=node('ol',undefined,'game-ranking');
    for(const row of data.history){const li=node('li');li.append(node('span',new Date(row.createdAt).toLocaleDateString('ru-RU')),node('strong',row.board==='pro'?(row.season===RACE_SEASON?'Про · сезон 2':'Про · сезон 1'):'Тренировка'),node('time',gameTime(row.timeMs)));list.append(li);}
    target.append(list);if(data.historyTruncated)target.append(node('small','Показаны 30 последних заездов.'));
  }catch(error){if(version!==historyGeneration)return;renderReward(target,null);target.append(node('p',error.message,'form-status'));}
}
