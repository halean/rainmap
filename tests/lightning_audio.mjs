// Thunder in 3d/lightning.js is synthesised from the bolt's geometry and
// the listener's position (see renderThunder). These tests pin the physics
// that make it "roll" and change with distance, on plain arrays with no
// browser: onset after the sound's travel time, a spread that follows the
// channel's near-to-far extent, highs that fall off with distance, a pan
// that follows where the channel is, and clean, bounded samples. They also
// guard the audio-graph wiring with a minimal mock context -- a source
// created but never routed to `destination` is silent, and the reverb
// return must be shared, not re-wired per strike (which would stack gain).
import {readFileSync} from 'node:fs';
import * as THREE from '../3d/vendor/three.module.js';
import {boltChannel, cloudChannel, channelSegments, makeStrokes, brightnessAt, viewWeight} from '../3d/lightning.js';
import {renderThunder, playThunder, reverbReturn, SPEED_OF_SOUND} from '../3d/thunder.js';

function run(name, fn) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { console.log(`FAIL - ${name}: ${e.message}`); process.exitCode = 1; }
}

// Deterministic generator so geometry-dependent assertions are repeatable.
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

function verticalChannel(x, z, top = 2500, bottom = 0) {
  // A straight vertical channel: the simplest geometry with a known
  // nearest/farthest point from any listener on the ground.
  const rng = lcg(7);
  const {main, branches} = boltChannel(new THREE.Vector3(x, top, z), new THREE.Vector3(x, bottom, z), {rng, sway: 0.0001, branchChance: 0});
  return channelSegments([{points: main, weight: 1}]);
}

function hfRatio(samples) {
  // Energy of the first difference over energy of the signal: a crude
  // proxy for high-frequency content that needs no FFT.
  let hf = 0, total = 0;
  for (let i = 1; i < samples.length; i++) { const d = samples[i] - samples[i - 1]; hf += d * d; total += samples[i] * samples[i]; }
  return total ? hf / total : 0;
}

run('thunder starts after the sound has travelled from the nearest part of the channel', () => {
  const segments = verticalChannel(3000, 0);
  const r = renderThunder(segments, [0, 2, 0], {sampleRate: 8000, rng: lcg(1)});
  const expected = 3000 / SPEED_OF_SOUND; // nearest part is the foot of the channel, 3 km away
  if (Math.abs(r.startDelaySec - expected) > 0.15) throw new Error(`onset ${r.startDelaySec.toFixed(2)} s, expected ~${expected.toFixed(2)} s`);
});

run('the roll lasts at least as long as the near-to-far spread of the channel (why it rolls at all)', () => {
  const segments = verticalChannel(3000, 0);
  const r = renderThunder(segments, [0, 2, 0], {sampleRate: 8000, rng: lcg(2)});
  const spread = (Math.hypot(3000, 2500) - 3000) / SPEED_OF_SOUND; // top of the channel is farther than its foot
  if (r.durationSec < spread) throw new Error(`duration ${r.durationSec.toFixed(2)} s is shorter than the channel's own arrival spread ${spread.toFixed(2)} s`);
  if (r.farthestM <= r.nearestM) throw new Error('farthest part of the channel is not farther than the nearest');
});

run('a close strike keeps its highs (a crack); a distant one is only a low rumble', () => {
  const segments = verticalChannel(0, 0);
  const near = renderThunder(segments, [250, 2, 0], {sampleRate: 16000, rng: lcg(3)});
  const far = renderThunder(segments, [9000, 2, 0], {sampleRate: 16000, rng: lcg(3)});
  const hn = hfRatio(near.samples), hf = hfRatio(far.samples);
  if (!(hn > hf * 2)) throw new Error(`near HF ratio ${hn.toFixed(4)} is not clearly above far ${hf.toFixed(4)} -- distance is not filtering the highs`);
});

run('a distant strike is quieter than a close one, but not silent', () => {
  const segments = verticalChannel(0, 0);
  const peak = s => Math.max(...Array.from(s.samples, Math.abs));
  const near = peak(renderThunder(segments, [250, 2, 0], {sampleRate: 8000, rng: lcg(4)}));
  const far = peak(renderThunder(segments, [9000, 2, 0], {sampleRate: 8000, rng: lcg(4)}));
  if (!(near > far)) throw new Error(`near peak ${near.toFixed(3)} not above far peak ${far.toFixed(3)}`);
  if (!(far > 0.05)) throw new Error(`far peak ${far.toFixed(3)} is effectively silent -- loudness floor is missing`);
});

