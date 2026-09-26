// The Hotel Majestic Saigon (1925), on the corner of Đồng Khởi and Tôn Đức
// Thắng facing the river, modelled after photographs of its floodlit front.
// Footprint and heading from the OSM outline (way 193142038), its corner
// drawn as the smooth curve it is. The facade runs unbroken along Đồng
// Khởi, round the corner and along the river:
//  - an arcade of tall round arches between rusticated piers, keystones on
//    the arches, glowing gold inside at night, under a moulded cornice;
//  - a mezzanine of square windows, with a lantern on each pier;
//  - four floors of French windows in pairs, in moulded surrounds with
//    alternating pediments and cartouches, each pair on a balcony carried on
//    consoles, behind a wrought-iron railing of real balusters;
//  - pilasters with gilded capitals between the bays;
//  - the main cornice with dentils, a balustrade, the set-back top floor;
//  - over the corner, a curved attic crowned with MAJESTIC in gold, and
//    HOTEL MAJESTIC over the corner entrance; two flags above it;
//  - on the river side, the rooftop bar's colonnade and pergola.
// At night the cream stucco is floodlit, the arcade and windows glow warm
// and the lettering is lit (setNight, from the sky's night level).
// See MAJESTIC.md.
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

// Heights, from the photographs' proportions: a tall arcade, the mezzanine,
// four floors of balconies, the main cornice, the set-back top floor, and
// the corner's attic with its lettering (which OSM's 35 m roughly meets).
const ARCADE = 6.5, MEZZ = 3.2, FLOOR = 3.6, FLOORS = 4;
const MAIN = ARCADE + MEZZ;                              // 9.7 m: the first balcony floor
const CORNICE = MAIN + FLOORS * FLOOR;                   // 24.1 m
const TOP = CORNICE + 3.5;                               // 27.6 m
const ATTIC = TOP + 3.4;                                 // 31.0 m: the corner's crown
const BAY = 4.4;                                         // a bay: one arch below, a pair of windows above

/** The corner as a curve: a quadratic from outline[3] to outline[6], tangent to both streets. */
function cornerCurve(o, n = 14) {
  const a = o[3], b = o[6], ta = [a[0] - o[2][0], a[1] - o[2][1]], tb = [o[7][0] - b[0], o[7][1] - b[1]];
  // Where the two streets' lines meet: the control point.
  const det = ta[0] * -tb[1] - ta[1] * -tb[0], s = ((b[0] - a[0]) * -tb[1] - (b[1] - a[1]) * -tb[0]) / det;
  const c = [a[0] + ta[0] * s, a[1] + ta[1] * s];
  return Array.from({length: n + 1}, (_, k) => { const t = k / n, m = 1 - t; return [m * m * a[0] + 2 * m * t * c[0] + t * t * b[0], m * m * a[1] + 2 * m * t * c[1] + t * t * b[1]]; });
}

/** A frontage as a polyline, walked by distance: position, direction, outward normal, yaw. */
function run(points, body) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const len = cum[cum.length - 1];
  function at(t) {
    t = Math.max(0, Math.min(len, t));
    let i = 1; while (i < points.length - 1 && cum[i] < t) i++;
    const [u0, v0] = points[i - 1], [u1, v1] = points[i], l = cum[i] - cum[i - 1] || 1, f = (t - cum[i - 1]) / l;
    const du = (u1 - u0) / l, dv = (v1 - v0) / l;
    let nu = dv, nv = -du;
    if (insideOutline([u0 + (u1 - u0) * f + nu * 0.3, v0 + (v1 - v0) * f + nv * 0.3], body)) { nu = -nu; nv = -nv; }
    return {u: u0 + (u1 - u0) * f, v: v0 + (v1 - v0) * f, du, dv, nu, nv, yaw: Math.atan2(-dv, du)};
  }
  return {len, at};
}

