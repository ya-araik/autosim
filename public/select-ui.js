// Progressive enhancement: real selects retain form values, validation and the
// existing change handlers. Without JS, the browser control remains available.
const instances = new WeakMap();
let serial = 0, opened = null;
const svg = (path, className) => `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const arrow = svg('m7 9 5 5 5-5', 'as-select-arrow');
const tick = svg('m5 12 4 4L19 6', 'as-select-tick');
function enhance(select) {
  if (instances.has(select) || select.multiple || select.size > 1 || select.dataset.nativeSelect !== undefined) return;
  const label = select.getAttribute('aria-label') || [...select.labels || []].map(node => {
    const clone = node.cloneNode(true);clone.querySelectorAll('select,input,button').forEach(child=>child.remove());return clone.textContent.trim();
  }).join(' ') || 'Выбери вариант';
  const id = 'as-select-' + ++serial, wrap = document.createElement('div'), button = document.createElement('button');
  wrap.className = 'as-select';button.className = 'as-select-trigger';button.type = 'button';
  button.setAttribute('role','combobox');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
  button.setAttribute('aria-controls',id);button.setAttribute('aria-label',label);
  const value = document.createElement('span');value.className='as-select-value';button.append(value);button.insertAdjacentHTML('beforeend',arrow);
  const list = document.createElement('div');list.className='as-select-menu';list.id=id;list.setAttribute('role','listbox');list.setAttribute('aria-label',label);
  // Own dismissal as well as opening: native auto-dismiss can close on a touch
  // of the trigger before its click handler runs, causing that click to reopen.
  list.setAttribute('popover','manual');
  const error = document.createElement('span');error.className='as-select-error';error.id=id+'-error';error.setAttribute('role','alert');error.hidden=true;
  select.before(wrap);wrap.append(select,button,error);select.hidden=true;
  // Place a popover inside its owning dialog, so it remains in that modal's
  // focus/accessibility subtree. The top layer prevents clipping by glass cards.
  const dialog=select.closest('dialog');
  (dialog || document.body).append(list);
  list.dataset.theme=select.closest('.member-wrap,.dark,.sim-shell')?'dark':'light';
  let active=-1, rows=[], search='', searchTimer, open=false;
  const options=()=>[...select.options].filter(option=>!option.hidden);
  const sync=()=>{
    const text=select.selectedOptions[0]?.textContent || 'Выбери вариант';
    if(value.textContent!==text)value.textContent=text;
    button.disabled=select.disabled;button.setAttribute('aria-label',label+': '+text);
    button.setAttribute('aria-required',String(select.required));
    if(select.disabled && open)close();
  };
  function position(){
    const rect=button.getBoundingClientRect(),view=window.visualViewport,top=view?.offsetTop||0,left=view?.offsetLeft||0;
    const width=view?.width||innerWidth,height=view?.height||innerHeight,gap=8;
    const below=top+height-rect.bottom-12,above=rect.top-top-12,up=below<180&&above>below;
    list.style.width=Math.min(Math.max(180,rect.width),width-24)+'px';list.style.maxHeight=Math.max(80,Math.min(320,up?above:below)-gap)+'px';
    list.style.left=Math.max(left+12,Math.min(rect.left,left+width-list.offsetWidth-12))+'px';
    list.style.top=(up?Math.max(top+12,rect.top-list.offsetHeight-gap):rect.bottom+gap)+'px';
  }
  function highlight(index){
    active=index;rows.forEach((row,i)=>row.classList.toggle('is-active',i===active));
    const row=rows[active];if(row){button.setAttribute('aria-activedescendant',row.id);row.scrollIntoView({block:'nearest'});}
  }
  function close(focus=false){
    if(!open)return;open=false;button.setAttribute('aria-expanded','false');button.removeAttribute('aria-activedescendant');
    if(list.hidePopover){if(list.matches(':popover-open'))list.hidePopover();}else list.classList.remove('is-open');
    opened=null;if(focus)button.focus({preventScroll:true});
  }
  function choose(index){
    const option=options()[index];if(!option || option.disabled)return;
    select.value=option.value;error.hidden=true;button.removeAttribute('aria-invalid');button.removeAttribute('aria-describedby');
    select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));sync();close(true);
  }
  function show(){
    if(select.disabled)return;opened?.close();sync();rows=[];list.replaceChildren();
    options().forEach((option,i)=>{
      const row=document.createElement('div');row.className='as-select-option';row.id=id+'-'+i;row.setAttribute('role','option');
      row.setAttribute('aria-selected',String(option.selected));row.setAttribute('aria-disabled',String(option.disabled));
      const text=document.createElement('span');text.textContent=option.textContent;row.append(text);row.insertAdjacentHTML('beforeend',tick);
      row.addEventListener('pointerdown',event=>event.preventDefault());row.addEventListener('click',()=>choose(i));list.append(row);rows.push(row);
    });
    open=true;opened={close,position};button.setAttribute('aria-expanded','true');
    if(list.showPopover)list.showPopover();else list.classList.add('is-open');position();
    highlight(Math.max(0,options().findIndex(option=>option.selected)));button.focus({preventScroll:true});
  }
  button.addEventListener('click',event=>{event.preventDefault();open?close():show();});
  button.addEventListener('keydown',event=>{
    if(event.key==='Escape' && open){event.preventDefault();event.stopPropagation();close(true);return;}
    if(event.key==='Tab'){close();return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();if(!open){show();return;}const opts=options(),step=event.key==='ArrowUp'||event.key==='End'?-1:1;
      let next=event.key==='Home'?0:event.key==='End'?opts.length-1:Math.max(0,Math.min(opts.length-1,active+step));
      while(opts[next]?.disabled && next>=0 && next<opts.length)next+=step;
      if(opts[next])highlight(next);return;
    }
    if(event.key==='Enter'||event.key===' '){event.preventDefault();open?choose(active):show();return;}
    if(event.key.length===1 && !event.ctrlKey && !event.metaKey && !event.altKey){
      event.preventDefault();if(!open)show();clearTimeout(searchTimer);search+=event.key.toLocaleLowerCase('ru');
      const match=options().findIndex(option=>!option.disabled&&option.textContent.toLocaleLowerCase('ru').startsWith(search));
      if(match>=0)highlight(match);searchTimer=setTimeout(()=>search='',650);
    }
  });
  list.addEventListener('toggle',event=>{if(event.newState==='closed'&&!list.matches(':popover-open'))close();});
  document.addEventListener('pointerdown',event=>{if(open&&!wrap.contains(event.target)&&!list.contains(event.target))close();},true);
  document.addEventListener('focusin',event=>{if(open&&!wrap.contains(event.target)&&!list.contains(event.target))close();});
  dialog?.addEventListener('close',()=>close());
  select.addEventListener('change',sync);select.addEventListener('input',sync);
  select.addEventListener('invalid',event=>{event.preventDefault();error.hidden=false;error.textContent=select.validationMessage;button.setAttribute('aria-invalid','true');button.setAttribute('aria-describedby',error.id);button.focus();});
  select.form?.addEventListener('reset',()=>queueMicrotask(sync));
  // Existing booking code updates values directly after tariff/guest changes.
  for(const key of ['value','selectedIndex']){
    const descriptor=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,key);
    Object.defineProperty(select,key,{configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);sync();}});
  }
  new MutationObserver(()=>{sync();if(open)close();}).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected','label','value','required']});
  instances.set(select,{sync});sync();
}
function scan(root){if(root.matches?.('select'))enhance(root);root.querySelectorAll?.('select').forEach(enhance);}
scan(document);
new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(scan))).observe(document.body,{childList:true,subtree:true});
window.addEventListener('resize',()=>opened?.position());window.visualViewport?.addEventListener('resize',()=>opened?.position());
document.addEventListener('scroll',event=>{if(!event.target.closest?.('.as-select-menu'))opened?.position();},true);
