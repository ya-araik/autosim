// Owner/staff controls. Every permission is also checked by the server.
export function initIntegrations({api,node,field,table,datetime,can,isOwner}) {
  const $=id=>document.getElementById(id);
  let generation=0;
  const statuses={available:'Доступно',unknown:'Не проверено',permission_denied:'Нет доступа',unavailable:'Нет ответа',schema_or_access_error:'Требуется проверка',rate_limited:'Лимит запросов'};
  const button=(text,fn,style='secondary')=>{const b=node('button',text,style);b.type='button';b.addEventListener('click',fn);return b;};
  const card=title=>{const s=node('section',undefined,'admin-card');s.append(node('h2',title));return s;};
  const notice=text=>node('p',text,'integration-notice');
  const errorBox=()=>{const p=node('p',undefined,'form-message');p.setAttribute('role','status');return p;};
  function submit(form,title,run){
    const b=node('button',title,'primary');b.type='submit';const status=errorBox();form.append(b,status);
    form.addEventListener('submit',async e=>{e.preventDefault();if(!form.reportValidity())return;const seq=generation;b.disabled=true;status.textContent='Сохраняем…';try{await run();if(seq===generation)status.textContent='Сохранено.';}catch(error){if(seq===generation)status.textContent=error.message;}finally{b.disabled=false;}});
  }
  async function access(){
    const seq=generation,data=await api('access');if(seq!==generation)return;
    const target=$('access-content');target.replaceChildren();
    const owner=card('Владелец');owner.append(node('strong',data.owner.username),node('p','Полный доступ. Только этот аккаунт управляет токеном, ролями и сотрудниками. Права владельца не передаются.','section-note'));target.append(owner);
    const roles=card('Роли команды'),roleList=node('div',undefined,'access-list');roles.append(node('p','Создайте роль по обязанностям: например, администратор смены. Затем назначьте её сотруднику.','section-note'));
    for(const role of data.roles){const row=node('div',undefined,'access-row');row.append(node('strong',role.name),node('small',role.permissions.length+' разрешений'),button('Настроить',()=>roleEditor(role)));roleList.append(row);}
    roles.append(roleList,button('Создать роль',()=>roleEditor()));const editor=node('div',undefined,'access-editor');roles.append(editor);target.append(roles);
    function roleEditor(role){
      editor.replaceChildren();const form=node('form');form.append(node('h3',role?'Настроить роль':'Новая роль'),field('name','Название роли','text',role?.name,{required:true,maxLength:80}));
      const grid=node('div',undefined,'permission-grid');
      const groups=[['Работа с гостями',['bookings','profiles','rewards']],['Игра',['game']],['Отчётность',['analytics','audit','data']],['SmartShell',['smartshell']]];
      for(const [title,families] of groups){const box=node('fieldset');box.append(node('legend',title));for(const [key,label] of Object.entries(data.permissions)){if(families.includes(key.split('.')[0]))box.append(field(key,label.replace(/кокпит/gi,'симулятор'),'checkbox',role?.permissions.includes(key)));}grid.append(box);}
      form.append(grid,node('p','Доступ SmartShell также ограничивается правами подключённого токена. Выдача роли не расширяет эти права.','section-note'));
      submit(form,'Сохранить роль',async()=>{await api('access',{method:role?'PATCH':'POST',body:{kind:'role',...(role?{id:role.id,version:role.version}:{}),name:form.elements.name.value.trim(),permissions:Object.keys(data.permissions).filter(k=>form.elements[k]?.checked)}});await access();});editor.append(form);form.elements.name.focus({preventScroll:true});
    }
    const staff=card('Сотрудники'),list=node('div',undefined,'access-list');
    for(const item of data.staff){const row=node('div',undefined,'access-row');row.append(node('strong',item.name),node('span',item.username+' · '+(data.roles.find(r=>r.id===item.roleId)?.name||'Роль удалена')),node('small',item.disabled?'Доступ закрыт':'Доступ открыт'),button('Изменить',()=>staffEditor(item)));list.append(row);}
    if(!data.staff.length)list.append(node('p','Пока доступ есть только у владельца.','section-note'));
    staff.append(list,button('Добавить сотрудника',()=>staffEditor()));const staffEdit=node('div',undefined,'access-editor');staff.append(staffEdit);target.append(staff);
    function staffEditor(item){
      staffEdit.replaceChildren();if(!data.roles.length){staffEdit.append(notice('Сначала создайте роль с нужными разрешениями.'));return;}
      const form=node('form');form.append(node('h3',item?'Доступ сотрудника':'Новый сотрудник'),field('name','Имя сотрудника','text',item?.name,{required:true,maxLength:80}),field('username','Логин · латиница, цифры, _','text',item?.username,{required:true,maxLength:32}),field('roleId','Роль','select',item?.roleId||data.roles[0].id,{choices:data.roles.map(r=>[r.id,r.name])}),field('password',item?'Новый пароль · оставьте пустым, чтобы сохранить':'Пароль · от 8 символов и спецсимвол','password','',{required:!item,maxLength:128}),field('disabled','Закрыть доступ','checkbox',item?.disabled));
      form.elements.username.readOnly=Boolean(item);form.elements.username.autocomplete='off';form.elements.password.autocomplete='new-password';
      form.append(node('p','Изменение сотрудника завершит его действующие сессии. Изменение роли применяется к следующим запросам всех её сотрудников.','section-note'));
      submit(form,'Сохранить сотрудника',async()=>{const body={kind:'staff',...(item?{id:item.id,version:item.version}:{}),name:form.elements.name.value.trim(),username:form.elements.username.value.trim(),roleId:form.elements.roleId.value,disabled:form.elements.disabled.checked};if(form.elements.password.value)body.password=form.elements.password.value;try{await api('access',{method:item?'PATCH':'POST',body});form.elements.password.value='';await access();}finally{delete body.password;}});staffEdit.append(form);
    }
  }
  async function connection(){
    const seq=generation,data=await api('smartshell');if(seq!==generation)return;const target=$('smartshell-content');target.replaceChildren();
    const state=card('SmartShell');state.append(node('p',({not_connected:'Подключение не настроено',restricted:'Токен не подтвердил доступ к клубу',unavailable:'SmartShell сейчас недоступен',connected:data.readOnly?'Подключено · чтение':'Подключено · чтение и запись'}[data.state]||'Требуется проверка'),'integration-state'));
    if(data.club)state.append(node('strong',data.club.name),node('p',data.club.city+' · ID '+data.club.id,'section-note'));
    state.append(notice(data.readOnly?'Изменения SmartShell выключены. Заявки сайта пока не занимают места в расписании SmartShell.':'Клиенты и резервы сайта синхронизируются с подключённым клубом SmartShell.')); 
    if(data.checkedAt)state.append(node('small','Проверено '+datetime(data.checkedAt)));
    if(data.state==='restricted')state.append(node('p','Токен payment_create предназначен для платежей. Чтобы проверить клиентов, брони и подписку, войдите через аккаунт SmartShell с ID клуба.','section-note'));
    if(data.reauthRequired)state.append(notice('Не удалось безопасно продлить сессию. Владелец должен войти в SmartShell повторно.'));
    target.append(state);
    if(isOwner()){
      const settings=card('Подключение владельца'),loginForm=node('form');
      loginForm.append(field('clubId','ID клуба SmartShell','number',data.linkedClubId||'',{required:true,min:1,max:2147483647}),field('login','Телефон или логин SmartShell','text','',{required:true,maxLength:100}),field('password','Пароль SmartShell','password','',{required:true,maxLength:256}));
      loginForm.elements.login.autocomplete='off';loginForm.elements.password.autocomplete='off';
      if(!data.linkedClubId)loginForm.elements.clubId.placeholder='ID из кабинета владельца SmartShell';
      loginForm.append(node('p','Пароль передаётся только для входа в SmartShell и не сохраняется. Токены доступа и продления шифруются на сервере. Сотрудники их не видят.','section-note'));
      submit(loginForm,data.authMode==='account'?'Войти повторно':'Войти и проверить клуб',async()=>{const body={clubId:Number(loginForm.elements.clubId.value),login:loginForm.elements.login.value.trim(),password:loginForm.elements.password.value,version:data.version};loginForm.elements.password.value='';try{await api('smartshell/login',{method:'POST',body});await connection();}finally{delete body.password;}});settings.append(loginForm);
      if(data.expiresAt)settings.append(node('p','Текущий токен до '+datetime(data.expiresAt)+'. При обращении к API сессия продлевается автоматически.','section-note'));
      const advanced=node('details'),summary=node('summary','Подключить готовый access_token');advanced.append(summary);
      const form=node('form');form.append(field('token','Access token SmartShell','password','',{required:true,maxLength:4096}));form.elements.token.autocomplete='off';form.elements.token.spellcheck=false;
      form.append(node('p','Токен payment_create не подходит для чтения клуба. Готовый access_token без refresh_token потребуется обновлять вручную.','section-note'));
      submit(form,'Проверить токен',async()=>{try{await api('smartshell',{method:'POST',body:{token:form.elements.token.value.trim(),version:data.version}});await connection();}finally{form.elements.token.value='';}});advanced.append(form);settings.append(advanced);
      if(data.configured){const status=errorBox(),check=button('Проверить права заново',async()=>{check.disabled=true;status.textContent='Проверяем доступ…';try{await api('smartshell/check',{method:'POST',body:{version:data.version}});await connection();}catch(e){status.textContent=e.message;}finally{check.disabled=false;}});settings.append(check,status);}
      target.append(settings);
      const plan=card('Подписка клуба');
      if(data.subscription){plan.append(node('strong',data.subscription.subscription),node('p','Действует до '+datetime(data.subscription.expires_at),'section-note'));const modules=node('details');modules.append(node('summary','Модули подписки · '+(data.subscription.modules?.length||0)),node('p',data.subscription.modules?.join(', ')||'Не перечислены','section-note'));plan.append(modules);}
      else plan.append(node('p','Тариф не определён: API не вернул сведения о подписке. По отказу в доступе определить тариф нельзя.','section-note'));
      target.append(plan);
    }
    const caps=card('Доступные функции'),list=node('div',undefined,'access-list');for(const [key,status] of Object.entries(data.capabilities)){const row=node('div',undefined,'access-row');row.append(node('strong',(data.labels[key]||key).replace(/Кокпит/g,'Симулятор').replace(/кокпит/g,'симулятор')),node('span',statuses[status]||'Не проверено',status==='available'?'access-available':''));list.append(row);}if(!list.children.length)list.append(node('p','Сначала проверьте подключение.','section-note'));caps.append(list);target.append(caps);
    if(isOwner()&&data.writeAllowed){
      const test=card('Синхронизация клуба'),mode=node('form');
      mode.append(field('enabled','Синхронизировать все регистрации и брони сайта','checkbox',!data.readOnly));
      submit(mode,'Сохранить режим',async()=>{await api('smartshell/mode',{method:'PATCH',body:{enabled:mode.elements.enabled.checked,version:data.version}});await connection();});test.append(mode);
      test.append(node('p','Новые клиенты создаются из данных регистрации. Существующие аккаунты связывает администратор. Выбранные места резервируются при отправке заявки; подтверждение владельца использует тот же резерв. Если SmartShell требует проверку телефона, она отображается в кабинете клиента; место можно зарезервировать до привязки профиля.','section-note'));
      if(data.worker?.lastRun)test.append(node('p','Фоновая синхронизация: '+datetime(data.worker.lastRun),'section-note'));
      target.append(test);
    }
    if(!data.readOnly&&can('smartshell.bookings')){
      const jobs=card('Синхронизация'),out=node('div',undefined,'table-container'),note=errorBox();
      async function loadJobs(){const r=await api('smartshell/jobs');if(seq!==generation)return;table(out,['Запись','Состояние','SmartShell','Действия'],r.items.map(j=>{const actions=node('div',undefined,'toolbar-actions');const permission=j.kind==='profile'?'smartshell.clients.write':'smartshell.bookings.write';if(can(permission)&&!['needs_verification','needs_review','needs_link','needs_profile_data'].includes(j.state)){const run=button(j.state==='synced'?'Проверить':'Повторить проверку',async()=>{run.disabled=true;try{await api('smartshell/sync',{method:'POST',body:{id:j.id,retry:true}});await loadJobs();}catch(e){note.textContent=e.message;}finally{run.disabled=false;}});actions.append(run);if(j.kind==='booking'&&j.remoteId)actions.append(button('Принять данные SmartShell',async()=>{if(!confirm('Обновить эту заявку на сайте по сохранённой записи SmartShell?'))return;try{await api('smartshell/sync',{method:'POST',body:{id:j.id,acceptRemote:true}});await loadJobs();}catch(e){note.textContent=e.message;}}));}return [(j.kind==='profile'?'Профиль ':'Бронь ')+(j.bookingId||j.guestId).slice(0,8),j.message||j.state,j.remoteId||'—',actions];}));}
      jobs.append(node('p','Каждая операция хранит статус и идентификатор SmartShell. При неопределённом ответе повторное создание блокируется; при внешнем изменении можно принять данные SmartShell.','section-note'),button('Обновить статусы',()=>loadJobs().catch(e=>note.textContent=e.message)),out,note);target.append(jobs);await loadJobs();
    }
    if(data.capabilities.equipment==='available'&&can('smartshell.equipment')){
      const equipment=card('Симуляторы клуба'),content=node('div');const load=button('Показать оборудование',async()=>{load.disabled=true;try{const result=await api('smartshell/equipment');if(seq!==generation)return;content.replaceChildren();if(!result.items.length)content.append(node('p','API вернул пустой список.'));
        const form=node('form');for(const h of result.items){const row=node('div',undefined,'access-row');row.append(node('strong',h.alias),node('small',h.in_service?'На обслуживании':h.online?'В сети':'Не в сети'));if(isOwner()){const selected=Object.keys(data.mapping||{}).find(k=>data.mapping[k].includes(h.id))||'';row.append(field('host_'+h.id,'Комплектация','select',selected,{choices:[['','Не использовать'],['standard','Standard'],['pro','Pro'],['vip','VIP']]}));}form.append(row);}
        if(isOwner())submit(form,'Сохранить соответствие мест',async()=>{const mapping={standard:[],pro:[],vip:[]};for(const h of result.items){const k=form.elements['host_'+h.id]?.value;if(k)mapping[k].push(h.id);}await api('smartshell/mapping',{method:'PATCH',body:{version:data.version,mapping}});await connection();});content.append(form);
      }catch(e){content.replaceChildren(notice(e.message));}finally{load.disabled=false;}});equipment.append(load,content);target.append(equipment);
    }
    if(data.capabilities.bookings==='available'&&can('smartshell.bookings')){
      const schedule=card('Брони SmartShell'),form=node('form'),out=node('div',undefined,'table-container');form.append(field('date','Дата в Оренбурге','date',new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Yekaterinburg'}).format(new Date()),{required:true}));submit(form,'Показать расписание',async()=>{const r=await api('smartshell/bookings?'+new URLSearchParams({date:form.elements.date.value}));if(seq!==generation)return;table(out,['ID','Места','С','До','Статус'],r.items.map(b=>[b.id,b.hosts.join(', '),b.from,b.to,b.status]));if(r.more)out.append(notice('Есть ещё записи. Показаны первые 100; это не полная проверка свободных мест.'));});schedule.append(form,out);target.append(schedule);
    }
  }
  function profileLink(target,data,guestId,reload){
    if(!can('smartshell.clients'))return;
    const box=card('Профиль SmartShell'),status=data?.smartshell;
    if(status?.link){box.append(node('strong',status.link.nickname||'Клиент #'+status.link.id),node('p','Связан с клубом '+status.link.clubId+' · '+datetime(status.link.linkedAt),'section-note'));}
    else{box.append(node('p',status?.registration?'Создание аккаунта ожидает доступного API. В SmartShell учётная запись ещё не создана.':'Профиль SmartShell не связан. Для старого клиента выберите существующую запись.','section-note'));
      if(can('profiles.link')){const form=node('form'),results=node('div',undefined,'ss-client-results');form.append(field('q','Поиск клиента SmartShell','search','',{required:true,maxLength:100}));form.elements.q.placeholder='Ник, имя или телефон';form.elements.q.minLength=3;
        submit(form,'Найти клиента',async()=>{const seq=generation,found=await api('smartshell/clients?'+new URLSearchParams({q:form.elements.q.value.trim()}));if(seq!==generation)return;results.replaceChildren();if(!found.items.length)results.append(node('p','Совпадений нет. Новый клиент автоматически не создавался.'));for(const client of found.items){const row=node('div',undefined,'ss-client-match');row.append(node('strong',client.nickname||client.login),node('p',[client.first_name,client.last_name,client.phone].filter(Boolean).join(' · ')),node('small','SmartShell ID '+client.id));const label=field('confirm_'+client.id,'Проверил: это тот же человек','checkbox',false),note=errorBox();row.append(label);const bind=button('Связать с карточкой',async()=>{if(!label.querySelector('input').checked){note.textContent='Проверьте, что обе записи принадлежат одному человеку.';return;}bind.disabled=true;try{await api('smartshell/link',{method:'POST',body:{guestId,uuid:client.uuid,version:status?.link?.version||0,confirmed:true}});await reload();}catch(e){note.textContent=e.message;bind.disabled=false;}});row.append(bind,note);results.append(row);}if(found.more)results.append(node('p','Показаны первые 20 совпадений. Уточните поиск.'));});box.append(form,results);}
    }
    if(status?.jobs?.length){const list=node('div',undefined,'access-list');for(const j of status.jobs)list.append(node('p',(j.kind==='profile'?'Профиль':'Бронь')+' · '+(j.message||j.state)+(j.remoteId?' · SmartShell #'+j.remoteId:''),'section-note'));box.append(list);}
    target.append(box);
  }
  return {access,connection,profileLink,clear(){generation++;$('access-content').replaceChildren();$('smartshell-content').replaceChildren();}};
}
