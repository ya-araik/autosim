import { createHeroWheelModel } from './hero-wheel-model.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

export const COCKPIT_CONFIGS = Object.freeze({
  standard: Object.freeze({ name: 'Standard', base: 'MOZA R5', diagonal: 55, aspect: 16 / 9, curved: false, shifter: false }),
  pro: Object.freeze({ name: 'Pro', base: 'MOZA R12', diagonal: 49, aspect: 32 / 9, curved: true, shifter: false }),
  vip: Object.freeze({ name: 'VIP', base: 'MOZA R9', diagonal: 65, aspect: 16 / 9, curved: false, shifter: true }),
});
export function cockpitScreenSize(tariff = 'standard') {
  const config = Object.hasOwn(COCKPIT_CONFIGS, tariff) ? COCKPIT_CONFIGS[tariff] : COCKPIT_CONFIGS.standard;
  const height = config.diagonal * .0254 / Math.hypot(config.aspect, 1);
  return { width: height * config.aspect, height, diagonal: config.diagonal, aspect: config.aspect };
}

/** A dimensional equipment concept, not a scan of a particular club assembly.
 * Metres, +Y up, driver faces +Z. Groups are independently inspectable in tests. */
export function createCockpitModel(THREE, options = {}) {
  const group = new THREE.Group(); group.name = 'Autosim complete cockpit';
  const mats = new Set(), geoms = new Set(), ownedTextures = new Set();
  const makeMat = (type, parameters) => { const m = new THREE[type](parameters); mats.add(m); return m; };
  const paint = makeMat('MeshStandardMaterial', { color: 0x252b30, roughness: .31, metalness: .82 });
  const alloy = makeMat('MeshStandardMaterial', { color: 0xa4adb3, roughness: .29, metalness: .95 });
  const darkAlloy = makeMat('MeshStandardMaterial', { color: 0x313940, roughness: .36, metalness: .91 });
  const slotMat = makeMat('MeshStandardMaterial', { color: 0x080d12, roughness: .7, metalness: .08 });
  const rubber = makeMat('MeshStandardMaterial', { color: 0x151a1e, roughness: .86, metalness: .03 });
  const leather = makeMat('MeshPhysicalMaterial', { color: 0x080b0e, roughness: .62, metalness: 0, sheen: .20, sheenColor: 0x333b42, sheenRoughness: .8 });
  const cushion = makeMat('MeshPhysicalMaterial', { color: 0x11161a, roughness: .84, metalness: 0, sheen: .25, sheenColor: 0x374149 });
  const orange = makeMat('MeshStandardMaterial', { color: 0xfc6538, roughness: .43, metalness: .18 });
  const thread = makeMat('MeshStandardMaterial', { color: 0xa0aab2, roughness: .91 });
  const led = makeMat('MeshBasicMaterial', { color: 0xfc6538, toneMapped: false });
  const screenMaterial = makeMat('MeshBasicMaterial', { color: options.screenTexture ? 0xffffff : 0x496981, map: options.screenTexture || null, toneMapped: false });
  const monitorCasing = makeMat('MeshStandardMaterial', { color: 0x252b30, roughness: .31, metalness: .82, side: THREE.DoubleSide });
  const labelMaterials = new Map();
  function labelMaterial(text, background = '#171e24', color = '#e7edf2') {
    const key = text + background + color;
    if (labelMaterials.has(key)) return labelMaterials.get(key);
    let texture;
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 48px Arial'; ctx.fillText(text, 256, 67);
      texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; ownedTextures.add(texture);
    }
    const material = makeMat('MeshStandardMaterial', { color: texture ? 0xffffff : 0xb9c5cf, map: texture || null, roughness: .62 });
    labelMaterials.set(key, material); return material;
  }
  function mesh(geometry, material, name, parent = group) {
    geoms.add(geometry); const object = new THREE.Mesh(geometry, material); object.name = name;
    object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  }
  function box(w, h, d, material, name, x, y, z, parent = group) {
    const object = mesh(new THREE.BoxGeometry(w, h, d), material, name, parent); object.position.set(x, y, z); return object;
  }
  function rounded(w, h, d, radius, material, name, x, y, z, parent = group) {
    const r = Math.min(radius, w / 2, h / 2), shape = new THREE.Shape();
    shape.moveTo(-w/2+r,-h/2);shape.lineTo(w/2-r,-h/2);shape.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);
    shape.lineTo(w/2,h/2-r);shape.quadraticCurveTo(w/2,h/2,w/2-r,h/2);shape.lineTo(-w/2+r,h/2);
    shape.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);shape.lineTo(-w/2,-h/2+r);shape.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);
    const geometry = new THREE.ExtrudeGeometry(shape,{depth:d,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:r*.18,bevelThickness:Math.min(.008,d*.18),curveSegments:5});
    geometry.translate(0,0,-d/2); const object = mesh(geometry,material,name,parent);object.position.set(x,y,z);return object;
  }
  function rod(a, b, radius, material, name, parent = group, sides = 12) {
    const first = new THREE.Vector3(...a), last = new THREE.Vector3(...b), delta = last.clone().sub(first);
    const object = mesh(new THREE.CylinderGeometry(radius,radius,delta.length(),sides),material,name,parent);
    object.position.copy(first.add(last).multiplyScalar(.5));object.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return object;
  }
  function tube(points, radius, material, name, parent = group, segments = 24) {
    return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),segments,radius,6,false),material,name,parent);
  }
  const bolts = [], stitchPoints = [], perforations = [];
  const bolt = (x,y,z,axis = 'y') => bolts.push({x,y,z,axis});
  function extrusion(length, x,y,z, orientation = 'z', parent = group) {
    const object = box(.082,.082,length,darkAlloy,'80 mm slotted aluminium rail',x,y,z,parent);
    if (orientation === 'x') object.rotation.y=Math.PI/2;
    // Recessed channels run the entire section, making the extrusion legible.
    for (const side of [-1,1]) {
      const channel=box(.009,.002,length-.012,slotMat,'Extrusion T-slot',side*.021,.042,0,object);
      box(.002,.009,length-.012,slotMat,'Outer extrusion groove',side*.042,0,0,object);
    }
    return object;
  }
  const chassis = new THREE.Group(); chassis.name='Extruded chassis, rails and feet';group.add(chassis);
  extrusion(2.28,-.31,.115,0,'z',chassis);extrusion(2.28,.31,.115,0,'z',chassis);
  for(const z of [-1.03,-.58,.03,.66,1.04])extrusion(.70,0,.115,z,'x',chassis);
  for(const x of [-.31,.31])for(const z of [-.99,.95]){
    rod([x,.024,z],[x,.080,z],.045,rubber,'Adjustable isolation foot',chassis,20);
    rod([x,.068,z],[x,.111,z],.012,alloy,'Foot adjustment spindle',chassis,12);
    bolt(x,.16,z);
  }
  for(const x of [-.19,.19]){
    box(.042,.035,.58,alloy,'Sliding seat rail',x,.205,-.60,chassis);
    box(.055,.025,.34,paint,'Seat rail carriage',x,.238,-.60,chassis);
    for(const z of [-.84,-.38])rod([x,.153,z],[x,.222,z],.014,paint,'Seat rail mount',chassis);
  }
  rod([-.19,.225,-.29],[.19,.225,-.29],.009,alloy,'Seat adjustment release bar',chassis);
  box(.14,.014,.035,rubber,'Seat rail release grip',0,.225,-.277,chassis);

  const seat = new THREE.Group();seat.name='Sculpted stitched racing seat';group.add(seat);
  rounded(.49,.11,.49,.05,leather,'Seat base cushion',0,.415,-.60,seat);
  rounded(.31,.020,.37,.02,cushion,'Perforated seat insert',0,.480,-.58,seat);
  for(const side of [-1,1]){
    const bolster=rounded(.102,.16,.49,.041,leather,'Raised thigh bolster',side*.244,.48,-.63,seat);bolster.rotation.z=-side*.12;
    tube([[side*.222,.55,-.825],[side*.227,.556,-.62],[side*.218,.544,-.415]],.0023,orange,'Orange lower seat seam',seat,18);
    box(.018,.22,.32,paint,'Seat side mounting bracket',side*.268,.287,-.64,seat);
    for(const z of [-.76,-.53])bolt(side*.28,.30,z,'x');
  }
  const back = new THREE.Group();back.name='Reclined seat back';back.position.set(0,.83,-.83);back.rotation.x=-.17;seat.add(back);
  rounded(.46,.70,.13,.08,leather,'Contoured back shell',0,0,0,back);
  let carbonTexture = null;
  if(typeof document!=='undefined'){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d');
    ctx.fillStyle='#080b0e';ctx.fillRect(0,0,128,128);
    for(let y=0;y<128;y+=8)for(let x=0;x<128;x+=8){
      const horizontal=((x+y)/8)%2===0;
      for(let i=0;i<4;i++){const shade=16+i*4;ctx.strokeStyle='rgb('+shade+','+(shade+2)+','+(shade+4)+')';ctx.lineWidth=1.2;ctx.beginPath();if(horizontal){ctx.moveTo(x,y+i*2);ctx.lineTo(x+8,y+i*2);}else{ctx.moveTo(x+i*2,y);ctx.lineTo(x+i*2,y+8);}ctx.stroke();}
    }
    carbonTexture=new THREE.CanvasTexture(canvas);carbonTexture.colorSpace=THREE.SRGBColorSpace;carbonTexture.wrapS=carbonTexture.wrapT=THREE.RepeatWrapping;carbonTexture.repeat.set(3,4);ownedTextures.add(carbonTexture);
  }
  const carbonShell=makeMat('MeshPhysicalMaterial',{color:carbonTexture?0x8b949d:0x0a0d10,map:carbonTexture,roughness:.37,metalness:.32,clearcoat:.4,clearcoatRoughness:.42});
  rounded(.398,.606,.009,.057,carbonShell,'Woven carbon rear seat shell',0,-.012,-.078,back);
  const rearBrand=mesh(new THREE.PlaneGeometry(.216,.054),labelMaterial('AUTOSIM','#0a0e12','#e7edf2'),'Rear embroidered AUTOSIM patch',back);
  rearBrand.position.set(0,.12,-.088);rearBrand.rotation.y=Math.PI;
  for(const side of [-1,1])tube([[side*.154,-.257,-.087],[side*.166,-.09,-.087],[side*.158,.211,-.086]],.0018,orange,'Rear shell orange stitched guide',back,22);
  rounded(.31,.49,.035,.032,cushion,'Perforated lumbar and back cushion',0,-.055,.082,back);
  for(const side of [-1,1]){
    const sidePad=rounded(.102,.56,.16,.05,leather,'Raised torso bolster',side*.22,-.06,.08,back);sidePad.rotation.z=side*.065;
    rounded(.074,.037,.014,.017,slotMat,'Harness opening',side*.100,.236,.078,back);
    rounded(.091,.053,.008,.019,alloy,'Harness opening trim',side*.100,.236,.071,back);
    tube([[side*.196,-.305,.172],[side*.209,-.10,.178],[side*.204,.13,.16]],.0023,orange,'Orange backrest seam',back,20);
  }
  const embroidered=mesh(new THREE.PlaneGeometry(.17,.045),labelMaterial('AUTOSIM','#303740','#d7e1e8'),'Seat embroidered club label',back);embroidered.position.set(0,.32,.075);
  // Fine details are batched: perforations and double stitches are not hundreds
  // of separate draw calls. Their placement follows the cushion surfaces.
  for(let x=-6;x<=6;x++)for(let y=-10;y<=9;y++)perforations.push([x*.018,-.071+y*.020,.103]);
  for(const side of [-1,1])for(let i=0;i<36;i++)stitchPoints.push([side*.177,-.296+i*.013,.108]);
  function instanceDots(points, geometry, material, parent, name, orient = false) {
    geoms.add(geometry);const object=new THREE.InstancedMesh(geometry,material,points.length);object.name=name;const dummy=new THREE.Object3D();
    points.forEach((p,i)=>{dummy.position.set(...p);if(orient)dummy.rotation.z=i%2*.15;dummy.updateMatrix();object.setMatrixAt(i,dummy.matrix);});
    object.instanceMatrix.needsUpdate=true;object.computeBoundingSphere();parent.add(object);return object;
  }
  instanceDots(perforations,new THREE.CircleGeometry(.0019,6),slotMat,back,'260 leather perforations');
  instanceDots(stitchPoints,new THREE.BoxGeometry(.0032,.0055,.001),thread,back,'72 individual stitches');
  tube([[-.19,.33,-.885],[-.10,.35,-.90],[.12,.35,-.90],[.19,.33,-.885]],.009,paint,'Rear seat reinforcement',seat);

  const controls=new THREE.Group();controls.name='Steering bridge and controls';group.add(controls);
  for(const side of [-1,1]){
    box(.068,.60,.068,darkAlloy,'Steering bridge upright',side*.315,.445,.09,controls);
    box(.018,.27,.065,alloy,'Upright adjustment rail',side*.355,.58,.09,controls);
    for(const y of [.50,.58,.66])bolt(side*.369,y,.09,'x');
    rod([side*.31,.16,-.17],[side*.315,.61,.09],.018,paint,'Steering bridge diagonal brace',controls);
  }
  box(.73,.032,.25,paint,'Adjustable wheelbase deck',0,.767,.11,controls);
  for(const x of [-.30,.30])for(const z of [.03,.20])bolt(x,.787,z);
  const base = new THREE.Group();base.name='Direct drive base';base.position.set(0,.858,.105);controls.add(base);
  const baseHousing=rounded(.183,.134,.238,.015,paint,'Direct drive motor housing',0,0,0,base);
  for(let i=-5;i<=5;i++){
    box(.188,.003,.214,alloy,'Motor cooling fin',0,i*.011,0,base);
    box(.003,.127,.214,darkAlloy,'Cooling fin edge',i*.015,0,0,base);
  }
  rod([0,0,-.132],[0,0,-.174],.053,alloy,'Motor shaft collar',base,32);
  rod([0,0,-.174],[0,0,-.21],.030,slotMat,'Quick-release shaft',base,24);
  for(const x of [-.063,.063])for(const y of [-.045,.045]){
    const screw=rod([x,y,-.123],[x,y,-.132],.007,alloy,'Motor face bolt',base,8);
  }
  const baseBadge=mesh(new THREE.PlaneGeometry(.117,.029),labelMaterial('MOZA R5'),'Wheelbase model plaque',base);
  baseBadge.position.set(.093,.024,0);baseBadge.rotation.y=Math.PI/2;
  const statusLed=mesh(new THREE.CircleGeometry(.0026,12),led,'Wheelbase status LED',base);statusLed.position.set(0,-.042,-.124);statusLed.rotation.y=Math.PI;
  const wheel = createHeroWheelModel(THREE);
  wheel.group.name='Detailed club steering wheel concept';wheel.group.scale.setScalar(.113);
  // Hero front points +Z. Rotate it toward the seated driver (-Z).
  wheel.group.rotation.y=Math.PI;wheel.group.position.set(0,.874,-.172);controls.add(wheel.group);
  wheel.settle();
  tube([[.077,.81,.22],[.23,.70,.25],[.315,.31,.22],[.31,.18,-.07]],.005,slotMat,'Wheelbase cable with strain relief',controls,28);

  const pedals=new THREE.Group();pedals.name='Three-pedal mechanical assembly';pedals.position.set(0,.20,.66);group.add(pedals);
  const pedalPlatform=box(.43,.021,.41,paint,'Pedal mounting plate',0,0,0,pedals);
  box(.42,.012,.14,alloy,'Brushed heel plate',0,.025,-.135,pedals);
  for(let i=-7;i<=7;i++)box(.002,.0015,.12,darkAlloy,'Heel plate anti-slip groove',i*.025,.032,-.135,pedals);
  for(const [index,x] of [-.135,0,.135].entries()){
    const pedal=new THREE.Group();pedal.name=['Clutch pedal','Brake pedal','Throttle pedal'][index];pedal.position.set(x,.026,.026);pedals.add(pedal);
    const width=index===2?.071:.087;
    for(const side of [-1,1])box(.010,.083,.093,alloy,'Pedal bearing cheek',side*.041,.041,0,pedal);
    rod([-.05,.044,0],[.05,.044,0],.009,alloy,'Pedal bearing shaft',pedal,16);
    const arm=box(.028,.205,.016,alloy,'Machined pedal lever',0,.134,.056,pedal);arm.rotation.x=.31;
    const face=rounded(width,.116,.012,.012,alloy,'Perforated pedal face',0,.240,.083,pedal);face.rotation.x=.30;
    for(let row=0;row<4;row++)for(let col=-1;col<=1;col++){
      const hole=mesh(new THREE.CircleGeometry(.004,8),slotMat,'Pedal face recess',face);hole.position.set(col*.019,(row-1.5)*.021,-.0065);hole.rotation.y=Math.PI;
    }
    rod([0,.08,.04],[0,.047,.177],index===1?.014:.010,slotMat,'Damper shaft',pedal,16);
    const springPoints=[];for(let i=0;i<=90;i++){const t=i/90,a=t*Math.PI*2*8;springPoints.push([Math.cos(a)*.020,.060+Math.sin(a)*.020,.082+t*.098]);}
    tube(springPoints,.0025,index===1?orange:alloy,'Return spring coil',pedal,90);
    rod([-.025,.041,.183],[.025,.041,.183],.009,alloy,'Spring preload adjustment',pedal,12);
    bolt(x,.218,.485);bolt(x,.218,.83);
  }
  const shifter=new THREE.Group();shifter.name='Sequential shifter concept';shifter.position.set(-.47,.56,-.13);group.add(shifter);
  rod([.15,-.40,.11],[.15,-.06,.11],.027,darkAlloy,'Shifter upright',shifter);
  box(.24,.017,.18,paint,'Shifter mounting platform',.05,-.035,0,shifter);
  rounded(.12,.077,.15,.011,paint,'Sequential shifter housing',0,.012,0,shifter);
  rod([0,.040,0],[0,.178,0],.012,alloy,'Gearshift lever',shifter,16);
  const knob=mesh(new THREE.SphereGeometry(.030,18,12),rubber,'Contoured sequential shift knob',shifter);knob.position.set(0,.185,0);knob.scale.y=1.35;
  const shiftBadge=mesh(new THREE.PlaneGeometry(.096,.024),labelMaterial('SIMAGIC'),'Shifter plaque',shifter);shiftBadge.position.set(-.061,.016,0);shiftBadge.rotation.y=-Math.PI/2;

  const monitorStand=new THREE.Group();monitorStand.name='Freestanding monitor bridge';group.add(monitorStand);
  for(const side of [-1,1]){
    extrusion(.70,side*.53,.06,.95,'z',monitorStand);
    box(.065,1.01,.065,darkAlloy,'Monitor stand vertical',side*.53,.585,1.16,monitorStand);
    box(.004,.87,.024,slotMat,'Monitor stand height slot',side*.564,.59,1.16,monitorStand);
    for(const z of [.65,1.25])rod([side*.53,.012,z],[side*.53,.034,z],.04,rubber,'Monitor stand foot',monitorStand);
    for(const y of [.87,1.02])bolt(side*.573,y,1.16,'x');
  }
  extrusion(1.17,0,1.057,1.16,'x',monitorStand);
  box(.25,.17,.038,paint,'VESA screen mounting plate',0,1.18,1.155,monitorStand);
  for(const x of [-.10,.10])for(const y of [1.115,1.245])bolt(x,y,1.184,'z');
  const screenGroup=new THREE.Group();screenGroup.name='Dimensioned display';screenGroup.position.set(0,1.285,1.09);group.add(screenGroup);
  let screenMeshes=[];
  function curvedSurface(width,height,radius,offset=0){
    const positions=[],uv=[],indices=[],segments=48;
    for(let i=0;i<=segments;i++){
      const x=(i/segments-.5)*width, angle=x/radius;
      const sx=radius*Math.sin(angle),sz=-radius*(1-Math.cos(angle))+offset;
      positions.push(sx,-height/2,sz,sx,height/2,sz);uv.push(1-i/segments,0,1-i/segments,1);
      if(i<segments){const a=i*2;indices.push(a,a+1,a+2,a+2,a+1,a+3);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
  }
  function rebuildScreen(config){
    screenMeshes.forEach(object=>{screenGroup.remove(object);object.geometry.dispose();geoms.delete(object.geometry);});screenMeshes=[];
    const size=cockpitScreenSize(state.tariff),width=size.width,height=size.height;
    if(config.curved){
      const backPanel=mesh(curvedSurface(width+.025,height+.025,1.8,.009),monitorCasing,'Curved monitor casing',screenGroup);screenMeshes.push(backPanel);
      const display=mesh(curvedSurface(width,height,1.8,-.004),screenMaterial,'Active 49-inch 32:9 curved panel',screenGroup);display.castShadow=false;screenMeshes.push(display);
    }else{
      screenMeshes.push(rounded(width+.022,height+.022,.038,.016,paint,'Thin display casing',0,0,.010,screenGroup));
      // The bevel extends beyond the nominal case depth: place the live panel
      // in front of that bevel, otherwise the opaque front cap hides the image.
      const display=mesh(new THREE.PlaneGeometry(width,height),screenMaterial,'Active '+config.diagonal+'-inch 16:9 panel',screenGroup);display.position.z=-.025;display.rotation.y=Math.PI;display.castShadow=false;screenMeshes.push(display);
    }
    screenGroup.userData={...size,curved:config.curved};
    screenGroup.position.y=1.285+(height-.685)*.4;
    screenGroup.scale.setScalar(.97);
  }
  const vr=new THREE.Group();vr.name='VR headset on side hanger';vr.position.set(.47,.79,-.58);vr.rotation.set(.05,-.30,.12);group.add(vr);
  rod([-.17,-.15,0],[-.02,-.15,0],.010,alloy,'Headset hanger',vr);
  rounded(.195,.090,.115,.022,rubber,'VR headset housing',0,0,0,vr);
  rounded(.174,.069,.019,.023,paint,'VR headset visor',0,0,.066,vr);
  for(const x of [-.070,.070]){const sensor=mesh(new THREE.SphereGeometry(.006,10,8),slotMat,'Tracking camera',vr);sensor.position.set(x,.019,.079);}
  tube([[-.083,.008,-.049],[-.10,.015,-.15],[0,.022,-.205],[.10,.015,-.15],[.083,.008,-.049]],.008,rubber,'Adjustable headset strap',vr,32);
  tube([[0,.044,.017],[0,.093,-.072],[0,.046,-.20]],.007,slotMat,'Headset top strap',vr,20);
  for(const side of [-1,1]){const lens=mesh(new THREE.SphereGeometry(.029,16,12),makeMat('MeshPhysicalMaterial',{color:0x224553,metalness:.4,roughness:.11}),'VR optical lens',vr);lens.position.set(side*.045,0,-.060);lens.scale.z=.23;}

  const boltGeo=new THREE.CylinderGeometry(.008,.008,.006,6);geoms.add(boltGeo);
  const boltMesh=new THREE.InstancedMesh(boltGeo,alloy,bolts.length),dummy=new THREE.Object3D();boltMesh.name='Machined hex fasteners';
  bolts.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(p.axis==='z'?Math.PI/2:0,0,p.axis==='x'?Math.PI/2:0);dummy.updateMatrix();boltMesh.setMatrixAt(i,dummy.matrix);});boltMesh.instanceMatrix.needsUpdate=true;boltMesh.computeBoundingSphere();boltMesh.castShadow=true;group.add(boltMesh);
  const state={tariff:'standard',vr:false};let transition=0;
  function batchStatic(parent, exclusions = []) {
    parent.updateWorldMatrix(true,true);
    const inverse=new THREE.Matrix4().copy(parent.matrixWorld).invert(),batches=new Map();
    function collect(object){
      if(exclusions.includes(object))return;
      if(object.isMesh&&!object.isInstancedMesh&&!Array.isArray(object.material)){
        const key=object.material.uuid+':'+Object.keys(object.geometry.attributes).sort().join(',');
        if(!batches.has(key))batches.set(key,{material:object.material,geometries:[],objects:[]});
        const batch=batches.get(key),geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld));
        batch.geometries.push(geometry);batch.objects.push(object);
      }
      for(const child of object.children)collect(child);
    }
    for(const child of parent.children)collect(child);
    for(const batch of batches.values()){
      if(batch.objects.length<2){batch.geometries.forEach(g=>g.dispose());continue;}
      const combined=mergeGeometries(batch.geometries,false);batch.geometries.forEach(g=>g.dispose());
      if(!combined)continue;
      const object=mesh(combined,batch.material,'Batched '+parent.name,parent);
      object.userData.parts=batch.objects.map(o=>o.name);
      batch.objects.forEach(o=>o.removeFromParent());
    }
  }
  // Fine mechanical details remain real geometry while sharing draw calls.
  for(const part of [chassis,seat,pedals,monitorStand,vr,shifter,wheel.group])batchStatic(part);
  batchStatic(base,[baseBadge]);batchStatic(controls,[base,wheel.group]);
  function setConfiguration(tariff='standard',enableVr=false){
    state.tariff=Object.hasOwn(COCKPIT_CONFIGS,tariff)?tariff:'standard';state.vr=Boolean(enableVr);
    const config=COCKPIT_CONFIGS[state.tariff];
    base.scale.set(config.base==='MOZA R12'?1.15:config.base==='MOZA R9'?1.06:1,1,config.base==='MOZA R12'?1.18:1);
    baseBadge.material=labelMaterial(config.base);
    shifter.visible=config.shifter;vr.visible=state.vr;
    rebuildScreen(config);transition=1;
    group.userData={tariff:state.tariff,base:config.base,screen:cockpitScreenSize(state.tariff),shifter:config.shifter,vr:state.vr,concept:true};
  }
  function update(dt){transition=Math.max(0,transition-Math.max(0,dt)*3.3);screenGroup.scale.setScalar(1-.03*transition*transition);return transition>0;}
  function settle(){transition=0;screenGroup.scale.setScalar(1);wheel.settle();}
  function dispose(){wheel.dispose();geoms.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());ownedTextures.forEach(t=>t.dispose());}
  setConfiguration(options.tariff,options.vr);settle();
  return {group,setConfiguration,update,settle,dispose,seat,chassis,pedals,wheel,base,screenGroup,shifter,vr,getState:()=>({...state})};
}
