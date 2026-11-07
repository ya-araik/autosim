// Private operations UI. All authorization, decisions and prices stay server-side.
export function initClubAdmin({api,node,table,datetime,message,openRecord,field,can,profileLink}) {
  const $=id=>document.getElementById(id);
  const clock=ms=>`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
  const states={pending:'На проверке',approved:'Зачтён',rejected:'Отклонён',resolved:'Сохранён',started:'Не зафиксирован финиш',verified:'Финиш проверен',saved:'В профиле'};
  let accessGeneration=0,generation=0,settingsVersion=0,currentGuest=null,pickerSequence=0;
  function button(text,action,style='secondary'){const b=node('button',text,style);b.type='button';b.addEventListener('click',action);return b;}
  function section(title){const s=node('section',undefined,'admin-card');s.append(node('h3',title));return s;}
  function detail(target,label,value){const row=node('div');row.append(node('dt',label),node('dd',value||'—'));target.append(row);}
  function compact(title,rows,headers){const d=node('details',undefined,'profile-details');d.append(node('summary',title));const t=node('div',undefined,'table-container');table(t,headers,rows);d.append(t);return d;}
  function closeProfile(){$('profile-dialog').close();currentGuest=null;generation++;}
  $('profile-close').addEventListener('click',closeProfile);
  $('profile-dialog').addEventListener('close',()=>{currentGuest=null;generation++;});
  async function profile(guestId) {
    const seq=++generation;currentGuest=guestId;
    const target=$('profile-content');target.replaceChildren(node('p','Загружаем карточку…','section-note'));
    $('profile-title').textContent='Карточка клиента';
    if(!$('profile-dialog').open)$('profile-dialog').showModal();
    try{
      const data=await api('profiles/'+encodeURIComponent(guestId));if(seq!==generation)return;
      const {guest,user}=data;target.replaceChildren();$('profile-title').textContent=user?.username||guest.name;
      const actions=node('div',undefined,'toolbar-actions');
      actions.append(button('Редактировать контакты',()=>{closeProfile();openRecord('guests',guest);}),button('Добавить бронь',()=>{closeProfile();openRecord('bookings');selectBookingProfile({guestId:guest.id,name:guest.name,phone:guest.phone,email:guest.email,username:user?.username});},'primary'),button('Обновить',()=>void profile(guestId)));
      if(!can('profiles.write'))actions.children[0].hidden=true;if(!can('bookings.write'))actions.children[1].hidden=true;target.append(actions);
      const identity=section('Контакты и профиль'),dl=node('dl',undefined,'definition-list');
      for(const [label,value] of [['Имя',guest.name],['Позывной',user?.username],['Телефон',guest.phone||user?.phone],['Email',guest.email],['Кабинет',user?'Зарегистрирован':'Без регистрации'],['Статус карточки',guest.status==='active'?'Активна':'Неактивна'],['Регистрация',user?.createdAt?datetime(user.createdAt):null],['Источник регистрации',user?.registrationSource==='mini_game'?'Из мини-игры':user?'Сайт':null],['ID пользователя',user?.id],['ID карточки',guest.id]])detail(dl,label,value);
      identity.append(dl);target.append(identity);profileLink(target,data,guestId,()=>profile(guestId));
      const visits=section('Визиты в клуб');visits.append(node('p',`${data.completedVisits} завершённых посещений · ${new Intl.NumberFormat('ru-RU').format(data.completedValueRub)} ₽ по завершённым броням. Это не отчёт об оплатах.`,'section-note'));
      const booked=node('div',undefined,'table-container');table(booked,['Дата','Тариф','Статус','Сумма',''],data.bookings.map(b=>[datetime(b.startsAt),({standard:'Standard',pro:'Pro',vip:'VIP'}[b.tariff]||b.tariff),{draft:'Черновик',confirmed:'Подтверждена',completed:'Завершена',cancelled:'Отменена'}[b.status],b.priceRub+' ₽',button('Открыть',()=>{closeProfile();openRecord('bookings',b);},'row-action')]));visits.append(booked);if(data.bookingsTruncated)visits.append(node('p','Показаны последние 200 записей.'));target.append(visits);
      const notes=section('Предпочтения и рекомендации');
      for(const [label,value] of [['Предпочтения',guest.preferences],['Рабочие заметки',guest.notes],['Рекомендация',guest.skillNote]]){notes.append(node('h4',label),node('p',value||'Пока не заполнено.'));}
      if(guest.skillVerified)notes.append(node('small','Рекомендация проверена сотрудником · '+datetime(guest.skillVerifiedAt)));target.append(notes);
      if(!user){target.append(node('p','У этого гостя нет кабинета. Брони и заметки можно вести без регистрации.','section-note'));return;}
      const game=section('Заезды и награда'),stats=data.gameStats;
      const summary=node('div',undefined,'profile-stats');
      for(const [label,value] of [['Лучшее время',data.best?clock(data.best.timeMs):'—'],['Место',data.best?(data.best.hidden?'Скрыт':data.best.rank):'—'],['Сохранено заездов',stats.savedRuns],['Время сохранённых заездов',Math.floor(stats.savedTimeMs/60000)+' мин'],['Старты за 30 дней',stats.recordedStarts],['Проверенное время за 30 дней',Math.floor(stats.verifiedTimeMs/60000)+' мин']]){const card=node('div');card.append(node('small',label),node('strong',String(value)));summary.append(card);}game.append(summary,node('p','Учёт стартов и неполных попыток ведётся с этого обновления. Время заездов — время движения по таймеру, а не время открытой вкладки.','section-note'));
      game.append(node('p',data.reward.available?'Награда доступна: 60 минут.':data.reward.state==='used'?'Бесплатный час уже использован.':'Награда недоступна: пилот сейчас не лидер.','profile-reward'));
      if(can('rewards.redeem'))game.append(button('Управлять наградой',()=>{closeProfile();openRecord('guests',guest);}));
      if(data.startError)game.append(node('p','Последняя ошибка старта: '+data.startError.message+' · '+datetime(data.startError.at)+' · код '+data.startError.code,'form-message'));
      game.append(compact('История сохранённых заездов',data.history.map(r=>[datetime(r.createdAt),clock(r.timeMs),r.season,r.source?.startsWith('admin')?'Зачтён сотрудником':'Проверен сервером']),['Дата','Время','Сезон','Источник']));
      game.append(compact('Попытки за последние 30 дней',data.attempts.map(a=>[datetime(a.startedAt),states[a.status]||a.status,a.timeMs?clock(a.timeMs):'—',a.errorMessage||'—']),['Старт','Состояние','Время','Причина']));
      if(data.historyTruncated||data.attemptsTruncated)game.append(node('p','В подробной истории показаны последние 100 записей каждого типа. Итоги выше учитывают всю доступную историю.','section-note'));
      game.append(compact('Списания наград',data.rewardHistory.map(r=>[datetime(r.redeemedAt),r.minutes+' минут']),['Посещение','Награда']));
      const reviews=node('div',undefined,'profile-review-list');renderReviewCards(reviews,data.reviews,()=>profile(guestId));game.append(node('h4','Обращения по результатам'),reviews);target.append(game);
      if(!can('game.write'))return;
      const manual=section('Восстановить незачтённое время');
      manual.append(node('p','Добавь время и основание. Сначала создастся обращение; зачёт в рейтинг — отдельным решением. Данные без серверного подтверждения будут явно отмечены.','section-note'));
      const form=node('form',undefined,'manual-score-form');form.append(field('time','Время · мм:сс.миллисекунды','text','',{required:true,maxLength:12}),field('reason','Основание и сведения для проверки','textarea','',{required:true,maxLength:1000,wide:true}));
      form.elements.time.placeholder='01:31.200';const submit=node('button','Создать обращение','primary');submit.type='submit';const status=node('p',undefined,'form-message');status.setAttribute('role','status');form.append(submit,status);
      const requestId=crypto.randomUUID();form.addEventListener('submit',async e=>{e.preventDefault();if(!form.reportValidity())return;const match=/^(\d{1,2}):([0-5]\d)(?:[.,](\d{1,3}))?$/.exec(form.elements.time.value.trim());if(!match){status.textContent='Укажи время как 01:31.200.';return;}const timeMs=(Number(match[1])*60+Number(match[2]))*1000+Number((match[3]||'').padEnd(3,'0'));submit.disabled=true;try{await api('game-reviews',{method:'POST',body:{requestId,guestId,timeMs,reason:form.elements.reason.value.trim()}});await profile(guestId);}catch(error){status.textContent=error.message;submit.disabled=false;}});manual.append(form);target.append(manual);
    }catch(error){if(seq===generation)target.replaceChildren(node('p',error.message,'form-message'),button('Повторить',()=>void profile(guestId)));}
  }
  function renderProfiles(items){table($('guests-table'),['Клиент','Позывной','Контакты','Профиль',''],items.map(r=>[r.name,r.username||'—',[r.phone,r.email].filter(Boolean).join(' · ')||'—',r.userId?'Кабинет пилота':'Гость без кабинета',button('Открыть карточку',()=>void profile(r.guestId),'row-action')]));}
  function selectBookingProfile(row){const form=$('record-form');form.elements.guestId.value=row.guestId;for(const [key,from] of [['guestName','name'],['phone','phone'],['email','email']])form.elements[key].value=row[from]||'';const summary=$('booking-profile-summary');if(summary)summary.textContent=(row.username?'@'+row.username+' · ':'')+row.name+' · '+(row.phone||'телефон не указан');}
  function bookingPicker(container,item) {
    const old=container.querySelector('[name="guestId"]');const wrap=old.parentElement;wrap.replaceChildren();wrap.className='booking-profile-picker field-wide';
    old.type='hidden';old.value=item?.guestId||'';wrap.append(old,node('strong','Профиль клиента · необязательно'));
    const summary=node('p',item?.guestId?'Привязано: '+item.guestName:'Без привязки — обычная ручная бронь.','section-note');summary.id='booking-profile-summary';wrap.append(summary);
    if(item?.guestId&&item?.source){wrap.append(node('small','Привязка этой записи сохранена. Для другого клиента создай новую бронь.'));return;}
    const search=node('input');search.type='search';search.placeholder='Ник, имя, телефон, email или ID';search.setAttribute('aria-label','Найти профиль для брони');search.autocomplete='off';
    const list=node('div',undefined,'profile-search-results');list.setAttribute('aria-live','polite');const clear=button('Без профиля',()=>{old.value='';summary.textContent='Без привязки — обычная ручная бронь.';list.replaceChildren();search.value='';});
    wrap.append(search,clear,list);container.prepend(wrap);
    let timer;search.addEventListener('input',()=>{clearTimeout(timer);const seq=++pickerSequence;list.replaceChildren(node('p','Ищем…'));timer=setTimeout(async()=>{try{const data=await api('profiles?'+new URLSearchParams({q:search.value.trim(),limit:12}));if(seq!==pickerSequence||!wrap.isConnected)return;list.replaceChildren();for(const row of data.items)list.append(button((row.username?'@'+row.username+' · ':'')+row.name+' · '+(row.phone||row.email||'без контакта'),()=>{selectBookingProfile(row);list.replaceChildren();search.value='';},'profile-search-option'));if(!data.items.length)list.append(node('p','Не найдено. Бронь можно оформить без профиля.'));if(data.total>12)list.append(node('small','Уточни запрос: показаны первые 12 совпадений.'));}catch(error){if(seq===pickerSequence)list.replaceChildren(node('p',error.message));}},250);});
  }
  function renderReviewCards(target,rows,reload){target.replaceChildren();if(!rows.length){target.append(node('p','Обращений нет.','section-note'));return;}
    for(const r of rows){const card=node('article',undefined,'review-card');card.append(node('strong',(r.username||'Пилот')+' · '+clock(r.timeMs)),node('p',(states[r.status]||r.status)+' · '+datetime(r.createdAt)),node('p',r.reason),node('small',(r.serverStart?'Старт есть на сервере':'Старт не подтверждён')+' · '+({plausible:'Маршрут правдоподобен; время требует решения',not_provided:'Телеметрия отсутствует'}[r.traceCheck]||'Проверка маршрута: '+r.traceCheck)));
      if(r.comment)card.append(node('p',r.comment));if(r.decisionNote)card.append(node('p','Решение: '+r.decisionNote));
      if(can('profiles.read'))card.append(button('Карточка пилота',()=>void profile(r.guestId),'row-action'));
      if(r.status==='pending'&&can('game.write')){const label=node('label','Основание решения'),note=node('textarea');note.rows=2;note.maxLength=1000;label.append(note);card.append(label);const actions=node('div',undefined,'toolbar-actions'),status=node('p',undefined,'form-message');status.setAttribute('role','status');
        for(const [decision,title] of [['approved','Зачесть в рейтинг'],['rejected','Отклонить']])actions.append(button(title,async()=>{if(!note.value.trim()){status.textContent='Напиши основание решения.';note.focus();return;}const buttons=[...actions.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await api('game-reviews',{method:'PATCH',body:{id:r.id,version:r.version,decision,note:note.value.trim()}});await reload();}catch(error){status.textContent=error.message;buttons.forEach(b=>b.disabled=false);}},decision==='approved'?'primary':'secondary'));card.append(actions,status);}
      target.append(card);
    }
  }
  async function loadReviews(){const current=accessGeneration;const target=$('game-reviews');target.textContent='Загружаем…';try{const data=await api('game-reviews?'+new URLSearchParams({status:$('game-review-filter').value,limit:100}));if(current!==accessGeneration)return;renderReviewCards(target,data.items,loadReviews);$('game-review-count').textContent=`${data.items.length} из ${data.total}`;}catch(error){if(current===accessGeneration)target.textContent=error.message;}}
  $('game-review-filter').addEventListener('change',()=>void loadReviews());
  async function loadSettings(){const current=accessGeneration;const form=$('game-control-form'),data=await api('game-settings');if(current!==accessGeneration)return;settingsVersion=data.version;for(const [k,v] of Object.entries(data)){const el=form.elements[k];if(el){if(el.type==='checkbox')el.checked=v;else el.value=v;}}}
  $('game-control-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;const submit=e.submitter;submit.disabled=true;const body={version:settingsVersion};for(const name of ['startsPerHour','startsPerIpHour','finishesPerHour','reviewsPerDay'])body[name]=Number(form.elements[name].value);for(const name of ['enabled','reviewsEnabled'])body[name]=form.elements[name].checked;body.maintenanceMessage=form.elements.maintenanceMessage.value.trim();try{await api('game-settings',{method:'PATCH',body});await loadSettings();$('game-control-status').textContent='Настройки сохранены и действуют для новых запросов.';}catch(error){$('game-control-status').textContent=error.message;}finally{submit.disabled=false;}});
  return {profile,renderProfiles,bookingPicker,selectBookingProfile,async loadGame(){await Promise.all([loadSettings(),loadReviews()]);$('game-control-form').querySelectorAll('input,textarea,button').forEach(el=>el.disabled=!can('game.write'));},clear(){accessGeneration++;generation++;pickerSequence++;currentGuest=null;$('profile-dialog').close();$('profile-content').replaceChildren();$('game-reviews').replaceChildren();$('game-control-form').reset();}};
}
