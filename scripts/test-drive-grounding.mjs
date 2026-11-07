import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.min.js';
import {GLTFLoader} from '../public/vendor/GLTFLoader.js';
import {prepareCar} from '../public/drive-car.js';
import {sampleWheelSupport,createChassisMotion} from '../public/drive-motion.js';
import {sampleTrack} from '../public/track-data.js';
const bytes=fs.readFileSync(new URL('../public/assets/bmw-e60/bmw-m5-e60.glb',import.meta.url));
const car=prepareCar(THREE,await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''));
const motion=createChassisMotion();let maximumContactError=0,poses=0;
const body=car.sprung.getObjectByName('Vehicle_Body'),original=Buffer.from(body.geometry.attributes.position.array.buffer).toString('base64');
for(let i=0;i<45;i++)for(const offset of [0,4.4,5.5]){
  const p=sampleTrack(.009+i*.021),state={x:p.x-p.tangent.z*offset,z:p.z+p.tangent.x*offset,heading:p.heading,speed:18,wheelOmega:55,steeringAngle:.04,acceleration:{longitudinal:-6,lateral:4}};
  const support=sampleWheelSupport(state,car.wheels),pose=motion.update(state,support,1/60);
  car.group.position.set(state.x,support.height,state.z);car.group.rotation.set(0,state.heading,0,'YXZ');car.update(state,{brake:.6},1/60,pose);car.group.updateMatrixWorld(true);
  car.wheels.forEach((wheel,index)=>{
    const bounds=new THREE.Box3().setFromObject(wheel.spin,true),error=Math.abs(bounds.min.y-support.contacts[index].y);
    maximumContactError=Math.max(error,maximumContactError);assert.ok(error<.0015,'actual rotating tyre vertices stay within 1.5mm of their surface sample');
  });
  poses++;
}
assert.equal(Buffer.from(body.geometry.attributes.position.array.buffer).toString('base64'),original,'springs never deform body geometry');
console.log(JSON.stringify({pass:true,poses,maximumContactErrorM:maximumContactError,bodyGeometry:'unchanged',surfaces:'asphalt, split kerb, shoulder'}));
