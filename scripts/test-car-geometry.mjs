import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.min.js';
import {GLTFLoader} from '../public/vendor/GLTFLoader.js';
import {prepareCar} from '../public/drive-car.js';

const file = new URL('../public/assets/bmw-e60/bmw-m5-e60.glb', import.meta.url);
const bytes = fs.readFileSync(file);
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const inventory = [];
gltf.scene.traverse(mesh => {
  if (!mesh.isMesh) return;
  inventory.push({name: mesh.name, material: mesh.material.name, vertices: mesh.geometry.attributes.position.count, triangles: (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3});
});
assert.deepEqual(inventory.map(part => part.name), ['Vehicle_Body', 'Windows_Glass', 'Headlights', 'Tail_Lights', 'Black_Plastic_Trim', 'Chrome', 'Tires', 'Wheels']);
// This exact source name reproduced the bug: substring "rim" inside "Trim".
assert.ok(/wheels?|tires?|tyres?|rims?/.test('black_plastic_trim'));

function checkWheelCylinders(car) {
  assert.equal(car.wheels.length, 4);
  let vertices = 0, maximumRadius = 0;
  for (const wheel of car.wheels) {
    assert.ok(wheel.radius > .33 && wheel.radius < .36, 'radius comes from the real tyre, not body trim');
    assert.deepEqual(wheel.spin.children.map(mesh => mesh.name).sort(), ['Tires', 'Wheels']);
    assert.ok(wheel.halfWidth > .10 && wheel.halfWidth < .15);
    wheel.spin.traverse(mesh => {
      if (!mesh.isMesh) return;
      const position = mesh.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i), radius = Math.hypot(y, z);
        assert.ok([x, y, z].every(Number.isFinite));
        assert.ok(Math.abs(x) <= wheel.halfWidth + wheel.cylinderTolerance + 1e-6, 'every rotating vertex lies within tyre width');
        assert.ok(radius <= wheel.radius + wheel.cylinderTolerance + 1e-6, 'every rotating vertex lies within tyre radius');
        vertices++; maximumRadius = Math.max(maximumRadius, radius);
      }
    });
  }
  return {vertices, maximumRadius};
}

