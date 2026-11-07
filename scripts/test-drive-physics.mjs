import assert from 'node:assert/strict';
import { createCarState, resetCar, stepCar, requestShift, trackPoint, nearestTrack,
  trackLength, trackClosed, TRACK_HALF_WIDTH, TRACK_BOUNDS, CAR_SPEC, engineTorqueAt, kickdownGear, WORLD_CONTACTS, applyWorldContacts, respawnCar } from '../public/drive-physics.js';

const BENCH = { surface: 'asphalt', worldContacts: false, assistMode: 'pro', brakeAssist: false };
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function run(state, seconds, controls = {}, mode = 'race', hz = 120, bench = true) {
  for (let i = 0; i < Math.round(seconds * hz); i++) {
    const input = typeof controls === 'function' ? controls(i / hz, state) : controls;
    stepCar(state, { ...(bench ? BENCH : {}), ...input }, 1 / hz, mode);
  }
  return state;
}
function allFinite(value, path = 'state') {
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number') assert.ok(Number.isFinite(item), `${path}.${key} remains finite`);
    else if (item && typeof item === 'object') allFinite(item, `${path}.${key}`);
  }
}

assert.equal(CAR_SPEC.mass, 1820);
assert.equal(CAR_SPEC.wheelbase, 2.889);
assert.equal(CAR_SPEC.gearRatios.length, 8);
assert.equal(engineTorqueAt(6100), 520);
assert.ok(Math.abs(engineTorqueAt(7750) * 7750 * Math.PI / 30 / 1000 - 373) < 1);
assert.ok(trackLength > 2550 && trackLength < 2565, 'Season 2 covers Eschbach to Stefan-Bellof-S');
assert.equal(trackClosed, false);
assert.ok(TRACK_BOUNDS.maxX > 1800 && TRACK_BOUNDS.maxZ > 800);
assert.notDeepEqual(trackPoint(0), trackPoint(1), 'An open stage cannot wrap its finish to the start');
assert.deepEqual(trackPoint(-1), trackPoint(0));
assert.deepEqual(trackPoint(2), trackPoint(1));
for (let i = 0; i < 100; i++) {
  const p = trackPoint(i / 100);
  assert.ok(nearestTrack(p.x, p.z).distance < 0.035, `Projection at ${i}`);
  assert.ok(Math.abs(Math.hypot(p.tangent.x, p.tangent.z) - 1) < 1e-12);
}

const rest = run(createCarState(), 4, { steering: 1, handbrake: true }, 'drift');
assert.equal(rest.speed, 0, 'No autonomous acceleration at idle');
assert.equal(rest.distanceTravelled, 0, 'Steering cannot rotate or move a stationary car');
assert.equal(rest.yawRate, 0);
assert.equal(rest.acceleration.longitudinal, 0, 'Stationary G-meter reads zero');
assert.equal(rest.acceleration.lateral, 0);
assert.ok(Math.abs(rest.heading - createCarState().heading) < 1e-12);
assert.ok(Math.abs(rest.rpm - 900) < 2);
const paused = createCarState({ speed: 15 });
const pausedSnapshot = structuredClone(paused);
stepCar(paused, { throttle: 1, shiftUp: true, engineOn: false }, 0);
stepCar(paused, { steering: 1 }, -1);
assert.deepEqual(paused, pausedSnapshot, 'Pausing freezes drivetrain as well as car');

// Explicit chase-camera basis: camera behind forward F has screen-right
// F cross world-up = (-cos heading, 0, sin heading). Test four headings.
for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  for (const driverSteer of [-0.15, 0.15]) {
    const car = createCarState({ x: 0, z: 0, heading, speed: 20, gear: 2 });
    run(car, 1, { steering: driverSteer, throttle: 0.2 });
    const screenRightDisplacement = car.x * -Math.cos(heading) + car.z * Math.sin(heading);
    assert.ok(screenRightDisplacement * driverSteer > 0, 'Driver-right projects screen-right');
    assert.ok(angleDifference(car.heading, heading) * driverSteer < 0, 'Right is negative THREE yaw');
    assert.ok(car.steeringAngle * driverSteer < 0, 'Front wheels use the same coordinate convention');
  }
}
const inertial = createCarState({ heading: 0, speed: 20, gear: 2 });
stepCar(inertial, { ...BENCH, steering: 1 }, 1 / 120);
assert.ok(Math.abs(inertial.heading) < 0.001, 'A 1.82-tonne body cannot instantly follow the wheel');
assert.ok(Math.abs(inertial.yawRate) < 0.08);

