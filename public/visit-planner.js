import { TARIFF_NAMES, INTENTS, VR_PRICES, validState, defaultState, localParts, addDays, quote, recommendation, timeline, validatePlan, availableTimes, shareHash, parseShare, buildICS } from './visit-math.js';

const root = document.querySelector('#visit-planner');
if (root) initialisePlanner(root);

function initialisePlanner(root) {
  const $ = selector => root.querySelector(selector);
  const $$ = selector => [...root.querySelectorAll(selector)];
  const money = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
  const durationText = value => value === 30 ? '30 минут' : value === 60 ? '1 час' : '2 часа';
  const dateText = date => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
  const shortDate = date => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
  const initialShare = parseShare(location.hash);
  let state = initialShare || defaultState();
  let currentError = '';
  let dateDraftInvalid = false;
  let pilot = '';
  let discovered = false;
  const form = $('#vp-form');
  const dateInput = $('#vp-date');
  const timeInput = $('#vp-time');
  const peopleInput = $('#vp-people');
  const vrInput = $('#vp-vr');
  const status = $('#vp-status');
  const exportButtons = ['#vp-share', '#vp-calendar', '#vp-copy', '#vp-print'].map($);
  const allowedFields = ['tariff', 'people', 'duration', 'vr', 'intent', 'experience', 'manual', 'date', 'time', 'after'];
  const safeCopy = source => Object.fromEntries(allowedFields.map(key => [key, source[key]]));
  function markUsed() {
    if (discovered) return;
    discovered = true;
    document.dispatchEvent(new CustomEvent('autosim:discovery', { detail: { key: 'visit' } }));
  }

  function message(text) { status.textContent = text; }
  function chooseSuggested() {
    state.tariff = recommendation(state.intent, state.experience).tariff;
    state.manual = false;
  }
  function updateTimeChoices(adjustTime) {
    const now = new Date();
    const today = localParts(now).date;
    dateInput.min = today;
    dateInput.max = addDays(today, 365);
    const times = availableTimes(state, now);
    if (adjustTime && times.length && !times.includes(state.time)) {
      const previous = state.time;
      const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      state.time = times.reduce((nearest, time) => Math.abs(minutes(time) - minutes(previous)) < Math.abs(minutes(nearest) - minutes(previous)) ? time : nearest);
      message('Время изменено на ' + state.time + ', чтобы заезд укладывался в часы работы.');
    }
    const options = times.map(time => {
      const option = document.createElement('option');
      option.value = time;
      option.textContent = time + (time < '02:00' ? ' · ночью' : '');
      return option;
    });
    if (!times.includes(state.time)) {
      const missing = document.createElement('option');
      missing.value = state.time;
      missing.textContent = state.time + ' · нужно изменить';
      options.unshift(missing);
    }
    timeInput.replaceChildren(...options);
    timeInput.value = state.time;
  }
  function makeTimeline() {
    const plan = timeline(state);
    const afterClosing = localParts(plan.finish).time === '02:00';
    const items = [
      { at: plan.arrival, title: 'Приходите чуть раньше', note: '10 минут на посадку и настройку' },
      { at: plan.start, title: 'Общий старт', note: durationText(state.duration) + ' за рулём' },
      { at: plan.finish, title: 'Финиш', note: state.after ? (afterClosing ? 'Обсудите гонку после выхода из клуба' : 'Ещё 10 минут на впечатления') : 'Вечер продолжается' }
    ];
    if (state.after) items.push({ at: plan.end, title: 'До следующего заезда', note: afterClosing ? 'Обсуждение — за пределами клуба' : 'План вечера завершён' });
    const nodes = items.map(item => {
      const li = document.createElement('li');
      const dot = document.createElement('span'); dot.className = 'vp-time-dot'; dot.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = item.title;
      const note = document.createElement('small'); note.textContent = item.note;
      copy.append(title, note);
      const when = document.createElement('time'); when.dateTime = item.at.toISOString();
      const parts = localParts(item.at); when.append(document.createTextNode(parts.time));
      const day = document.createElement('small'); day.textContent = shortDate(parts.date); when.append(day);
      li.append(dot, copy, when); return li;
    });
    $('#vp-timeline').replaceChildren(...nodes);
    const totalMinutes = 10 + state.duration + (state.after ? 10 : 0);
    $('#vp-visit-duration').textContent = (Math.floor(totalMinutes / 60) ? Math.floor(totalMinutes / 60) + ' ч ' : '') + (totalMinutes % 60 ? totalMinutes % 60 + ' мин' : '');
  }
  function render(adjustTime = false) {
    if (!validState(state)) return;
    updateTimeChoices(adjustTime);
    const suggested = recommendation(state.intent, state.experience);
    $$('[name="vp-intent"]').forEach(input => { input.checked = input.value === state.intent; });
    $$('[name="vp-tariff"]').forEach(input => { input.checked = input.value === state.tariff; });
    $$('[name="vp-duration"]').forEach(input => { input.checked = Number(input.value) === state.duration; });
    $('#vp-experience').value = state.experience;
    peopleInput.value = state.people;
    if (!dateDraftInvalid) dateInput.value = state.date;
    vrInput.checked = state.vr;
    vrInput.disabled = state.people > 5;
    $('#vp-after').checked = state.after;
    $('#vp-less').disabled = state.people === 1;
    $('#vp-more').disabled = state.people === 7;
    $('#vp-choice-note').textContent = state.manual ? 'Твой выбор' : 'По рекомендации';
    $('#vp-recommendation').textContent = 'Тебе подойдёт ' + TARIFF_NAMES[suggested.tariff];
    $('#vp-reason').textContent = suggested.reason;
    $('#vp-apply-advice').hidden = state.tariff === suggested.tariff && !state.manual;
    $('#vp-vr-price').textContent = state.duration === 120 ? '+800 ₽ на участника · 2 × 400 ₽/ч' : '+' + money(VR_PRICES[state.duration]) + ' на участника';
    $('#vp-vr-limit').textContent = state.people > 5 ? 'Для компании 6–7 человек выбери заезд на мониторах. Общий VR — до 5 участников.' : 'Общий VR-заезд — до 5 участников.';
    const price = quote(state);
    $('#vp-pass-time').textContent = state.time;
    $('#vp-pass-date').textContent = dateText(state.date);
    $('#vp-pass-tariff').textContent = TARIFF_NAMES[state.tariff];
    $('#vp-pass-people').textContent = String(state.people).padStart(2, '0');
    $('#vp-pass-duration').textContent = state.duration + ' мин';
    $('#vp-pass-format').textContent = state.vr ? 'VR' : 'Монитор';
    $('#vp-price-each').textContent = money(price.each);
    $('#vp-price-total').textContent = money(price.total);
    $('#vp-price-formula').textContent = state.people + ' × ' + (price.vr ? '(' + money(price.base) + ' + ' + money(price.vr) + ' VR)' : money(price.each));
    makeTimeline();
    currentError = dateDraftInvalid ? 'Выбери корректную дату старта.' : validatePlan(state);
    $('#vp-error').textContent = currentError;
    $('#vp-error').hidden = !currentError;
    dateInput.setAttribute('aria-invalid', String(dateDraftInvalid || (!!currentError && (state.date < dateInput.min || state.date > dateInput.max))));
    timeInput.setAttribute('aria-invalid', String(!!currentError));
    exportButtons.forEach(button => { button.disabled = !!currentError; });
    $('#vp-pass').classList.toggle('vp-pass-invalid', !!currentError);
    $('#vp-copy-fallback').hidden = true;
    if (!dateDraftInvalid) document.dispatchEvent(new CustomEvent('autosim:visit-state', { detail: safeCopy(state) }));
  }
  function setPeople(value) {
    markUsed();
    if (!Number.isFinite(value)) value = state.people;
    state.people = Math.min(7, Math.max(1, Math.round(value)));
    if (state.people > 5 && state.vr) {
      state.vr = false;
      message('Для компании больше 5 человек выбраны мониторы. Стоимость пересчитана.');
    }
    render();
  }
  form.addEventListener('submit', event => event.preventDefault());
  peopleInput.addEventListener('input', () => {
    const value=Number(peopleInput.value);
    if (peopleInput.value!=='' && Number.isInteger(value) && value>=1 && value<=7) setPeople(value);
  });
  form.addEventListener('change', event => {
    const target = event.target;
    if (target.name === 'vp-intent') { state.intent = target.value; if (!state.manual) chooseSuggested(); }
    else if (target.id === 'vp-experience') { state.experience = target.value; if (!state.manual) chooseSuggested(); }
    else if (target.name === 'vp-tariff') { state.tariff = target.value; state.manual = true; }
    else if (target.name === 'vp-duration') state.duration = Number(target.value);
    else if (target.id === 'vp-people') { setPeople(target.value === '' ? state.people : Number(target.value)); return; }
    else if (target.id === 'vp-vr') state.vr = target.checked && state.people <= 5;
    else if (target.id === 'vp-after') state.after = target.checked;
    else if (target.id === 'vp-date') {
      if (!target.value || !validState({ ...state, date: target.value })) {
        dateDraftInvalid = true;
        $('#vp-error').textContent = 'Выбери дату старта.'; $('#vp-error').hidden = false;
        currentError = 'Выбери дату старта.'; target.setAttribute('aria-invalid', 'true');
        exportButtons.forEach(button => { button.disabled = true; }); return;
      }
      dateDraftInvalid = false;
      state.date = target.value;
    }
    else if (target.id === 'vp-time') state.time = target.value;
    else return;
    markUsed();
    render(target.id === 'vp-date' || target.name === 'vp-duration');
  });
  $('#vp-less').addEventListener('click', () => setPeople(state.people - 1));
  $('#vp-more').addEventListener('click', () => setPeople(state.people + 1));
  $('#vp-apply-advice').addEventListener('click', () => { markUsed(); chooseSuggested(); render(); message('Выбран ' + TARIFF_NAMES[state.tariff] + ' по твоему сценарию.'); });

  function planLink() {
    const url = new URL(location.href);
    url.search = '';
    url.hash = shareHash(state);
    return url.href;
  }
  function summary(includeLink = false) {
    const price = quote(state), plan = timeline(state);
    const arrival = localParts(plan.arrival), finish = localParts(plan.finish), end = localParts(plan.end);
    return [
      'Автосим — план визита' + (pilot ? ' · ' + pilot : ''),
      'План не является бронью. Симуляторы и время нужно подтвердить в клубе.',
      INTENTS[state.intent] + '.',
      'Старт: ' + dateText(state.date) + ' ' + state.date.slice(0, 4) + ', ' + state.time + ' (Оренбург, UTC+5).',
      'Подготовка: ' + shortDate(arrival.date) + ', ' + arrival.time + '. Финиш: ' + shortDate(finish.date) + ', ' + finish.time + '.',
      state.after ? '10 минут на впечатления до ' + shortDate(end.date) + ', ' + end.time + (finish.time === '02:00' ? ' — после выхода из клуба.' : '.') : '',
      TARIFF_NAMES[state.tariff] + ' · ' + durationText(state.duration) + ' · ' + state.people + ' участн. · ' + (state.vr ? 'VR для каждого.' : 'На мониторах.'),
      'Стоимость: ' + money(price.each) + ' каждому, ' + money(price.total) + ' всей компании.' + (state.vr && state.duration === 120 ? ' VR: 2 × 400 ₽/ч на участника.' : ''),
      'Оренбург, Рыбаковская, 59. Согласовать визит: +7 (951) 030-88-56.',
      includeLink ? planLink() : ''
    ].filter(Boolean).join('\n');
  }
  function exportReady() {
    if (!dateInput.value) { message('Сначала выбери дату старта.'); dateInput.focus(); return false; }
    const error = validatePlan(state);
    if (error) { render(); message(error); return false; }
    return true;
  }
  async function copy(text, success) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      message(success);
    } catch {
      $('#vp-copy-fallback').hidden = false;
      const field = $('#vp-copy-text'); field.value = text; field.focus(); field.select();
      message('Браузер не дал доступ к буферу. Текст выделен — скопируй его вручную.');
    }
  }
  $('#vp-share').addEventListener('click', async () => {
    if (!exportReady()) return;
    const url = planLink();
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: 'Наш вечер в Автосим', text: 'План заезда: ' + dateText(state.date) + ', ' + state.time + '. Время ещё нужно подтвердить в клубе.', url }); message('План передан в меню «Поделиться».'); return; }
      catch (error) { if (error.name === 'AbortError') return; }
    }
    await copy(url, 'Ссылка скопирована. В ней сохранены все параметры этого плана.');
  });
  $('#vp-copy').addEventListener('click', () => { if (exportReady()) copy(summary(true), 'План и ссылка скопированы. Можно отправить компании.'); });
  $('#vp-calendar').addEventListener('click', () => {
    if (!exportReady()) return;
    const content = buildICS(state, summary(false));
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'autosim-plan-' + state.date + '.ics';
    root.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    message('Файл календаря скачан. Событие начинается за 10 минут до заезда; бронь нужно подтвердить.');
  });
  $('#vp-print').addEventListener('click', () => {
    if (!exportReady()) return;
    document.body.classList.add('vp-printing');
    window.print();
  });
  window.addEventListener('afterprint', () => document.body.classList.remove('vp-printing'));
  function showSharedPlan() {
    root.scrollIntoView({ behavior: 'instant', block: 'start' });
    $('#vp-title').focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', () => {
    const incoming = parseShare(location.hash);
    if (!incoming) return;
    dateDraftInvalid = false; state = incoming; render();
    message('Открыт план по ссылке. Время и симуляторы ещё нужно подтвердить.');
    showSharedPlan();
  });
  document.addEventListener('autosim:configure-visit', event => {
    const detail = event.detail;
    if (!detail || !['standard', 'pro', 'vip'].includes(detail.tariff) || ![30, 60, 120].includes(detail.duration) || typeof detail.vr !== 'boolean') return;
    state = { ...state, tariff: detail.tariff, duration: detail.duration, vr: detail.vr && state.people <= 5, manual: true };
    markUsed();
    render(true); message('Симулятор и длительность перенесены. Добавь компанию и удобное время.');
  });
  document.addEventListener('autosim:restore-visit', event => {
    if (!validState(event.detail) || (event.detail.vr && event.detail.people > 5)) return;
    dateDraftInvalid = false; state = safeCopy(event.detail); render(); message('Твой сохранённый план восстановлен.');
  });
  document.addEventListener('autosim:visit-state-request', () => {
    if (!dateDraftInvalid && validState(state)) document.dispatchEvent(new CustomEvent('autosim:visit-state', { detail: safeCopy(state) }));
  });
  function applyIdentity(detail) {
    const callsign = detail?.callsign;
    if (typeof callsign !== 'string') return;
    pilot = callsign.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
    let field = $('#vp-pilot');
    if (!field) { field = document.createElement('span'); field.id = 'vp-pilot'; field.className = 'vp-pilot'; $('.vp-pass-intro>p').append(field); }
    field.textContent = pilot; field.hidden = !pilot;
    const accent = ({ signal: '#fc703b', cobalt: '#91b8ff', silver: '#d4d5d8' })[detail?.accent] || detail?.accent;
    if (typeof accent === 'string' && /^#[0-9a-f]{6}$/i.test(accent)) $('#vp-pass').style.setProperty('--vp-pilot-accent', accent);
  }
  document.addEventListener('autosim:identity', event => applyIdentity(event.detail));
  const identityData = document.documentElement.dataset;
  if (identityData.driverCallsign) applyIdentity({ callsign: identityData.driverCallsign, accent: identityData.driverAccent });
  render();
  if (initialShare) {
    message('Открыт план по ссылке. Время и симуляторы ещё нужно подтвердить.');
    requestAnimationFrame(() => requestAnimationFrame(showSharedPlan));
  } else if (location.hash.startsWith('#visit-planner?')) {
    message('Параметры ссылки не удалось прочитать. Собери новый план.');
  }
  // Revalidate on a new minute so an idle page cannot export a visit in the past.
  setInterval(() => {
    if (!document.hidden && dateInput.value && !form.contains(document.activeElement) && $('#vp-copy-fallback').hidden) render(false);
  }, 60000);
}
