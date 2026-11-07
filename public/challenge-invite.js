// A quiet invitation. Bumping the revision shows the redesigned card once again.
const card = document.getElementById('challenge-invite');
if (card) {
  const key = 'autosim.challenge.dismissed.v27';
  let dismissed = false, ready = false;
  try { dismissed = localStorage.getItem(key) === '1'; } catch {}
  try { dismissed ||= sessionStorage.getItem(key) === '1'; } catch {}
  const inView = element => {
    if (!element || element.hidden) return false;
    const r = element.getBoundingClientRect();
    return r.height > 0 && r.top < innerHeight && r.bottom > 0;
  };
  function update() {
    const blocked = document.hidden || document.querySelector('dialog[open]') ||
      document.body.classList.contains('modal-open') ||
      document.querySelector('.menu-button[aria-expanded="true"]') ||
      inView(document.getElementById('analytics-consent')) ||
      inView(document.getElementById('sessions')) ||
      inView(document.getElementById('prices')) ||
      inView(document.getElementById('contacts')) ||
      document.activeElement?.matches('input,select,textarea,.as-select-trigger');
    card.hidden = dismissed || !ready || scrollY < innerHeight * .6 || Boolean(blocked);
  }
  function dismiss(returnFocus = false) {
    dismissed = true; card.hidden = true;
    try { localStorage.setItem(key, '1'); } catch {}
    try { sessionStorage.setItem(key, '1'); } catch {}
    if (returnFocus) document.querySelector('#test-drive [data-open-drive]')?.focus({preventScroll:true});
  }
  card.querySelector('[data-dismiss-invite]').addEventListener('click', () => dismiss(true));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !card.hidden) dismiss(card.contains(document.activeElement));
  });
  document.addEventListener('click', e => {
    if (e.target.closest?.('[data-open-drive]')) dismiss();
  });
  document.addEventListener('visibilitychange', update);
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => queueMicrotask(update));
  window.addEventListener('scroll', update, {passive:true});
  window.addEventListener('resize', update, {passive:true});
  window.addEventListener('storage', event => {
    if(event.key===key&&event.newValue==='1'){dismissed=true;update();}
  });
  const changes = new MutationObserver(update);
  changes.observe(document.body, {attributes:true, attributeFilter:['class']});
  for (const el of document.querySelectorAll('dialog,#analytics-consent,.menu-button')) {
    changes.observe(el, {attributes:true, attributeFilter:['open','hidden','aria-expanded']});
  }
  setTimeout(() => { ready = true; update(); }, 18000);
}
