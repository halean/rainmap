// Demo schedule for 3d/metro.js: one train shuttling Bến Thành <-> Suối Tiên,
// stopping at every station. Station distances are the real ones from
// 3d/metro-line1.json (OSM), so the numbers here are the ones the viewer uses.
import { readFileSync } from 'node:fs';
import { DEMO, runTime, runDistance, demoCycle, demoPosition } from '../3d/metro.js';

function run(name, fn) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { console.log(`FAIL - ${name}: ${e.message}`); process.exitCode = 1; }
}
const line = JSON.parse(readFileSync(new URL('../3d/metro-line1.json', import.meta.url)));
const along = line.stations.map(s => s.along_m);

run('the line file has 14 stations in order, Bến Thành first and Suối Tiên last', () => {
  if (along.length !== 14) throw new Error(`${along.length} stations`);
  for (let i = 1; i < along.length; i++) if (!(along[i] > along[i - 1])) throw new Error(`station ${i} out of order`);
  if (line.stations[0].name !== 'Bến Thành' || line.stations[13].name !== 'Bến xe Suối Tiên') throw new Error('wrong terminals');
  if (Math.abs(line.length_m - 18900) > 500) throw new Error(`length ${line.length_m}`);
});

run('a hop starts and ends at rest and never exceeds 80 km/h', () => {
  for (const d of [300, 734, 2376]) {
    const T = runTime(d), dt = 0.05;
    if (Math.abs(runDistance(0, d)) > 1e-9 || Math.abs(runDistance(T, d) - d) > 1e-6) throw new Error(`hop ${d} m endpoints`);
    for (let t = dt; t <= T; t += dt) {
      const v = (runDistance(t, d) - runDistance(t - dt, d)) / dt;
      if (v > DEMO.cruise + 1e-6) throw new Error(`hop ${d} m: ${v * 3.6} km/h`);
      if (v < -1e-9) throw new Error(`hop ${d} m goes backwards`);
    }
  }
});

run('end to end takes a plausible time (the real line is about 29 minutes)', () => {
  const c = demoCycle(along);
  const oneWay = c.period / 2 / 60;
  if (oneWay < 24 || oneWay > 36) throw new Error(`one way ${oneWay.toFixed(1)} min`);
});

run('the train stops at every station both ways and turns back at both ends', () => {
  const c = demoCycle(along), stops = c.legs.filter(l => l.kind === 'dwell').map(l => l.at);
  const expect = [...along.keys(), ...[...along.keys()].reverse().slice(1)];
  if (JSON.stringify(stops) !== JSON.stringify(expect)) throw new Error(`stops ${stops}`);
  const out = demoPosition(c, along, c.legs[3].start + 10), back = demoPosition(c, along, c.period * 0.75);
  if (out.heading !== 1 || back.heading !== -1) throw new Error(`headings ${out.heading} ${back.heading}`);
});

run('the train is always on the line and the demo repeats', () => {
  const c = demoCycle(along);
  for (let t = 0; t < c.period * 2; t += 7) {
    const p = demoPosition(c, along, t);
    if (p.along < -1e-6 || p.along > along[13] + 1e-6) throw new Error(`off the line at t=${t}: ${p.along}`);
  }
  if (Math.abs(demoPosition(c, along, 100).along - demoPosition(c, along, 100 + c.period).along) > 1e-6) throw new Error('not periodic');
});

if (process.exitCode) process.exit(1);
