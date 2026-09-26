// node --loader ./tests/three-loader.mjs tests/flag_set.mjs
// The landmarks' flags (flag.js createFlagSet): one flag, one wind, waving near.
import assert from 'node:assert/strict';
import * as THREE from '../3d/vendor/three.module.js';
const events = new EventTarget(), toggle = {checked: true}, status = {};
globalThis.document = {hidden: false, addEventListener: events.addEventListener.bind(events),
  getElementById: id => id === 'flag' ? toggle : id === 'flag-status' ? status : null};
globalThis.fetch = async () => ({ok: true, json: async () => ({wind: {dir: 120, speed_kt: 10, raw: 'METAR VVTS 251200Z 12010KT'}})});
globalThis.setInterval = () => 0;
const {createFlag, createFlagSet, flagTexture, flagYaw} = await import('../3d/flag.js');
const {createRex} = await import('../3d/rex.js');
const {createCityHall} = await import('../3d/city-hall.js');
const {createIndependencePalace} = await import('../3d/independence-palace.js');
const {createBitexco} = await import('../3d/bitexco.js');
const project = (lon, lat) => [(lon - 106.65) * 111320 * Math.cos(10.81 * Math.PI / 180), -(lat - 10.81) * 111320];

const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
const landmarks = [createRex, createCityHall, createIndependencePalace, createBitexco].map(f => f({scene, project}));
const big = createFlag({scene, skyline: null, camera, roof: {x: 0, y: 400, z: 0, side: 4}});
const set = createFlagSet({scene, camera});
for (const l of landmarks) for (const f of l.flags) set.add({...f, parent: l.group});
await new Promise(resolve => setImmediate(resolve));
assert.equal(set.flags.length, 4, 'one flag per landmark');

// One flag: the same texture (red, the yellow star in the middle) as the tower's.
const texture = flagTexture(), centre = (texture.image.height / 2 * texture.image.width + texture.image.width / 2) * 4;
assert.deepEqual([...texture.image.data.slice(centre, centre + 3)], [255, 255, 0], 'yellow star at the centre');
assert.deepEqual([...texture.image.data.slice(0, 3)], [218, 37, 29], 'red field');
for (const {mesh} of set.flags) assert.equal(mesh.material.map, texture);
assert.equal(big.group.children[1].children[0].material.map, texture);

// One wind: every flag, whatever its building's heading, flies the same way
// as the tower's flag -- downwind of the METAR's 120°.
const worldYaw = o => { o.updateWorldMatrix(true, false); const x = new THREE.Vector3(1, 0, 0).transformDirection(o.matrixWorld); return Math.atan2(-x.z, x.x); };
const tower = worldYaw(big.group.children[1]);
assert(Math.abs(tower - flagYaw(120)) < 1e-6);
for (const {mesh} of set.flags) assert(Math.abs(Math.atan2(Math.sin(worldYaw(mesh) - tower), Math.cos(worldYaw(mesh) - tower))) < 1e-6, 'flies with the others');

// Each hangs from its pole's top: the hoist's top corner is where declared.
for (const [i, l] of landmarks.entries()) {
  const {mesh} = set.flags[i], corner = new THREE.Vector3(0.08, 0, 0);
  mesh.localToWorld(corner);
  assert(corner.distanceTo(l.flags[0].top) < 0.1, 'hoist at the pole top');
}

// Far away the flags are still; near, they wave; walking away, they settle.
const flag = set.flags[1], positions = () => Array.from(flag.mesh.geometry.attributes.position.array);
const rest = positions();
camera.position.copy(flag.world).add(new THREE.Vector3(3000, 0, 0)); camera.updateMatrixWorld();
set.update(1000); assert.deepEqual(positions(), rest, 'still when far');
camera.position.copy(flag.world).add(new THREE.Vector3(60, 0, 0)); camera.updateMatrixWorld();
set.update(2000); const a = positions(); set.update(2100); const b = positions();
assert.notDeepEqual(a, rest); assert.notDeepEqual(a, b, 'waving when near');
assert(flag.mesh.geometry.attributes.normal.array.every(Number.isFinite));
const hoist = (p, i) => p[i * 3 + 2];
assert(Math.abs(hoist(a, 0)) < 1e-6, 'the hoist stays on the pole');
camera.position.copy(flag.world).add(new THREE.Vector3(3000, 0, 0)); camera.updateMatrixWorld();
set.update(3000); assert.deepEqual(positions(), rest, 'settles again when far');
// Two flags a few metres apart (the two yachts' ensigns) keep their own rhythm.
const pair = createFlagSet({scene, camera});
const [f1, f2] = [pair.add({top: new THREE.Vector3(8000, 3, 1700), length: 0.8}), pair.add({top: new THREE.Vector3(8003, 3, 1705), length: 0.8})].map((_, i) => pair.flags[i]);
assert(Math.abs(f1.rate - f2.rate) > 0.01 || Math.abs(f1.phase - f2.phase) > 0.3, 'not in step');
camera.position.set(8010, 10, 1710); camera.updateMatrixWorld();
const tip = f => f.mesh.geometry.attributes.position.array.at(-1);
let diverge = 0; for (let t = 0; t < 4000; t += 250) { pair.update(t); if (Math.abs(tip(f1) - tip(f2)) > 0.01) diverge++; }
assert(diverge > 8, `ensigns wave independently (${diverge}/16 samples differ)`);
console.log(`ok - ${set.flags.length} landmark flags: one texture with the star, all downwind with the tower's flag, hung at their poles, waving only near`);
