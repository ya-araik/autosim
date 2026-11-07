import { TRACK_HALF_WIDTH, TRACK_CLOSED, TRACK_LENGTH, TRACK_BOUNDS, sampleTrack, getTrackProjection, getTerrainHeight, STATIC_COLLIDERS } from './track-data.js';
export { TRACK_HALF_WIDTH, TRACK_BOUNDS };
export const trackClosed = TRACK_CLOSED;
export const trackLength = TRACK_LENGTH;
export const trackPoint = sampleTrack;
export const nearestTrack = getTrackProjection;

/**
 * BMW M5 E60-inspired planar vehicle model, SI units. Published hardware data:
 * https://www.press.bmwgroup.com/usa/article/attachment/T0076687EN_US/111723
 * https://www.press.bmwgroup.com/global/article/attachment/T0178809EN/265157
 * Torque curve between published points, tyre coefficients, inertia, CG height
 * and clutch calibration are engineering approximations, not BMW simulation data.
 *
 * THREE coordinates: heading 0 points +Z. Local LEFT is +X; a chase camera's
 * screen RIGHT is -X. Positive driver steering therefore produces NEGATIVE
 * steeringAngle and yaw. There is no track-following force or artificial drift
 * yaw. Novice's bounded stability moment represents differential braking.
 */
export const CAR_SPEC = Object.freeze({
  model: 'BMW M5 E60', engine: 'S85 V10', mass: 1820, wheelbase: 2.889,
  frontWeight: 0.522, frontTrack: 1.580, rearTrack: 1.566,
  powerKw: 373, powerPS: 507, peakTorque: 520, redline: 8250, idleRpm: 900,
  gearRatios: Object.freeze([0, 3.985, 2.652, 1.806, 1.392, 1.159, 1, 0.833]),
  finalDrive: 3.62, wheelRadius: 0.337, steeringRatio: 12.4, steeringWheelLock: 450,
  yawInertia: 3250, engineInertia: 0.16, drivenWheelInertia: 3.8, cgHeight: 0.54,
});
export const WORLD_CONTACTS = Object.freeze({ outerBarrierOffset: 7.15, carRadius: .94, bodyHalfLength: 2.43 });
export const MAX_SPEED = 250 / 3.6;
const TAU = Math.PI * 2;
const RPM_PER_RAD = 60 / TAU;
const G = 9.81;
const FIXED_STEP = 1 / 240;
const S = CAR_SPEC;
const FRONT_ARM = S.wheelbase * (1 - S.frontWeight);
const REAR_ARM = S.wheelbase * S.frontWeight;
const MAX_ROAD_STEER = S.steeringWheelLock * Math.PI / 180 / S.steeringRatio;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const smooth = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt));

/** Net full-load shaft torque; only the 6100/7750 rpm points are factory figures. */
export function engineTorqueAt(rpm) {
  const curve = [[0, 0], [900, 180], [2000, 325], [3000, 405], [4000, 455], [5000, 490], [6100, 520], [7000, 500], [7750, 459.6], [8250, 420], [8600, 0]];
  rpm = clamp(finite(rpm), 0, 8600);
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const [x, y] = curve[i - 1], [x2, y2] = curve[i];
      return y + (y2 - y) * (rpm - x) / (x2 - x);
    }
  }
  return 0;
}

function ratio(gear) { return S.gearRatios[gear] * S.finalDrive; }
function synchronousRpm(state, gear = state.gear) { return Math.abs(state.wheelOmega) * ratio(gear) * RPM_PER_RAD; }
function safeShiftRpm(state, gear) {
  const forward = state.vx * Math.sin(state.heading) + state.vz * Math.cos(state.heading);
  // Locked/slipping rear wheels must never make an unsafe downshift look safe.
  return Math.max(synchronousRpm(state, gear), Math.abs(forward) / S.wheelRadius * ratio(gear) * RPM_PER_RAD);
}

/** Select useful wheel torque with rev headroom; this is our calibration, not BMW firmware. */
export function kickdownGear(state) {
  let selected = state.gear;
  let pull = engineTorqueAt(safeShiftRpm(state, selected)) * ratio(selected);
  for (let gear = state.gear - 1; gear >= 1; gear--) {
    const rpm = safeShiftRpm(state, gear);
    if (rpm > S.redline - 750) continue;
    const candidate = engineTorqueAt(rpm) * ratio(gear);
    if (candidate > pull * 1.12) { selected = gear; pull = candidate; }
  }
  return selected;
}

