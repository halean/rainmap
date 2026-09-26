// node --loader ./tests/three-loader.mjs tests/walktour.mjs
// The Đồng Khởi walking tour (3d/walktour.js): under budget, loaded on demand, walked smoothly.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../3d/vendor/three.module.js';
import {createWalkTour, WALK} from '../3d/walktour.js';
const project = (lon, lat) => [(lon - 106.65) * 111320 * Math.cos(10.81 * Math.PI / 180), -(lat - 10.81) * 111320];
// Not loaded with the city: only the button imports it.
const viewer = fs.readFileSync(new URL('../3d/viewer.js', import.meta.url), 'utf8');
assert(!/^import[^\n]*walktour/m.test(viewer) && viewer.includes("import('./walktour.js')"), 'imported only on demand');
const scene = new THREE.Scene(), w = createWalkTour({scene, project});
assert(w.state.triangles < 1e6, `${w.state.triangles} triangles`);
assert(w.state.units > 150 && w.state.trees > 90 && w.state.lamps > 40, JSON.stringify(w.state));
w.group.traverse(o => { if (o.isMesh) assert(o.geometry.attributes.position.array.every(Number.isFinite), o.name); });
// The walker keeps to the sidewalks at walking pace, round the whole loop.
let prev = null;
for (let t = 0; t < w.lap / WALK.speed; t += 1) {
  const p = w.walkerAt(t), q = new THREE.Vector2(p.x, p.z);
  if (prev) assert(q.distanceTo(prev) <= WALK.speed * 1.35 + 1e-6, `step at ${t}s: ${q.distanceTo(prev)}`);
  prev = q;
}
const v = w.followView(); assert(Number.isFinite(v.pos.y) && v.pos.y > 1.5 && v.pos.y < 2.2);
w.dispose(); assert.equal(w.group.parent, null);
console.log(`ok - walking tour: ${w.state.units} shopfronts, ${w.state.trees} trees, ${w.state.lamps} lamps, ${w.state.triangles} triangles; ${w.state.lapMinutes} min round Đồng Khởi; loaded on demand`);
