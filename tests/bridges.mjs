// node --loader ./tests/three-loader.mjs tests/bridges.mjs
// The landmark bridges (3d/bridges.js): published heights and clearances,
// decks meeting the generic ramps, and the generic ribbons replaced alongside.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../3d/vendor/three.module.js';
import {GLTFLoader} from '../3d/vendor/loaders/GLTFLoader.js';
import {createBridges} from '../3d/bridges.js';
const project = (lon, lat) => [(lon - 106.65) * 111320 * Math.cos(10.81 * Math.PI / 180), -(lat - 10.81) * 111320];
const scene = new THREE.Scene(), h = createBridges({scene, project});
assert.equal(h.group.parent, scene);
assert(h.state.triangles < 150000, `${h.state.triangles} triangles`);
h.group.traverse(o => { if (o.isMesh) { assert(!/^(building|bridge_|major|street|path)/.test(o.name)); for (const a of Object.values(o.geometry.attributes)) assert(a.array.every(Number.isFinite)); } });

// Heights: the highest point near each bridge's pylon or arch.
const positions = []; h.group.traverse(o => { if (o.isMesh) { const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) positions.push([p.getX(i), p.getY(i), p.getZ(i)]); } });
const highest = (b, s0, s1) => { let top = -Infinity; for (let s = s0; s <= s1; s += 2) { const f = b.line.at(s); for (const [x, y, z] of positions) if (Math.hypot(x - f.x, z - f.z) < 25) top = Math.max(top, y); } return top; };
const {baSon, phuMy, binhLoiRail, thuThiem, mong, saiGon, saiGon2, khanhHoi, ongLanh, calmette, nguyenVanCu} = h.bridges;
assert(Math.abs(highest(baSon, 770, 820) - 113) < 3, 'Ba Son pylon 113 m');
assert(Math.abs(highest(phuMy, 1000, 1030) - 145) < 2.5, 'Phú Mỹ pylon 145 m');
// Clearance: a ray up from the water hits the deck's underside -- Phú Mỹ
// 45 m across its main span, the Bình Lợi railway bridge 7 m under the arch.
// And the road decks' tops at their ends meet the generic approach ramps
// (a layer-1 bridge, 6.3 m).
const meshes = []; h.group.traverse(o => { if (o.isMesh) meshes.push(o); });
const ray = new THREE.Raycaster();
const hitY = (b, s, from, dir) => { const f = b.line.at(s); ray.set(new THREE.Vector3(f.x, from, f.z), new THREE.Vector3(0, dir, 0)); const hit = ray.intersectObjects(meshes, false)[0]; return hit ? hit.point.y : NaN; };
const water = -0.12, WATER_Y = () => water;
for (let s = 1030; s <= 1380; s += 25) assert(hitY(phuMy, s, water, 1) - water >= 45, `Phú Mỹ clearance at ${s}: ${hitY(phuMy, s, water, 1)}`);
assert(hitY(binhLoiRail, 611, water, 1) - water >= 7 - 0.3, 'Bình Lợi rail clearance');
for (const b of [baSon, phuMy, thuThiem, khanhHoi, ongLanh, calmette, nguyenVanCu]) for (const s of [1, b.line.length - 1]) assert(Math.abs(hitY(b, s, 30, -1) - 6.3) < 0.5, `${b.name} end at ${s}: ${hitY(b, s, 30, -1)}`);
// The Sài Gòn bridges meet their layer-2 ramps at 12.3 m (Sài Gòn 1's west end is on layer 1).
for (const [b, s, y] of [[saiGon, 1, 12.3], [saiGon, saiGon.line.length - 1, 6.3], [saiGon2, 1, 12.3], [saiGon2, saiGon2.line.length - 1, 12.3]]) assert(Math.abs(hitY(b, s, 40, -1) - y) < 0.5, `${b.name} end at ${s}: ${hitY(b, s, 40, -1)}`);
// Chữ Y's branches come down to 6.3 m ramps; Tân Thuận 1 and 2 stay level with their 12.3 m ramps.
const {chuYNorth, chuYSouth, chuYWest, tanThuan1, tanThuan2} = h.bridges;
for (const b of [chuYNorth, chuYSouth, chuYWest]) assert(Math.abs(hitY(b, b.line.length - 1, 30, -1) - 6.3) < 0.5, `${b.name} end`);
for (const b of [tanThuan1, tanThuan2]) for (const s of [1, b.line.length - 1]) assert(Math.abs(hitY(b, s, 30, -1) - 12.3) < 0.5, `${b.name} end at ${s}`);
assert(hitY(chuYNorth, 40, WATER_Y(), 1) - WATER_Y() >= 6.3 - 0.3, 'Chữ Y clearance');
// Every bridge clears its water.
for (const b of Object.values(h.bridges)) { const f = b.line.length / 2; assert(hitY(b, f, 200, -1) > 5, `${b.name} deck over the middle`); }

// Replacement: the generic ribbons alongside go, nothing else, idempotent.
async function tile(id) { const b = fs.readFileSync(new URL(`../3d/assets/tiles/${id}.glb`, import.meta.url)); return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene; }
const counts = t => { const c = {}; t.traverse(o => { if (o.isMesh) { const k = o.name.split('__')[0]; c[k] = (c[k] || 0) + o.geometry.attributes.position.count / 3; } }); return c; };
for (const id of ['3_1', '4_4', '2_2', '3_0', '3_2', '1_3', '3_3']) {
  const t = await tile(id), before = counts(t), removed = h.replaceGeneric(t), after = counts(t);
  assert(removed > 0, `${id}: something replaced`);
  for (const k of Object.keys(before)) if (!/^(bridge|major|street|path)/.test(k)) assert.equal(after[k], before[k], `${id}: ${k} untouched`);
  assert.equal(h.replaceGeneric(t), 0, `${id}: idempotent`);
  // Nothing generic and elevated is left along the Ba Son / Phú Mỹ / Mống decks' middles.
  t.updateWorldMatrix(true, true);
  for (const b of [baSon, phuMy, mong, saiGon, saiGon2, khanhHoi, ongLanh, calmette, nguyenVanCu, chuYNorth, chuYSouth, tanThuan1, tanThuan2]) {
    const f = b.line.at(b.line.length / 2);
    t.traverse(o => { if (!o.isMesh || !/^bridge/.test(o.name)) return; const p = o.geometry.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); assert(!(Math.hypot(v.x - f.x, v.z - f.z) < 3 && v.y > 1), `${id}: generic ribbon left under ${b.name}`); } });
  }
}
h.dispose(); assert.equal(h.group.parent, null);
console.log(`ok - bridges: ${h.state.names.join(', ')}; ${h.state.triangles} triangles in ${h.state.drawCalls} batches; pylons 113/145 m, Phú Mỹ 45 m clear, decks meet the ramps, ribbons replaced`);