run('samples are finite and within [-1, 1] (soft clip, no overflow)', () => {
  const rng = lcg(5);
  const {main, branches} = boltChannel(new THREE.Vector3(200, 2500, -300), new THREE.Vector3(0, 0, 0), {rng});
  const segments = channelSegments([{points: main, weight: 1}, ...branches.map(points => ({points, weight: .45}))]);
  const r = renderThunder(segments, [60, 2, 40], {sampleRate: 8000, rng: lcg(6), strokes: [{at: 0, intensity: 1}, {at: .05, intensity: .8}, {at: .11, intensity: .5}]});
  for (const v of r.samples) if (!Number.isFinite(v) || v > 1 || v < -1) throw new Error(`bad sample ${v}`);
});

run('later return strokes make the thunder longer than a single stroke would', () => {
  const segments = verticalChannel(1500, 0);
  const one = renderThunder(segments, [0, 2, 0], {sampleRate: 8000, rng: lcg(8), strokes: [{at: 0, intensity: 1}]});
  const many = renderThunder(segments, [0, 2, 0], {sampleRate: 8000, rng: lcg(8), strokes: [{at: 0, intensity: 1}, {at: .4, intensity: .9}]});
  if (!(many.durationSec > one.durationSec)) throw new Error('a second stroke did not extend the render');
});

run('pan follows which side of the view the channel is on', () => {
  const segments = verticalChannel(0, -2000);            // channel straight ahead of a listener looking down -Z...
  const ahead = renderThunder(segments, [0, 2, 0], {sampleRate: 4000, rng: lcg(9), forward: [0, 0, -1]});
  const right = renderThunder(verticalChannel(2000, 0), [0, 2, 0], {sampleRate: 4000, rng: lcg(9), forward: [0, 0, -1]});
  const left = renderThunder(verticalChannel(-2000, 0), [0, 2, 0], {sampleRate: 4000, rng: lcg(9), forward: [0, 0, -1]});
  if (Math.abs(ahead.pan) > 0.15) throw new Error(`channel straight ahead panned ${ahead.pan}`);
  if (!(right.pan > 0.4)) throw new Error(`channel to the right (+X) panned ${right.pan}, expected clearly positive`);
  if (!(left.pan < -0.4)) throw new Error(`channel to the left (-X) panned ${left.pan}, expected clearly negative`);
});

run('a sheet flash (in-cloud channel) is heard as a longer, lower, more delayed roll than a nearby ground strike', () => {
  const rng = lcg(10);
  const cloud = channelSegments([{points: cloudChannel(new THREE.Vector3(0, 2250, 0), rng), weight: 1}]);
  const ground = verticalChannel(400, 0);
  const listener = [0, 2, 300];
  const s = renderThunder(cloud, listener, {sampleRate: 8000, rng: lcg(11)});
  const g = renderThunder(ground, listener, {sampleRate: 8000, rng: lcg(11)});
  if (!(s.startDelaySec > g.startDelaySec)) throw new Error('sheet thunder was not more delayed than a nearby ground strike');
  if (!(hfRatio(s.samples) < hfRatio(g.samples))) throw new Error('sheet thunder was not lower-pitched than a nearby ground strike');
});

run('boltChannel: main channel runs from the cloud point to the target, with branches that end above the ground', () => {
  const rng = lcg(12);
  const start = new THREE.Vector3(120, 2500, -80), end = new THREE.Vector3(0, 2, 0);
  const {main, branches} = boltChannel(start, end, {rng});
  if (!main[0].equals(start) || !main[main.length - 1].equals(end)) throw new Error('main channel endpoints are not the cloud point and the target');
  if (main.length < 16) throw new Error(`main channel has only ${main.length} points -- not enough tortuosity`);
  if (!branches.length) throw new Error('no branches were generated');
  for (const b of branches) if (b[b.length - 1].y <= end.y + 39) throw new Error('a branch reached the ground -- only the main channel should');
});

run('makeStrokes: a ground flash is 1-6 strokes, a sheet flash 2-5, each with a cooling time; brightness cools between strokes and rises again', () => {
  for (let i = 0; i < 50; i++) {
    const g = makeStrokes('ground'), s = makeStrokes('sheet');
    if (g.length < 1 || g.length > 6) throw new Error(`ground strokes ${g.length}`);
    if (s.length < 2 || s.length > 5) throw new Error(`sheet strokes ${s.length}`);
    for (const st of [...g, ...s]) if (!(st.tau > 0)) throw new Error('stroke without a cooling time');
  }
  const strokes = [{at: 0, intensity: 1, tau: 40}, {at: 80, intensity: .9, tau: 40}];
  const dipped = brightnessAt(strokes, 70), again = brightnessAt(strokes, 81);
  if (!(dipped < brightnessAt(strokes, 0))) throw new Error('channel did not cool after the first stroke');
  if (!(again > dipped)) throw new Error('second stroke did not re-brighten the channel');
});

