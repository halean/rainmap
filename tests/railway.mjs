// node --loader ./tests/three-loader.mjs tests/railway.mjs
// The North-South railway and its yards (3d/railway.js): the OSM track is all
// there, at rail level, light, and joined to the Bình Lợi bridge.
import assert from 'node:assert/strict';
import * as THREE from '../3d/vendor/three.module.js';
import {createRailway, RAIL} from '../3d/railway.js';
import {createBridges} from '../3d/bridges.js';
import {RAILWAY_WAYS} from '../3d/railway-lines.js';
const project = (lon, lat) => [(lon - 106.65) * 111320 * Math.cos(10.81 * Math.PI / 180), -(lat - 10.81) * 111320];
const scene = new THREE.Scene(), r = createRailway({scene, project});
assert.equal(r.group.parent, scene);
assert(Math.abs(r.state.mainKm - 37.5) < 1, `main line ${r.state.mainKm} km`);
assert(Math.abs(r.state.sidingKm - 30.3) < 1, `sidings ${r.state.sidingKm} km`);
assert(r.state.triangles < 30000, `${r.state.triangles} triangles`);
assert(RAILWAY_WAYS.every(w => w.id !== 715033337 && w.id !== 138540676), 'the Bình Lợi and Ghềnh bridges are left to bridges.js');
r.group.traverse(o => { if (o.isMesh) { assert(!o.name.startsWith('building')); assert(o.geometry.attributes.position.array.every(Number.isFinite)); } });
// Rails stand on the ballast, off the ground and above the generic roads (0.3 m).
const box = new THREE.Box3().setFromObject(r.group.getObjectByName('railway-rail'));
assert(Math.abs(box.max.y - RAIL.railTop) < 1e-6 && Math.abs(box.min.y - RAIL.ballastTop) < 1e-6);
assert(RAIL.ballastTop > 0.3);
// The Bình Lợi bridge's ends meet track ends, at rail level.
const b = createBridges({scene: new THREE.Scene(), project});
const meshes = []; b.group.traverse(o => { if (o.isMesh) meshes.push(o); });
const ray = new THREE.Raycaster();
for (const [bl, s] of [...[0.5, b.bridges.binhLoiRail.line.length - 0.5].map(s => [b.bridges.binhLoiRail, s]), ...[0.5, b.bridges.ghenh.line.length - 0.5].map(s => [b.bridges.ghenh, s])]) {
  const f = bl.line.at(s);
  const nearest = Math.min(...RAILWAY_WAYS.flatMap(w => [w.pts[0], w.pts[w.pts.length - 1]]).map(([lon, lat]) => { const [x, z] = project(lon, lat); return Math.hypot(x - f.x, z - f.z); }));
  assert(nearest < 2, `a track ends at the bridge's end (${nearest.toFixed(1)} m)`);
  ray.set(new THREE.Vector3(f.x, 30, f.z), new THREE.Vector3(0, -1, 0));
  const deck = ray.intersectObjects(meshes, false)[0];
  assert(deck && Math.abs(deck.point.y - RAIL.ballastTop) < 0.25, `bridge deck at rail level at its end (${deck?.point.y})`);
}
r.dispose(); assert.equal(r.group.parent, null);
console.log(`ok - railway: ${r.state.mainKm} km main line, ${r.state.sidingKm} km of sidings and yards, ${r.state.triangles} triangles in ${r.state.drawCalls} batches; joined to the Bình Lợi and Ghềnh bridges at rail level`);
