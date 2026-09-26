// The physics behind the fireworks' sound (fireworks-sound.js plays it):
// what each event puts into the air, and what the air, the river and the
// city do to it on the way to the listener. Pure functions, no Web Audio.
//
// Source:
//  - a burst is a blast wave: the Friedlander pulse, a sharp overpressure
//    decaying through a longer, weaker suction phase. Its peak falls as 1/R
//    far out (the far-field limit of the Kinney-Graham scaling), and its
//    positive phase lengthens slowly with distance as a weak shock does;
//  - a mortar is a smaller muzzle blast, plus the tube ringing at its
//    quarter-wave resonance c/4L;
//  - a crackling star is a micro-blast from a pinch of flash powder: a pulse
//    a fraction of a millisecond long, from where that star is;
//  - a whistle is a tone from the shell, Doppler-shifted by its climb;
//  - burning stars hiss: combustion noise.
// Path:
//  - the speed of sound from the air temperature, plus the wind along the
//    path;
//  - air absorption from ISO 9613-1 (temperature, humidity, pressure):
//    at 700 m it takes ~5 dB off 1 kHz and all of 10 kHz, which is why a
//    distant firework booms rather than cracks;
//  - spherical spreading, 1/R;
//  - a reflection off the river or ground, as an image source below it;
//  - echoes off the tall buildings of the model, each a scatterer on its
//    own path, arriving later and quieter.
// Approximations are named where they are made. See FIREWORKS.md.

export const P0 = 101325;                     // Pa, sea level
export const FULL_SCALE_PA = 100;             // what 1.0 in the audio buffer means (134 dB SPL)

/** Speed of sound (m/s) in air at T (°C). */
export const soundSpeed = T => 331.3 * Math.sqrt(1 + T / 273.15);

/** HCMC's air through a typical day, from the hour: warm and humid, hottest mid-afternoon. */
export function atmosphereAt(hour) {
  const k = Math.cos((hour - 14) / 24 * 2 * Math.PI);                 // 1 at 14:00, -1 at 02:00
  return {T: 27.5 + 3.5 * k, RH: 78 - 14 * k, p: P0};
}

/** Air absorption (dB per metre) at f Hz: ISO 9613-1. */
export function absorption(f, {T = 28, RH = 80, p = P0} = {}) {
  const Tk = T + 273.15, T0 = 293.15, T01 = 273.16, pr = P0, pa = p / pr;
  const C = -6.8346 * Math.pow(T01 / Tk, 1.261) + 4.6151;
  const h = RH * Math.pow(10, C) / pa;                                 // molar concentration of water vapour, %
  const frO = pa * (24 + 4.04e4 * h * (0.02 + h) / (0.391 + h));
  const frN = pa * Math.pow(Tk / T0, -0.5) * (9 + 280 * h * Math.exp(-4.170 * (Math.pow(Tk / T0, -1 / 3) - 1)));
  return 8.686 * f * f * (1.84e-11 / pa * Math.sqrt(Tk / T0) + Math.pow(Tk / T0, -2.5) * (
    0.01275 * Math.exp(-2239.1 / Tk) / (frO + f * f / frO) + 0.1068 * Math.exp(-3352.0 / Tk) / (frN + f * f / frN)));
}

/**
 * A blast's peak overpressure (Pa) and positive-phase duration (s) at R m.
 * W: the charge's acoustic yield in kg of TNT equivalent. Black-powder bursts
 * are slow and partly spent breaking the shell, so their yield is small:
 * about 1-10 g for display shells, more for flash-powder salutes. The peak
 * uses Kinney-Graham's scaled-distance formula; the duration starts at
 * `td0` (a deflagration is slower than TNT) and lengthens as a weak shock's
 * does, with the square root of the log of distance.
 */
export function blast(W, R, td0 = 0.004) {
  const Z = R / Math.cbrt(W);
  const ratio = 808 * (1 + (Z / 4.5) ** 2) / Math.sqrt((1 + (Z / 0.048) ** 2) * (1 + (Z / 0.32) ** 2) * (1 + (Z / 1.35) ** 2));
  return {ps: ratio * P0, td: td0 * Math.sqrt(1 + 0.6 * Math.log(Math.max(1, R / 10)))};
}

/** The Friedlander waveform: ps·(1 - t/td)·exp(-b t/td), into `out` from sample `at`. */
export function friedlander(out, at, ps, td, sr, b = 1.8) {
  const n = Math.min(out.length - at, Math.ceil(td * 6 * sr));
  for (let i = 0; i < n; i++) { const t = i / sr; if (at + i >= 0) out[at + i] += ps * (1 - t / td) * Math.exp(-b * t / td); }
}

// --- FFT, radix 2 (in place, complex). ---
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inverse ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
const pow2 = n => 1 << Math.ceil(Math.log2(Math.max(2, n)));

