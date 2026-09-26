// Fireworks over the Saigon River, fired from three barges between Bạch
// Đằng wharf and Thủ Thiêm, where the city's New Year and National Day
// shows are held. A show runs about three minutes: an opening of single
// shells, a middle of pairs and mixed effects, and a finale.
//
// Each shell is launched as a rising comet and bursts at its apex, 120-260 m
// up, into stars: peony, chrysanthemum (trailing), willow (long drooping
// gold), ring, palm, crackle (strobing) and salute (a white flash). Every
// star is a GPU point whose position is computed in the shader from its
// burst point, velocity, air drag and gravity; trails are the same star
// drawn again a little behind in time. Bursts light the city and the river
// for a moment (pooled point lights), and the moving river reflects them
// (riverwater.js reflection layer), and you hear them, late by the distance
// (fireworks-sound.js). SIMULATED: not a real show's programme.
// See FIREWORKS.md.
import * as THREE from 'three';
import {RIVER} from './river-lines.js';
import {REFLECT_LAYER} from './riverwater.js';

export const FIREWORKS = Object.freeze({
  // The middle barge: on the river off Bạch Đằng wharf, toward Thủ Thiêm.
  anchor: [106.7082, 10.7742], spacing: 260, stars: 120000, lights: 3, showSeconds: 180,
});
// Colours: [r, g, b], bright enough for additive glow.
const COLOURS = {
  red: [1.0, 0.16, 0.12], gold: [1.0, 0.72, 0.28], green: [0.3, 1.0, 0.35], blue: [0.3, 0.45, 1.0],
  purple: [0.75, 0.3, 1.0], silver: [0.85, 0.9, 1.0], orange: [1.0, 0.45, 0.1], cyan: [0.3, 0.95, 1.0], pink: [1.0, 0.4, 0.7],
  yellow: [1.0, 0.9, 0.2], lime: [0.65, 1.0, 0.2],
};
const NAMES = Object.keys(COLOURS);

export {starAt, apex, launchSpeed, RISE_DRAG} from './fireworks-ballistics.js';
import {starAt, apex, launchSpeed, RISE_DRAG} from './fireworks-ballistics.js';

