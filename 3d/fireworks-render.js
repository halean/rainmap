// Renders each firework sound, from physics (fireworks-acoustics.js), into
// stereo sample arrays: what the listener hears of one launch or one burst,
// every path of it included. Pure: no Web Audio, no DOM, so it runs in a Web
// Worker (fireworks-sound-worker.js) off the main thread, or inline, or in
// tests. fireworks-sound.js schedules the results. See FIREWORKS.md.
//
// A `scene` is what the renderer needs to know about the world:
//   {sr, ear: [x, y, z], right: [rx, rz] (the view's right, for panning),
//    atm: {T, RH, p}, wind: [wx, wz] m/s, reflectors: [{x, y, z, area}]}
// Each render returns [{L, R, delay, wet}]: the samples, when the first
// arrival reaches the listener after the event (s), and how much of it to
// send to the diffuse tail.
import {absorption, airCutoff, arrivals, blast, friedlander, retarded, soundSpeed, throughAir, FULL_SCALE_PA} from './fireworks-acoustics.js';
import {starAt, RISE_DRAG} from './fireworks-ballistics.js';

// Sources, from the charge (kg of TNT equivalent, acoustically): display
// shells a few grams, salutes tens (flash powder), a mortar's lift ~0.3 g
// (most of its energy drives the shell up the tube), a crackling star's
// pinch of flash well under a gram.
export const SOURCES = Object.freeze({
  burst: size => ({W: 0.004 * (size / 80) ** 3, td0: 0.006}),
  salute: {W: 0.03, td0: 0.0012},
  lift: {W: 0.0003, td0: 0.003, tube: 0.9},           // tube length (m): it rings at c/4L
  crackle: {W: 0.0003, td0: 0.0003, count: 70},
  whistle: {pa: 20, f0: 1400, f1: 3200},              // Pa at 1 m (~120 dB); the note rises as the whistle burns down
  hiss: {pa: 0.5},                                    // Pa at 1 m per burning star
});

/** Add one arrival's waveform (already scaled) into the stereo arrays, panned (constant power) from its direction. */
function place(scene, L, R, wave, at, dir) {
  const side = Math.max(-1, Math.min(1, dir[0] * scene.right[0] + dir[2] * scene.right[1])), a = (side + 1) * Math.PI / 4;
  const gl = Math.cos(a), gr = Math.sin(a);
  for (let i = 0; i < wave.length; i++) { const j = at + i; if (j >= 0 && j < L.length) { L[j] += wave[i] * gl; R[j] += wave[i] * gr; } }
}

/** A blast of charge W: the far-field strength ps·R (Pa·m) along a path of R m. */
const blastShape = (sr, W, td0) => R => {
  const {ps, td} = blast(W, R, td0), out = new Float64Array(Math.ceil(td * 6 * sr) + 8);
  friedlander(out, 0, ps * R, td, sr);
  return out;
};

/** An impulsive source at `src`, heard along every path: `shape(R)` is its waveform for a path of R m. */
function impulsive(scene, src, shape, extra = 0) {
  const {sr, atm} = scene, paths = arrivals(src, scene.ear, {atm, wind: scene.wind, reflectors: scene.reflectors, surface: 0});
  const first = paths[0].delay, last = paths[paths.length - 1].delay;
  const n = Math.ceil((last - first + 0.4 + extra) * sr), L = new Float32Array(n), R = new Float32Array(n);
  // Paths within 30 m of each other share one air filter (the direct sound and the river's
  // reflection, usually); echoes get their own, the 4 strongest only.
  const echoes = paths.filter(p => p.kind === 'echo').sort((a, b) => b.gain - a.gain).slice(0, 4), filtered = [];
  for (const p of [...paths.filter(p => p.kind !== 'echo'), ...echoes]) {
    let f = filtered.find(q => Math.abs(q.R - p.R) < 30);
    if (!f) filtered.push(f = {R: p.R, wave: throughAir(shape(p.R), p.R, sr, atm)});
    const k = p.gain / FULL_SCALE_PA, wave = Float32Array.from(f.wave, x => x * k);
    place(scene, L, R, wave, Math.round((p.delay - first) * sr), p.dir);
  }
  return {L, R, first};
}

/** A mortar firing at p: its muzzle blast and the tube ringing at c/4L. With `whistle`,
 *  the shell (launched at v) whistles up its trajectory for `rise` s. */
export function renderLaunch(scene, p, rise, whistle, v) {
  const {sr, atm} = scene, S = SOURCES.lift, blastOf = blastShape(sr, S.W, S.td0), f = soundSpeed(atm.T) / (4 * S.tube);
  const shape = R => {
    const out = blastOf(R), ring = new Float64Array(Math.ceil(0.15 * sr)), amp = out[0] * 0.35;
    for (let i = 0; i < ring.length; i++) ring[i] = amp * Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / sr / 0.045);
    for (let i = 0; i < out.length && i < ring.length; i++) ring[i] += out[i];
    return ring;
  };
  const {L, R, first} = impulsive(scene, p, shape);
  const out = [{L, R, delay: first, wet: 0.3}];
  if (whistle && v) out.push(renderWhistle(scene, p, v, rise));
  return out;
}

