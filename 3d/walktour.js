// The walking tour down Đồng Khởi, from Công xã Paris (the cathedral and the
// Post Office) to the river at Tôn Đức Thắng and back up the other side.
// Built only when the tour starts and freed when it ends: close-up shopfronts
// along both street walls, tall street trees, granite sidewalks with their
// kerbs, and the street's lamp posts -- about a million triangles in all.
//
// Where the city model has a building on the street (walktour-street.js),
// its ground and first floors get a shopfront. Where OSM maps nothing, which
// is most of this street's shophouses, whole shophouses are built. Modelled
// landmarks (the Continental, the Opera House, the Majestic and others) and
// the cross streets are left open.
//
// The camera follows a walker at walking pace (followView()), with the same
// turn, tilt and zoom as the river tour. See WALKTOUR.md.
import * as THREE from 'three';
import {DONG_KHOI as D} from './walktour-street.js';

export const WALK = Object.freeze({
  speed: 1.35,         // m/s, a stroll
  road: 5.2,           // half-width of the carriageway, to the kerb (m)
  kerb: 0.15,          // kerb height above the road
  defaultLine: 12.5,   // where built shophouses stand, from the centreline (m)
  walkAt: 8.4,         // the walker's line, from the centreline (m)
  treeEvery: 11,       // m between trees along each kerb
});
const ROAD_Y = 0.3;                        // the generic road surface
const WALK_Y = ROAD_Y + WALK.kerb;         // the sidewalk

// Deterministic randomness, so every visit looks the same.
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917)) >>> 0) / 4294967296; }