const accelerationTimes = {};
for (const mode of ['race', 'drift']) {
  const car = createCarState({ heading: 0 });
  let elapsed100 = null;
  for (let i = 0; i < 120 * 7; i++) {
    stepCar(car, { ...BENCH, throttle: 1 }, 1 / 120, mode);
    if (car.speedKmh >= 100 && elapsed100 === null) elapsed100 = car.elapsed;
  }
  assert.ok(elapsed100 >= 4.7 && elapsed100 <= 5.5, `${mode}: 0–100 km/h ${elapsed100}`);
  assert.ok(car.gear >= 3, 'Auto SMG actually shifts under full load');
  assert.ok(car.tireLoads.rearLeft + car.tireLoads.rearRight > CAR_SPEC.mass * 9.81 * (1 - CAR_SPEC.frontWeight), 'Acceleration transfers weight rearward');
  accelerationTimes[mode] = Number(elapsed100.toFixed(3));
}

// A new full-pedal request selects a safe ratio in one clutch operation.
for (const [kmh, expectedGear] of [[100, 3], [160, 4], [220, 6]]) {
  const car = createCarState({ heading: 0, speed: kmh / 3.6, gear: 7 });
  assert.equal(kickdownGear(car), expectedGear);
  stepCar(car, {...BENCH, throttle: 1}, 1 / 120);
  assert.equal(car.shiftTarget, expectedGear, 'Kickdown does not walk down six individual paddle shifts');
  assert.equal(car.shiftPhase, 'cut', 'Full pedal starts the clutch operation on the first physics step');
  let cut = false, peak = 0;
  run(car, .8, (_, s) => { cut ||= s.shiftPhase === 'select' && Math.abs(s.clutchTorque) < 15; peak = Math.max(peak, s.rpm); return {throttle: 1}; });
  assert.equal(car.gear, expectedGear); assert.equal(car.shiftCount, 1);
  assert.ok(cut && peak < CAR_SPEC.redline + 100, 'Kickdown cuts torque without mechanical overrev');
  const beforeRelease = car.shiftCount;
  run(car, .35, {throttle:.78});
  assert.equal(car.shiftCount, beforeRelease, 'Partial pedal after kickdown cannot immediately upshift back');
}
const manualKick = createCarState({heading:0, speed:100/3.6, gear:7, gearboxMode:'manual'});
run(manualKick, 1, {throttle:1}); assert.equal(manualKick.gear,7, 'Manual mode never kicks down');
const lockedRear = createCarState({heading:0, speed:160/3.6, gear:7}); lockedRear.wheelOmega=0;
assert.equal(kickdownGear(lockedRear),4,'Road speed protects ratio selection even with locked driven wheels');
const hunting = createCarState({heading:0}); let lastShift=0, downshifts=0;
run(hunting,18,(_,s)=>{if(s.shiftCount!==lastShift){if(s.shiftTarget<s.shiftFrom)downshifts++;lastShift=s.shiftCount;}return{throttle:1};});
assert.equal(downshifts,0,'Holding full throttle from launch does not retrigger kickdown after upshifts or wheelspin');

const braking = createCarState({ heading: 0, speed: 100 / 3.6, gear: 3 });
run(braking, 0.3, { brake: 1 });
assert.ok(braking.tireLoads.frontLeft + braking.tireLoads.frontRight > CAR_SPEC.mass * 9.81 * CAR_SPEC.frontWeight, 'Braking transfers weight forward');
run(braking, 4.7, { brake: 1 });
assert.equal(braking.speed, 0, 'Foot brake stops the car without reversing it');
assert.ok(braking.distanceTravelled > 30 && braking.distanceTravelled < 42, 'Plausible 100–0 braking distance');

