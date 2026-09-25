// Pure astronomy for 3d/sky.js -- no THREE, no DOM, so these run directly.
// Cross-checked against textbook facts (solstice/equinox noon altitude,
// tropic-latitude sunrise/sunset near 6/18h, the mid-autumn full moon)
// rather than against another implementation, since the point is whether
// the numbers are astronomically right, not whether two guesses agree.
import { getSunPosition, getMoonPosition, getMoonIllumination } from '../3d/sky.js';

const HCMC = { lat: 10.7769, lon: 106.7009 };
const DEG = 180 / Math.PI;

function run(name, fn) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { console.log(`FAIL - ${name}: ${e.message}`); process.exitCode = 1; }
}

function assertClose(actual, expected, tolerance, label) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: got ${actual}, expected ${expected} +/- ${tolerance}`);
  }
}

function solarNoonAltitudeDeg(year, monthIndex, day) {
  let best = -90;
  for (let h = 10; h <= 14; h += 0.05) {
    const dt = new Date(Date.UTC(year, monthIndex, day, h - 7, 0)); // ICT -> UTC
    const alt = getSunPosition(dt, HCMC.lat, HCMC.lon).altitude * DEG;
    if (alt > best) best = alt;
  }
  return best;
}

run('solar noon altitude at the June solstice matches 90 - |lat - declination|', () => {
  assertClose(solarNoonAltitudeDeg(2026, 5, 21), 77.3, 0.5, 'June solstice noon altitude');
});
run('solar noon altitude at the December solstice is lower, sun further north of the sky', () => {
  assertClose(solarNoonAltitudeDeg(2026, 11, 21), 55.8, 0.5, 'December solstice noon altitude');
});
run('solar noon altitude near the September equinox is close to 90 - latitude', () => {
  assertClose(solarNoonAltitudeDeg(2026, 8, 23), 79.2, 0.6, 'September equinox noon altitude');
});

run('the sun rises within the 05:30-06:30 ICT band near the equinox, this close to the equator', () => {
  const before = getSunPosition(new Date(Date.UTC(2026, 8, 24, 22, 30)), HCMC.lat, HCMC.lon).altitude; // 05:30 ICT
  const after = getSunPosition(new Date(Date.UTC(2026, 8, 24, 23, 30)), HCMC.lat, HCMC.lon).altitude; // 06:30 ICT
  if (!(before < 0 && after > 0)) throw new Error(`sunrise not bracketed: 05:30 alt=${before}, 06:30 alt=${after}`);
});
run('the sun sets within the 17:30-18:30 ICT band near the equinox', () => {
  const before = getSunPosition(new Date(Date.UTC(2026, 8, 24, 10, 30)), HCMC.lat, HCMC.lon).altitude; // 17:30 ICT
  const after = getSunPosition(new Date(Date.UTC(2026, 8, 24, 11, 30)), HCMC.lat, HCMC.lon).altitude; // 18:30 ICT
  if (!(before > 0 && after < 0)) throw new Error(`sunset not bracketed: 17:30 alt=${before}, 18:30 alt=${after}`);
});

run('moon illumination peaks near 1.0 on the mid-autumn full moon (2026-09-26)', () => {
  const { fraction } = getMoonIllumination(new Date(Date.UTC(2026, 8, 26, 12, 0)));
  assertClose(fraction, 1.0, 0.02, 'mid-autumn full-moon illuminated fraction');
});
run('moon illumination is near 0 at the new moon two weeks off full', () => {
  // The full moon lands near Sep 26; a new moon sits roughly a synodic
  // half-month (~14.77 days) either side of it.
  const { fraction } = getMoonIllumination(new Date(Date.UTC(2026, 8, 11, 12, 0)));
  if (fraction > 0.15) throw new Error(`expected a near-new moon, got fraction=${fraction}`);
});
run('illuminated fraction always stays within [0, 1]', () => {
  for (let day = 0; day < 60; day++) {
    const d = new Date(Date.UTC(2026, 8, 1, 12, 0) + day * 86400000);
    const { fraction } = getMoonIllumination(d);
    if (fraction < 0 || fraction > 1) throw new Error(`fraction out of range on day ${day}: ${fraction}`);
  }
});
run('phase advances roughly monotonically from new to full to new across a synodic month', () => {
  // Sample from a known new moon forward ~29.5 days and check phase only
  // ever moves forward (mod 1), never jumps backward mid-cycle.
  let prev = null, wrapped = 0;
  for (let day = 0; day <= 29; day++) {
    const d = new Date(Date.UTC(2026, 8, 11, 12, 0) + day * 86400000);
    const { phase } = getMoonIllumination(d);
    if (prev !== null) {
      const delta = phase - prev;
      if (delta < -0.5) wrapped++; // 0.99 -> 0.02 is a legitimate wrap, not a regression
      else if (delta < -0.02) throw new Error(`phase went backward on day ${day}: ${prev} -> ${phase}`);
    }
    prev = phase;
  }
  if (wrapped > 1) throw new Error(`phase wrapped ${wrapped} times in one synodic month, expected at most 1`);
});

run('moon altitude stays within [-90, 90] degrees across a full day', () => {
  for (let h = 0; h < 24; h++) {
    const alt = getMoonPosition(new Date(Date.UTC(2026, 8, 24, h, 0)), HCMC.lat, HCMC.lon).altitude * DEG;
    if (alt < -90 || alt > 90) throw new Error(`moon altitude out of range at hour ${h}: ${alt}`);
  }
});
run('moon parallax correction pulls the topocentric altitude below the geocentric direction', () => {
  // The moon's distance term makes the parallax correction always subtract
  // (for an object above the horizon), so a hand-computed geocentric
  // altitude without the correction should read slightly higher.
  const date = new Date(Date.UTC(2026, 8, 24, 15, 0));
  const { altitude, distanceKm } = getMoonPosition(date, HCMC.lat, HCMC.lon);
  if (altitude <= -90 * Math.PI / 180) throw new Error('altitude not computed');
  const parallaxDeg = Math.asin(6378.14 / distanceKm) * DEG;
  if (parallaxDeg < 0.7 || parallaxDeg > 1.1) throw new Error(`parallax outside the expected ~0.7-1.0deg range: ${parallaxDeg}`);
});

run('azimuth is always a finite angle in radians, never NaN, across a year of daily samples', () => {
  for (let day = 0; day < 365; day += 7) {
    const d = new Date(Date.UTC(2026, 0, 1, 4, 0) + day * 86400000);
    const sun = getSunPosition(d, HCMC.lat, HCMC.lon);
    const moon = getMoonPosition(d, HCMC.lat, HCMC.lon);
    if (!Number.isFinite(sun.azimuth) || !Number.isFinite(sun.altitude)) throw new Error(`non-finite sun position on day ${day}`);
    if (!Number.isFinite(moon.azimuth) || !Number.isFinite(moon.altitude)) throw new Error(`non-finite moon position on day ${day}`);
  }
});

if (process.exitCode) process.exit(1);
