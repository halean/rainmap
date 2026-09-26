// A schematic exterior model of the Hotel Majestic Saigon (1925), on the
// corner of Đồng Khởi and Tôn Đức Thắng. Footprint and heading from the OSM
// outline (way 193142038); the elevations after photographs: an arcade of
// round arches under a canopy, a mezzanine, four floors of paired windows
// with iron balconies, a set-back top floor, the rooftop bar's colonnade on
// the river side, and MAJESTIC over the corner. See MAJESTIC.md.
import * as THREE from 'three';
import {builder, extrude, edge, arch, insideOutline, insetOutline, letters, facing, genericReplacer} from './landmark-kit.js';

export const MAJESTIC = Object.freeze({
  lon: 106.7059578, lat: 10.7729065, yaw: -0.645192,
  osmHeight: 35,
  // The OSM outline in local metres (x along the Đồng Khởi frontage).
  outline: [[-54.1, -33.7], [0.1, -29.2], [11.2, -27.6], [20.1, -25.5], [24.3, -24.3], [27.6, -21.2], [31.9, -16.4], [55.9, 21.8], [36.7, 33.7], [25.4, 16.2], [21.2, 18.6], [13.8, 6.6], [11.7, 4.2], [9.3, 2.5], [4.0, 1.1], [2.7, 11.3], [-4.8, 10.7], [-9.9, 10.3], [-7.8, -11.4], [-55.9, -16.5]],
  // Edges facing the streets: Đồng Khởi (0-3), the rounded corner (3-5) and
  // Tôn Đức Thắng along the river (6).
  frontage: [0, 1, 2, 3, 4, 5, 6],
  corner: [3, 4, 5],
  river: 6,
});

// Heights from the photographs' proportions: the arcade and its canopy, the
// mezzanine, four floors, the main cornice, and the set-back top floor.
const GROUND = 6.0, MEZZ = 3.0, FLOOR = 3.6, FLOORS = 4;
const CORNICE = GROUND + MEZZ + FLOORS * FLOOR;          // 23.4 m
const TOP = CORNICE + 3.4;                               // 26.8 m

