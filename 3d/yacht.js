// A Princess 60 flybridge motor yacht moored at the Vinhomes Central Park
// Marina (Tam Sơn Yachting), below Landmark 81, with people sunbathing on
// her foredeck and flybridge. Principal dimensions from the builder's
// specification: 18.61 m overall (18.36 m without the pulpit), 4.83 m beam,
// 1.27 m draft. The form follows photographs of the 2011-2017 model: the
// sheer rising to a raked bow, a deep-V hull with spray rails and strakes,
// three long hull windows a side, the saloon's sweeping side glazing and
// raked windscreen, the flybridge overhanging the cockpit with its helm,
// seating, wet bar and radar arch, the swim platform. Built without a
// triangle budget. The marina's floating pontoons (OSM way 1160247605) are
// drawn too: the city model has no piers. See YACHT.md.
import * as THREE from 'three';
import {builder, letters} from './landmark-kit.js';

export const YACHT = Object.freeze({
  length: 18.61, hull: 18.36, beam: 4.83, draft: 1.27,
  // Alongside the east face of the long outer pontoon, port side to, bow
  // upstream (north); the centre 3 m out from the pontoon's edge.
  lon: 106.7255721, lat: 10.7946362, heading: [-0.2236, -0.9747],
  name: 'SAIGON STAR',
  pontoon: [[106.7260664,10.7955227],[106.725813,10.7953006],[106.7257062,10.7954051],[106.725685,10.7953859],[106.7257921,10.7952824],[106.7257474,10.7952432],[106.7253737,10.7955836],[106.7253612,10.7955721],[106.7254962,10.7954455],[106.7254868,10.7954355],[106.7254166,10.7955083],[106.7251345,10.7952466],[106.7250698,10.7953314],[106.7250587,10.7953188],[106.7249338,10.7954385],[106.7249207,10.795427],[106.7253568,10.7949917],[106.7253705,10.7949141],[106.7252029,10.7948883],[106.725214,10.7948517],[106.7253739,10.7948899],[106.7254361,10.7946392],[106.7252784,10.7946034],[106.7252916,10.7945765],[106.7254504,10.7946143],[106.7254702,10.7945565],[106.7254992,10.7945668],[106.7253933,10.7950099],[106.7253607,10.7950418],[106.7254155,10.7951018],[106.7254226,10.795093],[106.7253621,10.7950419],[106.725281,10.7951244],[106.7253506,10.7951907],[106.725336,10.7952062],[106.7252657,10.7951392],[106.7251934,10.7952068],[106.7252635,10.7952699],[106.7252509,10.7952869],[106.7251831,10.795223],[106.7251052,10.7952987],[106.7251565,10.795355],[106.7251431,10.7953717],[106.7250932,10.7953127],[106.7250413,10.7953573],[106.7252979,10.7956027],[106.7253643,10.7955412],[106.7253338,10.7955061],[106.7253472,10.7954925],[106.725378,10.7955287],[106.7254479,10.7954618],[106.7253836,10.7954048],[106.725398,10.7953881],[106.7254641,10.7954446],[106.7255437,10.7953725],[106.7254853,10.7953142],[106.7254996,10.795299],[106.7255593,10.7953554],[106.7256213,10.795303],[106.7259551,10.7956126]],
});

const WATER = -0.12, L = YACHT.hull, B = YACHT.beam / 2;
const AFT = -L / 2, BOW = L / 2;
const tOf = x => (x - AFT) / L;
const clamp01 = v => Math.max(0, Math.min(1, v));
// The hull's lines, along the length (t = 0 at the transom, 1 at the stem).
const gunHB = t => B * (t < 0.52 ? 1 - 0.025 * (0.52 - t) : Math.pow(Math.max(0, Math.cos((t - 0.52) / 0.48 * Math.PI / 2)), 0.7));
const gunY = t => 1.45 + 0.85 * Math.pow(t, 1.7);                                    // the sheer
const chineHB = t => (B - 0.2) * (t < 0.42 ? 1 : Math.pow(Math.max(0, Math.cos((t - 0.42) / 0.58 * Math.PI / 2)), 0.8));
const chineY = t => 0.02 + 1.25 * Math.pow(clamp01((t - 0.5) / 0.5), 1.55);
const keelY = t => WATER - YACHT.draft + (t < 0.6 ? 0 : (gunY(1) - 0.1 - (WATER - YACHT.draft)) * Math.pow((t - 0.6) / 0.4, 1.9));
/** The starboard half of a hull section at t: gunwale down the flared
 *  topside to the chine, the spray rail's lip, the bottom with two strakes
 *  down to the keel. [z, y] from the gunwale to the keel. */
function section(t) {
  const hb = gunHB(t), gy = gunY(t), cb = Math.min(chineHB(t), hb), cy = Math.min(chineY(t), gy - 0.04), ky = Math.min(keelY(t), cy - 0.02);
  const pts = [];
  for (let i = 0; i <= 14; i++) { const u = i / 14; pts.push([hb + (cb - hb) * u + 0.07 * Math.sin(Math.PI * u) * Math.min(1, hb / B), gy + (cy - gy) * u]); }
  const lip = Math.min(0.07, cb * 0.08);
  pts.push([cb + lip, cy - 0.005], [cb + lip * 0.6, cy - 0.05]);                    // the spray rail
  for (let i = 1; i <= 16; i++) {
    const u = i / 16, z = cb * (1 - u), yLine = cy + (ky - cy) * Math.pow(u, 0.92);
    const strake = [0.33, 0.62].some(s => Math.abs(u - s) < 0.03) ? 0.025 * Math.min(1, cb) : 0;
    pts.push([z + strake, yLine]);
  }
  return pts;                                                                         // 33 points, keel last (z = 0)
}
/** The hull's half-breadth at height y and station x, on the topside. */
function hullZ(x, y) {
  const t = tOf(x), hb = gunHB(t), gy = gunY(t), cb = Math.min(chineHB(t), hb), cy = Math.min(chineY(t), gy - 0.04);
  const u = clamp01((gy - y) / (gy - cy));
  return hb + (cb - hb) * u + 0.07 * Math.sin(Math.PI * u) * Math.min(1, hb / B);
}

