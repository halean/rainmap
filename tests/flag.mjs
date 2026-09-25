// Direction test for 3d/flag.js: a flag streams AWAY from where METAR says the
// wind comes from. Scene axes: +X east, +Z south, +Y up (see 3d/tools/build.py).
import * as THREE from '../3d/vendor/three.module.js';
import { downwind, flagYaw, windAloft } from '../3d/flag.js';

function run(name, fn) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { console.log(`FAIL - ${name}: ${e.message}`); process.exitCode = 1; }
}
const near = (a, b, what) => { if (Math.abs(a - b) > 1e-9) throw new Error(`${what}: expected ${b}, got ${a}`); };

run('wind from the east streams west; from the north streams south', () => {
  const e = downwind(90); near(e.x, -1, 'east wind x'); near(e.z, 0, 'east wind z');
  const n = downwind(0); near(n.x, 0, 'north wind x'); near(n.z, 1, 'north wind z (+Z is south)');
  const s = downwind(180); near(s.z, -1, 'south wind z');
});

run("the flag's fly end (local +X) ends up pointing downwind after the yaw", () => {
  for (const from of [0, 45, 90, 110, 200, 270, 330]) {
    const fly = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), flagYaw(from));
    const d = downwind(from);
    near(fly.x, d.x, `x for wind from ${from}`); near(fly.z, d.z, `z for wind from ${from}`);
  }
});

run("today's case: wind from 110° (east-south-east) sends the flag toward 290° (west-north-west)", () => {
  const d = downwind(110);
  const bearing = (Math.atan2(d.x, -d.z) * 180 / Math.PI + 360) % 360;   // compass bearing of the vector
  near(Math.round(bearing), 290, 'bearing');
});

run('wind is scaled up with height by the urban power law (exponent 0.3): unchanged at 10 m, about 3.23x at 500 m', () => {
  near(windAloft(5, 10), 5, 'at METAR height');
  near(windAloft(5, 2), 5, 'never scaled down below 10 m');
  if (Math.abs(windAloft(1, 500) - Math.pow(50, 0.3)) > 1e-9) throw new Error('500 m factor');
  if (!(windAloft(5, 500) > 16.1 && windAloft(5, 500) < 16.2)) throw new Error(`5 kt at 500 m should be ~16.2 kt, got ${windAloft(5, 500)}`);
});

if (process.exitCode) process.exit(1);
