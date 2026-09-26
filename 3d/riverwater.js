// A moving river round the camera, and the yachts' wakes in it.
//
// Near the focus (within SURFACE.radius of it, when it is near the Saigon
// River and the camera is low enough to see it), the flat tile water is cut
// away (sky-render.js uWaterHole) and replaced by a live surface:
//  - wind waves: four wave trains round the reported wind's direction, sized
//    by its speed, and fine ripples; rain rings when the nearest cameras
//    report rain;
//  - wakes that follow each yacht's past track: its stern is recorded every
//    few metres, and each frame the track is drawn from above into a wake
//    map as a ribbon carrying, per point, the distance behind the stern, the
//    offset across the track, the age and the speed. From those the ribbon's
//    shader computes the Kelvin wave arms (19.47°), transverse waves and the
//    turbulent centre band with the twin propellers' wash, spreading and
//    fading with age. The wake curves through the turns (a wake doesn't
//    swing round with the hull), and the ribbon's inner side is kept within
//    the turn's radius so it can't fold over itself. A water mask, drawn
//    from the tiles' water, keeps all of this inside the river;
//  - foam from the wake map, a foam line round each moving hull, and the
//    water cut away inside the hulls so waves never show through a cockpit;
//  - bubbles and spray as GPU particles (each spawned once; its position
//    after that is computed in the shader), dense only near the camera;
//  - a planar reflection of what is on REFLECT_LAYER (the skyline, the
//    towers, bridges, landmarks, the yachts, the sun and moon; simplified
//    stand-ins for the heaviest), at reduced resolution, rippled by the
//    waves and drawn out into streaks at night;
//  - the sun and moon glint shared with the tiles' water (sky-render.js).
// The yachts ride the same field: sample() gives the surface height at any
// point, waves and the other yacht's wake included (rivertour.js setSurface).
//
// Quality levels (economical / recommended / cinematic) set the surface
// mesh, the wake map's resolution, the reflection's resolution and the
// particle budget. 'auto' steps down when frames run long, and at the bottom
// drops the pixel ratio to 1. Idle while the camera is away from the river.
// See RIVERWATER.md.
import * as THREE from 'three';
import {RIVER} from './river-lines.js';
import {windFeed, downwind} from './flag.js';

export const REFLECT_LAYER = 5, WATER_LAYER = 4;
export const SURFACE = Object.freeze({radius: 320, level: -0.12, activeWithin: 900, maxHeight: 700});
export const QUALITY = Object.freeze({
  economical: {rings: 80, segments: 128, wake: 256, reflection: 0, particles: 2000, rate: 0.35},
  recommended: {rings: 140, segments: 192, wake: 512, reflection: 0.5, particles: 6000, rate: 1},
  cinematic: {rings: 220, segments: 288, wake: 1024, reflection: 1, particles: 16000, rate: 2.2},
});
export const QUALITY_ORDER = Object.freeze(['economical', 'recommended', 'cinematic']);
const G = 9.81, TAN_KELVIN = Math.tan(19.47 * Math.PI / 180);
const TRAIL_EVERY = 2.5, TRAIL_AGE = 150, MAX_TRAIL = 1400, TRAIL_JUMP = 150;
const MASK_MARGIN = 60;                    // the mask reaches this far beyond the surface; redrawn once the centre moves half of it
const T0 = Date.now();
/** Seconds since the page loaded: the water's clock (small, so it stays exact in the shaders). */
export const waterClock = (nowMs = Date.now()) => (nowMs - T0) / 1000;

// --- Waves: the same field in JS (for the yachts) and GLSL (for the water). ---
// Four trains about the downwind direction: wavelength (m), height (m), angle.
const TRAINS = [[7.5, 0.055, 0], [4.4, 0.034, 0.45], [2.7, 0.02, -0.6], [1.7, 0.011, 1.05]];
export function waveTrains(downwindRad = 0.6, scale = 1) {
  return TRAINS.map(([lambda, amp, off], i) => {
    const a = downwindRad + off, k = 2 * Math.PI / lambda;
    return {dx: Math.cos(a), dz: Math.sin(a), k, amp: amp * scale, omega: Math.sqrt(G * k), phase: i * 1.7};
  });
}
export function waveHeight(trains, x, z, t) {
  let h = 0;
  for (const w of trains) h += w.amp * Math.sin(w.k * (w.dx * x + w.dz * z) - w.omega * t + w.phase);
  return h;
}
/** The wake of a hull d metres behind its stern (along its track) and y
 *  across it, laid down `age` seconds ago at U m/s: [height m, foam 0-1.5]. */
