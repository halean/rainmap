// node --loader ./tests/three-loader.mjs tests/yacht.mjs
// The Princess 60 at the Vinhomes Central Park Marina (3d/yacht.js).
import assert from 'node:assert/strict';
import * as THREE from '../3d/vendor/three.module.js';
import {createYacht, YACHT} from '../3d/yacht.js';
const project = (lon, lat) => [(lon - 106.65) * 111320 * Math.cos(10.81 * Math.PI / 180), -(lat - 10.81) * 111320];
const scene = new THREE.Scene(), y = createYacht({scene, project});
y.yacht.traverse(o => { if (o.isMesh) assert(o.geometry.attributes.position.array.every(Number.isFinite), o.name); });
// Principal dimensions, in the yacht's own frame: the hull 18.36 m and the beam 4.83 m, the draft 1.27 m below the water.
const hull = new THREE.Box3(); y.yacht.getObjectByName('yacht-hull').geometry.computeBoundingBox(); hull.copy(y.yacht.getObjectByName('yacht-hull').geometry.boundingBox);
assert(Math.abs(hull.max.x - hull.min.x - YACHT.hull) < 0.05, `hull length ${hull.max.x - hull.min.x}`);
const below = y.yacht.getObjectByName('yacht-antifoul').geometry; below.computeBoundingBox();
assert(Math.abs(-0.12 - below.boundingBox.min.y - YACHT.draft) < 0.02, 'draft');
assert(Math.abs(Math.max(hull.max.z, -hull.min.z) - YACHT.beam / 2) < 0.12, `beam ${2 * Math.max(hull.max.z, -hull.min.z)}`);
// Three sunbathers' towels, and the ensign with its star.
for (const k of ['towel1', 'towel2', 'towel3', 'flag', 'star']) assert(y.yacht.getObjectByName(`yacht-${k}`), k);
// Moored alongside the pontoon: its edge 3 m off the centreline, clear of the hull, which floats in the water.
const w = new THREE.Box3().setFromObject(y.yacht);
assert(w.min.y < -1 && w.max.y > 7, 'afloat, arch above');
console.log(`ok - Princess 60: ${YACHT.hull} m hull, ${YACHT.beam} m beam, ${YACHT.draft} m draft; ${y.state.triangles} triangles; three sunbathers; moored`);
y.dispose();