const shifted = createCarState({ speed: 19, gear: 1, gearboxMode: 'manual' });
const originalRpm = shifted.rpm;
const phases = new Set();
let clutchReleased = false, fuelCut = false;
run(shifted, 0.65, () => {
  phases.add(shifted.shiftPhase);
  if (shifted.shiftPhase === 'select' && Math.abs(shifted.clutchTorque) < 15) clutchReleased = true;
  if (shifted.shiftPhase === 'select' && shifted.throttleEffective === 0) fuelCut = true;
  return { throttle: 0.7, shiftUp: true };
});
assert.equal(shifted.gear, 2);
assert.equal(shifted.shiftCount, 1, 'Holding a paddle does not trigger repeated shifts');
assert.ok(['cut', 'select', 'engage', 'engaged'].every(phase => phases.has(phase)));
assert.ok(clutchReleased && fuelCut, 'Single-clutch shift interrupts transmitted torque');
assert.ok(shifted.rpm < originalRpm * 0.85, 'An upshift drops real engine RPM');
const unsafeDownshift = createCarState({ speed: 40, gear: 3, gearboxMode: 'manual' });
assert.equal(requestShift(unsafeDownshift, -1), false);
assert.equal(unsafeDownshift.shiftRejected, 'overrev');
assert.equal(unsafeDownshift.gear, 3);
const first = createCarState({ speed: 15, gear: 1, gearboxMode: 'manual' });
assert.equal(requestShift(first, -1), false, 'No reverse selection while moving');
assert.equal(first.gear, 1);
const seventh = createCarState({ gear: 7, gearboxMode: 'manual' });
assert.equal(requestShift(seventh, 1), false);

const limiter = createCarState({ gearboxMode: 'manual' });
let maximumRpm = 0;
run(limiter, 10, (_, state) => { maximumRpm = Math.max(maximumRpm, state.rpm); return { throttle: 1 }; }, 'drift');
assert.equal(limiter.gear, 1, 'Sequential mode holds the selected gear');
assert.ok(maximumRpm > 8200 && maximumRpm < 8350, 'Electronic redline cuts torque');

const slide = createCarState({ heading: 0, speed: 18, gear: 2 });
run(slide, 0.35, { steering: 0.2, throttle: 0.5, handbrake: true }, 'drift');
const beforeCountersteer = Math.abs(slide.slipAngle);
run(slide, 0.55, { steering: -0.4, throttle: 0.1 }, 'drift');
run(slide, 1.5, { steering: 0, throttle: 0.1 }, 'drift');
assert.ok(beforeCountersteer > 0.035);
assert.ok(Math.abs(slide.slipAngle) < beforeCountersteer / 2, 'Timely opposite lock catches a physical rear slide');
for (const mode of ['race', 'drift']) {
  const interventions = {};
  for (const assistMode of ['novice', 'pro']) {
    const car = createCarState({ heading: 0, speed: 20, gear: 2, assistMode });
    // Start with an already slipping driven axle, as after a kerb/unloading.
    car.wheelSlip = .7;
    stepCar(car, {...BENCH, throttle: 1, assistMode}, 1 / 120, mode);
    let maximum = car.dscIntervention;
    run(car, 1, (_, state) => {
      maximum = Math.max(maximum, state.dscIntervention);
      return { steering: 0.22, throttle: 1, assistMode };
    }, mode);
    interventions[assistMode] = maximum;
  }
  assert.ok(interventions.novice > 0, 'Novice traction assistance responds to slip in ' + mode);
  assert.equal(interventions.pro, 0, 'Pro never limits traction through DSC in ' + mode);
}
const switchingAssist = createCarState({ speed: 20 });
switchingAssist.dscIntervention = .8;
stepCar(switchingAssist, {...BENCH, throttle: 1, assistMode: 'pro'}, 1 / 120, 'race');
assert.equal(switchingAssist.dscIntervention, 0, 'Switching to Pro clears residual DSC intervention immediately');