export function createYacht({scene, project}) {
  const outer = new THREE.Group(); outer.name = 'landmark-yacht';
  const group = new THREE.Group(); group.name = 'yacht';
  const [x, z] = project(YACHT.lon, YACHT.lat), [hx, hz] = YACHT.heading;
  group.position.set(x, 0, z); group.rotation.y = Math.atan2(-hz, hx);                // local +x (the bow) along the heading
  const M = (color, o = {}) => new THREE.MeshStandardMaterial({color, roughness: 0.6, ...o});
  const materials = {
    hull: M('#f7f7f4', {roughness: 0.28, metalness: 0.05, side: THREE.DoubleSide}),
    white: M('#f4f4f1', {roughness: 0.4, side: THREE.DoubleSide}),
    glass: M('#172026', {roughness: 0.06, metalness: 0.75, side: THREE.DoubleSide}),
    frame: M('#6d7478', {roughness: 0.4, metalness: 0.5}),
    antifoul: M('#20262b', {roughness: 0.75, side: THREE.DoubleSide}),
    boot: M('#3c4449', {roughness: 0.4}),
    teak: M('#b98555', {roughness: 0.8}),
    seam: M('#2c2520', {roughness: 0.9}),
    cushion: M('#ede6d6', {roughness: 0.95}),
    piping: M('#8a8378', {roughness: 0.9}),
    steel: M('#e3e7ea', {roughness: 0.15, metalness: 0.95}),
    dark: M('#15181a', {roughness: 0.5}),
    screen: M('#0e2a3c', {emissive: '#0a3550', emissiveIntensity: 0.6, roughness: 0.2}),
    red: M('#d0271d', {emissive: '#6a0c07', emissiveIntensity: 0.5}),
    green: M('#1f9d4a', {emissive: '#0a4a20', emissiveIntensity: 0.5}),
    lamp: M('#fff7e0', {emissive: '#fff0c0', emissiveIntensity: 0.6}),
    gold: M('#c9a045', {metalness: 0.8, roughness: 0.3}),
    rope: M('#e8e0cc', {roughness: 1}),
    fender: M('#1f3b5c', {roughness: 0.5}),
    skin1: M('#e2b494', {roughness: 0.55}), skin2: M('#b98462', {roughness: 0.55}), skin3: M('#8d5d42', {roughness: 0.55}),
    hair1: M('#2b211c', {roughness: 0.8}), hair2: M('#c9a26b', {roughness: 0.8}),
    suitA: M('#1f5fa8'), suitB: M('#c0392b'), suitC: M('#23303a'),
    towel1: M('#f2c14e', {roughness: 1}), towel2: M('#2a9d8f', {roughness: 1}), towel3: M('#e76f51', {roughness: 1}), stripe: M('#fbf7ee', {roughness: 1}),
    book: M('#3c6e91'), drink: M('#f39c12', {transparent: true, opacity: 0.85}), straw: M('#dcb86a', {roughness: 0.9}),
  };
  const {add, box, finish} = builder(materials, 'yacht');
  const raw = (key, positions) => { if (!positions.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.computeVertexNormals(); add(key, g); };
  const quad = (out, a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  const V = (px, py, pz) => new THREE.Vector3(px, py, pz);
  const tube = (key, pts, r, seg = 6, closed = false) => add(key, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), Math.max(8, pts.length * 6), r, seg, closed));

  // ================= The hull =================================================
  const N = 220, rings = [];
  for (let i = 0; i <= N; i++) { const t = i / N; rings.push({x: AFT + t * L, pts: section(t)}); }
  const P = rings[0].pts.length;
  const white = [], below = [], boot = [];
  for (let i = 0; i < N; i++) for (const side of [-1, 1]) for (let k = 0; k < P - 1; k++) {
    const a = rings[i], b = rings[i + 1];
    const v = (r, j) => [r.x, r.pts[j][1], side * r.pts[j][0]];
    const q = [v(a, k), v(a, k + 1), v(b, k + 1), v(b, k)];
    const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    const out = cy < WATER ? below : cy < WATER + 0.12 ? boot : white;
    if (side > 0) quad(out, ...q); else quad(out, q[0], q[3], q[2], q[1]);
  }
  raw('hull', white); raw('antifoul', below); raw('boot', boot);
  // The transom: slightly rounded at its corners, fanned from its middle.
  { const r0 = rings[0], c = [AFT, (gunY(0) + keelY(0)) / 2, 0], t = [];
    const edge = [...r0.pts.map(([pz, py]) => [AFT, py, pz]), ...r0.pts.slice().reverse().map(([pz, py]) => [AFT, py, -pz])];
    for (let k = 0; k < edge.length - 1; k++) t.push(...c, ...edge[k + 1], ...edge[k]);
    raw('hull', t); }
  // The deck forward of the cockpit, cambered; a teak-capped toe rail.
  const COCKPIT = -6.3, deck = [];
  for (let i = 0; i < N; i++) {
    const a = rings[i], b = rings[i + 1]; if (b.x <= COCKPIT) continue;
    const pa = a.pts[0], pb = b.pts[0], S = 8;
    for (let k = 0; k < S; k++) {
      const u0 = -1 + 2 * k / S, u1 = -1 + 2 * (k + 1) / S, cam = u => 0.07 * (1 - u * u);
      quad(deck, [a.x, pa[1] + cam(u0), u0 * pa[0]], [a.x, pa[1] + cam(u1), u1 * pa[0]], [b.x, pb[1] + cam(u1), u1 * pb[0]], [b.x, pb[1] + cam(u0), u0 * pb[0]]);
    }
  }
  raw('white', deck);
  for (const side of [-1, 1]) {
    const pts = []; for (let i = 0; i <= N; i += 4) { const r = rings[i]; pts.push(V(r.x, r.pts[0][1] + 0.05, side * (r.pts[0][0] - 0.02))); }
    tube('steel', pts, 0.035, 6);                                                              // stainless rubbing rail on the gunwale
    const strake = []; for (let i = 0; i <= N; i += 4) { const r = rings[i], y = r.pts[0][1] - 0.3; strake.push(V(r.x, y, side * (hullZ(r.x, y) + 0.02))); }
    tube('frame', strake, 0.03, 5);                                                            // the rubbing strake below it
  }

  // Hull windows: three a side, long with rounded ends, set in the topsides
  // following their curve, each with a stainless surround.
  function hullWindow(side, x0, x1, y0, y1, slope = 0.025) {
    const n = 64, ring = (grow) => Array.from({length: n}, (_, i) => {
      const a = i / n * Math.PI * 2, cx = Math.cos(a), sy = Math.sin(a);
      const px = (x0 + x1) / 2 + ((x1 - x0) / 2 + grow) * Math.sign(cx) * Math.pow(Math.abs(cx), 0.35);
      const py = (y0 + y1) / 2 + ((y1 - y0) / 2 + grow) * Math.sign(sy) * Math.pow(Math.abs(sy), 0.8) + slope * (px - (x0 + x1) / 2);
      return [px, py];
    });
    for (const [key, grow, lift] of [['frame', 0.035, 0.012], ['glass', 0, 0.02]]) {
      const pts = ring(grow), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, out = [];
      const P3 = ([px, py]) => [px, py, side * (hullZ(px, py) + lift)];
      for (let i = 0; i < n; i++) { const a = P3(pts[i]), b = P3(pts[(i + 1) % n]), c = P3([cx, cy]); if (side > 0) out.push(...c, ...a, ...b); else out.push(...c, ...b, ...a); }
      raw(key, out);
    }
  }
  for (const side of [-1, 1]) for (const [x0, x1, y0, y1] of [[-3.5, -1.55, 0.74, 1.0], [-1.2, 1.95, 0.72, 1.02], [2.35, 4.2, 0.78, 1.04]]) hullWindow(side, x0, x1, y0, y1);
  // Exhaust outlets low on the quarters, and the navigation lights.
  for (const side of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 16); g.rotateX(Math.PI / 2); add('dark', g, AFT + 1.2, 0.25, side * (hullZ(AFT + 1.2, 0.25) + 0.01));
  }

  // ================= Cockpit and swim platform ================================
  const FLOOR = 0.95;
  const planks = (x0, x1, z0, z1, y, width = 0.12) => {                                     // teak with dark seams
    box('teak', x1 - x0, 0.05, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2);
    for (let pz = z0 + width; pz < z1 - 0.02; pz += width) box('seam', x1 - x0, 0.052, 0.008, (x0 + x1) / 2, y + 0.001, pz);
  };
  planks(AFT + 0.02, COCKPIT, -B + 0.28, B - 0.28, FLOOR);
  // The transom sofa, its backrest against the transom, with cushion piping.
  box('white', 0.62, 0.42, 3.5, AFT + 0.4, FLOOR + 0.21, 0);
  for (let k = 0; k < 3; k++) { const pz = -1.15 + k * 1.15; box('cushion', 0.58, 0.12, 1.12, AFT + 0.4, FLOOR + 0.48, pz); box('cushion', 0.14, 0.42, 1.12, AFT + 0.14, FLOOR + 0.75, pz); box('piping', 0.585, 0.015, 1.125, AFT + 0.4, FLOOR + 0.545, pz); }
  // The cockpit table, two folding leaves, on a steel pedestal; deck chairs.
  box('teak', 0.85, 0.04, 1.5, AFT + 1.55, FLOOR + 0.72, 0);
  add('steel', new THREE.CylinderGeometry(0.05, 0.05, 0.7, 12), AFT + 1.55, FLOOR + 0.36, 0);
  add('steel', new THREE.CylinderGeometry(0.25, 0.25, 0.02, 20), AFT + 1.55, FLOOR + 0.02, 0);
  for (const pz of [-0.5, 0.5]) { box('teak', 0.45, 0.04, 0.45, AFT + 2.3, FLOOR + 0.45, pz); box('teak', 0.04, 0.45, 0.45, AFT + 2.55, FLOOR + 0.7, pz); for (const [dx, dz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) box('steel', 0.025, 0.45, 0.025, AFT + 2.3 + dx, FLOOR + 0.22, pz + dz); }
  // Steps down to the platform either side of the sofa, and the platform.
  for (const side of [-1, 1]) for (let s = 0; s < 3; s++) planks(AFT - 0.02 - 0.28 * (s + 1), AFT + 0.02 - 0.28 * s, side * 1.95 - 0.32, side * 1.95 + 0.32, FLOOR - 0.22 * (s + 1));
  planks(AFT - 1.3, AFT, -B + 0.02, B - 0.02, 0.3);
  box('white', 1.3, 0.18, 2 * B - 0.04, AFT - 0.65, 0.19, 0);
  // The boarding ladder, folded at the platform's edge.
  for (const pz of [-0.2, 0.2]) add('steel', new THREE.CylinderGeometry(0.02, 0.02, 0.9, 8), AFT - 1.25, 0.1, 1.2 + pz);
  for (let k = 0; k < 4; k++) add('steel', new THREE.CylinderGeometry(0.015, 0.015, 0.4, 8), AFT - 1.25, -0.25 + k * 0.22, 1.2, Math.PI / 2);
  // The name on the transom, in gold.
  add('gold', letters(YACHT.name, {h: 0.26, stroke: 0.04}), AFT - 0.01, 1.05, 0, 0, -Math.PI / 2);
  // Stairs up to the flybridge on the starboard side of the cockpit.
  for (let s = 0; s < 7; s++) box('teak', 0.28, 0.05, 0.75, COCKPIT - 0.3 - s * 0.22, FLOOR + 0.3 + s * 0.4, B - 0.7);
  for (const dz of [-0.4, 0.4]) tube('steel', [V(COCKPIT - 0.2, FLOOR + 1.2, B - 0.7 + dz), V(COCKPIT - 1.8, FLOOR + 3.3, B - 0.7 + dz)], 0.02, 6);

  // ================= The saloon =================================================
  // A loft of sections from the aft bulkhead to the windscreen: tumblehome
  // sides with a rounded roof edge, rounded in plan at the front, the side
  // glazing and the windscreen picked out of the same surface.
  const S0 = COCKPIT, S1 = 3.55, ROOF = 3.72, SCREEN = 1.85;
  const hwAt = px => { const r = 2.0 - 0.06 * clamp01((px - S0) / 6); return px < 1.2 ? r : r * Math.sqrt(Math.max(0.08, 1 - Math.pow((px - 1.2) / (S1 - 1.2 + 0.25), 2))); };
  const baseAt = px => gunY(tOf(Math.max(px, S0))) + 0.05;
  const topAt = px => px < SCREEN ? ROOF : ROOF - (px - SCREEN) / (S1 - SCREEN) * (ROOF - baseAt(S1) - 0.42);
  const salonSec = px => {                                                                   // starboard half, from the base up and over to the centreline
    const hw = hwAt(px), base = baseAt(px), top = topAt(px), pts = [];
    for (let i = 0; i <= 10; i++) { const u = i / 10; pts.push([hw - 0.14 * u, base + (top - 0.12 - base) * u]); }
    for (let i = 1; i <= 5; i++) { const a = i / 5 * Math.PI / 2; pts.push([hw - 0.14 - 0.12 * (1 - Math.cos(a)) - 0.0, top - 0.12 + 0.12 * Math.sin(a)]); }
    for (let i = 1; i <= 6; i++) { const u = i / 6; pts.push([(hw - 0.26) * (1 - u), top + 0.03 * u]); }
    return pts;
  };
  // Where the glass is: the long side window with its angled forward end,
  // a smaller one forward of it, and the windscreen with its frame.
  const sideGlass = (px, py) => {
    const base = baseAt(px);
    if (px > -5.7 && px < 0.35 && py > base + 0.72 && py < ROOF - 0.28 - 0.1 * clamp01((px + 5.7) / 6)) return true;
    return px > 0.6 && px < 2.25 && py > base + 0.72 + (px - 0.6) * 0.18 && py < ROOF - 0.3 - (px - 0.6) * 0.35;
  };
  const screenGlass = (px, pz) => px > SCREEN + 0.05 && px < S1 - 0.12 && Math.abs(pz) > 0.05 && Math.abs(pz) < hwAt(px) - 0.25;
  const XS = 140, salonWhite = [], salonGlass = [];
  for (let i = 0; i < XS; i++) {
    const xa = S0 + (S1 - S0) * i / XS, xb = S0 + (S1 - S0) * (i + 1) / XS, A = salonSec(xa), Bs = salonSec(xb);
    for (const side of [-1, 1]) for (let k = 0; k < A.length - 1; k++) {
      const q = [[xa, A[k][1], side * A[k][0]], [xa, A[k + 1][1], side * A[k + 1][0]], [xb, Bs[k + 1][1], side * Bs[k + 1][0]], [xb, Bs[k][1], side * Bs[k][0]]];
      const cx = (xa + xb) / 2, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4, cz = (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4;
      const glass = (k < 10 && sideGlass(cx, cy)) || (k >= 15 && cx > SCREEN && screenGlass(cx, cz));
      const out = glass ? salonGlass : salonWhite;
      if (side > 0) quad(out, ...q); else quad(out, q[0], q[3], q[2], q[1]);
    }
  }
  raw('white', salonWhite); raw('glass', salonGlass);
  // The front below the windscreen, and the aft bulkhead: sliding glass
  // doors in a stainless frame.
  { const f = salonSec(S1), c = [S1, baseAt(S1) + 0.2, 0], out = [];
    const edge = [...f.map(([pz, py]) => [S1, py, pz]), ...f.slice().reverse().map(([pz, py]) => [S1, py, -pz])];
    for (let k = 0; k < edge.length - 1; k++) out.push(...c, ...edge[k], ...edge[k + 1]);
    raw('white', out); }
  { const f = salonSec(S0 + 0.001), out = [], c = [S0, ROOF - 1, 0];
    const edge = [...f.map(([pz, py]) => [S0, py, pz]), ...f.slice().reverse().map(([pz, py]) => [S0, py, -pz])];
    for (let k = 0; k < edge.length - 1; k++) out.push(...c, ...edge[k + 1], ...edge[k]);
    raw('white', out);
    box('glass', 0.03, ROOF - baseAt(S0) - 0.35, 3.2, S0 - 0.02, (ROOF + baseAt(S0)) / 2 - 0.12, 0);
    for (const pz of [-1.6, -0.55, 0.55, 1.6]) box('frame', 0.05, ROOF - baseAt(S0) - 0.3, 0.05, S0 - 0.03, (ROOF + baseAt(S0)) / 2 - 0.12, pz); }
  // Windscreen wipers, grab rails along the roof edge, navigation lights.
  for (const pz of [-0.8, 0.8]) { const y = topAt(S1 - 0.35); add('dark', new THREE.BoxGeometry(0.9, 0.02, 0.03), S1 - 0.55, y + 0.03, pz, 0, 0.3 * Math.sign(pz), -0.65); }
  for (const side of [-1, 1]) {
    const pts = []; for (let px = -5.8; px <= 1.5; px += 0.5) pts.push(V(px, ROOF - 0.05, side * (hwAt(px) - 0.1)));
    tube('steel', pts, 0.018, 6);
    for (let px = -5.5; px <= 1.4; px += 1.2) box('steel', 0.02, 0.08, 0.02, px, ROOF - 0.08, side * (hwAt(px) - 0.1));
    add(side < 0 ? 'red' : 'green', new THREE.BoxGeometry(0.18, 0.08, 0.04), 2.9, baseAt(2.9) + 0.35, side * (hwAt(2.9) + 0.01));
  }

  // ================= Foredeck ===================================================
  const fy = x => gunY(tOf(x)) + 0.07;
  // The sunpad on the raised foredeck: three pads with piping, an adjustable
  // backrest raised against the windscreen, two pillows.
  const F0 = 3.75, F1 = 6.55;
  box('white', F1 - F0, 0.22, 2.7, (F0 + F1) / 2, fy(5) + 0.1, 0);
  for (let k = 0; k < 3; k++) { const px = F0 + 0.35 + (k + 0.5) * (F1 - F0 - 0.35) / 3; box('cushion', (F1 - F0 - 0.35) / 3 - 0.02, 0.14, 2.6, px, fy(5) + 0.28, 0); box('piping', (F1 - F0 - 0.35) / 3 - 0.01, 0.012, 2.61, px, fy(5) + 0.35, 0); }
  add('cushion', new THREE.BoxGeometry(0.12, 0.6, 2.6), F0 + 0.2, fy(5) + 0.5, 0, 0, 0, -0.55);
  for (const pz of [-0.62, 0.62]) { const g = new THREE.SphereGeometry(0.2, 14, 10); g.scale(0.8, 0.35, 1.3); add('cushion', g, F0 + 0.55, fy(5) + 0.4, pz); }
  // Hatches: two smoked skylights forward of the sunpad, one aft of the windlass.
  for (const [px, w] of [[6.95, 0.6], [7.65, 0.5]]) { box('frame', w + 0.08, 0.05, w + 0.08, px, fy(px) + 0.03, 0); box('glass', w, 0.052, w, px, fy(px) + 0.035, 0); }
  // The windlass, the chain running to the bow roller, the anchor stowed.
  add('steel', new THREE.CylinderGeometry(0.14, 0.14, 0.26, 20), 8.25, fy(8.25) + 0.16, 0, Math.PI / 2);
  add('dark', new THREE.CylinderGeometry(0.2, 0.22, 0.12, 20), 8.25, fy(8.25) + 0.05, 0);
  for (let k = 0; k < 12; k++) {                                                              // chain links, alternating
    const px = 8.4 + k * 0.08, g = new THREE.TorusGeometry(0.03, 0.009, 5, 10); if (k % 2) g.rotateX(Math.PI / 2);
    g.scale(1.5, 1, 1); add('steel', g, px, fy(px) + 0.12 - k * 0.004, 0);
  }
  box('steel', 0.55, 0.1, 0.18, BOW + 0.05, gunY(1) - 0.02, 0);                               // bow roller
  { const shank = new THREE.BoxGeometry(0.5, 0.05, 0.06); add('steel', shank, BOW + 0.25, gunY(1) - 0.1, 0, 0, 0, -0.35);
    const fluke = new THREE.ConeGeometry(0.16, 0.22, 3); fluke.rotateZ(-Math.PI / 2); add('steel', fluke, BOW + 0.5, gunY(1) - 0.2, 0); }
  // Cleats: bow, midships, quarters.
  const cleat = (px, side) => { const y = gunY(tOf(px)) + 0.05, zz = side * (gunHB(tOf(px)) - 0.18);
    box('steel', 0.3, 0.04, 0.06, px, y + 0.09, zz); for (const d of [-0.07, 0.07]) box('steel', 0.04, 0.09, 0.05, px + d, y + 0.045, zz); };
  for (const side of [-1, 1]) for (const px of [7.3, 0.3, AFT + 0.5]) cleat(px, side);
  // The pulpit: double rails on stanchions round the foredeck.
  for (const side of [-1, 1]) for (const h of [0.35, 0.65]) {
    const pts = []; for (let i = 0; i <= 24; i++) { const px = 0.8 + (BOW - 0.15 - 0.8) * i / 24, t = tOf(px); pts.push(V(px, gunY(t) + h, side * Math.max(0.0, gunHB(t) - 0.12))); }
    tube('steel', pts, h > 0.5 ? 0.02 : 0.013, 8);
  }
  for (const side of [-1, 1]) for (let i = 0; i <= 9; i++) { const px = 0.8 + (BOW - 0.6 - 0.8) * i / 9, t = tOf(px); add('steel', new THREE.CylinderGeometry(0.014, 0.018, 0.65, 8), px, gunY(t) + 0.33, side * (gunHB(t) - 0.12)); }

  // ================= Flybridge ==================================================
  // Its floor is the saloon roof, carried aft over the cockpit as a shade on
  // two stainless posts; a curved coaming round it, open aft.
  const FB0 = -7.7, FB1 = 1.55, FW = 1.86, FY = ROOF + 0.12;
  box('white', S0 - FB0 + 0.05, 0.14, 2 * FW + 0.1, (FB0 + S0) / 2, ROOF + 0.05, 0);
  for (const pz of [-1.7, 1.7]) add('steel', new THREE.CylinderGeometry(0.04, 0.04, ROOF - FLOOR, 12), FB0 + 0.25, (ROOF + FLOOR) / 2, pz);
  const coam = px => FW - 0.35 * Math.pow(clamp01((px - (-1)) / (FB1 + 0.1 - (-1))), 2);
  const coaming = [];
  for (let i = 0; i < 60; i++) {
    const xa = FB0 + 1.0 + (FB1 - FB0 - 1.0) * i / 60, xb = FB0 + 1.0 + (FB1 - FB0 - 1.0) * (i + 1) / 60;
    for (const side of [-1, 1]) {
      const h = px => 0.55 + 0.1 * clamp01((px - (-1)) / 2.5);
      const o = [[xa, FY, side * coam(xa)], [xb, FY, side * coam(xb)], [xb, FY + h(xb), side * (coam(xb) - 0.04)], [xa, FY + h(xa), side * (coam(xa) - 0.04)]];
      const inr = o.map(([px, py, pz]) => [px, py, pz - side * 0.08]);
      if (side > 0) { quad(coaming, ...o); quad(coaming, inr[0], inr[3], inr[2], inr[1]); } else { quad(coaming, o[0], o[3], o[2], o[1]); quad(coaming, ...inr); }
      quad(coaming, o[3], o[2], inr[2], inr[3]);
    }
  }
  raw('white', coaming);
  { const pts = []; for (let k = 0; k <= 16; k++) { const a = -Math.PI / 2 + Math.PI * k / 16; pts.push(V(FB1 + 0.05 * Math.cos(a), FY, coam(FB1) * Math.sin(a))); }
    // the forward fairing closing the coaming
    const out = []; for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1]; quad(out, [a.x, a.y, a.z], [b.x, b.y, b.z], [b.x, b.y + 0.65, b.z], [a.x, a.y + 0.65, a.z]); } raw('white', out); }
  // The helm, starboard forward: console, dashboard with two displays and
  // switch panels, a small curved windscreen, the wheel, throttles, a
  // double helm seat.
  const HX = FB1 - 0.55, HZ = 0.8;
  box('white', 0.75, 0.95, 1.35, HX, FY + 0.47, HZ);
  add('dark', new THREE.BoxGeometry(0.62, 0.04, 1.25), HX - 0.02, FY + 1.0, HZ, 0, 0, 0.45);
  for (const dz of [-0.3, 0.3]) add('screen', new THREE.BoxGeometry(0.02, 0.24, 0.38), HX - 0.1, FY + 1.1, HZ + dz, 0, 0, 0.45);
  for (let k = 0; k < 6; k++) add('frame', new THREE.CylinderGeometry(0.02, 0.02, 0.02, 10), HX + 0.15, FY + 1.02 + 0.02, HZ - 0.5 + k * 0.2, 0, 0, Math.PI / 2 - 0.45);
  { const ws = new THREE.CylinderGeometry(0.75, 0.75, 0.32, 24, 1, true, -0.7, 1.4); ws.rotateY(Math.PI / 2); add('glass', ws, HX - 0.55, FY + 1.2, HZ, 0, 0, 0.3); }
  const wheel = new THREE.TorusGeometry(0.2, 0.018, 8, 32); wheel.rotateY(Math.PI / 2); add('steel', wheel, HX - 0.42, FY + 1.02, HZ, 0, 0, 0.4);
  for (let k = 0; k < 3; k++) { const a = k * 2 * Math.PI / 3, g = new THREE.CylinderGeometry(0.01, 0.01, 0.2, 6); g.translate(0, 0.1, 0); g.rotateX(a); add('steel', g, HX - 0.42, FY + 1.02, HZ, 0, 0, 0.4); }
  for (const dz of [-0.45, -0.38]) add('steel', new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), HX - 0.2, FY + 1.1, HZ + dz, 0, 0, -0.5);
  for (const dz of [-0.28, 0.28]) { box('cushion', 0.55, 0.15, 0.55, HX - 1.05, FY + 0.5, HZ + dz); box('cushion', 0.12, 0.55, 0.55, HX - 1.35, FY + 0.85, HZ + dz); box('white', 0.45, 0.42, 0.45, HX - 1.05, FY + 0.21, HZ + dz); }
  // The sunpad to port forward, with a pillow.
  box('white', 2.1, 0.25, 1.4, FB1 - 1.25, FY + 0.12, -1.0);
  for (let k = 0; k < 2; k++) { box('cushion', 1.02, 0.14, 1.36, FB1 - 1.25 - 0.52 + k * 1.04, FY + 0.32, -1.0); box('piping', 1.03, 0.012, 1.37, FB1 - 1.25 - 0.52 + k * 1.04, FY + 0.39, -1.0); }
  // U-shaped seating aft round a teak table; the wet bar to port with sink
  // and grill; a cool box.
  const U0 = -5.6;
  for (const [px, pz, w, d] of [[U0, 0, 0.6, 3.1], [U0 + 1.05, 1.45, 1.5, 0.6], [U0 + 1.05, -1.45, 1.5, 0.6]]) {
    box('white', w, 0.4, d, px, FY + 0.2, pz);
    const n = Math.max(1, Math.round(Math.max(w, d) / 0.7));
    for (let k = 0; k < n; k++) { const f = (k + 0.5) / n - 0.5; box('cushion', w > d ? w / n - 0.02 : w - 0.04, 0.12, d > w ? d / n - 0.02 : d - 0.04, px + (w > d ? f * w : 0), FY + 0.46, pz + (d > w ? f * d : 0)); }
  }
  for (let k = 0; k < 4; k++) box('cushion', 0.13, 0.45, 0.73, U0 - 0.22, FY + 0.72, -1.1 + k * 0.74);
  box('teak', 1.1, 0.04, 1.6, U0 + 1.05, FY + 0.72, 0);
  for (let pz = -0.7; pz <= 0.7; pz += 0.12) box('seam', 1.1, 0.042, 0.006, U0 + 1.05, FY + 0.72, pz);
  add('steel', new THREE.CylinderGeometry(0.05, 0.05, 0.7, 12), U0 + 1.05, FY + 0.36, 0);
  box('white', 1.3, 0.9, 0.6, -2.0, FY + 0.45, -1.45);
  box('dark', 0.45, 0.02, 0.4, -2.3, FY + 0.91, -1.45); box('steel', 0.35, 0.03, 0.3, -1.7, FY + 0.91, -1.45);
  add('steel', new THREE.CylinderGeometry(0.012, 0.012, 0.25, 8), -1.7, FY + 1.03, -1.62);
  box('white', 0.5, 0.35, 0.4, -2.0, FY + 0.18, 0.4);
  // The radar arch: an elliptical tube in a shallow arch, the radome, the
  // masthead light, two antennas, a searchlight and horns.
  { const pts = []; for (let k = 0; k <= 20; k++) { const a = Math.PI * k / 20; pts.push(V(-2.75 - 0.35 * Math.sin(a), FY + 1.95 * Math.sin(a) + 0.05, -1.6 * Math.cos(a))); }
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.14, 12); g.scale(1.25, 1, 1); g.translate(-2.75 * -0.25 * 0, 0, 0); add('white', g); }
  add('white', new THREE.CylinderGeometry(0.44, 0.46, 0.22, 32), -3.1, FY + 2.15, 0);
  add('white', new THREE.SphereGeometry(0.44, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.25, 1), -3.1, FY + 2.26, 0);
  add('lamp', new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), -3.1, FY + 2.45, 0.6);
  for (const [dz, h] of [[0.8, 2.2], [-0.8, 1.6]]) add('white', new THREE.CylinderGeometry(0.015, 0.025, h, 6), -3.0, FY + 2.05 + h / 2, dz);
  add('dark', new THREE.CylinderGeometry(0.1, 0.12, 0.2, 16), -2.75, FY + 2.05, -0.6, 0, 0, Math.PI / 2);
  for (const dz of [0.3, 0.45]) add('steel', new THREE.ConeGeometry(0.05, 0.25, 12), -2.6, FY + 1.95, dz, 0, 0, Math.PI / 2);
  // Rails round the open aft end of the flybridge.
  for (const side of [-1, 1]) tube('steel', [V(FB0 + 0.1, FY + 0.95, side * (FW - 0.05)), V(FB0 + 0.5, FY + 0.97, side * (FW - 0.05)), V(FB0 + 1.1, FY + 0.95, side * (FW - 0.05))], 0.022, 8);
  tube('steel', [V(FB0 + 0.1, FY + 0.95, -FW + 0.05), V(FB0 + 0.08, FY + 0.95, -0.9)], 0.022, 8);
  for (const side of [-1, 1]) for (const px of [FB0 + 0.1, FB0 + 0.6, FB0 + 1.1]) add('steel', new THREE.CylinderGeometry(0.015, 0.015, 0.95, 8), px, FY + 0.47, side * (FW - 0.05));
  // The ensign on its staff at the transom: the national flag.
  add('steel', new THREE.CylinderGeometry(0.018, 0.022, 1.3, 8), AFT + 0.2, 1.45 + 0.65, -1.95);
  // The flag itself is the shared one (flag.js createFlagSet), hung from
  // the staff's top via `flags` below.

  // ================= People sunbathing ==========================================
  // Two on the foredeck sunpad, head to the backrest; one on the flybridge
  // sunpad with a book; a drink on the flybridge table.
  function person({px, py, pz, yaw, skin, hair, suit, towel, bikini = false, knee = 0, arms = 0, book = false, hat = false}) {
    const frame = new THREE.Matrix4().makeRotationY(yaw).setPosition(px, py, pz);
    const at = (a, y, b) => new THREE.Vector3(a, y, b).applyMatrix4(frame);
    const put = (key, g) => { g.applyMatrix4(frame); add(key, g); };
    const limb = (key, a, b, r0, r1 = r0) => {                                                // a tapered limb with round ends
      const pa = at(...a), pb = at(...b), len = pa.distanceTo(pb), g = new THREE.CylinderGeometry(r1, r0, len, 14, 1, true);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), pb.clone().sub(pa).normalize())); g.translate((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2); add(key, g);
      for (const [p, r] of [[pa, r0], [pb, r1]]) add(key, new THREE.SphereGeometry(r, 14, 10), p.x, p.y, p.z);
    };
    const blob = (key, a, y, b, r, sx, sy, sz, seg = 20) => { const g = new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7)); g.scale(sx, sy, sz); g.translate(a, y, b); put(key, g); };
    // The towel, with two stripes.
    { const g = new THREE.BoxGeometry(1.95, 0.015, 0.85); g.translate(0.02, 0.008, 0); put(towel, g);
      for (const d of [-0.7, 0.72]) { const s = new THREE.BoxGeometry(0.1, 0.017, 0.851); s.translate(d, 0.008, 0); put('stripe', s); } }
    // Head, hair, neck; torso in three parts; the swimsuit over them.
    blob(skin, 0.8, 0.115, 0, 0.1, 1.12, 0.95, 0.9);
    blob(hair, 0.83, 0.1, 0, 0.108, 1.1, 0.9, 0.95);
    blob(skin, 0.7, 0.115, 0, 0.018, 1, 1, 1, 8);                                             // chin
    limb(skin, [0.66, 0.1, 0], [0.58, 0.1, 0], 0.052);
    blob(skin, 0.43, 0.115, 0, 0.17, 1.05, 0.6, 1.2);                                          // chest
    blob(skin, 0.22, 0.1, 0, 0.14, 1.05, 0.62, 1.05);                                          // waist
    blob(suit, 0.02, 0.1, 0, 0.152, 0.95, 0.7, 1.22);                                          // hips, in the swimsuit
    if (bikini) { for (const s of [-1, 1]) blob(suit, 0.45, 0.17, s * 0.09, 0.07, 1, 0.55, 1.1, 14); limb(suit, [0.45, 0.16, -0.09], [0.45, 0.16, 0.09], 0.012); }
    // Legs: thigh, shin, foot; one knee may be raised.
    for (const s of [-1, 1]) {
      const up = s > 0 ? knee : 0, hip = [0.0, 0.09, s * 0.09], kneeP = [-0.4 + up * 0.12, 0.09 + up * 0.35, s * 0.105], ankle = [-0.78 + up * 0.22, 0.06, s * 0.11];
      limb(skin, hip, kneeP, 0.085, 0.056); limb(skin, kneeP, ankle, 0.052, 0.034);
      blob(skin, ankle[0] - 0.05, ankle[1] + 0.03, ankle[2], 0.05, 1.3, 0.55, 0.7, 12);       // foot
      if (!bikini) limb(suit, [0.0, 0.09, s * 0.09], [-0.14, 0.09, s * 0.1], 0.089);          // trunks' legs
    }
    // Arms by the sides, or hands behind the head.
    for (const s of [-1, 1]) {
      const sh = [0.55, 0.11, s * 0.2];
      if (arms && s > 0) { const el = [0.85, 0.18, s * 0.3]; limb(skin, sh, el, 0.045, 0.038); limb(skin, el, [0.88, 0.14, s * 0.06], 0.037, 0.03); }
      else if (book) { const el = [0.3, 0.12, s * 0.27]; limb(skin, sh, el, 0.045, 0.038); limb(skin, el, [0.42, 0.3, s * 0.1], 0.037, 0.03); }
      else { const el = [0.3, 0.07, s * 0.27]; limb(skin, sh, el, 0.045, 0.038); limb(skin, el, [0.05, 0.05, s * 0.29], 0.037, 0.03); blob(skin, -0.03, 0.045, s * 0.29, 0.045, 1.4, 0.5, 0.9, 10); }
    }
    // Sunglasses on the face.
    for (const s of [-1, 1]) { const g = new THREE.CylinderGeometry(0.028, 0.028, 0.01, 14); g.translate(0.86, 0.21, s * 0.035); put('dark', g); }
    limb('dark', [0.86, 0.212, -0.02], [0.86, 0.212, 0.02], 0.004);
    if (book) { const g = new THREE.BoxGeometry(0.2, 0.03, 0.28); g.rotateZ(0.9); g.translate(0.46, 0.34, 0); put('book', g); }
    if (hat) { const brim = new THREE.CylinderGeometry(0.24, 0.24, 0.01, 24); brim.translate(1.02, 0.03, 0.25); put('straw', brim); const crown = new THREE.CylinderGeometry(0.1, 0.11, 0.09, 20); crown.translate(1.02, 0.08, 0.25); put('straw', crown); }
  }
  const padTop = fy(5) + 0.35;
  person({px: 5.3, py: padTop, pz: -0.62, yaw: Math.PI, skin: 'skin1', hair: 'hair2', suit: 'suitB', towel: 'towel1', bikini: true, arms: 1, hat: true});
  person({px: 5.3, py: padTop, pz: 0.62, yaw: Math.PI, skin: 'skin2', hair: 'hair1', suit: 'suitA', towel: 'towel2', knee: 1});
  person({px: FB1 - 1.3, py: FY + 0.39, pz: -1.0, yaw: 0, skin: 'skin3', hair: 'hair1', suit: 'suitC', towel: 'towel3', book: true});
  { add('drink', new THREE.CylinderGeometry(0.035, 0.03, 0.14, 16), U0 + 1.2, FY + 0.81, 0.3); add('steel', new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), U0 + 1.21, FY + 0.88, 0.31, 0.2); }

  // ================= Moored ======================================================
  // Fenders on the port side, bow, spring and stern lines to the pontoon.
  for (const fx of [-6.2, -3.2, -0.2, 2.8, 5.2]) {
    const t = tOf(fx), zz = -(hullZ(fx, 0.7) + 0.16);
    add('fender', new THREE.CapsuleGeometry(0.14, 0.55, 6, 16), fx, 0.7, zz);
    add('rope', new THREE.CylinderGeometry(0.008, 0.008, gunY(t) - 1.05, 4), fx, (gunY(t) + 1.05) / 2, -(gunHB(t) - 0.08));
  }
  const line = (a, b, sag = 0.35) => tube('rope', [a, a.clone().lerp(b, 0.33).setY(Math.min(a.y, b.y) - sag * 0.8), a.clone().lerp(b, 0.66).setY(Math.min(a.y, b.y) - sag * 0.8), b], 0.022, 6);
  line(V(7.3, gunY(tOf(7.3)) + 0.1, -1.4), V(11.2, 0.45, -3.05));
  line(V(0.3, gunY(tOf(0.3)) + 0.1, -2.2), V(-2.8, 0.45, -3.05), 0.2);
  line(V(AFT + 0.5, gunY(0) + 0.1, -2.2), V(AFT - 3.5, 0.45, -3.05));

  const triangles = finish(group);
  group.updateMatrixWorld(true);
  const flags = [{top: group.localToWorld(V(AFT + 0.2, 2.72, -1.95)), length: 0.75, parent: group}];   // on the yacht: it sails (rivertour.js)

  // ================= The pontoons ==============================================
  // A floating deck 0.47 m over the water with dark floats, as OSM maps
  // them; cleats, a power pedestal and lamp posts along the yacht's berth.
  const pm = {deck: M('#a8a39a', {roughness: 0.9}), float: M('#3a3d40', {roughness: 0.8}), steel: M('#d9dde0', {roughness: 0.3, metalness: 0.8}), post: M('#eceae4'), lamp: M('#fff3d0', {emissive: '#ffe2a0', emissiveIntensity: 0.8})};
  const pb = builder(pm, 'marina');
  const shape = new THREE.Shape(YACHT.pontoon.map(([lon, lat]) => { const [px, pz] = project(lon, lat); return new THREE.Vector2(px, -pz); }));
  const top = new THREE.ExtrudeGeometry(shape, {depth: 0.12, bevelEnabled: false}); top.rotateX(-Math.PI / 2); top.translate(0, 0.23, 0);
  const floats = new THREE.ExtrudeGeometry(shape, {depth: 0.5, bevelEnabled: false}); floats.rotateX(-Math.PI / 2); floats.translate(0, WATER - 0.25, 0);
  pb.add('deck', top); pb.add('float', floats);
  group.updateMatrixWorld(true);
  const onPontoon = (along) => group.localToWorld(V(along, 0.35, -3.25));
  for (const along of [-10, -3.5, 3, 9.5]) { const p = onPontoon(along); pb.add('steel', new THREE.BoxGeometry(0.3, 0.08, 0.08), p.x, p.y + 0.06, p.z, 0, group.rotation.y, 0); }
  { const p = onPontoon(-1.5); pb.add('post', new THREE.CylinderGeometry(0.14, 0.16, 1.0, 16), p.x, p.y + 0.5, p.z); pb.add('lamp', new THREE.CylinderGeometry(0.12, 0.12, 0.12, 16), p.x, p.y + 1.06, p.z); }
  for (const along of [-12, 6]) { const p = group.localToWorld(V(along, 0.35, -4.4)); pb.add('post', new THREE.CylinderGeometry(0.04, 0.05, 3.2, 10), p.x, p.y + 1.6, p.z); pb.add('lamp', new THREE.SphereGeometry(0.16, 16, 10), p.x, p.y + 3.3, p.z); }
  const marina = new THREE.Group(); marina.name = 'marina-pontoons';
  const pontoonTriangles = pb.finish(marina);

  outer.add(group, marina);
  scene.add(outer);
  const view = {target: group.localToWorld(V(0, 2, 0)), eye: group.localToWorld(V(-22, 14, 26))};
  const state = {name: 'Princess 60 at the Vinhomes Central Park Marina', lon: YACHT.lon, lat: YACHT.lat, length: YACHT.length, beam: YACHT.beam, sunbathers: 3, triangles, pontoonTriangles, drawCalls: group.children.length + marina.children.length, schematic: false};
  const all = {...materials, ...pm};
  // Moored: lines ashore and fenders out; underway (rivertour.js) both are in.
  const setMoored = on => { for (const n of ['yacht-rope', 'yacht-fender']) { const m = group.getObjectByName(n); if (m) m.visible = on; } state.moored = on; };
  state.moored = true;
  return {group: outer, yacht: group, state, view, flags, setMoored, replaceGeneric: () => 0, dispose() { scene.remove(outer); for (const g of [group, marina]) for (const m of g.children) m.geometry.dispose(); for (const m of Object.values(all)) m.dispose(); }};
}
