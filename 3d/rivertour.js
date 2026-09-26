// River tours: the two Princess 60s from the Vinhomes Central Park Marina,
// *Saigon Star* and *Nha Rong*, run a continuous sightseeing circuit of the
// Saigon River -- down past Ba Son, Bạch Đằng wharf and Nhà Rồng, round the
// Thủ Thiêm bend, about under the Phú Mỹ bridge, back up the other side and
// about again off the marina -- half a lap apart, all day and all night.
// SIMULATED: the positions follow the clock, not a real operator. Each keeps
// to the right of the river's centreline (river-lines.js) and runs flat out
// at 35 knots, the Princess 60's top speed, bow up on the plane, slowing
// only for the two turns. followView() gives the chase camera a yacht to
// follow. See RIVERTOUR.md.
import * as THREE from 'three';
import {RIVER} from './river-lines.js';

export const RIVER_TOUR = Object.freeze({
  lane: 35,            // metres right of the centreline
  cruise: 18.0,        // m/s: 35 knots, flat out -- the top of the Princess 60's published 31-35 knots
  turnSpeed: 4.0,      // m/s round each turn
  brake: 0.02,         // how fast speed builds away from a turn (m/s per metre)
});

/** Offset a polyline sideways (right of travel positive) and resample it every step metres. */
function lane(points, offset, step = 8) {
  const n = points.length, off = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    off.push(new THREE.Vector3(points[i].x - dz / l * offset, 0, points[i].z + dx / l * offset));   // right of travel: (-dz, dx)
  }
  return new THREE.CatmullRomCurve3(off, false, 'centripetal').getSpacedPoints(Math.max(2, Math.round(curveLength(off) / step)));
}
const curveLength = pts => pts.slice(1).reduce((s, p, i) => s + p.distanceTo(pts[i]), 0);
/** A half circle about `c` of radius r, from c + r·from round the side `side` to c - r·from. */
function uTurn(c, from, side, r, n = 24) {
  const out = [];
  for (let k = 1; k < n; k++) { const a = Math.PI * k / n; out.push(c.clone().addScaledVector(from, r * Math.cos(a)).addScaledVector(side, r * Math.sin(a))); }
  return out;
}

/** A closed route: points, the distance to each, and the total. */
function loop(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]));
  return {points, cum, length: cum[cum.length - 1] + points[0].distanceTo(points[points.length - 1])};
}
function sample(r, s) {
  s = ((s % r.length) + r.length) % r.length;
  const n = r.points.length;
  if (s >= r.cum[n - 1]) { const t = (s - r.cum[n - 1]) / (r.length - r.cum[n - 1] || 1); return r.points[n - 1].clone().lerp(r.points[0], t); }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] < s) lo = m; else hi = m; }
  const t = (s - r.cum[lo]) / ((r.cum[hi] - r.cum[lo]) || 1);
  return r.points[lo].clone().lerp(r.points[hi], t);
}

