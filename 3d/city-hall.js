// A schematic exterior model of Ho Chi Minh City Hall (the former Hôtel de
// Ville, 1898-1909; now the People's Committee), at the head of Nguyễn Huệ.
// Footprint and heading from the OSM outline (way 341504305); the front after
// photographs: two storeys in cream and white with green shutters, the
// centre's loggia and sculpted pediment under the clock tower, side pavilions
// with steep orange-tiled roofs, and lower tiled roofs on the end pavilions.
// See CITY-HALL.md.
import * as THREE from 'three';
import {builder, extrude, edge, arch, genericReplacer} from './landmark-kit.js';

export const CITY_HALL = Object.freeze({
  lon: 106.7009599, lat: 10.7765951, yaw: -0.743716,
  // The OSM outline in local metres: z along the front, +x out of it (south-
  // east, down Nguyễn Huệ). The central projection runs z -8.2 to 19.
  outline: [[-13.6, -99.8], [5.2, -99.5], [9.9, -94.1], [10.7, -64.7], [12.5, -38.2], [13.2, -16.1], [12.8, -8.1], [15.3, -8.2], [15.7, 5.3], [16.1, 19.0], [13.7, 19.2], [16.7, 96.3], [15.0, 98.2], [12.4, 99.3], [10.4, 99.1], [-19.7, 85.2], [-19.6, 72.5], [-3.7, 78.9], [-3.8, 70.9], [-4.8, 44.7], [-8.9, 44.8], [-9.4, 23.3], [-14.0, 22.9], [-16.8, 21.8], [-18.2, 19.6], [-18.6, 16.9], [-23.4, 16.8], [-23.4, 12.8], [-19.8, 12.7], [-19.7, 11.6], [-20.8, 11.7], [-20.8, 5.7], [-28.5, 5.6], [-28.6, 0.8], [-19.8, 0.9], [-19.9, -0.5], [-23.9, -0.4], [-24.1, -4.3], [-19.3, -4.5], [-19.3, -6.7], [-18.3, -8.9], [-16.9, -10.2], [-15.0, -11.1], [-9.7, -11.6], [-9.8, -15.2], [-9.8, -17.3], [-11.3, -17.2], [-11.8, -36.3]],
  projection: [7, 8],              // the central projection's front edges
  axis: 5.4,                       // z of the tower and the centre's axis
});

// Heights from a straight-on photograph, scaled by the 27 m central
// projection: the ground floor, the cornice, and the pavilions' pediments.
const FLOOR1 = 5.2, CORNICE = 10.3, PAVILION = 14.0;
const FACE = 15.7;                                     // the central projection's plane (x)

