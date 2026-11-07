// The existing counter and goal names preserve reporting continuity.
export const COUNTER_ID = 111096292;
let enabled = false;
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const privatePage = /^\/(adminka|source)(\/|\.|$)/.test(location.pathname);

export function setMetrikaConsent(accepted) {
  if (privatePage || local || accepted === enabled) return;
  enabled = accepted;
  if (!accepted) {
    window.ym?.(COUNTER_ID, 'destruct');
    return;
  }
  window.ym ||= function () { (window.ym.a ||= []).push(arguments); };
  window.ym.l ||= Date.now();
  if (!document.getElementById('yandex-metrika-script')) {
    const script = document.createElement('script');
    script.id = 'yandex-metrika-script';
    script.async = true;
    script.src = 'https://mc.yandex.ru/metrika/tag.js';
    document.head.append(script);
  }
  const cabinet = location.pathname.startsWith('/cabinet');
  window.ym(COUNTER_ID, 'init', {
    clickmap: true, trackLinks: true, accurateTrackBounce: true,
    webvisor: !cabinet, ecommerce: 'dataLayer',
    url: location.href, referrer: document.referrer
  });
}

export function reachGoal(goal) {
  if (enabled && ['zayavka', 'messenger_click', 'phone_click'].includes(goal)) {
    window.ym?.(COUNTER_ID, 'reachGoal', goal);
  }
}

export function trackApplication(id) {
  if (!id || !enabled) return;
  const key = 'autosim.metrika.application.' + id;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch { /* Analytics never blocks submitting a request. */ }
  reachGoal('zayavka');
}

document.addEventListener('click', event => {
  const link = event.target.closest?.('a[href]');
  if (!link) return;
  if (link.protocol === 'tel:') return reachGoal('phone_click');
  const hosts = ['t.me', 'telegram.me', 'wa.me', 'whatsapp.com', 'vk.me', 'm.me', 'viber.com'];
  if (['tg:', 'whatsapp:', 'viber:'].includes(link.protocol) ||
      hosts.some(host => link.hostname === host || link.hostname.endsWith('.' + host))) {
    reachGoal('messenger_click');
  }
}, true);
