// A schematic exterior model of Tân Định Church (the Church of the Sacred
// Heart, 1876), the pink church on Hai Bà Trưng. Footprint and heading from
// the OSM outline (way 60118189); the elevations after photographs: pink
// walls picked out in white, the front's central tower with its arched
// portal, clock, two stages of paired louvred openings, corner pinnacles and
// a grey spire; pinnacled buttresses and lancets along the nave, and the
// rounded apse. See TAN-DINH.md.
import * as THREE from 'three';
import {builder, extrude, edge, arch, genericReplacer} from './landmark-kit.js';

export const TAN_DINH = Object.freeze({
  lon: 106.6906444, lat: 10.7883301, yaw: -0.613457, spire: 52.6,
  // The OSM outline in local metres: the nave runs along z, the front at
  // z -25.8 (north-east, on Hai Bà Trưng), the rounded apse at +z.
  outline: [[-11.2, 1.3], [-15.1, 1.5], [-15.3, 9.3], [-15.0, 12.8], [-13.9, 16.1], [-12.1, 19.1], [-9.7, 21.6], [-6.7, 23.5], [-3.4, 24.7], [0.1, 25.1], [3.5, 24.7], [6.8, 23.5], [9.8, 21.6], [12.2, 19.1], [14.0, 16.1], [15.1, 12.8], [15.4, 9.3], [15.6, 1.2], [11.0, 1.3], [11.0, -25.8], [-11.2, -25.8]],
});

// Heights from the photographs' proportions, scaled by the published 52.6 m
// to the spire's top: the aisle walls, the nave, the tower's stages.
const WALL = 11.0, NAVE = 15.0, RIDGE = 20.5, TOWER = 36.0, FRONT = -25.8, W = 8.4;