export function createRiverTour({project, boats}) {
  const centre = RIVER.centreline.map(([lon, lat]) => { const [x, z] = project(lon, lat); return new THREE.Vector3(x, 0, z); });
  const R = RIVER_TOUR.lane, out = lane(centre, R), back = lane(centre.slice().reverse(), R);
  // Downstream direction and its right at each end of the centreline.
  const ends = (a, b) => { const f = b.clone().sub(a).setY(0).normalize(); return {f, right: new THREE.Vector3(-f.z, 0, f.x)}; };
  const far = ends(centre[centre.length - 2], centre[centre.length - 1]), near = ends(centre[0], centre[1]);
  // About at Phú Mỹ (beyond the end, downstream) and off the marina (upstream).
  const turnFar = uTurn(centre[centre.length - 1], far.right, far.f, R);
  const turnNear = uTurn(centre[0], near.right.clone().negate(), near.f.clone().negate(), R);
  const pts = [...out, ...turnFar, ...back, ...turnNear];
  const r = loop(pts);
  const turnAt = [r.cum[out.length + 11], r.cum[out.length + turnFar.length + back.length + 11]];
  // Speed round the loop, as a table of (s, t).
  const table = [];
  let t = 0;
  for (let s = 0; s <= r.length; s += 2) {
    const gap = Math.min(...turnAt.map(a => Math.min(Math.abs(s - a), r.length - Math.abs(s - a))));
    const v = Math.min(RIVER_TOUR.cruise, RIVER_TOUR.turnSpeed + RIVER_TOUR.brake * gap);
    table.push([s, t]); t += 2 / v;
  }
  const lap = t;

  const tours = boats.map((boat, index) => { boat.moored?.(false); return {boat, index, phase: index / boats.length}; });
  const state = {route: 'Marina - Ba Son - Bạch Đằng - Nhà Rồng - Thủ Thiêm - Phú Mỹ bridge and back, continuously', km: +(r.length / 1000).toFixed(1), lapMinutes: +(lap / 60).toFixed(1), simulated: true, underway: [], following: null};

  /** Where on the loop a yacht is t seconds into a lap: position, heading, speed. */
  function pose(tt) {
    tt = ((tt % lap) + lap) % lap;
    let lo = 0, hi = table.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (table[m][1] <= tt) lo = m; else hi = m; }
    const [s0, t0] = table[lo], [s1, t1] = table[hi], s = s0 + (s1 - s0) * Math.max(0, Math.min(1, (tt - t0) / ((t1 - t0) || 1)));
    const p = sample(r, s), dir = sample(r, s + 6).sub(sample(r, s - 6)).normalize(), speed = (s1 - s0) / ((t1 - t0) || 1);
    return {p, dir, speed, s};
  }
  function update(nowMs = Date.now()) {
    const clock = nowMs / 1000;                    // continuous time: laps run on round the clock, no jump at midnight
    state.underway = [];
    for (const tour of tours) {
      const {object} = tour.boat, tt = clock + tour.phase * lap, {p, dir, speed, s} = pose(tt);
      const yaw = Math.atan2(-dir.z, dir.x), parent = object.parent;
      parent.updateWorldMatrix(true, false);
      // Afloat: bow up with speed -- most through the hump before she planes,
      // settling to ~2.5° on the plane -- and a slow roll and pitch in the chop.
      const bob = tt * 0.9 + tour.index * 2, kn = speed / 0.514444;
      const trim = 0.075 * Math.exp(-(((kn - 13) / 6) ** 2)) + 0.045 * Math.min(1, kn / 22);
      object.position.copy(parent.worldToLocal(p.clone().setY(tour.boat.waterY + 0.04 * Math.sin(bob * 1.3))));
      object.rotation.set(0.012 * Math.sin(bob), yaw - worldYaw(parent), trim + 0.006 * Math.sin(bob * 0.7), 'YXZ');
      object.userData.velocity = {x: dir.x * speed, z: dir.z * speed};
      tour.pose = {p, dir, speed, s};
      state.underway.push({name: tour.boat.name, lapKm: +(s / 1000).toFixed(1), knots: +kn.toFixed(1)});
    }
  }
  let followIndex = null;
  function followView(near = null) {
    if (!tours[0].pose) update();
    let tour = tours.find(t => t.index === followIndex);
    if (!tour) { tour = near ? tours.reduce((a, c) => c.pose.p.distanceToSquared(near) < a.pose.p.distanceToSquared(near) ? c : a) : tours[0]; followIndex = tour.index; }
    state.following = {name: tour.boat.name, lapKm: +(tour.pose.s / 1000).toFixed(1)};
    return {pos: tour.pose.p.clone().setY(9), forward: tour.pose.dir.clone()};   // aim above the flybridge: the view looks up the river
  }
  function setFollowing(on) { if (!on) { followIndex = null; state.following = null; } }
  return {state, update, followView, setFollowing, tours, route: r, lap};
}

function worldYaw(o) { const q = o.getWorldQuaternion(new THREE.Quaternion()), x = new THREE.Vector3(1, 0, 0).applyQuaternion(q); return Math.atan2(-x.z, x.x); }