export function createMajestic({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-majestic';
  const [x, z] = project(MAJESTIC.lon, MAJESTIC.lat);
  group.position.set(x, 0, z); group.rotation.y = MAJESTIC.yaw;
  const materials = {
    facade: new THREE.MeshStandardMaterial({color: '#f2e7c6', roughness: 0.9}),
    trim: new THREE.MeshStandardMaterial({color: '#faf6ea', roughness: 0.85}),
    glass: new THREE.MeshStandardMaterial({color: '#3a3934', roughness: 0.35, metalness: 0.2}),
    // Railings are open ironwork: drawn as a see-through panel.
    iron: new THREE.MeshStandardMaterial({color: '#2a2a28', roughness: 0.6, metalness: 0.4, transparent: true, opacity: 0.55, depthWrite: false}),
    roof: new THREE.MeshStandardMaterial({color: '#8f8a80', roughness: 0.95}),
    gold: new THREE.MeshStandardMaterial({color: '#c9a045', emissive: '#4a3508', emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.35}),
  };
  const {add, box, finish} = builder(materials, 'majestic');
  const outline = MAJESTIC.outline;

  // The body to the main cornice; the top floor set back 2 m from the
  // streets, and 6 m on the river side, where the rooftop bar's colonnade is.
  const offsets = outline.map((_, i) => i === MAJESTIC.river ? 6 : MAJESTIC.frontage.includes(i) ? 2 : 0);
  const upper = insetOutline(outline, offsets);
  add('facade', extrude(outline, 0, CORNICE));
  add('facade', extrude(upper, CORNICE, TOP));
  add('roof', extrude(upper, TOP, TOP + 0.4));

  outline.forEach((_, i) => {
    const e = edge(outline, i), front = MAJESTIC.frontage.includes(i), corner = MAJESTIC.corner.includes(i);
    const at = (t, out) => [e.u0 + e.du * t + e.nu * out, e.v0 + e.dv * t + e.nv * out];
    const put = (key, w, h, d, t, out, y) => { const [pu, pv] = at(t, out); box(key, w, h, d, pu, y, pv, e.yaw); };
    put('trim', e.len + 0.8, 0.8, 1.2, e.len / 2, 0.4, CORNICE - 0.4);                // main cornice
    if (!front) {
      // The back: plain windows.
      const pitch = 5.6, n = Math.floor(e.len / pitch);
      if (n < 1) return;
      const start = (e.len - (n - 1) * pitch) / 2;
      for (let k = 0; k < n; k++) for (let f = 0; f <= FLOORS; f++)
        put('glass', 1.3, 1.8, 0.12, start + k * pitch, 0.06, GROUND + (f ? MEZZ + (f - 1) * FLOOR : 0) + 1.4);
      return;
    }
    put('trim', e.len + 0.3, 0.35, 2.6, e.len / 2, 1.3, GROUND - 0.4);                // the canopy over the arcade
    for (let f = 0; f <= FLOORS; f++) put('trim', e.len + 0.2, 0.22, 0.25, e.len / 2, 0.12, GROUND + MEZZ + f * FLOOR - 0.1);
    put('trim', e.len, 0.9, 0.3, e.len / 2, 0.2, CORNICE + 0.45);                      // balustrade on the cornice
    // Arches at street level.
    const pitch = 4.2, n = Math.floor(e.len / pitch);
    if (n >= 1) {
      const start = (e.len - (n - 1) * pitch) / 2;
      for (let k = 0; k < n; k++) {
        const [gu, gv] = at(start + k * pitch, 0.08), [su, sv] = at(start + k * pitch, 0.04);
        add('trim', arch(3.7, 4.9, 0.1), su, 0, sv, 0, e.yaw);
        add('glass', arch(3.0, 4.4, 0.12), gu, 0, gv, 0, e.yaw);
      }
    }
    // Above: windows in pairs, bays of two between pilasters; each bay's
    // pair shares a balcony with an iron railing, except round the corner.
    const bays = Math.max(1, Math.round(e.len / 5.6)), bw = e.len / bays;
    for (let b = 0; b < bays; b++) {
      const t0 = (b + 0.5) * bw;
      for (const s of [-1, 1]) {
        put('glass', 1.1, 1.3, 0.12, t0 + s * bw * 0.22, 0.07, GROUND + 1.2);          // mezzanine
        for (let f = 0; f < FLOORS; f++) put('glass', 1.3, 2.3, 0.12, t0 + s * bw * 0.22, 0.07, GROUND + MEZZ + f * FLOOR + 1.45);
      }
      for (let f = 0; f < FLOORS; f++) {
        const y = GROUND + MEZZ + f * FLOOR + 0.25;
        if (corner) { put('gold', 1.0, 0.5, 0.12, t0, 0.12, y + 2.9); continue; }       // ornament between the windows
        put('trim', bw * 0.82, 0.22, 1.0, t0, 0.5, y);                                   // balcony
        put('iron', bw * 0.82, 1.0, 0.05, t0, 0.95, y + 0.6);                            // its railing
      }
      if (b > 0) {
        put('trim', 0.6, CORNICE - GROUND - 0.8, 0.3, b * bw, 0.18, (CORNICE + GROUND - 0.8) / 2);   // pilaster
        put('gold', 0.5, 0.4, 0.1, b * bw, 0.36, CORNICE - 1.4);                                       // its capital
      }
    }
  });

  // The set-back top floor's windows, facing Đồng Khởi and the corner.
  upper.forEach((_, i) => {
    if (!MAJESTIC.frontage.includes(i) || i === MAJESTIC.river) return;
    const e = edge(upper, i), pitch = 3.2, n = Math.floor(e.len / pitch);
    if (n < 1) return;
    const start = (e.len - (n - 1) * pitch) / 2;
    for (let k = 0; k < n; k++) box('glass', 1.7, 1.8, 0.12, e.u0 + e.du * (start + k * pitch) + e.nu * 0.07, CORNICE + 1.8, e.v0 + e.dv * (start + k * pitch) + e.nv * 0.07, e.yaw);
  });

  // The rooftop bar on the river side: a white colonnade under a pergola.
  {
    const e = edge(outline, MAJESTIC.river);
    const at = (t, out) => [e.u0 + e.du * t + e.nu * out, e.v0 + e.dv * t + e.nv * out];
    for (let t = 3; t < e.len - 1; t += 3.6) {
      const [cu, cv] = at(t, -1.0);
      if (insideOutline([cu, cv], outline)) box('trim', 0.45, TOP - CORNICE, 0.45, cu, (TOP + CORNICE) / 2, cv, e.yaw);
    }
    const [bu, bv] = at(e.len / 2, -1.0), [pu, pv] = at(e.len / 2, -3.2);
    box('trim', e.len - 4, 0.5, 0.6, bu, TOP - 0.25, bv, e.yaw);
    box('roof', e.len - 4, 0.15, 4.2, pu, TOP - 0.1, pv, e.yaw);
  }

  // Over the corner: a raised attic with MAJESTIC in gold on it, and HOTEL
  // MAJESTIC on a curved pediment over the entrance canopy.
  {
    const e = edge(outline, 4), yaw = facing(e.nu, e.nv);
    const mid = [e.u0 + e.du * e.len / 2, e.v0 + e.dv * e.len / 2];
    const place = (key, geometry, back, y) => add(key, geometry, mid[0] - e.nu * back, y, mid[1] - e.nv * back, 0, yaw);
    place('facade', new THREE.BoxGeometry(12, 1.8, 1.2), 2.6, TOP + 0.9);
    place('gold', letters('MAJESTIC', {h: 1.8, stroke: 0.3}), 2.6, TOP + 1.8);
    const pediment = new THREE.Shape(); pediment.absellipse(0, 0, 4.5, 2.2, 0, Math.PI, false);
    place('trim', new THREE.ExtrudeGeometry(pediment, {depth: 0.5, bevelEnabled: false, curveSegments: 10}), -2.1, GROUND - 0.2);
    place('gold', letters('HOTEL', {h: 0.45, stroke: 0.09}), -2.65, GROUND + 1.25);
    place('gold', letters('MAJESTIC', {h: 0.6, stroke: 0.11}), -2.65, GROUND + 0.35);
  }

  const triangles = finish(group);
  scene.add(group);
  const bounds = new THREE.Box3().setFromObject(group);
  const replaceGeneric = genericReplacer(group, outline, {flag: 'majesticReplaced', top: MAJESTIC.osmHeight + 20});
  const view = {target: group.localToWorld(new THREE.Vector3(25, 14, -20)), eye: group.localToWorld(new THREE.Vector3(95, 45, -140))};
  const state = {name: 'Hotel Majestic Saigon', lon: MAJESTIC.lon, lat: MAJESTIC.lat, height: +bounds.max.y.toFixed(2), triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