/** The street as a path in world metres: position, direction, left normal. */
function street(project) {
  const p = D.centreline.map(([lon, lat]) => project(lon, lat)), cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  const scale = D.length / cum.at(-1);
  function at(s) {
    const u = Math.max(0, Math.min(cum.at(-1), s / scale));
    let i = 1; while (i < p.length - 1 && cum[i] < u) i++;
    const a = p[i - 1], b = p[i], t = (u - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    // Direction smoothed over 8 m, so offsets round the bends stay smooth.
    const d = (x) => { const uu = Math.max(0, Math.min(cum.at(-1), x / scale)); let j = 1; while (j < p.length - 1 && cum[j] < uu) j++; const tt = (uu - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1); return [p[j - 1][0] + (p[j][0] - p[j - 1][0]) * tt, p[j - 1][1] + (p[j][1] - p[j - 1][1]) * tt]; };
    const f = d(s + 4), g = d(s - 4), dx = f[0] - g[0], dz = f[1] - g[1], l = Math.hypot(dx, dz) || 1;
    const fx = dx / l, fz = dz / l;
    return {x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, fx, fz, lx: fz, lz: -fx};   // left of travel: (fz, -fx)
  }
  return {at, length: D.length};
}
const inCross = (s, pad = 0) => D.cross.some(([c, h]) => Math.abs(s - c) < h + pad);

/** Collects triangles per material; with optional per-vertex colour. */
function buffers(keys) {
  const b = Object.fromEntries(keys.map(k => [k, {pos: [], col: []}]));
  const quad = (k, a, bb, c, d, col) => { b[k].pos.push(...a, ...bb, ...c, ...a, ...c, ...d); if (col) for (let i = 0; i < 6; i++) b[k].col.push(...col); };
  // A box in a frame: centre (x, y, z), along-street axis (ax, az), size w (along) x h x d (out), out normal (nx, nz).
  function box(k, x, y, z, ax, az, nx, nz, w, h, d, col) {
    const c = (u, v, o) => [x + ax * u + nx * o, y + v, z + az * u + nz * o];
    const u0 = -w / 2, u1 = w / 2, v0 = -h / 2, v1 = h / 2, o0 = -d / 2, o1 = d / 2;
    quad(k, c(u0, v0, o1), c(u1, v0, o1), c(u1, v1, o1), c(u0, v1, o1), col);   // front
    quad(k, c(u1, v0, o0), c(u0, v0, o0), c(u0, v1, o0), c(u1, v1, o0), col);   // back
    quad(k, c(u0, v1, o1), c(u1, v1, o1), c(u1, v1, o0), c(u0, v1, o0), col);   // top
    quad(k, c(u0, v0, o0), c(u1, v0, o0), c(u1, v0, o1), c(u0, v0, o1), col);   // bottom
    quad(k, c(u0, v0, o0), c(u0, v0, o1), c(u0, v1, o1), c(u0, v1, o0), col);   // ends
    quad(k, c(u1, v0, o1), c(u1, v0, o0), c(u1, v1, o0), c(u1, v1, o1), col);
  }
  return {b, quad, box};
}

export function createWalkTour({scene, project}) {
  const st = street(project), R = rng(20260926);
  const root = new THREE.Group(); root.name = 'walk-tour';
  const M = (color, o = {}) => new THREE.MeshStandardMaterial({color, roughness: 0.7, ...o});
  const materials = {
    paving: M('#b9b2a6', {roughness: 0.95}), kerb: M('#9c9892', {roughness: 0.9}), wall: M('#ffffff', {vertexColors: true, roughness: 0.85}),
    trim: M('#f4f0e6', {roughness: 0.75}), glass: M('#26313a', {roughness: 0.08, metalness: 0.6}), lit: M('#fff1cf', {emissive: '#ffd79a', emissiveIntensity: 0.55, roughness: 0.5}),
    frame: M('#2a2b2c', {roughness: 0.5, metalness: 0.5}), sign: M('#ffffff', {vertexColors: true, roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.12}),
    awning: M('#ffffff', {vertexColors: true, roughness: 0.9, side: THREE.DoubleSide}), rail: M('#1e2224', {roughness: 0.5, metalness: 0.6}),
    ac: M('#e6e6e2', {roughness: 0.6}), roof: M('#b0603f', {roughness: 0.9}),
    bark: M('#5b4a3a', {roughness: 1}), leaf: M('#ffffff', {vertexColors: true, roughness: 0.9, flatShading: true}),
    lamp: M('#223a30', {roughness: 0.5, metalness: 0.5}), bulb: M('#fff7e0', {emissive: '#ffe6b0', emissiveIntensity: 1.0}),
    pot: M('#8b5a3c', {roughness: 0.9}), shrub: M('#3f6b35', {roughness: 1, flatShading: true}),
  };
  const {b, quad, box} = buffers(Object.keys(materials));

  // --- Sidewalks and kerbs, both sides, round the cross streets. -----------
  for (const side of [1, -1]) {
    for (let s = 0; s < st.length; s += 3) {
      const s1 = Math.min(st.length, s + 3);
      const A = st.at(s), B = st.at(s1), line = s2 => frontage(side, s2) ?? WALK.defaultLine;
      if (inCross(s + 1.5)) continue;
      const P = (f, o, y) => [f.x + f.lx * side * o, y, f.z + f.lz * side * o];
      const oa = Math.min(line(s), 23), ob = Math.min(line(s1), 23);   // paved up to the frontage, set back or not
      const outer = side > 0;                                              // keep faces upward whichever side
      const q = (a, bb, c, d) => outer ? quad('paving', a, bb, c, d) : quad('paving', a, d, c, bb);
      q(P(A, WALK.road, WALK_Y), P(B, WALK.road, WALK_Y), P(B, ob, WALK_Y), P(A, oa, WALK_Y));
      // The kerb's face towards the road.
      const k = (a, bb, c, d) => outer ? quad('kerb', a, d, c, bb) : quad('kerb', a, bb, c, d);
      k(P(A, WALK.road, ROAD_Y), P(B, WALK.road, ROAD_Y), P(B, WALK.road, WALK_Y), P(A, WALK.road, WALK_Y));
    }
  }
  function frontage(side, s) {
    const arr = side > 0 ? D.left : D.right, i = Math.round(s / D.step);
    const v = arr[Math.max(0, Math.min(arr.length - 1, i))];
    return v === 'L' ? null : v;
  }
  const landmarkAt = (side, s) => (side > 0 ? D.left : D.right)[Math.max(0, Math.min(D.left.length - 1, Math.round(s / D.step)))] === 'L';

  // --- Shopfronts and shophouses. -------------------------------------------
  const WALLS = ['#efe6d2', '#f3efe6', '#e9d8b8', '#f1e3c8', '#e6e0d4', '#f0d9c4', '#ddd5c5', '#f5f1e8'];
  const SIGNS = ['#b3202a', '#1f4e8c', '#111111', '#c9a14a', '#0f6b4f', '#e2e2e2', '#6b2a58', '#d2682a', '#253238'];
  const AWNS = ['#1f3f2f', '#7a1c1c', '#26324a', '#3b3b3b', '#9c8a6a', '#1d4d57'];
  const hex = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
  let units = 0;
  for (const side of [1, -1]) {
    let s = 2;
    while (s < st.length - 2) {
      if (inCross(s, 1) || landmarkAt(side, s)) { s += 1.5; continue; }
      const face = frontage(side, s), built = face === null || face > 22;
      const w = 4 + R() * 4.5;
      let e = Math.min(st.length - 2, s + w);
      // Stop the unit short of a gap, a landmark, or a change of kind.
      for (let t = s + 1; t <= e; t += 1) if (inCross(t, 1) || landmarkAt(side, t) || ((frontage(side, t) === null || frontage(side, t) > 22) !== built)) { e = t - 1; break; }
      if (e - s < 2.2) { s = e + 1.5; continue; }
      shop(side, s, e, built ? WALK.defaultLine : face, built);
      units++; s = e;
    }
  }
  function shop(side, s0, s1, line, built) {
    const mid = st.at((s0 + s1) / 2), w = s1 - s0;
    const ax = mid.fx, az = mid.fz, nx = -mid.lx * side, nz = -mid.lz * side;      // outward from the building, into the street
    const ox = mid.x + mid.lx * side * line, oz = mid.z + mid.lz * side * line;
    const at = (u, y, o = 0) => [ox + ax * u + nx * o, y, oz + az * u + nz * o];
    const Q = (k, u0, y0, u1, y1, o, col) => quad(k, at(u0, y0, o), at(u1, y0, o), at(u1, y1, o), at(u0, y1, o), col);
    const B = (k, u, y, o, bw, bh, bd, col) => box(k, ...at(u, y, o), ax, az, nx, nz, bw, bh, bd, col);
    const u0 = -w / 2, u1 = w / 2, G = WALK_Y, GF = 4.6;
    const wall = hex(WALLS[Math.floor(R() * WALLS.length)]), sign = hex(SIGNS[Math.floor(R() * SIGNS.length)]), awn = hex(AWNS[Math.floor(R() * AWNS.length)]);
    const storeys = built ? 3 + Math.floor(R() * 4) : 1, FH = 3.4, top = G + GF + storeys * FH;
    if (built) {
      // The shophouse's own front wall above the shop, and its sides.
      Q('wall', u0, G + GF, u1, top, 0, wall);
      for (const [u, sgn] of [[u0, -1], [u1, 1]]) quad('wall', at(u, G, 0), at(u, G, -18), at(u, top, -18), at(u, top, 0), wall), sgn;
      B('trim', 0, top + 0.35, 0.2, w + 0.2, 0.7, 0.5);                            // cornice and parapet
      if (R() < 0.35) { const roofH = 2.2; quad('roof', at(u0, top + 0.7, 0.3), at(u1, top + 0.7, 0.3), at(u1, top + 0.7 + roofH, -4), at(u0, top + 0.7 + roofH, -4)); }
    }
    // Ground floor: piers, a glazed shopfront in a dark frame with a door,
    // a lit interior strip, the fascia sign with a lettering band, an awning.
    B('trim', u0 + 0.25, G + GF / 2, 0.12, 0.5, GF, 0.3);
    B('trim', u1 - 0.25, G + GF / 2, 0.12, 0.5, GF, 0.3);
    const gw = w - 1.1, g0 = -gw / 2, gy0 = G + 0.35, gy1 = G + 3.35;
    Q('glass', g0, gy0, g0 + gw, gy1, 0.04);
    Q('lit', g0 + 0.1, gy1 - 0.25, g0 + gw - 0.1, gy1 - 0.12, -0.3);
    const mull = Math.max(2, Math.round(gw / 1.3));
    for (let k = 0; k <= mull; k++) B('frame', g0 + gw * k / mull, (gy0 + gy1) / 2, 0.08, 0.07, gy1 - gy0, 0.08);
    B('frame', 0, gy0, 0.08, gw, 0.08, 0.1); B('frame', 0, gy1, 0.08, gw, 0.1, 0.1); B('frame', 0, gy0 + 2.3, 0.08, gw, 0.05, 0.06);
    const door = (R() - 0.5) * gw * 0.4;
    B('frame', door, gy0 + 1.1, 0.1, 1.5, 2.2, 0.05);
    Q('glass', door - 0.6, gy0 + 0.05, door + 0.6, gy0 + 2.15, 0.13);
    B('sign', 0, G + 3.95, 0.25, w - 0.7, 0.75, 0.18, sign);
    for (let k = 0, n = 3 + Math.floor(R() * 7); k < n; k++) B('lit', (k - (n - 1) / 2) * 0.42, G + 3.95, 0.35, 0.3, 0.32, 0.03);   // letters
    if (R() < 0.7) {
      const out = 1.6 + R() * 0.8, y = G + 3.45;
      quad('awning', at(u0 + 0.35, y, 0.1), at(u1 - 0.35, y, 0.1), at(u1 - 0.35, y - 0.55, out), at(u0 + 0.35, y - 0.55, out), awn);
      const n = Math.max(3, Math.round(w * 2));                                   // the scalloped valance
      for (let k = 0; k < n; k++) { const a = u0 + 0.35 + (w - 0.7) * k / n, c = u0 + 0.35 + (w - 0.7) * (k + 1) / n;
        quad('awning', at(a, y - 0.55, out), at(c, y - 0.55, out), at(c, y - 0.8, out), at((a + c) / 2, y - 0.9, out), awn); }
    }
    if (R() < 0.5) for (const u of [g0 + 0.4, g0 + gw - 0.4]) { B('pot', u, G + 0.3, 0.6, 0.5, 0.6, 0.5); addBlob('shrub', ...at(u, G + 0.95, 0.6), 0.45, 1); }
    // Upper floors of a shophouse: windows (arched on some), balconies with
    // railings, air-conditioner units, a pilaster between bays.
    if (!built) return;
    const bays = Math.max(1, Math.round(w / 2.4)), bw = w / bays, arched = R() < 0.4;
    for (let f = 0; f < storeys; f++) {
      const y0 = G + GF + f * FH;
      B('trim', 0, y0 + 0.05, 0.12, w, 0.25, 0.25);
      const balcony = R() < 0.55;
      if (balcony) { B('trim', 0, y0 + 0.2, 0.55, w - 0.3, 0.14, 1.0); for (let k = 0, n = Math.round(w * 2.5); k <= n; k++) B('rail', u0 + 0.2 + (w - 0.4) * k / n, y0 + 0.75, 1.0, 0.03, 1.0, 0.03); B('rail', 0, y0 + 1.25, 1.0, w - 0.4, 0.05, 0.05); }
      for (let k = 0; k < bays; k++) {
        const c = u0 + bw * (k + 0.5), ww = bw * 0.55, wy0 = y0 + 0.9, wy1 = y0 + 2.7;
        Q('glass', c - ww / 2, wy0, c + ww / 2, wy1, -0.12);
        for (const [a, bb, cc, dd] of [[c - ww / 2 - 0.1, wy0 - 0.1, c + ww / 2 + 0.1, wy0], [c - ww / 2 - 0.1, wy1, c + ww / 2 + 0.1, wy1 + 0.1], [c - ww / 2 - 0.1, wy0, c - ww / 2, wy1], [c + ww / 2, wy0, c + ww / 2 + 0.1, wy1]]) Q('trim', a, bb, cc, dd, 0.05);
        if (arched) { const n = 8; for (let j = 0; j < n; j++) { const a0 = Math.PI * j / n, a1 = Math.PI * (j + 1) / n, r = ww / 2 + 0.1;
          quad('trim', at(c + r * Math.cos(a0), wy1 + 0.1 + r * Math.sin(a0) * 0.6, 0.05), at(c + r * Math.cos(a1), wy1 + 0.1 + r * Math.sin(a1) * 0.6, 0.05), at(c + (r - 0.12) * Math.cos(a1), wy1 + 0.1 + (r - 0.12) * Math.sin(a1) * 0.6, 0.05), at(c + (r - 0.12) * Math.cos(a0), wy1 + 0.1 + (r - 0.12) * Math.sin(a0) * 0.6, 0.05)); } }
        B('trim', c - ww / 2 - 0.35, (wy0 + wy1) / 2, 0.06, 0.12, wy1 - wy0, 0.08); B('trim', c + ww / 2 + 0.35, (wy0 + wy1) / 2, 0.06, 0.12, wy1 - wy0, 0.08);   // shutters' edges
        if (R() < 0.3) B('ac', c + ww / 2 + 0.3, y0 + 0.55, 0.3, 0.8, 0.55, 0.3);
      }
      if (bays > 1) for (let k = 1; k < bays; k++) B('trim', u0 + bw * k, y0 + FH / 2, 0.1, 0.3, FH, 0.2);
    }
  }

  // --- Trees: tall, slender trunks and wide leafy crowns, along the kerbs. ----
  const leafGreens = ['#3e6b2f', '#4a7a36', '#35602b', '#577f3a', '#2f5626'].map(hex);
  function addBlob(key, x, y, z, r, detail = 1, col = null) {
    const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const j = 0.82 + 0.3 * R(); p.setXYZ(i, x + p.getX(i) * j, y + p.getY(i) * j * 0.8, z + p.getZ(i) * j); }
    const arr = g.attributes.position.array; b[key].pos.push(...arr);
    if (col) for (let i = 0; i < p.count; i++) b[key].col.push(...col);
    g.dispose();
  }
  function tube(key, a, c, r0, r1, seg = 7) {
    const dir = c.clone().sub(a), len = dir.length(), g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true).toNonIndexed();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.translate((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2); b[key].pos.push(...g.attributes.position.array); g.dispose();
  }
  let trees = 0;
  for (const side of [1, -1]) for (let s = 5 + R() * 4; s < st.length - 4; s += WALK.treeEvery * (0.8 + 0.4 * R())) {
    if (inCross(s, 3) || landmarkAt(side, s) && R() < 0.5) continue;
    const f = st.at(s), o = WALK.road + 1.1, x = f.x + f.lx * side * o, z = f.z + f.lz * side * o;
    const H = 18 + R() * 10, trunkH = H * (0.45 + 0.15 * R()), base = new THREE.Vector3(x, WALK_Y, z);
    // A lean towards the road, as street trees grow towards the light.
    const lean = new THREE.Vector3(-f.lx * side, 0, -f.lz * side).multiplyScalar(0.6 + R() * 1.4);
    const fork = base.clone().add(new THREE.Vector3(lean.x, trunkH, lean.z));
    tube('bark', base, fork, 0.26 + 0.08 * R(), 0.17, 12);
    B2('kerb', x, WALK_Y + 0.06, z, f, 1.4, 0.12, 1.4);                       // the tree pit's rim
    const crownR = 3.5 + R() * 2.5, limbs = 4 + Math.floor(R() * 3);
    for (let k = 0; k < limbs; k++) {
      const a = k / limbs * Math.PI * 2 + R() * 0.8, spread = crownR * (0.6 + 0.3 * R());
      const end = fork.clone().add(new THREE.Vector3(Math.cos(a) * spread, (H - trunkH) * (0.5 + 0.35 * R()), Math.sin(a) * spread));
      tube('bark', fork, end, 0.15, 0.06, 6);
      for (let j = 0; j < 5; j++) addBlob('leaf', end.x + (R() - 0.5) * 2.8, end.y + (R() - 0.3) * 2.0, end.z + (R() - 0.5) * 2.8, 1.2 + R() * 1.0, j < 2 ? 2 : 1, leafGreens[Math.floor(R() * leafGreens.length)]);
      // Twigs from each limb's end, out into the leaves.
      for (let j = 0; j < 3; j++) tube('bark', end, end.clone().add(new THREE.Vector3((R() - 0.5) * 3, 0.6 + R() * 1.5, (R() - 0.5) * 3)), 0.06, 0.025, 5);
    }
    for (let j = 0; j < 6; j++) { const a = R() * Math.PI * 2, r = R() * crownR * 0.7;
      addBlob('leaf', fork.x + Math.cos(a) * r, fork.y + (H - trunkH) * (0.55 + 0.4 * R()), fork.z + Math.sin(a) * r, 1.6 + R() * 1.2, 2, leafGreens[Math.floor(R() * leafGreens.length)]); }
    trees++;
  }
  function B2(k, x, y, z, f, w, h, d) { box(k, x, y, z, f.fx, f.fz, f.lx, f.lz, w, h, d); }

  // --- Lamp posts: dark green columns with a lantern, along the kerbs. ------
  let lamps = 0;
  for (const side of [1, -1]) for (let s = 11; s < st.length - 5; s += 24) {
    if (inCross(s, 2)) continue;
    const f = st.at(s), o = WALK.road + 0.45, x = f.x + f.lx * side * o, z = f.z + f.lz * side * o;
    tube('lamp', new THREE.Vector3(x, WALK_Y, z), new THREE.Vector3(x, WALK_Y + 0.8, z), 0.16, 0.12, 10);
    tube('lamp', new THREE.Vector3(x, WALK_Y + 0.8, z), new THREE.Vector3(x, WALK_Y + 7.5, z), 0.08, 0.06, 8);
    const arm = new THREE.Vector3(x - f.lx * side * 1.6, WALK_Y + 8.1, z - f.lz * side * 1.6);
    tube('lamp', new THREE.Vector3(x, WALK_Y + 7.5, z), arm, 0.05, 0.05, 6);
    addBlob('bulb', arm.x, arm.y - 0.25, arm.z, 0.28, 1);
    box('lamp', arm.x, arm.y, arm.z, f.fx, f.fz, f.lx, f.lz, 0.5, 0.12, 0.5);
    lamps++;
  }

  // --- The meshes. ----------------------------------------------------------
  let triangles = 0;
  for (const [key, {pos, col}] of Object.entries(b)) {
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (materials[key].vertexColors) g.setAttribute('color', new THREE.Float32BufferAttribute(col.length === pos.length ? col : new Array(pos.length).fill(0.8), 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, materials[key]); m.name = `walk-${key}`; root.add(m);
    triangles += pos.length / 9;
  }
  scene.add(root);

  // --- The walker: down the right-hand sidewalk to the river, across, and
  // back up the other side; a loop, started where the tour begins. ----------
  const turnR = WALK.walkAt;
  const lap = 2 * (st.length - 10) + Math.PI * turnR * 2;
  let t0 = null;
  function walkerAt(tSec) {
    let d = (tSec * WALK.speed) % lap;
    const leg = st.length - 10;
    const place = (s, side) => { const f = st.at(s); return {x: f.x + f.lx * side * turnR, z: f.z + f.lz * side * turnR, fx: side < 0 ? f.fx : -f.fx, fz: side < 0 ? f.fz : -f.fz}; };
    if (d < leg) return place(5 + d, -1);                                        // down the south-west side
    d -= leg;
    const half = Math.PI * turnR;
    if (d < half) { const f = st.at(st.length - 5), a = d / turnR; const ox = -Math.cos(a) * turnR, oz = Math.sin(a) * turnR;      // across Tôn Đức Thắng's end
      return {x: f.x + f.lx * ox + f.fx * oz * 0.25, z: f.z + f.lz * ox + f.fz * oz * 0.25, fx: f.lx * Math.sin(a) + f.fx * Math.cos(a) * 0.25, fz: f.lz * Math.sin(a) + f.fz * Math.cos(a) * 0.25}; }
    d -= half;
    if (d < leg) return place(st.length - 5 - d, 1);                              // back up the north-east side
    d -= leg; const f = st.at(5), a = d / turnR;                                   // and across at Công xã Paris
    return {x: f.x + f.lx * Math.cos(a) * turnR, z: f.z + f.lz * Math.cos(a) * turnR, fx: -f.lx * Math.sin(a) + f.fx * Math.cos(a) * 0.25, fz: -f.lz * Math.sin(a) + f.fz * Math.cos(a) * 0.25};
  }
  const state = {street: 'Đồng Khởi', units, trees, lamps, triangles, lapMinutes: +(lap / WALK.speed / 60).toFixed(1), following: null};
  function followView() {
    const now = performance.now() / 1000; if (t0 === null) t0 = now;
    const w = walkerAt(now - t0), l = Math.hypot(w.fx, w.fz) || 1;
    const bob = 0.03 * Math.sin((now - t0) * WALK.speed * 2 * Math.PI / 0.75);
    state.following = {metres: Math.round(((now - t0) * WALK.speed) % lap)};
    return {pos: new THREE.Vector3(w.x, WALK_Y + 1.6 + bob, w.z), forward: new THREE.Vector3(w.fx / l, 0, w.fz / l)};
  }
  function dispose() { root.removeFromParent(); for (const m of root.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }
  return {group: root, state, followView, setFollowing() {}, dispose, walkerAt, lap};
}
