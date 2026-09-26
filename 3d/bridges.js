// Landmark bridges over the Saigon River and its canals. The generic city
// model draws every bridge as a flat road ribbon 6 m up per OSM layer; these
// replace five with their structures, after photographs and published
// dimensions: Ba Son (the arched pylon), Phú Mỹ (the H-pylons 145 m high,
// 45 m over the river), Thủ Thiêm (the humped girder and its swan-neck
// lamps), the Mống (the green steel "rainbow" of 1894) and the Bình Lợi
// railway bridge (the steel arch of 2019). Each deck follows its OSM
// centreline (bridge-lines.js) and meets the generic approach ramps at their
// height at its ends. See BRIDGES.md.
import * as THREE from 'three';
import {builder} from './landmark-kit.js';
import {CENTRELINES} from './bridge-lines.js';

const ROAD_Y = 6.3;              // where the generic model puts a layer-1 bridge (6 m + 0.3)
const WATER_Y = -0.12;

/** A centreline in world metres, with position, heading and left normal at
 *  any distance along it. */
function path(lonLat, project) {
  const p = lonLat.map(([lon, lat]) => project(lon, lat)), cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  const length = cum[cum.length - 1];
  function at(s) {
    s = Math.max(0, Math.min(length, s));
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const a = p[i - 1], b = p[i], t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return {x: a[0] + dx * t, z: a[1] + dz * t, tx: dx / l, tz: dz / l, nx: dz / l, nz: -dx / l};
  }
  return {points: p, length, at};
}

