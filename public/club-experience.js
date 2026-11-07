const stage=document.querySelector('[data-club-experience]');
if(stage){
  const tabs=[...stage.querySelectorAll('[role="tab"]')];
  const panels=[...stage.querySelectorAll('[role="tabpanel"]')];
  function select(tab,focus=false){
    stage.style.setProperty('--club-tab-index',String(tabs.indexOf(tab)));
    for(const item of tabs){
      const active=item===tab;
      item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;
    }
    for(const panel of panels)panel.hidden=panel.id!==tab.getAttribute('aria-controls');
    if(focus)tab.focus({preventScroll:true});
  }
  for(const tab of tabs){
    tab.addEventListener('click',()=>select(tab));
    tab.addEventListener('keydown',event=>{
      const index=tabs.indexOf(tab);
      const target=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;
      if(target<0)return;
      event.preventDefault();select(tabs[target],true);
    });
  }
}
