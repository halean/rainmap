// A schematic exterior model of the Museum of Ho Chi Minh City, the former
// Gia Long Palace (1885-1890), on Lý Tự Trọng. Footprint and heading from the
// OSM outline (way 802105071); the elevations after photographs: pale grey
// walls with a giant order of Corinthian columns through both storeys,
// shuttered windows under awnings, a balustrade with cartouches along the
// cornice, the central pavilion with its pediment, and the curved porte-
// cochère carrying a balcony. See CITY-MUSEUM.md.
import * as THREE from 'three';
import {builder, extrude, edge, arch, genericReplacer} from './landmark-kit.js';

export const CITY_MUSEUM = Object.freeze({
  lon: 106.6996545, lat: 10.7759327, yaw: -0.731808,
  // The OSM outline in local metres. The front faces +x, between two wings;
  // the curved run (5.4, 6.2) ... (5.3, -8.7) is the porte-cochère.
  outline: [[-13.1, -34.5], [-13.5, -6.0], [-16.8, -5.9], [-16.9, 6.2], [-13.6, 6.2], [-14.0, 34.0], [19.9, 33.4], [20.0, 29.7], [20.1, 26.4], [20.3, 21.2], [11.9, 21.1], [11.9, 17.5], [5.4, 17.8], [5.4, 6.2], [9.7, 5.3], [12.0, 3.7], [13.0, 3.0], [13.7, 1.7], [14.1, 0.5], [14.6, -1.5], [14.4, -3.4], [13.4, -5.3], [12.2, -6.8], [11.1, -7.6], [10.0, -8.2], [8.7, -8.8], [5.3, -8.7], [5.0, -18.1], [12.1, -18.5], [12.2, -21.6], [19.6, -21.8], [19.7, -33.8]],
  porch: [13, 26],                 // the outline's corners where the porte-cochère begins and ends
});

// Heights from the photographs' proportions: the plinth, the giant order,
// the entablature, the pavilion and its pediment.
const PLINTH = 1.4, ORDER = 11.0, CORNICE = 13.2, PAVILION = 15.2, PEDIMENT = 18.8, PORCH = 5.6;

