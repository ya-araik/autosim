const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const safe = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

/** Flat screen geometry. Centimetres, diagonal inches, horizontal/vertical FOV. */
export function screenGeometry(diagonal = 55, distance = 80) {
  const inches = [49, 55, 65].includes(Number(diagonal)) ? Number(diagonal) : 55;
  const ratio = inches === 49 ? 32 / 9 : 16 / 9;
  const height = inches * 2.54 / Math.hypot(ratio, 1), width = height * ratio;
  const eyeDistance = clamp(safe(distance, 80), 50, 140);
  return { width, height, distance: eyeDistance,
    horizontal: 2 * Math.atan(width / (2 * eyeDistance)) * 180 / Math.PI,
    vertical: 2 * Math.atan(height / (2 * eyeDistance)) * 180 / Math.PI };
}

/** An illustrative signal, not measured motor torque or a hardware command. */
export function feedbackSample(time, surface = 'asphalt', strength = .6) {
  const t = safe(time), gain = clamp(safe(strength, .6), 0, 1);
  const base = .17 * Math.sin(t * 2.1) + .05 * Math.sin(t * 6.2);
  if (surface === 'kerb') {
    const envelope = Math.pow((Math.sin(t * 2.8) + 1) / 2, 3);
    return gain * clamp(base + .72 * envelope * Math.sin(t * 39), -.96, .96);
  }
  if (surface === 'slide') {
    const phase = ((t % 3) + 3) % 3;
    const loaded = Math.sin(Math.PI * Math.min(phase / 1.8, 1)) * .78;
    const release = 1 / (1 + Math.exp((phase - 1.28) * 17));
    return gain * (loaded * release - .10 * Math.sin(t * 11) * (1 - release));
  }
  return gain * (base + .045 * Math.sin(t * 73) + .024 * Math.sin(t * 119));
}

export function brakeAccuracy(pressure, target, tolerance = 2) {
  const error = clamp(safe(pressure), 0, 100) - clamp(safe(target, 65), 0, 100);
  return { error, within: Math.abs(error) <= tolerance, direction: error < 0 ? 'more' : error > 0 ? 'less' : 'exact' };
}

export function reactionOutcome(phase, goAt, now) {
  if (phase === 'countdown' || phase === 'waiting') return { kind: 'false', milliseconds: null };
  if (phase !== 'go') return { kind: 'ignore', milliseconds: null };
  const milliseconds = Math.round(Math.max(0, safe(now) - safe(goAt)));
  return { kind: milliseconds < 100 ? 'anticipation' : 'valid', milliseconds };
}

