const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const formatPrice = value => new Intl.NumberFormat('ru-RU').format(value);

// Keep the small-screen navigation in the normal keyboard order while open.
const menuButton = $('.menu-toggle');
const navigation = $('#navigation');
const menuIcon = $('use', menuButton);
function setMenu(open, restoreFocus = false) {
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  menuIcon.setAttribute('href', open ? '#i-close' : '#i-menu');
  navigation.classList.toggle('open', open);
  if (restoreFocus) menuButton.focus();
}
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  setMenu(open);
  if (open) $('a', navigation).focus();
});
navigation.addEventListener('click', event => {
  if (event.target.closest('a')) setMenu(false);
});
document.addEventListener('click', event => {
  if (!event.target.closest('.header') && menuButton.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
    setMenu(false, true);
  }
});
window.matchMedia('(min-width: 801px)').addEventListener('change', event => {
  if (event.matches) setMenu(false);
});

// The wheel follows the native range input, including its keyboard controls.
const steering = $('#steering');
const heroWheel = $('#hero-wheel');
const steeringValue = $('#steering-value');
function updateSteering() {
  const angle = Number(steering.value);
  heroWheel.style.setProperty('--steering-angle', angle + 'deg');
  steeringValue.textContent = angle + '°';
  const direction = angle < 0 ? 'влево' : 'вправо';
  const degrees = Math.abs(angle);
  const suffix = degrees % 10 === 1 && degrees % 100 !== 11 ? 'градус'
    : degrees % 10 >= 2 && degrees % 10 <= 4 && (degrees % 100 < 12 || degrees % 100 > 14) ? 'градуса' : 'градусов';
  steering.setAttribute('aria-valuetext', angle === 0 ? 'Прямо' : degrees + ' ' + suffix + ' ' + direction);
}
steering.addEventListener('input', updateSteering);
updateSteering();

const tariffs = {
  standard: {
    label: 'Standard', model: 'R5', image: '/assets/moza-r5.png',
    screenLabel: '4K-телевизор', screen: '55 дюймов', chip: 'ДЛЯ ПЕРВОГО ЗАЕЗДА',
    description: 'Всё, чтобы влюбиться в свой первый заезд. Руль с прямым приводом и большой 4K-экран.',
    prices: { 30: 400, 60: 700, 120: 1200 }
  },
  pro: {
    label: 'Pro', model: 'R12', image: '/assets/moza-r12.webp',
    screenLabel: 'Ультраширокий монитор', screen: '49 дюймов', chip: 'БОЛЬШЕ ОБРАТНОЙ СВЯЗИ',
    description: 'База MOZA R12 и ультраширокий монитор. Больше дороги в поле зрения, больше деталей в каждом повороте.',
    prices: { 30: 500, 60: 800, 120: 1500 }
  },
  vip: {
    label: 'VIP', model: 'R9', image: '/assets/moza-r9.webp',
    screenLabel: 'Большой экран', screen: '65 дюймов', chip: 'МАСШТАБ ОЩУЩЕНИЙ',
    description: 'MOZA R9, большой 65-дюймовый экран и коробка передач Simagic. Собери свой ритм вождения.',
    prices: { 30: 500, 60: 800, 120: 1500 }
  }
};
const durationLabels = { 30: '30 минут', 60: '1 час', 120: '2 часа' };
const vrPrices = { 30: 300, 60: 400, 120: 800 };
const selection = { tariff: 'standard', duration: 60 };
const tariffButtons = $$('[data-tariff]');
const durationButtons = $$('[data-duration]');
const vrToggle = $('#vr-toggle');
const configImage = $('#config-image');

function selectedPrice() {
  return tariffs[selection.tariff].prices[selection.duration] + (vrToggle.checked ? vrPrices[selection.duration] : 0);
}
function updateConfigurator() {
  const tariff = tariffs[selection.tariff];
  tariffButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tariff === selection.tariff)));
  durationButtons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.duration) === selection.duration)));
  if (configImage.getAttribute('src') !== tariff.image) configImage.src = tariff.image;
  configImage.alt = 'Рулевая база MOZA ' + tariff.model;
  $('#model-watermark').textContent = tariff.model;
  $('#spec-wheel').textContent = 'MOZA ' + tariff.model;
  $('#spec-screen-label').textContent = tariff.screenLabel;
  $('#spec-screen').textContent = tariff.screen;
  $('#product-chip').textContent = tariff.chip;
  $('#tariff-description').textContent = tariff.description;
  $('#vr-addition').textContent = selection.duration === 120
    ? '+800 ₽ · 2 × 400 ₽/ч'
    : '+' + formatPrice(vrPrices[selection.duration]) + ' ₽ за заезд';
  $('#total-label').textContent = tariff.label + ' · ' + durationLabels[selection.duration] + (vrToggle.checked ? ' · VR' : '');
  $('#total-price').textContent = formatPrice(selectedPrice());
  const planLink=$('#visit-plan-link');
  if(planLink)planLink.href='/visit.html#plan?'+new URLSearchParams({v:1,t:selection.tariff,m:selection.duration,p:1,vr:vrToggle.checked?1:0,d:'',at:'',g:'first'});
}
tariffButtons.forEach(button => button.addEventListener('click', () => {
  if (!tariffs[button.dataset.tariff]) return;
  selection.tariff = button.dataset.tariff;
  updateConfigurator();
}));
durationButtons.forEach(button => button.addEventListener('click', () => {
  const next = Number(button.dataset.duration);
  if (!durationLabels[next]) return;
  selection.duration = next;
  updateConfigurator();
}));
vrToggle.addEventListener('change', updateConfigurator);
updateConfigurator();