// Rumble, not drumming: inside the roll the sound must be continuous. The
// earlier synthesis gave each of ~30 channel segments its own short
// percussive burst, so the roll was a string of separate hits with gaps
// between them. This measures the 25 ms RMS envelope across the active
// part of a render and rejects gaps and rapid-fire onsets.
function frames(samples, sampleRate, frameSec = .025) {
  const size = Math.max(1, Math.floor(frameSec * sampleRate)), out = [];
  for (let i = 0; i + size <= samples.length; i += size) {
    let e = 0; for (let j = 0; j < size; j++) e += samples[i + j] * samples[i + j];
    out.push(Math.sqrt(e / size));
  }
  return out;
}
function rollShape(samples, sampleRate) {
  const f = frames(samples, sampleRate), max = Math.max(...f);
  const active = f.map(v => v > max * .05);
  const firstOn = active.indexOf(true), lastOn = active.lastIndexOf(true);
  let gaps = 0, onsets = 0;
  for (let i = firstOn; i <= lastOn; i++) {
    if (f[i] < max * .02) gaps++;
    if (i > firstOn && f[i] > f[i - 1] * 4 && f[i] > max * .1) onsets++;
  }
  return {gapFraction: gaps / (lastOn - firstOn + 1), onsets, span: lastOn - firstOn + 1};
}

run('the roll is continuous: no gaps inside it and only a handful of onsets (rumble, not drumming)', () => {
  const rng = lcg(21);
  const {main, branches} = boltChannel(new THREE.Vector3(400, 2500, -2600), new THREE.Vector3(0, 2, -3000), {rng});
  const segments = channelSegments([{points: main, weight: 1}, ...branches.map(points => ({points, weight: .45}))]);
  const r = renderThunder(segments, [0, 60, 0], {sampleRate: 16000, rng: lcg(22)});
  const shape = rollShape(r.samples, 16000);
  if (shape.span < 20) throw new Error(`active roll only ${shape.span} frames (${(shape.span * .025).toFixed(2)} s)`);
  if (shape.gapFraction > .05) throw new Error(`${(shape.gapFraction * 100).toFixed(0)}% of the roll is silent gaps -- that is drumming`);
  if (shape.onsets > 4) throw new Error(`${shape.onsets} abrupt onsets inside one roll -- that is drumming`);
});

run('a multi-stroke flash still reads as one roll, not a drum pattern', () => {
  const rng = lcg(23);
  const {main, branches} = boltChannel(new THREE.Vector3(-300, 2500, -1800), new THREE.Vector3(0, 2, -2000), {rng});
  const segments = channelSegments([{points: main, weight: 1}, ...branches.map(points => ({points, weight: .45}))]);
  const strokes = [{at: 0, intensity: 1}, {at: .06, intensity: .9}, {at: .11, intensity: .5}, {at: .19, intensity: .8}];
  const r = renderThunder(segments, [0, 60, 0], {sampleRate: 16000, rng: lcg(24), strokes});
  const shape = rollShape(r.samples, 16000);
  if (shape.gapFraction > .05) throw new Error(`${(shape.gapFraction * 100).toFixed(0)}% gaps with 4 strokes`);
  if (shape.onsets > 6) throw new Error(`${shape.onsets} abrupt onsets with 4 strokes`);
});

// A strike's thunder must *roll*, not boom-and-fade: after the clap, the
// tail has to hold most of its level for many seconds. This is what "still
// sounds like drums" turned out to mean once measured -- a 1.5 s clap at
// full level followed by 12 s at 10-25% of it. The in-cloud channel every
// strike now carries, plus the slow AGC in renderThunder, hold it up.
run('a strike with its in-cloud channel rolls for 4-10 s, tapering, and the tail holds above the drum-and-fade level', () => {
  const rng = lcg(41);
  const start = new THREE.Vector3(300, 2500, -3800), end = new THREE.Vector3(0, 2, -4000);
  const {main, branches} = boltChannel(start, end, {rng});
  const segments = channelSegments([{points: main, weight: 1}, ...branches.map(points => ({points, weight: .45})), {points: cloudChannel(start, rng), weight: 1.2}, {points: cloudChannel(start, rng), weight: 1.2}]);
  const r = renderThunder(segments, [0, 900, 0], {sampleRate: 8000, rng: lcg(42), strokes: [{at: 0, intensity: 1}, {at: .07, intensity: .8}]});
  const bars = frames(r.samples, 8000, .5), max = Math.max(...bars);
  // The loudest half-second is wherever the channel's broadside section
  // happens to arrive -- not necessarily first -- so judge the whole roll:
  // how long it stays audible, and how much of that time it holds its level.
  const active = bars.filter(v => v > max * .05), seconds = active.length * .5;
  if (seconds < 4) throw new Error(`roll only ${seconds.toFixed(1)} s`);
  if (seconds > 10.5) throw new Error(`roll ${seconds.toFixed(1)} s -- a drone, not a roll`);
  const sorted = [...active].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
  if (median < max * .25) throw new Error(`median level ${(median / max).toFixed(2)} of peak across the roll -- that is a boom with an afterglow, not a roll`);
});

