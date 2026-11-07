import assert from 'node:assert/strict';
import {spring,sampleContact,sampleWheelSupport,createChassisMotion,createCameraMotion,roadSoundMix} from '../public/drive-motion.js';
import {sampleTrack} from '../public/track-data.js';
const wheels=[[-.79,-1.31],[.79,-1.31],[-.79,1.579],[.79,1.579]].map(([x,z])=>({restPosition:{x,y:.349,z},radius:.349}));
const state={x:0,z:0,heading:0,speed:20,acceleration:{longitudinal:0,lateral:0}};
const flat=sampleWheelSupport(state,wheels,(x,z)=>({x,z,y:12}));
assert.ok(Math.abs(flat.height-12)<1e-10);assert.ok(Math.abs(flat.pitch)<1e-10);assert.ok(Math.abs(flat.roll)<1e-10);
const plane=sampleWheelSupport(state,wheels,(x,z)=>({x,z,y:12+.08*z+.03*x}));
assert.ok(Math.abs(plane.height-12)<1e-10);
assert.ok(Math.abs(plane.pitch+Math.atan(.08))<1e-10);
assert.ok(Math.abs(plane.roll-Math.atan(.03))<1e-10);
const chassis=createChassisMotion();chassis.update(state,flat,0);
const outcomes={};
for(const [name,acceleration] of Object.entries({accelerate:{longitudinal:6,lateral:0},brake:{longitudinal:-9,lateral:0},left:{longitudinal:0,lateral:8},right:{longitudinal:0,lateral:-8},settled:{longitudinal:0,lateral:0}})){
  state.acceleration=acceleration;let result;
  for(let i=0;i<240;i++)result=chassis.update(state,flat,1/120);
  outcomes[name]={pitch:result.bodyPitch,roll:result.bodyRoll};
}
assert.ok(outcomes.accelerate.pitch<-.02,'acceleration lifts the nose');
assert.ok(outcomes.brake.pitch>.03,'braking compresses the front');
assert.ok(outcomes.left.roll>.03 && outcomes.right.roll<-.03,'body leans to the outside, never into the corner');
assert.ok(Math.abs(outcomes.settled.pitch)<.0001 && Math.abs(outcomes.settled.roll)<.0001,'no idle shake');
const frozen=chassis.update(state,flat,0);state.acceleration.longitudinal=9;
assert.deepEqual(chassis.update(state,flat,0),frozen,'paused motion freezes');
const teleported=chassis.update({...state,x:1000},plane,1/60);
assert.equal(teleported.bodyPitch,plane.pitch);assert.equal(teleported.heave,0);
for(const fps of [30,60,120,144]){
  const a={value:0,velocity:0};for(let i=0;i<fps;i++)spring(a,1,1/fps);
  assert.ok(Math.abs(a.value-.9999)<.0003,'same settling at '+fps+'Hz');
}
const camera=createCameraMotion();camera.update({...state,heading:3.13},0,'chase');
const wrapped=camera.update({...state,heading:-3.13},1/60,'chase');
assert.ok(Math.abs(Math.atan2(Math.sin(wrapped.heading+3.13),Math.cos(wrapped.heading+3.13)))<.03,'no full turn at angle wrap');
for(let i=0;i<120;i++)camera.update(state,1/60,'chase');
const still=camera.update(state,0,'chase');assert.deepEqual(camera.update(state,0,'chase'),still);
assert.deepEqual(camera.update(state,1/60,'hood',false),{heading:state.heading,lateral:0,longitudinal:0,fov:0},'reduced motion switches off camera inertia and FOV animation');
const p=sampleTrack(.45),road=sampleContact(p.x,p.z),kerb=sampleContact(p.x-p.tangent.z*5,p.z+p.tangent.x*5);
assert.equal(road.surface,'asphalt');assert.equal(kerb.surface,'kerb');
assert.ok(Math.abs(road.y-p.y-.025)<1e-8);
assert.equal(roadSoundMix({speed:0}).roll,0);assert.equal(roadSoundMix({speed:0}).wind,0);
assert.ok(roadSoundMix({speed:20,trackDistance:6}).roll>roadSoundMix({speed:20,trackDistance:0}).roll);
const began=performance.now();for(let i=0;i<1000;i++)sampleWheelSupport({...state,...sampleTrack(i/1000)},wheels);
console.log(JSON.stringify({pass:true,outcomes,meanFourWheelSampleMs:(performance.now()-began)/1000,checks:['slope and crossfall','correct load-transfer direction','settling at 30–144Hz','pause/reset/teleport','shortest yaw arc','reduced motion','actual kerb height','speed-linked ambience']},null,2));
