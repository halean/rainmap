// A schematic exterior model of the Hotel Continental Saigon (1880), on the
// corner of Đồng Khởi and Lam Sơn square, across from the Opera House.
// Footprint from the OSM multipolygon (relation 2204742: the block and its
// courtyard); the street fronts after photographs: shopfronts under a canopy
// with HOTEL CONTINENTAL SAIGON over it, two floors of tall arched windows
// with balconies between pilasters, and the top floor's continuous balcony
// under the cornice. See CONTINENTAL.md.
import * as THREE from 'three';
import {builder, edge, arch, letters, facing, genericReplacer} from './landmark-kit.js';

export const CONTINENTAL = Object.freeze({
  lon: 106.7025417, lat: 10.7770036, yaw: -0.737264,
  // The block and its courtyard in local metres; +x faces the Opera House
  // across Lam Sơn square, -z the other street front.
  outline: [[-20.5, 29.3], [30.2, 29.2], [31.2, -44.0], [-20.3, -43.8]],
  courtyard: [[1.8, -32.2], [-13.0, -32.0], [-12.6, -4.5], [2.2, -4.7]],
  frontage: [1, 2],                // the edges on the streets
});

// Heights from the photographs' proportions: the shop floor and its canopy,
// three hotel floors, and the cornice.
const GROUND = 5.0, FLOOR = 4.0, CORNICE = GROUND + 3 * FLOOR;     // 17 m

export function createContinental({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-continental';
  const [x, z] = project(CONTINENTAL.lon, CONTINENTAL.lat);
  group.position.set(x, 0, z); group.rotation.y = CONTINENTAL.yaw;
  const materials = {
    facade: new THREE.MeshStandardMaterial({color: '#f3e8cb', roughness: 0.85}),
    trim: new THREE.MeshStandardMaterial({color: '#fbf8f0', roughness: 0.8}),
    glass: new THREE.MeshStandardMaterial({color: '#2e2b27', roughness: 0.35, metalness: 0.2}),
    roof: new THREE.MeshStandardMaterial({color: '#8e8a82', roughness: 0.9}),
    gold: new THREE.MeshStandardMaterial({color: '#c9a045', emissive: '#4a3508', emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.35}),
  };
  const {add, box, finish} = builder(materials, 'continental');
  const outline = CONTINENTAL.outline;

  // The block round its courtyard.
  const shape = new THREE.Shape(outline.map(([u, v]) => new THREE.Vector2(u, -v)));
  shape.holes.push(new THREE.Path(CONTINENTAL.courtyard.map(([u, v]) => new THREE.Vector2(u, -v))));
  const body = new THREE.ExtrudeGeometry(shape, {depth: CORNICE, bevelEnabled: false}); body.rotateX(-Math.PI / 2);
  add('facade', body);
  const roof = new THREE.ExtrudeGeometry(shape, {depth: 0.4, bevelEnabled: false}); roof.rotateX(-Math.PI / 2); roof.translate(0, CORNICE, 0);
  add('roof', roof);

  outline.forEach((_, i) => {
    const e = edge(outline, i), front = CONTINENTAL.frontage.includes(i);
    const at = (t, out) => [e.u0 + e.du * t + e.nu * out, e.v0 + e.dv * t + e.nv * out];
    const put = (key, w, h, d, t, out, y) => { const [pu, pv] = at(t, out); box(key, w, h, d, pu, y, pv, e.yaw); };
    put('trim', e.len + 1.0, 0.8, 1.2, e.len / 2, 0.4, CORNICE - 0.3);                 // cornice
    put('trim', e.len, 0.9, 0.3, e.len / 2, 0.1, CORNICE + 0.85);                       // parapet
    const bays = Math.round(e.len / 4.0), bw = e.len / bays;
    if (!front) {
      for (let k = 0; k < bays; k++) for (let f = 0; f < 4; f++) put('glass', 1.3, 2.0, 0.12, (k + 0.5) * bw, 0.06, f ? GROUND + (f - 1) * FLOOR + 2.0 : 2.0);
      return;
    }
    // Shopfronts, and the canopy over them.
    put('glass', e.len - 1.0, GROUND - 1.4, 0.14, e.len / 2, 0.08, (GROUND - 1.4) / 2 + 0.3);
    for (let k = 0; k <= bays; k++) put('facade', 0.9, GROUND - 0.4, 0.3, k * bw, 0.15, (GROUND - 0.4) / 2);
    put('trim', e.len + 0.6, 0.4, 2.4, e.len / 2, 1.2, GROUND - 0.2);
    put('trim', e.len + 0.6, 0.9, 0.2, e.len / 2, 2.35, GROUND + 0.25);                // the canopy's fascia
    // Tall arched French windows; balconies on the first floor in every bay
    // and on the second in every other; the top floor's continuous balcony.
    for (let k = 0; k < bays; k++) {
      const t = (k + 0.5) * bw;
      for (let f = 0; f < 3; f++) {
        const y = GROUND + f * FLOOR + 0.6, [wu, wv] = at(t, 0.07), [su, sv] = at(t, 0.04);
        add('trim', arch(1.9, 3.1, 0.1), su, y - 0.1, sv, 0, e.yaw);
        add('glass', arch(1.4, 2.8, 0.12), wu, y, wv, 0, e.yaw);
        if (f === 0 || (f === 1 && k % 2 === 0)) {
          put('trim', 2.4, 0.25, 0.9, t, 0.45, y - 0.1);
          put('trim', 2.4, 0.9, 0.12, t, 0.85, y + 0.4);
        }
      }
      if (k > 0 && k % 3 === 0) put('trim', 0.9, 2 * FLOOR, 0.35, k * bw, 0.18, GROUND + FLOOR);   // pilasters
    }
    const top = GROUND + 2 * FLOOR;
    put('trim', e.len + 0.4, 0.3, 1.5, e.len / 2, 0.75, top + 0.35);
    put('trim', e.len + 0.4, 1.0, 0.12, e.len / 2, 1.45, top + 1.0);
    put('trim', e.len + 0.2, 0.3, 0.3, e.len / 2, 0.15, top - 0.2);
    // The name on the fascia.
    const [lu, lv] = at(e.len / 2, 2.5);
    add('gold', letters('HOTEL CONTINENTAL SAIGON', {h: 0.62, w: 0.5, gap: 0.2, stroke: 0.12}), lu, GROUND + 0.02, lv, 0, facing(e.nu, e.nv));
  });

  const triangles = finish(group);
  scene.add(group);
  const replaceGeneric = genericReplacer(group, outline, {flag: 'continentalReplaced', top: 40});
  const view = {target: group.localToWorld(new THREE.Vector3(31, 9, -44)), eye: group.localToWorld(new THREE.Vector3(90, 20, -100))};
  const state = {name: 'Hotel Continental Saigon', lon: CONTINENTAL.lon, lat: CONTINENTAL.lat, height: CORNICE + 1.3, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
