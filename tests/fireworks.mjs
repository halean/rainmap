// node --loader ./tests/three-loader.mjs tests/fireworks.mjs
// Fireworks over the river (3d/fireworks.js): ballistics, the programme, bursts and flashes.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFireworks, starAt, apex, launchSpeed, FIREWORKS} from '../3d/fireworks.js';
import {RIVER} from '../3d/river-lines.js';
import {soundDelay, attenuation, createFireworkSound} from '../3d/fireworks-sound.js';
const project = (lon, lat) => [(lon - 106.65) * 111320 * Math.cos(10.81 * Math.PI / 180), -(lat - 10.81) * 111320];

// Ballistics: the launch speed reaches the asked height; drag slows the stars.
for (const h of [100, 180, 260]) { const v = launchSpeed(h, 0.05); assert(Math.abs(apex(v, 0.05).h - h) < 0.01, `apex ${h}`); }
const far = starAt([0, 0, 0], [100, 0, 0], 1.3, 5)[0];
assert(far > 70 && far < 100 / 1.3, `drag: ${far}`);
assert(starAt([0, 200, 0], [0, 0, 0], 1.3, 10)[1] < 200 - 60, 'stars fall');

// Sound: late by the distance, quieter and duller further off; silent (not failing) without Web Audio.
assert(Math.abs(soundDelay(686) - 2) < 1e-9);
assert(attenuation(100).gain === 1 && attenuation(600).gain < 0.3 && attenuation(1500).cutoff < attenuation(200).cutoff);
const quiet = createFireworkSound(); quiet.resume(); quiet.launch([0, 0, 0], 0, 3, true); quiet.burst([0, 200, 0], 0, 'peony', 80);
assert.equal(quiet.state.available, false); assert.equal(quiet.state.played, 0);
const heard = {launch: 0, burst: 0, lags: [], listener: 0};
const sound = {setListener: () => heard.listener++, launch: (p, lag, rise) => { heard.launch++; assert(rise > 1 && rise < 12, `rise ${rise}`); heard.lags.push(lag); },
  burst: (p, lag, type) => { heard.burst++; heard.lags.push(lag); assert(p[1] > 80, 'burst up high'); }};
let ms = 0;
const camera = new THREE.PerspectiveCamera();
const scene = new THREE.Scene(), fw = createFireworks({scene, project, now: () => ms, sound});
// The barges lie on the river, near its centreline.
const centre = RIVER.centreline.map(([lon, lat]) => project(lon, lat));
const seg = (x, z, [ax, az], [bx, bz]) => { const ex = bx - ax, ez = bz - az, u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1))); return Math.hypot(ax + ex * u - x, az + ez * u - z); };
for (const s of fw.sites) { const d = Math.min(...centre.slice(1).map((p, i) => seg(s.x, s.z, centre[i], p))); assert(d < 5, `barge ${d.toFixed(1)} m off the centreline`); }
assert.equal(fw.state.running, false);
fw.start();
assert(fw.state.running && fw.state.shells > 80, `shells ${fw.state.shells}`);
// Run the show at 20 frames a second.
let flashes = 0, maxHead = 0;
for (ms = 0; ms <= (FIREWORKS.showSeconds + 15) * 1000; ms += 50) {
  fw.update(ms, camera, null);
  if (fw.lights.some(l => l.intensity > 0)) flashes++;
  maxHead = Math.max(maxHead, fw.head);
}
assert.equal(fw.state.running, false, 'the show ends');
assert(fw.state.shellsFired === fw.state.shells, `fired ${fw.state.shellsFired}/${fw.state.shells}`);
assert(flashes > 100, `flashes ${flashes}`);
assert(heard.launch === fw.state.shells && heard.burst === fw.state.shells, `sounds ${heard.launch}/${heard.burst}`);
assert(heard.lags.every(l => l <= 0 && l > -0.06), 'each sound starts from when it happened (within a frame)');
assert(heard.listener > 1000, 'the listener follows the camera');
// Every star is finite; bursts are 90-270 m up.
const st = fw.attributes.start.array, used = [];
for (let i = 0; i < st.length; i += 4) if (st[i + 3] > -1e8) used.push(st[i + 1]);
assert(used.length > 20000 && used.every(Number.isFinite), `stars ${used.length}`);
const bursts = used.filter(y => y > 1);
assert(Math.min(...bursts) > 80 && Math.max(...bursts) < 280, `burst heights ${Math.min(...bursts)}-${Math.max(...bursts)}`);
// The view looks from the Thủ Thiêm bank across the barges.
assert(fw.view.eye.distanceTo(fw.view.target) > 400 && fw.view.eye.y > 20);
fw.dispose();
console.log(`ok - fireworks: ${fw.state.shells} shells over ${FIREWORKS.showSeconds} s from ${fw.sites.length} barges, ${used.length} stars written, bursts ${Math.round(Math.min(...bursts))}-${Math.round(Math.max(...bursts))} m up`);
