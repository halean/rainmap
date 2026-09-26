// node --loader ./tests/three-loader.mjs tests/rivertour.mjs
// River tours (3d/rivertour.js): both yachts circle the river continuously, half a lap apart.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../3d/vendor/three.module.js';
import {GLTFLoader} from '../3d/vendor/loaders/GLTFLoader.js';
import {createYacht} from '../3d/yacht.js';
import {createMooredPrincess60} from '../3d/princess60-berth.js';
import {createRiverTour, RIVER_TOUR} from '../3d/rivertour.js';
const project = (lon, lat) => [(lon - 106.65) * 111320 * Math.cos(10.81 * Math.PI / 180), -(lat - 10.81) * 111320];
const at = (hh, mm, ss = 0) => Date.UTC(2026, 8, 26, hh - 7, mm, ss);
const scene = new THREE.Scene(), star = createYacht({scene, project}), nha = createMooredPrincess60({scene, project});
scene.updateMatrixWorld(true);
const tour = createRiverTour({project, boats: [
  {name: 'Saigon Star', object: star.yacht, waterY: 0, moored: on => star.setMoored(on)},
  {name: 'Nha Rong', object: nha.yacht, waterY: -0.12},
]});
// Never moored: lines and fenders in from the start.
assert.equal(star.yacht.getObjectByName('yacht-rope').visible, false);
// A closed loop of ~28 km; a lap at 35 knots with two slow turns.
assert(tour.route.length > 26000 && tour.route.length < 30000, `loop ${tour.route.length}`);
assert(tour.lap > 25 * 60 && tour.lap < 40 * 60, `lap ${tour.lap / 60} min`);
// At any hour, day or night, both are out on the river, half a lap apart.
const berth = new THREE.Vector3(); star.yacht.getWorldPosition(berth);
for (const [h, m] of [[3, 0], [9, 20], [14, 7], [23, 59]]) {
  tour.update(at(h, m));
  const [a, b] = tour.tours.map(t => t.pose.s), gap = Math.abs(a - b);
  assert(Math.min(gap, tour.route.length - gap) > 0.25 * tour.route.length, `apart at ${h}:${m}`);
}
// Flat out at 35 knots most of the lap; never faster; smooth, including across midnight.
let prev = null, fast = 0, n = 0, maxTrim = 0;
for (let k = -120; k < tour.lap; k += 1) {
  tour.update(at(0, 0) + k * 1000); const p = star.yacht.position.clone();
  if (prev) assert(p.distanceTo(prev) <= RIVER_TOUR.cruise + 0.05, `step at ${k}s: ${p.distanceTo(prev)}`);
  prev = p; n++; if (tour.state.underway[0].knots > 34.9) fast++; maxTrim = Math.max(maxTrim, star.yacht.rotation.z);
}
assert(fast / n > 0.8, `flat out ${Math.round(fast / n * 100)}% of the lap`);
assert(maxTrim > 0.04 && maxTrim < 0.12, `trim ${maxTrim}`);
// On the river: every 20 m of the loop over the model's water.
async function tile(id) { const f = new URL(`../3d/assets/tiles/${id}.glb`, import.meta.url); if (!fs.existsSync(f)) return []; const b = fs.readFileSync(f); const s = (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene; s.updateWorldMatrix(true, true); const w = []; s.traverse(o => { if (o.isMesh && o.name.startsWith('water')) w.push(o); }); return w; }
const tiles = {}, ray = new THREE.Raycaster(); let dry = 0, samples = 0;
for (let i = 0; i < tour.route.points.length; i += 2) {
  const p = tour.route.points[i], id = `${Math.floor(p.x / 2000)}_${Math.floor(p.z / 2000)}`;
  tiles[id] ??= await tile(id); ray.set(new THREE.Vector3(p.x, 50, p.z), new THREE.Vector3(0, -1, 0)); samples++;
  if (!ray.intersectObjects(tiles[id], false).length) dry++;
}
assert(dry / samples < 0.01, `${dry}/${samples} loop samples off the water`);
// The chase camera always has a yacht.
const v = tour.followView(); assert(v && Math.abs(v.forward.length() - 1) < 1e-6);
star.dispose(); nha.dispose();
console.log(`ok - river tours: ${(tour.route.length / 1000).toFixed(1)} km loop, ${(tour.lap / 60).toFixed(1)} min a lap at 35 kn, both always out half a lap apart, on the water`);
