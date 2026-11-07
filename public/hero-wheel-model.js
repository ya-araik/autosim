import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

/** AUTOSIM A-01: an original club steering-wheel concept, not retail hardware.
 * Geometry is generated locally; no model, fonts or textures are fetched. */
export function createHeroWheelModel(THREE, options = {}) {
  const group = new THREE.Group(); group.name = 'AUTOSIM A-01 concept';
  const wheel = new THREE.Group(); wheel.name = 'Steering assembly'; group.add(wheel);
  const interactables = [], textures = [], materials = new Set(), geometrySet = new Set();
  const state = {gear: 1, mode: 'TRACK', finish: 'carbon', callsign: 'DRIVER', accent: '#fc6538', steering: 0, rpm: 2.4};
  let rpmTarget = 2.4, pulse = 0, leftPress = 0, rightPress = 0;
  function canvasTexture(width, height, paint) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    paint(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4; textures.push(texture); return texture;
  }
  const carbon = canvasTexture(256, 256, ctx => {
    ctx.fillStyle = '#1f2429'; ctx.fillRect(0,0,256,256);
    for(let y=0;y<256;y+=16)for(let x=0;x<256;x+=16){
      const horizontal=((x+y)/16)%2===0;
      for(let line=0;line<8;line++){
        const shine=Math.round(33+15*Math.sin(line/7*Math.PI)); ctx.strokeStyle=`rgb(${shine},${shine+3},${shine+6})`;ctx.lineWidth=1.3;ctx.beginPath();
        if(horizontal){ctx.moveTo(x,y+line*2);ctx.lineTo(x+16,y+line*2);}else{ctx.moveTo(x+line*2,y);ctx.lineTo(x+line*2,y+16);}ctx.stroke();
      }
      ctx.strokeStyle='#12161a';ctx.lineWidth=.7;ctx.strokeRect(x+.4,y+.4,15.2,15.2);
    }
  });
  if(carbon){carbon.wrapS=carbon.wrapT=THREE.RepeatWrapping;carbon.repeat.set(2.7,2.7);}
  const leather = canvasTexture(256,256,ctx=>{
    ctx.fillStyle='#818181';ctx.fillRect(0,0,256,256);let seed=631;
    for(let i=0;i<13000;i++){seed=(seed*16807)%2147483647;const x=seed%256;seed=(seed*16807)%2147483647;const y=seed%256;const v=104+(seed%47);ctx.fillStyle=`rgb(${v},${v},${v})`;ctx.fillRect(x,y,1,1);}
  });
  if(leather){leather.colorSpace=THREE.NoColorSpace;leather.wrapS=leather.wrapT=THREE.RepeatWrapping;leather.repeat.set(12,2);}
  const brushed = canvasTexture(256,256,ctx=>{
    ctx.fillStyle='#bec6cc';ctx.fillRect(0,0,256,256);
    for(let y=0;y<256;y++){const v=170+(y*47%54);ctx.fillStyle=`rgb(${v},${v+4},${Math.min(255,v+9)})`;ctx.fillRect(0,y,256,1);}
  });
  const mat = (type, config) => {const m=new THREE[type](config);materials.add(m);return m;};
  const leatherMat = mat('MeshPhysicalMaterial',{color:0x161a1d,roughness:.73,metalness:0,bumpMap:leather,bumpScale:.014,clearcoat:.08});
  const plateMat = mat('MeshPhysicalMaterial',{color:0x747b83,map:carbon,roughness:.31,metalness:.43,clearcoat:.6,clearcoatRoughness:.25});
  const rearMat = mat('MeshStandardMaterial',{color:0x313941,metalness:.85,roughness:.37,map:brushed});
  const metalMat = mat('MeshStandardMaterial',{color:0xaab4be,metalness:.95,roughness:.25,map:brushed});
  const darkMat = mat('MeshStandardMaterial',{color:0x10151a,metalness:.4,roughness:.48});
  const blackMat = mat('MeshStandardMaterial',{color:0x030609,metalness:.05,roughness:.8});
  const accentMat = mat('MeshPhysicalMaterial',{color:state.accent,metalness:.38,roughness:.3,clearcoat:.6});
  const stitchMat = mat('MeshStandardMaterial',{color:0xa6adb0,roughness:.86});
  const holeMat = mat('MeshBasicMaterial',{color:0x05070a});
  const displayGlass = mat('MeshPhysicalMaterial',{color:0x111d22,roughness:.13,metalness:.18,clearcoat:1});
  function mesh(geometry, material, name, parent=wheel) {
    geometrySet.add(geometry); const obj=new THREE.Mesh(geometry,material);obj.name=name;obj.castShadow=true;obj.receiveShadow=true;parent.add(obj);return obj;
  }
  function cylinder(radius,depth,material,name,x,y,z,segments=48,parent=wheel){const g=new THREE.CylinderGeometry(radius,radius,depth,segments);g.rotateX(Math.PI/2);const m=mesh(g,material,name,parent);m.position.set(x,y,z);return m;}
  function roundedPlate(points,depth,bevel,material,name,z,parent=wheel){
    const shape=new THREE.Shape();points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:3,curveSegments:12,steps:1});
    const m=mesh(g,material,name,parent);m.position.z=z;return m;
  }
  function label(text,width,height,x,y,z,{color='#d7dee2',background='',font=56,rotation=0,parent=wheel}={}){
    const map=canvasTexture(512,Math.round(512*height/width), (ctx,w,h)=>{ctx.clearRect(0,0,w,h);if(background){ctx.fillStyle=background;ctx.fillRect(0,0,w,h);}ctx.fillStyle=color;ctx.font=`600 ${font}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,w/2,h/2);});
    const material=mat('MeshBasicMaterial',{map,color:map?0xffffff:0xb9c4cb,transparent:true,depthWrite:false,toneMapped:false});
    const obj=mesh(new THREE.PlaneGeometry(width,height),material,text+' engraving',parent);obj.position.set(x,y,z);obj.rotation.z=rotation;obj.castShadow=false;return obj;
  }
  // The original A mark is constructed as a shallow solid from the club mark's
  // recognisable outline, with genuine side faces rather than a floating sticker.
  function logo(size,x,y,z,parent=wheel,material=accentMat){
    const points=[[178,447],[359,191],[462,191],[462,447],[308,447],[359,373],[386,373],[386,298],[280,447]];
    const shape=new THREE.Shape();points.forEach(([a,b],i)=>{const px=(a-320)/284*size,py=(319-b)/256*size;i?shape.lineTo(px,py):shape.moveTo(px,py);});shape.closePath();
    const object=mesh(new THREE.ExtrudeGeometry(shape,{depth:.009,bevelEnabled:true,bevelSize:.0015,bevelThickness:.0015,bevelSegments:1}),material,'AUTOSIM A emblem',parent);object.position.set(x,y,z);return object;
  }
  const rimPoints=[];
  for(let i=0;i<96;i++){const a=i/96*Math.PI*2;let x=1.39*Math.sin(a),y=1.36*Math.cos(a);if(y<-.99)y=-.99+(y+.99)*.29;const pinch=Math.exp(-(((Math.abs(y)-.49)/.23)**2))*.035;x-=Math.sign(x)*pinch;rimPoints.push(new THREE.Vector3(x,y,.015));}
  const rimCurve=new THREE.CatmullRomCurve3(rimPoints,true,'centripetal');
  const positions=[],normals=[],uvs=[],indices=[],rimSamples=192,crossSamples=24;
  for(let i=0;i<=rimSamples;i++){
    const t=i/rimSamples,p=rimCurve.getPointAt(t),tangent=rimCurve.getTangentAt(t),out=new THREE.Vector3(tangent.y,-tangent.x,0).normalize();
    if(out.dot(new THREE.Vector3(p.x,p.y,0))<0)out.negate();
    const sideGrip=Math.pow(Math.abs(p.x)/1.39,8),radial=.147+sideGrip*.034,depth=.145+sideGrip*.017;
    for(let j=0;j<=crossSamples;j++){const a=j/crossSamples*Math.PI*2,c=Math.cos(a),s=Math.sin(a);positions.push(p.x+out.x*c*radial,p.y+out.y*c*radial,p.z+s*depth);normals.push(out.x*c,out.y*c,s);uvs.push(t,j/crossSamples);}
  }
  for(let i=0;i<rimSamples;i++)for(let j=0;j<crossSamples;j++){const a=i*(crossSamples+1)+j,b=a+crossSamples+1;indices.push(a,a+1,b,b,a+1,b+1);}
  const rimGeometry=new THREE.BufferGeometry();rimGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));rimGeometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));rimGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));rimGeometry.setIndex(indices);rimGeometry.computeVertexNormals();
  mesh(rimGeometry,leatherMat,'Anatomical leather rim');
  const dummy=new THREE.Object3D(),direction=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
  // Double stitching follows the inside of the complete rim, including the flat bottom.
  const stitchGeometry=new THREE.CylinderGeometry(.004,.004,1,5),stitches=new THREE.InstancedMesh(stitchGeometry,stitchMat,360);geometrySet.add(stitchGeometry);
  for(let i=0;i<180;i++)for(let side=0;side<2;side++){
    const t=i/180,p=rimCurve.getPointAt(t),q=rimCurve.getPointAt((t+.0028)%1),normal=p.clone().setZ(0).normalize(),offset=.115;
    p.addScaledVector(normal,-offset);q.addScaledVector(normal,-offset);p.z=q.z=.118+side*.014;
    if(side){p.addScaledVector(normal,-.02);q.addScaledVector(normal,-.02);}
    direction.subVectors(q,p);dummy.position.copy(p).add(q).multiplyScalar(.5);dummy.quaternion.setFromUnitVectors(up,direction.clone().normalize());dummy.scale.set(1,direction.length(),1);dummy.updateMatrix();stitches.setMatrixAt(i*2+side,dummy.matrix);
  }
  stitches.name='360 individual leather stitches';stitches.instanceMatrix.needsUpdate=true;wheel.add(stitches);
  // Individually modelled perforations sit on the front of each thumb grip.
  const holesGeometry=new THREE.CircleGeometry(.008,7),holes=new THREE.InstancedMesh(holesGeometry,holeMat,240);geometrySet.add(holesGeometry);
  let hole=0;
  for(const side of [-1,1])for(let row=0;row<40;row++)for(let column=0;column<3;column++){
    const t=(side<0?.625:.125)+row/39*.25,p=rimCurve.getPointAt(t),tangent=rimCurve.getTangentAt(t),out=new THREE.Vector3(tangent.y,-tangent.x,0).normalize();if(out.dot(p)<0)out.negate();
    const grip=Math.pow(Math.abs(p.x)/1.39,8),radial=.147+grip*.034,depth=.145+grip*.017,offset=(column-1)*.048,slope=offset/radial;
    dummy.position.copy(p).addScaledVector(out,offset);dummy.position.z=p.z+depth*Math.sqrt(1-slope*slope)+.0015;
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(out.x*slope,out.y*slope,Math.sqrt(1-slope*slope)));dummy.scale.setScalar(1);dummy.updateMatrix();holes.setMatrixAt(hole++,dummy.matrix);
  }
  holes.name='Perforated thumb grips';holes.instanceMatrix.needsUpdate=true;wheel.add(holes);
  // Top-centre index is a physical insert wrapping the leather, not a decal.
  const topBand=mesh(new THREE.TorusGeometry(.151,.017,7,18,Math.PI),accentMat,'Twelve o’clock index');topBand.rotation.set(0,Math.PI/2,0);topBand.position.set(0,1.36,.015);
  const indexFront=mesh(new THREE.BoxGeometry(.046,.29,.009),accentMat,'Front index stripe');indexFront.position.set(0,1.36,.163);
  const faceOutline=[[-1.16,.43],[-.9,.56],[-.53,.39],[.53,.39],[.9,.56],[1.16,.43],[1.10,-.13],[.65,-.36],[.35,-.80],[-.35,-.80],[-.65,-.36],[-1.10,-.13]];
  roundedPlate(faceOutline,.075,.038,plateMat,'Woven carbon faceplate',.135);
  roundedPlate(faceOutline,.055,.03,rearMat,'Machined rear chassis',-.10);
  // Lower split-spoke opening has exposed metal edges and a separate carbon bridge.
  roundedPlate([[-.39,-.77],[-.30,-1.05],[.30,-1.05],[.39,-.77]],.06,.024,plateMat,'Lower structural spoke',.06);
  for(const side of [-1,1])roundedPlate([[side*.99,-.11],[side*1.28,-.03],[side*1.28,.27],[side*1.06,.34]],.10,.025,darkMat,'Grip bridge',.005);
  // Captive fasteners: real hex recesses inside circular machined bolt heads.
  const fasteners=[[-.66,.29],[.66,.29],[-1.04,.31],[1.04,.31],[-.33,-.64],[.33,-.64]];
  fasteners.forEach(([x,y])=>{cylinder(.034,.021,metalMat,'Captive screw head',x,y,.254,24);cylinder(.014,.003,blackMat,'Hexagonal screw recess',x,y,.267,6);});
  cylinder(.305,.046,darkMat,'Centre badge housing',0,-.25,.251);
  cylinder(.273,.009,blackMat,'Satin badge face',0,-.25,.281);
  logo(.23,0,-.225,.291);
  label('A U T O S I M',.38,.053,0,-.403,.300,{font:52});
  label('A–01',.30,.088,0,-.668,.263,{font:90});
  label('CLUB CONCEPT',.40,.045,0,-.744,.263,{font:42,color:'#84939d'});
  // OLED glass sits in its own chamfered aluminium bezel above the centre badge.
  roundedPlate([[-.48,.16],[-.48,.55],[.48,.55],[.48,.16]],.030,.022,metalMat,'OLED machined bezel',.242);
  roundedPlate([[-.451,.182],[-.451,.526],[.451,.526],[.451,.182]],.012,.014,displayGlass,'OLED cover glass',.285);
  const displayCanvas=typeof document!=='undefined'?document.createElement('canvas'):null;
  let displayTexture=null;
  if(displayCanvas){displayCanvas.width=1024;displayCanvas.height=384;displayTexture=new THREE.CanvasTexture(displayCanvas);displayTexture.colorSpace=THREE.SRGBColorSpace;textures.push(displayTexture);}
  const displayMat=mat('MeshBasicMaterial',{map:displayTexture,color:displayTexture?0xffffff:0x14252b,toneMapped:false});
  const screen=mesh(new THREE.PlaneGeometry(.863,.315),displayMat,'Live OLED display');screen.position.set(0,.354,.314);screen.castShadow=false;
  const ledMaterials=[],leds=[];
  for(let i=0;i<13;i++){
    const material=mat('MeshStandardMaterial',{color:0x263533,emissive:0x5ceeb4,emissiveIntensity:.15,roughness:.25,metalness:.15});ledMaterials.push(material);
    const led=mesh(new THREE.BoxGeometry(.052,.021,.022),material,'RPM light '+(i+1));led.position.set((i-6)*.066,.592,.248);leds.push(led);
  }
  const buttonActions=[['PIT','mode'],['RAD','mode'],['VIEW','view'],['TC−','mode'],['TC+','mode'],['MAP','mode']];
  buttonActions.forEach(([text,action],i)=>{
    const side=i<3?-1:1,index=i%3,x=side*(index===2?.82:.90),y=.26-index*.215;
    const collar=cylinder(.092,.040,metalMat,text+' button collar',x,y,.242,32);collar.userData.action=action;
    const button=cylinder(.077,.041,index===0?accentMat:darkMat,text+' tactile button',x,y,.277,32);button.userData.action=action;interactables.push(button);
    label(text,.115,.041,x,y,.301,{font:130,color:index===0?'#ffffff':'#c9d4d9'}).userData.action=action;
  });
  const encoderGroup=new THREE.Group();encoderGroup.name='Knurled mode encoders';encoderGroup.userData.action='mode';wheel.add(encoderGroup);
  for(const side of [-1,1]){
    const x=side*.49,y=-.37; cylinder(.139,.060,darkMat,'Encoder gasket',x,y,.253,36,encoderGroup);
    const knob=cylinder(.119,.079,metalMat,'Machined rotary encoder',x,y,.29,40,encoderGroup);knob.userData.action='mode';interactables.push(knob);
    cylinder(.095,.010,darkMat,'Encoder satin face',x,y,.336,36,encoderGroup);
    for(let i=0;i<24;i++){const a=i*Math.PI/12;const flute=mesh(new THREE.BoxGeometry(.016,.030,.075),darkMat,'Encoder knurl',encoderGroup);flute.position.set(x+Math.sin(a)*.117,y+Math.cos(a)*.117,.294);flute.rotation.z=-a;}
    const tick=mesh(new THREE.BoxGeometry(.012,.038,.006),accentMat,'Encoder index',encoderGroup);tick.position.set(x,y+.060,.345);
    label(side<0?'MODE':'FEEL',.19,.043,x,y-.175,.254,{font:100,color:'#87979f'});
  }
  // Rear flange, six mounting screws, spline teeth and anodised quick release.
  cylinder(.47,.095,rearMat,'Rear six-bolt flange',0,-.14,-.195,64);
  cylinder(.345,.255,metalMat,'Brushed aluminium rear hub',0,-.14,-.355,64);
  cylinder(.355,.043,accentMat,'Anodised quick-release collar',0,-.14,-.509,64);
  cylinder(.277,.090,darkMat,'Quick-release locking sleeve',0,-.14,-.575,48);
  cylinder(.208,.018,metalMat,'Rear keyed socket',0,-.14,-.631,40);
  cylinder(.133,.025,blackMat,'Quick-release socket recess',0,-.14,-.644,32);
  for(let i=0;i<6;i++){const a=i*Math.PI/3;cylinder(.030,.025,metalMat,'Rear flange bolt',Math.sin(a)*.414,-.14+Math.cos(a)*.414,-.256,24);cylinder(.012,.004,blackMat,'Rear bolt hex recess',Math.sin(a)*.414,-.14+Math.cos(a)*.414,-.271,6);}
  for(let i=0;i<24;i++){const a=i*Math.PI/12;const tooth=mesh(new THREE.BoxGeometry(.028,.030,.045),metalMat,'Keyed spline tooth');tooth.position.set(Math.sin(a)*.137,-.14+Math.cos(a)*.137,-.646);tooth.rotation.z=-a;}
  for(let i=0;i<5;i++)cylinder(.010,.023,accentMat,'Gold data pin',(i-2)*.030,-.14,-.674,12);
  const paddlePivots=[];
  for(const side of [-1,1]){
    const pivot=new THREE.Group();pivot.name=side<0?'Downshift paddle pivot':'Upshift paddle pivot';pivot.position.set(side*.68,.05,-.23);pivot.userData.action=side<0?'down':'up';wheel.add(pivot);paddlePivots.push(pivot);
    const outline=[[side*.13,-.55],[side*.39,-.40],[side*.48,.34],[side*.34,.65],[side*.10,.55]];
    const paddle=roundedPlate(outline,.035,.025,plateMat,side<0?'Downshift paddle':'Upshift paddle',-.105,pivot);paddle.userData.action=side<0?'down':'up';interactables.push(paddle);
    cylinder(.087,.15,metalMat,'Magnetic paddle hinge',0,0,-.03,28,pivot);
    const frontLabel=label(side<0?'−':'+',.18,.18,side*.31,.41,-.039,{font:360,color:'#e7edf0',parent:pivot});
    const rearLabel=label(side<0?'−':'+',.18,.18,side*.31,.41,-.143,{font:360,color:'#e7edf0',parent:pivot});rearLabel.rotation.y=Math.PI;
    const spring=mesh(new THREE.TorusGeometry(.066,.009,6,24),accentMat,'Paddle return spring',pivot);spring.position.set(0,0,-.122);
  }
  label('AUTOSIM  /  A–01',.74,.079,0,.35,-.159,{font:60,parent:wheel}).rotation.y=Math.PI;
  label('DESIGNED FOR THE FEELING',.80,.041,0,-.74,-.144,{font:28,color:'#94a3ad',parent:wheel}).rotation.y=Math.PI;
  // Merge non-interactive machining details per material. Retain all clickable
  // caps, OLED elements and paddle pivots as independently addressable meshes.
  group.userData.designParts=[];group.traverse(object=>{if(object.isMesh)group.userData.designParts.push(object.name);});
  function batchDetails(parent){
    const buckets=new Map();
    for(const child of [...parent.children])if(child.isMesh&&!child.isInstancedMesh&&!child.userData.action&&child.name!=='AUTOSIM A emblem'){
      const list=buckets.get(child.material)||[];list.push(child);buckets.set(child.material,list);
    }
    for(const [material,parts]of buckets){
      if(parts.length<2)continue;
      const geometries=parts.map(part=>{part.updateMatrix();const g=part.geometry.index?part.geometry.toNonIndexed():part.geometry.clone();g.applyMatrix4(part.matrix);return g;});
      const merged=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!merged)continue;
      const combined=mesh(merged,material,'Batched machining details',parent);combined.userData.parts=parts.map(part=>part.name);combined.castShadow=parts.some(part=>part.castShadow);
      parts.forEach(part=>{parent.remove(part);geometrySet.delete(part.geometry);part.geometry.dispose();});
    }
  }
  batchDetails(wheel);batchDetails(encoderGroup);paddlePivots.forEach(batchDetails);
  function paintDisplay(){
    if(!displayCanvas)return;
    const ctx=displayCanvas.getContext('2d');ctx.fillStyle='#071015';ctx.fillRect(0,0,1024,384);
    ctx.fillStyle=state.accent;ctx.fillRect(30,30,6,274);ctx.font='600 32px Arial';ctx.fillText('AUTOSIM  /  A–01',65,58);
    ctx.beginPath();[[178,447],[359,191],[462,191],[462,447],[308,447],[359,373],[386,373],[386,298],[280,447]].forEach(([x,y],i)=>{const px=900+(x-178)*.21,py=24+(y-191)*.21;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.closePath();ctx.fill();
    ctx.fillStyle='#f3f6f6';ctx.font='600 174px Arial';ctx.fillText('D'+state.gear,54,243);
    ctx.fillStyle=state.accent;ctx.font='600 46px Arial';ctx.fillText(state.mode,370,138);
    ctx.fillStyle='#a6b7c1';ctx.font='500 30px Arial';ctx.fillText(state.callsign.slice(0,18),372,190);
    ctx.fillStyle='#6e8590';ctx.font='400 24px Arial';ctx.fillText(state.finish==='carbon'?'FORGED FEEL. WOVEN SOUL.':'PRECISION IN EVERY DETAIL.',372,236);
    for(let i=0;i<26;i++){ctx.fillStyle=i<Math.round(state.rpm/9*26)?(i>21?state.accent:'#8fe0c5'):'#1c2c34';ctx.fillRect(62+i*35,293,27,17);}
    ctx.fillStyle='#718b98';ctx.font='500 21px Arial';ctx.fillText('CLUB STEERING CONCEPT',63,355);ctx.textAlign='right';ctx.fillText('0'+state.gear+' / 07',959,355);ctx.textAlign='left';displayTexture.needsUpdate=true;
  }
  let displayedRPM=-1;
  function setSteering(degrees){state.steering=THREE.MathUtils.clamp(Number(degrees)||0,-450,450);wheel.rotation.z=-state.steering*Math.PI/180;}
  function shift(direction){const next=THREE.MathUtils.clamp(state.gear+Math.sign(direction),1,7);if(direction<0)leftPress=1;else rightPress=1;if(next!==state.gear){state.gear=next;rpmTarget=3.0+state.gear*.63;pulse=1;}paintDisplay();return state.gear;}
  function cycleMode(){const modes=['TRACK','DRIFT','TOUR'];state.mode=modes[(modes.indexOf(state.mode)+1)%modes.length];pulse=1;paintDisplay();return state.mode;}
  function setFinish(finish){state.finish=finish==='titanium'?'titanium':'carbon';plateMat.map=state.finish==='carbon'?carbon:brushed;plateMat.color.set(state.finish==='carbon'?0x747b83:0x8d99a2);plateMat.metalness=state.finish==='carbon'?.43:.92;plateMat.roughness=state.finish==='carbon'?.31:.32;plateMat.needsUpdate=true;paintDisplay();}
  function setIdentity(identity={}){if(typeof identity.callsign==='string')state.callsign=identity.callsign.trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,18)||'DRIVER';if(typeof identity.accent==='string'&&/^#[0-9a-f]{6}$/i.test(identity.accent)){state.accent=identity.accent;accentMat.color.set(identity.accent);}paintDisplay();}
  function update(dt=0){dt=THREE.MathUtils.clamp(Number(dt)||0,0,.06);leftPress=Math.max(0,leftPress-dt*5);rightPress=Math.max(0,rightPress-dt*5);pulse=Math.max(0,pulse-dt*1.7);paddlePivots[0].rotation.y=-Math.sin(leftPress*Math.PI)*.12;paddlePivots[1].rotation.y=Math.sin(rightPress*Math.PI)*.12;state.rpm+=(rpmTarget-state.rpm)*(1-Math.exp(-dt*9));if(Math.abs(rpmTarget-state.rpm)<.015)state.rpm=rpmTarget;
    for(let i=0;i<ledMaterials.length;i++){const active=i<Math.round(state.rpm/9*13),color=i>10?state.accent:i>7?0xf5c66a:0x6ee3b4;ledMaterials[i].color.set(active?color:0x1a272b);ledMaterials[i].emissive.set(color);ledMaterials[i].emissiveIntensity=active?1.25+pulse:0;}
    const quantized=Math.round(state.rpm*12);if(quantized!==displayedRPM){displayedRPM=quantized;paintDisplay();}
    return leftPress>0||rightPress>0||pulse>0||Math.abs(rpmTarget-state.rpm)>.01;
  }
  function settle(){leftPress=rightPress=pulse=0;state.rpm=rpmTarget;update(0);}
  function dispose(){geometrySet.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}
  paintDisplay();update(0);
  return {group,wheel,interactables,setSteering,shift,cycleMode,setFinish,setIdentity,update,settle,dispose,getState:()=>({...state}),paddlePivots};
}
