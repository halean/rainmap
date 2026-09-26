// River water (3d/riverwater.js): the wave field, the Kelvin wake, the
// wake ribbons through turns, the surface grid, and the yachts riding the
// surface (rivertour.js setSurface). The GPU side is checked in the browser.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {waveTrains, waveHeight, wakeAt, recordTrail, ribbon, polarGrid, QUALITY, QUALITY_ORDER, SURFACE} from '../3d/riverwater.js';
import {createRiverTour, HULL} from '../3d/rivertour.js';

const project = (lon, lat) => [(lon - 106.65) * 111320 * Math.cos(10.81 * Math.PI / 180), -(lat - 10.81) * 111320];

// Waves: small (a river, not a sea), and moving.
const trains = waveTrains(0.6, 1);
let max = 0;
for (let i = 0; i < 2000; i++) max = Math.max(max, Math.abs(waveHeight(trains, i * 1.37, i * 0.71, i * 0.05)));
assert.ok(max > 0.03 && max < 0.13, `wave height ${max}`);
assert.notEqual(waveHeight(trains, 3, 4, 0), waveHeight(trains, 3, 4, 0.5));
assert.ok(waveTrains(0.6, 1.8)[0].amp > trains[0].amp, 'stronger wind, higher waves');

// The wake: nothing ahead of the stern; the divergent arm at 19.47° is
// higher than the water between arms; it fades with age; foam on the track.
assert.deepEqual(wakeAt(-1, 0, 0, 18), [0, 0]);
const d = 80, arm = 1.2 + d * Math.tan(19.47 * Math.PI / 180);
const highest = (y0, age) => Math.max(...Array.from({length: 40}, (_, i) => Math.abs(wakeAt(d, y0 + i * 0.1, age, 18)[0])));
const peak = highest(arm - 2, 5), between = highest(arm + 12, 5);
assert.ok(peak > 0.1 && peak > 4 * between, `arm ${peak} vs outside ${between}`);
assert.ok(highest(arm - 2, 120) < peak / 3, 'fades with age');
const young = wakeAt(20, 0, 2, 18)[1], old = wakeAt(20, 0, 120, 18)[1];
assert.ok(young > 0.8 && old < young / 4, `foam ${young} -> ${old}`);
assert.ok(wakeAt(20, 0, 2, 3)[1] < young, 'less foam slow');

// The track and its ribbon: straight, then a hard left turn. The ribbon
// never reaches past the turn's centre on the inside.
const trail = [];
let t = 0;
const pose = (x, z, dx, dz) => ({x, z, dx, dz, speed: 18, aft: HULL.aft, bow: HULL.bow, beam: HULL.beam});
let stern;
for (let i = 0; i < 60; i++) { stern = recordTrail(trail, pose(0, -i * 1.5, 0, -1), t); t += 0.1; }          // north
const R = 30, cx = -R, cz = -90;
for (let i = 0; i <= 60; i++) {                                                                              // left, round to west
  const a = i / 60 * Math.PI / 2, x = cx + R * Math.cos(a), z = cz - R * Math.sin(a);
  stern = recordTrail(trail, pose(x, z, -Math.sin(a), -Math.cos(a)), t); t += 0.1;
}
assert.ok(trail.length > 30 && stern.arc > 100);
const P = new Float32Array(3000 * 6), W = new Float32Array(3000 * 8), n = ribbon(trail, stern, 18, t, P, W);
assert.equal(n, trail.length + 1);
for (let i = 0; i < n; i++) assert.ok(W[i * 8] >= -1e-6 && W[i * 8 + 1] > 0 && W[i * 8 + 5] < 0, 'd >= 0, left > 0, right < 0');
const onTurn = Array.from({length: n}, (_, i) => i).filter(i => W[i * 8] > 10 && W[i * 8] < 30);
assert.ok(onTurn.length && onTurn.every(i => W[i * 8 + 1] <= R * 0.9 + 1), 'inner side within the turn radius');
// A jump (a reset) starts a fresh track.
recordTrail(trail, pose(5000, 5000, 1, 0), t + 1);
assert.equal(trail.length, 1);

// The surface grid: fine at the centre, reaching the radius.
for (const level of QUALITY_ORDER) {
  const q = QUALITY[level], g = polarGrid(q.rings, q.segments, SURFACE.radius), pos = g.attributes.position;
  let r = 0; for (let i = 0; i < pos.count; i++) r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
  assert.ok(Math.abs(r - SURFACE.radius) < 1e-3);
  assert.ok(Math.hypot(pos.getX(1), pos.getZ(1)) < 0.3, `${level}: first ring ${Math.hypot(pos.getX(1), pos.getZ(1))}`);
  assert.equal(g.index.count / 3, q.segments * (2 * q.rings - 1));
}
assert.ok(QUALITY.economical.wake < QUALITY.recommended.wake && QUALITY.recommended.wake < QUALITY.cinematic.wake);

// The yachts ride the surface: a tilted plane pitches and rolls them; null keeps the scripted bob.
const parent = new THREE.Group(), boats = [0, 1].map(i => { const o = new THREE.Object3D(); parent.add(o); return {name: `b${i}`, object: o, waterY: -0.12}; });
const tour = createRiverTour({project, boats});
tour.update(1e12); tour.update(1e12 + 16);
const calm = boats[0].object.rotation.x;
let asked = [];
tour.setSurface((x, z, skip) => { asked.push(skip); return 0.02 * x; });
for (let i = 0; i < 200; i++) tour.update(1e12 + 32 + i * 16);
assert.ok(asked.includes(0) && asked.includes(1), 'each skips its own wake');
const m = tour.tours[0].motion, dir = tour.tours[0].pose.dir;
assert.ok(Math.abs(m.pitch - Math.atan(0.02 * dir.x)) < 2e-3, `pitch ${m.pitch}`);
assert.ok(Math.abs(m.roll - -Math.atan(0.02 * -dir.z)) < 2e-3, `roll ${m.roll}`);
assert.ok(Math.abs(m.heave - 0.02 * tour.tours[0].pose.p.x) < 0.5);
tour.setSurface(() => null); tour.update(1e12 + 5000);
assert.equal(tour.tours[0].motion, null);
assert.ok(Number.isFinite(boats[0].object.position.y) && Number.isFinite(calm));
const hulls = tour.hulls();
assert.equal(hulls.length, 2);
assert.ok(hulls.every(h => h.speed > 0 && h.aft < 0 && h.bow > 0 && Math.abs(Math.hypot(h.dx, h.dz) - 1) < 1e-6));

console.log(`ok - river water: waves up to ${max.toFixed(3)} m; Kelvin arm ${peak.toFixed(2)} m at ${d} m; ribbon ${n} points through a ${R} m turn; yachts ride the surface`);
