// Thunder synthesis for 3d/lightning.js -- plain arrays and numbers only, no
// three.js and no DOM, so the same code runs on the main thread, inside
// thunder-worker.js, and under Node for tests/lightning_audio.mjs.

// Speed of sound in warm, humid air (~30 °C), metres per second. Thunder is
// timed from this and the geometry, not from a fixed delay.
export const SPEED_OF_SOUND = 349;
// Thunder has nothing above a few kHz, so it is rendered at this rate and
// resampled by the AudioContext -- about a third of the cost of 48 kHz.
export const RENDER_RATE = 16000;

// Thunder is the sound of the whole channel, and every part of it is a
// different distance from the listener, so the sound arrives spread over
// seconds: the nearest part first (a sharp crack if it is close), then the
// rest rolling in as their sound reaches you. That spread -- not a canned
// envelope -- is what makes it roll, and it changes with every bolt's shape
// and with where you are looking from.
//
// The channel is sampled every ~25 m (jittered), and each element adds a
// smooth, overlapping window into three band envelopes (low / mid / high)
// at the moment its sound arrives. Because the elements are dense and the
// windows overlap, the envelopes are continuous: they swell where many
// arrivals bunch up (the claps) and sag between, but never drop to separate
// hits. The output is continuous noise, split into steep bands, shaped by
// the envelopes -- rumble, not drumming. Per element:
//   arrival     = distance / SPEED_OF_SOUND
//   amplitude   ∝ length / distance     (spherical spreading of pressure)
//               × |sin(angle to line of sight)|  (a line source radiates
//                 broadside, so segments crossing your view are the claps)
//   band weight: highs fall off fast with distance, mids more slowly, lows
//                 hardly at all  (air absorbs the highs first, which is why
//                 far thunder is only a low rumble and close thunder cracks)
//   window      widens with distance, and is longest for the low band
//                 (dispersion and scattering smear far, low sound the most)
// Later return strokes re-excite the channel, weaker and more smeared. A
// slow irregular modulation adds the uneven swell of a real roll. The whole
// thing is rendered offline into one buffer, then normalised so a close
// strike is loud and a distant one is softer (partly -- fully physical
// falloff would make most of the city inaudible).
export function renderThunder(segments, listener, {sampleRate = RENDER_RATE, speed = SPEED_OF_SOUND, forward = [0, 0, -1], strokes = [{at: 0, intensity: 1}], rng = Math.random, maxSeconds = 10, elementMetres = 25} = {}) {
  const [lx, ly, lz] = listener;
  const elements = [];
  let nearest = Infinity, farthest = 0, nearestDir = null;
  for (const s of segments) {
    const tx = s.b[0] - s.a[0], ty = s.b[1] - s.a[1], tz = s.b[2] - s.a[2];
    const length = Math.hypot(tx, ty, tz);
    if (length < 1e-6) continue;
    const pieces = Math.max(1, Math.ceil(length / elementMetres));
    for (let k = 0; k < pieces; k++) {
      // Jittered along the piece: equally spaced elements on a segment that
      // points at the listener would arrive at equal time steps (25 m is a
      // 72 ms step -- a 14 Hz comb, which is exactly a machine-gun rate).
      const f = (k + rng()) / pieces;
      const dx = s.a[0] + tx * f - lx, dy = s.a[1] + ty * f - ly, dz = s.a[2] + tz * f - lz;
      const d = Math.max(30, Math.hypot(dx, dy, dz));
      const cosine = (tx * dx + ty * dy + tz * dz) / (length * d);
      const broadside = 0.2 + 0.8 * Math.sqrt(Math.max(0, 1 - cosine * cosine));
      elements.push({arrival: d / speed, amp: (s.w ?? 1) * broadside * (length / pieces) / d, d});
      if (d < nearest) { nearest = d; nearestDir = [dx / d, dy / d, dz / d]; }
      if (d > farthest) farthest = d;
    }
  }
  if (!elements.length) return null;
  let first = Infinity; for (const e of elements) first = Math.min(first, e.arrival);
  const widthFor = d => Math.min(.4, .09 + .06 * d / 1000);         // seconds, before the band multiplier
  const bandWidth = [2.0, 1.5, 1.0], bandGain = [1, .35, .3];
  let lastStroke = 0; for (const s of strokes) lastStroke = Math.max(lastStroke, s.at);
  let spread = 0; for (const e of elements) spread = Math.max(spread, e.arrival - first + widthFor(e.d) * bandWidth[0]);
  const seconds = Math.min(maxSeconds, spread + lastStroke + 1.2);
  // Envelopes at 1 kHz: plenty for shapes tens of ms wide, cheap to build.
  const ER = 1000, m = Math.ceil(seconds * ER);
  const env = [new Float32Array(m), new Float32Array(m), new Float32Array(m)];
  strokes.forEach((stroke, index) => {
    // Later strokes re-excite the channel, weaker and more smeared: a sharp
    // copy per stroke 35-115 ms apart would be a burst-fire rhythm.
    const gain = Math.pow(Math.max(0, stroke.intensity), 2.5) * (index ? .6 : 1), smear = 1 + .8 * index;
    for (const e of elements) {
      const weight = [1, Math.exp(-e.d / 3000), Math.exp(-e.d / 1000)];
      for (let b = 0; b < 3; b++) {
        const count = Math.max(2, Math.round(widthFor(e.d) * bandWidth[b] * smear * ER));
        const start = Math.round((e.arrival - first + stroke.at) * ER);
        // Scaled by a reference width so a wider window spreads the same
        // energy rather than adding more of it.
        const a = e.amp * gain * weight[b] * (100 / count), target = env[b], step = 2 * Math.PI / count;
        for (let i = 0; i < count && start + i < m; i++) target[start + i] += a * (.5 - .5 * Math.cos(step * i));
      }
    }
  });
  // Ease the contrast between the clap and the roll: the arrival density
  // peaks sharply where the channel passes closest to the listener, and
  // taken literally that makes a hit followed by a comparatively quiet tail
  // -- a drum. Real thunder keeps its weight through the roll.
  for (const target of env) for (let i = 0; i < m; i++) target[i] = Math.pow(target[i], .5);
  // ...and hold the roll up behind it: a slow (300 ms) follower on the total
  // envelope, divided out at half strength, so the tail sits within a few
  // dB of the clap instead of a dozen below it.
  const total = new Float32Array(m);
  for (let i = 0; i < m; i++) total[i] = env[0][i] + env[1][i] + env[2][i];
  let ref = 0; for (let i = 0; i < m; i++) ref = Math.max(ref, total[i]);
  // ...then let it taper: held perfectly flat, a roll becomes a drone. The
  // decay (about 3.5 s to a third) is what makes it end.
  const kAgc = 1 - Math.exp(-1 / 300);
  let agc = 0;
  for (let i = 0; i < m; i++) {
    agc += kAgc * (total[i] - agc);
    const g = Math.exp(-i / (ER * 3.2)) / Math.sqrt(Math.max(agc, ref * .2) / ref); // floor caps the lift at ~2.2x so the taper wins
    for (const target of env) target[i] *= g;
  }
  // Slow, irregular modulation (~0.3-1.5 Hz): the uneven swell of a real
  // roll -- slow enough to read as rolling, never as a flutter.
  const mod = new Float32Array(m);
  let walk = 0, smooth = 0, modPeak = 1e-9;
  for (let i = 0; i < m; i++) { walk = walk * .999 + (rng() - .5) * .04; smooth += .006 * (walk - smooth); mod[i] = smooth; modPeak = Math.max(modPeak, Math.abs(smooth)); }
  for (let i = 0; i < m; i++) mod[i] = .68 + .32 * (mod[i] / modPeak);
  // Continuous noise in three bands, each normalised to unit RMS. The
  // filters are four cascaded one-poles (24 dB/oct): a gentle 6 dB/oct slope
  // leaves so much 200-1000 Hz in the "low" band that it rattles. The low
  // band is kept broad *within* the bass (up to ~150 Hz) on purpose: a very
  // narrow band's amplitude flutters deeply and fast, which reads as
  // pulsing, while a broader bass band fluctuates less overall.
  const n = Math.ceil(seconds * sampleRate);
  const bands = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const kL = 1 - Math.exp(-2 * Math.PI * 150 / sampleRate), kM = 1 - Math.exp(-2 * Math.PI * 500 / sampleRate), kH = 1 - Math.exp(-2 * Math.PI * 3500 / sampleRate);
  let L0 = 0, L1 = 0, L2 = 0, L3 = 0, M0 = 0, M1 = 0, M2 = 0, M3 = 0, H0 = 0, H1 = 0;
  for (let i = 0; i < n; i++) {
    const x = rng() * 2 - 1;
    L0 += kL * (x - L0); L1 += kL * (L0 - L1); L2 += kL * (L1 - L2); L3 += kL * (L2 - L3);
    M0 += kM * (x - M0); M1 += kM * (M0 - M1); M2 += kM * (M1 - M2); M3 += kM * (M2 - M3);
    H0 += kH * (x - H0); H1 += kH * (H0 - H1);
    bands[0][i] = L3; bands[1][i] = M3 - L3; bands[2][i] = H1 - M3;
  }
  // Bass noise, however it is filtered, has deep fast dips of its own (the
  // envelope of narrowband noise is Rayleigh-distributed), and those dips
  // read as sputtering. A fast follower flattens them -- the slow roll
  // still comes from the envelopes above, the grain is just held steadier.
  const rms = [0, 0, 0];
  for (let b = 0; b < 3; b++) {
    const band = bands[b], attack = 1 - Math.exp(-1 / (.004 * sampleRate)), release = 1 - Math.exp(-1 / (.05 * sampleRate));
    let follower = 0, energy = 0;
    for (let i = 0; i < n; i++) {
      if (b < 2) {
        const a = Math.abs(band[i]);
        follower += (a > follower ? attack : release) * (a - follower);
        band[i] /= Math.sqrt(follower + .02);
      }
      energy += band[i] * band[i];
    }
    rms[b] = 1 / Math.sqrt(energy / n || 1e-12);
  }
  const out = new Float32Array(n), g0 = bandGain[0] * rms[0], g1 = bandGain[1] * rms[1], g2 = bandGain[2] * rms[2];
  const e0 = env[0], e1 = env[1], e2 = env[2], b0 = bands[0], b1 = bands[1], b2 = bands[2], toEnv = ER / sampleRate;
  for (let i = 0; i < n; i++) {
    const t = i * toEnv, j = Math.min(m - 1, t | 0), j1 = Math.min(m - 1, j + 1), f = t - j, f0 = 1 - f;
    out[i] = ((e0[j] * f0 + e0[j1] * f) * g0 * b0[i] + (e1[j] * f0 + e1[j1] * f) * g1 * b1[i] + (e2[j] * f0 + e2[j1] * f) * g2 * b2[i]) * (mod[j] * f0 + mod[j1] * f);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) {
    // Only a very close strike overdrives the ear; a gentle soft clip stands
    // in for that, then loudness eases off with distance.
    const drive = 1 + .8 * Math.min(1, 300 / nearest), scale = drive / peak;
    const loudness = Math.min(1, Math.max(.12, Math.pow(700 / nearest, .55)));
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * scale) * loudness;
  }
  // Pan by where the nearest part of the channel sits relative to the view.
  const [fx, , fz] = forward, right = [-fz, 0, fx]; // cross(forward, up=(0,1,0)), the listener's right-hand side
  const rl = Math.hypot(right[0], right[2]) || 1;
  const pan = nearestDir ? Math.max(-1, Math.min(1, (nearestDir[0] * right[0] + nearestDir[2] * right[2]) / rl)) * .85 : 0;
  // How long it is actually heard: the buffer runs to the last tail sample,
  // but the roll tapers, so report the point where it drops below a tenth.
  const block = Math.max(1, Math.floor(sampleRate * .05));
  let audibleSec = 0, peakRms = 0;
  const blocks = [];
  for (let i = 0; i + block <= n; i += block) { let e = 0; for (let j = 0; j < block; j++) e += out[i + j] * out[i + j]; const v = Math.sqrt(e / block); blocks.push(v); peakRms = Math.max(peakRms, v); }
  for (let k = blocks.length - 1; k >= 0; k--) if (blocks[k] > peakRms * .1) { audibleSec = (k + 1) * block / sampleRate; break; }
  return {samples: out, sampleRate, startDelaySec: first, durationSec: n / sampleRate, audibleSec, nearestM: nearest, farthestM: farthest, pan};
}

