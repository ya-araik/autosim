import { RECORDING_LAYERS, getRecordedEngineMix } from './assets/audio/recorded-v10.js';
import { roadSoundMix } from './drive-motion.js';

// Real Audi R8 LMS Ultra V10 recording; deliberately not labelled as BMW S85.
// Exact source, CC0 licence, edits and sampler limitations: assets/audio/PROVENANCE.md.
export function createEngineAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  const context = new AudioContext({ latencyHint: 'interactive' });
  const abort = new AbortController();
  const master = context.createGain();
  master.gain.value = 0;
  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass'; highpass.frequency.value = 32; highpass.Q.value = .5;
  const tone = context.createBiquadFilter();
  tone.type = 'lowpass'; tone.frequency.value = 6500; tone.Q.value = .5;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -9; compressor.knee.value = 9;
  compressor.ratio.value = 3; compressor.attack.value = .003; compressor.release.value = .12;
  highpass.connect(tone).connect(master).connect(compressor).connect(context.destination);
  const voices = [];
  // Quiet procedural tyre/air ambience, separate from the recorded V10 engine.
  // No oscillators or fake replacement engine; energy follows actual road speed.
  const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);let noiseSeed = 1729;
  for (let i=0;i<data.length;i++) { noiseSeed=(Math.imul(noiseSeed,1664525)+1013904223)>>>0;data[i]=(noiseSeed/4294967296)*2-1; }
  const ambience = ['roll','wind'].map((kind,index) => {
    const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
    source.buffer=noiseBuffer;source.loop=true;filter.type='bandpass';filter.Q.value=index?.55:.65;
    filter.frequency.value=index?1100:320;gain.gain.value=0;
    source.connect(filter).connect(gain).connect(master);source.start(0,index*.71);
    return {kind,source,filter,gain};
  });
  let enabled = false, disposed = false, failed = null, suspendTimer = 0;
  let lastMix = getRecordedEngineMix({ rpm: 900, engineOn: true });

  function applyMix(immediate = false) {
    if (disposed || !voices.length) return;
    const now = context.currentTime;
    const response = immediate ? .006 : .022;
    for (let i = 0; i < voices.length; i++) {
      const voice = voices[i], mix = lastMix.layers[i];
      voice.source.playbackRate.setTargetAtTime(mix.rate, now, .018);
      voice.gain.gain.setTargetAtTime(mix.gain, now, response);
    }
    tone.frequency.setTargetAtTime(lastMix.lowpass, now, .035);
  }

  const ready = Promise.all(RECORDING_LAYERS.map(async layer => {
    const response = await fetch(new URL('./assets/audio/' + layer.file, import.meta.url), { signal: abort.signal });
    if (!response.ok) throw new Error(`V10 recording: HTTP ${response.status}`);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    if (!buffer.length || !Number.isFinite(buffer.duration)) throw new Error('V10 recording: empty audio');
    return buffer;
  })).then(buffers => {
    if (disposed) return;
    buffers.forEach((buffer, i) => {
      const source = context.createBufferSource();
      source.buffer = buffer; source.loop = true;
      const gain = context.createGain(); gain.gain.value = 0;
      source.connect(gain).connect(highpass);
      source.start(0, (i % 2) * buffer.duration * .37);
      voices.push({ source, gain });
    });
    applyMix(true);
  }).catch(error => {
    if (disposed) return;
    failed = error; enabled = false;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.value = 0;
    context.suspend().catch(() => {});
    throw error;
  });
  ready.catch(() => {});

  return {
    sourceLabel: 'Запись V10 · Audi R8 LMS Ultra',
    ready,
    async resume() {
      if (disposed) return;
      if (failed) throw failed;
      clearTimeout(suspendTimer); enabled = true;
      await context.resume();
      await ready;
      if (!enabled || disposed) return;
      if (failed) throw failed;
      applyMix(true);
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(.72, context.currentTime, .035);
    },
    suspend() {
      enabled = false; clearTimeout(suspendTimer);
      if (disposed) return Promise.resolve();
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(0, context.currentTime, .012);
      suspendTimer = setTimeout(() => {
        if (!enabled && !disposed) context.suspend().catch(() => {});
      }, 90);
      return Promise.resolve();
    },
    update(state = {}, input = {}, rpm = 900) {
      lastMix = getRecordedEngineMix(state, input, rpm);
      if (enabled) {
        applyMix();const road=roadSoundMix(state),now=context.currentTime;
        for(const layer of ambience){layer.gain.gain.setTargetAtTime(road[layer.kind],now,.09);if(layer.kind==='roll')layer.filter.frequency.setTargetAtTime(road.frequency,now,.12);}
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; enabled = false; clearTimeout(suspendTimer); abort.abort();
      for (const { source, gain } of voices) { source.stop(); source.disconnect(); gain.disconnect(); }
      for (const {source,filter,gain} of ambience) {source.stop();source.disconnect();filter.disconnect();gain.disconnect();}
      master.disconnect(); highpass.disconnect(); tone.disconnect(); compressor.disconnect();
      context.close().catch(() => {});
    }
  };
}
