// A schematic exterior model of the Saigon Opera House (Nhà hát Thành phố,
// 1898-1900) on Lam Sơn square, facing down Lê Lợi. Footprint and heading from
// the OSM outline (way 801710792, height 26 m); the front after photographs of
// it: the great arch over a mosaic tympanum, three windows and the caryatids'
// balcony, paired columns, arched windows in the wings, slate mansard roofs,
// and the angels on top. See OPERA-HOUSE.md.
import * as THREE from 'three';
import {builder, extrude, edge, arch, genericReplacer} from './landmark-kit.js';

export const OPERA = Object.freeze({
  lon: 106.7032105, lat: 10.7767024, yaw: -0.737578, height: 26,
  // The OSM outline in local metres: x across the facade, +z towards the
  // square (south-west, down Lê Lợi).
  outline: [[-16.2, 19.8], [-16.2, 29.7], [-9.7, 29.7], [-9.7, 32.0], [-6.3, 32.0], [-6.3, 32.7], [-0.3, 32.7], [6.1, 32.7], [6.1, 32.0], [9.3, 32.0], [9.3, 29.8], [16.2, 29.8], [16.2, 27.4], [16.2, -32.3], [6.8, -32.3], [6.8, -29.9], [-6.3, -29.9], [-6.3, -32.4], [-16.2, -32.4], [-16.2, -16.2], [-16.2, -13.7]],
});

// Heights read off a straight-on photograph of the front, scaled by its 32 m
// width: the terrace the doors open onto, the band over the tan base, the
// first floor, the springing of the great arch, and the eaves.
const TERRACE = 2.2, BASE = 4.6, FLOOR1 = 7.8, SPRING = 13.3, EAVES = 14.0;
const FACE = 32.7, CU = -0.1;                 // the centre bay's plane and axis