/** The whistle from the rising shell, heard with the Doppler shift of its climb: each
 *  output sample is the tone as emitted at its retarded time. */
export function renderWhistle(scene, from, v, rise) {
  const {sr, atm, ear} = scene, c = soundSpeed(atm.T), W = SOURCES.whistle;
  const pos = te => starAt(from, v, RISE_DRAG, te), t0 = 0.08, t1 = rise * 0.92;
  const blocks = Math.max(3, Math.ceil((t1 - t0) * 1.3 * sr / 64)), {te, start, end} = retarded(pos, ear, c, t0, t1, blocks);
  const n = Math.ceil((end - start) * sr), L = new Float32Array(n), R = new Float32Array(n);
  const fe = s => W.f0 + (W.f1 - W.f0) * (s - t0) / (t1 - t0);
  const phase = s => 2 * Math.PI * (W.f0 * s + (W.f1 - W.f0) * (s - t0) ** 2 / (2 * (t1 - t0)));
  let gl = 0, gr = 0;
  for (let i = 0; i < n; i++) {
    const b = i / n * (blocks - 1), k = Math.min(blocks - 2, Math.floor(b)), s = te[k] + (te[k + 1] - te[k]) * (b - k);
    if (i % 64 === 0) {                                                  // level and pan follow the shell, every 64 samples
      const q = pos(s), d = [q[0] - ear[0], q[1] - ear[1], q[2] - ear[2]], r = Math.hypot(...d) || 1;
      const side = Math.max(-1, Math.min(1, (d[0] * scene.right[0] + d[2] * scene.right[1]) / r)), a = (side + 1) * Math.PI / 4;
      const g = W.pa / r * Math.pow(10, -absorption(fe(s), atm) * r / 20) / FULL_SCALE_PA;
      gl = g * Math.cos(a); gr = g * Math.sin(a);
    }
    const env = Math.min(1, i / (0.05 * sr), (n - i) / (0.1 * sr)), y = Math.sin(phase(s)) * env;
    L[i] = y * gl; R[i] = y * gr;
  }
  return {L, R, delay: start, wet: 0.2};                                // `start` counts from the launch
}

/** A burst at p: the blast along every path, then crackling stars popping where they are,
 *  or burning stars hissing. */
export function renderBurst(scene, p, type, size, random = Math.random) {
  const {sr, atm, ear} = scene, S = type === 'salute' ? SOURCES.salute : SOURCES.burst(size);
  const crackles = type === 'crackle' || type === 'salute', hiss = type === 'willow' || type === 'palm';
  const {L, R, first} = impulsive(scene, p, blastShape(sr, S.W, S.td0), crackles ? 3 : hiss ? 4.5 : 0);
  const c = soundSpeed(atm.T), dist = q => Math.hypot(q[0] - ear[0], q[1] - ear[1], q[2] - ear[2]);
  if (crackles) {
    const C = SOURCES.crackle, Rm = dist(p), micro = throughAir(blastShape(sr, C.W, C.td0)(Rm), Rm, sr, atm);
    const count = type === 'crackle' ? C.count : 25, t0 = type === 'crackle' ? 1.2 : 0.3;
    for (let i = 0; i < count; i++) {
      const z = random() * 2 - 1, a = random() * 2 * Math.PI, rr = Math.sqrt(1 - z * z), reach = size * (0.6 + 0.5 * random());
      const q = [p[0] + rr * Math.cos(a) * reach, p[1] + z * reach - 4, p[2] + rr * Math.sin(a) * reach];
      const when = t0 + random() * 1.6, d = dist(q), k = (0.5 + random()) / d / FULL_SCALE_PA;
      place(scene, L, R, Float32Array.from(micro, x => x * k), Math.round((when + d / c - first) * sr), [(q[0] - ear[0]) / d, 0, (q[2] - ear[2]) / d]);
    }
  }
  if (hiss) {                                                           // combustion noise, low-passed by the air on the way
    const d = dist(p), fc = airCutoff(d, atm), k = Math.exp(-2 * Math.PI * fc / sr), stars = 150;
    const amp = SOURCES.hiss.pa * Math.sqrt(stars) / d / FULL_SCALE_PA, n = Math.min(L.length, Math.ceil(4 * sr));
    let y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      y1 = y1 * k + (random() * 2 - 1) * (1 - k); y2 = y2 * k + y1 * (1 - k);
      const env = Math.min(1, i / (0.3 * sr)) * Math.exp(-i / sr / 1.8) * amp * 2.2, j = Math.round(0.15 * sr) + i;
      if (j < L.length) { L[j] += y2 * env; R[j] += y2 * env; }
    }
  }
  return [{L, R, delay: first, wet: 0.35}];
}

/** Run a render by name: what the worker and the inline fallback both call. */
export function render(kind, scene, args) {
  return kind === 'launch' ? renderLaunch(scene, ...args) : renderBurst(scene, ...args);
}