/** A pulse after R m of air: each frequency attenuated by ISO 9613-1 (zero phase). Returns a new array. */
const spectra = new Map();
/** ISO 9613-1 absorption (in nepers per metre) at each FFT bin, cached per size and weather. */
function alphaBins(n, sr, atm) {
  const key = `${n}|${sr}|${atm.T.toFixed(1)}|${atm.RH.toFixed(0)}|${atm.p ?? P0}`;
  let a = spectra.get(key);
  if (!a) {
    a = new Float64Array(n / 2 + 1);
    for (let k = 0; k <= n / 2; k++) a[k] = absorption(k * sr / n, atm) * Math.LN10 / 20;
    if (spectra.size > 32) spectra.clear();
    spectra.set(key, a);
  }
  return a;
}
export function throughAir(pulse, R, sr, atm) {
  const n = pow2(pulse.length * 2), re = new Float64Array(n), im = new Float64Array(n), alpha = alphaBins(n, sr, atm);
  re.set(pulse); fft(re, im);
  for (let k = 0; k <= n / 2; k++) {
    const g = Math.exp(-alpha[k] * R);
    re[k] *= g; im[k] *= g; if (k && k < n / 2) { re[n - k] *= g; im[n - k] *= g; }
  }
  fft(re, im, true);
  return Float32Array.from(re.subarray(0, Math.min(n, pulse.length + Math.ceil(0.02 * sr))));
}

/** The frequency (Hz) at which R m of air takes `dB` off: where a long sound's low-pass sits. */
export function airCutoff(R, atm, dB = 6) {
  let lo = 20, hi = 24000;
  for (let i = 0; i < 40; i++) { const m = Math.sqrt(lo * hi); if (absorption(m, atm) * R < dB) lo = m; else hi = m; }
  return Math.sqrt(lo * hi);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);

/**
 * The arrivals of one sound from `src` at `ear`: [{delay (s), R (m) travelled,
 * gain (pressure, relative to 1 m), dir (unit vector it arrives from), kind}].
 * - direct: 1/R;
 * - the river or ground below (plane y = `surface`): an image source, times
 *   the reflection coefficient (water is acoustically hard: ~0.95);
 * - each reflector {x, y, z, area}: treated as a scatterer of cross-section
 *   ~0.3 × its facade area (an approximation: real facades reflect
 *   specularly, and only some face the right way), so its echo is
 *   sqrt(σ/4π)/(r1 r2). Only echoes above -40 dB of the direct sound are kept.
 * Wind: the delay uses c plus the wind's component along the path; an
 * upwind path also loses up to 6 dB, a crude stand-in for the refraction
 * that lifts sound away from the ground against the wind.
 */
export function arrivals(src, ear, {atm, wind = [0, 0], surface = 0, reflection = 0.95, reflectors = []} = {}) {
  const c = soundSpeed(atm.T);
  const along = (from, to) => { const d = sub(to, from), l = len(d) || 1; return (wind[0] * d[0] + wind[1] * d[2]) / l; };
  const upwind = u => (u < 0 ? Math.pow(10, Math.max(-6, u * 1.2) / 20) : 1);
  const out = [];
  const add = (R, gain, dir, kind, u) => out.push({R, delay: R / (c + u), gain: gain * upwind(u), dir, kind});
  const d = sub(ear, src), R = len(d);
  add(R, 1 / Math.max(1, R), d.map(v => -v / (R || 1)), 'direct', along(src, ear));
  const image = [src[0], 2 * surface - src[1], src[2]], dr = sub(ear, image), Rr = len(dr);
  add(Rr, reflection / Math.max(1, Rr), dr.map(v => -v / (Rr || 1)), 'surface', along(src, ear));
  for (const b of reflectors) {
    const p = [b.x, b.y, b.z], r1 = len(sub(p, src)), r2 = len(sub(ear, p)), g = Math.sqrt(0.3 * b.area / (4 * Math.PI)) / Math.max(1, r1 * r2);
    if (g * R < 0.01) continue;                                                        // below -40 dB of the direct sound
    const dir = sub(p, ear).map(v => v / (r2 || 1));
    add(r1 + r2, g, dir, 'echo', (along(src, p) + along(p, ear)) / 2);
  }
  return out.sort((a, b) => a.delay - b.delay);
}

/** The Doppler-shifted arrival of a moving source's tone: for output times t (s,
 *  after the first arrival) the emission times te, from `pos(te)` and `ear`. */
export function retarded(pos, ear, c, t0, t1, samples) {
  const te = new Float64Array(samples), arrive = s => s + len(sub(pos(s), ear)) / c;
  const a0 = arrive(t0), a1 = arrive(t1);
  let s = t0;
  for (let i = 0; i < samples; i++) {                                                  // invert arrive() by Newton steps from the last
    const ta = a0 + (a1 - a0) * i / (samples - 1);
    for (let k = 0; k < 4; k++) { const e = 1e-3, f = arrive(s) - ta, df = (arrive(s + e) - arrive(s - e)) / (2 * e); s -= f / (df || 1); }
    te[i] = Math.max(t0, Math.min(t1, s));
  }
  return {te, start: a0, end: a1};
}
