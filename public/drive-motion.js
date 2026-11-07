import { TRACK_HALF_WIDTH, getTrackProjection, getTerrainHeight } from './track-data.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = v => Math.atan2(Math.sin(v), Math.cos(v));
const finite = v => Number.isFinite(v) ? v : 0;

// Exact solution for a damped spring with a held target. No frame-rate-dependent
// lerp or random camera shake. Frequencies are authored, not measured E60 data.
export function spring(axis, target, dt, frequency = 1.8, damping = .82) {
  if (!(dt > 0)) return axis.value;
  const w = Math.PI * 2 * frequency, d = w * damping;
  const q = w * Math.sqrt(1 - damping * damping), t = Math.min(dt, .05);
  const x = axis.value - target, b = (axis.velocity + d * x) / q;
  const co = Math.cos(q * t), si = Math.sin(q * t), decay = Math.exp(-d * t);
  axis.value = target + decay * (x * co + b * si);
  axis.velocity = decay * ((b * q - d * x) * co - (x * q + d * b) * si);
  return axis.value;
}
const axis = (value = 0) => ({ value, velocity: 0 });

// Match the rendered asphalt/kerb/shoulder strips, including their actual lifts.
// The surface is the site's reconstruction, not a surveyed Nordschleife scan.
export function sampleContact(x, z) {
  const p = getTrackProjection(x, z), d = p.distance;
  const surface = d <= TRACK_HALF_WIDTH ? 'asphalt' : d >= 4.73 && d <= 5.35 ? 'kerb' : 'grass';
  return { x, z, y: surface === 'asphalt' ? p.y + .025 : surface === 'kerb' ? p.y + .052 : getTerrainHeight(x, z, p) + .014,
    surface, grade: p.grade, tangent: p.tangent };
}

export function sampleWheelSupport(state, wheels, sample = sampleContact) {
  const s = Math.sin(state.heading), c = Math.cos(state.heading);
  const contacts = wheels.map(w => {
    const rest = w.restPosition || w.pivot.position;
    const ground = sample(state.x + c * rest.x + s * rest.z, state.z - s * rest.x + c * rest.z);
    return { ...ground, localX: rest.x, localZ: rest.z, centreY: ground.y + w.radius, restY: rest.y };
  });
  const average = (list, key) => list.reduce((sum, w) => sum + w[key], 0) / list.length;
  const front = contacts.filter(w => w.localZ > 0), rear = contacts.filter(w => w.localZ < 0);
  const left = contacts.filter(w => w.localX > 0), right = contacts.filter(w => w.localX < 0);
  const slopeZ = (average(front, 'y') - average(rear, 'y')) / (average(front, 'localZ') - average(rear, 'localZ'));
  const slopeX = (average(left, 'y') - average(right, 'y')) / (average(left, 'localX') - average(right, 'localX'));
  const height = contacts.reduce((sum, w) => sum + w.centreY - w.restY - slopeX * w.localX - slopeZ * w.localZ, 0) / contacts.length;
  return { height, pitch: -Math.atan(slopeZ), roll: Math.atan(slopeX), contacts };
}

export function createChassisMotion() {
  const pitch = axis(), roll = axis(), heave = axis();
  let ready = false, lastX = 0, lastZ = 0, lastHeight = 0, verticalSpeed = 0, verticalAcceleration = 0;
  return {
    reset() { ready = false; },
    update(state, support, dt) {
      const teleport = Math.hypot(state.x - lastX, state.z - lastZ) > 6;
      if (!ready || teleport) {
        Object.assign(pitch, axis(support.pitch)); Object.assign(roll, axis(support.roll)); Object.assign(heave, axis());
        lastHeight = support.height; verticalSpeed = verticalAcceleration = 0; ready = true;
      } else if (dt > 0) {
        const rate = (support.height - lastHeight) / dt;
        const acceleration = clamp((rate - verticalSpeed) / dt, -18, 18);
        verticalAcceleration += (acceleration - verticalAcceleration) * (1 - Math.exp(-10 * dt));
        verticalSpeed = rate;
        // Positive longitudinal acceleration lifts the nose (-X rotation).
        // Positive lateral acceleration is toward local left: body leans right.
        const dive = clamp(-finite(state.acceleration?.longitudinal) * .0038, -.029, .040);
        const lean = clamp(finite(state.acceleration?.lateral) * .0042, -.044, .044);
        spring(pitch, support.pitch + dive, dt, 1.75, .82);
        spring(roll, support.roll + lean, dt, 1.9, .84);
        spring(heave, clamp(-verticalAcceleration / 150, -.045, .045), dt, 2.05, .8);
        // Bound suspension travel over discontinuous kerb edges; wheels retain
        // independent contact and the rigid body never stretches with them.
        pitch.value = clamp(pitch.value, support.pitch - .065, support.pitch + .065);
        roll.value = clamp(roll.value, support.roll - .065, support.roll + .065);
      }
      lastX = state.x; lastZ = state.z; lastHeight = support.height;
      return { ...support, bodyPitch: pitch.value, bodyRoll: roll.value, heave: heave.value };
    }
  };
}

export function createCameraMotion() {
  const yaw = axis(), lateral = axis(), longitudinal = axis(), fov = axis();
  let ready = false, lastX = 0, lastZ = 0, lastMode;
  return {
    reset() { ready = false; },
    update(state, dt, mode, enabled = true) {
      const reset = !ready || mode !== lastMode || Math.hypot(state.x-lastX, state.z-lastZ) > 6;
      if (reset || !enabled) {
        Object.assign(yaw, axis(state.heading)); Object.assign(lateral, axis());
        Object.assign(longitudinal, axis()); Object.assign(fov, axis()); ready = true;
      } else if (dt > 0) {
        // Lag the angle, not world translation: acceleration never leaves the
        // camera metres behind. Shortest-angle wrapping survives ±PI crossings.
        yaw.value = state.heading + wrap(yaw.value - state.heading);
        spring(yaw, state.heading, dt, 2.2, .88);
        yaw.value = state.heading + clamp(wrap(yaw.value-state.heading), -.10, .10);
        spring(lateral, clamp(-finite(state.acceleration?.lateral) * .004, -.045, .045), dt, 2.1, .85);
        spring(longitudinal, clamp(-finite(state.acceleration?.longitudinal) * .005, -.05, .04), dt, 2, .85);
        spring(fov, clamp((finite(state.speed)-8)/45, 0, 1)*3, dt, 1.1, .9);
      }
      lastMode = mode; lastX = state.x; lastZ = state.z;
      return { heading: yaw.value, lateral: lateral.value, longitudinal: longitudinal.value, fov: fov.value };
    }
  };
}

export function roadSoundMix(state = {}) {
  const speed = Math.max(0, finite(state.speed)), amount = clamp(speed / 45, 0, 1);
  const offroad = state.surface === 'grass' || state.trackDistance > TRACK_HALF_WIDTH;
  return { roll: Math.pow(amount, .8) * (offroad ? .11 : .055), wind: amount * amount * .032,
    frequency: (offroad ? 190 : 320) + amount * 620 };
}
