// Regression test: the live board rounds to 5-minute marks, so several
// flights of the same kind often share one published `time`, and every
// flight of a kind is animated on the same single assumed runway -- so
// animating at the literal time drew multiple aircraft exactly on top of
// each other (reported as "two arrive within 30s of each other" once the
// live scraper, not just spread-out test data, was the source). Pure logic,
// no THREE/DOM needed.
import {assignAnimTimes, MIN_ANIM_SEPARATION_MS} from '../3d/flights.js';

function run(name, fn) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { console.log(`FAIL - ${name}: ${e.message}`); process.exitCode = 1; }
}

function flight(id, kind, time) {
  return {id, kind, time, number: id};
}

run('flights sharing an identical published time are spread at least MIN_ANIM_SEPARATION_MS apart', () => {
  const flights = [
    flight('a', 'arrival', '2026-09-22T08:55:00Z'),
    flight('b', 'arrival', '2026-09-22T08:55:00Z'),
    flight('c', 'arrival', '2026-09-22T08:55:00Z'),
    flight('d', 'arrival', '2026-09-22T08:55:00Z'),
  ];
  assignAnimTimes(flights);
  const times = flights.map(f => f.animAt).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] < MIN_ANIM_SEPARATION_MS) throw new Error(`gap ${times[i] - times[i - 1]}ms is under the minimum`);
  }
});

run("the published (real) time on each flight object is left untouched -- only animAt is added", () => {
  const flights = [flight('a', 'arrival', '2026-09-22T08:55:00Z'), flight('b', 'arrival', '2026-09-22T08:55:00Z')];
  assignAnimTimes(flights);
  for (const f of flights) if (f.time !== '2026-09-22T08:55:00Z') throw new Error('the displayed time field was mutated');
});

run('arrivals and departures are staggered independently, not against each other', () => {
  const flights = [
    flight('a', 'arrival', '2026-09-22T08:55:00Z'),
    flight('b', 'departure', '2026-09-22T08:55:00Z'),
  ];
  assignAnimTimes(flights);
  const t = Date.parse('2026-09-22T08:55:00Z');
  if (flights[0].animAt !== t || flights[1].animAt !== t) throw new Error('an arrival and a departure sharing a runway-independent time were needlessly separated');
});

run('flights already comfortably spaced apart keep their real time exactly (no needless drift)', () => {
  const flights = [
    flight('a', 'arrival', '2026-09-22T08:00:00Z'),
    flight('b', 'arrival', '2026-09-22T08:10:00Z'),
  ];
  assignAnimTimes(flights);
  if (flights[0].animAt !== Date.parse('2026-09-22T08:00:00Z')) throw new Error('first flight was shifted unnecessarily');
  if (flights[1].animAt !== Date.parse('2026-09-22T08:10:00Z')) throw new Error('well-separated second flight was shifted unnecessarily');
});

run('a flight only ~20s after another (the reported case) is pushed out to the minimum separation, not left close', () => {
  const flights = [
    flight('a', 'arrival', '2026-09-22T08:35:00Z'),
    flight('b', 'arrival', '2026-09-22T08:35:21Z'),
  ];
  assignAnimTimes(flights);
  const gap = flights[1].animAt - flights[0].animAt;
  if (gap < MIN_ANIM_SEPARATION_MS) throw new Error(`gap of ${gap}ms reproduces the reported near-simultaneous arrival`);
});

run('input order does not matter -- animAt still comes out time-ordered and minimum-separated', () => {
  const flights = [
    flight('late', 'departure', '2026-09-22T09:00:00Z'),
    flight('early', 'departure', '2026-09-22T08:59:50Z'),
  ];
  assignAnimTimes(flights);
  const early = flights.find(f => f.id === 'early'), late = flights.find(f => f.id === 'late');
  if (late.animAt - early.animAt < MIN_ANIM_SEPARATION_MS) throw new Error('relative order/spacing not preserved regardless of input order');
});

if (process.exitCode) process.exit(1);