export function createTanDinh({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-tan-dinh';
  const [x, z] = project(TAN_DINH.lon, TAN_DINH.lat);
  group.position.set(x, 0, z); group.rotation.y = TAN_DINH.yaw;
  const materials = {
    pink: new THREE.MeshStandardMaterial({color: '#ea8f97', roughness: 0.8}),
    trim: new THREE.MeshStandardMaterial({color: '#f8eeee', roughness: 0.75}),
    lace: new THREE.MeshStandardMaterial({color: '#e9d9d6', roughness: 0.8}),
    louvre: new THREE.MeshStandardMaterial({color: '#b69a5c', roughness: 0.8}),
    dark: new THREE.MeshStandardMaterial({color: '#3a2a2b', roughness: 0.6}),
    slate: new THREE.MeshStandardMaterial({color: '#a3a7ab', roughness: 0.6, metalness: 0.2}),
    roof: new THREE.MeshStandardMaterial({color: '#8e8f91', roughness: 0.85}),
    gold: new THREE.MeshStandardMaterial({color: '#d4a93e', emissive: '#5a400c', emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.35}),
  };
  const {add, box, finish} = builder(materials, 'tan-dinh');
  const outline = TAN_DINH.outline;
  // A pinnacle: a square shaft, a white band, and a slate cone.
  const pinnacle = (u, v, y0, h, r = 0.7) => {
    box('pink', 2 * r, h, 2 * r, u, y0 + h / 2, v);
    box('trim', 2 * r + 0.2, 0.25, 2 * r + 0.2, u, y0 + h - 0.1, v);
    add('slate', new THREE.ConeGeometry(r * 1.05, r * 4.5, 8), u, y0 + h + r * 2.25, v);
  };

  add('pink', extrude(outline, 0, WALL));
  add('roof', extrude(outline, WALL, WALL + 0.3));

  // Along the walls: white bands, lancets filled with white tracery, and
  // pinnacled buttresses between them.
  outline.forEach((_, i) => {
    const e = edge(outline, i);
    if (e.nv < -0.9) return;                                            // the front, built below
    const at = (t, out) => [e.u0 + e.du * t + e.nu * out, e.v0 + e.dv * t + e.nv * out];
    const put = (key, w, h, d, t, out, y) => { const [pu, pv] = at(t, out); box(key, w, h, d, pu, y, pv, e.yaw); };
    put('trim', e.len + 0.4, 0.5, 0.6, e.len / 2, 0.25, WALL - 0.3);
    put('trim', e.len + 0.2, 0.3, 0.4, e.len / 2, 0.15, 5.2);
    if (e.len < 3) return;
    const bays = Math.max(1, Math.round(e.len / 4.6)), bw = e.len / bays;
    for (let k = 0; k < bays; k++) {
      const [wu, wv] = at((k + 0.5) * bw, 0.07);
      const [su, sv] = at((k + 0.5) * bw, 0.04);
      add('trim', arch(2.0, 4.0, 0.1), su, 5.8, sv, 0, e.yaw);
      add('lace', arch(1.6, 3.7, 0.12), wu, 5.95, wv, 0, e.yaw);
      add('lace', arch(1.6, 3.2, 0.12), wu, 1.2, wv, 0, e.yaw);
    }
    if (e.len > 6) for (let k = 0; k <= bays; k++) {
      const [pu, pv] = at(k * bw, 0.5);
      pinnacle(pu, pv, 0, WALL + 1.2, 0.55);
    }
  });

  // The nave's clerestory and roof over the aisles, and the apse's dome.
  box('pink', 12, NAVE - WALL, 38, 0, (NAVE + WALL) / 2, -6.5);
  const gable = new THREE.Shape([[-6.6, 0], [6.6, 0], [0, RIDGE - NAVE]].map(([a, b]) => new THREE.Vector2(a, b)));
  const nave = new THREE.ExtrudeGeometry(gable, {depth: 38.5, bevelEnabled: false});
  add('roof', nave, 0, NAVE, -25.6);
  const dome = new THREE.SphereGeometry(9.5, 16, 6, 0, Math.PI, 0, Math.PI / 2); dome.scale(1, 0.75, 1);
  add('slate', dome, 0, WALL + 0.3, 12.8);

  // The front: side bays with their gables and scrolls, and the tower.
  for (const s of [-1, 1]) {
    const u = s * 7.8;
    box('pink', 6.8, 14.5, 1.0, u, 7.25, FRONT - 0.5);
    add('trim', arch(2.2, 4.2, 0.1), u, 5.8, FRONT - 1.0);
    add('lace', arch(1.8, 3.9, 0.12), u, 5.95, FRONT - 1.05);
    add('lace', arch(1.8, 3.4, 0.12), u, 1.2, FRONT - 1.05);
    box('trim', 7.2, 0.4, 1.3, u, 5.2, FRONT - 0.6);
    box('trim', 7.2, 0.5, 1.3, u, WALL - 0.3, FRONT - 0.6);
    const scroll = new THREE.TorusGeometry(0.9, 0.22, 6, 12);
    add('trim', scroll, u + s * 1.5, 13.2, FRONT - 1.05);
    pinnacle(s * 11.0, FRONT - 0.4, 0, 16.5, 0.8);                      // the front's corners
    pinnacle(s * (W / 2 + 1.0), FRONT - 0.4, 0, 20.5, 0.9);              // stair turrets beside the tower
  }
  // The tower: projecting from the front, with white string courses.
  const tv = FRONT + W / 2 - 1.6;
  box('pink', W, TOWER, W, 0, TOWER / 2, tv);
  for (const y of [8.0, 14.6, 16.6, 25.5, TOWER - 0.4]) box('trim', W + 0.3, 0.45, W + 0.3, 0, y, tv);
  const face = tv - W / 2;
  add('trim', arch(4.2, 6.4, 0.1), 0, 0, face - 0.04);
  add('dark', arch(3.2, 5.8, 0.12), 0, 0, face - 0.08);
  add('trim', new THREE.CylinderGeometry(1.55, 1.55, 0.12, 24), 0, 11.8, face - 0.1, Math.PI / 2);
  add('pink', new THREE.TorusGeometry(1.4, 0.07, 4, 24), 0, 11.8, face - 0.17);                     // the clock: a white face,
  box('dark', 0.1, 1.0, 0.05, 0, 12.2, face - 0.19);                                                  // its hands
  box('dark', 0.7, 0.1, 0.05, 0.3, 11.8, face - 0.19);
  // Two stages of paired louvred openings on every face.
  for (const [du, dv, ry] of [[0, -W / 2, 0], [0, W / 2, 0], [-W / 2, 0, Math.PI / 2], [W / 2, 0, Math.PI / 2]]) {
    for (const [y, h] of [[17.3, 7.4], [26.3, 8.4]]) for (const a of [-0.9, 0.9]) {
      const au = ry ? du + Math.sign(du) * 0.07 : a, av = ry ? tv + a : tv + dv + Math.sign(dv) * 0.07;
      add('louvre', arch(1.4, h, 0.12), au, y, av, 0, ry);
    }
  }
  // Corner pinnacles on the tower, a gablet on each face, and the spire.
  for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) pinnacle(su * (W / 2 - 0.6), tv + sv * (W / 2 - 0.6), TOWER, 3.6, 0.6);
  for (const [du, dv, ry] of [[0, -W / 2 + 0.6, 0], [0, W / 2 - 0.6, 0], [-W / 2 + 0.6, 0, Math.PI / 2], [W / 2 - 0.6, 0, Math.PI / 2]]) {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape([[-1.4, 0], [1.4, 0], [0, 3.2]].map(([a, b]) => new THREE.Vector2(a, b))), {depth: 0.5, bevelEnabled: false});
    g.translate(0, 0, -0.25);
    add('pink', g, du, TOWER, tv + dv, 0, ry);
  }
  const spireH = TAN_DINH.spire - 2.0 - TOWER;
  add('slate', new THREE.ConeGeometry(3.4, spireH, 8), 0, TOWER + spireH / 2, tv, 0, Math.PI / 8);
  add('trim', new THREE.CylinderGeometry(0.08, 0.08, 2.0, 6), 0, TAN_DINH.spire - 1.0, tv);
  box('trim', 1.0, 0.12, 0.12, 0, TAN_DINH.spire - 0.6, tv);

  const triangles = finish(group);
  scene.add(group);
  const replaceGeneric = genericReplacer(group, outline, {flag: 'tanDinhReplaced', top: 60});
  const view = {target: group.localToWorld(new THREE.Vector3(0, 18, -20)), eye: group.localToWorld(new THREE.Vector3(30, 20, -85))};
  const state = {name: 'Tân Định Church', lon: TAN_DINH.lon, lat: TAN_DINH.lat, height: TAN_DINH.spire, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
