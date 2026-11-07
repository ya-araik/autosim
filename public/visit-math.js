export const CLUB_OFFSET = 5 * 60;
export const PRICE_TABLE = Object.freeze({ standard: { 30: 350, 60: 650, 120: 1150 }, pro: { 30: 500, 60: 800, 120: 1500 }, vip: { 30: 500, 60: 800, 120: 1500 } });
export const VR_PRICES = Object.freeze({ 30: 300, 60: 400, 120: 800 });
export const TARIFF_NAMES = Object.freeze({ standard: 'Standard', pro: 'Pro', vip: 'VIP' });
export const INTENTS = Object.freeze({ discover: 'Попробовать новое', pace: 'За личным рекордом', drift: 'Поймать занос', friends: 'Вечер с друзьями' });
const has = (object, key) => Object.hasOwn(object, key);
const minute = 60000;

export function isDate(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function localParts(instant = new Date()) {
  const date = new Date(new Date(instant).getTime() + CLUB_OFFSET * minute);
  return { date: date.toISOString().slice(0, 10), time: date.toISOString().slice(11, 16) };
}
export function addDays(date, days) {
  if (!isDate(date) || !Number.isInteger(days)) throw new RangeError('Invalid date');
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
export function localToUTC(date, time) {
  if (!isDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new RangeError('Invalid local time');
  return new Date(date + 'T' + time + ':00+05:00');
}
export function validState(state) {
  return !!state && typeof state === 'object' && !Array.isArray(state)
    && typeof state.tariff === 'string' && typeof state.intent === 'string' && typeof state.experience === 'string' && typeof state.time === 'string'
    && has(PRICE_TABLE, state.tariff) && has(VR_PRICES, state.duration)
    && Number.isInteger(state.duration) && Number.isInteger(state.people) && state.people >= 1 && state.people <= 7
    && typeof state.vr === 'boolean' && typeof state.after === 'boolean' && typeof state.manual === 'boolean'
    && has(INTENTS, state.intent) && ['new', 'regular'].includes(state.experience)
    && isDate(state.date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(state.time);
}
export function quote(state) {
  if (!validState(state)) throw new RangeError('Invalid plan');
  const base = PRICE_TABLE[state.tariff][state.duration];
  const vr = state.vr ? VR_PRICES[state.duration] : 0;
  return { base, vr, each: base + vr, total: (base + vr) * state.people };
}
export function recommendation(intent, experience) {
  if (intent === 'drift') return { tariff: 'vip', reason: 'MOZA R9 и коробка передач Simagic — для работы рулём, газом и переключениями.' };
  if (intent === 'pace' || experience === 'regular') return { tariff: 'pro', reason: 'MOZA R12 и широкий 49-дюймовый монитор — больше деталей дороги в поле зрения и в руках.' };
  return { tariff: 'standard', reason: 'MOZA R5 и большой 4K-экран. Всё для первого заезда, с комфортной ценой на всю компанию.' };
}
export function timeline(state) {
  if (!validState(state)) throw new RangeError('Invalid plan');
  const start = localToUTC(state.date, state.time);
  return {
    arrival: new Date(start.getTime() - 10 * minute), start,
    finish: new Date(start.getTime() + state.duration * minute),
    end: new Date(start.getTime() + (state.duration + (state.after ? 10 : 0)) * minute)
  };
}
export function withinHours(state) {
  if (!validState(state)) return false;
  const [hour, minutes] = state.time.split(':').map(Number);
  const start = hour * 60 + minutes;
  // The selected date is the actual start date, including starts after midnight.
  const businessStart = start < 120 ? start + 1440 : start;
  return businessStart - 10 >= 14 * 60 && businessStart + state.duration <= 26 * 60;
}
export function validatePlan(state, now = new Date()) {
  if (!validState(state)) return 'Проверь дату и параметры визита.';
  const today = localParts(now).date;
  if (state.date < today || state.date > addDays(today, 365)) return 'Выбери дату в течение ближайшего года.';
  if (!withinHours(state)) return 'Заезд должен закончиться до 02:00, подготовка начинается после 14:00.';
  if (timeline(state).arrival.getTime() < new Date(now).getTime()) return 'Это время уже прошло. Выбери новый старт.';
  if (state.vr && state.people > 5) return 'Общий VR-заезд рассчитан на компанию до 5 человек.';
  return '';
}
export function availableTimes(state, now = new Date()) {
  const times = [];
  for (let value = 0; value < 1440; value += 15) {
    const time = String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
    // Time choices represent opening hours only, never actual availability.
    const candidate = { ...state, time, vr: false };
    if (!validatePlan(candidate, now)) times.push(time);
  }
  return times;
}
export function defaultState(now = new Date()) {
  const state = { tariff: 'standard', people: 2, duration: 60, vr: false, intent: 'friends', experience: 'new', manual: false, date: localParts(now).date, time: '19:00', after: true };
  let times = availableTimes(state, now);
  if (!times.length) { state.date = addDays(state.date, 1); times = availableTimes(state, now); }
  if (!times.includes(state.time)) state.time = times.find(time => time >= '19:00') || times[0];
  return state;
}
export function shareHash(state) {
  if (!validState(state)) throw new RangeError('Invalid plan');
  return '#visit-planner?' + new URLSearchParams({ v: '1', p: state.people, t: state.tariff, m: state.duration, vr: Number(state.vr), i: state.intent, e: state.experience, c: Number(state.manual), d: state.date, at: state.time, a: Number(state.after) });
}
export function parseShare(hash) {
  if (typeof hash !== 'string' || hash.length > 700 || !hash.startsWith('#visit-planner?')) return null;
  const params = new URLSearchParams(hash.slice('#visit-planner?'.length));
  const keys = ['v', 'p', 't', 'm', 'vr', 'i', 'e', 'c', 'd', 'at', 'a'];
  if (params.size !== keys.length || keys.some(key => params.getAll(key).length !== 1) || params.get('v') !== '1') return null;
  if (!['vr', 'c', 'a'].every(key => ['0', '1'].includes(params.get(key))) || !/^[1-7]$/.test(params.get('p')) || !/^(30|60|120)$/.test(params.get('m'))) return null;
  const state = { people: Number(params.get('p')), tariff: params.get('t'), duration: Number(params.get('m')), vr: params.get('vr') === '1', intent: params.get('i'), experience: params.get('e'), manual: params.get('c') === '1', date: params.get('d'), time: params.get('at'), after: params.get('a') === '1' };
  return validState(state) && !(state.vr && state.people > 5) ? state : null;
}
export function buildICS(state, description, now = new Date()) {
  const error = validatePlan(state, now);
  if (error) throw new RangeError(error);
  const plan = timeline(state);
  const stamp = value => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const escape = value => String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const uid = 'autosim-plan-' + stamp(plan.start) + '-' + state.people + '-' + state.tariff + '-' + state.duration + '-' + Number(state.vr) + '@autosim.local';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Autosim//Visit Planner//RU', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp(new Date(now)), 'DTSTART:' + stamp(plan.arrival), 'DTEND:' + stamp(plan.end), 'SUMMARY:План визита в Автосим — требуется подтверждение', 'LOCATION:Оренбург\\, Рыбаковская\\, 59', 'DESCRIPTION:' + escape(description), 'STATUS:TENTATIVE', 'TRANSP:TRANSPARENT', 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:План визита в Автосим. Проверь подтверждение клуба.', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'];
  // RFC 5545: fold by UTF-8 octets without splitting a multibyte character.
  const encoder = new TextEncoder();
  return lines.map(line => {
    let result = '', column = 0;
    for (const char of line) {
      const width = encoder.encode(char).length;
      if (column + width > 75) { result += '\r\n '; column = 1; }
      result += char; column += width;
    }
    return result;
  }).join('\r\n') + '\r\n';
}