export function createCarState(initial = {}) {
  const spawn = trackPoint(0), heading = wrapAngle(finite(initial.heading, spawn.heading));
  const speed = clamp(finite(initial.speed), 0, MAX_SPEED);
  let gear = clamp(Math.round(finite(initial.gear, 1)), 1, 7);
  if (!Number.isFinite(initial.gear)) while (gear < 7 && speed / S.wheelRadius * ratio(gear) * RPM_PER_RAD > 6200) gear++;
  const rpm = Math.max(S.idleRpm, speed / S.wheelRadius * ratio(gear) * RPM_PER_RAD);
  const state = {
    x: finite(initial.x, spawn.x), z: finite(initial.z, spawn.z), heading,
    vx: finite(initial.vx, Math.sin(heading) * speed), vz: finite(initial.vz, Math.cos(heading) * speed),
    yawRate: finite(initial.yawRate), speed: 0, speedKmh: 0, forwardSpeed: 0,
    slipAngle: 0, steering: 0, steeringAngle: 0, driftAmount: 0, handbrakeAmount: 0,
    offTrack: false, distanceTravelled: 0, elapsed: 0, trackT: 0, trackDistance: 0,
    lateralAcceleration: 0, throttle: 0, brake: 0, throttleEffective: 0,
    acceleration: { longitudinal: 0, lateral: 0 },
    tireLoads: { frontLeft: S.mass * G * S.frontWeight / 2, frontRight: S.mass * G * S.frontWeight / 2,
      rearLeft: S.mass * G * (1 - S.frontWeight) / 2, rearRight: S.mass * G * (1 - S.frontWeight) / 2 },
    tireForces: { frontLongitudinal: 0, frontLateral: 0, rearLongitudinal: 0, rearLateral: 0 },
    frontSlip: 0, rearSlip: 0, wheelSlip: 0, wheelOmega: speed / S.wheelRadius,
    engineOmega: rpm / RPM_PER_RAD, rpm, gear,
    clutch: speed > 4 ? 1 : 0, clutchTorque: 0, engineTorque: 0, engineTorqueNm: 0, engineLoad: 0,
    gearboxMode: initial.gearboxMode === 'manual' ? 'manual' : 'auto',
    engineOn: initial.engineOn !== false, shiftProgram: 3, shiftPhase: 'engaged',
    shiftTimer: 0, shiftDuration: 0, shiftTarget: gear, shiftFrom: gear, shiftCooldown: 0,
    shiftRejected: '', shiftCount: 0, kickdownHold: 0, kickdownArmed: true, dscIntervention: 0, longitudinalG: 0, lateralG: 0,
    contact: '', impactSpeed: 0,
    assistMode: initial.assistMode === 'pro' ? 'pro' : 'novice', requestedSteering: 0, steeringLimit: 1,
    stabilityIntervention: 0, brakeAssist: 0, effectiveBrake: 0, targetSpeedKmh: MAX_SPEED * 3.6,
    collision: { id: '', impulse: 0, speed: 0, normalX: 0, normalZ: 0, pointX: 0, pointZ: 0, age: 1 },
    _curveRefresh: 0,
    _shiftUpHeld: false, _shiftDownHeld: false,
  };
  if (!state.engineOn) { state.engineOmega = 0; state.rpm = 0; state.clutch = 0; }
  updateTelemetry(state);
  return state;
}

export function resetCar(state, initial = {}) {
  const fresh = createCarState(initial);
  for (const key of Object.keys(state)) delete state[key];
  return Object.assign(state, fresh);
}

/** Paused recovery keeps the session clock and driver settings, not momentum. */
export function respawnCar(state, t = state.trackT) {
  const preserved = { elapsed: state.elapsed, distanceTravelled: state.distanceTravelled,
    gearboxMode: state.gearboxMode, shiftProgram: state.shiftProgram, assistMode: state.assistMode };
  resetCar(state, { ...trackPoint(t), gearboxMode: preserved.gearboxMode, assistMode: preserved.assistMode });
  return Object.assign(state, preserved);
}

/** Robot requests are accepted only when the next ratio cannot over-rev S85. */
export function requestShift(state, direction) {
  if (!Number.isFinite(direction) || direction === 0) return false;
  const target = state.gear + Math.sign(finite(direction));
  return requestGear(state, target);
}

function requestGear(state, target) {
  state.shiftRejected = '';
  if (target < 1 || target > 7) { state.shiftRejected = 'gear-limit'; return false; }
  if (state.shiftPhase !== 'engaged' || state.shiftCooldown > 0) { state.shiftRejected = 'busy'; return false; }
  if (safeShiftRpm(state, target) > S.redline - 150) { state.shiftRejected = 'overrev'; return false; }
  state.shiftFrom = state.gear;
  state.shiftTarget = target;
  state.shiftTimer = 0;
  // Total disengage/select/re-engage timing is calibrated, not a quoted SMG spec.
  state.shiftDuration = [0, 0.44, 0.34, 0.27, 0.22, 0.17, 0.12][state.shiftProgram] + Math.max(0, Math.abs(target - state.gear) - 1) * .035;
  state.shiftPhase = 'cut';
  state.shiftCount++;
  return true;
}

