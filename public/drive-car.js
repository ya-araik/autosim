import { GLTFLoader } from './vendor/GLTFLoader.js';

/** Actual attributed GLB geometry. +Z forward; positive steering turns right (-Y).
 * Whega BMW M5 E60 geometry, CC BY 4.0; source is linked in asset attribution. */
export async function loadCar(THREE, options = {}) {
  const url = options.url || new URL('./assets/bmw-e60/bmw-m5-e60.glb?v=5', import.meta.url).href;
  const brand = typeof Image === 'undefined' ? null : new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image); image.onerror = () => resolve(null);
    image.src = new URL('./assets/autosim-brand.jpg', import.meta.url).href;
  });
  const [gltf, plateLogo] = await Promise.all([
    options.gltf || new GLTFLoader().loadAsync(url, options.onProgress), brand,
  ]);
  return prepareCar(THREE, gltf, {...options, plateLogo});
}
export const createCar = loadCar;

/** Separated from I/O to allow geometry and animation tests in Node. */
export function prepareCar(THREE, gltf, options = {}) {
  const clamp = THREE.MathUtils.clamp;
  const group = new THREE.Group();
  group.name = options.label || (gltf.asset?.extras?.generation === 'E60' ? 'BMW M5 E60' : 'BMW sedan');
  const sprung = new THREE.Group();
  sprung.name = 'Sprung body';
  group.add(sprung);
  const rotation = new THREE.Matrix4().makeRotationY(options.frontRotation || 0);
  // A substring such as "rim" in "trim" must never confer wheel ownership.
  const tokensFor = text => new Set(text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const has = (tokens, words) => words.some(word => tokens.has(word));
  function wheelRole(tokens) {
    if (has(tokens, ['steering', 'steer', 'spare', 'body', 'trim', 'grille', 'interior', 'arch', 'arches', 'caliper', 'brake'])) return null;
    if (has(tokens, ['tire', 'tires', 'tyre', 'tyres'])) return 'tire';
    if (has(tokens, ['wheel', 'wheels', 'rim', 'rims'])) return 'wheel';
    return null;
  }
  const originalMeshes = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    geometry.applyMatrix4(rotation);
    geometry.computeBoundingBox();
    const sourceMaterial = Array.isArray(object.material) ? object.material[0] : object.material;
    originalMeshes.push({ geometry, name: object.name, sourceMaterial,
      tag: `${object.name} ${sourceMaterial?.name || ''}`.toLowerCase(),
      tokens: tokensFor(`${object.name} ${sourceMaterial?.name || ''}`) });
  });
  if (!originalMeshes.length) throw new Error('Vehicle GLB contains no mesh geometry.');
  const bounds = new THREE.Box3();
  originalMeshes.forEach(part => bounds.union(part.geometry.boundingBox));
  const dimensions = bounds.getSize(new THREE.Vector3());
  if (Math.min(dimensions.x, dimensions.y, dimensions.z) <= 0) throw new Error('Vehicle GLB has invalid dimensions.');
  const center = bounds.getCenter(new THREE.Vector3());
  const bodyPart = originalMeshes.find(part => /vehicle_body|carpaint|body_paint|bodywork|exterior_body/.test(part.tag));
  const bodyWidth = bodyPart ? bodyPart.geometry.boundingBox.getSize(new THREE.Vector3()).x : dimensions.x;
  const length = options.targetLength || 4.855, height = options.targetHeight || 1.469, width = options.targetBodyWidth || 1.846;
  const scale = gltf.asset?.extras?.normalized ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(width / bodyWidth, height / dimensions.y, length / dimensions.z);
  const normalization = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: options.color ?? 0x030405, metalness: .48, roughness: .24,
      clearcoat: .8, clearcoatRoughness: .18, envMapIntensity: .65 }),
    wheel: new THREE.MeshStandardMaterial({ color: 0xb2b8c0, metalness: .95, roughness: .25, envMapIntensity: 1.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141519, metalness: .02, roughness: .91 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x222327, metalness: .05, roughness: .82, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: 0x727d88, metalness: 1, roughness: .32 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a1218, metalness: .30, roughness: .12, clearcoat: 1,
      transparent: false, opacity: 1, depthWrite: true, side: THREE.DoubleSide, envMapIntensity: 1.4 }),
    tail: new THREE.MeshPhysicalMaterial({ color: 0x9b0615, emissive: 0xff0310, emissiveIntensity: .24,
      roughness: .2, metalness: .1, clearcoat: 1, toneMapped: false }),
    head: new THREE.MeshPhysicalMaterial({ color: 0x101b25, metalness: .22, roughness: .19,
      clearcoat: 1, transparent: false, opacity: 1, depthWrite: true, side: THREE.DoubleSide }),
    grayTrim: new THREE.MeshStandardMaterial({ color: 0x323942, metalness: .47, roughness: .42 }),
    black: new THREE.MeshStandardMaterial({ color: 0x080b0f, metalness: .09, roughness: .64 }),
    indicator: new THREE.MeshPhysicalMaterial({ color: 0xc9c4b6, metalness: .12, roughness: .2, clearcoat: 1 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xd8dbe0, metalness: .08, roughness: .51 }),
    angel: new THREE.MeshBasicMaterial({ color: 0xf8ecd2, toneMapped: false }),
    projector: new THREE.MeshStandardMaterial({ color: 0x738797, metalness: .7, roughness: .1, emissive: 0xaccfff, emissiveIntensity: .24 }),
  };
  function materialFor(tag, tokens, original) {
    if (/vehicle_body|carpaint|body_paint|bodywork|exterior_body/.test(tag)) return materials.paint;
    const role = wheelRole(tokens);
    if (role === 'tire') return materials.rubber;
    if (role === 'wheel') return materials.wheel;
    if (tokens.has('rubber')) return materials.rubber;
    if (/interior|dashboard|seat|leather/.test(tag)) return materials.interior;
    if (/break_lights|brake_lights|taillights|tail_lights|rear_light/.test(tag)) return materials.tail;
    if (/headlights|head_lights|front_light/.test(tag)) return materials.head;
    if (/windows|window_glass|windscreen|windshield/.test(tag)) return materials.glass;
    if (/chrome|silver|sliver/.test(tag)) return materials.chrome;
    if (/indicator|signal/.test(tag)) return materials.indicator;
    if (/license|numberplate|number_plate/.test(tag)) return materials.plate;
    if (/grey_plastic|gray_plastic|trim_grey/.test(tag)) return materials.grayTrim;
    if (/grille|black_plastic|trim_black|carbon|black/.test(tag)) return materials.black;
    if (tokens.has('trim')) return materials.grayTrim;
    const material = original?.clone() || materials.paint;
    if (material.isMeshStandardMaterial) { material.roughness = clamp(material.roughness ?? .42, .16, .9); material.envMapIntensity = 1.2; }
    return material;
  }
  const wheelParts = [[], [], [], []], bodyMeshes = [], headMeshes = [];
  // Split complete triangles from combined tire/rim material meshes into four
  // spatial quadrants, preserving the original normals, UVs and wheel geometry.
  function separateWheels(geometry, regions = null) {
    const expanded = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = expanded.getAttribute('position'), buckets = [[], [], [], [], []];
    for (let i = 0; i < position.count; i += 3) {
      const x = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3;
      const z = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3;
      const quadrant = (x > 0 ? 1 : 0) + (z > 0 ? 2 : 0), region = regions?.[quadrant];
      // Every corner must fit the tyre-derived cylinder. A valid-looking name
      // cannot move a grille, brake caliper or distant body triangle into a wheel.
      const within = !regions || (region && [i, i + 1, i + 2].every(vertex =>
        Math.abs(position.getX(vertex) - region.center.x) <= region.halfWidth + .012 &&
        Math.hypot(position.getY(vertex) - region.center.y, position.getZ(vertex) - region.center.z) <= region.radius + .012));
      buckets[within ? quadrant : 4].push(i, i + 1, i + 2);
    }
    const separated = buckets.map(indices => {
      if (!indices.length) return null;
      const out = new THREE.BufferGeometry();
      for (const name of Object.keys(expanded.attributes)) {
        const attribute = expanded.getAttribute(name), size = attribute.itemSize;
        const values = new Float32Array(indices.length * size);
        indices.forEach((index, target) => { for (let k = 0; k < size; k++) values[target * size + k] = attribute.array[index * size + k]; });
        out.setAttribute(name, new THREE.BufferAttribute(values, size, attribute.normalized));
      }
      out.computeBoundingBox();
      return out;
    });
    if (expanded !== geometry) expanded.dispose();
    return separated;
  }
  function addMesh(geometry, material, name, parent) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = material !== materials.glass && material !== materials.head;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  for (const part of originalMeshes) {
    part.geometry.applyMatrix4(normalization);
    part.geometry.computeBoundingBox();
    part.wheelRole = wheelRole(part.tokens);
  }
  // The four genuine tyre meshes establish immutable, physically bounded wheel
  // regions before rims are admitted. Classification is both semantic and spatial.
  const tyreBounds = Array.from({length: 4}, () => new THREE.Box3());
  for (const part of originalMeshes.filter(part => part.wheelRole === 'tire')) {
    separateWheels(part.geometry).forEach((geometry, quadrant) => {
      if (!geometry) return;
      if (quadrant < 4) tyreBounds[quadrant].union(geometry.boundingBox);
      geometry.dispose();
    });
  }
  const wheelRegions = tyreBounds.map(box => {
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3()), extent = box.getSize(new THREE.Vector3());
    const radius = Math.max(extent.y, extent.z) / 2, halfWidth = extent.x / 2;
    if (radius < .20 || radius > .46 || halfWidth < .065 || halfWidth > .20 ||
        Math.abs(center.y - radius) > .10 || Math.abs(center.x) < .55 ||
        Math.abs(center.x) > 1.05 || Math.abs(center.z) < .8 || Math.abs(center.z) > 1.9) return null;
    return {center, radius, halfWidth};
  });
  if (wheelRegions.some(region => !region)) throw new Error('Vehicle GLB must provide four physically bounded tyre regions.');
  let rejectedWheelTriangles = 0;
  for (const part of originalMeshes) {
    const material = materialFor(part.tag, part.tokens, part.sourceMaterial);
    if (part.wheelRole) {
      separateWheels(part.geometry, wheelRegions).forEach((geometry, quadrant) => {
        if (!geometry) return;
        if (quadrant < 4) wheelParts[quadrant].push({ geometry, material, name: part.name });
        else {
          rejectedWheelTriangles += geometry.getAttribute('position').count / 3;
          bodyMeshes.push(addMesh(geometry, material, part.name + ' (stationary outside wheel regions)', sprung));
        }
      });
      part.geometry.dispose();
    } else {
      const object = addMesh(part.geometry, material, part.name, sprung);
      bodyMeshes.push(object);
      if (material === materials.head) headMeshes.push(object);
    }
  }
  group.userData.rejectedWheelTriangles = rejectedWheelTriangles;
  const wheels = [];
  wheelParts.forEach((parts, quadrant) => {
    if (!parts.length) return;
    const box = new THREE.Box3(), tires = parts.filter(part => part.material === materials.rubber);
    (tires.length ? tires : parts).forEach(part => box.union(part.geometry.boundingBox));
    const center = box.getCenter(new THREE.Vector3()), extent = box.getSize(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.name = `${quadrant > 1 ? 'front' : 'rear'} wheel steering pivot ${quadrant % 2 ? 'L' : 'R'}`;
    pivot.position.copy(center);
    group.add(pivot);
    const spin = new THREE.Group();
    spin.name = 'Original rim and tire rotation';
    pivot.add(spin);
    parts.forEach(part => { part.geometry.translate(-center.x, -center.y, -center.z); addMesh(part.geometry, part.material, part.name, spin); });
    wheels.push({ pivot, spin, radius: Math.max(extent.y, extent.z) / 2,
      halfWidth: wheelRegions[quadrant].halfWidth, cylinderTolerance: .012,
      front: quadrant > 1, side: quadrant % 2 ? 1 : -1 });
  });
  if (wheels.length !== 4) console.warn(`Vehicle model provides ${wheels.length} separately classified wheels; inspect GLB part names.`);

  // Original lens surfaces determine corona-ring positions and orientations.
  const eyeMeshes = [];
  group.updateMatrixWorld(true);
  if (headMeshes.length && options.coronaRings !== false) {
    const headBounds = new THREE.Box3();
    headMeshes.forEach(mesh => headBounds.union(new THREE.Box3().setFromObject(mesh, true)));
    const headCenter = headBounds.getCenter(new THREE.Vector3()), maxX = headBounds.max.x;
    for (const side of [-1, 1]) for (const factor of [.57, .84]) {
      const from = new THREE.Vector3(side * maxX * factor, headCenter.y, 4);
      const hit = new THREE.Raycaster(from, new THREE.Vector3(0, 0, -1)).intersectObjects(headMeshes)[0];
      if (!hit) continue;
      const normal = hit.face.normal.clone();
      if (normal.z < 0) normal.negate();
      const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      const position = hit.point.clone().addScaledVector(normal, .004);
      const eye = addMesh(new THREE.TorusGeometry(.060, .006, 5, 32), materials.angel, 'Corona light ring', sprung);
      eye.position.copy(position); eye.quaternion.copy(rotation); eye.castShadow = false; eyeMeshes.push(eye);
      const projector = addMesh(new THREE.SphereGeometry(.031, 16, 8), materials.projector, 'Projector lens', sprung);
      projector.position.copy(position).addScaledVector(normal, .013);
      projector.scale.z = .3; projector.quaternion.copy(rotation); projector.castShadow = false;
    }
  }

  // Small finishing pieces sit on the scanned shell, located by surface hits.
  // No cabin is claimed: the source is a closed printable exterior model.
  const shell = bodyMeshes.filter(mesh => mesh.material === materials.paint);
  const locate = (from, direction) => new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...direction)).intersectObjects(shell)[0];
  const badgeBlue = new THREE.MeshStandardMaterial({ color: 0x1f79b8, roughness: .25, metalness: .3 });
  const badgeWhite = new THREE.MeshStandardMaterial({ color: 0xf0f2f4, roughness: .26, metalness: .25 });
  for (const hit of [locate([0, 2.4, 2.27], [0, -1, 0]), locate([0, .985, -4], [0, 0, 1])]) {
    if (!hit) continue;
    const badge = new THREE.Group();
    badge.name = 'Blue and white roundel';
    badge.position.copy(hit.point).addScaledVector(hit.face.normal, .004);
    badge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.face.normal);
    sprung.add(badge);
    addMesh(new THREE.CircleGeometry(.037, 32), materials.black, 'Roundel backing', badge);
    for (let quarter = 0; quarter < 4; quarter++) {
      const inset = addMesh(new THREE.CircleGeometry(.026, 12, quarter * Math.PI / 2, Math.PI / 2), quarter % 2 ? badgeWhite : badgeBlue, 'Roundel quadrant', badge);
      inset.position.z = .001;
    }
    addMesh(new THREE.TorusGeometry(.035, .0015, 5, 32), materials.chrome, 'Roundel rim', badge);
  }
  const plateHit = locate([0, .805, -4], [0, 0, 1]);
  if (plateHit) {
    const plateMaterial = new THREE.MeshStandardMaterial({ color: 0x11151b, roughness: .58, metalness: .12 });
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
      const context = canvas.getContext('2d');
      context.fillStyle = '#15191c'; context.fillRect(0, 0, 1024, 256);
      context.strokeStyle = '#5b6063'; context.lineWidth = 3; context.strokeRect(10, 10, 1004, 236);
      if (options.plateLogo) context.drawImage(options.plateLogo, 65, 53, 150, 150);
      context.fillStyle = '#f1f0e9'; context.font = '700 124px Manrope, Arial, sans-serif';
      context.textAlign = 'left'; context.textBaseline = 'alphabetic';
      context.fillText('автосим', 247, 169, 642);
      const dotX = Math.min(247 + context.measureText('автосим').width + 10, 907);
      context.fillStyle = '#f45b32'; context.fillRect(dotX, 150, 20, 20);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      plateMaterial.color.set(0xffffff); plateMaterial.map = texture;
    }
    const plate = new THREE.Group(); plate.name = 'AUTOSIM rear plate'; sprung.add(plate);
    // A shortest-arc +Z -> -Z rotation has an ambiguous roll and turned the
    // lettering upside down. Build an upright basis from the car's vertical.
    // The central recess is symmetric; ignore one triangle's lateral normal.
    const normal = new THREE.Vector3(0, plateHit.face.normal.y, -Math.abs(plateHit.face.normal.z)).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), normal).normalize();
    const up = new THREE.Vector3().crossVectors(normal, right).normalize();
    plate.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));
    plate.position.copy(plateHit.point).addScaledVector(normal, .009); plate.position.x = 0;
    const frame = addMesh(new THREE.BoxGeometry(.452, .123, .008), materials.black, 'Plate mounting frame', plate);
    frame.castShadow = false;
    const face = addMesh(new THREE.PlaneGeometry(.435, .108), plateMaterial, 'AUTOSIM plate face', plate);
    face.position.z = .0045; face.castShadow = false;
    for (const x of [-.198, .198]) {
      const screw = addMesh(new THREE.CircleGeometry(.0022, 12), materials.chrome, 'Plate fastener', plate);
      screw.position.set(x, 0, .005); screw.castShadow = false;
    }
    // Matching front plate, physically mounted on the bumper rather than a decal
    // over the radiator grille. Keep the same upright typography and fasteners.
    const frontHit = locate([0, .50, 4], [0, 0, -1]);
    if (frontHit) {
      const front = plate.clone(true);front.name = 'AUTOSIM front plate';
      const outward = new THREE.Vector3(0, frontHit.face.normal.y, Math.abs(frontHit.face.normal.z)).normalize();
      const across = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),outward).normalize();
      const vertical = new THREE.Vector3().crossVectors(outward,across).normalize();
      front.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,vertical,outward));
      front.position.copy(frontHit.point).addScaledVector(outward,.016);front.position.x=0;
      front.scale.setScalar(1.12);sprung.add(front);
    }
  }

  const engineering = new THREE.Group();
  engineering.name = 'Wheel contacts and chassis axes'; engineering.visible = false; group.add(engineering);
  const contactMaterial = new THREE.MeshBasicMaterial({ color: 0x78e4e8, transparent: true, opacity: .70, side: THREE.DoubleSide, depthWrite: false });
  const vectorMaterial = new THREE.LineBasicMaterial({ color: 0xff824b, transparent: true, opacity: .85 });
  wheels.forEach(wheel => {
    const contact = new THREE.Mesh(new THREE.RingGeometry(.18, .21, 24), contactMaterial);
    contact.rotation.x = -Math.PI / 2; contact.position.set(wheel.pivot.position.x, .009, wheel.pivot.position.z); engineering.add(contact);
    const points = [[0,.014,0],[0,.014,.70],[-.07,.014,.59],[0,.014,.70],[.07,.014,.59]].map(p => new THREE.Vector3(...p));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), vectorMaterial);
    line.position.set(wheel.pivot.position.x, 0, wheel.pivot.position.z); engineering.add(line);
    wheel.contact = contact; wheel.vector = line;
  });
  if (wheels.length === 4) for (const front of [false, true]) {
    const points = wheels.filter(wheel => wheel.front === front).map(wheel => wheel.pivot.position.clone());
    engineering.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), vectorMaterial));
  }
  let night = false, engineeringOn = false, currentBrake = 0;
  const transparentOriginal = new Map();
  function setNight(value) {
    night = Boolean(value);
    materials.angel.color.set(night ? 0xfff4db : 0xc5b896);
    materials.projector.emissiveIntensity = night ? 3.4 : .18;
    materials.tail.emissiveIntensity = (night ? 1.05 : .24) + currentBrake * 4.4;
  }
  function setEngineering(value) {
    engineeringOn = Boolean(value); engineering.visible = engineeringOn;
    for (const object of bodyMeshes) {
      if (object.material === materials.interior || object.material === materials.black) continue;
      const material = object.material;
      if (!transparentOriginal.has(material)) transparentOriginal.set(material, { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
      const original = transparentOriginal.get(material);
      material.transparent = engineeringOn || original.transparent;
      material.opacity = engineeringOn ? .16 : original.opacity;
      material.depthWrite = engineeringOn ? false : original.depthWrite; material.needsUpdate = true;
    }
  }
  function update(state = {}, input = {}, dt = 0, motion = null) {
    const speed = Number.isFinite(state.speed) ? state.speed : 0;
    const steering = clamp(Number(input.steering) || 0, -1, 1), brake = clamp(Number(input.brake) || 0, 0, 1);
    const step = clamp(Number(dt) || 0, 0, .05), smooth = 1 - Math.exp(-step * 5.5);
    const measuredLateral = Number(state.acceleration?.lateral);
    const measuredLongitudinal = Number(state.acceleration?.longitudinal ?? state.acceleration);
    const lateral = clamp(Number.isFinite(measuredLateral) ? measuredLateral : (Number(state.yawRate) || 0) * speed, -12, 12);
    const acceleration = clamp(Number.isFinite(measuredLongitudinal) ? measuredLongitudinal : 0, -10, 7);
    if (motion) {
      sprung.rotation.set(motion.bodyPitch, 0, motion.bodyRoll, 'YXZ');
      sprung.position.y = motion.heave;
    } else {
      sprung.rotation.z += (clamp(lateral * .0042, -.044, .044) - sprung.rotation.z) * smooth;
      sprung.rotation.x += (clamp(-acceleration * .0038, -.029, .040) - sprung.rotation.x) * smooth;
    }
    currentBrake = brake;
    materials.tail.emissiveIntensity = (night ? 1.05 : .24) + brake * 4.4;
    for (const [index, wheel] of wheels.entries()) {
      if (motion) {
        const contact = motion.contacts[index];
        // Tyres meet their own contact patch, not a single centreline height.
        wheel.pivot.position.y = contact.y - motion.height + wheel.radius;
        wheel.contact.position.y = contact.y - motion.height + .008;
        wheel.vector.position.y = contact.y - motion.height + .009;
      }
      const roadAngle = Number.isFinite(state.steeringAngle) ? state.steeringAngle : -steering * .48;
      const wheelbase = group.userData.wheelbase || 2.889;
      const track = group.userData.trackWidth || 1.58;
      const radius = Math.abs(roadAngle) > .0001 ? wheelbase / Math.tan(Math.abs(roadAngle)) : Infinity;
      const inner = wheel.side === Math.sign(roadAngle);
      const steerAngle = Math.sign(roadAngle) * Math.atan(wheelbase / Math.max(.8, radius + (inner ? -1 : 1) * track / 2));
      wheel.pivot.rotation.y = wheel.front ? steerAngle : 0;
      const rollingSpeed = Number.isFinite(state.vx) && Number.isFinite(state.vz)
        ? state.vx * Math.sin(state.heading) + state.vz * Math.cos(state.heading) : speed;
      const wheelSpeed = !wheel.front && Number.isFinite(state.wheelOmega) ? state.wheelOmega : rollingSpeed / Math.max(wheel.radius, .15);
      wheel.spin.rotation.x = (wheel.spin.rotation.x + wheelSpeed * step) % (Math.PI * 2);
      if (engineeringOn) {
        wheel.vector.rotation.y = wheel.front ? steerAngle : 0; wheel.vector.visible = Math.abs(speed) > .25;
        wheel.contact.scale.setScalar(1 + Math.abs(lateral) * .015 * (1 - wheel.side * Math.sign(lateral) * .4));
      }
    }
  }
  function dispose() {
    const geometries = new Set(), disposableMaterials = new Set();
    group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => disposableMaterials.add(material));
    });
    geometries.forEach(geometry => geometry.dispose());
    disposableMaterials.forEach(material => { material.map?.dispose(); material.dispose(); });
  }
  const frontAxle = wheels.filter(wheel => wheel.front), rearAxle = wheels.filter(wheel => !wheel.front);
  wheels.forEach(wheel => { wheel.restPosition = wheel.pivot.position.clone(); });
  group.userData.wheelbase = frontAxle.length && rearAxle.length ? frontAxle[0].pivot.position.z - rearAxle[0].pivot.position.z : 2.889;
  group.userData.trackWidth = frontAxle.length === 2 ? Math.abs(frontAxle[0].pivot.position.x - frontAxle[1].pivot.position.x) : 1.58;
  group.userData.source = gltf.asset?.extras || {};
  group.userData.wheelCount = wheels.length; group.userData.coronaRingCount = eyeMeshes.length;
  group.userData.generationVerified = gltf.asset?.extras?.generation === 'E60';
  return { group, update, setNight, setEngineering, dispose, wheels, sprung };
}