const at30 = run(createCarState(), 5, { throttle: 0.7, steering: 0.035 }, 'race', 30);
const at120 = run(createCarState(), 5, { throttle: 0.7, steering: 0.035 }, 'race', 120);
for (const field of ['x', 'z', 'heading', 'vx', 'vz', 'rpm', 'wheelOmega', 'distanceTravelled']) {
  assert.ok(Math.abs(at30[field] - at120[field]) < 1e-8, `Frame-rate independence: ${field}`);
}

// Traverse the real open stage with a simple test driver. This is test input,
// not a controller hidden inside the physics: a steering-free car below misses
// the bends. Both skill levels can finish without colliding or leaving the road.
let maximumTrackDistance = 0;
for (const assistMode of ['novice', 'pro']) {
  const stage = createCarState({...trackPoint(.009)});
  for (let i = 0; i < 120 * 300 && stage.trackT < .995; i++) {
    const ahead = trackPoint(stage.trackT + (7 + stage.speed * .35) / trackLength);
    const desired = Math.atan2(ahead.x - stage.x, ahead.z - stage.z);
    const roadRequest = -angleDifference(desired, stage.heading) * 1.15;
    stepCar(stage, { assistMode, steering: Math.max(-1, Math.min(1, roadRequest / (assistMode === 'novice' ? Math.max(.1, stage.steeringLimit) : 1))),
      throttle: Math.max(0, Math.min(.7, (16 - stage.speed) * .25 + .1)), brake: stage.speed > 19 ? .2 : 0 }, 1 / 120);
    maximumTrackDistance = Math.max(maximumTrackDistance, stage.trackDistance);
    assert.equal(stage.contact, '', 'The drivable road agrees with actual barrier positions');
  }
  assert.ok(stage.trackT >= .995 && stage.distanceTravelled > 2500, assistMode + ' finishes the longer sector');
  assert.ok(maximumTrackDistance < TRACK_HALF_WIDTH);
}