/** Smooth 0 -> 1 between a and b. */
const ease = (s, a, b) => { const t = Math.max(0, Math.min(1, (s - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createBridges({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-bridges';
  const materials = {
    concrete: new THREE.MeshStandardMaterial({color: '#c9c8c3', roughness: 0.85}),
    white: new THREE.MeshStandardMaterial({color: '#eceae4', roughness: 0.7}),
    asphalt: new THREE.MeshStandardMaterial({color: '#4d5256', roughness: 0.95}),
    cable: new THREE.MeshStandardMaterial({color: '#e8ecef', roughness: 0.4, metalness: 0.5}),
    blue: new THREE.MeshStandardMaterial({color: '#8fb1c9', roughness: 0.4, metalness: 0.4}),
    green: new THREE.MeshStandardMaterial({color: '#3f9a7b', roughness: 0.5, metalness: 0.4}),
    steel: new THREE.MeshStandardMaterial({color: '#b9bec2', roughness: 0.45, metalness: 0.5}),
    rail: new THREE.MeshStandardMaterial({color: '#6b5d4f', roughness: 0.8}),
    lamp: new THREE.MeshStandardMaterial({color: '#fff3d0', emissive: '#ffe2a0', emissiveIntensity: 1.0, roughness: 0.5}),
    red: new THREE.MeshStandardMaterial({color: '#c0392f', roughness: 0.7}),
    cream: new THREE.MeshStandardMaterial({color: '#ece6d4', roughness: 0.55, metalness: 0.3}),
    dark: new THREE.MeshStandardMaterial({color: '#2e3134', roughness: 0.8}),
  };
  const {add, finish} = builder(materials, 'bridge');
  const bridges = {};

  // --- Shared pieces ---------------------------------------------------------
  /** Sweep a cross-section along the centreline from s0 to s1: section(s)
   *  gives a closed polygon of [offset to the left, height] points. */
  function sweep(key, line, s0, s1, step, section) {
    const rings = [], n = Math.max(1, Math.ceil((s1 - s0) / step - 1e-9));
    for (let k = 0; k <= n; k++) {                                     // evenly spaced, the last exactly at s1
      const q = s0 + (s1 - s0) * k / n, f = line.at(q);
      rings.push(section(q).map(([o, y]) => [f.x + f.nx * o, y, f.z + f.nz * o]));
    }
    const pos = [], m = rings[0].length;
    for (let r = 1; r < rings.length; r++) for (let i = 0; i < m; i++) {
      const j = (i + 1) % m, a = rings[r - 1][i], b = rings[r - 1][j], c = rings[r][j], d = rings[r][i];
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    for (const [ring, flip] of [[rings[0], true], [rings[rings.length - 1], false]])   // end caps
      for (let i = 1; i < m - 1; i++) pos.push(...ring[0], ...(flip ? ring[i + 1] : ring[i]), ...(flip ? ring[i] : ring[i + 1]));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    add(key, g);
  }
  const rect = (half, y0, y1) => [[-half, y0], [half, y0], [half, y1], [-half, y1]];
  /** A member from a to b (THREE.Vector3s): a cylinder, or a square frustum. */
  function strut(key, a, b, r0, r1 = r0, sides = 6) {
    const len = a.distanceTo(b); if (len < 1e-3) return;
    const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, r0 < 0.3);          // thin members need no end caps
    if (sides === 4) g.rotateY(Math.PI / 4);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    add(key, g);
  }
  /** World point at distance s along, `off` to the left, height y. */
  const P = (line, s, off, y) => { const f = line.at(s); return new THREE.Vector3(f.x + f.nx * off, y, f.z + f.nz * off); };
  /** Deck, parapets and piers common to the road bridges. */
  function roadDeck(line, {width, depth, top, piers = [], pier = 'wall', key = 'concrete'}) {
    const half = width / 2, step = line.length > 1500 ? 10 : 5;
    sweep(key, line, 0, line.length, step, s => [[-half, top(s) - depth], [half, top(s) - depth], [half, top(s) - 0.25], [half - 0.6, top(s) - 0.12], [-half + 0.6, top(s) - 0.12], [-half, top(s) - 0.25]]);
    sweep('asphalt', line, 0, line.length, step, s => rect(half - 0.8, top(s) - 0.13, top(s) - 0.02));
    for (const side of [-1, 1]) sweep('white', line, 0, line.length, step, s => [[side * (half - 0.35), top(s) - 0.1], [side * (half - 0.05), top(s) - 0.1], [side * (half - 0.05), top(s) + 1.0], [side * (half - 0.35), top(s) + 1.0]]);
    for (const s of piers) {
      const f = line.at(s), y = top(s) - depth, base = new THREE.Vector3(f.x, WATER_Y - 1, f.z), head = new THREE.Vector3(f.x, y, f.z);
      if (pier === 'wall') {
        const g = new THREE.BoxGeometry(width * 0.7, y - WATER_Y + 1, 3.2);
        g.rotateY(Math.atan2(f.tx, f.tz)); g.translate(f.x, (y + WATER_Y - 1) / 2, f.z); add('concrete', g);
      } else strut('concrete', base, head, 1.6, 1.4, 12);
    }
  }

  // --- Ba Son (2022): 885.7 m, a 200 m main span from one arched pylon 113 m
  // high on the An Khánh bank, leaning towards it; 56 stays in two planes;
  // triangular fins along the deck's edges. s runs west (District 1) to east.
  {
    const line = path(CENTRELINES.baSon, project), L = line.length;
    const PYLON = 790, width = 26, top = s => ROAD_Y + 7.6 * ease(s, 0, 430) * (1 - ease(s, 880, L));
    const piers = []; for (let s = 40; s < L - 20; s += 45) if (Math.abs(s - PYLON) > 30 && !(s > 580 && s < PYLON)) piers.push(s);
    roadDeck(line, {width, depth: 2.4, top, piers, pier: 'column', key: 'white'});
    for (let s = 20; s < L - 10; s += 10) for (const side of [-1, 1]) {           // the fins
      const f = line.at(s), y = top(s), g = new THREE.BufferGeometry();
      const o = side * (width / 2), a = [f.x + f.nx * o, y - 2.4, f.z + f.nz * o];
      const b = [a[0] + f.tx * 4, y - 2.4, a[2] + f.tz * 4], c = [a[0] + f.tx * 2 + f.nx * side * 1.6, y + 1.4, a[2] + f.tz * 2 + f.nz * side * 1.6];
      g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...b], 3)); g.computeVertexNormals(); add('white', g);
    }
    // The pylon: two legs from either side of the deck curving up to meet at
    // the top, 12 m east of their feet.
    const legs = [-1, 1].map(side => new THREE.CatmullRomCurve3([
      P(line, PYLON - 4, side * (width / 2 + 2.5), 0), P(line, PYLON, side * (width / 2 + 1.5), 40),
      P(line, PYLON + 6, side * 6, 85), P(line, PYLON + 12, side * 0.9, 113),
    ]));
    for (const c of legs) add('white', new THREE.TubeGeometry(c, 30, 1.7, 8, false));
    add('white', new THREE.SphereGeometry(2.2, 10, 8), ...P(line, PYLON + 12, 0, 113).toArray());
    for (const [side, c] of [[-1, legs[0]], [1, legs[1]]]) for (let k = 0; k < 14; k++) {
      const hi = c.getPoint(0.55 + 0.42 * k / 13);
      strut('cable', hi, P(line, PYLON - 20 - k * 13.5, side * (width / 2 - 0.6), top(PYLON - 20 - k * 13.5)), 0.12);   // main span, west
      strut('cable', hi, P(line, PYLON + 18 + k * 7.5, side * (width / 2 - 0.6), top(PYLON + 18 + k * 7.5)), 0.12);      // back span, east
    }
    bridges.baSon = {line, width: width + 6, name: 'Ba Son Bridge', top: 113};
  }

  // --- Phú Mỹ (2009): a 380 m main span between two H-pylons 145 m high,
  // 45 m over the river; a 27 m deck; stays in two fanned planes; approach
  // viaducts on single columns. s runs east (Thủ Đức) to west (District 7).
  {
    const line = path(CENTRELINES.phuMy, project), L = line.length;
    const P1 = 1016, P2 = 1396, width = 27, CREST = 48;
    const top = s => ROAD_Y + (CREST - ROAD_Y) * ease(s, P1 - 720, P1 - 60) * (1 - ease(s, P2 + 60, P2 + 820)) + 1.2 * Math.sin(Math.PI * Math.max(0, Math.min(1, (s - P1) / (P2 - P1))));
    const piers = []; for (let s = 20; s < L; s += 40) if (top(s) > ROAD_Y + 2 && (s < P1 - 30 || s > P2 + 30)) piers.push(s);
    roadDeck(line, {width, depth: 2.8, top, piers, pier: 'column'});
    for (const S of [P1, P2]) {
      const leg = side => ({base: P(line, S, side * 17.5, WATER_Y - 1), deck: P(line, S, side * 15.5, top(S) - 3.5), top: P(line, S, side * 12.5, 145)});
      const L0 = leg(-1), L1 = leg(1);
      for (const l of [L0, L1]) { strut('concrete', l.base, l.deck, 3.2, 2.8, 4); strut('concrete', l.deck, l.top, 2.8, 1.9, 4); }
      const beam = (y, h) => { const a = P(line, S, -15, y), b = P(line, S, 15, y); strut('concrete', a, b, h, h, 4); };
      beam(top(S) - 4.2, 2.2); beam(112, 1.8);
      const f = line.at(S), footing = new THREE.BoxGeometry(46, 4, 18);
      footing.rotateY(Math.atan2(f.tx, f.tz) + Math.PI / 2); footing.translate(f.x, WATER_Y + 1, f.z); add('concrete', footing);
      // Stays: 18 a side in each plane, from the legs between 115 m and
      // 142 m to the deck's edges, fanned over 15-190 m.
      for (const side of [-1, 1]) {
        const l = side < 0 ? L0 : L1;
        for (let k = 0; k < 18; k++) {
          const hi = l.deck.clone().lerp(l.top, (115 - l.deck.y + (k / 17) * 27) / (l.top.y - l.deck.y));
          for (const dir of [-1, 1]) {
            const s = S + dir * (15 + k * 10.3);
            strut('blue', hi, P(line, s, side * (width / 2 - 0.4), top(s)), 0.14, 0.14, 4);
          }
        }
      }
    }
    bridges.phuMy = {line, width: width + 12, name: 'Phú Mỹ Bridge', top: 145};
  }

  // --- Thủ Thiêm (2008): a humped girder in five spans over the river, on
  // wall piers, lined with swan-neck lamp posts. s runs west to east.
  {
    const line = path(CENTRELINES.thuThiem, project), L = line.length;
    const width = 25, top = s => ROAD_Y + 7.5 * ease(s, 60, 360) * (1 - ease(s, 420, L - 60));
    const piers = [120, 170, 214, 280, 346, 413, 480, 547, 600, 650, 700, 750];
    roadDeck(line, {width, depth: 2.6, top, piers});
    for (let s = 30; s < L - 20; s += 36) for (const side of [-1, 1]) {
      const base = P(line, s, side * (width / 2 - 0.3), top(s) + 0.9), c = new THREE.QuadraticBezierCurve3(base, P(line, s, side * (width / 2 + 0.5), top(s) + 10), P(line, s, side * (width / 2 - 2.5), top(s) + 12.5));
      add('steel', new THREE.TubeGeometry(c, 8, 0.14, 5, false));
      add('lamp', new THREE.SphereGeometry(0.35, 6, 4), ...P(line, s, side * (width / 2 - 2.7), top(s) + 12.3).toArray());
    }
    bridges.thuThiem = {line, width: width + 8, name: 'Thủ Thiêm Bridge', top: 20};
  }

  // --- Mống (1894): a steel footbridge whose two side girders sweep up in an
  // arch -- the "rainbow" -- painted green and riveted, across the Bến Nghé.
  {
    const line = path(CENTRELINES.mong, project), L = line.length;
    const width = 5.2, top = s => ROAD_Y + 1.0 * Math.sin(Math.PI * s / L), bottom = s => 1.2 + 4.2 * Math.sin(Math.PI * s / L);
    sweep('asphalt', line, 0, L, 2, s => rect(width / 2, top(s) - 0.3, top(s)));
    for (const side of [-1, 1]) {
      const o = side * (width / 2 + 0.25);
      sweep('green', line, 0, L, 2, s => [[o - 0.2, bottom(s)], [o + 0.2, bottom(s)], [o + 0.2, bottom(s) + 0.7], [o - 0.2, bottom(s) + 0.7]]);   // the arched lower chord
      sweep('green', line, 0, L, 2, s => [[o - 0.2, top(s) + 0.6], [o + 0.2, top(s) + 0.6], [o + 0.2, top(s) + 1.2], [o - 0.2, top(s) + 1.2]]);   // the top chord and handrail
      for (let s = 0; s < L; s += 4) {                                                                                  // lattice between
        strut('green', P(line, s, o, bottom(s) + 0.5), P(line, s + 4, o, top(s + 4) + 0.8), 0.12, 0.12, 4);
        strut('green', P(line, s, o, top(s) + 0.8), P(line, s + 4, o, bottom(s + 4) + 0.5), 0.12, 0.12, 4);
        strut('green', P(line, s, o, bottom(s) + 0.5), P(line, s, o, top(s) + 1.1), 0.1, 0.1, 4);
      }
    }
    for (let s = 0; s <= L; s += 8) strut('green', P(line, s, -width / 2, top(s) - 0.4), P(line, s, width / 2, top(s) - 0.4), 0.15, 0.15, 4);
    for (const s of [2, L - 2]) { const f = line.at(s), g = new THREE.BoxGeometry(8, ROAD_Y + 1, 4); g.rotateY(Math.atan2(f.tx, f.tz)); g.translate(f.x, (ROAD_Y + 1) / 2 - 1, f.z); add('concrete', g); }
    bridges.mong = {line, width: width + 4, name: 'Mống Bridge', top: ROAD_Y + 2.2};
  }

  // --- Bình Lợi railway bridge (2019): 1.3 km of steel spans on piers, with
  // a steel arch 101.5 m long and 16 m high over the channel, 7 m clear.
  // Railways are not in the generic model, so it stands alone.
  {
    const line = path(CENTRELINES.binhLoiRail, project), L = line.length;
    const ARCH = [561, 662], width = 7.7, deck = 9.0;          // rail level: 7 m clear under a 1.8 m deck
    const top = s => 2.0 + (deck - 2.0) * ease(s, 60, 420) * (1 - ease(s, 820, L - 60));
    const piers = []; for (let s = 45; s < L - 30; s += 45) if (s < ARCH[0] - 5 || s > ARCH[1] + 5) piers.push(s);
    piers.push(...ARCH);
    roadDeck(line, {width, depth: 1.8, top, piers, pier: 'wall', key: 'steel'});
    sweep('rail', line, 0, L, 5, s => rect(1.1, top(s) - 0.02, top(s) + 0.12));
    for (const side of [-1, 1]) {
      const o = side * (width / 2 + 0.2), rise = s => top(s) + 16 * Math.sin(Math.PI * (s - ARCH[0]) / (ARCH[1] - ARCH[0]));
      sweep('steel', line, ARCH[0], ARCH[1], 2.5, s => [[o - 0.45, rise(s) - 0.9], [o + 0.45, rise(s) - 0.9], [o + 0.45, rise(s)], [o - 0.45, rise(s)]]);
      for (let s = ARCH[0] + 8, k = 0; s < ARCH[1] - 4; s += 7, k++) {                                               // the network hangers
        strut('steel', P(line, s, o, rise(s) - 0.9), P(line, s + (k % 2 ? 9 : -9), o, top(s) + 0.2), 0.07, 0.07, 4);
      }
    }
    for (let s = ARCH[0] + 10; s < ARCH[1] - 5; s += 10) {                                                           // wind bracing over the track
      const y = top(s) + 16 * Math.sin(Math.PI * (s - ARCH[0]) / (ARCH[1] - ARCH[0])) - 0.5;
      if (y - top(s) > 7) strut('steel', P(line, s, -width / 2, y), P(line, s, width / 2, y), 0.18, 0.18, 4);
    }
    bridges.binhLoiRail = {line, width: width + 4, name: 'Bình Lợi railway bridge', top: deck + 16};
  }

  // --- Girder bridges: a deck on piers, humped over the water, with
  // street lamps and the red-and-white striped kerbs of the city's bridges.
  // ends: the deck's height at its start and end, where the generic ramps
  // are; crest: its height over the middle of the water; water: [s0, s1]
  // stretches over water, where the piers are wall piers.
  function girderBridge(key, {name, width, depth = 2.0, ends, crest, over, span, riverSpan = span, water, lamps = 32, lampSide = 'both', columns = 2, riverPiers = 'columns', profile = null}) {
    const line = path(CENTRELINES[key], project), L = line.length, [a, b] = over;
    const top = profile ? s => profile(s, L) : s => {
      const rise = ease(s, 0, a) * (1 - ease(s, b, L));                   // 0 at the ends, 1 over [a, b]
      const hump = Math.sin(Math.PI * Math.max(0, Math.min(1, (s - a) / (b - a))));
      const base = ends[0] + (ends[1] - ends[0]) * s / L;
      return base + (crest - Math.max(...ends)) * rise * 0.6 + (crest - Math.max(...ends)) * 0.4 * hump + (Math.max(...ends) - base) * rise;
    };
    const inWater = s => water.some(([w0, w1]) => s > w0 - 2 && s < w1 + 2);
    const piers = []; let s = span;
    while (s < L - 8) { piers.push(s); s += inWater(s) ? riverSpan : span; }
    const half = width / 2, step = 10;
    sweep('concrete', line, 0, L, step, q => [[-half + 1.5, top(q) - depth], [half - 1.5, top(q) - depth], [half, top(q) - 0.6], [half, top(q) - 0.2], [-half, top(q) - 0.2], [-half, top(q) - 0.6]]);
    sweep('asphalt', line, 0, L, step, q => rect(half - 0.9, top(q) - 0.2, top(q) - 0.02));
    for (const side of [-1, 1]) {
      sweep('white', line, 0, L, step, q => [[side * (half - 0.9), top(q) - 0.1], [side * (half - 0.5), top(q) - 0.1], [side * (half - 0.5), top(q) + 0.3], [side * (half - 0.9), top(q) + 0.3]]);   // the kerb,
      const stripes = [];                                                  // striped red: the kerb's top and outer face, 2 m in every 4
      for (let q = 2; q + 2 <= L; q += 4) {
        const o0 = side * (half - 0.9), o1 = side * (half - 0.5), y = (t, d) => top(t) + d;
        const c = (t, o, d) => { const f = line.at(t); return [f.x + f.nx * o, y(t, d), f.z + f.nz * o]; };
        const [a0, a1, b0, b1] = [c(q, o0, 0.31), c(q, o1, 0.31), c(q + 2, o0, 0.31), c(q + 2, o1, 0.31)];
        const [d0, d1] = [c(q, o1 + side * 0.01, -0.1), c(q + 2, o1 + side * 0.01, -0.1)];
        const up = side > 0 ? [a0, b1, a1, a0, b0, b1] : [a0, a1, b1, a0, b1, b0];
        const face = side > 0 ? [a1, b1, d1, a1, d1, d0] : [a1, d0, d1, a1, d1, b1];
        for (const v of [...up, ...face]) stripes.push(...v);
      }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(stripes, 3)); sg.computeVertexNormals(); add('red', sg);
      sweep('steel', line, 0, L, step, q => [[side * (half - 0.12), top(q) + 0.9], [side * (half - 0.02), top(q) + 0.9], [side * (half - 0.02), top(q) + 1.05], [side * (half - 0.12), top(q) + 1.05]]);   // and the railing
      for (let q = 3; q < L; q += 6) strut('steel', P(line, q, side * (half - 0.07), top(q) - 0.2), P(line, q, side * (half - 0.07), top(q) + 0.95), 0.05, 0.05, 3);
    }
    for (const q of piers) {
      const f = line.at(q), y = top(q) - depth, yaw = Math.atan2(f.tx, f.tz);
      if (inWater(q) && riverPiers === 'wall') {
        const g = new THREE.BoxGeometry(width * 0.75, y - WATER_Y + 1.5, 2.6); g.rotateY(yaw); g.translate(f.x, (y + WATER_Y - 1.5) / 2, f.z); add('concrete', g);
      } else {
        if (inWater(q)) { const g = new THREE.BoxGeometry(width * 0.72, 1.2, 3.2); g.rotateY(yaw); g.translate(f.x, WATER_Y + 0.3, f.z); add('concrete', g); }   // the pile cap at the waterline
        for (let c = 0; c < columns; c++) { const off = columns === 1 ? 0 : (c / (columns - 1) - 0.5) * width * 0.55; strut('concrete', P(line, q, off, -0.5), P(line, q, off, y - 0.8), 0.6, 0.6, 8); }
        const cap = new THREE.BoxGeometry(width * 0.8, 0.8, 1.6); cap.rotateY(yaw); cap.translate(f.x, y - 0.4, f.z); add('concrete', cap);
      }
    }
    for (let q = lamps / 2; q < L - 5; q += lamps) for (const side of (lampSide === 'both' ? [-1, 1] : [0])) {
      const o = side * (half - 0.4), base = P(line, q, o, top(q)), head = P(line, q, o, top(q) + 10);
      strut('steel', base, head, 0.1, 0.08, 6);
      for (const arm of (side === 0 ? [-1, 1] : [-side])) {
        const tip = P(line, q, o + arm * 2.2, top(q) + 10.4);
        strut('steel', head, tip, 0.05, 0.05, 4);
        add('lamp', new THREE.BoxGeometry(0.7, 0.18, 0.35), tip.x, tip.y - 0.1, tip.z);
      }
    }
    bridges[key] = {line, width: width + 4, name, top: crest + 11};
    return {line, top, half};
  }
  // Sài Gòn (1961): 986 m in 32 spans, 24 m wide, four lanes, low and long
  // with a gentle hump over the channel; s runs east to west. Its OSM ways
  // are on layers 2 and 1; the deck meets the main carriageway's ramps.
  girderBridge('saiGon', {name: 'Sài Gòn Bridge', width: 24, depth: 2.6, ends: [12.3, 6.3], crest: 14.5, over: [300, 720], span: 30, riverSpan: 48, water: [[138, 197], [363, 656]], riverPiers: 'wall'});
  // Sài Gòn 2 (2013): 987 m in 30 spans beside it, downstream; s west to east.
  girderBridge('saiGon2', {name: 'Sài Gòn 2 Bridge', width: 17, depth: 2.4, ends: [12.3, 12.3], crest: 14.5, over: [360, 760], span: 33, riverSpan: 48, water: [[410, 711], [895, 971]], riverPiers: 'wall'});
  // The Bến Nghé canal bridges.
  girderBridge('khanhHoi', {name: 'Khánh Hội Bridge', width: 20, ends: [6.3, 6.3], crest: 7.8, over: [110, 240], span: 22, riverSpan: 30, water: [[129, 219]]});
  girderBridge('ongLanh', {name: 'Ông Lãnh Bridge', width: 20, ends: [6.3, 6.3], crest: 7.8, over: [210, 320], span: 24, riverSpan: 30, water: [[236, 296]]});
  girderBridge('calmette', {name: 'Calmette Bridge', width: 20, ends: [6.3, 6.3], crest: 7.8, over: [200, 300], span: 24, riverSpan: 27, water: [[223, 277]]});
  girderBridge('nguyenVanCu', {name: 'Nguyễn Văn Cừ Bridge', width: 20, ends: [6.3, 6.3], crest: 8.2, over: [260, 540], span: 26, riverSpan: 36, water: [[282, 391], [460, 520]]});

  // Chữ Y (1938-1941): three reinforced-concrete branches, 9 m wide, meeting
  // over the junction of the Tàu Hủ and Đôi canals, 6.3 m clear of the water.
  // Each branch starts at the junction and comes down to its ramp. The piers
  // in the water are the white art-deco towers the photographs show, with a
  // round medallion on their faces and octagonal openings below the deck.
  {
    const CREST = 8.6, flat = 18;
    const profile = (s, L) => ROAD_Y + (CREST - ROAD_Y) * (1 - ease(s, flat, L));
    const branch = (key, name, water) => girderBridge(key, {name, width: 9, depth: 1.8, ends: [CREST, ROAD_Y], crest: CREST, over: [0, 1], span: 22, riverSpan: 26, water, lamps: 30, profile, riverPiers: 'wall'});
    const arms = [branch('chuYNorth', 'Chữ Y Bridge (Nguyễn Biểu branch)', [[19, 64]]), branch('chuYSouth', 'Chữ Y Bridge (Hưng Phú branch)', [[10, 84]]), branch('chuYWest', 'Chữ Y Bridge (Nguyễn Thị Tần branch)', [])];
    // The junction's pier: a white tower under the meeting of the branches.
    const tower = (line, s, w, d) => {
      const f = line.at(s), yaw = Math.atan2(f.tx, f.tz), h = CREST + 1.6 - WATER_Y;
      const g = new THREE.BoxGeometry(w, h, d); g.rotateY(yaw); g.translate(f.x, WATER_Y + h / 2 - 0.5, f.z); add('white', g);
      const cap = new THREE.BoxGeometry(w * 0.5, 1.2, d * 0.5); cap.rotateY(yaw); cap.translate(f.x, CREST + 1.7, f.z); add('white', cap);
      for (const side of [-1, 1]) {
        const o = side * (w / 2 + 0.05), m = new THREE.TorusGeometry(1.3, 0.12, 4, 20); m.rotateY(yaw + Math.PI / 2); m.translate(f.x + f.nx * o, CREST - 1.5, f.z + f.nz * o); add('white', m);
        for (let k = -2; k <= 2; k++) {                                        // octagonal openings in the lower part
          const oct = new THREE.CylinderGeometry(0.75, 0.75, 0.12, 8); oct.rotateX(Math.PI / 2); oct.rotateY(yaw + Math.PI / 2);
          const t = s + k * (d / 5.5);
          const q = line.at(t); oct.translate(q.x + q.nx * o, 2.2, q.z + q.nz * o); add('dark', oct);
        }
      }
    };
    tower(arms[0].line, 3, 10, 12);
    for (const [arm, water] of [[arms[0], [19, 64]], [arms[1], [10, 84]]]) {
      const s = water[1] - 2; tower(arm.line, s, 10, 7);                     // the piers on the far side of each canal
    }
  }

  // Tân Thuận 1 (1905): the old French steel bridge over the Kênh Tẻ, 241 m
  // long and 8 m wide; over the water, two through trusses whose top chords
  // arch up from the ends, painted pale. Its OSM way is on layer 2, so its
  // deck is level with the generic ramps at 12.3 m.
  {
    const Y = 12.3, {line, top, half} = girderBridge('tanThuan1', {name: 'Tân Thuận 1 Bridge', width: 9, depth: 1.6, ends: [Y, Y], crest: Y, over: [0, 1], span: 24, riverSpan: 50, water: [[42, 142]], profile: () => Y, riverPiers: 'wall', lamps: 40});
    for (const [s0, s1] of [[42, 92], [92, 142]]) for (const side of [-1, 1]) {
      const o = side * (half + 0.3), rise = s => Y + 1.5 + 7.5 * Math.sin(Math.PI * (s - s0) / (s1 - s0));
      sweep('cream', line, s0, s1, 2.5, s => [[o - 0.35, rise(s) - 0.7], [o + 0.35, rise(s) - 0.7], [o + 0.35, rise(s)], [o - 0.35, rise(s)]]);   // top chord
      sweep('cream', line, s0, s1, 5, s => [[o - 0.35, Y - 0.8], [o + 0.35, Y - 0.8], [o + 0.35, Y + 0.4], [o - 0.35, Y + 0.4]]);                 // bottom chord
      for (let s = s0, k = 0; s <= s1 + 0.1; s += 5, k++) {
        strut('cream', P(line, s, o, Y + 0.4), P(line, s, o, rise(s) - 0.7), 0.16, 0.16, 4);                                                    // verticals
        if (s + 5 <= s1 + 0.1) strut('cream', P(line, k % 2 ? s : s + 5, o, Y + 0.4), P(line, k % 2 ? s + 5 : s, o, rise(k % 2 ? s + 5 : s) - 0.7), 0.12, 0.12, 4);   // diagonals
      }
    }
    for (let s = 52; s < 140; s += 5) {                                        // bracing over the road where the chords are high
      const h = 1.5 + 7.5 * Math.sin(Math.PI * ((s - 42) % 50) / 50);
      if (h > 6.5) strut('cream', P(line, s, -half - 0.3, Y + h - 0.8), P(line, s, half + 0.3, Y + h - 0.8), 0.12, 0.12, 4);
    }
  }

  // Tân Thuận 2 (2005): beside it, a wider concrete bridge whose two spans
  // over the water hang from white arches of concrete-filled steel tube,
  // each arch a pair of tubes laced together. Also at 12.3 m.
  {
    const Y = 12.3, {line, half} = girderBridge('tanThuan2', {name: 'Tân Thuận 2 Bridge', width: 14, depth: 2.0, ends: [Y, Y], crest: Y, over: [0, 1], span: 28, riverSpan: 55.5, water: [[215, 326]], profile: () => Y, riverPiers: 'wall', lamps: 36});
    for (const [s0, s1] of [[215, 270.5], [270.5, 326]]) for (const side of [-1, 1]) {
      const o = side * (half + 0.4), arc = (s, d) => Y + 0.3 + (11 - d) * Math.sin(Math.PI * (s - s0) / (s1 - s0));
      for (const d of [0, 1.6]) sweep('white', line, s0, s1, 2.5, s => { const y = arc(s, d); return [[o - 0.35, y - 0.35], [o + 0.35, y - 0.35], [o + 0.35, y + 0.35], [o - 0.35, y + 0.35]]; });
      for (let s = s0 + 3, k = 0; s < s1 - 2; s += 3.5, k++) strut('white', P(line, s, o, arc(s, k % 2 ? 0 : 1.6)), P(line, s + 3.5, o, arc(s + 3.5, k % 2 ? 1.6 : 0)), 0.1, 0.1, 4);   // lacing
      for (let s = s0 + 5; s < s1 - 3; s += 5) strut('cable', P(line, s, o, arc(s, 1.6)), P(line, s, o, Y + 0.2), 0.06, 0.06, 4);                                           // hangers
    }
  }

  const triangles = finish(group);
  scene.add(group);

  // Replace the generic ribbons: road triangles (bridge, major, street, path)
  // wholly above 1 m and within the bridge's corridor. Idempotent per mesh.
  // Alongside the bridge only: not beyond its ends, where the generic
  // approach ramps it meets carry on.
  function near(b, x, z, margin) {
    const pts = b.line.points, last = pts.length - 1;
    for (let i = 1; i <= last; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      const raw = ((x - ax) * dx + (z - az) * dz) / L2;
      if ((i === 1 && raw < 0) || (i === last && raw > 1)) continue;
      const t = Math.max(0, Math.min(1, raw));
      if (Math.hypot(ax + t * dx - x, az + t * dz - z) <= b.width / 2 + margin) return true;
    }
    return false;
  }
  const boxes = Object.values(bridges).map(b => { const xs = b.line.points.map(p => p[0]), zs = b.line.points.map(p => p[1]), m = b.width;
    return new THREE.Box3(new THREE.Vector3(Math.min(...xs) - m, -5, Math.min(...zs) - m), new THREE.Vector3(Math.max(...xs) + m, 200, Math.max(...zs) + m)); });
  function replaceGeneric(root) {
    if (!root) return 0;
    root.updateWorldMatrix(true, true); let removed = 0;
    const v = new THREE.Vector3();
    root.traverse(o => {
      if (!o.isMesh || !/^(bridge|major|street|path)/.test(o.name) || o.userData.bridgesReplaced) return;
      o.userData.bridgesReplaced = true;
      const original = o.geometry;
      if (!original.boundingBox) original.computeBoundingBox();
      const world = original.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const hits = Object.values(bridges).filter((_, i) => boxes[i].intersectsBox(world));
      if (!hits.length) return;
      const g = original.index ? original.toNonIndexed() : original, p = g.attributes.position, keep = [];
      let cut = 0;
      for (let i = 0; i < p.count; i += 3) {
        let inside = true;
        for (let j = 0; j < 3 && inside; j++) { v.fromBufferAttribute(p, i + j).applyMatrix4(o.matrixWorld); inside = v.y > 1 && hits.some(b => near(b, v.x, v.z, 2)); }
        if (inside) cut++; else keep.push(i, i + 1, i + 2);
      }
      if (cut) {
        const out = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(g.attributes)) {
          const array = new attr.array.constructor(keep.length * attr.itemSize);
          for (let i = 0; i < keep.length; i++) for (let c = 0; c < attr.itemSize; c++) array[i * attr.itemSize + c] = attr.array[keep[i] * attr.itemSize + c];
          out.setAttribute(name, new THREE.BufferAttribute(array, attr.itemSize, attr.normalized));
        }
        out.computeBoundingBox(); out.computeBoundingSphere(); o.geometry = out; original.dispose(); removed += cut;
      }
      if (g !== original) g.dispose();
    });
    return removed;
  }

  const views = Object.fromEntries(Object.entries(bridges).map(([k, b]) => {
    const f = b.line.at(b.line.length / 2), y = b.top / 2;
    return [k, {target: new THREE.Vector3(f.x, y, f.z), eye: new THREE.Vector3(f.x + f.nx * b.line.length * 0.7, y + b.line.length * 0.15, f.z + f.nz * b.line.length * 0.7)}];
  }));
  const state = {names: Object.values(bridges).map(b => b.name), triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, bridges, views, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