export function createCityMuseum({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-city-museum';
  const [x, z] = project(CITY_MUSEUM.lon, CITY_MUSEUM.lat);
  group.position.set(x, 0, z); group.rotation.y = CITY_MUSEUM.yaw;
  const materials = {
    wall: new THREE.MeshStandardMaterial({color: '#d9dde2', roughness: 0.85}),
    trim: new THREE.MeshStandardMaterial({color: '#f2f3f4', roughness: 0.8}),
    shutter: new THREE.MeshStandardMaterial({color: '#8a949e', roughness: 0.7}),
    glass: new THREE.MeshStandardMaterial({color: '#2b2e31', roughness: 0.35, metalness: 0.2}),
    roof: new THREE.MeshStandardMaterial({color: '#8b8d8f', roughness: 0.9}),
  };
  const {add, box, finish} = builder(materials, 'city-museum');
  const outline = CITY_MUSEUM.outline, [p0, p1] = CITY_MUSEUM.porch;
  // The block without the porte-cochère: a straight front across its mouth.
  const block = [...outline.slice(0, p0 + 1), ...outline.slice(p1)];

  add('wall', extrude(block, 0, CORNICE));
  add('roof', extrude(block, CORNICE, CORNICE + 0.3));

  block.forEach((_, i) => {
    const e = edge(block, i);
    const at = (t, out) => [e.u0 + e.du * t + e.nu * out, e.v0 + e.dv * t + e.nv * out];
    const put = (key, w, h, d, t, out, y) => { const [pu, pv] = at(t, out); box(key, w, h, d, pu, y, pv, e.yaw); };
    put('trim', e.len + 0.4, PLINTH, 0.4, e.len / 2, 0.15, PLINTH / 2);                  // plinth
    put('trim', e.len + 0.8, CORNICE - ORDER, 1.0, e.len / 2, 0.45, (CORNICE + ORDER) / 2);   // entablature
    put('trim', e.len + 1.2, 0.35, 1.4, e.len / 2, 0.6, CORNICE - 0.1);
    put('trim', e.len, 1.0, 0.3, e.len / 2, 0.25, CORNICE + 0.8);                        // balustrade
    if (e.len < 4) return;
    const n = Math.round(e.len / 3.6), bay = e.len / n;
    for (let k = 0; k <= n; k++) {
      const [cu, cv] = at(k * bay, 0.55);
      add('trim', new THREE.CylinderGeometry(0.42, 0.46, ORDER - PLINTH - 0.7, 10), cu, (ORDER + PLINTH - 0.7) / 2, cv);
      box('trim', 1.2, 0.8, 1.2, cu, ORDER - 0.3, cv, e.yaw);                            // Corinthian capital
      const [ou, ov] = at(k * bay, 0.3);
      if (k % 2 === 0) add('trim', new THREE.SphereGeometry(0.45, 8, 6), ou, CORNICE + 1.6, ov);           // cartouches
    }
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) * bay;
      put('shutter', 1.3, 2.9, 0.12, t, 0.07, PLINTH + 2.0);
      put('shutter', 1.3, 2.6, 0.12, t, 0.07, 7.6);
      put('trim', 2.0, 0.3, 0.3, t, 0.15, PLINTH + 3.6);
      // The canvas awning over the upper window, sloping out.
      const [au, av] = at(t, 0.55);
      add('shutter', new THREE.BoxGeometry(1.9, 0.08, 1.1), au, 9.4, av, 0, e.yaw, 0);
    }
  });

  // The central pavilion over the entrance, with its pediment and an arched
  // window over the porch.
  const [fu] = outline[p0], mid = (outline[p0][1] + outline[p1][1]) / 2;
  box('wall', 4.2, PAVILION, 15, fu - 2.0, PAVILION / 2, mid);
  box('trim', 5.0, 0.6, 16, fu - 2.0, PAVILION, mid);
  const gable = new THREE.Shape([[-8, 0], [8, 0], [0, PEDIMENT - PAVILION - 0.3]].map(([a, b]) => new THREE.Vector2(a, b)));
  const pediment = new THREE.ExtrudeGeometry(gable, {depth: 4.2, bevelEnabled: false}); pediment.rotateY(Math.PI / 2);
  add('wall', pediment, fu - 4.1, PAVILION + 0.3, mid);
  add('trim', new THREE.SphereGeometry(0.8, 8, 6), fu + 0.15, PAVILION + 1.4, mid);        // the head in the tympanum
  add('glass', arch(2.8, 3.8, 0.12), fu + 0.08, PORCH + 1.2, mid, 0, Math.PI / 2);
  add('trim', arch(3.6, 4.3, 0.1), fu + 0.04, PORCH + 1.0, mid, 0, Math.PI / 2);

  // The porte-cochère: columns round the curve, the flat roof, and the
  // balcony with its balustrade on top.
  const curve = outline.slice(p0, p1 + 1);
  const shape = new THREE.Shape(curve.map(([u, v]) => new THREE.Vector2(u, -v)));
  const slab = new THREE.ExtrudeGeometry(shape, {depth: 0.7, bevelEnabled: false}); slab.rotateX(-Math.PI / 2); slab.translate(0, PORCH, 0);
  add('trim', slab);
  for (let i = 1; i < curve.length - 1; i += 2) {
    const [u, v] = curve[i];
    add('trim', new THREE.CylinderGeometry(0.3, 0.34, PORCH - 1.0, 10), u - 0.4, PORCH / 2 + 0.5, v);
  }
  for (let i = 0; i < curve.length - 1; i++) {
    const [u0, v0] = curve[i], [u1, v1] = curve[i + 1], len = Math.hypot(u1 - u0, v1 - v0);
    box('trim', len + 0.1, 1.0, 0.25, (u0 + u1) / 2, PORCH + 1.2, (v0 + v1) / 2, Math.atan2(-(v1 - v0), u1 - u0));
  }
  box('glass', 0.2, 3.2, 3.0, fu + 0.05, PLINTH + 1.6, mid);                               // the doors
  for (let s = 0; s < 3; s++) box('trim', 2.0 - s * 0.5, 0.45 * (s + 1), 7, fu + 9 + (2.0 - s * 0.5) / 2, 0.225 * (s + 1), mid);

  // The flag on the pediment.
  add('trim', new THREE.CylinderGeometry(0.05, 0.07, 6, 5), fu - 1.5, PEDIMENT + 3, mid);

  const triangles = finish(group);
  scene.add(group);
  group.updateMatrixWorld(true);
  const flags = [{top: group.localToWorld(new THREE.Vector3(fu - 1.5, PEDIMENT + 6, mid)), length: 1.8}];
  const replaceGeneric = genericReplacer(group, outline, {flag: 'cityMuseumReplaced', top: 40});
  const view = {target: group.localToWorld(new THREE.Vector3(5, 8, 0)), eye: group.localToWorld(new THREE.Vector3(75, 25, 40))};
  const state = {name: 'Museum of Ho Chi Minh City (Gia Long Palace)', lon: CITY_MUSEUM.lon, lat: CITY_MUSEUM.lat, height: PEDIMENT, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, flags, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
