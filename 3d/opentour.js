// The open-top tour bus: City Sightseeing Saigon's Red Route, a loop of ten
// stops from the Opera House (opentour-route.js). Buses are SIMULATED from
// the published timetable -- departures from the Opera House every 30
// minutes, 09:00-22:30 -- not tracked. Each drives the loop at city-centre
// speed with smooth starts and stops, waits at every stop, and keeps to the
// right-hand lane. The bus is a red open-top double-decker, its upper deck
// full of sightseers. followView() gives the chase camera a bus to follow.
// See OPENTOUR.md.
import * as THREE from 'three';
import {builder} from './landmark-kit.js';
import {OPEN_TOUR} from './opentour-route.js';

export const TOUR = Object.freeze({
  first: 9 * 60, last: 22 * 60 + 30, every: 30,      // departures, minutes after midnight (ICT)
  cruise: 5.0, accel: 0.9,                           // m/s (18 km/h in the centre's traffic), m/s²
  dwell: 90,                                          // seconds at each stop
  lane: 1.9,                                          // metres right of the road's centreline
});
const ICT = 7 * 3600 * 1000;

/** Time (s) to cover d metres from rest to rest: accelerate, cruise, brake. */
function legTime(d, v = TOUR.cruise, a = TOUR.accel) {
  const ramp = v * v / a;                            // distance spent speeding up and slowing down
  return d >= ramp ? d / v + v / a : 2 * Math.sqrt(d / a);
}
/** Distance covered after t seconds of a leg of length d. */
function legDistance(t, d, v = TOUR.cruise, a = TOUR.accel) {
  const T = legTime(d, v, a);
  if (t >= T) return d;
  if (d >= v * v / a) {
    const t1 = v / a;
    if (t < t1) return 0.5 * a * t * t;
    if (t < T - t1) return 0.5 * v * t1 + v * (t - t1);
    const r = T - t; return d - 0.5 * a * r * r;
  }
  const h = T / 2; return t < h ? 0.5 * a * t * t : d - 0.5 * a * (T - t) ** 2;
}

/** The schedule: for each stop, when the bus arrives and leaves (s after departure). */
export function schedule(route = OPEN_TOUR) {
  const out = []; let t = 0;
  const stops = route.stops.map(s => s.along);
  for (let i = 0; i < stops.length; i++) {
    const leave = t + TOUR.dwell;
    const next = i + 1 < stops.length ? stops[i + 1] : route.length;
    out.push({stop: i, along: stops[i], arrive: t, leave, legLength: next - stops[i]});
    t = leave + legTime(next - stops[i]);
  }
  return {legs: out, duration: t};
}