// A capsule follows the actual body footprint, including the long bumpers.
// Three discs keep corner contacts stable without pretending that the 4.86 m
// body is a 2.2 m circle. Contacts exchange linear AND angular momentum.
const BODY_RADIUS = .94, BODY_END = 2.43 - BODY_RADIUS;
const colliderCache = new WeakMap();
function colliderIndex(colliders) {
  if (colliderCache.has(colliders)) return colliderCache.get(colliders);
  const cells = new Map(), cellSize = 16;
  const add = (shape, minX, maxX, minZ, maxZ) => {
    for (let x = Math.floor(minX / cellSize); x <= Math.floor(maxX / cellSize); x++) {
      for (let z = Math.floor(minZ / cellSize); z <= Math.floor(maxZ / cellSize); z++) {
        const key = x + ':' + z;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(shape);
      }
    }
  };
  for (const collider of colliders) {
    if (collider.type === 'barrier') {
      const points = collider.points || [], radius = collider.radius ?? .12;
      for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i], b = points[i + 1];
        const ax = a.x ?? a[0], az = a.z ?? a[1], bx = b.x ?? b[0], bz = b.z ?? b[1];
        const shape = { ...collider, type: 'segment', ax, az, bx, bz, radius };
        add(shape, Math.min(ax, bx) - radius, Math.max(ax, bx) + radius, Math.min(az, bz) - radius, Math.max(az, bz) + radius);
      }
    } else {
      const extent = collider.type === 'circle' ? collider.radius : Math.hypot(collider.halfX, collider.halfZ);
      add(collider, collider.x - extent, collider.x + extent, collider.z - extent, collider.z + extent);
    }
  }
  const index = { cells, cellSize };
  colliderCache.set(colliders, index); return index;
}

function obstacleContact(x, z, radius, shape) {
  if (shape.type === 'circle' || shape.type === 'segment') {
    let closestX = shape.x, closestZ = shape.z;
    if (shape.type === 'segment') {
      const dx = shape.bx - shape.ax, dz = shape.bz - shape.az;
      const t = clamp(((x - shape.ax) * dx + (z - shape.az) * dz) / Math.max(1e-9, dx * dx + dz * dz), 0, 1);
      closestX = shape.ax + dx * t; closestZ = shape.az + dz * t;
    }
    const dx = x - closestX, dz = z - closestZ, distance = Math.hypot(dx, dz);
    const penetration = radius + shape.radius - distance;
    if (penetration <= 0) return null;
    if (distance > 1e-7) return { nx: dx / distance, nz: dz / distance, penetration };
    const dxLine = (shape.bx ?? 1) - (shape.ax ?? 0), dzLine = (shape.bz ?? 0) - (shape.az ?? 0);
    const lineLength = Math.hypot(dxLine, dzLine) || 1;
    return { nx: -dzLine / lineLength, nz: dxLine / lineLength, penetration };
  }
  if (shape.type !== 'box') return null;
  const c = Math.cos(shape.yaw || 0), s = Math.sin(shape.yaw || 0), dx = x - shape.x, dz = z - shape.z;
  const lx = c * dx - s * dz, lz = s * dx + c * dz;
  const nxLocal = lx - clamp(lx, -shape.halfX, shape.halfX), nzLocal = lz - clamp(lz, -shape.halfZ, shape.halfZ);
  const distance = Math.hypot(nxLocal, nzLocal);
  if (distance >= radius) return null;
  let nx, nz, penetration;
  if (distance > 1e-7) { nx = nxLocal / distance; nz = nzLocal / distance; penetration = radius - distance; }
  else {
    const depthX = shape.halfX - Math.abs(lx), depthZ = shape.halfZ - Math.abs(lz);
    nx = depthX < depthZ ? (lx >= 0 ? 1 : -1) : 0;
    nz = depthX < depthZ ? 0 : (lz >= 0 ? 1 : -1);
    penetration = Math.min(depthX, depthZ) + radius;
  }
  return { nx: c * nx + s * nz, nz: -s * nx + c * nz, penetration };
}