// A synthetic room response for the city: a dense cloud of small early
// reflections, then a decaying, high-cut tail. Convolved with the thunder,
// it supplies the echoes off buildings that a dry render lacks, and --
// like any reverberation -- smooths whatever pulsing is left in the source.
// Diffuse on purpose: a few strong discrete echoes would turn a roll into
// drumming. Built once per context.
export function reverbImpulse(context, seconds = 3, rng = Math.random) {
  const n = Math.floor(seconds * context.sampleRate), buffer = context.createBuffer(1, n, context.sampleRate);
  const data = buffer.getChannelData(0);
  const k = 1 - Math.exp(-2 * Math.PI * 500 / context.sampleRate);
  let y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / context.sampleRate;
    y1 += k * ((rng() * 2 - 1) - y1); y2 += k * (y1 - y2);
    data[i] = y2 * Math.exp(-t / 1.1) * .6;
  }
  for (let r = 0; r < 80; r++) {
    const t = .01 + rng() * .5, i = Math.floor(t * context.sampleRate);
    if (i < n) data[i] += (rng() - .5) * .08 * Math.exp(-t / .35);
  }
  return buffer;
}

// The reverb return, built once per context: convolver -> wet gain ->
// destination. Every thunder sends into the same convolver; wiring the
// return per strike instead would stack one more wet path each time and
// the echoes would grow louder with every flash.
export function reverbReturn(context, destination) {
  if (!context.createConvolver) return null;
  const convolver = context.createConvolver(); convolver.buffer = reverbImpulse(context);
  const wet = context.createGain(); wet.gain.value = .5;
  convolver.connect(wet).connect(destination);
  return convolver;
}

// Wires one rendered thunder into the graph: dry (panned) into
// `destination`, and a send into the shared reverb, starting after the
// sound's own travel time from the channel. Returns the source.
export function playThunder(context, destination, rendered, reverb) {
  const buffer = context.createBuffer(1, rendered.samples.length, rendered.sampleRate || context.sampleRate);
  buffer.getChannelData(0).set(rendered.samples);
  const source = context.createBufferSource(); source.buffer = buffer;
  let head = source;
  if (context.createStereoPanner) { const panner = context.createStereoPanner(); panner.pan.value = rendered.pan; head = source.connect(panner); }
  const dry = context.createGain(); dry.gain.value = .75;
  head.connect(dry).connect(destination);
  if (reverb) head.connect(reverb);
  source.start(context.currentTime + Math.max(0, rendered.startDelaySec - (rendered.elapsedSec || 0)));
  return source;
}
