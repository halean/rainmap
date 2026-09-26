// A shell's and a star's flight: gravity and air drag, in closed form. Shared by the
// fireworks' visuals (fireworks.js) and their sound (fireworks-render.js, which a Web
// Worker runs, so this module imports nothing). See FIREWORKS.md.
const G = 9.81;
/** Position of a point launched at p0 with velocity v under drag k and gravity, t seconds on. */
export function starAt(p0, v, k, t) {
  const e = (1 - Math.exp(-k * t)) / k;
  return [p0[0] + v[0] * e, p0[1] + (v[1] + G / k) * e - G * t / k, p0[2] + v[2] * e];
}
/** When a shell launched straight up at v0 (drag k) reaches its apex, and how high. */
export function apex(v0, k) {
  const t = Math.log((v0 + G / k) / (G / k)) / k;
  return {t, h: starAt([0, 0, 0], [0, v0, 0], k, t)[1]};
}
/** The launch speed for a burst h metres up (bisection on apex()). */
export function launchSpeed(h, k) {
  let lo = 1, hi = 400;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (apex(m, k).h < h) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
export const RISE_DRAG = 0.05;
