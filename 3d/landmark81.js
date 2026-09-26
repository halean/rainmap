// A schematic model of Landmark 81 (Vincom Landmark 81, 2018), Vietnam's
// tallest building, by the Saigon River in Bình Thạnh. The generic city model
// extrudes the whole site to 461 m -- a slab 100 m by 140 m; this replaces it
// with the tower photographs show: a bundle of square glass tubes stepping up
// to the roof at 395.2 m, and the open steel spire to 461.2 m. Where
// the tubes stand follows OSM's building parts (ways 622296616-8: 150 m,
// 300 m and 461.2 m). See LANDMARK81.md.
import * as THREE from 'three';
import {builder, extrude, genericReplacer} from './landmark-kit.js';

export const LANDMARK81 = Object.freeze({
  lon: 106.721754, lat: 10.7948403, yaw: 0.640013, height: 461.2,
  // The site's OSM outline (way 622296615), in local metres.
  outline: [[44.1, -42.0], [12.5, -41.5], [11.8, -70.2], [-11.2, -70.9], [-11.9, -50.7], [-44.1, -49.8], [-44.1, 28.4], [-35.8, 28.1], [-35.2, 47.4], [-26.2, 47.8], [-25.6, 58.4], [-16.2, 58.8], [-16.0, 68.9], [9.7, 67.6], [9.2, 58.6], [17.7, 57.7], [17.8, 48.3], [27.2, 39.1], [34.7, 38.9], [34.9, 30.8], [48.2, 32.4], [51.7, 11.5], [61.2, 10.2], [61.2, 3.5], [44.0, 3.2]],
  // The tubes: [x0, x1, z0, z1, top]. They fill OSM's 150 m part (the
  // tower's base, x -15..41, z -38.6..23.7); those above 300 m fill its 300 m
  // part; the tallest carries the crown over its 461.2 m part.
  tubes: [
    [5.0, 19.5, -26.0, -8.5, 395.2],
    [2.5, 14.0, -31.9, 0.9, 370],
    [14.0, 27.4, -31.9, -9.0, 338],
    [14.0, 27.4, -9.0, 0.9, 300],
    [-15.0, 2.5, -38.6, -8.0, 286],
    [27.4, 41.0, -38.6, -10.0, 222],
    [-15.0, 14.0, 0.9, 23.7, 187],
    [14.0, 41.0, -10.0, 23.7, 167],
    [-15.0, 2.5, -8.0, 0.9, 150],
    [2.5, 27.4, -38.6, -31.9, 150],
  ],
  crown: [8.1, 16.1, -23.5, -11.0],  // OSM's 461.2 m part: the crown's footprint
});

const PODIUM = 28, CAP = 395.2;      // the mall podium; the roof, where the spire stands

export function createLandmark81({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-landmark81';
  const [x, z] = project(LANDMARK81.lon, LANDMARK81.lat);
  group.position.set(x, 0, z); group.rotation.y = LANDMARK81.yaw;
  const materials = {
    glass: new THREE.MeshStandardMaterial({color: '#a3c4d4', roughness: 0.25, metalness: 0.12}),
    glass2: new THREE.MeshStandardMaterial({color: '#92b6c8', roughness: 0.25, metalness: 0.12}),
    recess: new THREE.MeshStandardMaterial({color: '#1e2a31', roughness: 0.5}),
    podium: new THREE.MeshStandardMaterial({color: '#a9b8c0', roughness: 0.35, metalness: 0.2}),
    steel: new THREE.MeshStandardMaterial({color: '#c9cdd1', roughness: 0.4, metalness: 0.6}),
  };
  const {add, box, finish} = builder(materials, 'landmark81');

  add('podium', extrude(LANDMARK81.outline, 0, PODIUM));
  // Each tube is glass, with dark strips down its corners -- the recesses
  // where the tubes meet -- and dark lines every four floors.
  LANDMARK81.tubes.forEach(([x0, x1, z0, z1, top], i) => {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, h = top - PODIUM;
    box(i % 2 ? 'glass2' : 'glass', w + 0.1, h, d + 0.1, cx, (top + PODIUM) / 2, cz);
    for (const [px, pz] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]]) box('recess', 0.8, h + 0.02, 0.8, px, (top + PODIUM) / 2, pz);
    for (let y = PODIUM + 16; y < top - 2; y += 16) box('recess', w + 0.2, 0.25, d + 0.2, cx, y, cz);
  });

  // The spire: an open steel lattice on the roof of the tallest tube,
  // narrowing to its top at 461.2 m.
  const [c0, c1, d0, d1] = LANDMARK81.crown, cx = (c0 + c1) / 2, cz = (d0 + d1) / 2;
  const H = LANDMARK81.height - CAP, halfW0 = (c1 - c0) / 2, halfD0 = (d1 - d0) / 2, halfW1 = 1.6, halfD1 = 2.2;
  const half = y => [halfW0 + (halfW1 - halfW0) * (y - CAP) / H, halfD0 + (halfD1 - halfD0) * (y - CAP) / H];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const a = new THREE.Vector3(cx + sx * halfW0, CAP, cz + sz * halfD0), b = new THREE.Vector3(cx + sx * halfW1, LANDMARK81.height - 0.5, cz + sz * halfD1);
    const leg = new THREE.CylinderGeometry(0.35, 0.45, a.distanceTo(b), 6);
    leg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    add('steel', leg, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  }
  for (let y = CAP + 4.5; y <= LANDMARK81.height; y += 4.5) {
    const [hw, hd] = half(y);
    for (const s of [-1, 1]) {
      box('steel', 2 * hw, 0.3, 0.3, cx, y, cz + s * hd);
      box('steel', 0.3, 0.3, 2 * hd, cx + s * hw, y, cz);
    }
  }
  box('steel', 2 * halfW1 + 0.6, 0.5, 2 * halfD1 + 0.6, cx, LANDMARK81.height - 0.25, cz);

  const triangles = finish(group);
  scene.add(group);
  group.updateMatrixWorld(true);
  // The top of the crown, for the flag: where it stands and how wide.
  const top = group.localToWorld(new THREE.Vector3(cx, LANDMARK81.height, cz));
  const roof = {x: top.x, y: top.y, z: top.z, side: 2 * halfW1};
  const replaceGeneric = genericReplacer(group, LANDMARK81.outline, {flag: 'landmark81Replaced', top: LANDMARK81.height + 5});
  const view = {target: group.localToWorld(new THREE.Vector3(12, 230, -8)), eye: group.localToWorld(new THREE.Vector3(-420, 300, 520))};
  const state = {name: 'Landmark 81', lon: LANDMARK81.lon, lat: LANDMARK81.lat, height: LANDMARK81.height, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, roof, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
