import assert from 'node:assert/strict';
import {createCarState,stepCar,trackPoint,trackLength} from '../public/drive-physics.js';
import {BARRIER_PATHS,FINISH_T} from '../public/track-data.js';
assert.ok((1-FINISH_T)*trackLength>25,'Finish has a run-off area before the end of the road');
for(const t of [0,1]){
  const id=t?'sector-end':'sector-start';assert.ok(BARRIER_PATHS.find(b=>b.id===id));
  const endpoint=trackPoint(t),start=trackPoint(t?.990:.009);
  for(const side of [-5.8,-3,0,3,5.8]){
    const heading=start.heading+(t?0:Math.PI);
    const car=createCarState({...start,x:start.x-start.tangent.z*side,z:start.z+start.tangent.x*side,heading,speed:30,engineOn:false});
    let impulse=0,furthest=-Infinity;
    for(let i=0;i<360;i++){
      stepCar(car,{assistMode:'pro',throttle:0,brake:0,steering:0},1/120);
      const beyond=((car.x-endpoint.x)*endpoint.tangent.x+(car.z-endpoint.z)*endpoint.tangent.z)*(t?1:-1);
      furthest=Math.max(furthest,beyond);impulse=Math.max(impulse,car.collision.impulse);
    }
    assert.ok(furthest<0,`${id}: no escape at lateral offset ${side}`);
    assert.ok(impulse>1000,`${id}: physical resistance at lateral offset ${side}`);
  }
}
console.log('Finish/endcaps: 10 impacts across road and shoulders contained; real collision impulse, >25 m run-off.');
