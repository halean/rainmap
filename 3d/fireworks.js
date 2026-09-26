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
  anchor: [106.7082, 10.7742], spacing: 260, stars: 90000, lights: 3, showSeconds: 180,
});
const G = 9.81;
// Colours: [r, g, b], bright enough for additive glow.
const COLOURS = {
  red: [1.0, 0.16, 0.12], gold: [1.0, 0.72, 0.28], green: [0.3, 1.0, 0.35], blue: [0.3, 0.45, 1.0],
  purple: [0.75, 0.3, 1.0], silver: [0.85, 0.9, 1.0], orange: [1.0, 0.45, 0.1], cyan: [0.3, 0.95, 1.0], pink: [1.0, 0.4, 0.7],
};
const NAMES = Object.keys(COLOURS);

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
const RISE_DRAG = 0.05;

function starMaterial(u) {
  return new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uTime, uScale;
      attribute vec4 aStart;   // burst point, t0
      attribute vec4 aVel;     // velocity, drag
      attribute vec4 aColour;  // rgb, kind: 0 star, 1 strobe, 2 willow, 3 comet, 4 flash
      attribute vec4 aMisc;    // life, lag, size (m), brightness
      varying vec3 vColour; varying float vAlpha;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float t = uTime - aStart.w - aMisc.y, life = aMisc.x, k = aVel.w, kind = aColour.w;
        vAlpha = 0.0; gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        if (t < 0.0 || t > life) return;
        float e = (1.0 - exp(-k * t)) / k;
        vec3 p = aStart.xyz + aVel.xyz * e; p.y += (9.81 / k) * e - 9.81 * t / k;
        float u = t / life;
        // White-hot at the burst, the colour, then fading; willow fades to embers.
        vec3 c = aColour.rgb;
        if (kind < 3.5) c = mix(vec3(1.0, 0.95, 0.85), c, smoothstep(0.0, 0.12, u));
        if (kind > 1.5 && kind < 2.5) c = mix(c, vec3(0.9, 0.35, 0.08), smoothstep(0.4, 1.0, u));
        float a = aMisc.w * (1.0 - smoothstep(kind > 1.5 && kind < 2.5 ? 0.5 : 0.65, 1.0, u));
        if (kind > 0.5 && kind < 1.5 && u > 0.45) a *= step(0.55, hash(floor(uTime * 18.0) + aStart.x * 13.1 + aVel.y));   // crackle
        if (kind > 2.5 && kind < 3.5) a *= 0.8 + 0.2 * hash(floor(uTime * 30.0) + aVel.x);                            // the comet flickers
        if (kind > 3.5) a *= 1.0 - u;                                                                                     // the flash
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
  const A = {start: attr('aStart', 4), vel: attr('aVel', 4), colour: attr('aColour', 4), misc: attr('aMisc', 4)};
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
  function put(p, v, k, t0, c, kind, life, lag, size, bright) {
    const i = head; head = (head + 1) % N; if (head === 0) wrapped = true;
    A.start.setXYZW(i, p[0], p[1], p[2], t0); A.vel.setXYZW(i, v[0], v[1], v[2], k);
    A.colour.setXYZW(i, c[0], c[1], c[2], kind); A.misc.setXYZW(i, life, lag, size, bright);
    lo = Math.min(lo, i); hi = Math.max(hi, i);
  }
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const sphere = () => { const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z); return [r * Math.cos(a), z, r * Math.sin(a)]; };

  /** Stars for a burst at p (time t0) of the given type and colours. */
  function burst(shell) {
    const {p, t0, type, c1, c2, size} = shell, R = size;                          // R: the burst's radius (m)
    const k = 1.3, v = R * k;                                                     // stars coast out to ~R under drag
    const star = (dir, speed, col, kind, life, trail, bright = 1, kk = k, sz = 4.2) => {
      const vel = [dir[0] * speed, dir[1] * speed, dir[2] * speed];
      for (let j = 0; j < trail; j++) put(p, vel, kk, t0, col, kind, life, j * (kind === 2 ? 0.07 : 0.04), sz * (1 - j / (trail + 1)), bright * Math.pow(0.72, j));
    };
    put(p, [0, 0, 0], 1, t0, [1, 0.95, 0.85], 4, 0.18, 0, R * 0.9, 1.4);          // the flash
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
    }
    // A flash of light on the city.
    const l = lights.reduce((a, b) => (a.t0 < b.t0 ? a : b));
    l.light.position.set(p[0], p[1], p[2]); l.light.color.setRGB(...(type === 'willow' || type === 'palm' ? COLOURS.gold : type === 'salute' ? COLOURS.silver : c1));
    l.t0 = t0; l.peak = (type === 'salute' ? 1.2e6 : 6e5) * (R / 90) ** 2; l.decay = type === 'willow' ? 1.4 : 0.5;
  }
  const norm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b) => a.map((x, i) => x + b[i]), scale = (a, s) => a.map(x => x * s);

  // --- The programme. ---
  let shells = [], showStart = null;
  const state = {running: false, secondsLeft: 0, shellsFired: 0, shells: 0, sites: sites.length, simulated: true};
  function shell(t, site, type, h, size) {
    const c1 = COLOURS[pick(NAMES)], c2 = rnd() < 0.5 ? c1 : COLOURS[pick(NAMES)];
    const drift = [(rnd() - 0.5) * 30, (rnd() - 0.5) * 30];                      // mortars are angled a little
    const v0 = launchSpeed(h, RISE_DRAG), {t: rise} = apex(v0, RISE_DRAG), s = sites[site];
    const vx = drift[0] / rise, vz = drift[1] / rise;
    shells.push({launch: t, burstAt: t + rise, site, type, h, size, c1, c2, from: [s.x, s.y, s.z], v: [vx, v0, vz], whistle: rnd() < 0.25, launched: false, burst: false});
  }
  /** Build a show from `seed`: opening, middle and finale. */
  function programme(start, seconds) {
    shells = [];
    const types = ['peony', 'chrysanthemum', 'crackle', 'willow', 'ring', 'palm'];
    const end = start + seconds, finale = end - 22;
    let t = start + 1;
    while (t < finale) {
      const phase = (t - start) / (finale - start);
      const count = phase < 0.25 ? 1 : phase < 0.7 ? 1 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 2);
      const type = pick(types);
      for (let i = 0; i < count; i++) {
        const site = count === 1 ? Math.floor(rnd() * 3) : count === 3 ? i : (i ? 2 : 0);
        shell(t + i * 0.12, site, type, 150 + rnd() * 100, 60 + rnd() * 50);
      }
      if (phase > 0.4 && rnd() < 0.3) for (let i = 0; i < 5; i++) shell(t + 0.3 + i * 0.25, i % 3, 'salute', 90 + rnd() * 40, 25);
      t += phase < 0.25 ? 2.2 + rnd() : 1.4 + rnd() * 1.2;
    }
    // The finale: all three barges, fast, then a last wall of willows and salutes.
    for (; t < end - 5; t += 0.18) shell(t, Math.floor(rnd() * 3), pick(types), 140 + rnd() * 120, 55 + rnd() * 55);
    for (let i = 0; i < 9; i++) shell(end - 5 + i * 0.1, i % 3, 'willow', 230 + rnd() * 30, 110);
    for (let i = 0; i < 12; i++) shell(end - 3.5 + i * 0.12, i % 3, 'salute', 120 + rnd() * 60, 30);
    shells.sort((a, b) => a.launch - b.launch);
    state.shells = shells.length;
  }
  function start(seconds = FIREWORKS.showSeconds) {
    seed = 1 + Math.floor(Math.random() * 1e6);
    showStart = clock(); programme(showStart, seconds);
    state.running = true; state.shellsFired = 0;
  }
  function stop() { shells = []; state.running = false; state.secondsLeft = 0; }

  function update(now, camera, renderer) {
    const t = clock(); U.uTime.value = t;
    if (camera) sound?.setListener(camera);
    lo = Infinity; hi = -1; wrapped = false;
    for (const s of shells) {
      if (s.launch > t) break;
      if (!s.launched) {                                                          // the comet: a gold spark rising, with its trail
        s.launched = true;
        sound?.launch(s.from, s.launch - t, s.burstAt - s.launch, s.whistle);
        for (let j = 0; j < 8; j++) put(s.from, s.v, RISE_DRAG, s.launch, [1, 0.75, 0.4], 3, s.burstAt - s.launch, j * 0.03, 3.6 - j * 0.3, 0.9 * Math.pow(0.75, j));
      }
      if (!s.burst && s.burstAt <= t) {
        s.burst = true; state.shellsFired++;
        const p = starAt(s.from, s.v, RISE_DRAG, s.burstAt - s.launch);
        burst({p, t0: s.burstAt, type: s.type, c1: s.c1, c2: s.c2, size: s.size});
        sound?.burst(p, s.burstAt - t, s.type, s.size);
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
  return {group, state, sites, view, start, stop, update, lights: lights.map(l => l.light), get head() { return head; }, attributes: A, dispose() { group.removeFromParent(); geo.dispose(); points.material.dispose(); bargeMat.dispose(); group.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }};
}