export function createOperaHouse({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-opera-house';
  const [x, z] = project(OPERA.lon, OPERA.lat);
  group.position.set(x, 0, z); group.rotation.y = OPERA.yaw;
  const materials = {
    facade: new THREE.MeshStandardMaterial({color: '#f0e8d6', roughness: 0.85}),
    tan: new THREE.MeshStandardMaterial({color: '#d8c19c', roughness: 0.9}),
    trim: new THREE.MeshStandardMaterial({color: '#fbf8f1', roughness: 0.8}),
    glass: new THREE.MeshStandardMaterial({color: '#2a2622', roughness: 0.35, metalness: 0.2}),
    roof: new THREE.MeshStandardMaterial({color: '#41464e', roughness: 0.75, metalness: 0.15}),
    statue: new THREE.MeshStandardMaterial({color: '#eeebe3', roughness: 0.7}),
    mosaic: new THREE.MeshStandardMaterial({color: '#8b9a8a', emissive: '#3a3218', emissiveIntensity: 0.25, roughness: 0.6}),
    gold: new THREE.MeshStandardMaterial({color: '#d4a93e', emissive: '#5a400c', emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.35}),
  };
  const {add, box, finish} = builder(materials, 'opera');
  const outline = OPERA.outline;

  add('facade', extrude(outline, 0, EAVES));

  outline.forEach((_, i) => {
    const e = edge(outline, i), front = e.nv > 0.5;
    const at = (t, out) => [e.u0 + e.du * t + e.nu * out, e.v0 + e.dv * t + e.nv * out];
    const [mu, mv] = at(e.len / 2, 0.35);
    box('trim', e.len + 0.7, 0.7, 1.0, mu, EAVES - 0.35, mv, e.yaw);                  // entablature
    if (front) {
      // The front's wings: a tan base, a white band over it, and a
      // balustrade along the top.
      const centre = Math.abs(e.v0 - FACE) < 0.05 && Math.abs(e.dv) < 0.01;
      const [bu, bv] = at(e.len / 2, 0.08);
      box('tan', e.len + 0.16, centre ? TERRACE : BASE, 0.16, bu, (centre ? TERRACE : BASE) / 2, bv, e.yaw);
      if (centre) return;
      const [su, sv] = at(e.len / 2, 0.25);
      box('trim', e.len + 0.5, 0.45, 0.5, su, BASE, sv, e.yaw);
      const [lu, lv] = at(e.len / 2, 0.2);
      box('trim', e.len + 0.4, 1.0, 0.35, lu, EAVES + 0.5, lv, e.yaw);
      return;
    }
    box('trim', e.len + 0.3, 0.35, 0.5, mu, FLOOR1, mv, e.yaw);                          // string course
    if (e.len < 4) return;
    // Sides and back: two tiers of arched windows.
    const pitch = 4.6, n = Math.floor(e.len / pitch), start = (e.len - (n - 1) * pitch) / 2;
    for (let k = 0; k < n; k++) {
      const [wu, wv] = at(start + k * pitch, 0.06);
      add('glass', arch(1.9, 3.4, 0.12), wu, 3.0, wv, 0, e.yaw);
      add('glass', arch(1.9, 4.0, 0.12), wu, FLOOR1 + 0.6, wv, 0, e.yaw);
    }
  });

  // Wings: pilasters with tan strips beside them, a tall arched window in a white surround, and relief
  // panels on the returns beside the centre.
  for (const s of [-1, 1]) {
    for (const [u, v] of [[15.75, 29.75], [10.0, 29.75], [9.0, 32.0]]) box('trim', 0.9, SPRING - BASE, 0.3, s * u, (SPRING + BASE) / 2, v + 0.15);
    for (const u of [10.95, 14.75]) box('tan', 0.9, SPRING - BASE, 0.08, s * u, (SPRING + BASE) / 2, 29.78);   // recessed strips beside the pilasters
    const wu = s * 12.9;
    add('trim', arch(3.4, 5.5, 0.16), wu, 5.9, 29.9);
    add('glass', arch(2.6, 4.9, 0.12), wu, 6.2, 30.0);
    box('trim', 3.2, 0.25, 0.6, wu, 6.0, 30.05);
    box('trim', 1.7, 3.2, 0.2, s * 7.7, 9.8, 32.1);
    box('trim', 1.7, 2.0, 0.2, s * 7.7, 6.2, 32.1);
    box('trim', 3.4, 1.0, 0.35, s * 7.9, EAVES + 0.5, 32.2);                             // balustrade on the returns
  }

  // Steps up from the square to the terrace, widening as they come down.
  for (let s = 0; s < 8; s++) {
    const h = TERRACE * (s + 1) / 8, depth = 6.0 - s * 0.68, width = 23 - s * 1.85;
    box('tan', width, h, depth, CU, h / 2, FACE + depth / 2);
  }

  // The centre: piers and paired columns carrying the great arch.
  for (const s of [-1, 1]) {
    box('trim', 2.3, SPRING - TERRACE, 0.35, CU + s * 5.15, (SPRING + TERRACE) / 2, FACE + 0.17);
    for (const u of [4.4, 5.9]) {
      const cu = CU + s * u;
      box('trim', 1.0, 2.6, 1.0, cu, TERRACE + 1.3, FACE + 0.8);
      add('trim', new THREE.CylinderGeometry(0.36, 0.4, 7.8, 10), cu, 8.7, FACE + 0.8);
      box('trim', 1.0, 0.5, 1.0, cu, 12.85, FACE + 0.8);
    }
    box('trim', 2.9, 0.8, 1.3, CU + s * 5.15, SPRING + 0.1, FACE + 0.75);
  }
  const ring = new THREE.Shape(); ring.absarc(0, 0, 6.3, 0, Math.PI, false); ring.lineTo(-4.0, 0); ring.absarc(0, 0, 4.0, Math.PI, 0, true); ring.lineTo(6.3, 0);
  add('trim', new THREE.ExtrudeGeometry(ring, {depth: 1.0, bevelEnabled: false, curveSegments: 16}), CU, SPRING, FACE);
  const disc = r => { const d = new THREE.Shape(); d.absarc(0, 0, r, 0, Math.PI, false); d.lineTo(-r, 0); return d; };
  add('facade', new THREE.ExtrudeGeometry(disc(6.3), {depth: 1.4, bevelEnabled: false, curveSegments: 16}), CU, SPRING, FACE - 1.4);   // the wall the arch stands against
  add('mosaic', new THREE.ExtrudeGeometry(disc(3.95), {depth: 0.08, bevelEnabled: false, curveSegments: 16}), CU, SPRING, FACE);         // the tympanum
  const fan = new THREE.Shape(); fan.absarc(0, 0, 2.3, 0, Math.PI, false); fan.lineTo(-1.8, 0); fan.absarc(0, 0, 1.8, Math.PI, 0, true); fan.lineTo(2.3, 0);
  add('trim', new THREE.ExtrudeGeometry(fan, {depth: 0.2, bevelEnabled: false, curveSegments: 10}), CU, SPRING - 0.2, FACE);
  box('trim', 8.0, 0.4, 0.3, CU, SPRING - 0.2, FACE + 0.15);
  // Three arched windows on the first floor over the balcony.
  for (const du of [-2.5, 0, 2.5]) add('glass', arch(1.9, 3.6, 0.12), CU + du, FLOOR1 + 1.0, FACE + 0.06);
  box('trim', 8.4, 0.3, 1.5, CU, FLOOR1 - 0.05, FACE + 0.75);
  box('trim', 8.4, 1.0, 0.2, CU, FLOOR1 + 0.6, FACE + 1.4);
  // The doors under the balcony, and the two caryatids between them carrying it.
  for (const [du, w] of [[-2.9, 1.8], [0.1, 2.4], [3.1, 1.8]]) box('glass', w, 4.4, 0.12, CU + du, TERRACE + 2.2, FACE + 0.06);
  for (const s of [-1, 1]) {
    const u = CU + s * 1.6, v = FACE + 0.9;
    box('trim', 1.0, 1.2, 1.0, u, TERRACE + 0.6, v);
    add('statue', new THREE.CylinderGeometry(0.34, 0.46, 3.2, 8), u, TERRACE + 2.8, v);
    add('statue', new THREE.SphereGeometry(0.3, 8, 6), u, TERRACE + 4.65, v);
    box('statue', 1.0, 0.4, 1.0, u, FLOOR1 - 0.4, v);
  }
  // On top of the arch: two angels either side of a cartouche and lyre.
  const crown = SPRING + 6.3;
  box('statue', 1.6, 2.0, 0.8, CU, crown + 0.7, FACE + 0.5);
  for (const s of [-1, 1]) {
    const u = CU + s * 1.4;
    add('statue', new THREE.CylinderGeometry(0.28, 0.45, 1.8, 8), u, crown + 0.6, FACE + 0.5);
    add('statue', new THREE.SphereGeometry(0.27, 8, 6), u, crown + 1.7, FACE + 0.5);
    add('statue', new THREE.BoxGeometry(0.25, 1.3, 0.7), u + s * 0.6, crown + 1.9, FACE + 0.4, 0, 0, -s * 0.7);
  }
  add('gold', new THREE.TorusGeometry(0.5, 0.08, 6, 12, Math.PI), CU, crown + 1.9, FACE + 0.55);
  add('gold', new THREE.ConeGeometry(0.12, 1.6, 6), CU, crown + 2.6, FACE + 0.5);

  // Slate mansards: one behind the centre, a lower one over each wing with
  // an oeil-de-boeuf dormer, and the tall roof over auditorium and stage.
  const mansard = (points, depth) => new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([a, b]) => new THREE.Vector2(a, b))), {depth, bevelEnabled: false});
  const front = mansard([[-30.8, 0], [-14.3, 0], [-16.3, 5.3], [-28.8, 5.3]], 19);
  front.rotateY(Math.PI / 2);                                    // shape x -> -z, extruded along +x
  add('roof', front, -9.6, EAVES, 0);
  for (const s of [-1, 1]) {
    const u = s * 12.95, pavilion = new THREE.CylinderGeometry(Math.SQRT1_2 * 0.55, Math.SQRT1_2, 3.8, 4, 1);
    pavilion.rotateY(Math.PI / 4); pavilion.scale(6.1, 1, 8.2);
    add('roof', pavilion, u, EAVES + 1.9, 25.3);
    box('roof', 1.4, 1.4, 0.8, u, 16.2, 28.6);
    add('trim', new THREE.TorusGeometry(0.5, 0.1, 6, 14), u, 16.2, 29.02);
    add('glass', new THREE.CircleGeometry(0.42, 12), u, 16.2, 29.03);
  }
  const auditorium = mansard([[-16.2, 0], [16.2, 0], [12, 8], [0, 12], [-12, 8]], 44.3);
  add('roof', auditorium, 0, EAVES, -30.0);

  const triangles = finish(group);
  scene.add(group);
  const replaceGeneric = genericReplacer(group, outline, {flag: 'operaReplaced', top: OPERA.height + 20});
  const view = {target: group.localToWorld(new THREE.Vector3(0, 11, 28)), eye: group.localToWorld(new THREE.Vector3(-15, 30, 110))};
  const state = {name: 'Saigon Opera House', lon: OPERA.lon, lat: OPERA.lat, height: OPERA.height, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
