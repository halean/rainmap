/* Sun and moon position/illumination -- pure astronomy, no THREE, no DOM, so
 * it can be unit tested directly (see tests/sky_astronomy.mjs) the same way
 * 3d/thunder.js and 3d/flights-motion.js keep their testable core apart from
 * rendering. Low-precision formulas (Jean Meeus, "Astronomical Algorithms"),
 * accurate to a few arcminutes for the sun and roughly similar for the moon
 * -- ample for where a disc sits in the sky, not navigation-grade.
 *
 * Angles are radians throughout except where a function name says otherwise.
 * Longitude is signed east-positive (matches this project's lon/lat, unlike
 * some astronomy references that use west-positive).
 */

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588; // Julian day number of 1970-01-01T00:00Z
const J2000 = 2451545; // Julian day number of the J2000.0 epoch
const OBLIQUITY = RAD * 23.4397; // of the ecliptic

function toDays(date) {
  return date.getTime() / DAY_MS - 0.5 + J1970 - J2000;
}

function rightAscension(eclipticLon, eclipticLat) {
  return Math.atan2(
    Math.sin(eclipticLon) * Math.cos(OBLIQUITY) - Math.tan(eclipticLat) * Math.sin(OBLIQUITY),
    Math.cos(eclipticLon)
  );
}
function declination(eclipticLon, eclipticLat) {
  return Math.asin(
    Math.sin(eclipticLat) * Math.cos(OBLIQUITY) + Math.cos(eclipticLat) * Math.sin(OBLIQUITY) * Math.sin(eclipticLon)
  );
}
// Hour angle -> local horizon coordinates.
function azimuthOf(hourAngle, lat, dec) {
  return Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
}
function altitudeOf(hourAngle, lat, dec) {
  return Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle));
}
function siderealTime(daysSinceJ2000, lonWestRad) {
  return RAD * (280.16 + 360.9856235 * daysSinceJ2000) - lonWestRad;
}

function solarMeanAnomaly(d) {
  return RAD * (357.5291 + 0.98560028 * d);
}
// Equation of center + perihelion -> apparent ecliptic longitude of the sun.
function solarEclipticLongitude(meanAnomaly) {
  const center = RAD * (
    1.9148 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly) + 0.0003 * Math.sin(3 * meanAnomaly)
  );
  const perihelion = RAD * 102.9372;
  return meanAnomaly + center + perihelion + Math.PI;
}
function sunEquatorial(d) {
  const M = solarMeanAnomaly(d);
  const L = solarEclipticLongitude(M);
  return { ra: rightAscension(L, 0), dec: declination(L, 0), eclipticLon: L };
}

/** Sun's position over HCMC's own sky (or any lat/lon) at `date`. */
export function getSunPosition(date, latDeg, lonDeg) {
  const lonWest = RAD * -lonDeg;
  const lat = RAD * latDeg;
  const d = toDays(date);
  const { ra, dec } = sunEquatorial(d);
  const H = siderealTime(d, lonWest) - ra;
  return { azimuth: azimuthOf(H, lat, dec), altitude: altitudeOf(H, lat, dec) };
}

function moonEquatorial(d) {
  // Mean longitude, mean anomaly, mean distance (argument of latitude).
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.229350 * d);
  const eclipticLon = L + RAD * 6.289 * Math.sin(M);
  const eclipticLat = RAD * 5.128 * Math.sin(F);
  const distanceKm = 385001 - 20905 * Math.cos(M); // geocentric distance
  return { ra: rightAscension(eclipticLon, eclipticLat), dec: declination(eclipticLon, eclipticLat), distanceKm };
}

/** Moon's position over HCMC's own sky at `date`, corrected for parallax
 * (the moon is close enough that a few thousand km up on a city skyline
 * shifts it noticeably, unlike the sun). */
export function getMoonPosition(date, latDeg, lonDeg) {
  const lonWest = RAD * -lonDeg;
  const lat = RAD * latDeg;
  const d = toDays(date);
  const { ra, dec, distanceKm } = moonEquatorial(d);
  const H = siderealTime(d, lonWest) - ra;
  let altitude = altitudeOf(H, lat, dec);
  const EARTH_RADIUS_KM = 6378.14;
  const parallax = Math.asin(EARTH_RADIUS_KM / distanceKm);
  altitude -= parallax * Math.cos(altitude); // geocentric -> topocentric
  return { azimuth: azimuthOf(H, lat, dec), altitude, distanceKm };
}

/** Illuminated fraction (0 new -- 1 full) and waxing/waning sign, from the
 * sun-earth-moon geometry at `date` (location-independent). `angle` is the
 * position angle of the moon's bright limb, for orienting a crescent. */
export function getMoonIllumination(date) {
  const SUN_DISTANCE_KM = 149598000;
  const d = toDays(date);
  const sun = sunEquatorial(d);
  const moon = moonEquatorial(d);
  const elongation = Math.acos(
    Math.sin(sun.dec) * Math.sin(moon.dec) + Math.cos(sun.dec) * Math.cos(moon.dec) * Math.cos(sun.ra - moon.ra)
  );
  const phaseAngle = Math.atan2(
    SUN_DISTANCE_KM * Math.sin(elongation),
    moon.distanceKm - SUN_DISTANCE_KM * Math.cos(elongation)
  );
  const bright = Math.atan2(
    Math.cos(sun.dec) * Math.sin(sun.ra - moon.ra),
    Math.sin(sun.dec) * Math.cos(moon.dec) - Math.cos(sun.dec) * Math.sin(moon.dec) * Math.cos(sun.ra - moon.ra)
  );
  return {
    fraction: (1 + Math.cos(phaseAngle)) / 2,
    // 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter.
    phase: 0.5 + (0.5 * phaseAngle * (bright < 0 ? -1 : 1)) / Math.PI,
    brightLimbAngle: bright,
  };
}