function resolveContact(state, cx, cz, contact, id, restitution = .08) {
  const { nx, nz, penetration } = contact;
  const pointX = cx - nx * BODY_RADIUS, pointZ = cz - nz * BODY_RADIUS;
  const rx = pointX - state.x, rz = pointZ - state.z;
  const lever = rz * nx - rx * nz;
  const into = state.vx * nx + state.vz * nz + state.yawRate * lever;
  let impulse = 0;
  if (into < 0) {
    const bounce = into < -1.5 ? clamp(restitution, 0, .25) : 0;
    impulse = -(1 + bounce) * into / (1 / S.mass + lever * lever / S.yawInertia);
    state.vx += nx * impulse / S.mass; state.vz += nz * impulse / S.mass;
    state.yawRate += lever * impulse / S.yawInertia;
    const tx = -nz, tz = nx, tangentLever = rz * tx - rx * tz;
    const tangentSpeed = state.vx * tx + state.vz * tz + state.yawRate * tangentLever;
    const friction = clamp(-tangentSpeed / (1 / S.mass + tangentLever * tangentLever / S.yawInertia), -impulse * .34, impulse * .34);
    state.vx += tx * friction / S.mass; state.vz += tz * friction / S.mass;
    state.yawRate += tangentLever * friction / S.yawInertia;
    state.impactSpeed = Math.max(state.impactSpeed, -into);
  }
  // Positional correction removes overlap only. No velocity or energy is added.
  state.x += nx * Math.max(0, penetration - .0005); state.z += nz * Math.max(0, penetration - .0005);
  state.contact = id;
  if (impulse > state.collision.impulse || state.collision.age > .12) {
    Object.assign(state.collision, { id, impulse, speed: Math.max(0, -into), normalX: nx, normalZ: nz, pointX, pointZ, age: 0 });
  }
}

/** Static obstacle contacts, evaluated every 1/240 s to prevent tunnelling. */
export function applyWorldContacts(state, colliders = STATIC_COLLIDERS) {
  const { cells, cellSize } = colliderIndex(colliders);
  for (let pass = 0; pass < 2; pass++) {
    for (const offset of [-BODY_END, 0, BODY_END]) {
      const cx = state.x + Math.sin(state.heading) * offset, cz = state.z + Math.cos(state.heading) * offset;
      const nearby = new Set();
      for (let x = Math.floor((cx - BODY_RADIUS) / cellSize); x <= Math.floor((cx + BODY_RADIUS) / cellSize); x++) {
        for (let z = Math.floor((cz - BODY_RADIUS) / cellSize); z <= Math.floor((cz + BODY_RADIUS) / cellSize); z++) {
          for (const shape of cells.get(x + ':' + z) || []) nearby.add(shape);
        }
      }
      for (const shape of nearby) {
        const contact = obstacleContact(cx, cz, BODY_RADIUS, shape);
        if (contact) resolveContact(state, cx, cz, contact, shape.id || 'obstacle', shape.restitution);
      }
    }
  }
  return state;
}

function updateTelemetry(state) {
  state.speed = Math.hypot(state.vx, state.vz);
  state.speedKmh = state.speed * 3.6;
  const forward = state.vx * Math.sin(state.heading) + state.vz * Math.cos(state.heading);
  const lateral = state.vx * Math.cos(state.heading) - state.vz * Math.sin(state.heading);
  state.forwardSpeed = forward;
  state.slipAngle = state.speed > 0.2 ? Math.atan2(lateral, Math.abs(forward)) : 0;
  state.driftAmount = clamp((Math.abs(state.slipAngle) - 0.07) / 0.55, 0, 1) * clamp((state.speed - 3) / 8, 0, 1);
  const nearest = nearestTrack(state.x, state.z);
  state.trackT = nearest.t; state.trackDistance = nearest.distance; state.offTrack = nearest.distance > TRACK_HALF_WIDTH;
  state.y = state.offTrack ? getTerrainHeight(state.x, state.z, nearest) + .045 : nearest.y;
  state.roadGrade = nearest.grade;
  state.roadTangentX = nearest.tangent.x; state.roadTangentZ = nearest.tangent.z;
  state.rpm = state.engineOmega * RPM_PER_RAD;
  state.longitudinalG = state.acceleration.longitudinal / G;
  state.lateralG = state.acceleration.lateral / G;
}

// Smooth combined-slip saturation uses one friction budget per contact patch.
// Longitudinal wheelspin consumes lateral capacity; drifting does not change mu.
function tirePair(loadLeft, loadRight, slipRatio, slipAngle, mu, cornerStiffness) {
  let longitudinal = 0, lateral = 0;
  for (const load of [loadLeft, loadRight]) {
    const capacity = mu * 4500 * (Math.max(100, load) / 4500) ** 0.94;
    const loadScale = (Math.max(100, load) / 4500) ** 0.9;
    const fx = 115000 * loadScale * slipRatio;
    const fy = -cornerStiffness * loadScale * Math.tan(clamp(slipAngle, -1.3, 1.3));
    const demand = Math.hypot(fx, fy);
    const saturation = demand > 0 ? capacity * Math.tanh(demand / capacity) / demand : 1;
    longitudinal += fx * saturation; lateral += fy * saturation;
  }
  return { longitudinal, lateral };
}

