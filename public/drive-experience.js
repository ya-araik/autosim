import { createCarState, stepCar, trackPoint, trackLength, trackClosed, respawnCar } from './drive-physics.js';
import { createDrivingScene } from './drive-scene.js';
import { createEngineAudio } from './drive-audio.js';
import { createThumbControls, interpolatePose } from './drive-controls.js';
import { FINISH_T } from './track-data.js';
import { createRaceResults } from './game-results.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrapAngle = value => Math.atan2(Math.sin(value), Math.cos(value));
const releasePointer=(element,id)=>{try{if(element.hasPointerCapture(id))element.releasePointerCapture(id);}catch{/* WebKit may have cancelled this contact already. */}};
const capturePointer=(element,id)=>{try{element.setPointerCapture(id);}catch{/* Document release listeners still work. */}};
const STEP = 1 / 120;
// Keep both axles inside the open sector, rather than straddling its cut edge.
const createSessionState = () => createCarState({ ...trackPoint(.009) });
const timeLabel = seconds => {
  const tenths = Math.floor(Math.max(0, seconds) * 10);
  return String(Math.floor(tenths / 600)).padStart(2, '0') + ':' +
    String(Math.floor(tenths / 10) % 60).padStart(2, '0') + '.' + tenths % 10;
};

export async function initDrivingExperience() {
  const get = id => document.getElementById(id);
  const dialog = get('drive-dialog');
  const shell = dialog.querySelector('.sim-shell');
  // iOS text selection/callouts can steal a held thumb from the driving surface.
  // Scope protection to the game: site text and account inputs stay selectable.
  const editable = target => target?.closest?.('input:not([type="range"]),textarea,[contenteditable="true"]');
  for (const type of ['selectstart','contextmenu','dragstart']) {
    dialog.addEventListener(type, event => { if (dialog.open && !editable(event.target)) event.preventDefault(); });
  }
  dialog.addEventListener('pointerdown', event => {
    const selection=window.getSelection?.();
    if (!editable(event.target)&&selection&&!selection.isCollapsed) selection.removeAllRanges();
  }, {capture:true});
  for(const type of ['gesturestart','gesturechange'])dialog.addEventListener(type,event=>{if(!editable(event.target)&&event.cancelable)event.preventDefault();},{passive:false});

  const playerMount = get('sim-canvas-mount');
  const wheelPad = get('sim-wheel-pad');
  const wheelRange = get('sim-steering');
  const loading = get('sim-loading');
  const startScreen = get('sim-start-screen');
  const startButton = get('sim-start');
  const pauseButton = get('sim-pause');
  const cruiseButton = get('sim-cruise');
  const modeButtons = [...dialog.querySelectorAll('[data-sim-mode]')];
  const assistButtons = [...dialog.querySelectorAll('[data-assist-mode]')];
  const controlButtons = [...dialog.querySelectorAll('[data-control-style]')];
  const cameraButtons = [...dialog.querySelectorAll('[data-camera]')];
  const revBars = [...dialog.querySelectorAll('.sim-rev-bars i')];
  const pedals = {
    throttle: get('sim-throttle'), brake: get('sim-brake'), handbrake: get('sim-handbrake')
  };
  const heldPointers = { throttle: new Set(), brake: new Set(), handbrake: new Set() };
  const heldPedalKeys = new Set();
  const keys = new Set();
  let scene;
  let sceneLoading;
  let sceneAbort;
  let sceneGeneration = 0;
  let detachSceneEvents = () => {};
  let graphicsLost = false;
  let mode = 'race';
  let assistMode = 'pro';
  let startGeneration = 0;
  let controlStyle = window.matchMedia('(pointer: coarse), (max-width: 700px)').matches ? 'thumbs' : 'wheel';
  let phase = 'ready';
  let camera = 'chase';
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let cameraMotion = !motionPreference.matches;
  const motionToggle = get('sim-camera-motion');
  function paintCameraMotion() { motionToggle?.setAttribute('aria-pressed', String(cameraMotion)); }
  paintCameraMotion();
  motionToggle?.addEventListener('click', () => { cameraMotion = !cameraMotion; paintCameraMotion(); });
  motionPreference.addEventListener?.('change', event => { cameraMotion = !event.matches; paintCameraMotion(); });
  let gearboxMode = 'auto';
  let shiftProgram = 3;
  let shiftRequest = 0;
  let night = true;
  let engineering = false;
  let sound = true;
  let cruise = false;
  let engineAudio;
  let frameId = 0;
  let previousFrame = 0;
  let accumulator = 0;
  let telemetryAt = 0;
  let renderTime = 0;
  let manualSteering = 0;
  let wheelAngle = 0;
  let wheelPointer = null;
  let wheelPointerPolar = 0;
  let keyboardSteering = false;
  let returnFocus;
  let player = createSessionState();
  let previousPose = { ...player };
  let input = { steering: 0, throttle: 0, brake: 0, handbrake: false };
  let lap = 1;
  let nextQuarter = 1;
  let lapStart = 0;
  let lapDistance = 0;
  let driftPoints = 0;
  let best = null;
  let noticeExpires = 0;
  let offTrackNotice = false;
  let sectorFinished = false;
  let sectorValid = true;
  let lastImpactAt = 0;
  let impactNoticed = false;
  let centralTimer = 0, centralPriority = 0;
  const centralAlert = get('sim-central-alert');
  const validityBadge = get('sim-sector-validity');
  const results = createRaceResults({pause, retry(pro) { if(pro)setAssist('pro',true);resetSession();start(); }});
  const thumbControls = createThumbControls({
    steeringPad: get('sim-thumb-steering'), powerPad: get('sim-thumb-power'),
    enabled: () => phase === 'running' && controlStyle === 'thumbs', onShift: requestShift
  });
  try {
    const stored = Number(localStorage.getItem('autosim.m5.sector.v13.' + assistMode));
    if (stored > 0 && Number.isFinite(stored)) best = stored;
  } catch { /* Browsing with storage disabled still supports the whole experience. */ }

  const mapPoints = Array.from({ length: 181 }, (_, index) => trackPoint(index / 180));
  const mapPath = mapPoints.map((point, index) => {
    return (index ? 'L' : 'M') + point.x.toFixed(2) + ' ' + (-point.z).toFixed(2);
  }).join(' ') + (trackClosed ? ' Z' : '');
  const mapMinX = Math.min(...mapPoints.map(p => p.x)), mapMaxX = Math.max(...mapPoints.map(p => p.x));
  const mapMinY = Math.min(...mapPoints.map(p => -p.z)), mapMaxY = Math.max(...mapPoints.map(p => -p.z));
  const mapSize = Math.max(mapMaxX - mapMinX, mapMaxY - mapMinY) * 1.12;
  get('sim-map').setAttribute('viewBox', [ (mapMinX + mapMaxX - mapSize)/2, (mapMinY + mapMaxY - mapSize)/2, mapSize, mapSize ].join(' '));
  get('sim-map-track').setAttribute('stroke-width', String(mapSize * .017));
  get('sim-map-car').setAttribute('r', String(mapSize * .028));
  get('sim-map-track').setAttribute('d', mapPath);
  get('sim-map-guide').setAttribute('d', mapPath);
  get('sim-view').tabIndex = 0;
  get('sim-view').setAttribute('aria-label', 'Заезд. WASD или стрелки: руль, газ и тормоз. Пробел: ручник. P: пауза.');
  get('sim-camera').setAttribute('aria-label', 'Камера: за машиной. Выбрать вид');
  get('sim-night').setAttribute('aria-label', 'Ночной заезд');
  get('sim-engineering').setAttribute('aria-label', 'Показать механику движения');
  get('sim-sound').setAttribute('aria-label', 'Выключить звук двигателя');
  get('sim-sound').setAttribute('aria-pressed', 'true');
  get('sim-night').setAttribute('aria-pressed', 'true');
  cruiseButton?.setAttribute('aria-pressed', 'false');
  cruiseButton?.setAttribute('aria-label', 'Помощь с газом выключена');

  function notice(text, seconds = 5) {
    if (get('sim-notice').textContent !== text) get('sim-notice').textContent = text;
    noticeExpires = seconds ? performance.now() + seconds * 1000 : 0;
  }

  function clearCentralAlert() {
    clearTimeout(centralTimer); centralTimer = 0; centralPriority = 0;
    if (centralAlert) centralAlert.hidden = true;
  }
  function centralNotice(title, detail, seconds = 4, priority = 1) {
    if (!centralAlert || centralPriority > priority) return;
    clearCentralAlert(); centralPriority = priority;
    get('sim-central-title').textContent = title;
    get('sim-central-detail').textContent = detail;
    centralAlert.dataset.severity = priority > 1 ? 'invalid' : 'contact';
    centralAlert.hidden = false;
    centralTimer = setTimeout(clearCentralAlert, seconds * 1000);
  }
  function invalidateSector(reason) {
    const wasValid = sectorValid; sectorValid = false;
    if (mode !== 'race') return;
    if (validityBadge) { validityBadge.hidden = false; get('sim-stat-label').hidden = true; }
    if (wasValid) centralNotice(assistMode === 'pro' ? 'Время не пойдёт в рейтинг' : 'Время не сохранится', reason + ' Для новой попытки нажми «На старт».', 6, 2);
  }

  function audioFailed(audio) {
    if (!audio || audio !== engineAudio) return;
    sound = false;
    audio.suspend();
    audio.dispose?.();
    engineAudio = null;
    get('sim-sound').setAttribute('aria-pressed', 'false');
    get('sim-sound').setAttribute('aria-label', 'Включить звук двигателя');
    notice('Не удалось включить звук. Заезд продолжается без него. Можно попробовать ещё раз.', 7);
  }

  function resumeEngineAudio() {
    if (!engineAudio && sound) {
      try {
        engineAudio = createEngineAudio();
        const created = engineAudio;
        created?.ready?.catch(() => audioFailed(created));
      } catch { engineAudio = null; }
      if (!engineAudio) {
        sound = false;
        get('sim-sound').setAttribute('aria-pressed', 'false');
        notice('Звук недоступен. Его можно включить повторно в настройках.', 6);
      }
    }
    const audio = engineAudio;
    if (audio) audio.resume().catch(() => audioFailed(audio));
  }

  function syncWheel(angle) {
    const rounded = Math.round(angle);
    get('sim-wheel').style.setProperty('--drive-steer', angle.toFixed(2) + 'deg');
    wheelRange.value = String(rounded);
    get('sim-angle').textContent = rounded + '°';
    wheelRange.setAttribute('aria-valuetext', rounded === 0 ? 'Прямо' : Math.abs(rounded) + ' градусов ' + (rounded < 0 ? 'влево' : 'вправо'));
  }

  function releaseControls() {
    thumbControls.release();
    keys.clear();
    heldPedalKeys.clear();
    for (const [name, ids] of Object.entries(heldPointers)) {
      for (const id of ids) {
        releasePointer(pedals[name],id);
      }
      ids.clear();
      pedals[name].classList.remove('is-down');
    }
    if (wheelPointer !== null) releasePointer(wheelPad,wheelPointer);
    wheelPointer = null;
    manualSteering = 0;
    keyboardSteering = false;
    wheelAngle = 0;
    input = { steering: 0, throttle: 0, brake: 0, handbrake: false };
    syncWheel(0);
  }

  function updateStartScreen() {
    const paused = phase === 'paused';
    startScreen.hidden = phase === 'running';
    get('sim-welcome-title').textContent = sectorFinished ? 'Сектор пройден.' : paused ? 'На паузе.' : 'Чёрный. И твой.';
    get('sim-welcome-copy').textContent = paused
      ? 'Можно выдохнуть. Продолжай с того же места, когда будешь готов.'
      : mode === 'drift'
        ? 'Автогаз набирает скорость за тебя. Поверни, коротко нажми ручник и лови занос встречным поворотом руля.'
        : 'Автогаз включён: можно ехать одним рулём. Поворачивай мышью или пальцем. Для ручного газа выключи автогаз.';
    if (!paused) {
      get('sim-welcome-copy').textContent = controlStyle === 'thumbs'
        ? 'Левый палец — руль. Правый: вверх — газ, вниз — тормоз. ' + (gearboxMode === 'auto' ? 'Коробка переключает сама.' : 'Передачи — кнопками + / − или вертикальным жестом слева.')
        : 'W / S — газ и тормоз. A / D — руль. Q / E — передачи. SMG может переключать сама; ручной режим всегда доступен.';
    }
    if (sectorFinished) get('sim-welcome-copy').textContent = 'Твоё время — ' + timeLabel(player.elapsed - lapStart) + '. Можно вернуться на старт и улучшить результат.';
    startButton.firstChild.textContent = sectorFinished ? 'Ещё один заезд ' : paused ? 'Продолжить заезд ' : 'На Нордшляйфе ';
    get('sim-session-state').textContent = phase === 'running' ? (mode === 'drift' ? 'Дрифт · удерживай угол' : 'Трек · твой заезд') : paused ? 'Заезд на паузе' : 'Подготовка к заезду';
    pauseButton.disabled = phase === 'ready';
    pauseButton.querySelector('span').textContent = paused ? 'Продолжить' : 'Пауза';
    pauseButton.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
    const settingsDone = get('sim-settings-done');
    if (settingsDone) settingsDone.textContent = paused ? 'Продолжить заезд' : 'Готово';
  }

  function resetSession() {
    startGeneration++;
    if(get('sim-start-status'))get('sim-start-status').textContent='';
    results?.reset();
    releaseControls();
    player = createSessionState();
    player.assistMode = assistMode;
    previousPose = { ...player };
    sectorFinished = false;
    sectorValid = true;
    clearCentralAlert();
    if (validityBadge) { validityBadge.hidden = true; get('sim-stat-label').hidden = false; }
    shiftRequest = 0;
    phase = 'ready';
    startButton.disabled = !scene || graphicsLost || !loading.hidden || playerMount.clientWidth<2 || playerMount.clientHeight<2;
    accumulator = 0;
    lap = 1;
    nextQuarter = 1;
    lapStart = 0;
    lapDistance = 0;
    driftPoints = 0;
    offTrackNotice = false;
    impactNoticed = false;
    notice('');
    scene?.clearTrails();
    engineAudio?.suspend();
    updateStartScreen();
    telemetry(true);
    scheduleFrame();
  }

  function setMode(next) {
    mode = next === 'drift' ? 'drift' : 'race';
    shell.dataset.mode = mode;
    modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.simMode === mode)));
    get('sim-stat-label').textContent = mode === 'drift' ? 'Очки дрифта' : 'Время сектора';
    syncAssistance();
    resetSession();
  }

  async function start() {
    if (!scene || graphicsLost || !dialog.open || !loading.hidden) return;
    if (phase === 'starting' || phase === 'running') return;
    if (results?.isOpen()) return;
    if (sectorFinished) resetSession();
    if (phase === 'ready' && mode === 'race' && results) {
      const current=++startGeneration;
      phase='starting';startButton.disabled=true;pauseButton.disabled=true;
      const status=get('sim-start-status');
      if(status)status.textContent='Подтверждаем старт. Таймер ещё не идёт…';
      const issued=await results.begin(player,'pro',mode);
      if(current!==startGeneration||!dialog.open)return;
      phase='ready';startButton.disabled=graphicsLost||!scene;
      if(issued?.error||!issued?.token){
        if(status)status.textContent=issued?.error?.message||'Не удалось подтвердить старт. Нажми ещё раз.';
        updateStartScreen();return;
      }
      if(document.hidden||graphicsLost){results.reset();updateStartScreen();return;}
      if(status)status.textContent='';
    }
    phase = 'running';
    previousFrame = 0;
    accumulator = 0;
    updateStartScreen();
    if (sound) resumeEngineAudio();
    get('sim-view').focus({ preventScroll: true });
    scheduleFrame();
  }

  function pause(moveFocus = false) {
    if (phase !== 'running') return;
    phase = 'paused';
    releaseControls();
    accumulator = 0;
    engineAudio?.suspend();
    updateStartScreen();
    if (moveFocus) startButton.focus({ preventScroll: true });
    scheduleFrame();
  }

  function updateInput(dt) {
    const left = keys.has('KeyA') || keys.has('ArrowLeft');
    const right = keys.has('KeyD') || keys.has('ArrowRight');
    const direction = Number(right) - Number(left);
    if (left || right) keyboardSteering = true;
    const thumb = thumbControls.read();
    if (thumb.steeringHeld) keyboardSteering = false;
    const target = keyboardSteering ? direction * 450 : (controlStyle === 'thumbs' ? thumb.steering : manualSteering) * 450;
    wheelAngle += (target - wheelAngle) * (1 - Math.exp(-dt * (direction ? 8 : 12)));
    if (Math.abs(wheelAngle) < 0.05) wheelAngle = 0;
    const held = name => heldPointers[name].size > 0 || heldPedalKeys.has(name);
    const manualThrottle = held('throttle') || keys.has('KeyW') || keys.has('ArrowUp');
    const brake = Math.max(Number(held('brake') || keys.has('KeyS') || keys.has('ArrowDown')), thumb.brake);
    const handbrake = Math.max(Number(held('handbrake') || keys.has('Space')), thumb.handbrake);
    // Ease off beyond the target rather than accelerating to the engine's
    // equilibrium speed; a held pedal still gives the full available power.
    const cruiseThrottle = player.speed < 17 ? 0.65 : Math.max(0, 0.22 - (player.speed - 17) * 0.35);
    input = {
      steering: wheelAngle / 450,
      throttle: brake || handbrake ? 0 : manualThrottle ? 1 : thumb.powerHeld ? thumb.throttle : cruise ? cruiseThrottle : 0,
      brake, assistMode, brakeAssist: false,
      gearboxMode, shiftProgram, shiftUp: shiftRequest > 0, shiftDown: shiftRequest < 0,
      handbrake
    };
    for (const [name, button] of Object.entries(pedals)) button.classList.toggle('is-down', Boolean(input[name]));
    syncWheel(wheelAngle);
  }

  function trackProgress(beforeT) {
    const afterT = player.trackT;
    results?.sample(player);
    if (player.trackDistance > 5.8) invalidateSector('Ты выехал за границы трассы.');
    if (!trackClosed) {
      const forward = trackPoint(afterT).tangent;
      if (phase === 'running' && !sectorFinished && !player.offTrack && beforeT < FINISH_T && afterT >= FINISH_T && player.vx * forward.x + player.vz * forward.z > 0 && player.distanceTravelled > trackLength * .8) {
        sectorFinished = true;
        const time = player.elapsed - lapStart;
        if (sectorValid && mode === 'race' && (!best || time < best)) {
          best = time;
          try { localStorage.setItem('autosim.m5.sector.v13.' + assistMode, String(best)); } catch { /* Optional record. */ }
        }
        pause(true);
        player.vx = player.vz = player.yawRate = player.speed = player.speedKmh = 0;
        previousPose = {...player};
        void results?.finish(player, sectorValid, mode);
      }
    }
    const crossedStart = beforeT > 0.9 && afterT < 0.1;
    const movingForward = crossedStart || (afterT > beforeT && afterT - beforeT < 0.04);
    if (trackClosed && movingForward && !player.offTrack) {
      if (nextQuarter < 4 && beforeT < nextQuarter / 4 && afterT >= nextQuarter / 4) nextQuarter++;
      if (crossedStart) {
        if (nextQuarter === 4 && player.distanceTravelled - lapDistance > trackLength * 0.85) {
          const lapTime = player.elapsed - lapStart;
          if (mode === 'race' && (!best || lapTime < best)) {
            best = lapTime;
            try { localStorage.setItem('autosim.m5.sector.v13.' + assistMode, String(best)); } catch { /* Optional local record. */ }
            notice('Личный рекорд: ' + timeLabel(lapTime), 6);
          } else if (mode === 'race') {
            notice('Круг завершён: ' + timeLabel(lapTime), 5);
          }
          lap++;
        }
        nextQuarter = 1;
        lapStart = player.elapsed;
        lapDistance = player.distanceTravelled;
      }
    }
    const slip = Math.abs(player.slipAngle);
    if (mode === 'drift' && !player.offTrack && player.speed > 5 && slip > 0.11 && slip < 1.05) {
      driftPoints += player.speed * slip * STEP * 7;
    }
  }

  function engineReadout() {
    return {gear:String(player.gear ?? 1),rpm:Math.round(player.rpm ?? 850)};
  }

  function syncTransmission() {
    get('sim-transmission').setAttribute('aria-pressed',String(gearboxMode === 'manual'));
    get('sim-transmission').textContent = gearboxMode === 'manual' ? 'S · ручной' : 'D · автомат';
    const program = get('sim-program');
    if (program.tagName === 'SELECT') {
      program.value = String(shiftProgram);
      program.querySelector('[value="6"]').disabled = gearboxMode === 'auto';
    } else program.textContent = 'Drivelogic ' + shiftProgram;
  }
  function requestShift(direction) {
    if (phase !== 'running') return;
    gearboxMode = 'manual'; shiftRequest = direction; syncTransmission();
  }
  function setAssist(next, quiet = false) {
    if (!quiet && phase === 'running') pause();
    if (!quiet && (player.elapsed > 0 || phase !== 'ready')) invalidateSector('Режим помощи изменён во время заезда.');
    assistMode = 'pro';
    best=null;try{const saved=Number(localStorage.getItem('autosim.m5.sector.v13.'+assistMode));if(saved>0&&Number.isFinite(saved))best=saved;}catch{}
    player.assistMode = assistMode;
    player.dscIntervention = 0; player.stabilityIntervention = 0; player.brakeAssist = 0;
    if (assistMode === 'pro' && cruise) cruiseButton.click();
    if (cruiseButton) { cruiseButton.disabled = true;cruiseButton.hidden=true; }
    setCamera('hood');
    shell.dataset.assist = assistMode;
    assistButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.assistMode === assistMode)));
    get('sim-assist-copy').textContent = 'Единый рейтинговый заезд. DSC отключена. Пройди сектор без возврата на трассу и сохрани время.';
    syncAssistance();
    if (!quiet) notice('DSC и помощь торможением выключены. Камеру можно выбрать в настройках.', 5);
    updateStartScreen(); telemetry(true); scheduleFrame();
  }
  function syncAssistance() {
    const enabled = false;
    get('sim-dsc').textContent = enabled ? 'DSC ON' : 'DSC OFF';
    get('sim-dsc').classList.toggle('is-off', !enabled);
  }
  function setCamera(next) {
    camera = ['chase', 'hood', 'top'].includes(next) ? next : 'chase';
    const name = {chase:'За машиной', hood:'От первого лица', top:'Сверху'}[camera];
    shell.dataset.camera = camera;
    get('sim-camera').setAttribute('aria-label', 'Камера: ' + name + '. Выбрать вид');
    get('sim-camera').querySelector('span').textContent = name;
    cameraButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.camera === camera)));
    scheduleFrame();
  }
  cameraButtons.forEach(button => button.addEventListener('click', () => setCamera(button.dataset.camera)));
  function setControlStyle(next) {
    releaseControls();
    controlStyle = next === 'thumbs' ? 'thumbs' : 'wheel';
    shell.dataset.controls = controlStyle;
    controlButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.controlStyle === controlStyle)));
    get('sim-help').previousElementSibling.textContent = controlStyle === 'thumbs' ? 'Два пальца. Полный контроль.' : 'Руль, педали и клавиатура.';
    updateStartScreen(); scheduleFrame();
  }
  assistButtons.forEach(button => button.addEventListener('click', () => setAssist(button.dataset.assistMode)));
  controlButtons.forEach(button => button.addEventListener('click', () => setControlStyle(button.dataset.controlStyle)));
  function closeSettings() {
    get('sim-settings-panel').hidden = true;
    get('sim-settings').setAttribute('aria-expanded', 'false');
    get('sim-settings').focus({ preventScroll: true });
  }
  function openSettings(cameraSection = false) {
    if(phase==='starting'){startGeneration++;results?.reset();phase='ready';startButton.disabled=!scene||graphicsLost;updateStartScreen();}
    if (phase === 'running') pause();
    get('sim-settings-panel').hidden = false;
    get('sim-settings').setAttribute('aria-expanded', 'true');
    const done = get('sim-settings-done');
    if (done) done.textContent = phase === 'paused' ? 'Продолжить заезд' : 'Готово';
    (cameraSection ? get('sim-camera-heading') || get('sim-settings-close') : get('sim-settings-close')).focus();
  }
  get('sim-settings').addEventListener('click', () => {
    if (!get('sim-settings-panel').hidden) return closeSettings();
    openSettings();
  });
  get('sim-settings-close').addEventListener('click', closeSettings);
  get('sim-settings-done')?.addEventListener('click', () => { closeSettings(); if (phase === 'paused') start(); });
  get('sim-help').addEventListener('click', () => get('sim-settings').click());
  get('sim-recover').addEventListener('click', () => {
    pause(); releaseControls();
    respawnCar(player, clamp(player.trackT, .009, .985));
    previousPose = { ...player }; sectorFinished = false;
    invalidateSector('Машина возвращена на асфальт.');
    phase = 'paused'; accumulator = 0;
    scene?.clearTrails(); engineAudio?.suspend(); closeSettings();
    updateStartScreen(); telemetry(true); scheduleFrame();
    notice('Машина на асфальте. Нажми «Продолжить», когда будешь готов.', 6);
  });
  get('sim-shift-down').addEventListener('click',()=>requestShift(-1));
  get('sim-shift-up').addEventListener('click',()=>requestShift(1));
  get('sim-thumb-shift-down').addEventListener('click',()=>requestShift(-1));
  get('sim-thumb-shift-up').addEventListener('click',()=>requestShift(1));
  get('sim-transmission').addEventListener('click',()=>{
    gearboxMode = gearboxMode === 'auto' ? 'manual' : 'auto';
    if (gearboxMode === 'auto') shiftProgram = Math.min(5,shiftProgram);
    syncTransmission(); telemetry(true); scheduleFrame();
  });
  get('sim-program').addEventListener(get('sim-program').tagName === 'SELECT' ? 'change' : 'click',()=>{
    shiftProgram = get('sim-program').tagName === 'SELECT'
      ? clamp(Number(get('sim-program').value) || 3, 1, gearboxMode === 'auto' ? 5 : 6)
      : shiftProgram % (gearboxMode === 'auto' ? 5 : 6) + 1;
    syncTransmission(); telemetry(true); scheduleFrame();
  });
  syncTransmission();

  function telemetry(force = false) {
    const now = performance.now();
    if (!force && now - telemetryAt < 125) return;
    telemetryAt = now;
    syncAssistance();
    const { gear, rpm } = engineReadout();
    get('sim-speed').textContent = String(Math.round(player.speedKmh));
    get('sim-gear').textContent = (gearboxMode === 'manual' ? 'S' : 'D') + gear;
    get('sim-rpm').textContent = String(rpm);
    get('sim-tach-needle').setAttribute('transform','rotate('+(-125 + clamp(rpm/9000,0,1)*250)+ ' 70 70)');
    const shifting = player.shiftPhase && player.shiftPhase !== 'engaged';
    get('sim-gearbox-state').textContent = shifting ? 'ПЕРЕКЛЮЧЕНИЕ' : player.clutch < .12 ? 'СЦЕПЛЕНИЕ РАЗОМКНУТО' : 'ПЕРЕДАЧА ВКЛЮЧЕНА';
    get('sim-gearbox-state').classList.toggle('is-shifting',!!shifting);
    get('sim-clutch-bar').style.width = ((player.clutch ?? 0)*100).toFixed(1)+'%';
    get('sim-torque').textContent = String(Math.round(player.engineTorqueNm ?? 0));
    get('sim-load').textContent = Math.round((player.engineLoad ?? 0)*100)+'%';
    const accel = player.acceleration || {};
    const lateral = typeof accel === 'object' ? accel.lateral || 0 : 0;
    const longitudinal = typeof accel === 'object' ? accel.longitudinal || 0 : 0;
    get('sim-g-dot').setAttribute('cx',String(45+clamp(lateral/9.81,-1.3,1.3)*24));
    get('sim-g-dot').setAttribute('cy',String(45-clamp(longitudinal/9.81,-1.3,1.3)*24));
    get('sim-g-value').textContent = (Math.hypot(lateral,longitudinal)/9.81).toFixed(2)+' g';
    const loads=player.tireLoads || {};
    for(const [id,key] of [['fl','frontLeft'],['fr','frontRight'],['rl','rearLeft'],['rr','rearRight']]) {
      get('sim-load-'+id).style.height=clamp((loads[key]||0)/9000*100,0,100).toFixed(1)+'%';
      get('sim-load-'+id+'-value').textContent=Math.round((loads[key]||0)/9.81)+' кг';
    }
    const lit = Math.round(clamp(rpm / 8250, 0, 1) * revBars.length);
    revBars.forEach((bar, index) => bar.classList.toggle('on', index < lit));
    get('sim-time').textContent = mode === 'drift' ? Math.floor(driftPoints).toLocaleString('ru-RU') : timeLabel(player.elapsed - lapStart);
    get('sim-best').textContent = best ? timeLabel(best) : '—';
    get('sim-slip').textContent = Math.round(Math.abs(player.slipAngle) * 180 / Math.PI) + '°';
    get('sim-lap').textContent = trackClosed ? 'КРУГ ' + String(lap).padStart(2, '0') : Math.round(player.trackT * 100) + '% СЕКТОРА';
    get('sim-progress-bar').style.width = (clamp(player.trackT, 0, 1) * 100).toFixed(2) + '%';
    get('sim-assist-status').textContent = player.brakeAssist > .08 ? 'Помогаем замедлиться' : player.stabilityIntervention > .1 ? 'Стабилизация' : player.dscIntervention > .1 ? 'Контроль тяги' : assistMode === 'novice' ? 'Помощники готовы' : 'Твой полный контроль';
    get('sim-assist-status').classList.toggle('is-active', player.brakeAssist > .08 || player.stabilityIntervention > .1);
    get('sim-target-speed').textContent = Number.isFinite(player.targetSpeedKmh) ? String(Math.round(player.targetSpeedKmh)) : '—';
    if (!player.collision || player.collision.age > .5) impactNoticed = false;
    if (player.collision?.age < .18 && now - lastImpactAt > 700 && player.collision.speed > 1.5) {
      lastImpactAt = now;
      notice('Контакт с препятствием. Можно вернуться на трассу через настройки.', 4);
      if (!impactNoticed) centralNotice('Контакт с препятствием', sectorValid ? 'Скорость потеряна. Заезд продолжается.' : 'Эта попытка уже вне зачёта. Начни заново.', 3);
      impactNoticed = true;
    }
    get('sim-map-car').setAttribute('cx', player.x.toFixed(2));
    get('sim-map-car').setAttribute('cy', (-player.z).toFixed(2));
    if (phase === 'running' && player.offTrack && !offTrackNotice) {
      offTrackNotice = true;
      notice('За пределами трассы сцепление ниже. Вернись на асфальт.', 0);
      if (sectorValid) centralNotice('Вернись на асфальт', 'Сцепление ниже. Не пересекай границы трассы.', 3);
    } else if (!player.offTrack && offTrackNotice) {
      offTrackNotice = false;
      notice('');
    } else if (noticeExpires && now > noticeExpires) notice('');
    
  }

  function canAnimate() {
    return !graphicsLost && !document.hidden && (dialog.open ? phase === 'running' : false);
  }

  function scheduleFrame() {
    if (!frameId && scene && !graphicsLost && !document.hidden && dialog.open) frameId = requestAnimationFrame(frame);
  }

  function frame(timestamp) {
    frameId = 0;
    const delta = previousFrame ? clamp((timestamp - previousFrame) / 1000, 0, 0.05) : 0;
    previousFrame = timestamp;
    if (document.hidden || !scene || graphicsLost || !dialog.open) return;
    if (dialog.open) {
      try { if (phase === 'running') {
        updateInput(delta);
        accumulator += delta;
        while (accumulator >= STEP) {
          previousPose = { ...player };
          const beforeT = player.trackT;
          stepCar(player, input, STEP, mode);
          const edge=trackPoint(player.trackT),beyond=(player.x-edge.x)*edge.tangent.x+(player.z-edge.z)*edge.tangent.z;
          if(player.trackDistance>40||(player.trackT>.999&&beyond>1)||(player.trackT<.001&&beyond< -1)){
            invalidateSector('Ты покинул сектор.');respawnCar(player,clamp(player.trackT,.009,FINISH_T-.025));previousPose={...player};
            notice('Граница сектора. Машина возвращена на трассу; для рейтинга начни заново.',7);
          }
          // Keep a paddle request across render-only frames, then deliver one
          // input edge even when this frame contains several physics steps.
          shiftRequest = 0;
          input.shiftUp = false;
          input.shiftDown = false;
          trackProgress(beforeT);
          accumulator -= STEP;
          if (phase !== 'running') { accumulator = 0; break; }
        }
        renderTime += delta;
        if (sound) engineAudio?.update(player,input,player.rpm);
        telemetry();
      } } catch(error) {
        // Never strand the last gas/steering values when an input/physics/audio
        // callback fails. The page and its reset/close buttons stay usable.
        invalidateSector('В заезде произошёл сбой.');pause(true);releaseControls();
        notice('Заезд остановлен из-за сбоя. Нажми «Заново» — перезагружать страницу не нужно.',12);
        console.warn('Автосим: driving update paused after an error.',error);
        return;
      }
      try {
        const rendered = scene.render(phase === 'running' ? interpolatePose(previousPose, player, accumulator / STEP) : player, input, phase === 'running' ? delta : 0, {
          camera, cameraMotion, preview: false, elapsed: renderTime, simulateEffects: phase === 'running'
        });
        if (rendered !== false && !graphicsLost) markSceneReady();
      } catch (error) { graphicsFailed(error); return; }
    }
    if (canAnimate()) scheduleFrame();
    else previousFrame = 0;
  }

  async function open(nextMode = 'race', nextAssist) {
    if (dialog.open) return ensureScene();
    returnFocus = document.activeElement;
    dialog.showModal();
    document.body.classList.add('modal-open');
    scene?.setMount(playerMount);
    scene?.setNight(night);
    scene?.setEngineering(engineering);
    scene?.resize();
    previousFrame = 0;
    get('sim-settings-panel').hidden = true;
    get('sim-settings').setAttribute('aria-expanded', 'false');
    setMode(nextMode);
    if (nextAssist) setAssist(nextAssist, true);
    if (scene) startButton.focus({ preventScroll: true });
    else get('sim-close').focus({ preventScroll: true });
    scheduleFrame();
    return ensureScene();
  }

  function closeCleanup() {
    startGeneration++;
    if(phase==='starting'){results?.reset();startButton.disabled=false;}
    clearCentralAlert();
    results?.close();
    phase = 'ready';
    releaseControls();
    get('sim-settings-panel').hidden = true;
    engineAudio?.suspend();
    document.body.classList.toggle('modal-open', Boolean(document.querySelector('dialog[open]')));
    scene?.clearTrails();
    accumulator = 0;
    previousFrame = 0;
    cancelAnimationFrame(frameId);
    frameId = 0;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    scheduleFrame();
  }

  get('sim-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', closeCleanup);
  dialog.addEventListener('cancel', event => {
    if (results?.isOpen()) { event.preventDefault();results.close();return; }
    if (!get('sim-settings-panel').hidden) { event.preventDefault(); closeSettings(); }
  });
  startButton.addEventListener('click', start);
  pauseButton.addEventListener('click', () => phase === 'running' ? pause(true) : start());
  get('sim-reset').addEventListener('click', () => { resetSession(); startButton.focus({ preventScroll: true }); });
  modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.simMode)));
  get('sim-book').addEventListener('click', () => {
    dialog.close();
    requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('autosim:book')));
  });

  wheelPad.addEventListener('pointerdown', event => {
    if (event.target === wheelRange || event.button !== 0 || wheelPointer !== null || phase !== 'running') return;
    event.preventDefault();
    wheelPointer = event.pointerId;
    const bounds = wheelPad.getBoundingClientRect();
    wheelPointerPolar = Math.atan2(event.clientX-bounds.left-bounds.width/2, -(event.clientY-bounds.top-bounds.height/2));
    manualSteering = wheelAngle / 450;
    keyboardSteering = false;
    capturePointer(wheelPad,event.pointerId);
  });
  wheelPad.addEventListener('pointermove', event => {
    if (event.pointerId !== wheelPointer) return;
    const bounds = wheelPad.getBoundingClientRect();
    const polar = Math.atan2(event.clientX-bounds.left-bounds.width/2, -(event.clientY-bounds.top-bounds.height/2));
    manualSteering = clamp(manualSteering + wrapAngle(polar-wheelPointerPolar)*180/Math.PI/450, -1, 1);
    wheelPointerPolar = polar;
  });
  const releaseWheel = event => {
    if (event.pointerId === wheelPointer) {wheelPointer = null;manualSteering=0;}
  };
  wheelPad.addEventListener('pointerup', releaseWheel);
  wheelPad.addEventListener('pointercancel', releaseWheel);
  wheelPad.addEventListener('lostpointercapture', releaseWheel);
  for(const type of ['pointerup','pointercancel'])document.addEventListener(type,event=>{
    releaseWheel(event);
    for(const [name,ids] of Object.entries(heldPointers)){ids.delete(event.pointerId);if(!ids.size&&!heldPedalKeys.has(name))pedals[name].classList.remove('is-down');}
  },true);
  for(const type of ['touchend','touchcancel'])document.addEventListener(type,event=>{
    if(dialog.open&&event.touches.length===0)releaseControls();
  },true);
  wheelRange.addEventListener('input', () => {
    keyboardSteering = false;
    manualSteering = Number(wheelRange.value) / 450;
    wheelAngle = Number(wheelRange.value);
    syncWheel(wheelAngle);
    scheduleFrame();
  });
  get('sim-center').addEventListener('click', () => {
    manualSteering = 0;
    keyboardSteering = false;
    wheelAngle = 0;
    syncWheel(0);
    scheduleFrame();
  });

  for (const [name, button] of Object.entries(pedals)) {
    button.addEventListener('pointerdown', event => {
      if (phase !== 'running' || event.button !== 0) return;
      event.preventDefault();
      heldPointers[name].add(event.pointerId);
      capturePointer(button,event.pointerId);
      button.classList.add('is-down');
    });
    const release = event => {
      heldPointers[name].delete(event.pointerId);
      if (!heldPointers[name].size && !heldPedalKeys.has(name)) button.classList.remove('is-down');
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('keydown', event => {
      if ((event.code !== 'Space' && event.code !== 'Enter') || phase !== 'running') return;
      event.preventDefault();
      event.stopPropagation();
      heldPedalKeys.add(name);
      button.classList.add('is-down');
    });
    button.addEventListener('keyup', event => {
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      keys.delete(event.code);
      heldPedalKeys.delete(name);
      if (!heldPointers[name].size) button.classList.remove('is-down');
    });
    button.addEventListener('blur', () => {
      heldPedalKeys.delete(name);
      if (!heldPointers[name].size) button.classList.remove('is-down');
    });
  }

  const controlCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space']);
  document.addEventListener('keydown', event => {
    if (results?.isOpen() || !dialog.open || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'KeyP' && !event.repeat) {
      event.preventDefault();
      if (phase === 'running') pause(true);
      else if (phase === 'paused') start();
      return;
    }
    if (event.code === 'KeyR' && !event.repeat) {
      event.preventDefault();
      resetSession();
      startButton.focus({ preventScroll: true });
      return;
    }
    if ((event.code === 'KeyQ' || event.code === 'KeyE') && !event.repeat) {
      event.preventDefault(); requestShift(event.code === 'KeyE' ? 1 : -1); return;
    }
    if (phase !== 'running' || !controlCodes.has(event.code)) return;
    if (event.target === wheelRange && event.code.startsWith('Arrow')) return;
    if (event.code === 'Space' && event.target.closest('button,input,a')) return;
    event.preventDefault();
    keys.add(event.code);
  });
  document.addEventListener('keyup', event => {
    if (keys.has(event.code)) event.preventDefault();
    keys.delete(event.code);
  });

  get('sim-camera').addEventListener('click', () => {
    if (cameraButtons.length) openSettings(true);
    else {
      // Legacy /old markup predates the explicit camera picker.
      const cameras = ['chase', 'hood', 'top'];
      setCamera(cameras[(cameras.indexOf(camera) + 1) % cameras.length]);
    }
  });
  get('sim-night').addEventListener('click', () => {
    night = !night;
    get('sim-night').setAttribute('aria-pressed', String(night));
    scene?.setNight(night);
    scheduleFrame();
  });
  cruiseButton?.addEventListener('click', () => {
    cruise = !cruise;
    cruiseButton.setAttribute('aria-pressed', String(cruise));
    cruiseButton.setAttribute('aria-label', cruise ? 'Автогаз: поддерживать около 60 км/ч' : 'Автогаз выключен: управляй газом педалью или клавишей W');
    notice(cruise ? 'Автогаз включён. Просто управляй рулём.' : 'Ручной газ: удерживай педаль или W.', 4);
    updateStartScreen();
    scheduleFrame();
  });
  get('sim-engineering').addEventListener('click', () => {
    engineering = !engineering;
    get('sim-engineering').setAttribute('aria-pressed', String(engineering));
    get('sim-engineering-legend').hidden = !engineering;
    get('sim-engineering-data').hidden = !engineering;
    shell.classList.toggle('is-engineering', engineering);
    scene?.setEngineering(engineering);
    scheduleFrame();
  });
  get('sim-sound').addEventListener('click', () => {
    sound = !sound;
    if (sound) {
      try {
        if (!engineAudio) {
          engineAudio = createEngineAudio();
          const audio = engineAudio;
          audio?.ready?.catch(() => audioFailed(audio));
        }
      }
      catch { engineAudio = null; }
      if (!engineAudio) {
        sound = false;
        notice('В этом браузере звук недоступен. Заезд продолжается без него.', 5);
      }
    }
    get('sim-sound').setAttribute('aria-pressed', String(sound));
    get('sim-sound').setAttribute('aria-label', sound ? 'Выключить звук двигателя' : 'Включить запись V10');
    if (sound && phase === 'running') resumeEngineAudio();
    else engineAudio?.suspend();
  });

  window.addEventListener('blur', () => {
    if (dialog.open) pause();
    releaseControls();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (dialog.open) pause();
      releaseControls();
      engineAudio?.suspend();
      cancelAnimationFrame(frameId);
      frameId = 0;
      previousFrame = 0;
    } else {
      scene?.resize();
      scheduleFrame();
    }
  });

  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.className = 'button button-primary';
  retryButton.textContent = 'Повторить загрузку';
  retryButton.hidden = true;
  loading.appendChild(retryButton);
  loading.setAttribute('role', 'status');
  loading.setAttribute('aria-live', 'polite');

  function loadingState(message, failed = false) {
    loading.hidden = false;
    loading.querySelector('p').textContent = message;
    loading.querySelector('.sim-loading-ring').hidden = failed;
    retryButton.hidden = !failed;
    startButton.disabled = true;
    playerMount.dataset.graphics = failed ? 'error' : 'loading';
  }

  function markSceneReady() {
    loading.hidden = true;
    retryButton.hidden = true;
    playerMount.dataset.graphics = 'ready';
    startButton.disabled = phase === 'starting';
  }

  function discardScene() {
    detachSceneEvents();
    detachSceneEvents = () => {};
    scene?.dispose();
    scene = null;
  }

  function graphicsFailed(error, retainForRestore = error?.code === 'WEBGL_CONTEXT_LOST') {
    graphicsLost = true;
    pause();
    releaseControls();
    engineAudio?.suspend();
    cancelAnimationFrame(frameId);
    frameId = 0;
    previousFrame = 0;
    accumulator = 0;
    if (!retainForRestore) discardScene();
    loadingState(retainForRestore
      ? 'Графика приостановлена. Восстановим заезд, когда браузер будет готов, или попробуй ещё раз.'
      : /webgl|context/i.test(error?.message || '')
        ? 'Браузер не смог включить 3D-графику. Можно повторить запуск или закрыть заезд — сайт и выбор симулятора работают.'
        : 'Не удалось загрузить 3D. Проверь соединение и попробуй ещё раз. Основной сайт доступен.', true);
    if (error) console.warn('Автосим: 3D experience is unavailable.', error);
  }

  function ensureScene() {
    if (sceneLoading) return sceneLoading;
    if (scene && !graphicsLost) { scene.resize(); scheduleFrame(); return Promise.resolve(true); }
    discardScene();
    graphicsLost = false;
    loadingState('Загружаем машину и трассу…');
    const generation = ++sceneGeneration;
    const abort = new AbortController();
    sceneAbort = abort;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error('3D scene loading timed out'));
      }, 45000);
    });
    const creation = createDrivingScene(playerMount, { signal: abort.signal });
    sceneLoading = Promise.race([creation, timeout]).then(createdScene => {
      if (generation !== sceneGeneration) { createdScene.dispose(); return false; }
      scene = createdScene;
      scene.setNight(night);
      scene.setEngineering(engineering);
      const lost = event => { event.preventDefault(); graphicsFailed(null, true); };
      const restored = () => {
        // New renderer regenerates GPU-only targets, including the PMREM map.
        // The physics state is retained; resuming always requires a click.
        discardScene();
        if (dialog.open && !document.hidden) void ensureScene();
      };
      scene.canvas.addEventListener('webglcontextlost', lost);
      scene.canvas.addEventListener('webglcontextrestored', restored);
      const canvas = scene.canvas;
      detachSceneEvents = () => {
        canvas.removeEventListener('webglcontextlost', lost);
        canvas.removeEventListener('webglcontextrestored', restored);
      };
      // Do not dismiss loading until a visible, nonzero canvas rendered once.
      if (dialog.open && !document.hidden) {
        scene.resize();
        const rendered = scene.render(player, input, 0, { camera: phase === 'ready' ? 'showroom' : camera, simulateEffects: false });
        if (rendered !== false && !graphicsLost) markSceneReady();
      }
      if (dialog.open) startButton.focus({ preventScroll: true });
      previousFrame = 0;
      scheduleFrame();
      return true;
    }).catch(error => {
      if (generation === sceneGeneration) graphicsFailed(error);
      return false;
    }).finally(() => {
      clearTimeout(timer);
      if (generation === sceneGeneration) sceneLoading = null;
    });
    return sceneLoading;
  }

  retryButton.addEventListener('click', () => { void ensureScene(); });
  const resizeObserver = new ResizeObserver(() => {
    if (!dialog.open || document.hidden || !scene || graphicsLost) return;
    scene.resize();
    scheduleFrame();
  });
  resizeObserver.observe(playerMount);
  window.addEventListener('pagehide', event => {
    pause(); releaseControls(); engineAudio?.suspend();
    cancelAnimationFrame(frameId); frameId = 0;
    if (!event.persisted) { sceneGeneration++; sceneAbort?.abort(); discardScene(); engineAudio?.dispose(); resizeObserver.disconnect(); }
  });
  startButton.disabled = true;
  setMode('race');
  setControlStyle(controlStyle);
  setAssist(assistMode, true);
  scheduleFrame();

  return { open, close: () => dialog.close() };
}
