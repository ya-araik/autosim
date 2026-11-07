import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createCarState,stepCar,trackPoint,trackLength} from '../public/drive-physics.js';
import {FINISH_T} from '../public/track-data.js';
const runs=[];
for(const board of ['novice','pro']){
  const car=createCarState({...trackPoint(.009)}),samples=[[0,Math.round(car.x*10),Math.round(car.z*10)]];let next=1;
  for(let i=0;i<120*450&&car.trackT<FINISH_T;i++){
    const ahead=trackPoint(car.trackT+(7+car.speed*.35)/trackLength),desired=Math.atan2(ahead.x-car.x,ahead.z-car.z);
    const delta=Math.atan2(Math.sin(desired-car.heading),Math.cos(desired-car.heading)),request=-delta*1.15;
    stepCar(car,{assistMode:board,steering:Math.max(-1,Math.min(1,request/(board==='novice'?Math.max(.1,car.steeringLimit):1))),throttle:Math.max(0,Math.min(.7,(16-car.speed)*.25+.1)),brake:car.speed>19?.2:0},1/120);
    assert.ok(car.trackDistance<5.8);
    if(car.elapsed>=next){samples.push([Math.round(car.elapsed*1000),Math.round(car.x*10),Math.round(car.z*10)]);next++;}
  }
  assert.ok(car.trackT>=FINISH_T);
  const timeMs=Math.round(car.elapsed*1000);if(samples.at(-1)[0]<timeMs)samples.push([timeMs,Math.round(car.x*10),Math.round(car.z*10)]);
  runs.push({board,timeMs,samples});
}
fs.mkdirSync('.runtime',{recursive:true});fs.writeFileSync('.runtime/game-physics-traces.json',JSON.stringify(runs));
console.log(runs.map(r=>({board:r.board,timeMs:r.timeMs,samples:r.samples.length})));