export function createCityHall({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-city-hall';
  const [x, z] = project(CITY_HALL.lon, CITY_HALL.lat);
  group.position.set(x, 0, z); group.rotation.y = CITY_HALL.yaw;
  const materials = {
    facade: new THREE.MeshStandardMaterial({color: '#ecd6a2', roughness: 0.85}),
    trim: new THREE.MeshStandardMaterial({color: '#f8f4ea', roughness: 0.8}),
    shutter: new THREE.MeshStandardMaterial({color: '#3d5a40', roughness: 0.7}),
    glass: new THREE.MeshStandardMaterial({color: '#2b2a26', roughness: 0.35, metalness: 0.2}),
    roof: new THREE.MeshStandardMaterial({color: '#8d8a84', roughness: 0.9}),
    tile: new THREE.MeshStandardMaterial({color: '#cf693b', roughness: 0.8}),
  };
  const {add, box, finish} = builder(materials, 'city-hall');
  const outline = CITY_HALL.outline, A = CITY_HALL.axis;
  // Things on the front: `along` is z, `out` is x; yaw π/2 turns a
  // geometry's width along z and its face to +x.
  const F = (key, geometry, along, y, out = FACE) => add(key, geometry, out, y, along, 0, Math.PI / 2);
  const FB = (key, w, h, d, along, y, out = FACE) => F(key, new THREE.BoxGeometry(w, h, d), along, y, out);

  add('facade', extrude(outline, 0, CORNICE));
  add('roof', extrude(outline, CORNICE, CORNICE + 0.3));

  outline.forEach((_, i) => {
    const e = edge(outline, i), front = e.nu > 0.7, centre = CITY_HALL.projection.includes(i);
    const at = (t, out) => [e.u0 + e.du * t + e.nu * out, e.v0 + e.dv * t + e.nv * out];
    const put = (key, w, h, d, t, out, y) => { const [pu, pv] = at(t, out); box(key, w, h, d, pu, y, pv, e.yaw); };
    put('trim', e.len + 0.8, 0.6, 1.0, e.len / 2, 0.4, CORNICE - 0.3);                  // cornice
    put('trim', e.len + 0.3, 0.3, 0.5, e.len / 2, 0.2, FLOOR1);                          // string course
    put('trim', e.len, 0.8, 0.3, e.len / 2, 0.2, CORNICE + 0.7);                         // balustrade
    if (centre || e.len < 3) return;
    const pitch = front ? 2.6 : 3.4, n = Math.floor((e.len - 1) / pitch), start = (e.len - (n - 1) * pitch) / 2;
    for (let k = 0; k < n; k++) {
      const t = start + k * pitch, [wu, wv] = at(t, 0.07);
      if (front && Math.abs(wv - A) < 14.5) continue;                                     // the pavilions carry their own
      if (front) {
        add('shutter', arch(1.3, 2.9, 0.12), wu, 1.0, wv, 0, e.yaw);
        box('shutter', 1.2, 2.4, 0.12, wu, FLOOR1 + 1.9, wv, e.yaw);
        if (k < n - 1) {                                                                  // white pilasters between
          const [cu, cv] = at(t + pitch / 2, 0.25);
          box('trim', 0.45, FLOOR1 - 0.4, 0.4, cu, FLOOR1 / 2, cv, e.yaw);
          box('trim', 0.45, CORNICE - FLOOR1 - 0.8, 0.4, cu, (CORNICE + FLOOR1) / 2, cv, e.yaw);
        }
      } else {
        box('shutter', 1.2, 2.0, 0.12, wu, 1.8, wv, e.yaw);
        box('shutter', 1.2, 2.2, 0.12, wu, FLOOR1 + 1.7, wv, e.yaw);
      }
    }
  });

  // The centre: five arched doors with green grilles, five open arches of
  // the loggia above over balustrades, paired white columns, steps.
  for (let k = -2; k <= 2; k++) {
    const along = A + k * 2.25;
    F('shutter', arch(1.7, 3.6, 0.12), along, 0.7, FACE + 0.06);
    F('glass', arch(1.7, 3.3, 0.12), along, FLOOR1 + 0.9, FACE + 0.06);
    FB('trim', 1.7, 0.8, 0.15, along, FLOOR1 + 1.0, FACE + 0.3);
  }
  for (let k = -2.5; k <= 2.5; k++) for (const [y0, y1] of [[0.7, FLOOR1 - 0.3], [FLOOR1 + 0.5, CORNICE - 0.8]])
    F('trim', new THREE.CylinderGeometry(0.17, 0.19, y1 - y0, 8), A + k * 2.25, (y0 + y1) / 2, FACE + 0.35);
  for (let s = 0; s < 4; s++) FB('trim', 13 - s * 0.5, 0.18 * (s + 1), 2.2 - s * 0.55, A, 0.09 * (s + 1), FACE + (2.2 - s * 0.55) / 2);
  // Its pediment, with the sculpture group, in front of the tower.
  const pediment = new THREE.Shape([[-5.8, 0], [5.8, 0], [0, 2.6]].map(([a, b]) => new THREE.Vector2(a, b)));
  F('trim', new THREE.ExtrudeGeometry(pediment, {depth: 0.8, bevelEnabled: false}), A, CORNICE + 0.9, FACE - 0.6);
  FB('facade', 11.2, 1.0, 1.4, A, CORNICE + 0.4, FACE - 0.4);
  for (const [da, dy, r] of [[0, 1.3, 0.55], [-1.2, 0.8, 0.45], [1.2, 0.8, 0.45], [-2.3, 0.5, 0.35], [2.3, 0.5, 0.35]]) {
    F('trim', new THREE.SphereGeometry(r, 8, 6), A + da, CORNICE + 1.2 + dy, FACE + 0.3);
    F('trim', new THREE.CylinderGeometry(r * 0.6, r * 0.8, r * 2, 8), A + da, CORNICE + 0.9 + dy - r, FACE + 0.3);
  }

  // The side pavilions: raised to 14 m, a great arched loggia over the
  // first floor, a relief in the pediment, and a steep orange-tiled roof.
  for (const s of [-1, 1]) {
    const along = A + s * 9.55, depth = 12, back = FACE - depth / 2 + 0.3;
    FB('facade', 7.9, PAVILION - CORNICE, depth, along, (PAVILION + CORNICE) / 2, back);
    FB('facade', 7.9, CORNICE, 0.6, along, CORNICE / 2, FACE + 0.3);
    F('trim', arch(3.8, 4.8, 0.12), along, FLOOR1 + 0.4, FACE + 0.62);
    F('glass', arch(3.0, 4.2, 0.12), along, FLOOR1 + 0.6, FACE + 0.66);
    FB('trim', 3.2, 0.8, 0.2, along, FLOOR1 + 1.0, FACE + 0.9);
    F('shutter', arch(1.5, 3.2, 0.12), along, 0.9, FACE + 0.66);
    for (const d of [-2.4, 2.4]) for (const [y0, y1] of [[0.4, FLOOR1 - 0.3], [FLOOR1 + 0.4, CORNICE - 0.6]])
      F('trim', new THREE.CylinderGeometry(0.2, 0.22, y1 - y0, 8), along + d, (y0 + y1) / 2, FACE + 0.95);
    const gable = new THREE.Shape([[-3.2, 0], [3.2, 0], [0, 1.5]].map(([a, b]) => new THREE.Vector2(a, b)));
    F('trim', new THREE.ExtrudeGeometry(gable, {depth: 0.5, bevelEnabled: false}), along, CORNICE + 0.8, FACE + 0.35);
    F('trim', new THREE.SphereGeometry(0.5, 8, 6), along, CORNICE + 1.5, FACE + 0.95);
    FB('trim', 8.6, 0.6, depth + 0.6, along, PAVILION - 0.3, back);
    const roof = new THREE.CylinderGeometry(Math.SQRT1_2 * 0.3, Math.SQRT1_2, 2.6, 4, 1);
    roof.rotateY(Math.PI / 4); roof.scale(depth - 0.2, 1, 7.7);
    add('tile', roof, back, PAVILION + 1.3, along);
    box('trim', 3.4, 0.35, 0.3, back, PAVILION + 2.75, along);                            // cresting on the ridge
    for (let k = -1; k <= 1; k++) box('trim', 0.15, 0.8, 0.15, back + k * 1.5, PAVILION + 3.2, along);
  }

  // The end pavilions: lower hipped roofs of orange tile over the cornice.
  for (const s of [-1, 1]) {
    const roof = new THREE.CylinderGeometry(Math.SQRT1_2 * 0.35, Math.SQRT1_2, 2.6, 4, 1);
    roof.rotateY(Math.PI / 4); roof.scale(11, 1, 11);
    add('tile', roof, 7.5, CORNICE + 0.3 + 1.3, A + s * 24);
  }

  // The clock tower behind the pediment: a square shaft with clocks, a
  // balcony, an arcaded belvedere, a lantern and a cupola, and the flag.
  const T = 10.2;                                          // the tower's x
  add('facade', new THREE.BoxGeometry(4.3, PAVILION - CORNICE, 4.3), T, (PAVILION + CORNICE) / 2, A);
  add('facade', new THREE.BoxGeometry(3.2, 18.3 - PAVILION, 3.2), T, (18.3 + PAVILION) / 2, A);
  for (const [du, dv] of [[1.62, 0], [-1.62, 0], [0, 1.62], [0, -1.62]])
    add('trim', new THREE.CylinderGeometry(0.55, 0.55, 0.08, 16), T + du, 16.3, A + dv, dv ? Math.PI / 2 : 0, 0, du ? Math.PI / 2 : 0);
  add('trim', new THREE.BoxGeometry(4.2, 0.35, 4.2), T, 18.45, A);
  add('trim', new THREE.BoxGeometry(4.0, 0.7, 4.0), T, 18.95, A);
  add('facade', new THREE.BoxGeometry(2.8, 2.0, 2.8), T, 19.6, A);
  for (const [du, dv, ry] of [[1.42, 0, Math.PI / 2], [-1.42, 0, Math.PI / 2], [0, 1.42, 0], [0, -1.42, 0]])
    add('glass', arch(1.2, 1.6, 0.1), T + du, 18.9, A + dv, 0, ry);
  add('trim', new THREE.BoxGeometry(3.3, 0.4, 3.3), T, 20.8, A);
  add('facade', new THREE.BoxGeometry(1.8, 1.7, 1.8), T, 21.85, A);
  add('trim', new THREE.BoxGeometry(2.2, 0.3, 2.2), T, 22.85, A);
  const cupola = new THREE.SphereGeometry(1.0, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2); cupola.scale(1, 1.4, 1);
  add('trim', cupola, T, 23.0, A);
  add('trim', new THREE.CylinderGeometry(0.04, 0.06, 5.5, 5), T, 24.4 + 2.75, A);

  const triangles = finish(group);
  scene.add(group);
  // The generic block is 9.7 m tall; the 10.6 m neighbours built against its
  // back share wall lines with it, so only triangles below 10.2 m go.
  group.updateMatrixWorld(true);
  const flags = [{top: group.localToWorld(new THREE.Vector3(T, 29.9, A)), length: 2.1}];
  const replaceGeneric = genericReplacer(group, outline, {flag: 'cityHallReplaced', top: 10.2});
  const view = {target: group.localToWorld(new THREE.Vector3(FACE, 10, A)), eye: group.localToWorld(new THREE.Vector3(FACE + 110, 30, A - 20))};
  const state = {name: 'Ho Chi Minh City Hall', lon: CITY_HALL.lon, lat: CITY_HALL.lat, height: 24.4, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, flags, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