function starMaterial(u) {
  return new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uTime, uScale;
      attribute vec4 aStart;   // burst point, t0
      attribute vec4 aVel;     // velocity, drag
      attribute vec4 aColour;  // rgb, kind: 0 star, 1 crackle, 2 willow, 3 comet, 4 flash, 5 fish, 6 glitter, 7 strobe
      attribute vec4 aColour2; // a second colour, and when (fraction of life) the star turns to it; 0: never
      attribute vec4 aMisc;    // life, lag, size (m), brightness
      varying vec3 vColour; varying float vAlpha;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float t = uTime - aStart.w - aMisc.y, life = aMisc.x, k = aVel.w, kind = aColour.w;
        vAlpha = 0.0; gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        if (t < 0.0 || t > life) return;
        float e = (1.0 - exp(-k * t)) / k;
        vec3 p = aStart.xyz + aVel.xyz * e; p.y += (9.81 / k) * e - 9.81 * t / k;
        float u = t / life, id = aStart.x * 13.1 + aVel.y * 7.7 + aVel.z;
        if (kind > 4.5 && kind < 5.5) p += vec3(sin(t * 11.0 + id), 0.6 * cos(t * 9.0 + id), cos(t * 13.0 + id)) * 1.1 * min(1.0, t * 2.0);   // fish: they wriggle
        // White-hot at the burst, the colour, then fading; willow fades to embers.
        vec3 c = aColour.rgb;
        if (aColour2.w > 0.0) c = mix(c, aColour2.rgb, smoothstep(aColour2.w - 0.04, aColour2.w + 0.04, u));   // transformation
        if (kind < 3.5) c = mix(vec3(1.0, 0.95, 0.85), c, smoothstep(0.0, 0.12, u));
        if (kind > 1.5 && kind < 2.5) c = mix(c, vec3(0.9, 0.35, 0.08), smoothstep(0.4, 1.0, u));
        float a = aMisc.w * (1.0 - smoothstep(kind > 1.5 && kind < 2.5 ? 0.5 : 0.65, 1.0, u));
        if (kind > 0.5 && kind < 1.5 && u > 0.45) a *= step(0.55, hash(floor(uTime * 18.0) + aStart.x * 13.1 + aVel.y));   // crackle
        if (kind > 2.5 && kind < 3.5) a *= 0.8 + 0.2 * hash(floor(uTime * 30.0) + aVel.x);                            // the comet flickers
        if (kind > 3.5 && kind < 4.5) a *= 1.0 - u;                                                                       // the flash
        if (kind > 5.5 && kind < 6.5) a *= 0.25 + 0.75 * step(0.5, hash(floor(uTime * 24.0) + id));                        // glitter: twinkling
        if (kind > 6.5) a *= step(0.62, fract(uTime * 3.2 + hash(id))) * 1.6;                                              // strobe: pulses
        vColour = c; vAlpha = a;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aMisc.z * uScale / -mv.z, 1.5, 96.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vColour; varying float vAlpha;
      void main() {
        #include <logdepthbuf_fragment>
        if (vAlpha <= 0.0) discard;
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        float glow = exp(-r * r * 4.0) + 0.5 * exp(-r * r * 30.0);
        gl_FragColor = vec4(vColour * glow * vAlpha * 2.2, 1.0);
      }`,
  });
}

export function createFireworks({scene, project, now: nowFn = () => performance.now(), sound = null}) {
  const group = new THREE.Group(); group.name = 'fireworks';
  // The barges: on the river's centreline, either side of the anchor.
  const centre = RIVER.centreline.map(([lon, lat]) => { const [x, z] = project(lon, lat); return new THREE.Vector3(x, 0, z); });
  const [ax, az] = project(...FIREWORKS.anchor);
  let best = 0; centre.forEach((p, i) => { if (Math.hypot(p.x - ax, p.z - az) < Math.hypot(centre[best].x - ax, centre[best].z - az)) best = i; });
  const along = centre[Math.min(centre.length - 1, best + 1)].clone().sub(centre[Math.max(0, best - 1)]).setY(0).normalize();
  const mid = centre[best].clone();
  // Along the centreline (the river bends here), spacing metres each way.
  const walk = (dist) => {
    let i = best, left = Math.abs(dist), step = Math.sign(dist) || 1, p = centre[i].clone();
    while (left > 0 && centre[i + step]) { const q = centre[i + step], d = p.distanceTo(q); if (d >= left) return p.lerp(q, left / d); left -= d; p = q.clone(); i += step; }
    return p;
  };
  const sites = [-1, 0, 1].map(s => walk(s * FIREWORKS.spacing).setY(0.4));
  const bargeMat = new THREE.MeshStandardMaterial({color: '#2b2e30', roughness: 0.8});
  for (const s of sites) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(30, 1.6, 10), bargeMat);
    b.position.copy(s).setY(0.2); b.rotation.y = Math.atan2(-along.z, along.x); b.name = 'fireworks-barge'; group.add(b);
    for (let i = -2; i <= 2; i++) {                                               // the mortar racks
      const r = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 3), bargeMat); r.position.set(i * 5, 1.4, 0); b.add(r);
    }
  }
  // The stars: one ring buffer of points.
  const N = FIREWORKS.stars, geo = new THREE.BufferGeometry();
  const attr = (name, size) => { const a = new THREE.BufferAttribute(new Float32Array(N * size), size); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); return a; };
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const A = {start: attr('aStart', 4), vel: attr('aVel', 4), colour: attr('aColour', 4), colour2: attr('aColour2', 4), misc: attr('aMisc', 4)};
  A.start.array.fill(-1e9);                                                       // never born
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const U = {uTime: {value: 0}, uScale: {value: 800}};
  const points = new THREE.Points(geo, starMaterial(U)); points.frustumCulled = false; points.name = 'fireworks-stars';
  points.layers.enable(REFLECT_LAYER);
  group.add(points);
  // The flashes: a few point lights, reused.
  const lights = Array.from({length: FIREWORKS.lights}, () => { const l = new THREE.PointLight('#ffffff', 0, 0, 2); l.layers.enable(REFLECT_LAYER); group.add(l); return {light: l, t0: -1e9, peak: 0, decay: 0.5}; });
  scene.add(group);

  const T0 = nowFn();
  const clock = () => (nowFn() - T0) / 1000;
  let head = 0, lo = Infinity, hi = -1, wrapped = false;
  function put(p, v, k, t0, c, kind, life, lag, size, bright, c2 = null, change = 0) {
    const i = head; head = (head + 1) % N; if (head === 0) wrapped = true;
    A.start.setXYZW(i, p[0], p[1], p[2], t0); A.vel.setXYZW(i, v[0], v[1], v[2], k);
    A.colour.setXYZW(i, c[0], c[1], c[2], kind); A.misc.setXYZW(i, life, lag, size, bright);
    A.colour2.setXYZW(i, c2 ? c2[0] : 0, c2 ? c2[1] : 0, c2 ? c2[2] : 0, c2 ? change : 0);
    lo = Math.min(lo, i); hi = Math.max(hi, i);
  }
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const sphere = () => { const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z); return [r * Math.cos(a), z, r * Math.sin(a)]; };

  /** Stars for a burst at p (time t0) of the given type and colours. */
  function burst(shell) {
    const {p, t0, type, c1, c2, size} = shell, R = size, sub = [];               // R: the burst's radius (m); sub: a cluster's little bursts
    const k = 1.3, v = R * k;                                                     // stars coast out to ~R under drag
    // One star (with `trail` copies behind it): from `at` (default the burst), from `when` (default t0).
    const star = (dir, speed, col, kind, life, trail, bright = 1, kk = k, sz = 4.2, {c2 = null, change = 0, at = p, when = t0, lagStep = kind === 2 ? 0.07 : 0.04} = {}) => {
      const vel = [dir[0] * speed, dir[1] * speed, dir[2] * speed];
      for (let j = 0; j < trail; j++) put(at, vel, kk, when, col, kind, life, j * lagStep, sz * (1 - j / (trail + 1)), bright * Math.pow(0.72, j), c2, change);
    };
    // The plane facing the audience on the Thủ Thiêm bank: along the river, and up (tilted a little).
    const tilt = (rnd() - 0.5) * 0.4, faceU = norm([along.x, Math.sin(tilt) * 0.3, along.z]), faceV = norm(add([0, 1, 0], scale(faceU, Math.sin(tilt))));
    const inPlane = (x, y) => norm(add(scale(faceU, x), scale(faceV, y)));
    // A pattern shell tumbles as it flies, so its shape breaks at a random angle: often seen
    // side-on (a line or a smudge), only sometimes square to the audience.
    const tn = sphere(), tref = Math.abs(tn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], roll = rnd() * Math.PI * 2;
    const t1 = norm(cross(tn, tref)), t2 = cross(tn, t1);
    const shapeU = add(scale(t1, Math.cos(roll)), scale(t2, Math.sin(roll))), shapeV = add(scale(t1, -Math.sin(roll)), scale(t2, Math.cos(roll)));
    const tumbled = (x, y) => norm(add(scale(shapeU, x), scale(shapeV, y)));
    const ringDirs = (n, normal) => { const a = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = norm(cross(normal, a)), w = cross(normal, u); return Array.from({length: n}, (_, i) => { const th = i / n * Math.PI * 2; return add(scale(u, Math.cos(th)), scale(w, Math.sin(th))); }); };
    if (type !== 'fan') put(p, [0, 0, 0], 1, t0, [1, 0.95, 0.85], 4, 0.18, 0, R * 0.9, 1.4);          // the flash
    switch (type) {
      case 'peony': for (let i = 0; i < 220; i++) star(sphere(), v * (0.9 + 0.2 * rnd()), i % 2 ? c1 : c2, 0, 2.1 + rnd() * 0.5, 2); break;
      case 'chrysanthemum': for (let i = 0; i < 180; i++) star(sphere(), v * (0.92 + 0.16 * rnd()), c1, 0, 2.6 + rnd() * 0.4, 6); break;
      case 'crackle': for (let i = 0; i < 200; i++) star(sphere(), v * (0.85 + 0.3 * rnd()), c1, 1, 2.8 + rnd() * 0.6, 2); break;
      case 'willow': for (let i = 0; i < 150; i++) star(sphere(), v * 1.25 * (0.9 + 0.2 * rnd()), COLOURS.gold, 2, 4.5 + rnd(), 8, 0.9, 2.2, 3.4); break;
      case 'ring': {
        const n = sphere(), a = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const u = norm(cross(n, a)), w = cross(n, u);
        for (let i = 0; i < 90; i++) { const th = i / 90 * Math.PI * 2; star(add(scale(u, Math.cos(th)), scale(w, Math.sin(th))), v, c1, 0, 2.2, 3); }
        for (let i = 0; i < 40; i++) star(sphere(), v * 0.35, c2, 0, 1.8, 1);         // and a pistil in the middle
        break;
      }
      case 'palm': {
        const arms = 9 + Math.floor(rnd() * 4);
        for (let a = 0; a < arms; a++) {
          const d = sphere(); d[1] = Math.abs(d[1]) * 0.6 + 0.3; const dn = norm(d);
          for (let i = 0; i < 16; i++) star(dn, v * (0.7 + 0.5 * i / 16), COLOURS.gold, 2, 3.2, 3, 1, 1.6, 4.6);
        }
        break;
      }
      case 'salute': for (let i = 0; i < 70; i++) star(sphere(), v * 0.5, COLOURS.silver, 1, 0.9, 1, 1.4, 3, 3.2); break;
      // --- The wider arsenal. ---
      case 'dahlia': for (let i = 0; i < 70; i++) star(sphere(), v * (0.95 + 0.1 * rnd()), i % 3 ? c1 : c2, 0, 2.7, 7, 1.2, k, 5.6); break;          // few, big stars, long trails
      case 'kamuro': for (let i = 0; i < 220; i++) star(sphere(), v * 1.05 * (0.9 + 0.2 * rnd()), i % 4 ? COLOURS.gold : COLOURS.silver, 2, 3.8 + rnd() * 0.6, 7, 1.1, 1.8, 3.6); break;   // a dense golden crown that hangs
      case 'horsetail': for (let i = 0; i < 90; i++) { const d = sphere(); d[1] = 0.55 + Math.abs(d[1]) * 0.45; star(norm(d), v * 0.42, COLOURS.gold, 2, 4.8 + rnd(), 8, 1, 0.9, 3.6); } break;   // a golden waterfall
      case 'spider': for (let i = 0; i < 120; i++) star(sphere(), v * 1.7, rnd() < 0.5 ? COLOURS.gold : COLOURS.silver, 0, 1.3, 9, 1.1, 2.8, 3.2, {lagStep: 0.025}); break;   // fast, straight streaks
      case 'pistil': for (let i = 0; i < 180; i++) star(sphere(), v * (0.92 + 0.16 * rnd()), c1, 0, 2.3, 2); for (let i = 0; i < 70; i++) star(sphere(), v * 0.45, c2 === c1 ? COLOURS.gold : c2, 0, 1.9, 2); break;
      case 'transform': for (let i = 0; i < 200; i++) star(sphere(), v * (0.9 + 0.2 * rnd()), c1, 0, 2.6, 2, 1, k, 4.2, {c2: c2 === c1 ? COLOURS.silver : c2, change: 0.45}); break;   // stars change colour mid-flight
      case 'glitter': for (let i = 0; i < 180; i++) star(sphere(), v * (0.85 + 0.25 * rnd()), COLOURS.gold, 6, 3.0 + rnd() * 0.5, 3, 1.2); break;
      case 'strobe': for (let i = 0; i < 120; i++) star(sphere(), v * (0.6 + 0.3 * rnd()), COLOURS.silver, 7, 3.2 + rnd() * 0.6, 1, 1.3, 1.6, 4.8); break;
      case 'fish': for (let i = 0; i < 60; i++) star(sphere(), v * (0.7 + 0.4 * rnd()), c1, 5, 2.4, 4, 1, 1.1, 3.4); for (let i = 0; i < 60; i++) star(sphere(), v * 0.5, c2, 0, 1.6, 1); break;
      case 'crossette': {                                                        // each star splits into four, 0.8 s out
        const split = 0.8;
        for (let i = 0; i < 36; i++) {
          const d = sphere(), vel = scale(d, v * 1.05); star(d, v * 1.05, c1, 0, split, 3, 1.1, k, 4.4);
          const at = starAt(p, vel, k, split), a = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = norm(cross(d, a)), w = cross(d, u);
          for (const q of [u, w, scale(u, -1), scale(w, -1)]) star(norm(add(q, scale(d, 0.4))), v * 0.4, c1, 1, 1.6, 3, 1, k, 3.6, {at, when: t0 + split});
        }
        break;
      }
      case 'cluster': {                                                          // a small break, then five little bursts round it
        for (let i = 0; i < 40; i++) star(sphere(), v * 0.35, COLOURS.silver, 0, 0.6, 1);
        for (let b = 0; b < 5; b++) {
          const at = add(p, scale(sphere(), R * (0.35 + 0.25 * rnd()))), when = t0 + 0.45 + b * 0.12 + rnd() * 0.1, col = COLOURS[pick(NAMES)];
          put(at, [0, 0, 0], 1, when, [1, 0.95, 0.85], 4, 0.14, 0, R * 0.35, 1.2);
          for (let i = 0; i < 45; i++) star(sphere(), v * 0.38, col, 0, 1.6, 2, 1, k, 3.6, {at, when});
          sub.push({at, when});
        }
        break;
      }
      case 'heart': {                                                            // pattern shells: the shape, at whatever angle the shell tumbled to
        for (let i = 0; i < 110; i++) { const th = i / 110 * Math.PI * 2, x = 16 * Math.sin(th) ** 3, y = 13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th); star(tumbled(x, y), v * Math.hypot(x, y) / 17, rnd() < 0.8 ? COLOURS.pink : COLOURS.red, 0, 2.3, 2); }
        break;
      }
      case 'smiley': {
        for (let i = 0; i < 70; i++) { const th = i / 70 * Math.PI * 2; star(tumbled(Math.cos(th), Math.sin(th)), v, COLOURS.yellow, 0, 2.3, 2); }
        for (const ex of [-0.35, 0.35]) for (let i = 0; i < 8; i++) { const th = i / 8 * Math.PI * 2; const x = ex + 0.06 * Math.cos(th), y = 0.3 + 0.08 * Math.sin(th); star(tumbled(x, y), v * Math.hypot(x, y), COLOURS.yellow, 0, 2.3, 1); }
        for (let i = 0; i < 26; i++) { const th = Math.PI * (1.18 + 0.64 * i / 25), x = 0.55 * Math.cos(th), y = 0.55 * Math.sin(th) + 0.05; star(tumbled(x, y), v * Math.hypot(x, y), COLOURS.yellow, 0, 2.3, 1); }
        break;
      }
      case 'double-ring': { const n = norm(add(sphere(), [0, 1.2, 0])); for (const d of ringDirs(80, n)) star(d, v, c1, 0, 2.3, 3); for (const d of ringDirs(60, n)) star(d, v * 0.6, c2 === c1 ? COLOURS.silver : c2, 0, 2.1, 3); break; }
      case 'saturn': { for (let i = 0; i < 150; i++) star(sphere(), v * 0.55, c1, 0, 2.2, 2); const n = norm([rnd() - 0.5, 1, rnd() - 0.5]); for (const d of ringDirs(100, n)) star(d, v * 1.15, c2 === c1 ? COLOURS.gold : c2, 0, 2.4, 3); break; }
      case 'fan': {                                                              // a cake: a fan of comets from the barge, in the audience's plane
        const n = 9, spread = 0.7;
        for (let i = 0; i < n; i++) { const a = -spread + 2 * spread * i / (n - 1); star(inPlane(Math.sin(a), Math.cos(a)), 40 + rnd() * 6, c1, 3, 3.2, 10, 1.1, 0.35, 3.4, {lagStep: 0.035}); }
        break;
      }
    }
    if (type === 'fan') return sub;
    // A flash of light on the city.
    const l = lights.reduce((a, b) => (a.t0 < b.t0 ? a : b));
    l.light.position.set(p[0], p[1], p[2]); l.light.color.setRGB(...(type === 'willow' || type === 'palm' ? COLOURS.gold : type === 'salute' ? COLOURS.silver : c1));
    l.t0 = t0; l.peak = (type === 'salute' ? 1.2e6 : 6e5) * (R / 90) ** 2; l.decay = ['willow', 'kamuro', 'horsetail'].includes(type) ? 1.4 : 0.5;
    return sub;
  }
  const norm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b) => a.map((x, i) => x + b[i]), scale = (a, s) => a.map(x => x * s);

  // --- The programme. ---
  let shells = [], showStart = null;
  const state = {running: false, secondsLeft: 0, shellsFired: 0, shells: 0, types: [], sites: sites.length, simulated: true};
  function shell(t, site, type, h, size) {
    const c1 = COLOURS[pick(NAMES)], c2 = rnd() < 0.5 ? c1 : COLOURS[pick(NAMES)];
    const drift = [(rnd() - 0.5) * 30, (rnd() - 0.5) * 30];                      // mortars are angled a little
    const s = sites[site];
    if (type === 'fan') { shells.push({launch: t, burstAt: t + 0.02, site, type, h: 0, size, c1, c2, from: [s.x, s.y + 1, s.z], v: [0, 0, 0], whistle: false, launched: false, burst: false}); return; }
    const v0 = launchSpeed(h, RISE_DRAG), {t: rise} = apex(v0, RISE_DRAG);
    const vx = drift[0] / rise, vz = drift[1] / rise;
    shells.push({launch: t, burstAt: t + rise, site, type, h, size, c1, c2, from: [s.x, s.y, s.z], v: [vx, v0, vz], whistle: rnd() < 0.25, launched: false, burst: false});
  }
  // The arsenal, dealt from a shuffled deck: every effect is fired before any repeats, and the
  // deck is reshuffled (never starting with the last one fired). Shapes are rarer: one of each
  // per deck, like the rest, but the deck of classics is dealt twice as often.
  const ARSENAL = {
    classic: ['peony', 'chrysanthemum', 'dahlia', 'pistil', 'transform', 'willow', 'kamuro', 'horsetail', 'palm', 'spider', 'crackle', 'glitter', 'strobe', 'crossette', 'fish', 'cluster', 'ring', 'double-ring', 'saturn'],
    shape: ['heart', 'smiley'],
  };
  function deck(list) {
    let cards = [], last = null;
    return () => {
      if (!cards.length) { cards = [...list]; for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; } if (cards[cards.length - 1] === last) cards.unshift(cards.pop()); }
      return (last = cards.pop());
    };
  }
  /** Build a show from `seed`: opening, middle and finale, rotating through the arsenal. */
  function programme(start, seconds) {
    shells = [];
    const next = deck(ARSENAL.classic), nextShape = deck(ARSENAL.shape);
    const end = start + seconds, finale = end - 22;
    let t = start + 1, nextFan = start + 8 + rnd() * 6, nextShapeAt = start + 25 + rnd() * 20;
    while (t < finale) {
      const phase = (t - start) / (finale - start);
      // Opening: one at a time. Middle: pairs from the outer barges, then threes.
      const count = phase < 0.25 ? 1 : phase < 0.7 ? 1 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 2);
      let type = next();
      if (t >= nextShapeAt) { type = nextShape(); nextShapeAt = t + 20 + rnd() * 20; }
      // Pattern shells go up in volleys of three, one per barge, so one is likely to face the crowd.
      const shaped = ARSENAL.shape.includes(type);
      for (let i = 0; i < (shaped ? 3 : count); i++) {
        const site = shaped ? i : count === 1 ? Math.floor(rnd() * 3) : count === 3 ? i : (i ? 2 : 0);
        shell(t + i * 0.12, site, type, shaped ? 200 + rnd() * 40 : 150 + rnd() * 100, shaped ? 75 + rnd() * 15 : 60 + rnd() * 50);
      }
      // Fan cakes from the barges: four fans, alternating, low over the water.
      if (t >= nextFan) { for (let i = 0; i < 4; i++) shell(t + 0.2 + i * 0.45, [0, 2, 1, 0][i], 'fan', 0, 60); nextFan = t + 12 + rnd() * 8; }
      if (phase > 0.4 && rnd() < 0.25) for (let i = 0; i < 5; i++) shell(t + 0.3 + i * 0.25, i % 3, 'salute', 90 + rnd() * 40, 25);
      t += phase < 0.25 ? 2.2 + rnd() : 1.4 + rnd() * 1.2;
    }
    // The finale: all three barges, fast, still rotating, with fans underneath; then a wall of
    // kamuro and willows, and a last volley of salutes.
    for (let k = 0; t < end - 5; t += 0.18, k++) { shell(t, Math.floor(rnd() * 3), next(), 140 + rnd() * 120, 55 + rnd() * 55); if (k % 8 === 0) shell(t + 0.05, k % 3, 'fan', 0, 60); }
    for (let i = 0; i < 9; i++) shell(end - 5 + i * 0.1, i % 3, i % 2 ? 'willow' : 'kamuro', 230 + rnd() * 30, 110);
    for (let i = 0; i < 12; i++) shell(end - 3.5 + i * 0.12, i % 3, 'salute', 120 + rnd() * 60, 30);
    shells.sort((a, b) => a.launch - b.launch);
    state.shells = shells.length;
    state.types = [...new Set(shells.map(s => s.type))].sort();
    state.counts = Object.fromEntries(state.types.map(k => [k, shells.filter(s => s.type === k).length]));
  }
  function start(seconds = FIREWORKS.showSeconds) {
    seed = 1 + Math.floor(Math.random() * 1e6);
    showStart = clock(); programme(showStart, seconds);
    state.running = true; state.shellsFired = 0;
  }
  function stop() { shells = []; state.running = false; state.secondsLeft = 0; }
  /** Fire one shell of `type` now, from barge `site` (0-2): for trying the arsenal out one by one. */
  function fire(type, site = 1, h = 200, size = 85) {
    const now = clock(); shell(now + 0.05, site, type, h, size);
    const s = shells[shells.length - 1];
    shells.sort((a, b) => a.launch - b.launch);
    return {now, burstAt: s.burstAt};                                     // seconds on the show's clock
  }

  function update(now, camera, renderer) {
    const t = clock(); U.uTime.value = t;
    if (camera) sound?.setListener(camera);
    lo = Infinity; hi = -1; wrapped = false;
    for (const s of shells) {
      if (s.launch > t) break;
      if (!s.launched) {                                                          // the comet: a gold spark rising, with its trail
        s.launched = true;
        sound?.launch(s.from, s.launch - t, s.burstAt - s.launch, s.whistle, s.v);
        if (s.type !== 'fan') for (let j = 0; j < 8; j++) put(s.from, s.v, RISE_DRAG, s.launch, [1, 0.75, 0.4], 3, s.burstAt - s.launch, j * 0.03, 3.6 - j * 0.3, 0.9 * Math.pow(0.75, j));
      }
      if (!s.burst && s.burstAt <= t) {
        s.burst = true; state.shellsFired++;
        const p = starAt(s.from, s.v, RISE_DRAG, s.burstAt - s.launch);
        const sub = burst({p, t0: s.burstAt, type: s.type, c1: s.c1, c2: s.c2, size: s.size});
        if (s.type !== 'fan') sound?.burst(p, s.burstAt - t, s.type, s.size);
        for (const b of sub) sound?.burst(b.at, b.when - t, 'peony', s.size * 0.35);   // a cluster's little bursts, each heard where and when it breaks
      }
    }
    shells = shells.filter(s => !s.burst);
    if (state.running) { state.secondsLeft = Math.max(0, Math.round(showStart + FIREWORKS.showSeconds - t)); if (!shells.length && t - showStart > 8) state.running = false; }
    // Upload what was written this frame.
    if (hi >= 0) for (const a of Object.values(A)) {
      a.clearUpdateRanges();
      if (wrapped) a.addUpdateRange(0, N * 4); else a.addUpdateRange(lo * 4, (hi - lo + 1) * 4);
      a.needsUpdate = true;
    }
    for (const l of lights) { const age = t - l.t0; l.light.intensity = age >= 0 && age < 4 ? l.peak * Math.exp(-age / l.decay) : 0; }
    if (camera && renderer) U.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  }
    const [dx, dz] = project(106.7005, 10.7765), side = new THREE.Vector3(-along.z, 0, along.x);   // toward Nguyễn Huệ
  if (side.dot(new THREE.Vector3(dx - mid.x, 0, dz - mid.z)) < 0) side.negate();
  // From the Thủ Thiêm bank, across the river to the District 1 skyline with
  // the bursts in front of it. The orbit can't look up, so it aims level
  // at the far bank and the bursts fill the sky above.
  const eye = mid.clone().addScaledVector(side, -640).addScaledVector(along, -100).setY(42);
  const view = {target: mid.clone().addScaledVector(side, 180).setY(36), eye};   // almost level, just below the eye
  return {group, state, sites, view, start, stop, fire, arsenal: ARSENAL, update, lights: lights.map(l => l.light), get head() { return head; }, attributes: A, dispose() { group.removeFromParent(); geo.dispose(); points.material.dispose(); bargeMat.dispose(); group.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }};
}
