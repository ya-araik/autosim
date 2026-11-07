const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;
const anchors = [1800, 3300, 5100, 7400];
const names = ['low', 'mid', 'upper', 'high'];
export const RECORDING_LAYERS = Object.freeze(anchors.flatMap((rpm, i) =>
  ['load', 'coast'].map(kind => Object.freeze({ rpm, kind, file: `r8-v10-${names[i]}-${kind}.wav` }))));

// These anchors calibrate edited field-recording loops; they are not measured dyno RPMs.
export function getRecordedEngineMix(state = {}, input = {}, fallbackRpm = 900) {
  const rpm = clamp(finite(state.rpm, finite(fallbackRpm, 900)), 0, 8250);
  const effectiveThrottle = clamp(finite(state.throttleEffective, finite(input.throttle)), 0, 1);
  const phase = state.shiftPhase || 'engaged';
  const blip = phase === 'select' && effectiveThrottle > .1;
  const cut = (phase === 'cut' || phase === 'select') && !blip;
  const actualLoad = clamp(finite(state.engineLoad, effectiveThrottle), 0, 1);
  const load = clamp(actualLoad * .78 + effectiveThrottle * .22 + (blip ? effectiveThrottle * .45 : 0), 0, 1);
  const on = state.engineOn !== false && rpm > 50;
  const amplitude = on ? (.29 + .62 * Math.sqrt(load)) * (.7 + .3 * clamp(rpm / 4500, 0, 1)) * (cut ? .17 : 1) : 0;
  let left = 0;
  while (left < anchors.length - 2 && rpm > anchors[left + 1]) left++;
  const t = clamp(Math.log(Math.max(rpm, 1) / anchors[left]) / Math.log(anchors[left + 1] / anchors[left]), 0, 1);
  const weights = [0, 0, 0, 0];
  weights[left] = Math.cos(t * Math.PI / 2);
  weights[left + 1] = Math.sin(t * Math.PI / 2);
  return {
    rpm, load, cut, blip,
    lowpass: cut ? 1900 : 2800 + 5000 * load + rpm * .34,
    layers: RECORDING_LAYERS.map((layer, i) => ({
      rate: clamp(Math.max(rpm, 350) / layer.rpm, .15, 5),
      gain: amplitude * weights[Math.floor(i / 2)] * (layer.kind === 'load' ? Math.sqrt(load) : Math.sqrt(1 - load))
    }))
  };
}
