// A schematic exterior model of the Saigon Central Post Office (1886-1891) on
// Công xã Paris, beside Notre-Dame. Footprint and heading from the OSM
// outline (way 39514793, height 13.5 m); the front after photographs of it:
// two storeys of arched, green-shuttered windows in yellow wings, and the
// central pavilion with the great arch and its clock, the attic storey of
// paired columns above, and the lattice mast on top. See POST-OFFICE.md.
import * as THREE from 'three';
import {builder, extrude, edge, arch, genericReplacer} from './landmark-kit.js';

export const POST_OFFICE = Object.freeze({
  lon: 106.7000434, lat: 10.7799977, yaw: -0.750873, height: 13.5,
  // The OSM outline in local metres: x along the front, +z out of it
  // (south-west, onto the square). The front block runs the full width; the
  // great hall runs back from its middle.
  outline: [[34.3, 9.9], [18.4, 9.9], [18.4, 1.8], [22.0, 1.8], [22.0, -4.3], [18.5, -4.3], [18.5, -20.8], [22.2, -20.8], [22.2, -32.3], [-21.7, -32.2], [-21.6, -20.7], [-18.5, -20.7], [-18.5, 9.8], [-35.3, 9.8], [-35.3, 25.3], [-9.0, 25.4], [-9.0, 26.4], [-4.0, 26.4], [2.9, 26.4], [8.2, 26.4], [8.2, 25.4], [34.3, 25.4]],
  // What replaceGeneric() clears: the outline and the entrance porch, which
  // OSM maps as a separate building in front of the doors; the model's
  // canopy stands in for it.
  replaces: [[34.3, 9.9], [18.4, 9.9], [18.4, 1.8], [22.0, 1.8], [22.0, -4.3], [18.5, -4.3], [18.5, -20.8], [22.2, -20.8], [22.2, -32.3], [-21.7, -32.2], [-21.6, -20.7], [-18.5, -20.7], [-18.5, 9.8], [-35.3, 9.8], [-35.3, 25.3], [-9.0, 25.4], [-9.0, 26.4], [-4.0, 26.4], [-4.0, 28.6], [2.9, 28.6], [2.9, 26.4], [8.2, 26.4], [8.2, 25.4], [34.3, 25.4]],
});

// Heights from a straight-on photograph, scaled by the pavilion's 17 m width
// in OSM: the plinth, the string course between the storeys, the cornice,
// and the pavilion's attic storey.
const PLINTH = 1.0, STRING = 6.0, CORNICE = 12.4, ATTIC = 17.4;
const FRONT = 25.4, FACE = 26.4, CU = -0.4;             // wing and pavilion planes, pavilion axis

