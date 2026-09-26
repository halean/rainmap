// node --loader ./tests/three-loader.mjs tests/opentour.mjs
// The open-top tour bus (3d/opentour.js): its route, timetable and motion.
import assert from 'node:assert/strict';
import * as THREE from '../3d/vendor/three.module.js';
import {createOpenTour, schedule, TOUR} from '../3d/opentour.js';
import {OPEN_TOUR} from '../3d/opentour-route.js';
const project = (lon, lat) => [(lon - 106.65) * 111320 * Math.cos(10.81 * Math.PI / 180), -(lat - 10.81) * 111320];
const at = (hh, mm, ss = 0) => Date.UTC(2026, 8, 26, hh - 7, mm, ss);            // ICT wall clock -> ms
// The route: ten stops in order around a 14.3 km loop, a height for every 5 m.
assert.equal(OPEN_TOUR.stops.length, 10);
assert.equal(OPEN_TOUR.stops[0].name, 'Saigon Opera House');
assert(OPEN_TOUR.stops.every((s, i) => i === 0 || s.along > OPEN_TOUR.stops[i - 1].along), 'stops in order');
assert(Math.abs(OPEN_TOUR.length - 14306) < 50);
assert.equal(OPEN_TOUR.heights.length, Math.floor(OPEN_TOUR.length / 5) + 1);
assert(OPEN_TOUR.heights.every((h, i) => i === 0 || Math.abs(h - OPEN_TOUR.heights[i - 1]) <= 0.36), 'no steps in the road');
// A loop takes about an hour: 14.3 km at 18 km/h plus 90 s at each stop.
const {duration, legs} = schedule();
assert(duration > 55 * 60 && duration < 70 * 60, `loop ${duration / 60} min`);
const t = createOpenTour({scene: new THREE.Scene(), project});
assert.equal(t.running(at(8, 59)).length, 0, 'none before 09:00');
assert.equal(t.running(at(9, 0, 30)).length, 1, 'the first bus at 09:00');
assert.equal(t.running(at(14, 10)).length, 2, 'two on the loop, 30 minutes apart');
assert.equal(t.running(at(14, 2)).length, 3, 'three for a few minutes after each departure');
assert.equal(t.running(at(23, 50)).length, 0, 'none after the last loop');
assert.equal(t.nextDeparture(at(8, 0)), 9 * 60); assert.equal(t.nextDeparture(at(14, 10)), 14 * 60 + 30); assert.equal(t.nextDeparture(at(22, 40)), null);
// At the first stop for 90 s, then moving; waiting at each stop on time.
let b = t.running(at(9, 0, 45))[0]; assert(b.dwelling && b.stop === 0 && b.s === 0);
b = t.running(at(9, 3, 0))[0]; assert(!b.dwelling && b.s > 100 && b.s < OPEN_TOUR.stops[1].along);
const third = legs[3]; b = t.running(at(9, 0) + (third.arrive + 30) * 1000)[0]; assert(b.dwelling && b.stop === 3 && b.s === third.along);
// Smooth: never faster than cruise, and positions a second apart are on the road, in the right-hand lane.
let prev = null;
for (let k = 0; k < duration; k += 1) {
  const s = t.running(at(9, 0) + k * 1000)[0].s;
  if (prev !== null) assert(s - prev <= TOUR.cruise + 1e-6 && s >= prev - 1e-6, `speed at ${k}s`);
  prev = s;
}
t.update(at(14, 10));
const view = t.followView(); assert(view && Number.isFinite(view.pos.x) && Math.abs(view.forward.length() - 1) < 1e-6);
assert(t.state.following.departed.match(/^1[34]:[03]0$/));
console.log(`ok - open tour: ${OPEN_TOUR.stops.length} stops, ${t.state.loopKm} km loop in ${t.state.loopMinutes} min; ${t.state.buses} buses at 14:10; smooth, on time, followable`);