export function wakeAt(d, y, age, U) {
  if (d < 0) return [0, 0];
  const Uf = Math.min(1, U / 18), ay = Math.abs(y);
  const arm = ay - (1.2 + d * TAN_KELVIN), w = 1.5 + 0.06 * d, env = Math.exp(-arm * arm / (w * w));
  const k = 2 * Math.PI / (6 + 0.02 * d), divergent = env * Math.cos(k * (0.7 * d - ay));
  const tw = 1 + d * TAN_KELVIN, transverse = Math.exp(-y * y / (tw * tw)) * Math.cos(2 * Math.PI * d / Math.max(8, 0.4 * U * U)) * (1 - 0.7 * Uf);
  const amp = (0.06 + 0.3 * Uf) * Math.exp(-age / 70) / Math.sqrt(1 + d / 60) * Math.min(1, d / 4);
  // The propellers' wash: bright white for the first few seconds, then a
  // fading, widening band of broken foam for a minute or so.
  const cw = 1.9 + 0.012 * d, centre = Math.exp(-y * y / (cw * cw)) * (0.3 + 0.9 * Uf) * (1.3 * Math.exp(-age / 7) + 0.35 * Math.exp(-age / 60));
  return [amp * (divergent + 0.5 * transverse), Math.min(1.5, centre + env * Math.exp(-d / 50) * Uf * 0.6)];
}
const WAKE_GLSL = `
  vec2 wakeAt(float d, float y, float age, float U) {
    if (d < 0.0) return vec2(0.0);
    float Uf = min(1.0, U / 18.0), ay = abs(y);
    float arm = ay - (1.2 + d * ${TAN_KELVIN.toFixed(5)}), w = 1.5 + 0.06 * d, env = exp(-arm * arm / (w * w));
    float k = 6.2831853 / (6.0 + 0.02 * d), divergent = env * cos(k * (0.7 * d - ay));
    float tw = 1.0 + d * ${TAN_KELVIN.toFixed(5)}, transverse = exp(-y * y / (tw * tw)) * cos(6.2831853 * d / max(8.0, 0.4 * U * U)) * (1.0 - 0.7 * Uf);
    float amp = (0.06 + 0.3 * Uf) * exp(-age / 70.0) / sqrt(1.0 + d / 60.0) * min(1.0, d / 4.0);
    float cw = 1.9 + 0.012 * d, centre = exp(-y * y / (cw * cw)) * (0.3 + 0.9 * Uf) * (1.3 * exp(-age / 7.0) + 0.35 * exp(-age / 60.0));
    return vec2(amp * (divergent + 0.5 * transverse), min(1.5, centre + env * exp(-d / 50.0) * Uf * 0.6));
  }`;

// --- The live surface: a MeshStandardMaterial with the water grafted on. ---
const SURFACE_COMMON = `
  uniform float uTime, uRadius, uLevel, uRain, uReflect, uGlintIntensity, uWakeSize, uWakeHeight, uWakeTexel, uNight;
  uniform vec2 uCentre, uMaskCentre;
  uniform float uMaskSize;
  uniform vec4 uTrain[4], uOmega;
  uniform vec4 uBoatPose[2], uBoatDim[2];
  uniform sampler2D uWake, uMask, uReflection;
  uniform mat4 uTextureMatrix;
  uniform vec3 uGlintDir, uGlintColor;
  varying vec3 vWorld; varying float vRim; varying vec4 vRefl;
  float waves(vec2 p, out vec2 grad) {
    float h = 0.0; grad = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      vec4 w = uTrain[i];
      float ph = w.z * dot(w.xy, p) - uOmega[i] * uTime + float(i) * 1.7;
      h += w.w * sin(ph); grad += w.w * w.z * cos(ph) * w.xy;
    }
    return h;
  }
  // The wake map is drawn from above with north up: v runs from south to north.
  vec2 wakeUV(vec2 p) { return vec2((p.x - uCentre.x) / uWakeSize + 0.5, 0.5 - (p.y - uCentre.y) / uWakeSize); }
  vec2 maskUV(vec2 p) { return vec2((p.x - uMaskCentre.x) / uMaskSize + 0.5, 0.5 - (p.y - uMaskCentre.y) / uMaskSize); }
  bool inMap(vec2 uv) { return all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0))); }
  float wakeHeight(vec2 p) { vec2 uv = wakeUV(p); return inMap(uv) ? texture2D(uWake, uv).r * uWakeHeight : 0.0; }`;