function integrate(state, input, dt, mode) {
  state.collision.age += dt;
  if (state.collision.age > .15) { state.contact = ''; state.collision.impulse = 0; }
  state.impactSpeed = Math.max(0, state.impactSpeed - dt * 10);
  const fX = Math.sin(state.heading), fZ = Math.cos(state.heading), lX = fZ, lZ = -fX;
  const u = state.vx * fX + state.vz * fZ;
  const v = state.vx * lX + state.vz * lZ;
  const speed = Math.hypot(u, v);
  const shoulder = input.surface === 'asphalt' ? 0 : clamp((state.trackDistance - TRACK_HALF_WIDTH + 0.2) / 3, 0, 1);
  const mu = 1.20 * (1 - shoulder * 0.57);
  const novice = state.assistMode === 'novice';
  const assistedDrift = novice && mode === 'drift';
  state.throttle = input.throttle; state.requestedSteering = input.steering;
  // Driver input passes through the same steering rack for touch, analogue and
  // keyboard. The old exponential filter could command several wheel turns per
  // second after an input reversal. Bound rack slew before the tyre calculation.
  // Novice steering covers the useful slip-angle range at speed; Pro retains
  // the complete mechanical lock, including deliberately excessive steering.
  state.steeringLimit = novice ? clamp((Math.atan(S.wheelbase * mu * G * .78 / Math.max(1, speed * speed)) + .045) / MAX_ROAD_STEER, .10, 1) : 1;
  const countersteer = novice && speed > 4 ? clamp(-state.slipAngle * (assistedDrift ? .35 : .52) / MAX_ROAD_STEER, -.28, .28) : 0;
  const requested = clamp(input.steering * state.steeringLimit + countersteer, -1, 1);
  const filtered = smooth(state.steering, requested, novice ? 10 : 14, dt);
  const rackRate = novice ? 2.5 : 4;
  state.steering += clamp(filtered - state.steering, -rackRate * dt, rackRate * dt);
  state.steeringAngle = -state.steering * MAX_ROAD_STEER;
  state.handbrakeAmount = smooth(state.handbrakeAmount, input.handbrake, 16, dt);
  state._curveRefresh -= dt;
  if (novice && input.brakeAssist && state._curveRefresh <= 0) {
    let permitted = MAX_SPEED;
    for (const ahead of [8, 18, 32, 52, 80, 115]) {
      const middle = state.trackT + ahead / trackLength;
      const a = trackPoint(middle - 5 / trackLength), b = trackPoint(middle + 5 / trackLength);
      const curvature = Math.abs(wrapAngle(b.heading - a.heading)) / Math.max(1, Math.hypot(b.x - a.x, b.z - a.z));
      const bendSpeed = Math.sqrt(mu * G * .55 / Math.max(.0001, curvature));
      // Allow stopping distance to the future bend instead of braking at its apex.
      permitted = Math.min(permitted, Math.sqrt(bendSpeed * bendSpeed + 2 * mu * G * .40 * Math.max(0, ahead - 7)));
    }
    state.targetSpeedKmh = permitted * 3.6; state._curveRefresh = .10;
  } else if (!novice || !input.brakeAssist) state.targetSpeedKmh = MAX_SPEED * 3.6;
  const curveBrake = novice && input.brakeAssist && !state.offTrack && speed > 5
    ? clamp((speed - state.targetSpeedKmh / 3.6) * .13, 0, .68) : 0;
  state.brakeAssist = novice && input.brakeAssist ? smooth(state.brakeAssist, curveBrake, 7, dt) : 0;
  const brake = Math.max(input.brake, state.brakeAssist);
  state.brake = state.effectiveBrake = brake;
  state.shiftCooldown = Math.max(0, state.shiftCooldown - dt);
  state.kickdownHold = Math.max(0, state.kickdownHold - dt);
  if (input.throttle < .72) state.kickdownArmed = true;

  const previousLongAccel = clamp(state.acceleration.longitudinal, -12, 10);
  const previousLatAccel = clamp(state.acceleration.lateral, -13, 13);
  const frontLoad = clamp(S.mass * G * S.frontWeight - S.mass * previousLongAccel * S.cgHeight / S.wheelbase, S.mass * G * 0.24, S.mass * G * 0.78);
  const rearLoad = S.mass * G - frontLoad;
  const frontTransfer = clamp(S.mass * previousLatAccel * S.cgHeight * 0.54 / S.frontTrack, -frontLoad * 0.43, frontLoad * 0.43);
  const rearTransfer = clamp(S.mass * previousLatAccel * S.cgHeight * 0.46 / S.rearTrack, -rearLoad * 0.43, rearLoad * 0.43);
  Object.assign(state.tireLoads, {
    frontLeft: frontLoad / 2 - frontTransfer, frontRight: frontLoad / 2 + frontTransfer,
    rearLeft: rearLoad / 2 - rearTransfer, rearRight: rearLoad / 2 + rearTransfer,
  });

  const cos = Math.cos(state.steeringAngle), sin = Math.sin(state.steeringAngle);
  const frontSideVelocity = v + FRONT_ARM * state.yawRate;
  const frontForward = u * cos + frontSideVelocity * sin;
  const frontSide = frontSideVelocity * cos - u * sin;
  // A smooth rolling-speed regularisation avoids a discontinuous stiffness
  // transition and the near-zero-speed singularity of a pure bicycle model.
  state.frontSlip = Math.atan2(frontSide, Math.hypot(2.0, frontForward));
  state.rearSlip = Math.atan2(v - REAR_ARM * state.yawRate, Math.hypot(2.0, u));

  let shiftClutch = 1, torqueCut = false;
  if (state.shiftPhase !== 'engaged') {
    state.shiftTimer += dt;
    const progress = state.shiftTimer / state.shiftDuration;
    if (progress < 0.25) { state.shiftPhase = 'cut'; shiftClutch = 1 - progress / 0.25; torqueCut = true; }
    else if (progress < 0.6) { state.shiftPhase = 'select'; shiftClutch = 0; torqueCut = true; state.gear = state.shiftTarget; }
    else if (progress < 1) { state.shiftPhase = 'engage'; shiftClutch = (progress - 0.6) / 0.4; }
    else { state.shiftPhase = 'engaged'; state.gear = state.shiftTarget; state.shiftCooldown = 0.24; }
  } else if (state.gearboxMode === 'auto' && state.engineOn && state.shiftCooldown <= 0) {
    const upRpm = state.kickdownHold > 0 ? 7900 : 3100 + input.throttle * 4800;
    const pedalRequest = input.throttle >= .88 && state.kickdownArmed;
    if (pedalRequest) state.kickdownArmed = false;
    const wantsKickdown = pedalRequest && brake < .1 && input.handbrake < .1 && u > 4
      && Math.abs(state.wheelSlip) < .18 && Math.abs(state.slipAngle) < .2;
    const target = wantsKickdown ? kickdownGear(state) : state.gear;
    if (target < state.gear && requestGear(state, target)) state.kickdownHold = 1.4;
    else if (state.gear < 7 && state.rpm > upRpm && state.clutch > 0.88 && u > 3) requestShift(state, 1);
    else if (state.gear > 1 && state.rpm < 1300 + input.throttle * 1450 && synchronousRpm(state, state.gear - 1) < upRpm - 900) requestShift(state, -1);
  }

  const slipExcess = clamp((Math.abs(state.wheelSlip) - (assistedDrift ? .24 : .095)) * 4, 0, 0.88);
  const sideslipExcess = clamp((Math.abs(state.slipAngle) - (assistedDrift ? .24 : .1)) * 2.4, 0, 0.85);
  const tractionAssist = novice;
  const intervention = !tractionAssist || state.handbrakeAmount > 0.2 ? 0 : Math.max(slipExcess, sideslipExcess);
  state.dscIntervention = tractionAssist ? smooth(state.dscIntervention, intervention, 18, dt) : 0;
  let throttleTarget = state.engineOn ? input.throttle * (1 - state.dscIntervention) : 0;
  if (tractionAssist && state.clutch > 0.08 && state.shiftPhase === 'engaged') {
    const lateralUsage = clamp(Math.abs(state.tireForces.rearLateral) / (rearLoad * mu), 0, 0.95);
    const tractionTorque = rearLoad * mu * Math.sqrt(1 - lateralUsage * lateralUsage) * S.wheelRadius / (ratio(state.gear) * 0.90);
    const engineDrag = 35 + state.rpm * 0.009;
    const tractionThrottle = (tractionTorque * (assistedDrift ? 1.3 : .99) + engineDrag) / (engineTorqueAt(state.rpm) + engineDrag);
    throttleTarget = Math.min(throttleTarget, tractionThrottle);
  }
  if (brake > 0.2) throttleTarget *= 0.1;
  if (torqueCut || state.rpm >= S.redline || u > MAX_SPEED) throttleTarget = 0;
  if (state.shiftPhase === 'engage' && state.shiftTarget > state.shiftFrom) throttleTarget *= shiftClutch;
  if (state.shiftPhase === 'select' && state.shiftTarget < state.shiftFrom && state.rpm < synchronousRpm(state)) throttleTarget = Math.max(throttleTarget, 0.55);
  state.throttleEffective = torqueCut && state.shiftTarget > state.shiftFrom ? 0 : smooth(state.throttleEffective, throttleTarget, 22, dt);
  const frictionTorque = 35 + state.rpm * 0.009;
  const idleAssist = state.engineOn ? clamp((S.idleRpm - state.rpm) * 0.8 + frictionTorque, 0, 140) * (1 - input.throttle) : 0;
  const engineTorque = state.engineOn ? state.throttleEffective * (engineTorqueAt(state.rpm) + frictionTorque) - frictionTorque + idleAssist : -frictionTorque;
  state.engineTorque = state.engineTorqueNm = engineTorque;
  state.engineLoad = clamp(Math.max(0, engineTorque) / Math.max(100, engineTorqueAt(state.rpm)), 0, 1);

  const totalRatio = ratio(state.gear);
  const syncRpm = synchronousRpm(state);
  const launchRpm = 1350 + input.throttle * 2250;
  const launchClutch = syncRpm >= launchRpm - 300 ? 1 : clamp((Math.max(0, engineTorque) + (state.rpm - launchRpm) * 0.42) / 720, 0, 1);
  let clutchTarget = launchClutch * shiftClutch;
  if (!state.engineOn || (input.throttle < 0.02 && syncRpm < 1050) || state.handbrakeAmount > 0.3) clutchTarget = 0;
  state.clutch = smooth(state.clutch, clutchTarget, clutchTarget < state.clutch ? 40 : 22, dt);
  const clutchCapacity = 720 * state.clutch;
  const wheelDenominator = Math.max(3, Math.abs(u));
  const rearBrake = brake * rearLoad * mu * S.wheelRadius * 0.96 + state.handbrakeAmount * 5800;
  const clutchStiffness = 110;
  const freeEngine = Math.max(0, state.engineOmega + engineTorque / S.engineInertia * dt);
  const clutchFor = wheel => clamp(clutchStiffness * (freeEngine - wheel * totalRatio) / (1 + clutchStiffness * dt / S.engineInertia), -clutchCapacity, clutchCapacity);
  const rearFor = wheel => tirePair(state.tireLoads.rearLeft, state.tireLoads.rearRight,
    (wheel * S.wheelRadius - u) / wheelDenominator, state.rearSlip, mu, 55000);
  // Implicit coupled clutch/wheel solve prevents numerical wheelspin at low
  // speed. Its monotone residual includes tyre reaction and brake torque.
  const maxWheelChange = dt * (720 * totalRatio + rearLoad * mu * S.wheelRadius + rearBrake) / S.drivenWheelInertia + 1;
  let low = state.wheelOmega - maxWheelChange, high = state.wheelOmega + maxWheelChange;
  for (let iteration = 0; iteration < 24; iteration++) {
    const wheel = (low + high) / 2;
    const torque = clutchFor(wheel) * totalRatio * 0.90 - rearFor(wheel).longitudinal * S.wheelRadius - rearBrake * Math.tanh(wheel / 0.65);
    const residual = wheel - state.wheelOmega - dt * torque / S.drivenWheelInertia;
    if (residual > 0) high = wheel; else low = wheel;
  }
  state.wheelOmega = (low + high) / 2;
  state.clutchTorque = clutchFor(state.wheelOmega);
  state.engineOmega = Math.max(0, state.engineOmega + (engineTorque - state.clutchTorque) / S.engineInertia * dt);
  state.wheelSlip = (state.wheelOmega * S.wheelRadius - u) / wheelDenominator;
  const rearForce = rearFor(state.wheelOmega);
  // Brake demand must approach zero continuously at standstill. Math.sign here
  // previously switched the full front brake force on each tiny reversal.
  const frontBrakeSlip = -Math.tanh(frontForward / .7) * brake * 0.12;
  const frontForce = tirePair(state.tireLoads.frontLeft, state.tireLoads.frontRight, frontBrakeSlip, state.frontSlip, mu, 48000);
  const frontLong = frontForce.longitudinal * cos - frontForce.lateral * sin;
  const frontLat = frontForce.longitudinal * sin + frontForce.lateral * cos;
  Object.assign(state.tireForces, { frontLongitudinal: frontLong, frontLateral: frontLat, rearLongitudinal: rearForce.longitudinal, rearLateral: rearForce.lateral });

  const gradeForce = input.surface === 'asphalt' ? 0 : -S.mass * G * state.roadGrade / Math.hypot(1, state.roadGrade);
  // Gravity follows the road's longitudinal grade and is projected into the
  // body's current basis. It never aligns heading or position to the centreline.
  let longitudinalForce = frontLong + rearForce.longitudinal - 0.5 * 1.225 * 0.7 * u * Math.abs(u)
    + gradeForce * (state.roadTangentX * fX + state.roadTangentZ * fZ);
  const lateralForce = frontLat + rearForce.lateral + gradeForce * (state.roadTangentX * lX + state.roadTangentZ * lZ);
  let yawTorque = FRONT_ARM * frontLat - REAR_ARM * rearForce.lateral;
  const yawLimit = mu * G * .80 / Math.max(4, speed);
  const desiredYaw = clamp(u * Math.tan(state.steeringAngle) / S.wheelbase, -yawLimit, yawLimit);
  const yawError = desiredYaw - state.yawRate;
  const stabilityCapacity = assistedDrift ? 1500 : 3000;
  const stabilityDemand = novice && Math.abs(u) > 4 && state.handbrakeAmount < .15
    ? clamp((yawError * 2.8 + state.slipAngle * 3.0) * S.yawInertia, -stabilityCapacity, stabilityCapacity) : 0;
  // A differential-braking equivalent can dissipate energy and oppose excess
  // yaw; it cannot add thrust, move the car sideways, or steer toward the track.
  const stabilityTorque = Math.abs(yawError) > (assistedDrift ? .2 : .08) || Math.abs(state.slipAngle) > (assistedDrift ? .20 : .08) ? stabilityDemand : 0;
  state.stabilityIntervention = novice ? smooth(state.stabilityIntervention, Math.abs(stabilityTorque) / 3000, 10, dt) : 0;
  yawTorque += stabilityTorque;
  longitudinalForce -= Math.sign(u) * Math.abs(stabilityTorque) / (S.frontTrack / 2);
  state.yawRate += yawTorque / S.yawInertia * dt;
  state.yawRate *= Math.exp(-0.035 * dt);
  state.vx += (fX * longitudinalForce + lX * lateralForce) / S.mass * dt;
  state.vz += (fZ * longitudinalForce + lZ * lateralForce) / S.mass * dt;

  const updatedSpeed = Math.hypot(state.vx, state.vz);
  const rollingDecel = G * (0.0135 + shoulder * 0.065) + shoulder * updatedSpeed * 0.045;
  const rollFactor = updatedSpeed > 0 ? Math.max(0, updatedSpeed - rollingDecel * dt) / updatedSpeed : 0;
  state.vx *= rollFactor; state.vz *= rollFactor;
  // Static friction avoids sub-centimetre brake creep and stationary yaw.
  if (Math.hypot(state.vx, state.vz) < 0.07 && (input.throttle < 0.02 || brake > .4)) {
    state.vx = 0; state.vz = 0; state.yawRate = 0; state.wheelOmega = 0;
  }
  const longitudinalAccel = (state.vx * fX + state.vz * fZ - u) / dt;
  const lateralAccel = (state.vx * lX + state.vz * lZ - v) / dt;
  state.acceleration.longitudinal = smooth(state.acceleration.longitudinal, longitudinalAccel, 18, dt);
  state.acceleration.lateral = smooth(state.acceleration.lateral, lateralAccel, 18, dt);
  state.lateralAcceleration = state.acceleration.lateral;
  state.heading = wrapAngle(state.heading + state.yawRate * dt);
  const dx = state.vx * dt, dz = state.vz * dt;
  state.x += dx; state.z += dz; state.distanceTravelled += Math.hypot(dx, dz); state.elapsed += dt;
  if (input.worldContacts !== false) applyWorldContacts(state, input.colliders || STATIC_COLLIDERS);
  updateTelemetry(state);
}