const car = prepareCar(THREE, gltf);
const plate = car.sprung.getObjectByName('AUTOSIM rear plate');
assert.ok(plate, 'Rear plate is fitted to the actual body surface');
const plateUp = new THREE.Vector3(0, 1, 0).applyQuaternion(plate.quaternion);
const plateOut = new THREE.Vector3(0, 0, 1).applyQuaternion(plate.quaternion);
const plateRight = new THREE.Vector3(1, 0, 0).applyQuaternion(plate.quaternion);
assert.ok(plateUp.y > .95, 'Rear lettering remains upright, not rolled 180 degrees');
assert.ok(plateOut.z < -.95 && plateRight.x < -.99, 'Plate faces the rear and reads left to right to a rear observer');
assert.ok(Math.abs(plateRight.y) < 1e-10 && plate.position.x === 0, 'Plate has no sideways tilt and is centred');
const trim = car.sprung.getObjectByName('Black_Plastic_Trim');
const frontPlate=car.sprung.getObjectByName('AUTOSIM front plate');
assert.ok(frontPlate&&frontPlate.position.z>2.4,'Front plate is on the bumper surface');
assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(frontPlate.quaternion).y>.99,'Front lettering upright');
assert.ok(new THREE.Vector3(0,0,1).applyQuaternion(frontPlate.quaternion).z>.99,'Front lettering faces forward');
assert.ok(new THREE.Vector3(1,0,0).applyQuaternion(frontPlate.quaternion).x>.99,'Front lettering reads left to right');
assert.ok(trim?.isMesh, 'grille/bumper trim remains on the sprung body');
assert.equal(trim.material.color.getHex(), 0x080b0f, 'trim keeps its black material instead of silver alloy');
assert.equal(trim.material.metalness, .09);
assert.equal(car.group.userData.rejectedWheelTriangles, 0, 'all original tyre/rim triangles are valid');
const cylinders = checkWheelCylinders(car);
const sourceNames = new Set(inventory.map(part => part.name));
let preservedTriangles = 0;
car.group.traverse(mesh => {if (mesh.isMesh && sourceNames.has(mesh.name)) preservedTriangles += (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3;});
assert.equal(preservedTriangles, inventory.reduce((sum, part) => sum + part.triangles, 0), 'classification preserves every source triangle');
const stationary = ['Vehicle_Body', 'Black_Plastic_Trim', 'Chrome', 'Windows_Glass', 'Headlights', 'Tail_Lights'].map(name => {
  const mesh = car.sprung.getObjectByName(name);
  assert.ok(mesh?.isMesh && mesh.parent === car.sprung, name + ' is not under a wheel pivot');
  return mesh;
});
car.group.updateMatrixWorld(true);
const originalMatrices = stationary.map(mesh => mesh.matrixWorld.clone());
const maximumAnimatedSize = new THREE.Vector3();
let poses = 0, turns = 0;
const dt = 1 / 60, stepAngle = Math.PI / 12;
for (const mode of ['day', 'night', 'engineering']) {
  car.setNight(mode === 'night'); car.setEngineering(mode === 'engineering');
  for (const angle of [-.48, 0, .48]) {
    const start = car.wheels.map(wheel => wheel.spin.rotation.x);
    const speed = car.wheels[0].radius * stepAngle / dt;
    for (let frame = 0; frame < 24; frame++) {
      car.update({speed, steeringAngle: angle, acceleration: {longitudinal: 0, lateral: 0}}, {steering: -Math.sign(angle), brake: 0}, dt);
      car.group.updateMatrixWorld(true);
      stationary.forEach((mesh, i) => assert.deepEqual(mesh.matrixWorld.elements, originalMatrices[i].elements, mesh.name + ' must not rotate with a wheel'));
      for (const wheel of car.wheels) {
        if (wheel.front) assert.equal(Math.sign(wheel.pivot.rotation.y), Math.sign(angle));
        else assert.equal(wheel.pivot.rotation.y, 0);
        const expected = (start[car.wheels.indexOf(wheel)] + speed / wheel.radius * dt * (frame + 1)) % (2 * Math.PI);
        const error = Math.atan2(Math.sin(wheel.spin.rotation.x - expected), Math.cos(wheel.spin.rotation.x - expected));
        assert.ok(Math.abs(error) < 1e-10, 'wheel animation completes a physically consistent revolution');
      }
      if (angle) {
        const front = car.wheels.filter(wheel => wheel.front), inner = front.find(wheel => wheel.side === Math.sign(angle)), outer = front.find(wheel => wheel.side !== Math.sign(angle));
        assert.ok(Math.abs(inner.pivot.rotation.y) > Math.abs(outer.pivot.rotation.y), 'Ackermann inner wheel turns farther');
      }
      const box = new THREE.Box3().setFromObject(car.group, true), size = box.getSize(new THREE.Vector3());
      maximumAnimatedSize.max(size);
      assert.ok(size.x < 2.25 && size.y < 1.50 && size.z < 4.90, 'animated body envelope must not grow silver fins');
      assert.ok(box.min.y > -.015 && box.max.y < 1.49, 'no tyre/trim flies above the roof or under the road');
      poses++;
    }
    turns++;
  }
}

// Naming is insufficient on its own: a distant triangle labelled "Wheels"
// must remain stationary, even when the rest of that mesh is a genuine rim.
const invalidScene = gltf.scene.clone(true);
const rim = invalidScene.getObjectByName('Wheels');
const expanded = rim.geometry.toNonIndexed(), injected = new THREE.BufferGeometry();
for (const [name, attribute] of Object.entries(expanded.attributes)) {
  const values = new Float32Array(attribute.array.length + 3 * attribute.itemSize);
  values.set(attribute.array);
  if (name === 'position') values.set([0, 2, 0, .1, 2, 0, 0, 2, .1], attribute.array.length);
  if (name === 'normal') values.set([0, 1, 0, 0, 1, 0, 0, 1, 0], attribute.array.length);
  injected.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
}
rim.geometry = injected;
const guarded = prepareCar(THREE, {...gltf, scene: invalidScene});
assert.equal(guarded.group.userData.rejectedWheelTriangles, 1);
const rejected = guarded.sprung.getObjectByName('Wheels (stationary outside wheel regions)');
assert.ok(rejected?.isMesh);
assert.equal(rejected.geometry.attributes.position.count, 3);
checkWheelCylinders(guarded);
guarded.group.updateMatrixWorld(true);
const rejectedMatrix = rejected.matrixWorld.clone();
guarded.update({speed: 20, steeringAngle: -.48, acceleration: {longitudinal: 0, lateral: 0}}, {}, .05);
guarded.group.updateMatrixWorld(true);
assert.deepEqual(rejected.matrixWorld.elements, rejectedMatrix.elements);

// Camel-case and underscore trim labels must both be fail-closed, including a
// misleading wheel token in the material name of a known body-trim mesh.
const labelScene = gltf.scene.clone(true), labelledTrim = labelScene.getObjectByName('Black_Plastic_Trim');
labelledTrim.name = 'BlackPlasticTrim'; labelledTrim.material = labelledTrim.material.clone(); labelledTrim.material.name = 'Wheel_Trim';
const labelled = prepareCar(THREE, {...gltf, scene: labelScene});
assert.ok(labelled.sprung.getObjectByName('BlackPlasticTrim'));
checkWheelCylinders(labelled);

console.log(JSON.stringify({pass: true, sourceInventory: inventory, animatedPoses: poses, completeWheelRevolutions: turns,
  rotatingVertices: cylinders.vertices, maximumRotatingRadiusM: cylinders.maximumRadius,
  maximumAnimatedDimensionsM: maximumAnimatedSize.toArray(),
  checks: ['strict trim/wheel ownership', 'black trim material', 'every rotating vertex inside its wheel cylinder', 'full revolutions at left/straight/right steering in all lighting modes', 'stationary body and grille matrices', 'bounded animated envelope', 'Ackermann steering', 'reject falsely labelled out-of-cylinder triangles', 'camel-case and ambiguous trim labels']}, null, 2));
car.dispose(); guarded.dispose(); labelled.dispose(); expanded.dispose(); injected.dispose(); labelledTrim.material.dispose();
