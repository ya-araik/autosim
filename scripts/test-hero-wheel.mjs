import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.min.js';
import {createHeroWheelModel} from '../public/hero-wheel-model.js';

const model=createHeroWheelModel(THREE),parts=model.group.userData.designParts;
assert.ok(parts.includes('Anatomical leather rim'));
assert.ok(parts.includes('360 individual leather stitches'));
assert.ok(parts.includes('Perforated thumb grips'));
assert.ok(parts.includes('AUTOSIM A emblem'));
assert.ok(parts.includes('Quick-release socket recess'));
assert.ok(parts.includes('Hexagonal screw recess'));
assert.ok(parts.includes('Live OLED display'));
assert.equal(parts.filter(name=>name.startsWith('RPM light ')).length,13);
assert.equal(model.paddlePivots.length,2);
let triangles=0,meshes=0,instanced=0;
model.group.traverse(object=>{
  if(!object.isMesh)return;meshes++;if(object.isInstancedMesh)instanced+=object.count;
  const geometry=object.geometry,position=geometry.attributes.position;
  for(const attribute of Object.values(geometry.attributes))for(const value of attribute.array)assert.ok(Number.isFinite(value));
  if(geometry.index)for(const index of geometry.index.array)assert.ok(index<position.count);
  triangles+=(geometry.index?.count||position.count)/3*(object.isInstancedMesh?object.count:1);
});
assert.ok(triangles<40000,'detailed hero retains a mobile geometry budget');
assert.ok(meshes<85,'small machining details are batched');
assert.equal(instanced,600,'360 actual stitches and 240 perforations');
model.group.updateMatrixWorld(true);
const initial=new THREE.Box3().setFromObject(model.group,true),size=initial.getSize(new THREE.Vector3());
assert.ok(size.x>3.1&&size.x<3.2);
assert.ok(size.y>2.7&&size.y<2.9);
assert.ok(size.z>.95&&size.z<1.15,'rear hub and front controls have genuine 3D depth');
// Front-facing normals of the leather must face out, not hide the entire rim.
const rim=model.group.getObjectByName('Anatomical leather rim'),rp=rim.geometry.attributes.position,rn=rim.geometry.attributes.normal;
let frontNormals=0;
for(let i=0;i<rp.count;i++)if(rp.getZ(i)>.15){assert.ok(rn.getZ(i)>.75);frontNormals++;}
assert.ok(frontNormals>400);
for(const degrees of [-1000,-450,-90,0,90,450,1000]){
  model.setSteering(degrees);assert.equal(model.getState().steering,THREE.MathUtils.clamp(degrees,-450,450));
  assert.ok(Math.abs(model.wheel.rotation.z+model.getState().steering*Math.PI/180)<1e-10);
  model.group.updateMatrixWorld(true);const animated=new THREE.Box3().setFromObject(model.group,true).getSize(new THREE.Vector3());
  assert.ok(animated.x<3.3&&animated.y<3.3&&animated.z<1.15);
}
for(let i=0;i<15;i++)model.shift(1);assert.equal(model.getState().gear,7);
assert.equal(model.paddlePivots[1].userData.action,'up');
model.update(.05);assert.ok(Math.abs(model.paddlePivots[1].rotation.y)>.03,'upshift moves the actual paddle');
for(let i=0;i<15;i++)model.shift(-1);assert.equal(model.getState().gear,1);
model.update(.05);assert.ok(Math.abs(model.paddlePivots[0].rotation.y)>.03,'downshift moves the actual paddle');
assert.equal(model.cycleMode(),'DRIFT');assert.equal(model.cycleMode(),'TOUR');assert.equal(model.cycleMode(),'TRACK');
model.setFinish('titanium');assert.equal(model.getState().finish,'titanium');
model.setFinish('unknown');assert.equal(model.getState().finish,'carbon');
model.setIdentity({callsign:'  PILOT\u0000 07  ',accent:'#91b8ff'});assert.equal(model.getState().callsign,'PILOT 07');assert.equal(model.getState().accent,'#91b8ff');
model.setIdentity({callsign:'012345678901234567890123',accent:'url(javascript:bad)'});assert.equal(model.getState().callsign.length,18);assert.equal(model.getState().accent,'#91b8ff');
for(let i=0;i<180;i++)model.update(1/60);assert.equal(model.update(0),false,'animation becomes idle instead of running forever');
model.shift(1);model.settle();assert.equal(model.update(0),false,'reduced-motion/hidden states settle immediately');assert.equal(Math.abs(model.paddlePivots[0].rotation.y),0);assert.equal(Math.abs(model.paddlePivots[1].rotation.y),0);
model.dispose();
console.log(JSON.stringify({pass:true,concept:'AUTOSIM A-01',meshDraws:meshes,triangles,physicalStitches:360,perforations:240,rpmLights:13,dimensions:size.toArray(),checks:['finite geometry and index bounds','outward leather normals','3D front/rear depth','steering clamp and full rotation','both working paddles and gear limits','mode cycle and finishes','safe custom identity','animation settles when idle/reduced/hidden']},null,2));
