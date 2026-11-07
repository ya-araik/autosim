/** Nordschleife season 2: Eschbach → Brünnchen → Stefan-Bellof-S, OpenStreetMap ways
 * 799394516/517/518/519/520/521, © OpenStreetMap contributors, ODbL 1.0.
 * Horizontal geometry follows OSM. Elevation, camber, furniture and vegetation
 * are an authored visual reconstruction; this is not a surveyed track model. */
const CONTROL_POINTS = [[-0.0,0.0],[-0.0,33.9829],[1.4158,44.1145],[3.5205,53.6302],[6.1695,61.529],[8.7566,67.6722],[11.7013,73.2531],[16.2833,79.7707],[22.4006,87.494],[27.5459,92.6661],[33.1552,97.7342],[37.615,101.4413],[44.742,105.9235],[50.1844,108.9485],[58.2428,112.618],[79.665,122.0468],[109.0617,136.7325],[132.4947,151.2669],[154.4125,165.5109],[167.7605,174.3502],[176.5192,180.9346],[181.5712,185.0788],[186.6167,190.2745],[188.8665,193.0937],[191.9721,197.4978],[194.7079,202.8324],[196.6292,207.3656],[198.3035,213.0594],[198.8763,220.1339],[199.2489,226.5108],[197.4593,248.9883],[195.4801,268.3803],[191.8712,282.0996],[185.3169,299.0964],[178.7747,309.9202],[173.7911,316.9288],[162.8944,329.6645],[151.4679,342.6149],[138.4195,358.6149],[134.5212,364.6286],[130.9904,371.4336],[129.1517,377.7549],[127.9439,383.8512],[127.5786,391.9445],[128.6194,400.0583],[130.8142,407.4083],[133.7406,413.6203],[186.8229,494.391],[212.1718,533.3569],[215.3956,537.6364],[219.2615,541.8395],[224.7972,546.738],[229.2637,550.0813],[233.6369,552.5544],[238.6197,554.5618],[246.5977,557.4222],[253.2114,558.7806],[262.5324,559.4196],[272.5803,558.1935],[281.6114,555.8714],[290.4434,551.8046],[300.4072,545.5154],[313.2032,535.0089],[361.4595,492.2469],[396.7557,456.9713],[431.9815,422.3978],[442.7504,414.4526],[451.1457,409.6219],[459.6283,406.77],[465.0895,405.4225],[471.226,404.8173],[477.3752,404.7464],[483.0651,405.5067],[489.0376,407.213],[494.9089,409.2452],[500.7595,412.4693],[517.2484,425.1251],[528.2652,432.7018],[535.9206,437.8018],[544.0656,441.7021],[552.2155,444.6955],[572.7119,449.9733],[638.518,465.3587],[661.2873,470.9144],[670.0185,473.8806],[676.6596,476.8507],[709.2009,493.8019],[741.2867,512.8854],[750.5016,519.2433],[756.0251,523.349],[763.3456,530.0535],[771.1981,539.3078],[775.4264,545.5246],[780.049,553.0842],[802.1101,589.4276],[812.2361,604.9792],[821.4918,616.392],[826.9037,622.5805],[850.9428,648.4909],[860.2352,659.6446],[909.9065,727.3726],[920.0773,737.6707],[924.6119,741.1881],[927.7997,743.1463],[933.3324,745.6967],[938.1373,747.5186],[945.0058,749.473],[983.6032,756.8832],[996.8393,758.8332],[1005.0311,758.8687],[1012.165,758.7159],[1022.5292,757.4626],[1033.983,754.4083],[1048.8957,748.7208],[1085.1952,730.8341],[1115.4541,716.8717],[1126.9106,713.4713],[1138.2201,711.5803],[1149.0509,711.0378],[1159.6789,711.4624],[1178.5912,713.6823],[1238.9505,721.2018],[1277.4447,726.0729],[1297.2803,729.6793],[1314.1174,734.1983],[1332.1402,741.081],[1428.677,787.5848],[1442.8026,794.1594],[1456.6416,799.8057],[1472.8682,804.6765],[1491.5081,808.5217],[1510.4538,810.7717],[1523.5733,811.383],[1536.3749,811.3205],[1550.2747,810.4819],[1560.0066,808.8098],[1569.3154,806.3341],[1588.0138,801.088],[1598.3824,798.8708],[1609.4493,797.1766],[1632.9353,796.8194],[1663.2892,797.1986],[1675.8137,797.0311],[1690.1151,795.7523],[1707.0986,792.0546],[1718.9656,788.2925],[1734.2462,782.4501],[1758.6093,769.987],[1773.0485,761.7883],[1790.6566,752.6392],[1816.0252,740.9087],[1828.6717,735.4251],[1843.3733,729.8945]];
export const TRACK_HALF_WIDTH = 4.7;
export const TRACK_CLOSED = false;
export const TRACK_NAME = 'Eschbach — Stefan-Bellof-S';
// Authored time-trial finish, with braking space before the closed end of the sector.
export const FINISH_T = .984;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const controls=CONTROL_POINTS;
const dense=[];
// Cubic Hermite tangents follow the original OSM survey nodes without corner kinks.
for(let i=0;i<controls.length-1;i++){
 const a=controls[i],b=controls[i+1],prev=controls[Math.max(0,i-1)],next=controls[Math.min(controls.length-1,i+2)];
 const length=Math.hypot(b[0]-a[0],b[1]-a[1]),steps=Math.max(2,Math.ceil(length/2.5));
 const d0=Math.hypot(b[0]-prev[0],b[1]-prev[1])||1,d1=Math.hypot(next[0]-a[0],next[1]-a[1])||1;
 for(let k=0;k<steps;k++){
  const t=k/steps,t2=t*t,t3=t2*t;
  dense.push([0,1].map(d=>(2*t3-3*t2+1)*a[d]+(t3-2*t2+t)*(b[d]-prev[d])/d0*length+(-2*t3+3*t2)*b[d]+(t3-t2)*(next[d]-a[d])/d1*length));
 }
}
dense.push(controls.at(-1));
const distances=[0];for(let i=1;i<dense.length;i++)distances.push(distances[i-1]+Math.hypot(dense[i][0]-dense[i-1][0],dense[i][1]-dense[i-1][1]));
export const TRACK_LENGTH=distances.at(-1);
const elevationKeys=[[0,31],[.075,28],[.1654,18],[.21,15],[.272,3],[.323,7],[.390,16],[.452,15],[.519,10],[.576,3],[.61,6],[.65,-1],[.727,-7],[.77,-5],[.83,-15],[.88,-18],[.93,-14],[1,-22]];
function elevation(t){for(let i=1;i<elevationKeys.length;i++)if(t<=elevationKeys[i][0]){const [a,y]=elevationKeys[i-1],[b,z]=elevationKeys[i];const f=clamp((t-a)/(b-a),0,1);return lerp(y,z,f*f*(3-2*f));}return elevationKeys.at(-1)[1];}
export const TRACK_CENTERLINE=Object.freeze(dense.map(([x,z],i)=>Object.freeze([x,elevation(distances[i]/TRACK_LENGTH),z])));
export const TRACK_BOUNDS=Object.freeze({minX:Math.min(...dense.map(p=>p[0])),maxX:Math.max(...dense.map(p=>p[0])),minZ:Math.min(...dense.map(p=>p[1])),maxZ:Math.max(...dense.map(p=>p[1]))});
export function sampleTrack(t){
 t=clamp(Number.isFinite(t)?t:0,0,1);const distance=t*TRACK_LENGTH;
 let lo=0,hi=distances.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(distances[mid]>distance)hi=mid;else lo=mid;}
 const a=TRACK_CENTERLINE[lo],b=TRACK_CENTERLINE[hi],f=(distance-distances[lo])/Math.max(.001,distances[hi]-distances[lo]);
 const dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz)||1;
 return {x:lerp(a[0],b[0],f),y:elevation(t),z:lerp(a[2],b[2],f),heading:Math.atan2(dx,dz),t,tangent:{x:dx/length,z:dz/length},grade:(b[1]-a[1])/length};
}
export function getTrackProjection(x,z){
 x=Number.isFinite(x)?x:0;z=Number.isFinite(z)?z:0;let best=Infinity,index=0,along=0;
 for(let i=0;i<dense.length-1;i++){const a=dense[i],b=dense[i+1],dx=b[0]-a[0],dz=b[1]-a[1],f=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz),0,1),ds=(x-a[0]-dx*f)**2+(z-a[1]-dz*f)**2;if(ds<best){best=ds;index=i;along=f;}}
 const t=lerp(distances[index],distances[index+1],along)/TRACK_LENGTH,p=sampleTrack(t);
 return {...p,distance:Math.sqrt(best),signedDistance:-(x-p.x)*p.tangent.z+(z-p.z)*p.tangent.x,index};
}
export const getTrackHeight=(x,z)=>getTrackProjection(x,z).y;
export function getTerrainHeight(x,z,projection){
 const p=projection||getTrackProjection(x,z),d=p.distance||0,f=clamp((d-6)/27,0,1),blend=f*f*(3-2*f);
 const globalHeight=18-x*.024,farBlend=clamp((d-30)/65,0,1);
 return lerp(p.y,globalHeight,farBlend*farBlend*(3-2*farBlend))-.045+blend*(1.6+3.8*Math.sin(x*.017+z*.009)+1.5*Math.sin(z*.038-x*.021))+.7*Math.sin(x*.0038+z*.004)*clamp((d-25)/90,0,1);
}
export const BARRIER_OFFSETS=Object.freeze([-7.15,7.15]);
export const BARRIER_PATHS=BARRIER_OFFSETS.map((offset,side)=>({id:side?'armco-right':'armco-left',offset,points:TRACK_CENTERLINE.filter((_,i)=>i%2===0||i===TRACK_CENTERLINE.length-1).map((_,i,array)=>{const p=sampleTrack(i/(array.length-1));return[p.x-p.tangent.z*offset,p.y,p.z+p.tangent.x*offset];})}));
for(const t of [0,1]){
 const p=sampleTrack(t);
 BARRIER_PATHS.push({id:t?'sector-end':'sector-start',points:[-7.15,7.15].map(offset=>[p.x-p.tangent.z*offset,p.y,p.z+p.tangent.x*offset])});
}
let seed=34527;const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
const scatteredTrees=Array.from({length:1600},(_,i)=>{
 const t=random(),p=sampleTrack(t),side=random()>.5?1:-1,offset=side*(12+random()**1.65*110),x=p.x-p.tangent.z*offset+(random()-.5)*7,z=p.z+p.tangent.x*offset+(random()-.5)*7;
 return {id:'tree-'+i,x,z,y:getTerrainHeight(x,z),height:10+random()*13,width:4+random()*3.8,rotation:random()*Math.PI,variant:Math.floor(random()*7),collidable:Math.abs(offset)<19};
});
const nearTrees=Array.from({length:690},(_,i)=>{const p=sampleTrack(i/689),side=i%2?1:-1,offset=side*(13+random()*17),x=p.x-p.tangent.z*offset,z=p.z+p.tangent.x*offset;return {id:'near-tree-'+i,x,z,y:getTerrainHeight(x,z),height:14+random()*9,width:7+random()*5,rotation:random()*Math.PI,variant:Math.floor(random()*7)};});
const startTrees=Array.from({length:450},(_,i)=>{const x=-165+random()*330,z=-180+random()*220;return {id:'backdrop-tree-'+i,x,z,y:getTerrainHeight(x,z),height:14+random()*10,width:7+random()*5,rotation:random()*Math.PI,variant:Math.floor(random()*7)};});
export const FOREST_TREES=[...scatteredTrees,...nearTrees,...startTrees].filter(tree=>getTrackProjection(tree.x,tree.z).distance>11).map(tree=>({...tree,collidable:getTrackProjection(tree.x,tree.z).distance<19}));
const hutPoint=sampleTrack(.20);
export const MARSHAL_HUT=Object.freeze({id:'marshal-hut',type:'box',x:hutPoint.x-hutPoint.tangent.z*17,z:hutPoint.z+hutPoint.tangent.x*17,halfX:1.7,halfZ:1.35,yaw:hutPoint.heading,y:getTerrainHeight(hutPoint.x-hutPoint.tangent.z*17,hutPoint.z+hutPoint.tangent.x*17)});
export const STATIC_COLLIDERS=Object.freeze([
 ...BARRIER_PATHS.map(b=>({id:b.id,type:'barrier',points:b.points.map(p=>[p[0],p[2]]),radius:.12})),
 ...[-6.1,6.1].map((offset,i)=>{const p=sampleTrack(FINISH_T);return{id:'finish-post-'+i,type:'box',x:p.x+p.tangent.z*offset,z:p.z-p.tangent.x*offset,halfX:.5,halfZ:.6,yaw:p.heading};}),
 MARSHAL_HUT,
 ...FOREST_TREES.filter(t=>t.collidable).map(t=>({id:t.id,type:'circle',x:t.x,z:t.z,radius:.26})),
]);
export const TRACK_LANDMARKS=Object.freeze([{name:'ESCHBACH',t:.08},{name:'BRÜNNCHEN',t:.22},{name:'EISKURVE',t:.38},{name:'PFLANZGARTEN',t:.58},{name:'STEFAN-BELLOF-S',t:.87}]);