export function initClubEngineering(root) {
  if (!root || root.dataset.ceReady === 'true') return;
  root.dataset.ceReady = 'true';
  const get = selector => root.querySelector(selector);
  const all = selector => [...root.querySelectorAll(selector)];
  const tabs = all('[role="tab"]'), panels = all('[role="tabpanel"]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let active = 0, visible = false, discovered = false, destroyed = false;
  let surface = 'asphalt', intensity = .6, signalPlaying = !reduced.matches, signalPhase = 0, signalFrame = 0, signalTime = 0;
  let target = 65, goalIndex = 0, brakeTimer = 0, brakeSucceeded = false;
  let screen = 55, reactionPhase = 'idle', goAt = 0, best = null;
  const reactionTimers = new Set();
  const listeners = [];
  const listen = (element, type, listener) => { element.addEventListener(type, listener); listeners.push([element, type, listener]); };
  const displayNumber = value => value.toFixed(1).replace('.', ',');
  function discovery() {
    if (discovered) return;
    discovered = true;
    document.dispatchEvent(new CustomEvent('autosim:discovery', { detail: { key: 'engineering' } }));
  }
  function rangePaint(input) {
    input.style.setProperty('--ce-fill', ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100) + '%');
  }
  all('input[type="range"]').forEach(input => {
    rangePaint(input);
    listen(input, 'input', () => { rangePaint(input); discovery(); });
  });
  function stopSignal() { cancelAnimationFrame(signalFrame); signalFrame = 0; signalTime = 0; }
  function drawSignal() {
    let path = '';
    for (let i = 0; i <= 220; i++) {
      const x = 62 + i / 220 * 561, y = 219 - feedbackSample(signalPhase + i / 220 * 3, surface, intensity) * 127;
      path += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
    }
    get('[data-ce-signal]').setAttribute('d', path);
    get('[data-ce-signal-shadow]').setAttribute('d', path);
    get('[data-ce-signal-dot]').setAttribute('cy', String(219 - feedbackSample(signalPhase + 3, surface, intensity) * 127));
  }
  const shouldAnimate = () => !destroyed && active === 1 && visible && !document.hidden && signalPlaying && !reduced.matches;
  function animateSignal(now) {
    signalFrame = 0;
    if (!shouldAnimate()) return;
    if (!signalTime || now - signalTime >= 32) {
      signalPhase += signalTime ? Math.min(.08, (now - signalTime) / 1000) : 0;
      signalTime = now; drawSignal();
    }
    signalFrame = requestAnimationFrame(animateSignal);
  }
  function syncSignal() {
    const toggle = get('[data-ce-signal-toggle]');
    toggle.disabled = reduced.matches;
    toggle.setAttribute('aria-pressed', String(signalPlaying && !reduced.matches));
    toggle.querySelector('span').textContent = reduced.matches ? 'Статичная схема' : signalPlaying ? 'Остановить график' : 'Пустить график';
    toggle.querySelector('path').setAttribute('d', signalPlaying ? 'M7 4V16M13 4V16' : 'M6 3 15 10 6 17Z');
    if (shouldAnimate()) { if (!signalFrame) signalFrame = requestAnimationFrame(animateSignal); }
    else stopSignal();
  }
  function cancelBrakeHold() {
    clearTimeout(brakeTimer); brakeTimer = 0;
    const status = get('[data-ce-brake-status]');
    if (status.dataset.status === 'hold') {
      status.dataset.status = 'seek';
      status.textContent = 'Удержание прервано. Сдвинь педаль и попади в цель ещё раз.';
    }
  }
  function stopReaction(message = 'Попытка остановлена. Начни ещё раз, когда будешь готов.') {
    reactionTimers.forEach(clearTimeout); reactionTimers.clear();
    if (reactionPhase !== 'idle' && reactionPhase !== 'done') {
      reactionPhase = 'idle';
      get('[data-ce-reaction-status]').textContent = message;
      get('[data-ce-reaction-value]').innerHTML = '—<span>мс</span>';
    }
    get('[data-ce-reaction-start]').disabled = false;
    get('[data-ce-react]').disabled = true;
    get('.ce-reaction-stage').dataset.state = reactionPhase;
    all('.ce-start-lights i').forEach(light => light.classList.remove('is-on'));
  }
  function activate(index, focus = false) {
    const next = clamp(index, 0, 4);
    if (active !== next) { cancelBrakeHold(); stopReaction(); }
    active = next;
    tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === active)); tab.tabIndex = i === active ? 0 : -1; panels[i].hidden = i !== active; });
    get('[data-ce-page]').textContent = String(active + 1).padStart(2, '0');
    if (focus) tabs[active].focus({ preventScroll: true });
    tabs[active].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    syncSignal();
  }
  tabs.forEach((tab, index) => {
    listen(tab, 'click', () => activate(index));
    listen(tab, 'keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); activate(next, true); }
    });
  });

  const parts = {
    base: { title: 'Прямая связь.<br>Буквально.', label: 'База Direct Drive', number: '01', copy: 'В базе Direct Drive руль соединён с валом двигателя. Изменение усилия приходит в ладони: можно почувствовать нагрузку в повороте и момент потери сцепления.' },
    wheel: { title: 'Всё нужное.<br>Под пальцами.', label: 'Руль и переключатели', number: '02', copy: 'Хват помогает удерживать точный угол, а подрулевые лепестки — менять передачи, не отпуская обод. Руки заняты траекторией, взгляд остаётся на дороге.' },
    pedals: { title: 'Миллиметры.<br>Большая разница.', label: 'Педальный узел', number: '03', copy: 'Педали превращают движения ног в понятные машине команды. Плавная дозировка тормоза и газа помогает повторять удачные действия из поворота в поворот.' },
    screen: { title: 'Точка зрения<br>меняет всё.', label: 'Экран и посадка', number: '04', copy: 'Экран, расстояние до него и положение кресла работают вместе. Правильный масштаб помогает оценивать расстояние до апекса и замечать изменение траектории.' },
  };
  all('[data-ce-part]').forEach(hotspot => {
    function select() {
      const name = hotspot.dataset.cePart, part = parts[name];
      const changed = hotspot.getAttribute('aria-pressed') !== 'true';
      all('[data-ce-part]').forEach(item => item.setAttribute('aria-pressed', String(item === hotspot)));
      get('[data-ce-part-title]').innerHTML = part.title;
      get('[data-ce-part-copy]').textContent = part.copy;
      get('[data-ce-part-label]').textContent = part.label;
      get('[data-ce-part-number]').textContent = part.number + ' / 04';
      if (changed) discovery();
    }
    listen(hotspot, 'click', select);
    listen(hotspot, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
  });
  listen(get('#ce-explode'), 'input', event => {
    const amount = Number(event.target.value) / 100;
    const offsets = { screen: [25, -45], pedals: [36, 28], base: [12, -28], wheel: [-41, -12] };
    all('[data-ce-layer]').forEach(layer => { const [x, y] = offsets[layer.dataset.ceLayer]; layer.setAttribute('transform', `translate(${x * amount} ${y * amount})`); });
    get('#ce-explode-value').textContent = event.target.value + '%';
  });
  const surfaceCaptions = { asphalt: 'Мелкая фактура под ровной нагрузкой.', kerb: 'Отдельные импульсы от ритма поребрика.', slide: 'Нагрузка нарастает и падает при срыве сцепления.' };
  all('[data-ce-surface]').forEach(button => listen(button, 'click', () => {
    const changed = surface !== button.dataset.ceSurface;
    surface = button.dataset.ceSurface;
    all('[data-ce-surface]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    get('[data-ce-surface-caption]').textContent = surfaceCaptions[surface];
    signalPhase = 0; drawSignal(); if (changed) discovery();
  }));
  listen(get('#ce-force'), 'input', event => { intensity = Number(event.target.value) / 100; get('#ce-force-value').textContent = event.target.value + '%'; drawSignal(); });
  listen(get('[data-ce-signal-toggle]'), 'click', () => { signalPlaying = !signalPlaying; syncSignal(); discovery(); });
  drawSignal();

  function updateBrake(userInput = false) {
    const pressure = Number(get('#ce-brake').value), result = brakeAccuracy(pressure, target);
    get('#ce-brake-value').textContent = pressure + '%';
    get('[data-ce-brake-number]').innerHTML = pressure + '<tspan class="ce-brake-unit">%</tspan>';
    get('[data-ce-brake-arc]').setAttribute('stroke-dasharray', pressure + ' 100');
    get('[data-ce-brake-target]').setAttribute('transform', 'rotate(' + (-90 + target * 1.8) + ' 340 294)');
    get('[data-ce-pedal]').setAttribute('transform', 'rotate(' + (-18 + pressure * .30) + ' 294 336)');
    get('[data-ce-brake-goal]').innerHTML = target + '<span>%</span>';
    const status = get('[data-ce-brake-status]');
    if (!result.within) {
      cancelBrakeHold(); brakeSucceeded = false;
      status.dataset.status = 'seek';
      status.textContent = result.error < 0 ? 'Добавь ' + Math.abs(result.error) + ' пунктов до цели.' : 'Отпусти на ' + result.error + ' пунктов. Точность важнее силы.';
    } else if (!brakeSucceeded && !brakeTimer && userInput && active === 2 && visible && !document.hidden) {
      status.dataset.status = 'hold'; status.textContent = 'Точно. Удержи это нажатие одну секунду.';
      brakeTimer = window.setTimeout(() => {
        brakeTimer = 0;
        if (active !== 2 || !visible || document.hidden || !brakeAccuracy(get('#ce-brake').value, target).within) { cancelBrakeHold(); return; }
        brakeSucceeded = true; status.dataset.status = 'success';
        const error = Math.abs(Number(get('#ce-brake').value) - target);
        status.textContent = 'Есть. Отклонение ' + error + ' п. Попробуй повторить с новой целью.';
      }, 1000);
    }
  }
  listen(get('#ce-brake'), 'input', () => updateBrake(true));
  listen(get('[data-ce-new-target]'), 'click', () => {
    const goals = [42, 78, 56, 34, 71, 63, 47, 82];
    target = goals[goalIndex++ % goals.length]; cancelBrakeHold(); brakeSucceeded = false;
    updateBrake(true); discovery();
  });
  updateBrake();

  function updateFov() {
    const geometry = screenGeometry(screen, get('#ce-distance').value);
    const scale = 2.08, y = 362 - geometry.distance * scale, left = 340 - geometry.width * scale / 2, right = 340 + geometry.width * scale / 2;
    get('[data-ce-hfov]').innerHTML = displayNumber(geometry.horizontal) + '<span>°</span>';
    get('[data-ce-vfov]').textContent = displayNumber(geometry.vertical) + '°';
    get('[data-ce-screen-size]').textContent = Math.round(geometry.width) + ' × ' + Math.round(geometry.height) + ' см';
    get('#ce-distance-value').textContent = geometry.distance + ' см';
    get('[data-ce-fov-area]').setAttribute('d', `M340 362 ${left} ${y} ${right} ${y}Z`);
    get('[data-ce-fov-screen]').setAttribute('d', `M${left} ${y}H${right}`);
    get('[data-ce-fov-distance]').setAttribute('d', `M548 ${y}V362M543 ${y}H553M543 362H553`);
    get('[data-ce-fov-distance-text]').setAttribute('x', '561');
    get('[data-ce-fov-distance-text]').setAttribute('y', String((y + 362) / 2 + 4));
    get('[data-ce-fov-distance-text]').textContent = geometry.distance + ' СМ';
    get('[data-ce-fov-width]').setAttribute('y', String(y - 18));
    get('[data-ce-fov-width]').textContent = Math.round(geometry.width) + ' СМ';
    const radians = geometry.horizontal * Math.PI / 360, dx = Math.sin(radians) * 49, dy = Math.cos(radians) * 49;
    get('[data-ce-fov-arc]').setAttribute('d', `M${340 - dx} ${362 - dy}A49 49 0 0 1 ${340 + dx} ${362 - dy}`);
  }
  all('[data-ce-screen]').forEach(button => listen(button, 'click', () => {
    const changed = screen !== Number(button.dataset.ceScreen);
    screen = Number(button.dataset.ceScreen);
    all('[data-ce-screen]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    updateFov(); if (changed) discovery();
  }));
  listen(get('#ce-distance'), 'input', updateFov); updateFov();

  try { const saved = Number(localStorage.getItem('autosim.reaction.v1')); if (saved >= 100 && saved < 10000) best = saved; } catch { /* Local record is optional. */ }
  const showBest = () => { get('[data-ce-reaction-best]').innerHTML = (best ?? '—') + '<small>мс</small>'; };
  showBest();
  function later(fn, delay) {
    const timer = window.setTimeout(() => { reactionTimers.delete(timer); if (visible && !document.hidden && active === 4) fn(); else stopReaction(); }, delay);
    reactionTimers.add(timer);
  }
  listen(get('[data-ce-reaction-start]'), 'click', () => {
    stopReaction(); discovery();
    const stage = get('.ce-reaction-stage');
    const bounds = stage.getBoundingClientRect();
    const headerBottom = (document.querySelector('.header')?.getBoundingClientRect().bottom || 0) + 12;
    if (bounds.top < headerBottom || bounds.bottom > window.innerHeight - 12) {
      const desiredTop = Math.max(headerBottom, (window.innerHeight - bounds.height) / 2);
      window.scrollBy({ top: bounds.top - desiredTop, behavior: 'instant' });
    }
    reactionPhase = 'countdown'; get('.ce-reaction-stage').dataset.state = reactionPhase;
    get('[data-ce-reaction-start]').disabled = true; get('[data-ce-react]').disabled = false;
    get('[data-ce-reaction-value]').innerHTML = '—<span>мс</span>';
    get('[data-ce-reaction-status]').textContent = 'Дождись, пока все огни погаснут.';
    get('[data-ce-react]').focus({ preventScroll: true });
    const lights = all('.ce-start-lights i');
    lights.forEach((light, index) => later(() => {
      light.classList.add('is-on');
      if (index === 4) reactionPhase = 'waiting';
    }, 400 + index * 520));
    const hold = 1100 + Math.random() * 2200;
    later(() => {
      lights.forEach(light => light.classList.remove('is-on'));
      reactionPhase = 'go'; goAt = performance.now();
      get('.ce-reaction-stage').dataset.state = 'go';
      get('[data-ce-reaction-status]').textContent = 'Сейчас.';
      later(() => {
        if (reactionPhase !== 'go') return;
        reactionPhase = 'done'; get('.ce-reaction-stage').dataset.state = 'done';
        get('[data-ce-reaction-status]').textContent = 'Огни уже погасли. Попробуй ещё раз.';
        get('[data-ce-react]').disabled = true; get('[data-ce-reaction-start]').disabled = false;
      }, 7000);
    }, 400 + 4 * 520 + hold);
  });
  function react() {
    const result = reactionOutcome(reactionPhase, goAt, performance.now());
    if (result.kind === 'ignore') return;
    reactionTimers.forEach(clearTimeout); reactionTimers.clear();
    reactionPhase = 'done';
    all('.ce-start-lights i').forEach(light => light.classList.remove('is-on'));
    get('[data-ce-reaction-start]').disabled = false;
    get('[data-ce-reaction-start]').firstChild.textContent = 'Попробовать ещё раз';
    get('[data-ce-react]').disabled = true;
    const stage = get('.ce-reaction-stage'), value = get('[data-ce-reaction-value]'), status = get('[data-ce-reaction-status]');
    if (result.kind === 'false') {
      stage.dataset.state = 'false'; value.textContent = 'Фальстарт';
      status.textContent = 'Рано. Дождись, пока погаснут все пять огней.';
    } else if (result.kind === 'anticipation') {
      stage.dataset.state = 'done'; value.innerHTML = result.milliseconds + '<span>мс</span>';
      status.textContent = 'Похоже на угадывание. Повтори, дождавшись сигнала.';
    } else {
      stage.dataset.state = 'done'; value.innerHTML = result.milliseconds + '<span>мс</span>';
      const record = !best || result.milliseconds < best;
      if (record) { best = result.milliseconds; showBest(); try { localStorage.setItem('autosim.reaction.v1', String(best)); } catch { /* No storage is also supported. */ } }
      status.textContent = record ? 'Личный рекорд. Попробуй повторить этот момент.' : result.milliseconds < 400 ? 'Сигнал пойман. Следующая попытка — на повторяемость.' : 'Сигнал пойман. Подготовь палец и смотри на огни.';
    }
  }
  listen(get('[data-ce-react]'), 'pointerdown', event => { if (event.button === 0) { event.preventDefault(); react(); } });
  listen(get('[data-ce-react]'), 'keydown', event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); react(); } });
  listen(get('[data-ce-react]'), 'click', event => { if (event.detail === 0) react(); });

  const intersection = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (!visible) { cancelBrakeHold(); stopReaction(); }
    syncSignal();
  }) : null;
  if (intersection) intersection.observe(get('[data-ce-instrument]'));
  else visible = true;
  listen(document, 'visibilitychange', () => { if (document.hidden) { cancelBrakeHold(); stopReaction(); } syncSignal(); });
  listen(reduced, 'change', () => { if (reduced.matches) signalPlaying = false; syncSignal(); });
  syncSignal();
  return { activate, destroy() { destroyed = true; intersection?.disconnect(); stopSignal(); cancelBrakeHold(); stopReaction(); listeners.forEach(([element, type, listener]) => element.removeEventListener(type, listener)); } };
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('engineering');
  if (root && 'IntersectionObserver' in window) {
    const lazy = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { lazy.disconnect(); initClubEngineering(root); } }, { rootMargin: '250px 0px' });
    lazy.observe(root);
  } else if (root) initClubEngineering(root);
}