function surfaceMaterial(color, u) {
  const m = new THREE.MeshStandardMaterial({color, roughness: 0.32, metalness: 0});
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>' + SURFACE_COMMON)
      .replace('#include <begin_vertex>', `
        vec2 wp = uCentre + position.xz;
        vRim = smoothstep(uRadius, uRadius * 0.82, length(position.xz));
        vec2 g; float h = waves(wp, g) + wakeHeight(wp);
        vec3 transformed = vec3(wp.x, uLevel + h * vRim, wp.y);`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWorld = transformed; vRefl = uTextureMatrix * vec4(transformed, 1.0);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>' + SURFACE_COMMON + `
        float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        // Gradient noise (0-1), on grids turned against each other so no square shows.
        vec2 grad2(vec2 i) { float a = hash21(i) * 6.2831853; return vec2(cos(a), sin(a)); }
        float gnoise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
          float n = mix(mix(dot(grad2(i), f), dot(grad2(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
                        mix(dot(grad2(i + vec2(0, 1)), f - vec2(0, 1)), dot(grad2(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y);
          return 0.5 + 0.7 * n; }
        const mat2 TURN = mat2(0.8, -0.6, 0.6, 0.8);`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        vec2 p = vWorld.xz;
        if (distance(p, uCentre) > uRadius) discard;
        vec2 muv = wakeUV(p);
        vec2 kuv = maskUV(p);
        if (!inMap(kuv) || texture2D(uMask, kuv).r < 0.5) discard;
        // Each hull: cut the water away inside its after part (the cockpit
        // and swim platform sit low), and a line of foam round it.
        float foamLine = 0.0;
        for (int i = 0; i < 2; i++) {
          vec4 pose = uBoatPose[i], dim = uBoatDim[i];         // (x, z, dir), (aft, bow, half beam, speed)
          if (dim.w < 0.0) continue;
          vec2 d = p - pose.xy; float along = dot(d, pose.zw), across = abs(dot(d, vec2(-pose.w, pose.z)));
          float t = (along - dim.x) / (dim.y - dim.x);
          if (t < -0.05 || t > 1.08) continue;
          float halfB = dim.z * (t < 0.55 ? 1.0 : sqrt(max(0.0, 1.0 - pow((t - 0.55) / 0.5, 2.0))));
          float e = across - halfB;
          if (e < -0.25 && t > 0.0 && t < 0.62) discard;
          foamLine += exp(-max(e, 0.0) / (0.35 + 0.05 * dim.w)) * clamp(dim.w / 10.0, 0.0, 1.0) * smoothstep(-0.05, 0.25, t) * (0.6 + 0.6 * smoothstep(0.5, 0.95, t));
        }`)
      .replace('#include <normal_fragment_maps>', `
        vec2 gw; waves(p, gw);
        float s = uWakeTexel;
        vec2 gwk = vec2(wakeHeight(p + vec2(s, 0.0)) - wakeHeight(p - vec2(s, 0.0)), wakeHeight(p + vec2(0.0, s)) - wakeHeight(p - vec2(0.0, s))) / (2.0 * s);
        vec4 wk = texture2D(uWake, muv);
        // Fine ripples, and rain rings: drops on a 1.1 m grid, each ring expanding and fading.
        vec2 rip = vec2(0.0);
        for (int i = 0; i < 5; i++) {
          float fi = float(i); vec2 dir = vec2(cos(fi * 2.4 + 0.3), sin(fi * 2.4 + 0.3));
          float k = 5.0 + fi * 3.7; rip += dir * cos(k * dot(dir, p) - sqrt(9.81 * k) * uTime + fi) * 0.012 * k / (1.0 + fi);
        }
        if (uRain > 0.0) {
          for (int j = 0; j < 2; j++) {
            vec2 q = p * 0.9 + float(j) * 0.37, cell = floor(q), f = fract(q) - 0.5;
            float rate = 0.6 + 0.8 * uRain, ph = fract(uTime * rate + hash21(cell + float(j) * 9.1));
            if (hash21(cell + 17.0) > 0.25 + 0.75 * uRain) continue;
            vec2 o = f - (vec2(hash21(cell + 3.1), hash21(cell + 7.7)) - 0.5) * 0.6;
            float r = length(o), R = ph * 0.45, ring = sin((r - R) * 55.0) * exp(-abs(r - R) * 22.0) * (1.0 - ph);
            rip += o / max(r, 1e-3) * ring * 0.7 * uRain;
          }
        }
        float far = 1.0 / (1.0 + distance(cameraPosition, vWorld) / 60.0);      // ripples too fine to see far off: fade, don't alias
        vec2 slope = (gw + gwk) * vRim + rip * (0.35 + 0.65 * vRim) * far;
        vec3 nWorld = normalize(vec3(-slope.x, 1.0, -slope.y));
        normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);
        // Foam: the wake map's, the hulls' foam lines, broken up by churning noise.
        float foam = clamp(wk.g * vRim + foamLine, 0.0, 1.5);
        float churn = gnoise(TURN * p * 0.9 + uTime * vec2(0.4, -0.3)) * 0.55 + gnoise(TURN * TURN * p * 3.1 - uTime * 0.9) * 0.3 + gnoise(p * 9.0 + 17.0) * 0.15;
        float white = smoothstep(0.45, 0.85, foam * (0.3 + churn)) * 0.95;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.88, 0.87), white);`)
      .replace('#include <dithering_fragment>', `
        vec3 toEye = normalize(cameraPosition - vWorld);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(nWorld, toEye), 0.0), 5.0);
        if (uReflect > 0.0) {
          // Rippled by the surface's slope; at night drawn out into streaks
          // down the view (the lights' long reflections on a moving river).
          vec4 rc = vRefl; rc.xy += slope * 0.05 * rc.w;
          vec3 refl = texture2DProj(uReflection, rc).rgb, peak = refl;
          // Where only the sky is reflected (a flat colour), shade it as the
          // sky would be: lighter toward the horizon, deeper overhead -- so
          // the waves still show in a reflection of empty sky.
          float up = reflect(-toEye, nWorld).y;
          float spread = (0.006 + 0.02 * length(slope)) * rc.w * uNight;
          for (int i = 1; i <= 3; i++) {
            vec3 a = texture2DProj(uReflection, rc + vec4(0.0, spread * float(i), 0.0, 0.0)).rgb;
            vec3 b = texture2DProj(uReflection, rc - vec4(0.0, spread * float(i), 0.0, 0.0)).rgb;
            refl += a + b; peak = max(peak, max(a, b) * (1.0 - 0.18 * float(i)));
          }
          refl = mix(refl / 7.0, max(refl / 7.0, peak), uNight);
          refl *= mix(1.12, 0.62, smoothstep(0.0, 0.35, up));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, refl, clamp(fres * 0.8 + 0.1 * uNight, 0.0, 0.8) * vRim * (1.0 - white));   // a muddy river: never a perfect mirror
        }
        if (uGlintIntensity > 0.0) {
          vec3 halfVec = normalize(normalize(uGlintDir) + toEye);
          float sheen = pow(max(halfVec.y, 0.0), 9.0), sparkle = pow(max(dot(nWorld, halfVec), 0.0), 38.0);
          gl_FragColor.rgb += uGlintColor * (sheen * 0.6 + sparkle * 2.2) * uGlintIntensity * (1.0 - white);
        }
        #include <dithering_fragment>`);
  };
  m.customProgramCacheKey = () => 'riverwater-surface';
  return m;
}

// --- Particles: bubbles (kind 0) and spray (kind 1), positions from time. ---
function particleMaterial(u) {
  return new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uTime, uScale, uLevel;
      attribute vec4 aSpawn; attribute vec4 aVel;     // (x, y, z, born), (vx, vy, vz, kind)
      varying float vAlpha, vKind;
      void main() {
        float age = uTime - aSpawn.w, kind = aVel.w, life = kind < 0.5 ? 4.0 : 1.3;
        vec3 p;
        if (kind < 0.5) {                               // bubbles: slowed by the water, rising, then floating
          p = aSpawn.xyz + aVel.xyz * (1.0 - exp(-age * 1.4)) / 1.4;
          p.y = min(uLevel + 0.14, aSpawn.y + age * 0.9);
        } else {                                        // spray: thrown, falling
          p = aSpawn.xyz + aVel.xyz * age; p.y -= 4.9 * age * age;
        }
        vAlpha = (age < 0.0 || age > life || (kind > 0.5 && p.y < uLevel)) ? 0.0 : (1.0 - age / life) * (kind < 0.5 ? 0.75 : 0.6);
        vKind = kind;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = kind < 0.5 ? 0.1 + 0.08 * fract(aSpawn.x * 7.3) : 0.05 + 0.08 * fract(aSpawn.z * 5.1);
        gl_PointSize = vAlpha > 0.0 ? max(1.0, size * uScale / -mv.z) : 0.0;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying float vAlpha, vKind;
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(gl_PointCoord - 0.5);
        if (r > 0.5 || vAlpha <= 0.0) discard;
        float a = vKind < 0.5 ? smoothstep(0.5, 0.3, r) * (0.5 + 0.5 * smoothstep(0.1, 0.38, r)) : smoothstep(0.5, 0.1, r);
        gl_FragColor = vec4(vKind < 0.5 ? vec3(0.9, 0.95, 0.95) : vec3(0.96), a * vAlpha);
      }`,
  });
}

// --- The wake map: each yacht's track, drawn from above as a ribbon. ---
function wakeMaterial(u) {
  return new THREE.ShaderMaterial({
    uniforms: u, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    vertexShader: `attribute vec4 aWake; varying vec4 vWake;
      void main() { vWake = aWake; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; uniform float uTime; varying vec4 vWake;` + WAKE_GLSL + `
      void main() { gl_FragColor = vec4(wakeAt(vWake.x, vWake.y, uTime - vWake.z, vWake.w), 0.0, 1.0); }`,
  });
}

/** A polar grid, its rings closer together near the centre. */
export function polarGrid(rings, segments, radius) {
  const pos = [0, 0, 0], idx = [];
  for (let r = 1; r <= rings; r++) {
    const rr = radius * (Math.exp(r / rings * 4.2) - 1) / (Math.exp(4.2) - 1);
    for (let s = 0; s < segments; s++) { const a = s / segments * Math.PI * 2; pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); }
  }
  for (let s = 0; s < segments; s++) idx.push(0, 1 + (s + 1) % segments, 1 + s);
  for (let r = 1; r < rings; r++) for (let s = 0; s < segments; s++) {
    const a = 1 + (r - 1) * segments + s, b = 1 + (r - 1) * segments + (s + 1) % segments;
    idx.push(a, b, b + segments, a, b + segments, a + segments);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);   // placed in the shader
  return g;
}

/** A yacht's track: its stern every TRAIL_EVERY metres. */
export function recordTrail(trail, b, t) {
  const sx = b.x + b.dx * b.aft, sz = b.z + b.dz * b.aft, last = trail[trail.length - 1];
  const moved = last ? Math.hypot(sx - last.x, sz - last.z) : Infinity;
  if (moved > TRAIL_JUMP) trail.length = 0;                     // a jump (a reset, a long pause): start afresh
  const tail = trail[trail.length - 1];
  if (!tail || Math.hypot(sx - tail.x, sz - tail.z) >= TRAIL_EVERY) trail.push({x: sx, z: sz, t, U: b.speed, s: tail ? tail.s + Math.hypot(sx - tail.x, sz - tail.z) : 0});
  while (trail.length && (t - trail[0].t > TRAIL_AGE || trail.length > MAX_TRAIL - 2)) trail.shift();
  const end = trail[trail.length - 1];
  return {x: sx, z: sz, arc: end.s + Math.hypot(sx - end.x, sz - end.z)};
}
/** The ribbon's vertices for a track ending at `stern`: two per point,
 *  left and right of it, with (d, y, born, U) for the wake shader. */
export function ribbon(trail, stern, speed, t, P, W) {
  const pts = [...trail, {x: stern.x, z: stern.z, t, U: speed, s: stern.arc}];
  let n = 0;
  for (let k = pts.length - 1; k >= 0 && n < MAX_TRAIL; k--) {
    const p = pts[k], a = pts[Math.min(pts.length - 1, k + 1)], c = pts[Math.max(0, k - 1)];
    let fx = a.x - c.x, fz = a.z - c.z; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    const d = stern.arc - p.s, half = Math.min(90, 9 + d * TAN_KELVIN * 1.6);
    // Curvature (signed: left turns negative); the inside of a turn is
    // kept within its radius so the ribbon can't fold over itself.
    let curv = 0;
    if (k > 0 && k < pts.length - 1) {
      const ax = p.x - c.x, az = p.z - c.z, bx = a.x - p.x, bz = a.z - p.z, den = Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(a.x - c.x, a.z - c.z);
      if (den > 1e-6) curv = 2 * (ax * bz - az * bx) / den;
    }
    const inner = curv ? Math.min(half, 0.9 / Math.abs(curv)) : half;
    const L = curv < 0 ? inner : half, R = curv > 0 ? inner : half, lx = fz, lz = -fx;   // left of travel
    P.set([p.x + lx * L, 0, p.z + lz * L, p.x - lx * R, 0, p.z - lz * R], n * 6);
    W.set([d, L, p.t, p.U, d, -R, p.t, p.U], n * 8);
    n++;
  }
  return n;
}

export function createRiverWater({scene, renderer, project, glint = null, night = null, rainAt = null, wind = windFeed()}) {
  const river = RIVER.centreline.map(([lon, lat]) => project(lon, lat));
  const gl = renderer.getContext(), floatOK = renderer.capabilities.isWebGL2 && !!gl.getExtension('EXT_color_buffer_float');
  const state = {active: false, mode: 'auto', quality: 'recommended', pixelRatio: renderer.getPixelRatio(), gpuMs: null, frameMs: null,
    rain: 0, windFrom: null, windKt: null, boats: 0, particles: 0, surfaceTriangles: 0, reflection: false, floatWake: floatOK, wakeMap: 0};
  let downwindRad = 0.6, waveScale = 1, trains = waveTrains(downwindRad, waveScale);
  const waterMeshes = new Set();
  const U = {
    uTime: {value: 0}, uRadius: {value: SURFACE.radius}, uLevel: {value: SURFACE.level}, uRain: {value: 0}, uReflect: {value: 0},
    uCentre: {value: new THREE.Vector2()}, uMaskCentre: {value: new THREE.Vector2(1e9, 1e9)}, uMaskSize: {value: 2 * (SURFACE.radius + MASK_MARGIN)}, uWakeSize: {value: SURFACE.radius * 2}, uWakeHeight: {value: floatOK ? 1 : 0}, uWakeTexel: {value: 1},
    uTrain: {value: [0, 1, 2, 3].map(() => new THREE.Vector4())}, uOmega: {value: new THREE.Vector4()},
    uBoatPose: {value: [new THREE.Vector4(), new THREE.Vector4()]}, uBoatDim: {value: [new THREE.Vector4(0, 0, 0, -1), new THREE.Vector4(0, 0, 0, -1)]},
    uWake: {value: null}, uMask: {value: null}, uReflection: {value: null}, uTextureMatrix: {value: new THREE.Matrix4()},
    uGlintDir: glint?.uGlintDir ?? {value: new THREE.Vector3(0, 1, 0)}, uGlintColor: glint?.uGlintColor ?? {value: new THREE.Color()},
    uGlintIntensity: glint?.uGlintIntensity ?? {value: 0}, uNight: night ?? {value: 0},
  };
  const setTrains = () => trains.forEach((w, i) => { U.uTrain.value[i].set(w.dx, w.dz, w.k, w.amp); U.uOmega.value.setComponent(i, w.omega); });
  setTrains();
  // The wind: waves run downwind, higher in a stronger wind.
  const unsubscribe = wind?.subscribe(({wind: w}) => {
    if (!w) return;
    if (Number.isFinite(w.dir)) { const d = downwind(w.dir); downwindRad = Math.atan2(d.z, d.x); state.windFrom = w.dir; }
    if (Number.isFinite(w.speed_kt)) { waveScale = Math.max(0.5, Math.min(1.8, 0.5 + w.speed_kt / 10)); state.windKt = w.speed_kt; }
    trains = waveTrains(downwindRad, waveScale); setTrains();
  });

  // --- Built per quality level. ---
  let q = null, surface = null, particles = null, wakeRT = null, maskRT = null, reflRT = null, particleHead = 0, maskDirty = true;
  const wakeScene = new THREE.Scene(), top = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  top.up.set(0, 0, -1); top.position.set(0, 500, 0); top.lookAt(0, 0, 0);    // north up: screen x = world x, screen y = -world z
  const wakeMat = wakeMaterial({uTime: U.uTime});
  const ribbons = [0, 1].map(() => {
    const g = new THREE.BufferGeometry(), n = MAX_TRAIL * 2;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aWake', new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 0; i < MAX_TRAIL - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    g.setIndex(idx); g.setDrawRange(0, 0); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const m = new THREE.Mesh(g, wakeMat); m.frustumCulled = false; wakeScene.add(m); return m;
  });
  const maskMat = new THREE.MeshBasicMaterial({color: 0xffffff, side: THREE.DoubleSide, fog: false});
  let waterColor = new THREE.Color('#315e63');

  function build(level) {
    q = QUALITY[level];
    if (surface) { surface.removeFromParent(); surface.geometry.dispose(); surface.material.dispose(); }
    if (particles) { particles.removeFromParent(); particles.geometry.dispose(); particles.material.dispose(); }
    [wakeRT, maskRT, reflRT].forEach(t => t?.dispose());
    wakeRT = new THREE.WebGLRenderTarget(q.wake, q.wake, {type: floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false});
    maskRT = new THREE.WebGLRenderTarget(q.wake, q.wake, {depthBuffer: false});    // 1.4-5.6 m texels
    reflRT = q.reflection ? new THREE.WebGLRenderTarget(16, 16) : null;
    U.uWake.value = wakeRT.texture; U.uMask.value = maskRT.texture; U.uReflection.value = reflRT?.texture ?? null;
    U.uWakeTexel.value = SURFACE.radius * 2 / q.wake;
    surface = new THREE.Mesh(polarGrid(q.rings, q.segments, SURFACE.radius), surfaceMaterial(waterColor, U));
    surface.name = 'river-surface'; surface.frustumCulled = false; surface.visible = false;
    scene.add(surface);
    const n = q.particles, pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    pg.setAttribute('aSpawn', new THREE.BufferAttribute(new Float32Array(n * 4).fill(-1e6), 4).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
    pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    particles = new THREE.Points(pg, particleMaterial({uTime: U.uTime, uLevel: U.uLevel, uScale: {value: 800}}));
    particles.name = 'river-particles'; particles.frustumCulled = false; particles.visible = false;
    scene.add(particles);
    particleHead = 0; maskDirty = true;
    Object.assign(state, {quality: level, surfaceTriangles: surface.geometry.index.count / 3, wakeMap: q.wake, particles: n});
  }

  // --- What goes into the mask and the reflection. ---
  /** Call for the overview and for each tile as it loads: its water goes
   *  into the mask; its bridges and buildings into the reflection. */
  function register(root) {
    root?.traverse(o => {
      if (!o.isMesh) return;
      if (o.name === 'water') { o.layers.enable(WATER_LAYER); if (!waterMeshes.size) { waterColor = o.material.color.clone(); surface?.material.color.copy(waterColor); } waterMeshes.add(o); }
      else if (o.name === 'bridge' || o.name.startsWith('building')) o.layers.enable(REFLECT_LAYER);
    });
    maskDirty = true;
  }
  function unregister(root) { root?.traverse(o => waterMeshes.delete(o)); maskDirty = true; }
  /** Make everything under root show in the reflection too. */
  function reflect(root) { root?.traverse(o => { if (o.isMesh || o.isSprite || o.isPoints || o.isLine) o.layers.enable(REFLECT_LAYER); }); }
  let lightsSwept = -1e9;
  function sweepLights(now) {
    if (now - lightsSwept < 2000) return;
    lightsSwept = now;
    scene.traverse(o => { if (o.isLight) o.layers.enable(REFLECT_LAYER); });
  }

  // --- The yachts. ---
  const trails = [[], []];
  let boats = [], sterns = [];
  /** The surface height at a point: the waves and each yacht's wake (bar `skip`'s own). */
  function sample(x, z, skip = -1, t = waterClock()) {
    let h = waveHeight(trains, x, z, t);
    if (!floatOK) return h;
    boats.forEach((b, i) => {
      const tr = trails[i], st = sterns[i];
      if (i === skip || tr.length < 2 || !st) return;
      let best = Infinity, d = 0, y = 0, age = 0, Uv = 0;
      for (let k = tr.length - 1; k > 0; k--) {
        const a = tr[k], c = tr[k - 1];
        if (st.arc - a.s > 700) break;
        const ex = a.x - c.x, ez = a.z - c.z, L = Math.hypot(ex, ez) || 1e-6;
        const u = Math.max(0, Math.min(1, ((x - c.x) * ex + (z - c.z) * ez) / (L * L))), px = c.x + ex * u, pz = c.z + ez * u, dd = Math.hypot(x - px, z - pz);
        if (dd < best) { best = dd; d = st.arc - (c.s + (a.s - c.s) * u); y = ((x - px) * ez - (z - pz) * ex) / L; age = t - (c.t + (a.t - c.t) * u); Uv = a.U; }
      }
      if (best < 100) h += wakeAt(d, y, age, Uv)[0];
    });
    return h;
  }

  // --- The reflection: the scene seen from below the water plane. ---
  const mirror = new THREE.PerspectiveCamera(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SURFACE.level);
  const v2 = new THREE.Vector2(), vt = new THREE.Vector3(), cp = new THREE.Vector4(), qv = new THREE.Vector4(), clip = new THREE.Plane();
  function renderReflection(camera) {
    renderer.getDrawingBufferSize(v2).multiplyScalar(q.reflection).floor();
    if (reflRT.width !== v2.x || reflRT.height !== v2.y) reflRT.setSize(Math.max(1, v2.x), Math.max(1, v2.y));
    const L = SURFACE.level;
    mirror.copy(camera, false); mirror.layers.set(REFLECT_LAYER);
    mirror.position.y = 2 * L - camera.position.y;
    vt.set(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position); vt.y = 2 * L - vt.y;
    mirror.up.set(0, 1, 0).applyQuaternion(camera.quaternion); mirror.up.y *= -1;
    mirror.lookAt(vt); mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(camera.projectionMatrix);
    U.uTextureMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
    // An oblique near plane at the water: nothing below it is drawn (as three's Reflector).
    clip.copy(plane).applyMatrix4(mirror.matrixWorldInverse);
    cp.set(clip.normal.x, clip.normal.y, clip.normal.z, clip.constant);
    const e = mirror.projectionMatrix.elements;
    qv.set((Math.sign(cp.x) + e[8]) / e[0], (Math.sign(cp.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    cp.multiplyScalar(2 / cp.dot(qv));
    e[2] = cp.x; e[6] = cp.y; e[10] = cp.z + 1; e[14] = cp.w;
    mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
    const prev = renderer.getRenderTarget(), shadows = renderer.shadowMap.autoUpdate;
    surface.visible = particles.visible = false; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(reflRT); renderer.clear(); renderer.render(scene, mirror);
    renderer.setRenderTarget(prev); renderer.shadowMap.autoUpdate = shadows;
    surface.visible = particles.visible = true;
  }

  // --- Bubbles at the propellers, spray at the bow. ---
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  function spawn(t, eye, dt) {
    const g = particles.geometry, S = g.attributes.aSpawn, V = g.attributes.aVel, n = S.count;
    let spawned = 0;
    const put = (x, y, z, vx, vy, vz, kind) => { const k = particleHead; particleHead = (particleHead + 1) % n; S.setXYZW(k, x, y, z, t); V.setXYZW(k, vx, vy, vz, kind); spawned++; };
    for (const b of boats) {
      const dist = Math.hypot(eye.x - b.x, eye.z - b.z), near = dist < 150 ? 1 : dist < 450 ? 0.3 : 0;
      if (!near || b.speed < 1) continue;
      const Uf = Math.min(1, b.speed / 18), rx = -b.dz, rz = b.dx;             // right of travel
      const wash = Math.round(dt * q.rate * near * (900 * Uf + 60)), spray = Math.round(dt * q.rate * near * 500 * Uf * Uf);
      for (let j = 0; j < wash; j++) {                                          // two streams, from the propellers
        const off = (j % 2 ? 0.9 : -0.9) + (rnd() - 0.5) * 0.7, back = b.aft - rnd() * 2, drift = b.speed * (0.1 + 0.2 * rnd());
        put(b.x + b.dx * back + rx * off, SURFACE.level - 0.25 - rnd() * 0.35, b.z + b.dz * back + rz * off,
          -b.dx * drift + (rnd() - 0.5) * 1.6, 0, -b.dz * drift + (rnd() - 0.5) * 1.6, 0);
      }
      for (let j = 0; j < spray; j++) {                                         // thrown out to both sides from the forefoot
        const side = j % 2 ? 1 : -1, along = b.bow * (0.1 + 0.4 * rnd()), out = b.beam / 2 + rnd() * 0.3, sp = 2.5 + rnd() * 4 * Uf;
        put(b.x + b.dx * along + rx * side * out, SURFACE.level + 0.25, b.z + b.dz * along + rz * side * out,
          b.dx * b.speed * 0.55 + rx * side * sp, 1.2 + rnd() * 3 * Uf, b.dz * b.speed * 0.55 + rz * side * sp, 1);
      }
    }
    if (spawned) { S.needsUpdate = true; V.needsUpdate = true; }
  }

  // --- Frame time, GPU time, and the automatic quality. ---
  const timer = renderer.capabilities.isWebGL2 ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
  const queries = [];
  let slow = 0, fast = 0, lastNow = null;
  const basePixelRatio = renderer.getPixelRatio();
  function setQuality(mode) {
    if (mode !== 'auto' && !QUALITY[mode]) return;
    state.mode = mode;
    if (mode !== 'auto') {
      if (mode !== state.quality) build(mode);
      if (renderer.getPixelRatio() !== basePixelRatio) { renderer.setPixelRatio(basePixelRatio); state.pixelRatio = basePixelRatio; }
    }
    slow = fast = 0;
  }
  function autoQuality(ms) {
    if (state.mode !== 'auto' || !state.active || ms > 250) return;      // a long pause (a hidden tab) says nothing
    if (ms > 24) { slow++; fast = Math.max(0, fast - 2); } else if (ms < 14) { fast++; slow = Math.max(0, slow - 1); } else { slow = Math.max(0, slow - 1); fast = Math.max(0, fast - 1); }
    const i = QUALITY_ORDER.indexOf(state.quality);
    if (slow > 90) {                                                     // ~2-4 s running long: step down
      slow = 0;
      if (i > 0) build(QUALITY_ORDER[i - 1]);
      else if (renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); state.pixelRatio = 1; }
    } else if (fast > 600 && i < 1) { fast = 0; build(QUALITY_ORDER[i + 1]); }   // back up to 'recommended' (cinematic only by choice)
  }

  /** Every frame, before the main render. `boats`: [{x, z, dx, dz, speed,
   *  aft, bow, beam}] (rivertour.js hulls()); `focus`: the orbit target. */
  function update({camera, focus, now = performance.now(), boats: list = []}) {
    const t = waterClock(); U.uTime.value = t;
    if (lastNow !== null) { state.frameMs = +(now - lastNow).toFixed(1); autoQuality(now - lastNow); }
    const dt = lastNow === null ? 0 : Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    boats = list;
    sterns = boats.map((b, i) => recordTrail(trails[i], b, t));
    for (let i = boats.length; i < trails.length; i++) trails[i].length = 0;
    // Only near the river, and low enough to see it move.
    let near = Infinity;
    for (let i = 1; i < river.length; i++) near = Math.min(near, segDist(focus.x, focus.z, river[i - 1], river[i]));
    const active = near < SURFACE.activeWithin && camera.position.y < SURFACE.maxHeight && waterMeshes.size > 0;
    state.active = active; surface.visible = particles.visible = active;
    if (!active) glint?.uWaterHole.value.set(0, 0, 0);
    if (!active) { state.reflection = false; return; }
    sweepLights(now);
    // Centred on the focus, snapped to the wake map's texels so it doesn't crawl.
    const texel = U.uWakeTexel.value, cx = Math.round(focus.x / texel) * texel, cz = Math.round(focus.z / texel) * texel, R = SURFACE.radius;
    U.uCentre.value.set(cx, cz);
    glint?.uWaterHole.value.set(cx, cz, R);
    top.left = cx - R; top.right = cx + R; top.top = -cz + R; top.bottom = -cz - R; top.updateProjectionMatrix();
    const prev = renderer.getRenderTarget(), clearColor = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    if (maskDirty || U.uMaskCentre.value.distanceTo(U.uCentre.value) > MASK_MARGIN / 2) {   // the mask: where the tiles' water is
      const background = scene.background, fog = scene.fog, M = R + MASK_MARGIN;
      top.left = cx - M; top.right = cx + M; top.top = -cz + M; top.bottom = -cz - M; top.updateProjectionMatrix();
      scene.background = null; scene.fog = null; scene.overrideMaterial = maskMat; top.layers.set(WATER_LAYER);
      renderer.setRenderTarget(maskRT); renderer.clear(); renderer.render(scene, top);
      scene.overrideMaterial = null; scene.background = background; scene.fog = fog; top.layers.set(0);
      maskDirty = false; U.uMaskCentre.value.set(cx, cz);
      top.left = cx - R; top.right = cx + R; top.top = -cz + R; top.bottom = -cz - R; top.updateProjectionMatrix();
    }
    boats.forEach((b, i) => {                                         // the wake map
      const g = ribbons[i].geometry, n = ribbon(trails[i], sterns[i], b.speed, t, g.attributes.position.array, g.attributes.aWake.array);
      g.attributes.position.needsUpdate = g.attributes.aWake.needsUpdate = true; g.setDrawRange(0, Math.max(0, (n - 1) * 6));
    });
    ribbons.forEach((r, i) => { r.visible = i < boats.length; });
    renderer.setRenderTarget(wakeRT); renderer.clear(); renderer.render(wakeScene, top);
    renderer.setRenderTarget(prev); renderer.setClearColor(clearColor, clearAlpha);
    for (let i = 0; i < 2; i++) {                                     // the hulls
      const b = boats[i];
      if (b) { U.uBoatPose.value[i].set(b.x, b.z, b.dx, b.dz); U.uBoatDim.value[i].set(b.aft, b.bow, b.beam / 2, b.speed); }
      else U.uBoatDim.value[i].set(0, 0, 0, -1);
    }
    state.boats = boats.length;
    state.rain = rainAt ? rainAt(focus.x, focus.z) : 0; U.uRain.value = state.rain;
    spawn(t, camera.position, dt);
    particles.material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
    state.reflection = !!q.reflection && camera.position.y < 400;
    U.uReflect.value = state.reflection ? 1 : 0;
    if (state.reflection) renderReflection(camera);
  }
  /** The main render, timed on the GPU where the browser can (EXT_disjoint_timer_query_webgl2). */
  function render(sceneToRender, camera) {
    const query = timer && queries.length < 4 ? gl.createQuery() : null;
    if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    renderer.render(sceneToRender, camera);
    if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(query); }
    while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const done = queries.shift();
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) state.gpuMs = +(gl.getQueryParameter(done, gl.QUERY_RESULT) / 1e6).toFixed(2);
      gl.deleteQuery(done);
    }
  }
  function dispose() {
    unsubscribe?.();
    surface?.removeFromParent(); surface?.geometry.dispose(); surface?.material.dispose();
    particles?.removeFromParent(); particles?.geometry.dispose(); particles?.material.dispose();
    [wakeRT, maskRT, reflRT].forEach(r => r?.dispose());
    ribbons.forEach(r => r.geometry.dispose()); wakeMat.dispose(); maskMat.dispose();
    glint?.uWaterHole.value.set(0, 0, 0);
  }
  build(state.quality);
  return {state, update, render, register, unregister, reflect, sample, setQuality, dispose, trails, get surface() { return surface; }, get particles() { return particles; }, get targets() { return {wakeRT, maskRT, reflRT, mirror}; }};
}

function segDist(x, z, [ax, az], [bx, bz]) {
  const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1, u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2));
  return Math.hypot(ax + ex * u - x, az + ez * u - z);
}
