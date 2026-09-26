// node --loader ./tests/three-loader.mjs tests/citytowers.mjs
// More of the city's towers (3d/citytowers.js): detailed near, blocks far.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../3d/vendor/three.module.js';
import {GLTFLoader} from '../3d/vendor/loaders/GLTFLoader.js';
import {createCityTowers} from '../3d/citytowers.js';
import {DETAIL} from '../3d/riverfront.js';
import {RIVERFRONT_OUTLINES} from '../3d/riverfront-lines.js';
import {CITY_TOWER_OUTLINES} from '../3d/citytowers-lines.js';
const project = (lon, lat) => [(lon - 106.65) * 111320 * Math.cos(10.81 * Math.PI / 180), -(lat - 10.81) * 111320];
// None is modelled twice.
const ids = new Set(Object.values(RIVERFRONT_OUTLINES).map(o => o.osm));
for (const [k, o] of Object.entries(CITY_TOWER_OUTLINES)) assert(!ids.has(o.osm), `${k} is already a riverfront tower`);
const scene = new THREE.Scene(), r = createCityTowers({scene, project});
assert.equal(r.buildings.length, Object.keys(CITY_TOWER_OUTLINES).length);
assert.equal(r.state.triangles, 0, 'nothing detailed at start');
let total = 0, most = 0;
const report = [];
for (const b of r.buildings) {
  r.update({getWorldPosition: v => v.copy(b.center)}, 0);
  assert(b.detail, `${b.spec.key} built near`);
  assert(b.triangles > 40000 && b.triangles < 125000, `${b.spec.key}: ${b.triangles}`);
  b.detail.traverse(o => { if (o.isMesh) assert(o.geometry.attributes.position.array.every(Number.isFinite), o.name); });
  const box = new THREE.Box3().setFromObject(b.detail);
  assert(Math.abs(box.max.y - b.height) < 1.5, `${b.spec.key}: top ${box.max.y} vs ${b.height}`);
  total += b.triangles; most = Math.max(most, b.triangles); report.push(`${b.spec.key} ${Math.round(b.triangles / 1000)}k`);
}
const far = {getWorldPosition: v => v.set(1e5, 100, 1e5)};
r.update(far, 1000); r.update(far, 1000 + DETAIL.keepMs + 1);
assert.equal(r.state.triangles, 0); assert(r.buildings.every(b => !b.detail));
// Replaces the generic towers in whichever tiles hold them.
const manifest = JSON.parse(fs.readFileSync(new URL('../3d/assets/manifest.json', import.meta.url)));
const tileIds = new Set(r.buildings.map(b => manifest.tiles.find(t => b.center.x >= t.bounds[0] && b.center.x <= t.bounds[2] && b.center.z >= t.bounds[1] && b.center.z <= t.bounds[3])?.id).filter(Boolean));
async function tile(id) { const b = fs.readFileSync(new URL(`../3d/assets/tiles/${id}.glb`, import.meta.url)); return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene; }
let removed = 0; for (const id of tileIds) removed += r.replaceGeneric(await tile(id));
assert(removed > 150, `removed ${removed}`);
r.dispose();
console.log(report.join(', '));
console.log(`ok - city towers: ${r.buildings.length} towers, ${Math.round(total / r.buildings.length / 1000)}k triangles each on average (largest ${Math.round(most / 1000)}k, ${(total / 1e6).toFixed(2)}M in all), detailed only near; ${removed} generic triangles replaced in ${tileIds.size} tiles`);