/**
 * Inputs: steering [-1,1] RIGHT positive, throttle/brake/handbrake [0,1]
 * (handbrake also accepts bool); assistMode novice/pro, brakeAssist bool.
 * Novice is the default. Pro disables DSC in both race and drift.
 * Neither assistance mode supplies throttle or follows the track centreline.
 * gearboxMode auto/manual, shiftUp/shiftDown edge-triggered bool, shiftProgram
 * 1..5 auto /1..6 manual, engineOn bool. surface:'asphalt' is a bench-test
 * override; worldContacts:false disables barriers for isolated tests. An
 * optional colliders array replaces the shared static world in contact tests. dt<=0
 * does not mutate anything; each call caps catch-up at 0.1s.
 */
export function stepCar(state, input = {}, dt = 1 / 120, mode = 'race') {
  const duration = clamp(finite(dt), 0, 0.1);
  if (!duration) return state;
  if (input.gearboxMode === 'auto' || input.gearboxMode === 'manual') state.gearboxMode = input.gearboxMode;
  if (typeof input.engineOn === 'boolean') state.engineOn = input.engineOn;
  if (input.assistMode === 'novice' || input.assistMode === 'pro') state.assistMode = input.assistMode;
  state.shiftProgram = clamp(Math.round(finite(input.shiftProgram, state.shiftProgram)), 1, state.gearboxMode === 'manual' ? 6 : 5);
  if (input.shiftUp && !state._shiftUpHeld) requestShift(state, 1);
  else if (input.shiftDown && !state._shiftDownHeld) requestShift(state, -1);
  state._shiftUpHeld = Boolean(input.shiftUp); state._shiftDownHeld = Boolean(input.shiftDown);
  const controls = {
    steering: clamp(finite(input.steering), -1, 1), throttle: clamp(finite(input.throttle), 0, 1),
    brake: clamp(finite(input.brake), 0, 1), handbrake: clamp(finite(Number(input.handbrake)), 0, 1), surface: input.surface,
    brakeAssist: input.brakeAssist !== false,
    worldContacts: input.worldContacts,
    colliders: input.colliders,
  };
  const steps = Math.ceil(duration / FIXED_STEP), step = duration / steps;
  for (let i = 0; i < steps; i++) integrate(state, controls, step, mode);
  return state;
}
