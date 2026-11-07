# Recorded V10 audio provenance

The engine now uses **real recorded Audi R8 LMS Ultra 5.2 V10 audio**. It is not
a recording of the BMW S85. No procedural combustion, oscillator engine, or
proprietary racing-game sound bank is used, including as a fallback.

Source: **Moscow Raceway GT Race sounds**, Walking.With.Microphones, 2021-01-30.
https://freesound.org/people/Walking.With.Microphones/sounds/556039/
Licence: **CC0 1.0**, https://creativecommons.org/publicdomain/zero/1.0/
The author's description identifies the cars in order. Only Audi passes 4, 7,
8 and 9 were extracted. This is an exterior field recording made on a Zoom H6.
Public HQ Ogg preview downloaded 2026-09-19:
https://cdn.freesound.org/previews/556/556039_4835746-hq.ogg

Audi's own description confirms the R8 LMS Ultra has a 5.2-litre V10:
https://www.audi-mediacenter.com/en/press-releases/audi-r8-lms-ultra-to-be-launched-in-2012-1045/download

## Editing and limitations

Eight mono PCM16 / 32 kHz loops are derived from four separate recorded passes.
Edits comprise trimming, filtering, envelope leveling, pitch drift compensation,
resampling, normalization and an overlapping wrap crossfade. The JSON manifest
records every source time range, pass number, sampler anchor, file size and hash.

**These are not eight measured steady-state dyno recordings.** The nominal
1800/3300/5100/7400 RPM values calibrate the sampler. In particular the lower-RPM
loops are transposed from race-pass recordings, not separately recorded idle.
The load/coast names describe the playback roles of approach/recede extracts;
no throttle telemetry was available in the source recording. This is a sampled
interpretation of a recorded V10 and does not claim acoustic identity with S85.

The car physics supplies actual RPM, engine load, effective throttle and shift
phase. Adjacent RPM banks and load/coast extracts are blended at equal power.
Playback rate follows the drivetrain's 0–8250 RPM range. SMG cut/select phases
reduce the sound; the actual downshift rev-match reopens the load layer, using
the physics RPM rather than a separate cosmetic pitch ramp.

The recording is fetched only after the visitor enables sound. Pause/close
mutes the master and suspends the AudioContext. Download/decode failure rejects
`ready` for the existing accessible UI error path; there is no synthesis fallback.

## Sources researched but not shipped

- Sweet SFX BMW M5 E60 V10, https://www.sweetsfx.com/product/bmw-m5-e60-v10/
  Exact S85 professional recording library; not acquired. Price on request;
  commercial licence required. https://www.sweetsfx.com/licensing/
- Freesound 429099, Audi_R8_01.wav by ikbenraar, CC BY 4.0: the description does
  not identify V8 versus V10, so it was not used.
- Freesound 457559 by florianreichelt, CC0 Lamborghini: model/engine unspecified,
  so it was not used.
- VDrift/Speed Dreams banks were investigated; recording provenance was not
  sufficiently established for this particular V10 requirement.
- Forza / Assetto Corsa / NFS-derived banks were excluded.