const wallGeometry = [{ id: 'test-wall', type: 'barrier', points: [[-100,10],[100,10]], radius: .12 }];
const kineticEnergy = state => .5 * CAR_SPEC.mass * (state.vx ** 2 + state.vz ** 2) + .5 * CAR_SPEC.yawInertia * state.yawRate ** 2;
const offsetImpact = createCarState({ x: 0, z: 7.7, heading: .22, speed: 20, engineOn: false });
const impactEnergy = kineticEnergy(offsetImpact);
applyWorldContacts(offsetImpact, wallGeometry);
assert.ok(offsetImpact.collision.impulse > 10000 && offsetImpact.collision.age === 0, 'An impact reports an impulse and contact point');
assert.ok(Math.abs(offsetImpact.yawRate) > .1, 'An offset bumper impact rotates the body');
assert.ok(kineticEnergy(offsetImpact) < impactEnergy * .25, 'Contact dissipates energy rather than injecting a spin');
let contactSeed = 13;
const contactRandom = () => ((contactSeed = Math.imul(contactSeed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
const energyObstacles = [wallGeometry[0], { id: 'angled-box', type: 'box', x: 0, z: 0, halfX: 4, halfZ: 2, yaw: .8 },
  { id: 'round-post', type: 'circle', x: 0, z: 0, radius: .4 }];
for (let i = 0; i < 150; i++) {
  const impact = createCarState({ x: contactRandom() * 6 - 3, z: contactRandom() * 4 - 2, heading: contactRandom() * 6.28,
    vx: contactRandom() * 60 - 30, vz: contactRandom() * 60 - 30, yawRate: contactRandom() * 6 - 3 });
  const before = kineticEnergy(impact);
  applyWorldContacts(impact, energyObstacles);
  assert.ok(kineticEnergy(impact) <= before + 1e-5, 'Glancing and overlapping contacts cannot create kinetic energy');
}

const collisionKinds = [];
for (const collider of [wallGeometry[0], { id: 'test-building', type: 'box', x: 0, z: 12, halfX: 8, halfZ: 2, yaw: .15 },
  { id: 'test-tree', type: 'circle', x: 0, z: 10, radius: .26 }]) {
  const car = createCarState({ x: 0, z: 0, heading: 0, speed: 65, engineOn: false });
  let hit = false;
  run(car, .7, (_, state) => {
    hit ||= state.collision.id === collider.id;
    return { ...BENCH, worldContacts: true, colliders: [collider] };
  }, 'drift', 30);
  assert.ok(hit, collider.id + ': bumper hits visible geometry even at 234 km/h and 30 FPS');
  assert.ok(car.z < 10, collider.id + ': no tunnelling through obstacle');
  allFinite(car); collisionKinds.push(collider.type);
}

const besideBarrier = trackPoint(.32);
const realWall = createCarState({ x: besideBarrier.x - besideBarrier.tangent.z * 3, z: besideBarrier.z + besideBarrier.tangent.x * 3,
  heading: Math.atan2(-besideBarrier.tangent.z, besideBarrier.tangent.x), speed: 25, assistMode: 'pro' });
let hitArmco = false;
run(realWall, .8, (_, state) => { hitArmco ||= state.collision.id.startsWith('armco-'); return { assistMode: 'pro' }; }, 'race', 120, false);
assert.ok(hitArmco, 'The scene-provided Armco collider is active');
assert.ok(nearestTrack(realWall.x, realWall.z).signedDistance < WORLD_CONTACTS.outerBarrierOffset);

const reactions = {};
for (const assistMode of ['novice', 'pro']) {
  const car = createCarState({ heading: 0, speed: 25 });
  let maxSlip = 0, maxYaw = 0, maxRackSpeed = 0, previousSteer = 0;
  run(car, 7, (t, state) => {
    maxSlip = Math.max(maxSlip, Math.abs(state.slipAngle)); maxYaw = Math.max(maxYaw, Math.abs(state.yawRate));
    maxRackSpeed = Math.max(maxRackSpeed, Math.abs(state.steering - previousSteer) * 120); previousSteer = state.steering;
    return { assistMode, steering: t < 2 ? .65 : t < 4 ? -.65 : 0, throttle: .65 };
  });
  assert.ok(maxRackSpeed <= (assistMode === 'novice' ? 2.5 : 4) + 1e-8, 'Mechanical rack slew does not depend on input device');
  reactions[assistMode] = { maxSlip, maxYaw };
}
assert.ok(reactions.novice.maxSlip < .1 && reactions.novice.maxSlip < reactions.pro.maxSlip * .2,
  'Novice can survive abrupt full steering without the Pro spin');
assert.ok(reactions.novice.maxYaw < .5);
const lowSpeedLock = run(createCarState(), .8, { assistMode: 'novice', steering: 1 });
const highSpeedLock = run(createCarState({ speed: 35 }), .8, { assistMode: 'novice', steering: 1 });
assert.ok(lowSpeedLock.steeringLimit > .98 && highSpeedLock.steeringLimit < .16, 'Novice preserves parking lock and limits high-speed rack angle');
const proLock = run(createCarState({ speed: 35 }), .8, { assistMode: 'pro', steering: 1 });
assert.equal(proLock.steeringLimit, 1, 'Pro retains full mechanical steering');

const curveStart = trackPoint(.035);
const brakeHelper = createCarState({ ...curveStart, speed: 35 });
run(brakeHelper, .3, { assistMode: 'novice', throttle: 0, brakeAssist: true });
assert.ok(brakeHelper.brakeAssist > .1 && brakeHelper.targetSpeedKmh < 120, 'Novice anticipates a real bend');
stepCar(brakeHelper, { ...BENCH, assistMode: 'pro', brakeAssist: true }, 1 / 120);
assert.equal(brakeHelper.brakeAssist, 0, 'Switching to Pro cancels automatic braking on the first physics step');
assert.equal(brakeHelper.effectiveBrake, 0);
const manualBrake = createCarState({ ...curveStart, speed: 35 });
run(manualBrake, .3, { assistMode: 'pro', brakeAssist: true });
assert.equal(manualBrake.brakeAssist, 0, 'Pro never applies automatic curve braking');
const disabledBrake = createCarState({ ...curveStart, speed: 35 });
run(disabledBrake, .3, { assistMode: 'novice', brakeAssist: false });
assert.equal(disabledBrake.brakeAssist, 0, 'Curve braking can be disabled independently');

const freeCar = createCarState({ ...trackPoint(.045), speed: 20 });
run(freeCar, 4, { assistMode: 'novice', steering: 0, throttle: .25, brakeAssist: false });
assert.ok(freeCar.trackDistance > TRACK_HALF_WIDTH, 'Assistance never puts the car on invisible rails');

// Long deterministic stress runs include handbrake transitions, countersteering,
// low-speed starts, braking while applying throttle, and both assistance levels.
let chaos;
const stress = [];
for (const assistMode of ['novice', 'pro']) for (const mode of ['race', 'drift']) {
  chaos = createCarState();
  let peakYaw = 0, peakSpeed = 0;
  run(chaos, 90, (t, state) => {
    allFinite(state);
    peakYaw = Math.max(peakYaw, Math.abs(state.yawRate)); peakSpeed = Math.max(peakSpeed, state.speed);
    return { assistMode, steering: Math.sin(t * 1.7), throttle: t % 12 > 10 ? 0 : .85,
      brake: t % 12 > 10 ? 1 : 0, handbrake: t % 11 > 10 ? .8 : 0 };
  }, mode);
  assert.ok(peakYaw < 4 && peakSpeed < 75, 'Long driving remains physically bounded');
  assert.ok(Math.abs(Object.values(chaos.tireLoads).reduce((a, b) => a + b, 0) - CAR_SPEC.mass * 9.81) < 1e-6);
  assert.ok(Object.values(chaos.tireLoads).every(load => load > 0));
  run(chaos, 8, { assistMode, brake: 1 }, mode);
  assert.equal(chaos.speed, 0, 'Released throttle and foot brake always settle to rest');
  assert.equal(chaos.yawRate, 0, 'No residual low-speed yaw jitter');
  stress.push({ assistMode, mode, peakYaw: Number(peakYaw.toFixed(3)), peakSpeed: Number(peakSpeed.toFixed(2)) });
}
for (const speed of [0, .01, .1, .5, 2]) {
  const creeping = run(createCarState({ heading: 0, speed }), 4, t => ({ steering: Math.sin(t * 25), brake: 1 }), 'drift');
  assert.equal(creeping.speed, 0); assert.equal(creeping.yawRate, 0);
}
const brakeHold = run(createCarState({ speed: .2 }), 4, { throttle: 1, brake: 1, steering: .7 });
assert.equal(brakeHold.speed, 0, 'The brake holds against throttle without alternating force near zero speed');
assert.equal(brakeHold.yawRate, 0);
const rescued = run(createCarState({ gearboxMode: 'manual', assistMode: 'pro' }), 2, { throttle: .5, assistMode: 'pro', shiftProgram: 5 });
const session = { elapsed: rescued.elapsed, distance: rescued.distanceTravelled };
respawnCar(rescued, .4);
assert.equal(rescued.elapsed, session.elapsed); assert.equal(rescued.distanceTravelled, session.distance);
assert.equal(rescued.gearboxMode, 'manual'); assert.equal(rescued.shiftProgram, 5); assert.equal(rescued.assistMode, 'pro');
assert.equal(rescued.speed, 0); assert.equal(rescued.contact, '');
assert.ok(Math.abs(rescued.trackT - .4) < 1e-8);
const identity = chaos;
resetCar(chaos);
assert.equal(chaos, identity);
assert.deepEqual(chaos, createCarState(), 'Reset clears drivetrain, contacts and input edges');
const invalid = run(createCarState(), 1, { steering: Infinity, throttle: NaN, brake: -5 });
assert.equal(invalid.speed, 0);

console.log(JSON.stringify({ result: 'All BMW dynamics checks passed',
  trackLength: Number(trackLength.toFixed(2)), acceleration0to100Seconds: accelerationTimes,
  braking100to0Metres: Number(braking.distanceTravelled.toFixed(2)),
  maxTestRpm: Math.round(maximumRpm), maximumStageDeviationMetres: Number(maximumTrackDistance.toFixed(3)),
  fpsPositionDifference: Math.hypot(at30.x - at120.x, at30.z - at120.z),
  steeringProjectionHeadings: 4, collisionKinds, stress, noviceVsPro: reactions,
}, null, 2));
