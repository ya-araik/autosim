const dialog=document.getElementById('booking-choice');
if(dialog&&typeof dialog.showModal==='function'){
  let trigger=null;
  document.querySelectorAll('[data-booking-choice]').forEach(link=>{
    link.setAttribute('aria-haspopup','dialog');
    link.addEventListener('click',event=>{
      if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;
      if(link.getAttribute('aria-disabled')==='true'){event.preventDefault();return;}
      event.preventDefault();trigger=link;
      const summary=document.getElementById('booking-choice-summary');
      summary.hidden=!link.matches('[data-seat-book],.config-call,.plan-call');
      summary.textContent=link.dataset.bookingSummary||[document.getElementById('price-caption')?.textContent,document.getElementById('price-total')?.textContent].filter(Boolean).join(' · ');
      dialog.querySelector('.booking-choice-online').href=link.href;
      dialog.showModal();document.documentElement.classList.add('booking-choice-open');
    });
  });
  document.getElementById('booking-choice-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;
    const r=dialog.getBoundingClientRect();
    if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();
  });
  dialog.addEventListener('close',()=>{document.documentElement.classList.remove('booking-choice-open');trigger?.focus({preventScroll:true});});
  document.getElementById('booking-choice-phone').addEventListener('click',()=>dialog.close());
  window.addEventListener('pageshow',()=>{if(!dialog.open)document.documentElement.classList.remove('booking-choice-open');});
}