export function createOpenTour({scene, project}) {
  const group = new THREE.Group(); group.name = 'open-tour';
  const pts = OPEN_TOUR.path.map(([lon, lat]) => project(lon, lat)), cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const scale = OPEN_TOUR.length / cum[cum.length - 1];
  const H = OPEN_TOUR.heights;
  const height = s => { const k = Math.max(0, Math.min(H.length - 1.001, s / 5)), i = Math.floor(k); return H[i] + (H[i + 1] - H[i]) * (k - i); };
  /** Position on the loop at s metres, in the right-hand lane, and heading. */
  function at(s) {
    s = ((s % OPEN_TOUR.length) + OPEN_TOUR.length) % OPEN_TOUR.length;
    const u = s / scale; let i = 1; while (i < cum.length - 1 && cum[i] < u) i++;
    const a = pts[i - 1], b = pts[i], t = (u - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    // Heading smoothed over 12 m either side, so corners are driven round.
    const ahead = raw(s + 6), behind = raw(s - 6), dx = ahead[0] - behind[0], dz = ahead[1] - behind[1], l = Math.hypot(dx, dz) || 1;
    const fx = dx / l, fz = dz / l, rx = -fz, rz = fx;                       // right of travel (x east, z south)
    return {x: a[0] + (b[0] - a[0]) * t + rx * TOUR.lane, z: a[1] + (b[1] - a[1]) * t + rz * TOUR.lane, y: height(s), fx, fz};
  }
  function raw(s) {
    s = ((s % OPEN_TOUR.length) + OPEN_TOUR.length) % OPEN_TOUR.length;
    const u = s / scale; let i = 1; while (i < cum.length - 1 && cum[i] < u) i++;
    const a = pts[i - 1], b = pts[i], t = (u - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  // --- The bus: an open-top double-decker 10.5 m long, 2.5 m wide and 4.2 m
  // to the upper deck's rail, in City Sightseeing red with the white wave.
  const Lb = 10.5, Wb = 2.5;
  const M = (color, o = {}) => new THREE.MeshStandardMaterial({color, roughness: 0.55, ...o});
  const materials = {
    red: M('#c8102e', {roughness: 0.35, metalness: 0.1}), white: M('#f4f4f2', {roughness: 0.4}),
    glass: M('#1a2228', {roughness: 0.08, metalness: 0.6}), dark: M('#1b1d1f', {roughness: 0.8}),
    tyre: M('#141414', {roughness: 0.9}), hub: M('#b5babd', {metalness: 0.8, roughness: 0.3}),
    seat: M('#2b4a8b'), rail: M('#dfe3e6', {metalness: 0.9, roughness: 0.2}),
    lamp: M('#fff5d8', {emissive: '#fff0c0', emissiveIntensity: 0.8}), tail: M('#b0120d', {emissive: '#700a06', emissiveIntensity: 0.6}),
    sign: M('#ffb000', {emissive: '#ff9000', emissiveIntensity: 1.0}),
    skin1: M('#e8c1a0'), skin2: M('#c08e6b'), skin3: M('#8f5f43'),
    shirt1: M('#f2f2f2'), shirt2: M('#2a9d8f'), shirt3: M('#e9c46a'), shirt4: M('#264653'), shirt5: M('#e76f51'), hat: M('#e9d8a6'),
  };
  const b = builder(materials, 'tourbus');
  const {add, box} = b;
  // Lower saloon: body, window band, the white wave, the front screen and
  // destination sign, the door, lamps.
  box('red', Lb, 2.1, Wb, 0, 1.45, 0);
  for (const s of [-1, 1]) {
    box('glass', Lb - 1.6, 0.95, 0.02, -0.2, 1.75, s * (Wb / 2 + 0.005));
    const wave = new THREE.PlaneGeometry(Lb - 0.4, 0.35, 24, 1); const p = wave.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + 0.18 * Math.sin(p.getX(i) * 0.9));
    wave.rotateY(s > 0 ? 0 : Math.PI); add('white', wave, 0, 0.95, s * (Wb / 2 + 0.01));
  }
  box('glass', 0.02, 1.2, Wb - 0.2, Lb / 2 + 0.005, 1.65, 0);
  box('sign', 0.03, 0.22, 1.4, Lb / 2 + 0.01, 2.35, 0);
  box('glass', 0.02, 0.8, Wb - 0.3, -Lb / 2 - 0.005, 1.8, 0);
  box('dark', 0.9, 1.9, 0.03, Lb / 2 - 1.1, 1.35, Wb / 2 + 0.012);             // front door, kerb side (right)
  box('dark', 0.9, 1.9, 0.03, -0.4, 1.35, Wb / 2 + 0.012);                    // centre door
  for (const s of [-1, 1]) { box('lamp', 0.04, 0.16, 0.3, Lb / 2 + 0.01, 0.75, s * 0.9); box('tail', 0.04, 0.3, 0.18, -Lb / 2 - 0.01, 0.9, s * 1.05); }
  box('dark', Lb + 0.06, 0.25, Wb + 0.04, 0, 0.35, 0);                        // bumpers and skirt
  // Wheels: two axles.
  for (const [ax, s] of [[3.4, 1], [3.4, -1], [-2.9, 1], [-2.9, -1]]) {
    const t = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 24); t.rotateX(Math.PI / 2); add('tyre', t, ax, 0.5, s * (Wb / 2 - 0.12));
    const h = new THREE.CylinderGeometry(0.28, 0.28, 0.34, 16); h.rotateX(Math.PI / 2); add('hub', h, ax, 0.5, s * (Wb / 2 - 0.12));
  }
  // Upper deck: floor, the open body's sides to waist height, the front
  // wind deflector, rails, the stairs' housing, rows of blue seats.
  const UP = 2.55;
  box('red', Lb, 0.1, Wb, 0, UP, 0);
  for (const s of [-1, 1]) { box('red', Lb, 1.0, 0.08, 0, UP + 0.5, s * (Wb / 2 - 0.04)); box('rail', Lb, 0.05, 0.06, 0, UP + 1.25, s * (Wb / 2 - 0.04)); for (let x = -Lb / 2 + 0.3; x < Lb / 2; x += 1.2) box('rail', 0.04, 0.25, 0.04, x, UP + 1.12, s * (Wb / 2 - 0.04)); }
  box('red', 0.1, 1.0, Wb, Lb / 2 - 0.05, UP + 0.5, 0);
  box('glass', 0.05, 0.45, Wb - 0.2, Lb / 2 - 0.05, UP + 1.25, 0);
  box('red', 0.1, 1.0, Wb, -Lb / 2 + 0.05, UP + 0.5, 0);
  box('red', 1.4, 1.0, 0.9, -Lb / 2 + 1.0, UP + 0.5, 0.75);                    // stairwell
  const seatRows = [];
  for (let x = -Lb / 2 + 2.2; x < Lb / 2 - 0.6; x += 0.85) seatRows.push(x);
  for (const x of seatRows) for (const s of [-1, 1]) {
    box('seat', 0.45, 0.12, 0.9, x, UP + 0.45, s * 0.65); box('seat', 0.08, 0.5, 0.9, x - 0.22, UP + 0.72, s * 0.65);
  }
  // Sightseers on most upper-deck seats: a torso, a head, some in hats,
  // a few with an arm up taking a photo.
  let n = 0;
  for (const x of seatRows) for (const s of [-1, 1]) for (const d of [-0.22, 0.22]) {
    n++; if (n % 5 === 3) continue;                                           // the odd empty seat
    const skin = ['skin1', 'skin2', 'skin3'][n % 3], shirt = ['shirt1', 'shirt2', 'shirt3', 'shirt4', 'shirt5'][n % 5], z = s * 0.65 + d;
    const torso = new THREE.CapsuleGeometry(0.15, 0.3, 4, 10); torso.scale(0.8, 1, 1); add(shirt, torso, x + 0.02, UP + 0.85, z);
    add(skin, new THREE.SphereGeometry(0.1, 12, 10), x + 0.04, UP + 1.25, z);
    if (n % 4 === 0) { add('hat', new THREE.CylinderGeometry(0.17, 0.17, 0.015, 16), x + 0.04, UP + 1.33, z); add('hat', new THREE.CylinderGeometry(0.08, 0.09, 0.08, 12), x + 0.04, UP + 1.37, z); }
    if (n % 7 === 1) { const arm = new THREE.CapsuleGeometry(0.04, 0.45, 3, 8); arm.rotateZ(-0.5); add(skin, arm, x + 0.2, UP + 1.35, z + s * 0.12); add('dark', new THREE.BoxGeometry(0.03, 0.08, 0.14), x + 0.35, UP + 1.58, z + s * 0.12); }
  }
  const busGeometry = new THREE.Group(); b.finish(busGeometry);
  const template = busGeometry.children;                                      // meshes to share between buses

  // One bus object per possible bus on the loop at once.
  const sched = schedule(), duration = sched.duration;
  const maxBuses = Math.ceil(duration / (TOUR.every * 60)) + 1;
  const buses = Array.from({length: maxBuses}, () => {
    const g = new THREE.Group(); for (const m of template) g.add(new THREE.Mesh(m.geometry, m.material));
    g.visible = false; group.add(g); return g;
  });
  scene.add(group);

  const state = {buses: 0, route: 'City Sightseeing Saigon Red Route', stops: OPEN_TOUR.stops.length, loopKm: +(OPEN_TOUR.length / 1000).toFixed(1), loopMinutes: Math.round(duration / 60), timetable: '09:00-22:30 every 30 min', simulated: true, following: null};
  /** Buses on the loop at a given time: [{id, s, stop, dwelling}]. */
  function running(nowMs) {
    const local = (nowMs + ICT) % 86400000 / 1000, out = [];
    for (let dep = TOUR.first; dep <= TOUR.last; dep += TOUR.every) {
      const t = local - dep * 60;
      if (t < 0 || t >= duration) continue;
      let s = 0, stop = null, dwelling = false;
      for (const leg of sched.legs) {
        if (t < leg.arrive) break;
        if (t < leg.leave) { s = leg.along; stop = leg.stop; dwelling = true; break; }
        s = leg.along + legDistance(t - leg.leave, leg.legLength); stop = leg.stop;
      }
      out.push({id: dep, s, stop, dwelling, departed: dep});
    }
    return out;
  }
  let followId = null, last = [];
  function update(nowMs = Date.now()) {
    last = running(nowMs);
    buses.forEach((g, i) => {
      const bus = last[i];
      g.visible = !!bus; if (!bus) return;
      const p = at(bus.s), front = at(bus.s + Lb / 2), back = at(bus.s - Lb / 2);
      g.position.set(p.x, p.y, p.z);
      g.rotation.set(0, Math.atan2(-p.fz, p.fx), Math.atan2(front.y - back.y, Lb), 'YXZ');
      bus.object = g;
    });
    state.buses = last.length;
  }
  /** For the chase camera: the followed bus's position and heading, or null. */
  function followView(near = null) {
    if (!last.length) return null;
    let bus = last.find(x => x.id === followId);
    if (!bus) {
      const d = x => { if (!near || !x.object) return 0; return x.object.position.distanceToSquared(near); };
      bus = last.reduce((a, c) => d(c) < d(a) ? c : a); followId = bus.id;
    }
    const p = at(bus.s), stop = OPEN_TOUR.stops[bus.stop ?? 0];
    state.following = {departed: `${String(Math.floor(bus.departed / 60)).padStart(2, '0')}:${String(bus.departed % 60).padStart(2, '0')}`, [bus.dwelling ? 'at' : 'after']: stop.name};
    return {pos: new THREE.Vector3(p.x, p.y + 3.2, p.z), forward: new THREE.Vector3(p.fx, 0, p.fz)};
  }
  function setFollowing(on) { if (!on) { followId = null; state.following = null; } }
  function nextDeparture(nowMs = Date.now()) {
    const local = (nowMs + ICT) % 86400000 / 60000;
    const dep = local < TOUR.first ? TOUR.first : Math.ceil(local / TOUR.every) * TOUR.every;
    return dep > TOUR.last ? null : dep;
  }
  return {group, state, update, followView, setFollowing, running, nextDeparture, at, dispose() { scene.remove(group); for (const m of template) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
