import * as THREE from './vendor/three.module.min.js';
import {TRACK_HALF_WIDTH,TRACK_LENGTH,TRACK_BOUNDS,sampleTrack,getTrackProjection,getTerrainHeight,BARRIER_PATHS,FOREST_TREES,MARSHAL_HUT,TRACK_LANDMARKS,FINISH_T} from './track-data.js';
import {createCar} from './drive-car.js';
import {HDRLoader} from './vendor/HDRLoader.js';
import {sampleWheelSupport,createChassisMotion,createCameraMotion} from './drive-motion.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TRACK_STEPS=Math.ceil(TRACK_LENGTH/2);
/** All road strips share the same metre-based route and height as the physics. */
export function buildTrackRibbon(from,to,lift=0,{kerbs=false,dashed=false,terrain=false}={}){
  const positions=[],uvs=[],indices=[],colors=[];
  const white=new THREE.Color(0xbcbcaf),red=new THREE.Color(0x932d27);
  for(let i=0;i<TRACK_STEPS;i++){
    if(dashed&&i%8>2)continue;
    const a=sampleTrack(i/TRACK_STEPS),b=sampleTrack((i+1)/TRACK_STEPS),base=positions.length/3;
    for(const [p,offset] of [[a,from],[a,to],[b,from],[b,to]]){
      const x=p.x-p.tangent.z*offset,z=p.z+p.tangent.x*offset;
      positions.push(x,terrain?getTerrainHeight(x,z)+.014:p.y+lift,z);
      uvs.push(offset/3,p.t*TRACK_LENGTH/3);
    }
    // Driver-right is -X at heading zero; this order faces the sky.
    indices.push(base,base+1,base+2,base+1,base+3,base+2);
    if(kerbs){const col=Math.floor(i/2)%2?white:red;for(let j=0;j<4;j++)colors.push(col.r,col.g,col.b);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);
  if(kerbs)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();g.computeBoundingSphere();return g;
}
export function buildTerrainGeometry(){
  const padding=205,step=7,x0=TRACK_BOUNDS.minX-padding,z0=TRACK_BOUNDS.minZ-padding,nx=Math.ceil((TRACK_BOUNDS.maxX-x0+padding)/step),nz=Math.ceil((TRACK_BOUNDS.maxZ-z0+padding)/step);
  const positions=[],uvs=[],colors=[],indices=[],forestMix=[];
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
    const x=x0+ix*step,z=z0+iz*step,p=getTrackProjection(x,z);
    // Recess the coarse ground under the road; the exact shoulder ribbon seals it.
    const recess=1-clamp((p.distance-6)/5,0,1),y=getTerrainHeight(x,z,p)-recess;
    positions.push(x,y,z);uvs.push(x/3,z/3);forestMix.push(clamp((p.distance-18)/25,0,1));
    const light=.78+.12*Math.sin(x*.051+z*.039)+.08*Math.cos(z*.071);
    colors.push(light*.80,light*.90,light*.67);
  }
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){const a=iz*(nx+1)+ix,b=a+nx+1;indices.push(a,b,a+1,a+1,b,b+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setAttribute('forestMix',new THREE.Float32BufferAttribute(forestMix,1));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();return g;
}

export async function createDrivingScene(initialMount,{signal}={}){
  let mount=initialMount,night=false,engineering=false,destroyed=false,cameraReady=false,lastCamera='',lastStatsTime=-Infinity;
  const chassisMotion=createChassisMotion(),cameraMotion=createCameraMotion();
  const scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  const loadedTextures=[];
  let skyTexture,environment,pmrem,constructionLost=false;
  const constructionContextLost=event=>{event.preventDefault();constructionLost=true;};
  renderer.domElement.addEventListener('webglcontextlost',constructionContextLost);
  function checkReady(){if(signal?.aborted||destroyed)throw new Error('3D scene loading cancelled');if(constructionLost)throw new Error('WebGL context lost while loading');}
  function dispose(){
    destroyed=true;
    signal?.removeEventListener('abort',dispose);
    renderer.domElement.removeEventListener('webglcontextlost',constructionContextLost);
    const geometries=new Set(),materials=new Set();
    scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));o.shadow?.map?.dispose();});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());loadedTextures.forEach(t=>t.dispose());
    skyTexture?.dispose();environment?.dispose();pmrem?.dispose();renderer.dispose();renderer.domElement.remove();
  }
  signal?.addEventListener('abort',dispose,{once:true});
  try {
  checkReady();
  const mobile=window.matchMedia('(pointer: coarse), (max-width: 700px)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,mobile?1.5:2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.domElement.setAttribute('aria-hidden','true');renderer.domElement.style.display='block';mount.appendChild(renderer.domElement);
  const camera=new THREE.PerspectiveCamera(53,1,.08,700),haze=new THREE.Fog(0xa3b3af,120,580);scene.fog=haze;
  const hemi=new THREE.HemisphereLight(0xe2edeb,0x494d36,1.25);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xffefd5,2.25);sun.castShadow=true;sun.shadow.mapSize.set(mobile?1024:1536,mobile?1024:1536);sun.shadow.camera.left=-29;sun.shadow.camera.right=29;sun.shadow.camera.top=29;sun.shadow.camera.bottom=-29;sun.shadow.camera.near=1;sun.shadow.camera.far=125;sun.shadow.bias=-.00015;sun.shadow.normalBias=.035;scene.add(sun,sun.target);
  pmrem=new THREE.PMREMGenerator(renderer);
  try{skyTexture=await new HDRLoader().loadAsync('/assets/environment/kloppenheim-05-1k.hdr');skyTexture.mapping=THREE.EquirectangularReflectionMapping;environment=pmrem.fromEquirectangular(skyTexture);scene.environment=environment.texture;}catch{/* Daylight still works without the optional environment map. */}
  checkReady();
  scene.environmentIntensity=.58;scene.background=skyTexture||new THREE.Color(0xb8c6c5);scene.backgroundIntensity=.62;pmrem.dispose();
  pmrem=null;
  const textureLoader=new THREE.TextureLoader();
  async function texture(file,{color=false,repeat=true}={}){
    try{const t=await textureLoader.loadAsync('/assets/track/'+file);if(destroyed){t.dispose();return null;}if(color)t.colorSpace=THREE.SRGBColorSpace;if(repeat)t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(mobile?4:8,renderer.capabilities.getMaxAnisotropy());loadedTextures.push(t);return t;}
    catch(error){console.warn('Автосим: optional surface texture unavailable: '+file,error);return null;}
  }
  const [roadMap,roadNormal,roadRough,floorMap,barkMap,grassMap,grassNormal,mapleMap,oakMap,beechMap]=await Promise.all([
    texture('asphalt_02-diffuse.jpg',{color:true}),texture('asphalt_02-nor_gl.jpg'),texture('asphalt_02-rough.jpg'),texture('forest_leaves_02-diffuse.jpg',{color:true}),texture('bark_brown_02-diffuse.jpg',{color:true}),texture('grass-diffuse.jpg',{color:true}),texture('grass-normal.jpg'),texture('maple-tree.webp',{color:true,repeat:false}),texture('tree-01.webp',{color:true,repeat:false}),texture('tree-06.webp',{color:true,repeat:false})]);
  checkReady();
  const asphalt=new THREE.MeshStandardMaterial({map:roadMap,normalMap:roadNormal,normalScale:new THREE.Vector2(.42,.42),roughnessMap:roadRough,roughness:.93,metalness:0,color:0x9b9c98});
  const floor=new THREE.MeshStandardMaterial({map:grassMap,normalMap:grassNormal,normalScale:new THREE.Vector2(.38,.38),roughness:1,vertexColors:true});
  if(floorMap&&grassMap)floor.onBeforeCompile=shader=>{shader.uniforms.uForestMap={value:floorMap};shader.vertexShader='attribute float forestMix; varying float vForestMix;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvForestMix=forestMix;');shader.fragmentShader='uniform sampler2D uForestMap; varying float vForestMix;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,diffuse*texture2D(uForestMap,vMapUv).rgb,vForestMix);');};
  const ground=new THREE.Mesh(buildTerrainGeometry(),floor);ground.receiveShadow=true;scene.add(ground);
  const shoulderMat=new THREE.MeshStandardMaterial({map:grassMap,normalMap:grassNormal,normalScale:new THREE.Vector2(.3,.3),color:0x9ea98a,roughness:1});
  const kerbMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92,normalMap:roadNormal,normalScale:new THREE.Vector2(.12,.12)}),whitePaint=new THREE.MeshStandardMaterial({color:0xcfcfc2,roughness:.94});
  function ribbon(from,to,lift,material,options){const m=new THREE.Mesh(buildTrackRibbon(from,to,lift,options),material);m.receiveShadow=true;scene.add(m);return m;}
  ribbon(-TRACK_HALF_WIDTH,TRACK_HALF_WIDTH,.025,asphalt);
  ribbon(-14,-TRACK_HALF_WIDTH,-.035,shoulderMat,{terrain:true});ribbon(TRACK_HALF_WIDTH,14,-.035,shoulderMat,{terrain:true});
  ribbon(-5.35,-4.73,.052,kerbMat,{kerbs:true});ribbon(4.73,5.35,.052,kerbMat,{kerbs:true});
  ribbon(-4.53,-4.40,.032,whitePaint);ribbon(4.40,4.53,.032,whitePaint);
  const guide=ribbon(-.035,.035,.043,new THREE.MeshBasicMaterial({color:0x65cbbb,transparent:true,opacity:.24,depthWrite:false}),{dashed:true});guide.visible=false;
  const dummy=new THREE.Object3D(),steel=new THREE.MeshStandardMaterial({color:0x737d7b,metalness:.72,roughness:.52}),dark=new THREE.MeshStandardMaterial({color:0x29332e,roughness:.9});
  // Three pressed-steel W rails on both sides, following the exact collision path.
  const profile=new THREE.Shape();[[0,-.14],[-.04,-.105],[-.075,-.047],[-.018,0],[-.075,.047],[-.04,.105],[0,.14],[-.008,.14],[-.048,.105],[-.083,.047],[-.026,0],[-.083,-.047],[-.048,-.105],[-.008,-.14]].forEach(([x,y],i)=>i?profile.lineTo(x,y):profile.moveTo(x,y));profile.closePath();
  const railGeometry=new THREE.ExtrudeGeometry(profile,{depth:1,bevelEnabled:false,steps:1});railGeometry.translate(0,0,-.5);
  const railCount=BARRIER_PATHS.reduce((n,p)=>n+(p.points.length-1)*3,0),rails=new THREE.InstancedMesh(railGeometry,steel,railCount),posts=new THREE.InstancedMesh(new THREE.BoxGeometry(.13,1.05,.13),steel,BARRIER_PATHS.reduce((n,p)=>n+p.points.length,0));
  let railIndex=0,postIndex=0;
  for(const path of BARRIER_PATHS){
    for(let i=0;i<path.points.length;i++){
      const a=path.points[i],b=path.points[Math.min(i+1,path.points.length-1)],dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],distance=Math.hypot(dx,dz),heading=Math.atan2(dx,dz);
      if(i<path.points.length-1)for(const height of [.32,.63,.94]){dummy.position.set((a[0]+b[0])/2,(a[1]+b[1])/2+height,(a[2]+b[2])/2);dummy.rotation.set(-Math.atan2(dy,distance),heading,0,'YXZ');dummy.scale.set(1,1,Math.hypot(distance,dy)+.025);dummy.updateMatrix();rails.setMatrixAt(railIndex++,dummy.matrix);}
      dummy.position.set(a[0],a[1]+.52,a[2]);dummy.rotation.set(0,heading,0);dummy.scale.setScalar(1);dummy.updateMatrix();posts.setMatrixAt(postIndex++,dummy.matrix);
    }
  }
  for(const mesh of [rails,posts]){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.receiveShadow=true;mesh.castShadow=false;scene.add(mesh);}
  // Summer photographs carry their own diffuse lighting. Unlit alpha-tested
  // materials prevent back-facing impostors turning into black silhouettes.
  // Each species keeps the source photograph's true height/width ratio.
  const foliageMaterials=[];
  for(const [variant,map,aspect] of [[0,mapleMap,2507/4929],[1,oakMap,3310/3481],[2,beechMap,1128/1536]]){
    if(!map)continue;
    const trees=FOREST_TREES.filter((t,i)=>i%3===variant),positions=[],uvs=[],indices=[];
    for(let plane=0;plane<3;plane++){
      const a=plane*Math.PI/3,c=Math.cos(a)*.5,z=Math.sin(a)*.5,b=positions.length/3;
      positions.push(-c,0,-z,c,0,z,-c,1,-z,c,1,z);uvs.push(0,0,1,0,0,1,1,1);indices.push(b,b+1,b+2,b+1,b+3,b+2);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();
    const material=new THREE.MeshBasicMaterial({map,color:0xffffff,alphaTest:.36,alphaToCoverage:true,side:THREE.DoubleSide,toneMapped:false});foliageMaterials.push(material);
    const mesh=new THREE.InstancedMesh(g,material,trees.length);
    trees.forEach((t,i)=>{const height=t.height*(variant===1?.85:1),width=height*aspect;dummy.position.set(t.x,t.y-.10,t.z);dummy.rotation.set(0,t.rotation,0);dummy.scale.set(width,height,width);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);const brightness=.77+(i%9)*.026;mesh.setColorAt(i,new THREE.Color().setRGB(brightness*.96,brightness,brightness*.90));});
    mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=true;scene.add(mesh);
  }
  // A staggered lower canopy hides the bare trunks without touching the track.
  // The source's crown-only UV region gives shrubs real small-leaf silhouettes.
  const bushPositions=[],bushUVs=[],bushIndices=[];
  for(let side=0;side<2;side++){const a=side*Math.PI/2,c=Math.cos(a)*.5,z=Math.sin(a)*.5,b=bushPositions.length/3;bushPositions.push(-c,0,-z,c,0,z,-c,1,-z,c,1,z);bushUVs.push(0,.30,1,.30,0,.98,1,.98);bushIndices.push(b,b+1,b+2,b+1,b+3,b+2);}
  const bushGeometry=new THREE.BufferGeometry();bushGeometry.setAttribute('position',new THREE.Float32BufferAttribute(bushPositions,3));bushGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(bushUVs,2));bushGeometry.setIndex(bushIndices);bushGeometry.computeVertexNormals();
  const bushMaterial=new THREE.MeshBasicMaterial({map:oakMap,color:0xffffff,alphaTest:.36,alphaToCoverage:true,side:THREE.DoubleSide,toneMapped:false});foliageMaterials.push(bushMaterial);
  const bushes=new THREE.InstancedMesh(bushGeometry,bushMaterial,760);
  bushes.visible=Boolean(oakMap);
  for(let i=0;i<760;i++){const p=sampleTrack((i+.5)/760),side=i%2?1:-1,offset=side*(10.2+3.8*((i*17%43)/43)),x=p.x-p.tangent.z*offset,z=p.z+p.tangent.x*offset,height=1.3+(i*7%23)/23*1.8;dummy.position.set(x,getTerrainHeight(x,z)-.10,z);dummy.rotation.set(0,i*2.399,0);dummy.scale.set(height*1.35,height,height*1.35);dummy.updateMatrix();bushes.setMatrixAt(i,dummy.matrix);const v=.62+(i%5)*.035;bushes.setColorAt(i,new THREE.Color().setRGB(v*.91,v,v*.83));}
  bushes.instanceMatrix.needsUpdate=true;bushes.instanceColor.needsUpdate=true;bushes.computeBoundingSphere();bushes.castShadow=false;scene.add(bushes);
  const trunkTrees=FOREST_TREES.filter(t=>t.collidable),trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.16,.27,1,7),new THREE.MeshStandardMaterial({map:barkMap,color:0x77736a,roughness:1}),trunkTrees.length);
  trunkTrees.forEach((t,i)=>{dummy.position.set(t.x,t.y+t.height*.28,t.z);dummy.rotation.set(0,t.rotation,0);dummy.scale.set(1,t.height*.56,1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);});trunks.instanceMatrix.needsUpdate=true;trunks.computeBoundingSphere();trunks.castShadow=true;trunks.receiveShadow=true;scene.add(trunks);dummy.scale.setScalar(1);
  function box(parent,x,y,z,w,h,d,material){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function signTexture(text,width=768,height=128){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.fillStyle='#e8e6db';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#1c3027';ctx.lineWidth=12;ctx.strokeRect(7,7,width-14,height-14);ctx.fillStyle='#20352a';ctx.font='600 57px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,width/2,height/2);const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;loadedTextures.push(t);return t;}
  for(const landmark of TRACK_LANDMARKS){const p=sampleTrack(landmark.t),g=new THREE.Group();g.position.set(p.x-p.tangent.z*8.2,p.y,p.z+p.tangent.x*8.2);g.rotation.y=p.heading;scene.add(g);box(g,-1.4,1.3,0,.07,2.6,.07,steel);box(g,1.4,1.3,0,.07,2.6,.07,steel);const sign=new THREE.Mesh(new THREE.BoxGeometry(3.4,.6,.055),new THREE.MeshStandardMaterial({map:signTexture(landmark.name),roughness:.8}));sign.position.y=2.3;g.add(sign);}
  const hut=new THREE.Group();hut.position.set(MARSHAL_HUT.x,MARSHAL_HUT.y,MARSHAL_HUT.z);hut.rotation.y=MARSHAL_HUT.yaw;scene.add(hut);box(hut,0,1.25,0,3.4,2.5,2.7,new THREE.MeshStandardMaterial({color:0x66755d,roughness:.92}));box(hut,0,2.55,0,3.8,.2,3.1,dark);box(hut,0,1.65,1.365,2.4,.75,.04,new THREE.MeshStandardMaterial({color:0x243a3d,metalness:.35,roughness:.15}));
  // An authored, opaque finish gantry. Its line is the same plane as timing.
  const finishPoint=sampleTrack(FINISH_T),finish=new THREE.Group();
  finish.position.set(finishPoint.x,finishPoint.y,finishPoint.z);finish.rotation.set(-Math.atan(finishPoint.grade),finishPoint.heading,0,'YXZ');scene.add(finish);
  const finishDark=new THREE.MeshStandardMaterial({color:0x171e24,metalness:.55,roughness:.36});
  const finishAccent=new THREE.MeshStandardMaterial({color:0xfb572c,emissive:0xd42e0e,emissiveIntensity:.7,roughness:.42});
  for(const x of [-6.1,6.1]){box(finish,x,2.8,0,.48,5.6,.55,finishDark);box(finish,x,2.85,-.30,.08,4.8,.04,finishAccent);box(finish,x,.13,0,1,.26,1.2,finishDark);}
  box(finish,0,5.3,0,12.65,.8,.55,finishDark);
  const bannerCanvas=document.createElement('canvas');bannerCanvas.width=1536;bannerCanvas.height=128;
  const bc=bannerCanvas.getContext('2d');bc.fillStyle='#10171c';bc.fillRect(0,0,1536,128);bc.textAlign='center';bc.textBaseline='middle';bc.fillStyle='#f0eee5';bc.font='700 78px Manrope,Arial';bc.fillText('ФИНИШ',768,67);bc.font='600 37px Manrope,Arial';bc.fillStyle='#ff8059';bc.fillText('автосим.',300,68);bc.fillText('TIME ATTACK',1230,68);
  const bannerMap=new THREE.CanvasTexture(bannerCanvas);bannerMap.colorSpace=THREE.SRGBColorSpace;loadedTextures.push(bannerMap);
  const bannerMat=new THREE.MeshStandardMaterial({map:bannerMap,emissiveMap:bannerMap,emissive:0xffffff,emissiveIntensity:.5,roughness:.6});
  box(finish,0,5.3,0,11.9,.76,.57,bannerMat);
  for(let row=0;row<3;row++)for(let column=0;column<20;column++)box(finish,-4.465+column*.47,.052,(row-1)*.47,.47,.015,.47,(row+column)%2?finishDark:whitePaint);
  for(const x of [-5.8,5.8]){const lamp=new THREE.PointLight(0xc9e1ff,65,22,1.6);lamp.position.set(x,4.6,-1);finish.add(lamp);}
  const endPoint=sampleTrack(1),endSign=new THREE.Group();endSign.position.set(endPoint.x,endPoint.y,endPoint.z);endSign.rotation.y=endPoint.heading;scene.add(endSign);
  for(let i=0;i<14;i++)box(endSign,-6.5+i,.65,-.16,.9,.42,.08,i%2?finishAccent:whitePaint);
  const car=await createCar(THREE,{color:0x030405});scene.add(car.group);
  // Soft local occlusion anchors tyres and underbody even in the night lighting.
  // A single tiny texture and five quads; no screen-space pass on mobile GPUs.
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;
  const shadowContext=shadowCanvas.getContext('2d'),gradient=shadowContext.createRadialGradient(32,32,4,32,32,32);
  gradient.addColorStop(0,'rgba(0,0,0,.75)');gradient.addColorStop(.45,'rgba(0,0,0,.5)');gradient.addColorStop(1,'rgba(0,0,0,0)');
  shadowContext.fillStyle=gradient;shadowContext.fillRect(0,0,64,64);
  const contactTexture=new THREE.CanvasTexture(shadowCanvas);loadedTextures.push(contactTexture);
  const contactShadows=Array.from({length:5},(_,i)=>{
    const material=new THREE.MeshBasicMaterial({map:contactTexture,transparent:true,opacity:i?.65:.46,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(i?.45:2.35,i?.68:4.65),material);mesh.rotation.x=-Math.PI/2;scene.add(mesh);return mesh;
  });
  // Product photography uses local fill lights; ordinary driving keeps its light rig.
  const photoKey=new THREE.SpotLight(0xc8ddff,150,16,.7,.85,1.4),photoRim=new THREE.SpotLight(0xffaa76,90,13,.75,.9,1.4);
  photoKey.visible=photoRim.visible=false;scene.add(photoKey,photoKey.target,photoRim,photoRim.target);
  checkReady();
  // Light illuminates surfaces only: no translucent cone geometry or beam cards.
  // Limited energy and a wide penumbra prevent saturated triangular road patches.
  const headlights=[];
  for(const x of [-.73,.73]){const light=new THREE.SpotLight(0xdce8ed,22,38,.39,.88,1.6);light.position.set(x,.69,2.12);light.target.position.set(x,.08,25);light.visible=false;car.sprung.add(light,light.target);headlights.push(light);}
  const noseArrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(),5,0x66cbbd,.5,.2),velocityArrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(),5,0xe69b54,.5,.2);noseArrow.visible=velocityArrow.visible=false;scene.add(noseArrow,velocityArrow);
  // Every mark is an independent six-vertex quad. Buffer wrap never joins paths.
  const maxSegments=1400,markPositions=new Float32Array(maxSegments*18),markGeometry=new THREE.BufferGeometry();markGeometry.setAttribute('position',new THREE.BufferAttribute(markPositions,3).setUsage(THREE.DynamicDrawUsage));markGeometry.setDrawRange(0,0);
  const marks=new THREE.Mesh(markGeometry,new THREE.MeshBasicMaterial({color:0x090b09,transparent:true,opacity:.32,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));marks.frustumCulled=false;scene.add(marks);
  let markIndex=0,markCount=0,previousContacts=null,previousHeading=0;
  function clearTrails(){markPositions.fill(0);markGeometry.attributes.position.needsUpdate=true;markGeometry.setDrawRange(0,0);markCount=markIndex=0;previousContacts=null;cameraReady=false;chassisMotion.reset();cameraMotion.reset();}
  function addMark(a,b){const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);if(!Number.isFinite(length)||length<.025||length>1.9||Math.abs(b.y-a.y)>.7)return;const nx=-dz/length*.115,nz=dx/length*.115;const values=[a.x+nx,a.y,a.z+nz,a.x-nx,a.y,a.z-nz,b.x+nx,b.y,b.z+nz,b.x+nx,b.y,b.z+nz,a.x-nx,a.y,a.z-nz,b.x-nx,b.y,b.z-nz];if(!values.every(Number.isFinite))return;markPositions.set(values,markIndex*18);markIndex=(markIndex+1)%maxSegments;markCount=Math.min(maxSegments,markCount+1);}
  function updateEffects(state,input,enabled){const sliding=enabled&&state.speed>4&&(state.driftAmount>.16||(input.brake>.72&&state.speed>11));if(!sliding){previousContacts=null;return;}const s=Math.sin(state.heading),c=Math.cos(state.heading),contacts=[-.79,.79].map(side=>{const x=state.x+c*side-s*1.42,z=state.z-s*side-c*1.42,p=getTrackProjection(x,z);return {x,z,y:p.distance<TRACK_HALF_WIDTH?p.y+.045:getTerrainHeight(x,z,p)+.035};});const headingChange=Math.abs(Math.atan2(Math.sin(state.heading-previousHeading),Math.cos(state.heading-previousHeading)));if(previousContacts&&headingChange<.3)contacts.forEach((p,i)=>addMark(previousContacts[i],p));previousContacts=contacts;previousHeading=state.heading;markGeometry.attributes.position.needsUpdate=true;markGeometry.setDrawRange(0,markCount*6);}
  function setNight(value){night=Boolean(value);scene.background=night?new THREE.Color(0x09131b):skyTexture||new THREE.Color(0xb8c6c5);haze.color.set(night?0x09131b:0xa3b3af);hemi.color.set(night?0x91a9bc:0xe2edeb);hemi.groundColor.set(night?0x1c241b:0x494d36);hemi.intensity=night?.58:1.25;sun.color.set(night?0xb4c8df:0xffefd5);sun.intensity=night?.72:2.25;scene.environmentIntensity=night?.27:.58;renderer.toneMappingExposure=night?1.05:.92;headlights.forEach(l=>l.visible=night);foliageMaterials.forEach(m=>m.color.set(night?0x354954:0xffffff));car.setNight(night);}
  function setEngineering(value){engineering=Boolean(value);car.setEngineering(engineering);noseArrow.visible=velocityArrow.visible=guide.visible=engineering;}
  const desiredCamera=new THREE.Vector3(),desiredTarget=new THREE.Vector3();
  const groundRotation=new THREE.Euler(0,0,0,'YXZ'),flatShadow=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
  function resize(){if(destroyed||mount.clientWidth<2||mount.clientHeight<2)return false;const width=mount.clientWidth,height=mount.clientHeight;camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height,false);cameraReady=false;return true;}
  function setMount(next){if(next!==mount){mount=next;mount.appendChild(renderer.domElement);}cameraReady=false;resize();}
  function render(state,input={},dt=0,options={}){
    if(destroyed||mount.clientWidth<2||mount.clientHeight<2||![state.x,state.z,state.heading].every(Number.isFinite))return false;const started=performance.now();dt=clamp(dt,0,.05);
    if(renderer.getContext().isContextLost()){const error=new Error('WebGL context is unavailable');error.code='WEBGL_CONTEXT_LOST';throw error;}
    const support=sampleWheelSupport(state,car.wheels),motion=chassisMotion.update(state,support,dt);
    const y=support.height,s=Math.sin(state.heading),c=Math.cos(state.heading),rightX=-c,rightZ=s;
    const roadSlope=-Math.tan(support.pitch);
    car.group.position.set(state.x,y,state.z);car.group.rotation.set(0,state.heading,0,'YXZ');car.update(state,{steering:state.steering??input.steering??0,throttle:input.throttle||0,brake:input.brake||0},dt,motion);
    contactShadows.forEach((mesh,i)=>{
      const patch=i?support.contacts[i-1]:{x:state.x,y:y-.000032,z:state.z};
      mesh.position.set(patch.x,patch.y+.007,patch.z);mesh.quaternion.setFromEuler(groundRotation.set(support.pitch,state.heading,support.roll)).multiply(flatShadow);
    });
    headlights.forEach(l=>l.visible=night);updateEffects(state,input,options.simulateEffects!==false&&!options.preview&&dt>0);
    sun.position.set(state.x-30,y+48,state.z+26);sun.target.position.set(state.x,y,state.z);
    if(engineering){noseArrow.position.set(state.x,y+.30,state.z);noseArrow.setDirection(new THREE.Vector3(s,0,c));const v=state.speed>.3?new THREE.Vector3(state.vx,0,state.vz).normalize():new THREE.Vector3(s,0,c);velocityArrow.position.set(state.x,y+.32,state.z);velocityArrow.setDirection(v);velocityArrow.setLength(3+Math.min(7,state.speed*.22),.5,.2);}
    const mode=options.preview?'preview':options.camera||'hood',mobile=mount.clientWidth<560;if(mode!==lastCamera){lastCamera=mode;cameraReady=false;}
    if(!cameraReady)cameraMotion.reset();
    const inertial=options.cameraMotion!==false,view=cameraMotion.update(state,dt,mode,inertial);
    photoKey.visible=photoRim.visible=mode==='poster';
    if(mode==='poster'){photoKey.position.set(state.x+rightX*2+s*4,y+6,state.z+rightZ*2+c*4);photoRim.position.set(state.x-rightX*4-s*2,y+4,state.z-rightZ*4-c*2);photoKey.target.position.set(state.x,y+.8,state.z);photoRim.target.position.copy(photoKey.target.position);desiredCamera.set(state.x+rightX*4.6+s*5.5,y+1.85,state.z+rightZ*4.6+c*5.5);desiredTarget.set(state.x+s*.1,y+.76,state.z+c*.1);camera.fov=34;}
    else if(mode==='preview'||mode==='showroom'){const side=mobile?6:4.8,front=mobile?7.3:6.2;desiredCamera.set(state.x+rightX*side+s*front,y+(mobile?2.65:2.4),state.z+rightZ*side+c*front);desiredTarget.set(state.x+rightX*(mobile?0:2.3),y+(mobile?(mode==='showroom'?-.65:2.25):.87),state.z+rightZ*(mobile?0:2.3));camera.fov=mobile?45:41;}
    else if(mode==='top'){desiredCamera.set(state.x,y+35,state.z-8);desiredTarget.set(state.x,y,state.z);camera.fov=52;}
    else if(mode==='hood'){
      const bodyPitch=inertial?motion.bodyPitch:support.pitch,bodyRoll=inertial?motion.bodyRoll:support.roll;
      const forward=1.08+view.longitudinal,side=.18+view.lateral,height=1.19+(inertial?motion.heave:0);
      desiredCamera.set(state.x+s*forward+c*side,y+height-Math.sin(bodyPitch)*forward+Math.sin(bodyRoll)*side,state.z+c*forward-s*side);
      // Eyes follow the road while a small, damped portion of body motion remains.
      const lookPitch=support.pitch+(bodyPitch-support.pitch)*.38;
      desiredTarget.set(desiredCamera.x+s*55,desiredCamera.y-Math.tan(lookPitch)*55,desiredCamera.z+c*55);camera.fov=(mobile?65:61)+view.fov;
    }
    else{
      const cs=Math.sin(view.heading),cc=Math.cos(view.heading),distance=8.1-view.longitudinal*6;
      desiredCamera.set(state.x-cs*distance+c*view.lateral*3,y+2.95-roadSlope*5+(inertial?motion.heave*.4:0),state.z-cc*distance-s*view.lateral*3);
      desiredTarget.set(state.x+s*2.6,y+.93,state.z+c*2.6);camera.fov=(mobile?57:49)+view.fov;
    }
    const cameraGround=getTerrainHeight(desiredCamera.x,desiredCamera.z);desiredCamera.y=Math.max(desiredCamera.y,cameraGround+.5);camera.updateProjectionMatrix();camera.position.copy(desiredCamera);
    const headRoll=mode==='hood'&&inertial?clamp((motion.bodyRoll-support.roll)*.18,-.009,.009):0;
    camera.up.set(-c*Math.sin(headRoll),Math.cos(headRoll),s*Math.sin(headRoll));camera.lookAt(desiredTarget);cameraReady=true;renderer.render(scene,camera);
    const finished=performance.now();if(finished-lastStatsTime>=1000){renderer.domElement.dataset.drawCalls=String(renderer.info.render.calls);renderer.domElement.dataset.triangles=String(renderer.info.render.triangles);renderer.domElement.dataset.frameMs=(finished-started).toFixed(2);renderer.domElement.dataset.track='brunnchen-pflanzgarten';lastStatsTime=finished;}
    return true;
  }
  setNight(false);resize();renderer.domElement.removeEventListener('webglcontextlost',constructionContextLost);
  return {canvas:renderer.domElement,setMount,resize,setNight,setEngineering,clearTrails,render,dispose};
  }catch(error){dispose();throw error;}
}
