// node --loader ./tests/three-loader.mjs tests/riverfront.mjs
// The towers along the river tour (3d/riverfront.js): detailed near, blocks far.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../3d/vendor/three.module.js';
import {GLTFLoader} from '../3d/vendor/loaders/GLTFLoader.js';
import {createRiverfront, DETAIL} from '../3d/riverfront.js';
const project = (lon, lat) => [(lon - 106.65) * 111320 * Math.cos(10.81 * Math.PI / 180), -(lat - 10.81) * 111320];
const scene = new THREE.Scene(), r = createRiverfront({scene, project});
assert(r.buildings.length >= 25);
assert.equal(r.state.triangles, 0, 'nothing detailed at start');
// Each detailed model is ~100k triangles or less, finite, and as tall as OSM says.
let total = 0;
for (const b of r.buildings) {
  r.update({getWorldPosition: v => v.copy(b.center)}, 0);
  assert(b.detail, `${b.spec.key} built near`);
  assert(b.triangles > 15000 && b.triangles < 120000, `${b.spec.key}: ${b.triangles}`);
  b.detail.traverse(o => { if (o.isMesh) assert(o.geometry.attributes.position.array.every(Number.isFinite), o.name); });
  const top = new THREE.Box3().setFromObject(b.detail).max.y;
  assert(Math.abs(top - b.height) < 1.5, `${b.spec.key}: top ${top} vs ${b.height}`);
  total += b.triangles;
}
// Far away: all released after the keep time, the blocks back.
const far = {getWorldPosition: v => v.set(1e5, 100, 1e5)};
r.update(far, 1000); r.update(far, 1000 + DETAIL.keepMs + 1);
assert.equal(r.state.triangles, 0); assert(r.buildings.every(b => !b.detail && b.far.visible));
// Replaces the generic towers in their tiles.
async function tile(id) { const b = fs.readFileSync(new URL(`../3d/assets/tiles/${id}.glb`, import.meta.url)); return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene; }
let removed = 0; for (const id of ['2_1', '3_1', '3_0', '2_2']) removed += r.replaceGeneric(await tile(id));
assert(removed > 150, `removed ${removed}`);
r.dispose();
console.log(`ok - riverfront: ${r.buildings.length} towers, ${Math.round(total / r.buildings.length / 1000)}k triangles each on average (${(total / 1e6).toFixed(2)}M in all), detailed only near; ${removed} generic triangles replaced`);