const modes = {
  race: {
    number: '01', tag: 'Точность решает', title: ['Ещё круг.', 'Ещё быстрее.'],
    description: 'Легендарные трассы и борьба за каждый поворот. Выходи на общий старт с друзьями или улучшай свой личный рекорд.',
    cta: 'Хочу на трассу', booking: 'Хочется на трассу? Подберём машину, симулятор и удобное время для гонки.'
  },
  drift: {
    number: '02', tag: 'Поймай свой угол', title: ['Искусство', 'ехать боком.'],
    description: 'Почувствуй баланс машины, поймай занос и научись его удерживать. От первой дуги до красивого парного дрифта.',
    cta: 'Попробовать дрифт', booking: 'Хочется попробовать дрифт? Поможем с настройками и подберём время для заезда.'
  },
  rally: {
    number: '03', tag: 'Доверься реакции', title: ['За пределами', 'идеальных трасс.'],
    description: 'Гравий, сложные повороты и меняющееся сцепление. Читай дорогу, держи темп и пройди свой спецучасток.',
    cta: 'Хочу на ралли', booking: 'Хочется на ралли? Подберём симулятор и удобное время для твоего спецучастка.'
  },
  free: {
    number: '04', tag: 'Твоя дорога. Твой темп.', title: ['Просто', 'за удовольствием.'],
    description: 'Городская езда, открытый мир, грузоперевозки и бездорожье. Выбирай машину и отправляйся туда, куда хочется.',
    cta: 'Выбрать маршрут', booking: 'Расскажи, как хочется провести время за рулём. Подберём игру и свободный симулятор.'
  }
};
const tabs = $$('[data-mode]');
const drivePanel = $('#drive-panel');
let activeMode = 'race';
function selectMode(tab, focus = false) {
  const mode = modes[tab.dataset.mode];
  if (!mode) return;
  activeMode = tab.dataset.mode;
  tabs.forEach(item => {
    item.setAttribute('aria-selected', String(item === tab));
    item.tabIndex = item === tab ? 0 : -1;
  });
  drivePanel.setAttribute('aria-labelledby', tab.id);
  $('#mode-number').textContent = mode.number;
  $('#mode-tag').textContent = mode.tag;
  $('#mode-title').replaceChildren(document.createTextNode(mode.title[0]), document.createElement('br'), document.createTextNode(mode.title[1]));
  $('#mode-description').textContent = mode.description;
  $('#mode-cta').textContent = mode.cta;
  if (focus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectMode(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      selectMode(tabs[next], true);
    }
  });
});

// Booking remains a real contact flow; no unconnected form or implied reservation.
const dialog = $('#booking-dialog');
$$('[data-book]').forEach(button=>button.dataset.analyticsTarget='booking');
$$('[data-book]').forEach(button => button.addEventListener('click', () => {
  setMenu(false);
  let summary = 'Подберём симулятор и удобное время для заезда.';
  if (button.hasAttribute('data-config-book')) {
    const tariff = tariffs[selection.tariff];
    summary = tariff.label + ' · ' + durationLabels[selection.duration] + (vrToggle.checked ? ' · с VR' : '') + ' · ' + formatPrice(selectedPrice()) + ' ₽ за одного участника. Согласуем свободное время по телефону или в приложении.';
  } else if (button.dataset.purpose === 'company') {
    summary = 'Расскажи, сколько вас будет и когда хотите приехать. Поможем спланировать общий заезд и согласуем стоимость.';
  } else if (drivePanel.contains(button)) {
    summary = modes[activeMode].booking;
  }
  $('#booking-selection').textContent = summary;
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('modal-open');
}));
$('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
    dialog.close();
  }
});
dialog.addEventListener('close', () => document.body.classList.remove('modal-open'));

// Content starts visible. Only off-screen elements receive an entrance transition.
const revealElements = $$('.reveal');
let revealObserver;
function showAllReveals() {
  revealObserver?.disconnect();
  revealElements.forEach(element => {
    element.classList.remove('is-pending');
    element.classList.add('is-visible');
  });
}
if ('IntersectionObserver' in window && !reducedMotion.matches) {
  revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      entry.target.classList.remove('is-pending');
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });
  revealElements.forEach(element => {
    if (element.getBoundingClientRect().top >= window.innerHeight) {
      element.classList.add('is-pending');
      revealObserver.observe(element);
    } else {
      element.classList.add('is-visible');
    }
  });
} else {
  showAllReveals();
}
reducedMotion.addEventListener('change', event => {
  if (event.matches) showAllReveals();
});

const mobileBook = $('.mobile-book');
const hero = $('.hero');
function setMobileBooking(visible) {
  mobileBook.classList.toggle('is-visible', visible);
  mobileBook.inert = !visible;
  mobileBook.setAttribute('aria-hidden', String(!visible));
}
setMobileBooking(false);
if ('IntersectionObserver' in window) {
  const bookingObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      setMobileBooking(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
    });
  });
  bookingObserver.observe(hero);
} else {
  setMobileBooking(true);
}


// Keep later useful features without changing the restored landing composition.
document.addEventListener('autosim:book',()=>{$('[data-book]').click();});
if(location.hash==='#plan'||location.hash.startsWith('#plan?'))location.replace('/visit.html?v=23'+location.hash);
