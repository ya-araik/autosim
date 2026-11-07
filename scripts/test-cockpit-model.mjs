import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.min.js';
import { createCockpitModel, cockpitScreenSize, COCKPIT_CONFIGS } from '../public/cockpit-model.js';

const model = createCockpitModel(THREE);
const parts = [];
model.group.traverse(object => { parts.push(object.name, ...(object.userData.parts || [])); });
for (const expected of ['Sculpted stitched racing seat', 'Extruded chassis, rails and feet', 'Three-pedal mechanical assembly',
  'Detailed club steering wheel concept', 'Freestanding monitor bridge', 'Return spring coil', 'Harness opening', 'Seat rail release grip']) {
  assert.ok(parts.includes(expected), 'Complete cockpit includes ' + expected);
}
const results = [];
for (const tariff of Object.keys(COCKPIT_CONFIGS)) {
  for (const vr of [false, true]) {
    model.setConfiguration(tariff, vr); model.settle(); model.group.updateMatrixWorld(true);
    const data = model.group.userData, dimensions = cockpitScreenSize(tariff);
    assert.equal(data.base, COCKPIT_CONFIGS[tariff].base);
    assert.ok(Math.abs(Math.hypot(dimensions.width, dimensions.height) / .0254 - COCKPIT_CONFIGS[tariff].diagonal) < 1e-10);
    assert.ok(Math.abs(dimensions.width / dimensions.height - COCKPIT_CONFIGS[tariff].aspect) < 1e-10);
    assert.equal(model.shifter.visible, tariff === 'vip'); assert.equal(model.vr.visible, vr);
    assert.equal(model.screenGroup.userData.curved, tariff === 'pro');
    let meshes = 0, triangles = 0;
    model.group.traverse(object => {
      if (!object.isMesh) return; meshes++;
      const geometry = object.geometry, positions = geometry.attributes.position;
      for (const value of positions.array) assert.ok(Number.isFinite(value), object.name + ': finite vertices');
      if (geometry.index) for (const index of geometry.index.array) assert.ok(index < positions.count, object.name + ': valid indices');
      triangles += (geometry.index?.count ?? positions.count) / 3 * (object.count ?? 1);
    });
    assert.ok(meshes < 115, 'Static detail is batched to a reasonable draw-call count');
    assert.ok(triangles < 70000, 'Detailed hardware remains within a mobile geometry budget');
    const activeDisplay = model.screenGroup.children.find(object => object.name.startsWith('Active'));
    assert.ok(activeDisplay && activeDisplay.material.isMeshBasicMaterial, 'Display is illuminated independent of studio lighting');
    if (tariff === 'pro') {
      const geometry = activeDisplay.geometry;
      assert.ok(geometry.attributes.normal.getZ(24) < -.9, 'Curved panel faces the seated driver');
      assert.equal(geometry.attributes.uv.getX(0), 1, 'Curved panel text reads left-to-right from the driver side');
      assert.ok(geometry.attributes.position.getZ(0) < -.08, '49-inch panel is physically curved');
    } else {
      const casing = model.screenGroup.children.find(object => object.name === 'Thin display casing');
      casing.geometry.computeBoundingBox();
      assert.ok(activeDisplay.position.z < casing.position.z + casing.geometry.boundingBox.min.z - .001,
        'Lit panel lies in front of the bevelled opaque monitor casing');
    }
    results.push({ tariff, vr, meshes, triangles, screenWidthMetres: Number(dimensions.width.toFixed(3)) });
  }
}
const bounds = new THREE.Box3().setFromObject(model.group), size = bounds.getSize(new THREE.Vector3());
assert.ok(size.z > 2.3 && size.z < 2.7 && size.y > 1.6 && size.y < 2, 'Human-scale footprint and display height');
assert.ok(bounds.min.y > -.02, 'Feet remain on the studio floor');
model.setConfiguration('__proto__', false); assert.equal(model.getState().tariff, 'standard');
assert.equal(cockpitScreenSize('__proto__').diagonal, 55);
model.setConfiguration('pro', true); assert.equal(model.update(.02), true, 'Tariff transition advances on demand');
for (let i = 0; i < 60; i++) model.update(1/60);
assert.equal(model.update(1/60), false, 'Transition becomes idle instead of requiring an endless render loop');
model.dispose();
console.log(JSON.stringify({ result: 'PASS', geometry: results, footprint: { x: size.x, y: size.y, z: size.z } }, null, 2));