export function createPostOffice({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-post-office';
  const [x, z] = project(POST_OFFICE.lon, POST_OFFICE.lat);
  group.position.set(x, 0, z); group.rotation.y = POST_OFFICE.yaw;
  const materials = {
    facade: new THREE.MeshStandardMaterial({color: '#e8c865', roughness: 0.85}),
    trim: new THREE.MeshStandardMaterial({color: '#f6f2e6', roughness: 0.8}),
    base: new THREE.MeshStandardMaterial({color: '#b98552', roughness: 0.9}),
    shutter: new THREE.MeshStandardMaterial({color: '#2f6a47', roughness: 0.7}),
    glass: new THREE.MeshStandardMaterial({color: '#23302b', roughness: 0.3, metalness: 0.25}),
    roof: new THREE.MeshStandardMaterial({color: '#6b6e70', roughness: 0.7, metalness: 0.25}),
    red: new THREE.MeshStandardMaterial({color: '#c8342b', roughness: 0.6}),
  };
  const {add, box, finish} = builder(materials, 'post-office');
  const outline = POST_OFFICE.outline;

  add('facade', extrude(outline, 0, CORNICE));
  add('roof', extrude(outline, CORNICE, CORNICE + 0.3));

  // Round every wall: brown plinth, the string course with its green band,
  // the frieze's green band, the cornice and a low parapet; two tiers of
  // arched windows everywhere but the front, which is built below.
  outline.forEach((_, i) => {
    const e = edge(outline, i);
    const at = (t, out) => [e.u0 + e.du * t + e.nu * out, e.v0 + e.dv * t + e.nv * out];
    const put = (key, w, h, d, t, out, y) => { const [pu, pv] = at(t, out); box(key, w, h, d, pu, y, pv, e.yaw); };
    put('base', e.len + 0.3, PLINTH, 0.3, e.len / 2, 0.12, PLINTH / 2);
    put('trim', e.len + 0.3, 0.35, 0.4, e.len / 2, 0.15, STRING);
    put('shutter', e.len + 0.2, 0.2, 0.25, e.len / 2, 0.1, STRING - 0.3);
    put('shutter', e.len + 0.2, 0.3, 0.2, e.len / 2, 0.08, CORNICE - 1.5);
    put('trim', e.len + 0.9, 0.5, 1.0, e.len / 2, 0.4, CORNICE - 0.25);
    put('trim', e.len, 0.7, 0.3, e.len / 2, 0.15, CORNICE + 0.35);
    if (e.nv > 0.5 && e.v0 > FRONT - 0.5 || e.len < 3) return;
    const pitch = 2.9, n = Math.floor((e.len - 1) / pitch), start = (e.len - (n - 1) * pitch) / 2;
    for (let k = 0; k < n; k++) {
      const [wu, wv] = at(start + k * pitch, 0.07);
      add('shutter', arch(1.4, 2.3, 0.12), wu, 2.5, wv, 0, e.yaw);
      add('shutter', arch(1.4, 2.6, 0.12), wu, 7.2, wv, 0, e.yaw);
    }
  });

  // The front of the wings: the same windows in white arched surrounds, a
  // balustrade under each upper one, and keystone ornaments over the lower.
  for (const s of [-1, 1]) for (let k = 0; k < 8; k++) {
    const u = s * (11.6 + 2.9 * k);
    if (Math.abs(u) > 34) continue;
    for (const [y, h] of [[2.5, 2.3], [7.2, 2.6]]) {
      add('trim', arch(1.9, h + 0.35, 0.1), u, y - 0.1, FRONT + 0.05);
      add('shutter', arch(1.4, h, 0.12), u, y, FRONT + 0.1);
    }
    box('trim', 1.8, 0.6, 0.25, u, 6.75, FRONT + 0.2);
    box('trim', 0.6, 0.9, 0.3, u - 1.45, 5.2, FRONT + 0.15);                          // console ornaments
    box('facade', 0.5, CORNICE - STRING - 0.5, 0.2, u - 1.45, (CORNICE + STRING) / 2, FRONT + 0.1);  // pilasters,
    box('trim', 0.7, 0.6, 0.3, u - 1.45, CORNICE - 1.9, FRONT + 0.15);                                 // their capitals
  }

  // The pavilion: pilasters, the great arch with its glazed grille and the
  // clock, a canopy over the doors, windows either side, and ornament over
  // the arch.
  for (const du of [-8.2, -5.6, 5.6, 8.2]) box('trim', 0.9, CORNICE - PLINTH, 0.35, CU + du, (CORNICE + PLINTH) / 2, FACE + 0.15);
  for (const du of [-6.9, 6.9]) {
    add('shutter', new THREE.BoxGeometry(1.2, 2.4, 0.12), CU + du, 3.6, FACE + 0.07);
    add('shutter', new THREE.BoxGeometry(1.2, 2.4, 0.12), CU + du, 8.6, FACE + 0.07);
    box('trim', 1.8, 0.5, 0.3, CU + du, 10.1, FACE + 0.15);
  }
  const ring = new THREE.Shape(); ring.absarc(0, 0, 4.0, 0, Math.PI, false); ring.lineTo(-3.2, 0); ring.absarc(0, 0, 3.2, Math.PI, 0, true); ring.lineTo(4.0, 0);
  add('trim', new THREE.ExtrudeGeometry(ring, {depth: 0.5, bevelEnabled: false, curveSegments: 14}), CU, 7.1, FACE);
  for (const s of [-1, 1]) box('trim', 0.8, 7.1 - PLINTH, 0.5, CU + s * 3.6, (7.1 + PLINTH) / 2, FACE + 0.25);
  add('shutter', arch(6.4, 6.4, 0.1), CU, 4.1, FACE + 0.05);                            // the grille
  for (let k = -5; k <= 5; k++) box('trim', 0.06, 5.6, 0.06, CU + k * 0.55, 6.9, FACE + 0.13);
  add('trim', new THREE.CylinderGeometry(0.95, 0.95, 0.12, 20), CU, 6.8, FACE + 0.2, Math.PI / 2);
  box('glass', 0.08, 0.65, 0.05, CU, 7.05, FACE + 0.28);
  box('glass', 0.5, 0.08, 0.05, CU + 0.2, 6.8, FACE + 0.28);
  box('glass', 6.0, 3.1, 0.12, CU, PLINTH + 1.55, FACE + 0.06);                          // the doors
  box('trim', 7.4, 0.35, 2.2, CU, 4.2, FACE + 1.1);                                       // canopy
  box('trim', 2.6, 1.6, 0.4, CU, 11.1, FACE + 0.2);                                       // the mask over the arch
  box('trim', 5.0, 1.0, 0.2, CU, 10.6, FACE + 0.1);
  for (let s = 0; s < 4; s++) box('trim', 12 - s * 0.6, 0.25 * (s + 1), 2.4 - s * 0.6, CU, 0.125 * (s + 1), FACE + (2.4 - s * 0.6) / 2);   // steps

  // The attic storey over the pavilion: eight windows between paired
  // columns, a deep cornice, and the crest with scrolls at its corners.
  const AW = 19, AD = 9, AV = FACE - AD / 2 - 0.3;
  add('facade', new THREE.BoxGeometry(AW - 1.2, ATTIC - CORNICE, AD), CU, (ATTIC + CORNICE) / 2, AV);
  for (let k = 0; k < 8; k++) {
    const du = (k - 3.5) * 2.05;
    add('shutter', new THREE.BoxGeometry(1.2, 2.0, 0.12), CU + du, CORNICE + 2.6, FACE - 0.3 + 0.07);
  }
  for (let k = 0; k <= 8; k++) for (const d of [-0.32, 0.32]) {
    const du = (k - 4) * 2.05 + d;
    add('trim', new THREE.CylinderGeometry(0.16, 0.18, ATTIC - CORNICE - 1.2, 8), CU + du, (ATTIC + CORNICE) / 2 - 0.2, FACE - 0.3 + 0.25);
  }
  box('trim', AW - 0.8, 0.8, 0.5, CU, CORNICE + 0.4, FACE);                               // the base under the columns
  box('trim', AW + 0.6, 0.9, AD + 1.6, CU, ATTIC - 0.45, AV);                              // cornice
  box('shutter', AW - 1.0, 0.25, 0.1, CU, ATTIC - 1.15, FACE - 0.23);
  box('trim', AW, 0.5, AD + 0.6, CU, ATTIC + 0.25, AV);
  for (let k = 0; k < 16; k++) add('trim', new THREE.ConeGeometry(0.22, 0.6, 5), CU + (k - 7.5) * 1.15, ATTIC + 0.8, FACE + 0.3);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    add('trim', new THREE.TorusGeometry(0.45, 0.16, 6, 10, Math.PI * 1.4), CU + su * (AW / 2 - 0.3), ATTIC + 0.9, AV + sv * (AD / 2 + 0.3), 0, Math.PI / 2);
  }

  // The lattice mast on the pavilion, red and white, with the flag.
  const MAST = 12.5, base = ATTIC + 0.5, mv = AV - 1.5;
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const leg = new THREE.CylinderGeometry(0.05, 0.07, MAST, 4);
    leg.rotateZ(-a * 0.045); leg.rotateX(b * 0.045);
    add('trim', leg, CU + a * 0.3, base + MAST / 2, mv + b * 0.3);
  }
  for (let k = 0; k < 8; k++) {
    const y = base + 0.6 + k * 1.5, w = 1.25 - k * 0.12;
    add(k % 2 ? 'trim' : 'red', new THREE.BoxGeometry(w, 0.12, w), CU, y, mv);
  }
  add('red', new THREE.CylinderGeometry(0.04, 0.05, 2.0, 4), CU, base + MAST + 1.0, mv);

  // The great hall behind: its roof rises over the hall's walls.
  const hall = new THREE.Shape([[-18.5, 0], [18.5, 0], [0, 4.5]].map(([a, b]) => new THREE.Vector2(a, b)));
  add('roof', new THREE.ExtrudeGeometry(hall, {depth: 41.5, bevelEnabled: false}), 0, CORNICE + 0.3, -32.0);

  const triangles = finish(group);
  scene.add(group);
  // The flag (flag.js's createFlagSet) flies from the mast above the roof.
  group.updateMatrixWorld(true);
  const flags = [{top: group.localToWorld(new THREE.Vector3(CU, base + 4.2, mv)), length: 1.8}];
  const replaceGeneric = genericReplacer(group, POST_OFFICE.replaces, {flag: 'postOfficeReplaced', top: 60});
  const view = {target: group.localToWorld(new THREE.Vector3(0, 9, 22)), eye: group.localToWorld(new THREE.Vector3(-10, 25, 110))};
  const state = {name: 'Saigon Central Post Office', lon: POST_OFFICE.lon, lat: POST_OFFICE.lat, height: ATTIC + 1.1, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, flags, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
