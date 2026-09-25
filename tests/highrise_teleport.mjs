// tallBuildings() (clusters skyline vertices into approximate individual
// towers) and nearestHighrise() (the double-click-to-a-roof snap logic in
// viewer.js) -- see 3d/lightning.js. Uses real THREE.Group/Mesh/BufferGeometry
// objects (the vendored copy), not mocks, since the functions under test
// only need the real traverse()/updateWorldMatrix() behaviour those provide.
import * as THREE from '../3d/vendor/three.module.js';
import {tallBuildings, nearestHighrise} from '../3d/lightning.js';

function run(name, fn) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { console.log(`FAIL - ${name}: ${e.message}`); process.exitCode = 1; }
}

// A single "roof + walls" building mesh: a handful of vertices clustered
// around (x, z) up to `height`, matching what skyline.py actually emits
// (extruded triangles, not a clean box) closely enough for clustering purposes.
function buildingMesh(x, z, height, count = 6) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    // Small jitter within one cluster cell so it doesn't collapse to one point.
    positions.push(x + (i % 3) - 1, i < count - 1 ? height * 0.4 : height, z + Math.floor(i / 3) - 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Mesh(geometry);
}

function skylineOf(...meshes) {
  const group = new THREE.Group();
  for (const m of meshes) group.add(m);
  return group;
}

run('tallBuildings returns [] for a missing skyline, not an error', () => {
  if (tallBuildings(undefined).length !== 0) throw new Error('expected an empty array');
  if (tallBuildings(null).length !== 0) throw new Error('expected an empty array');
});

run('a single building becomes one cluster at its own centroid and height', () => {
  const skyline = skylineOf(buildingMesh(1000, 2000, 180));
  const towers = tallBuildings(skyline);
  if (towers.length !== 1) throw new Error(`expected 1 cluster, got ${towers.length}`);
  if (Math.abs(towers[0].x - 1000) > 2 || Math.abs(towers[0].z - 2000) > 2) throw new Error(`centroid off: ${JSON.stringify(towers[0])}`);
  if (Math.abs(towers[0].height - 180) > 0.01) throw new Error(`expected height 180, got ${towers[0].height}`);
});

run('two buildings far apart (different 50 m cells) become two separate clusters', () => {
  const skyline = skylineOf(buildingMesh(0, 0, 150), buildingMesh(5000, 5000, 90));
  const towers = tallBuildings(skyline);
  if (towers.length !== 2) throw new Error(`expected 2 clusters, got ${towers.length}: ${JSON.stringify(towers)}`);
});

run('clusters are sorted tallest first and keepTop caps the count', () => {
  const skyline = skylineOf(buildingMesh(0, 0, 60), buildingMesh(9000, 0, 300), buildingMesh(0, 9000, 150));
  const all = tallBuildings(skyline, 100);
  if (all.map(t => t.height).join(',') !== '300,150,60') throw new Error(`not sorted tallest-first: ${JSON.stringify(all)}`);
  const top1 = tallBuildings(skyline, 1);
  if (top1.length !== 1 || top1[0].height !== 300) throw new Error(`keepTop=1 should keep only the 300 m tower, got ${JSON.stringify(top1)}`);
});

run('a non-mesh child (e.g. a Group) and a mesh with no position attribute are skipped, not fatal', () => {
  const bareMesh = new THREE.Mesh(new THREE.BufferGeometry()); // no position attribute set at all
  const skyline = skylineOf(new THREE.Group(), bareMesh, buildingMesh(100, 100, 80));
  const towers = tallBuildings(skyline);
  if (towers.length !== 1) throw new Error(`expected exactly the one real building, got ${towers.length}`);
});

const TOWERS = [{x: 0, z: 0, height: 200}, {x: 100, z: 0, height: 150}, {x: 0, z: 500, height: 90}];

run('nearestHighrise finds the closest cluster within range', () => {
  const found = nearestHighrise(TOWERS, 10, 5, 70);
  if (found !== TOWERS[0]) throw new Error(`expected the tower at (0,0), got ${JSON.stringify(found)}`);
});

run('nearestHighrise returns null when nothing is within maxDistance', () => {
  const found = nearestHighrise(TOWERS, 300, 300, 50);
  if (found !== null) throw new Error(`expected null, got ${JSON.stringify(found)}`);
});

run('nearestHighrise picks the strictly nearer of two candidates in range, not the tallest', () => {
  // (100,0) [150 m] is closer to (60,0) than (0,0) [200 m] is -- distance
  // should win over height, since this is about where you clicked.
  const found = nearestHighrise(TOWERS, 60, 0, 70);
  if (found !== TOWERS[1]) throw new Error(`expected the nearer, shorter tower, got ${JSON.stringify(found)}`);
});

run('nearestHighrise on an empty list is null, not an error', () => {
  if (nearestHighrise([], 0, 0, 100) !== null) throw new Error('expected null for an empty highrise list');
});

if (process.exitCode) process.exit(1);