// --- audio graph wiring, on a mock context ---------------------------------

class Param { constructor(owner) { this.owner = owner; this.value = 0; } }
class Node {
  constructor(kind) { this.kind = kind; this.edges = []; this.started = false; }
  connect(target) { this.edges.push(target); return target; }
  start() { this.started = true; }
}
class MockContext {
  constructor() { this.sampleRate = 8000; this.currentTime = 0; this.nodes = []; }
  _track(n) { this.nodes.push(n); return n; }
  createBuffer(channels, length) { return {length, getChannelData: () => new Float32Array(length)}; }
  createBufferSource() { return this._track(new Node('source')); }
  createGain() { const n = this._track(new Node('gain')); n.gain = new Param(n); return n; }
  createConvolver() { return this._track(new Node('convolver')); }
  createStereoPanner() { const n = this._track(new Node('panner')); n.pan = new Param(n); return n; }
}
function reachable(node, destination, seen = new Set()) {
  if (node === destination) return true;
  if (seen.has(node)) return false;
  seen.add(node);
  return node.edges.some(next => reachable(next, destination, seen));
}
function through(node, via, destination, seen = new Set()) {
  if (node === via) return reachable(node, destination);
  if (seen.has(node)) return false;
  seen.add(node);
  return node.edges.some(next => through(next, via, destination, seen));
}

run('thunder.js stands alone: no three.js or DOM references (so thunder-worker.js can import it)', () => {
  const source = readFileSync(new URL('../3d/thunder.js', import.meta.url), 'utf8');
  for (const forbidden of ["from 'three'", 'document.', 'window.', 'THREE.']) {
    if (source.includes(forbidden)) throw new Error(`thunder.js references ${forbidden}, which a worker cannot provide`);
  }
  if (typeof renderThunder !== 'function') throw new Error('renderThunder not exported');
});

run('playThunder: the source reaches destination directly and through the shared reverb', () => {
  const ctx = new MockContext(), destination = new Node('destination');
  const reverb = reverbReturn(ctx, destination);
  const rendered = renderThunder(verticalChannel(500, 0), [0, 2, 0], {sampleRate: 8000, rng: lcg(13)});
  const source = playThunder(ctx, destination, rendered, reverb);
  if (!source.started) throw new Error('source never started');
  if (!reachable(source, destination)) throw new Error('source never reaches destination');
  if (!through(source, reverb, destination)) throw new Error('source has no path through the reverb to destination');
});

run('playThunder: repeated strikes do not add extra reverb returns (no gain stacking)', () => {
  const ctx = new MockContext(), destination = new Node('destination');
  const reverb = reverbReturn(ctx, destination);
  const rendered = renderThunder(verticalChannel(500, 0), [0, 2, 0], {sampleRate: 8000, rng: lcg(14)});
  for (let i = 0; i < 5; i++) playThunder(ctx, destination, rendered, reverb);
  if (reverb.edges.length !== 1) throw new Error(`reverb has ${reverb.edges.length} outgoing connections after 5 strikes; expected the single return wired at setup`);
});

run('playThunder: the panner is set from the render and sits in the dry path', () => {
  const ctx = new MockContext(), destination = new Node('destination');
  const rendered = renderThunder(verticalChannel(2000, 0), [0, 2, 0], {sampleRate: 4000, rng: lcg(15), forward: [0, 0, -1]});
  playThunder(ctx, destination, rendered, null);
  const panner = ctx.nodes.find(n => n.kind === 'panner');
  if (!panner) throw new Error('no panner created');
  if (Math.abs(panner.pan.value - rendered.pan) > 1e-9) throw new Error('panner value does not match the render');
  if (!reachable(panner, destination)) throw new Error('panner is not in the path to destination');
});

if (process.exitCode) process.exit(1);

run('viewWeight: nearer and in front of the camera is favoured; far or behind is rare but never impossible', () => {
  if (!(viewWeight(1000, 1) > viewWeight(5000, 1))) throw new Error('nearer site not favoured');
  if (!(viewWeight(3000, 1) > viewWeight(3000, -1))) throw new Error('site in front not favoured over one behind');
  if (!(viewWeight(20000, -1) > 0)) throw new Error('a far site behind the camera was made impossible');
  if (!(viewWeight(2000, 1) / viewWeight(18000, -1) > 20)) throw new Error('the preference for what the viewer can see is too weak to matter');
});