export function createMajestic({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-majestic';
  const [x, z] = project(MAJESTIC.lon, MAJESTIC.lat);
  group.position.set(x, 0, z); group.rotation.y = MAJESTIC.yaw;
  const lit = (color, glow, props = {}) => new THREE.MeshStandardMaterial({color, emissive: glow, emissiveIntensity: 0, ...props});
  const materials = {
    facade: lit('#f1e4bf', '#ffcf8a', {roughness: 0.9}),                 // cream stucco, floodlit at night
    trim: lit('#faf5e6', '#ffd9a0', {roughness: 0.85}),
    rustic: lit('#e8d9b0', '#ffc97a', {roughness: 0.95}),
    arcade: lit('#6b5a3c', '#ffb54d', {roughness: 0.5}),                  // the arcade's depth: shop fronts and lobby
    window: lit('#2e3134', '#ffc774', {roughness: 0.3, metalness: 0.25}), // glass, rooms lit at night
    iron: new THREE.MeshStandardMaterial({color: '#23221f', roughness: 0.55, metalness: 0.5}),
    roof: new THREE.MeshStandardMaterial({color: '#8f8a80', roughness: 0.95}),
    gold: lit('#caa24a', '#ffcc55', {metalness: 0.7, roughness: 0.35}),
    lamp: lit('#fff1c9', '#ffd27a', {roughness: 0.4}),
  };
  const glow = {facade: [0, 0.2], trim: [0, 0.24], rustic: [0, 0.22], arcade: [0.12, 1.3], window: [0, 0.55], gold: [0.3, 1.1], lamp: [0.2, 1.6]};
  const {add, box, finish} = builder(materials, 'majestic');
  const outline = MAJESTIC.outline, curve = cornerCurve(outline);
  // The body: the outline with its corner replaced by the curve.
  const body = [...outline.slice(0, 3), ...curve, ...outline.slice(7)];
  // The top floor stands 2 m back from Đồng Khởi and the corner, 6 m from the river (edge 2 + curve.length).
  const riverEdge = 2 + curve.length;
  const bodyTop = insetOutline(body, body.map((_, i) => (i < riverEdge ? 2 : i === riverEdge ? 6 : 0)));
  add('facade', extrude(body, 0, CORNICE));
  add('facade', extrude(bodyTop, CORNICE, TOP));
  add('roof', extrude(bodyTop, TOP, TOP + 0.4));

  // The three frontages as one walk: Đồng Khởi, the corner, the river.
  const fronts = [
    {name: 'dong-khoi', r: run(outline.slice(0, 4), body)},
    {name: 'corner', r: run(curve, body), corner: true},
    {name: 'river', r: run([outline[6], outline[7]], body), river: true},
  ];
  // Place a box on a frontage: t along it, `out` metres proud of the wall, y up; w along the wall.
  const put = (r, key, w, h, d, t, out, y) => { const p = r.at(t); box(key, w, h, d, p.u + p.nu * out, y, p.v + p.nv * out, p.yaw); };
  const place = (r, key, geometry, t, out, y) => { const p = r.at(t); add(key, geometry, p.u + p.nu * out, y, p.v + p.nv * out, 0, p.yaw); };

  for (const {r, corner, river} of fronts) {
    const bays = Math.max(1, Math.round(r.len / BAY)), bw = r.len / bays;
    // Continuous bands, a piece per bay (so they follow the curve): the arcade cornice,
    // the string courses, the main cornice in three steps with dentils, the balustrade.
    for (let b = 0; b < bays; b++) {
      const t = (b + 0.5) * bw, w = bw + 0.04;
      put(r, 'trim', w, 0.35, 0.9, t, 0.45, ARCADE - 0.1); put(r, 'trim', w, 0.3, 1.25, t, 0.62, ARCADE + 0.22); put(r, 'trim', w, 0.25, 0.7, t, 0.35, ARCADE + 0.48);
      for (let f = 0; f <= FLOORS; f++) put(r, 'trim', w, 0.24, 0.32, t, 0.16, MAIN + f * FLOOR - 0.12);
      put(r, 'trim', w, 0.35, 0.6, t, 0.3, CORNICE - 0.9); put(r, 'trim', w, 0.3, 1.0, t, 0.5, CORNICE - 0.55); put(r, 'trim', w, 0.4, 1.5, t, 0.75, CORNICE - 0.2);
      for (let k = 0; k < Math.floor(bw / 0.45); k++) put(r, 'trim', 0.18, 0.2, 0.22, b * bw + (k + 0.5) * bw / Math.floor(bw / 0.45), 0.45, CORNICE - 0.82);   // dentils
      if (!river) {                                                        // the balustrade over the cornice
        put(r, 'trim', w, 0.16, 0.42, t, 0.5, CORNICE + 0.12); put(r, 'trim', w, 0.14, 0.46, t, 0.5, CORNICE + 0.95);
        for (let k = 0; k < Math.floor(bw / 0.36); k++) { const g = new THREE.CylinderGeometry(0.07, 0.1, 0.72, 8); place(r, 'trim', g, b * bw + (k + 0.5) * bw / Math.floor(bw / 0.36), 0.5, CORNICE + 0.56); }
      }
    }
    for (let b = 0; b < bays; b++) {
      const t0 = (b + 0.5) * bw;
      // The arcade: a tall arch per bay in a moulded ring with a keystone; the piers
      // between, rusticated in bands.
      place(r, 'trim', arch(3.5, 5.55, 0.14, 10), t0, 0.07, 0);
      place(r, 'arcade', arch(2.9, 5.2, 0.16, 10), t0, 0.1, 0);
      put(r, 'trim', 0.42, 0.75, 0.28, t0, 0.2, 5.2);                     // keystone
      for (let k = 0; k < 6; k++) put(r, 'rustic', 0.95, 0.82, 0.3, b * bw, 0.15, 0.45 + k * 0.97);
      // The mezzanine: two square windows, a lantern on the pier.
      for (const s of [-1, 1]) { put(r, 'window', 1.3, 1.3, 0.1, t0 + s * bw * 0.23, 0.06, ARCADE + 1.55); put(r, 'trim', 1.55, 0.14, 0.2, t0 + s * bw * 0.23, 0.1, ARCADE + 2.28); }
      put(r, 'iron', 0.06, 0.06, 0.55, b * bw, 0.3, ARCADE + 1.8); put(r, 'lamp', 0.26, 0.42, 0.26, b * bw, 0.6, ARCADE + 1.65); put(r, 'iron', 0.34, 0.06, 0.34, b * bw, 0.6, ARCADE + 1.9);
      // Four floors: French windows in pairs in moulded surrounds, a pediment or a
      // cartouche over each, the pair's balcony on consoles behind an iron railing.
      for (let f = 0; f < FLOORS; f++) {
        const y = MAIN + f * FLOOR;
        for (const s of [-1, 1]) {
          const t = t0 + s * bw * 0.23;
          put(r, 'window', 1.2, 2.45, 0.1, t, 0.06, y + 1.4);
          put(r, 'trim', 0.16, 2.6, 0.18, t - 0.68, 0.1, y + 1.4); put(r, 'trim', 0.16, 2.6, 0.18, t + 0.68, 0.1, y + 1.4);
          put(r, 'trim', 1.55, 0.2, 0.26, t, 0.13, y + 2.78);
          if (f % 2 === 0) { const g = new THREE.Shape([new THREE.Vector2(-0.75, 0), new THREE.Vector2(0.75, 0), new THREE.Vector2(0, 0.42)]); place(r, 'trim', new THREE.ExtrudeGeometry(g, {depth: 0.2, bevelEnabled: false}), t, 0.04, y + 2.88); }
          else { const g = new THREE.Shape(); g.absellipse(0, 0, 0.32, 0.26, 0, Math.PI * 2); place(r, 'gold', new THREE.ExtrudeGeometry(g, {depth: 0.12, bevelEnabled: false, curveSegments: 10}), t, 0.08, y + 3.08); }
        }
        if (!corner || f > 0) {
          const bal = bw * 0.84, d = 0.85;
          put(r, 'trim', bal, 0.2, d, t0, d / 2, y + 0.1);                   // the balcony's slab
          for (const s of [-1, 1]) put(r, 'trim', 0.22, 0.45, 0.6, t0 + s * bal * 0.4, 0.3, y - 0.2);   // its consoles
          put(r, 'iron', bal, 0.06, 0.06, t0, d - 0.04, y + 1.12); put(r, 'iron', bal, 0.05, 0.05, t0, d - 0.04, y + 0.28);
          for (const s of [-1, 1]) put(r, 'iron', 0.05, 0.06, d, t0 + s * (bal / 2 - 0.03), d / 2, y + 1.12);
          const n = Math.floor(bal / 0.13);
          for (let k = 0; k <= n; k++) put(r, 'iron', 0.028, 0.84, 0.028, t0 - bal / 2 + k * bal / n, d - 0.04, y + 0.7);
          for (const s of [-1, 1]) for (let k = 1; k < 6; k++) put(r, 'iron', 0.028, 0.84, 0.028, t0 + s * (bal / 2 - 0.03), d - k * 0.14, y + 0.7);
        }
      }
      // Pilasters with gilded capitals between the bays, from the arcade cornice up.
      if (b > 0) { put(r, 'trim', 0.62, CORNICE - MAIN - 1.0, 0.28, b * bw, 0.16, (CORNICE - 1.0 + MAIN) / 2); put(r, 'gold', 0.8, 0.42, 0.34, b * bw, 0.2, CORNICE - 1.15); }
      // The set-back top floor's windows (not on the river side, where the rooftop bar is).
      if (!river) for (const s of [-1, 1]) {
        const p = r.at(t0 + s * bw * 0.23), inset = 2 - 0.06;
        box('window', 1.1, 1.7, 0.1, p.u - p.nu * inset, CORNICE + 1.75, p.v - p.nv * inset, p.yaw);
        box('trim', 1.4, 0.16, 0.25, p.u - p.nu * (inset - 0.1), CORNICE + 2.72, p.v - p.nv * (inset - 0.1), p.yaw);
      }
    }
  }

  // The back of the block: plain windows.
  outline.forEach((_, i) => {
    if (MAJESTIC.frontage.includes(i)) return;
    const e = edge(outline, i), pitch = 5.6, n = Math.floor(e.len / pitch);
    if (n < 1) return;
    const start = (e.len - (n - 1) * pitch) / 2;
    for (let k = 0; k < n; k++) for (let f = 0; f <= FLOORS; f++)
      box('window', 1.3, 1.8, 0.12, e.u0 + e.du * (start + k * pitch) + e.nu * 0.06, ARCADE + 1.4 + f * FLOOR, e.v0 + e.dv * (start + k * pitch) + e.nv * 0.06, e.yaw);
  });

  // The rooftop bar on the river side: a white colonnade under a pergola.
  {
    const r = fronts[2].r;
    for (let t = 3; t < r.len - 1; t += 3.6) { const p = r.at(t); box('trim', 0.45, TOP - CORNICE, 0.45, p.u - p.nu * 1.0, (TOP + CORNICE) / 2, p.v - p.nv * 1.0, p.yaw); }
    const p = r.at(r.len / 2);
    box('trim', r.len - 4, 0.5, 0.6, p.u - p.nu * 1.0, TOP - 0.25, p.v - p.nv * 1.0, p.yaw);
    box('roof', r.len - 4, 0.15, 4.2, p.u - p.nu * 3.2, TOP - 0.1, p.v - p.nv * 3.2, p.yaw);
  }

  // The corner's crown: a curved attic above the top floor, following the corner 1.5 m in,
  // with three arched windows, its own cornice and a crest; MAJESTIC in gold on it.
  {
    const r = run(curve, body), mid = r.at(r.len / 2), yawOut = facing(mid.nu, mid.nv);
    const n = 12;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) * r.len / n, p = r.at(t), w = r.len / n + 0.3;
      box('facade', w, ATTIC - TOP, 0.7, p.u - p.nu * 1.5, (TOP + ATTIC) / 2, p.v - p.nv * 1.5, p.yaw);
      box('trim', w, 0.4, 1.1, p.u - p.nu * 1.3, ATTIC - 0.1, p.v - p.nv * 1.3, p.yaw);
      box('trim', w, 0.3, 0.9, p.u - p.nu * 1.35, TOP + 0.25, p.v - p.nv * 1.35, p.yaw);
    }
    for (const f of [0.25, 0.5, 0.75]) { const p = r.at(r.len * f); add('window', arch(1.2, 2.2, 0.1, 8), p.u - p.nu * 1.13, TOP + 0.6, p.v - p.nv * 1.13, 0, p.yaw); }
    const crest = new THREE.Shape(); crest.absellipse(0, 0, 5.2, 1.3, 0, Math.PI, false);
    add('trim', new THREE.ExtrudeGeometry(crest, {depth: 0.5, bevelEnabled: false, curveSegments: 16}), mid.u - mid.nu * 1.7, ATTIC + 0.1, mid.v - mid.nv * 1.7, 0, yawOut);
    add('gold', letters('MAJESTIC', {h: 2.1, stroke: 0.34}), mid.u - mid.nu * 1.2, ATTIC + 0.25, mid.v - mid.nv * 1.2, 0, yawOut);
    // HOTEL MAJESTIC on a curved pediment over the corner entrance, above the arcade cornice.
    const pediment = new THREE.Shape(); pediment.absellipse(0, 0, 4.6, 2.0, 0, Math.PI, false);
    add('trim', new THREE.ExtrudeGeometry(pediment, {depth: 0.5, bevelEnabled: false, curveSegments: 12}), mid.u + mid.nu * 0.9, ARCADE + 0.6, mid.v + mid.nv * 0.9, 0, yawOut);
    add('gold', letters('HOTEL', {h: 0.45, stroke: 0.09}), mid.u + mid.nu * 1.45, ARCADE + 1.55, mid.v + mid.nv * 1.45, 0, yawOut);
    add('gold', letters('MAJESTIC', {h: 0.6, stroke: 0.11}), mid.u + mid.nu * 1.45, ARCADE + 0.75, mid.v + mid.nv * 1.45, 0, yawOut);
  }

  const triangles = finish(group);
  scene.add(group);
  group.updateMatrixWorld(true);
  // Two flags on raked staffs over the corner entrance (the shared, waving flag, flag.js).
  const flags = [];
  {
    const r = run(curve, body);
    for (const f of [0.38, 0.62]) {
      const p = r.at(r.len * f), foot = [p.u + p.nu * 0.3, ARCADE + 2.2, p.v + p.nv * 0.3], tip = [p.u + p.nu * 2.4, ARCADE + 4.4, p.v + p.nv * 2.4];
      const staff = new THREE.CylinderGeometry(0.035, 0.045, Math.hypot(tip[0] - foot[0], tip[1] - foot[1], tip[2] - foot[2]), 8);
      const dir = new THREE.Vector3(tip[0] - foot[0], tip[1] - foot[1], tip[2] - foot[2]).normalize();
      staff.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)); staff.translate((foot[0] + tip[0]) / 2, (foot[1] + tip[1]) / 2, (foot[2] + tip[2]) / 2);
      const m = new THREE.Mesh(staff, materials.iron); m.name = 'majestic-flagstaff'; group.add(m);
      flags.push({top: group.localToWorld(new THREE.Vector3(...tip)), length: 1.5});
    }
  }
  const bounds = new THREE.Box3().setFromObject(group);
  const replaceGeneric = genericReplacer(group, outline, {flag: 'majesticReplaced', top: MAJESTIC.osmHeight + 20});
  const view = {target: group.localToWorld(new THREE.Vector3(25, 14, -20)), eye: group.localToWorld(new THREE.Vector3(95, 45, -140))};
  const state = {name: 'Hotel Majestic Saigon', lon: MAJESTIC.lon, lat: MAJESTIC.lat, height: +bounds.max.y.toFixed(2), triangles, drawCalls: group.children.length, night: 0, schematic: false};
  /** Floodlit at night: 0 by day, 1 at full night (the sky's cityLights level). */
  function setNight(level) {
    level = Math.max(0, Math.min(1, level || 0));
    if (Math.abs(level - state.night) < 0.01) return;
    state.night = level;
    for (const [key, [day, night]] of Object.entries(glow)) materials[key].emissiveIntensity = day + (night - day) * level;
  }
  for (const [key, [day]] of Object.entries(glow)) materials[key].emissiveIntensity = day;   // by day
  return {group, state, view, flags, setNight, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
