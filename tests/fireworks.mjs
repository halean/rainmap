// node --loader ./tests/three-loader.mjs tests/fireworks.mjs
// Fireworks over the river (3d/fireworks.js): ballistics, the programme, bursts and flashes.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFireworks, starAt, apex, launchSpeed, FIREWORKS} from '../3d/fireworks.js';
import {RIVER} from '../3d/river-lines.js';
import {soundDelay, createFireworkSound} from '../3d/fireworks-sound.js';
import {absorption, soundSpeed, blast, friedlander, throughAir, airCutoff, arrivals, retarded} from '../3d/fireworks-acoustics.js';
import {renderBurst, renderLaunch} from '../3d/fireworks-render.js';
const project = (lon, lat) => [(lon - 106.65) * 111320 * Math.cos(10.81 * Math.PI / 180), -(lat - 10.81) * 111320];

// Ballistics: the launch speed reaches the asked height; drag slows the stars.
for (const h of [100, 180, 260]) { const v = launchSpeed(h, 0.05); assert(Math.abs(apex(v, 0.05).h - h) < 0.01, `apex ${h}`); }
const far = starAt([0, 0, 0], [100, 0, 0], 1.3, 5)[0];
assert(far > 70 && far < 100 / 1.3, `drag: ${far}`);
assert(starAt([0, 200, 0], [0, 0, 0], 1.3, 10)[1] < 200 - 60, 'stars fall');

// Sound physics (fireworks-acoustics.js).
// ISO 9613-1 at 20 °C, 70 % RH (its table: 1 kHz 5.0, 4 kHz 22.9, 8 kHz 76.6 dB/km).
const iso = {T: 20, RH: 70};
for (const [f, dbkm, tol] of [[1000, 5.0, 0.6], [4000, 22.9, 2.5], [8000, 76.6, 8]]) {
  const got = absorption(f, iso) * 1000; assert(Math.abs(got - dbkm) < tol, `absorption ${f} Hz: ${got.toFixed(2)} dB/km`);
}
assert(Math.abs(soundSpeed(20) - 343.2) < 0.3, `c(20 °C) ${soundSpeed(20)}`);
assert(Math.abs(soundDelay(700, 28) - 700 / soundSpeed(28)) < 1e-12 && soundDelay(700, 28) > 2 && soundDelay(700, 28) < 2.05);
// Blast: 1/R far out, and the positive phase lengthens slowly.
const b1 = blast(0.004, 350), b2 = blast(0.004, 700);
assert(Math.abs(b1.ps / b2.ps - 2) < 0.05 && b2.td > b1.td && b2.td < b1.td * 1.2, `blast ${b1.ps} ${b2.ps} ${b1.td} ${b2.td}`);
assert(b2.ps > 5 && b2.ps < 60, `burst at 700 m: ${b2.ps.toFixed(1)} Pa`);   // ~110-130 dB peak, as displays measure
// Friedlander: positive then negative phase.
const fw1 = new Float64Array(4800); friedlander(fw1, 0, 1, 0.005, 48000);
assert(fw1[0] === 1 && fw1[100] > 0 && fw1[300] < 0);
// The air takes the highs: a sharp pulse after 700 m has lost its high end.
const sharp = new Float64Array(4096); friedlander(sharp, 0, 1, 0.0003, 48000);
const afar = throughAir(sharp, 700, 48000, {T: 28, RH: 80});
const slope = a => { let m = 0; for (let i = 1; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1])); return m; };
assert(slope(afar) < slope(sharp) / 5, 'the crack is rounded off');
assert(airCutoff(1400, iso) < airCutoff(300, iso), 'further, duller');
// Arrivals: the direct sound first, the river's reflection just after, an echo later and quieter.
const ear = [0, 45, 0], src = [700, 200, 0];
const paths = arrivals(src, ear, {atm: {T: 28, RH: 80}, reflectors: [{x: 900, y: 80, z: 300, area: 20000}]});
assert.equal(paths[0].kind, 'direct');
const surf = paths.find(p => p.kind === 'surface'), echo = paths.find(p => p.kind === 'echo');
assert(surf.delay - paths[0].delay > 0.03 && surf.delay - paths[0].delay < 0.12, `surface lag ${surf.delay - paths[0].delay}`);
assert(echo && echo.delay > surf.delay && echo.gain < paths[0].gain, 'echo later, quieter');
// Wind: downwind arrives sooner than upwind.
const down = arrivals(src, ear, {atm: {T: 28, RH: 80}, wind: [-5, 0]})[0], up = arrivals(src, ear, {atm: {T: 28, RH: 80}, wind: [5, 0]})[0];
assert(down.delay < up.delay && up.gain < down.gain, 'wind');
// Doppler: a source receding at 50 m/s is heard stretched (lower pitch): 1 s of emission spans (1 + 50/c) s.
const rec = retarded(t => [100 + 50 * t, 0, 0], [0, 0, 0], 343, 0, 1, 50);
assert(Math.abs((rec.end - rec.start) - (1 + 50 / 343)) < 1e-6, `doppler ${rec.end - rec.start}`);
// The renderers (what the worker runs): a burst 700 m off, heard from the bank.
const heardFrom = {sr: 48000, ear: [0, 45, 0], right: [0, -1], atm: {T: 28, RH: 80}, wind: [0, 0], reflectors: [{x: 900, y: 80, z: 300, area: 20000}]};
const [boom] = renderBurst(heardFrom, [700, 200, 0], 'peony', 80);
const peakAt = a => { let m = 0, at = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > m) { m = Math.abs(a[i]); at = i; } return {m, at}; };
const pk = peakAt(boom.L);
assert(Math.abs(boom.delay - Math.hypot(700, 155) / soundSpeed(28)) < 0.01, `first arrival ${boom.delay}`);
assert(pk.m > 0.02 && pk.m < 1 && pk.at < 0.01 * 48000, `peak ${pk.m} at ${pk.at}`);
const tailFrom = Math.round(0.5 * 48000);
assert(peakAt(boom.L.subarray(tailFrom)).m > 0.001, 'the echo off the tower comes later');
assert(boom.L.every(Number.isFinite) && boom.R.every(Number.isFinite));
const [crack] = renderBurst(heardFrom, [700, 200, 0], 'crackle', 90);
assert(peakAt(crack.L.subarray(Math.round(1.1 * 48000))).m > 0.002, 'crackling stars pop after the burst');
const launched = renderLaunch(heardFrom, [650, 0.4, 0], 5, true, [0, 62, 0]);
assert.equal(launched.length, 2, 'a mortar and its whistle');
const wh = launched[1];
assert(wh.delay > 650 / soundSpeed(28) && wh.L.length > 4 * 48000 && peakAt(wh.L).m > 0, `whistle from ${wh.delay}`);
// Without Web Audio the sound stays silent, and does not fail.
const quiet = createFireworkSound(); quiet.resume(); quiet.launch([0, 0, 0], 0, 3, true, [0, 60, 0]); quiet.burst([0, 200, 0], 0, 'peony', 80);
assert.equal(quiet.state.available, false); assert.equal(quiet.state.played, 0);
const heard = {launch: 0, burst: 0, lags: [], listener: 0};
const sound = {setListener: () => heard.listener++, launch: (p, lag, rise, whistle, v) => { heard.launch++; assert(v && v[1] > 30, 'launch velocity for the whistle'); assert(rise > 1 && rise < 12, `rise ${rise}`); heard.lags.push(lag); },
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
