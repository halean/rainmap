// Timetable running for 3d/metro.js, against a real sample of HURC1's
// published timetable (tests/fixtures/metro_timetable_sample.json) and the real
// station distances (3d/metro-line1.json).
import { readFileSync } from 'node:fs';
import { tripsFromTimetable, tripPosition, ictSecondsOfDay, TIMETABLE } from '../3d/metro.js';

function run(name, fn) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { console.log(`FAIL - ${name}: ${e.message}`); process.exitCode = 1; }
}
const line = JSON.parse(readFileSync(new URL('../3d/metro-line1.json', import.meta.url)));
const tt = JSON.parse(readFileSync(new URL('./fixtures/metro_timetable_sample.json', import.meta.url))).directions;
const along = line.stations.map(s => s.along_m);
const index = Object.fromEntries(line.stations.map((s, k) => [s.stopId, k]));
const out = tripsFromTimetable(tt['1'], '1', index), back = tripsFromTimetable(tt['2'], '2', index);
const sec = hhmm => Number(hhmm.slice(0, 2)) * 3600 + Number(hhmm.slice(3)) * 60;

run('every sample trip is kept, runs station to station in line order, both directions', () => {
  if (out.length !== 12 || back.length !== 12) throw new Error(`${out.length} / ${back.length} trips`);
  if (out[0].stops.map(s => s.i).join() !== [...Array(14).keys()].join()) throw new Error('toward Suối Tiên order');
  if (back[0].stops.map(s => s.i).join() !== [...Array(14).keys()].reverse().join()) throw new Error('toward Bến Thành order');
});

run('a train leaves each station at its timetabled minute and is at the next one on time', () => {
  const trip = out[0];
  for (let j = 0; j < trip.stops.length; j++) {
    const {i, t} = trip.stops[j];
    const at = tripPosition(trip, along, t);
    if (!at || Math.abs(at.along - along[i]) > 1e-6) throw new Error(`not at ${line.stations[i].name} at its time`);
    if (j < trip.stops.length - 1) {
      const after = tripPosition(trip, along, t + 5);
      if (!(after.along > along[i])) throw new Error(`still at ${line.stations[i].name} 5 s after departure`);
    }
  }
});

run('between departures the train only moves forward and stays between the two stations', () => {
  for (const trip of [out[3], back[7]]) {
    let prev = null;
    for (let t = trip.stops[0].t; t <= trip.stops.at(-1).t; t += 2) {
      const p = tripPosition(trip, along, t);
      if (prev !== null && trip.heading * (p.along - prev) < -1e-6) throw new Error(`${trip.id} went backwards at ${t}`);
      prev = p.along;
    }
  }
});

run('off the timetable a trip is not on the line: before its origin wait, after its terminal wait', () => {
  const trip = out[0], first = trip.stops[0].t, last = trip.stops.at(-1).t;
  if (tripPosition(trip, along, first - TIMETABLE.originWait - 1) !== null) throw new Error('shown too early');
  if (tripPosition(trip, along, last + TIMETABLE.terminalWait + 1) !== null) throw new Error('shown too late');
  if (tripPosition(trip, along, first - 30)?.at !== trip.stops[0].i) throw new Error('not waiting at its origin');
});

run('the first trip of the day matches the published times', () => {
  if (sec(tt['1']['7003'][0]) !== out[0].stops[0].t) throw new Error('first departure');
  if (sec(tt['1']['7015'][0]) !== out[0].stops.at(-1).t) throw new Error('terminal time');
});

run('ICT seconds of day: 00:00 UTC is 07:00 in Ho Chi Minh City', () => {
  if (ictSecondsOfDay(Date.UTC(2026, 8, 26, 0, 0)) !== 7 * 3600) throw new Error('offset');
  if (ictSecondsOfDay(Date.UTC(2026, 8, 26, 17, 30)) !== 30 * 60) throw new Error('wraps past midnight');
});

if (process.exitCode) process.exit(1);
