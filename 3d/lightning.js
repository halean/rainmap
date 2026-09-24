import * as THREE from 'three';
import {renderThunder, reverbReturn, playThunder, RENDER_RATE} from './thunder.js';
const $ = id => document.getElementById(id);

// Which camera rain classes (weather-data.js rainClasses: No:0 .. Heavy:3)
// can host a flash. Physically Light rain rarely means convection, so 2
// (Medium/Heavy) is the honest threshold; it is set to 1 so lightning can be
// inspected whenever any camera reports rain at all. Restore 2 for realism.
export const STORM_MIN_CLASS = 1;
// Schematic cloud-deck height a strike descends from, matching the Himawari
// overlay's own schematic altitude in weather.js -- both are stand-ins for a
// real cloud base, not measured.
const CLOUD_Y = 2500;
// How far from a storm-reporting camera a tall building still counts as
// "under" that storm, in local metres (~the same 11.2 km cutoff the camera
// density field itself fades out by, but tighter -- a strike should look
// like it belongs to the nearby weather, not the city at large).
const BUILDING_STORM_RADIUS = 1500;
// Skyline vertices are clustered onto this grid to find individual towers
// inside meshes that merge many buildings per tile (see 3d/tools/skyline.py);
// this is roughly a small building's footprint, close enough to separate
// distinct high-rises without over-fragmenting one tower's own geometry.
const CLUSTER_CELL = 50;
// Most flashes in a tropical storm never reach the ground: intracloud
// ("sheet") lightning outnumbers cloud-to-ground by roughly 2-3 to 1. This
// is the share of flashes drawn as a diffuse glow inside the cloud deck
// rather than as a channel to a building or the ground.
export const SHEET_FRACTION = 0.55;

// The skyline layer merges every tall building in a tile into one mesh (build.py
// buckets by material per tile, not per building), so individual towers are
// recovered here by clustering vertices on a coarse ground grid and keeping
// each cell's apex height -- a one-time pass over ~60k vertices, not a
// per-frame cost. Only the tallest clusters are kept as strike targets, so
// Landmark 81 and Bitexco-scale towers dominate over background 40 m rooftops.
export function tallBuildings(skyline, keepTop = 160) {
  if (!skyline) return [];
  const cells = new Map();
  skyline.updateWorldMatrix(true, false);
  skyline.traverse(o => {
    if (!o.isMesh) return;
    const position = o.geometry.getAttribute('position');
    if (!position) return;
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
      const key = `${Math.round(v.x / CLUSTER_CELL)},${Math.round(v.z / CLUSTER_CELL)}`;
      const cell = cells.get(key);
      if (cell) { cell.sumX += v.x; cell.sumZ += v.z; cell.count++; if (v.y > cell.height) cell.height = v.y; }
      else cells.set(key, {sumX: v.x, sumZ: v.z, count: 1, height: v.y});
    }
  });
  return [...cells.values()]
    .map(c => ({x: c.sumX / c.count, z: c.sumZ / c.count, height: c.height}))
    .sort((a, b) => b.height - a.height)
    .slice(0, keepTop);
}

// ---------------------------------------------------------------------------
// Channel geometry

// Midpoint displacement: split the segment, push the midpoint sideways by a
// random fraction of the segment's length, recurse. Gives the multi-scale
// tortuosity of a real channel -- large wander plus fine jaggedness --
// rather than a few evenly jittered straight legs.
function subdivide(a, b, depth, sway, rng) {
  if (depth === 0) return [a.clone(), b.clone()];
  const dir = new THREE.Vector3().subVectors(b, a), length = dir.length();
  const axis = new THREE.Vector3(rng() - .5, rng() - .5, rng() - .5);
  const side = new THREE.Vector3().crossVectors(dir, axis);
  if (side.lengthSq() < 1e-9) side.set(1, 0, 0);
  side.normalize().multiplyScalar(length * sway * (rng() * 2 - 1));
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(.5).add(side);
  const left = subdivide(a, mid, depth - 1, sway, rng), right = subdivide(mid, b, depth - 1, sway, rng);
  return left.concat(right.slice(1));
}

// A cloud-to-ground channel: the main path from a point in the cloud deck
// to the target, plus side branches that leave it partway down and die out
// in mid-air the way a stepped leader's branches do (only the main channel
// connects, so only it carries the later return strokes -- see strike()).
// Returns {main: Vector3[], branches: Vector3[][]}.
export function boltChannel(start, end, {depth = 5, sway = .16, branchChance = .32, rng = Math.random} = {}) {
  const main = subdivide(start, end, depth, sway, rng);
  const branches = [];
  const grow = (points, level) => {
    const n = points.length;
    for (let i = 2; i < n - 2; i++) {
      // Branches are more likely higher up the channel and thin out with depth.
      const heightFrac = 1 - i / n;
      if (rng() > branchChance * (0.4 + heightFrac) / level) continue;
      const p = points[i];
      const along = new THREE.Vector3().subVectors(points[i + 1], points[i - 1]).normalize();
      const random = new THREE.Vector3(rng() - .5, -(0.2 + rng() * .6), rng() - .5).normalize();
      const dir = along.multiplyScalar(.5).add(random).normalize();
      const remaining = Math.max(60, p.y - end.y);
      const length = remaining * (0.2 + rng() * 0.4);
      const tip = p.clone().addScaledVector(dir, length);
      if (tip.y < end.y + 40) tip.y = end.y + 40 + rng() * 60; // dies out above the ground
      const branch = subdivide(p, tip, Math.max(1, depth - 2), sway * 1.3, rng);
      branches.push(branch);
      if (level < 2 && branch.length > 4) grow(branch, level + 1);
    }
  };
  grow(main, 1);
  return {main, branches};
}

// An intracloud channel: a long, tortuous, roughly horizontal path inside
// the cloud deck. Never drawn -- only its thunder is heard -- but the
// geometry is what gives a sheet flash its long, distant, low roll.
export function cloudChannel(centre, rng = Math.random) {
  const angle = rng() * Math.PI * 2, length = 1500 + rng() * 3000;
  const end = new THREE.Vector3(centre.x + Math.cos(angle) * length, centre.y + (rng() - .5) * 400, centre.z + Math.sin(angle) * length);
  return subdivide(centre, end, 4, .22, rng);
}

// Flatten channel polylines into the segment list the thunder model uses.
export function channelSegments(polylines) {
  const segments = [];
  for (const {points, weight} of polylines) {
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1];
      segments.push({a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], w: weight});
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Thunder lives in thunder.js (pure arrays, no DOM/three.js) so it can also
// run in thunder-worker.js; re-exported here for the tests and for callers.
export {renderThunder, reverbImpulse, reverbReturn, playThunder, SPEED_OF_SOUND, RENDER_RATE} from './thunder.js';

// ---------------------------------------------------------------------------
// Return strokes

// A cloud-to-ground flash is usually several return strokes down one
// channel: the first, then dart leaders re-lighting it every few tens of
// milliseconds, each cooling in ~40 ms. A later stroke is often brighter
// than the one before it, and some are followed by a "continuing current"
// that keeps the channel glowing dimly for a fraction of a second. Sheet
// flashes pulse more slowly and softly. Times in ms from the flash start.
export function makeStrokes(kind, rng = Math.random) {
  const strokes = [];
  if (kind === 'sheet') {
    const count = 2 + Math.floor(rng() * 4);
    let at = 0;
    for (let i = 0; i < count; i++) {
      strokes.push({at, intensity: i === 0 ? .8 + rng() * .2 : .4 + rng() * .6, tau: 70 + rng() * 60});
      at += 60 + rng() * 180;
    }
    return strokes;
  }
  const count = rng() < .15 ? 1 : 2 + Math.floor(rng() * 5);
  let at = 0;
  for (let i = 0; i < count; i++) {
    const stroke = {at, intensity: i === 0 ? 1 : .35 + rng() * .75, tau: 35 + rng() * 25};
    if (rng() < .3) stroke.continuing = {duration: 100 + rng() * 250, level: .2 + rng() * .2};
    strokes.push(stroke);
    at += 35 * Math.exp(rng() * 1.2); // ~35-115 ms, log-normal-ish
  }
  return strokes;
}

// Channel brightness at `t` ms into the flash, 0..1: each stroke's sharp
// rise and exponential cooling, plus any continuing current, summed.
export function brightnessAt(strokes, t, onlyFirst = false) {
  let b = 0;
  for (const s of onlyFirst ? strokes.slice(0, 1) : strokes) {
    if (t < s.at) continue;
    const dt = t - s.at;
    b += s.intensity * Math.exp(-dt / s.tau);
    if (s.continuing && dt < s.continuing.duration) b += s.continuing.level * Math.sqrt(1 - dt / s.continuing.duration);
  }
  return Math.min(1, b);
}

export function flashLengthMs(strokes) {
  return Math.max(...strokes.map(s => s.at + (s.continuing ? s.continuing.duration : 0))) + 450;
}

// How much a candidate flash site is favoured for being near the viewer and
// in front of the camera. Flashes really do happen all over a storm, but a
// bolt 15 km behind the camera is invisible and its thunder arrives most of
// a minute later at a whisper -- so the ones the viewer would actually
// notice are preferred, with a floor so distant ones still occur. `d` is
// metres from the camera; `facing` is the cosine between the camera's
// horizontal forward direction and the direction to the site.
export function viewWeight(d, facing) {
  const near = 1 / (1 + Math.pow(d / 3500, 2)) + 0.02;
  return near * (0.2 + 0.8 * Math.max(0, facing));
}

// ---------------------------------------------------------------------------
// Rendering helpers

function dataTexture(width, height, fill) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b, a] = fill(x / (width - 1 || 1), y / (height - 1 || 1)), i = (y * width + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

// Soft profile across a ribbon's width: bright centre, transparent edges.
function ribbonTexture() {
  return dataTexture(64, 1, u => [255, 255, 255, Math.round(255 * Math.exp(-Math.pow((u - .5) / .21, 2)))]);
}

function radialSprite(colour, softness) {
  const c = new THREE.Color(colour);
  const texture = dataTexture(96, 96, (u, v) => {
    const r = Math.hypot(u - .5, v - .5) * 2;
    return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), Math.round(255 * Math.max(0, Math.exp(-Math.pow(r / softness, 2)) - Math.exp(-1 / (softness * softness)) * r))];
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: texture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending}));
  return sprite;
}

// Camera-facing ribbons along polylines, so a channel has real luminous
// width and a soft halo rather than being a one-pixel line. Built once per
// strike against the camera position at that moment -- a flash is over in
// well under a second, so the view cannot move enough to matter.
export function ribbonGeometry(polylines, cameraPosition) {
  const positions = [], uvs = [], index = [];
  const tangent = new THREE.Vector3(), view = new THREE.Vector3(), side = new THREE.Vector3();
  let base = 0;
  for (const {points, width} of polylines) {
    const n = points.length; if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      tangent.subVectors(points[Math.min(n - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
      view.subVectors(cameraPosition, points[i]).normalize();
      side.crossVectors(tangent, view);
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
      side.normalize().multiplyScalar(width / 2);
      const p = points[i];
      positions.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
      const v = i / (n - 1); uvs.push(0, v, 1, v);
      if (i < n - 1) { const a = base + 2 * i; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    base += 2 * n;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

// ---------------------------------------------------------------------------

export function createLightning({scene, weather, skyline, camera}) {
  const profile = ribbonTexture();
  const ribbonMaterial = (colour, opacity) => new THREE.MeshBasicMaterial({map: profile, color: colour, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide});
  // The main channel and its branches get separate meshes because they
  // brighten differently: branches only light with the first stroke.
  const meshes = {
    mainCore: new THREE.Mesh(new THREE.BufferGeometry(), ribbonMaterial('#ffffff', 0)),
    mainHalo: new THREE.Mesh(new THREE.BufferGeometry(), ribbonMaterial('#8fa8ff', 0)),
    branchCore: new THREE.Mesh(new THREE.BufferGeometry(), ribbonMaterial('#e8eeff', 0)),
    branchHalo: new THREE.Mesh(new THREE.BufferGeometry(), ribbonMaterial('#7f93ff', 0)),
  };
  const impact = radialSprite('#ffffff', .45);
  const sheetGlow = radialSprite('#cbd6ff', .55);
  scene.add(...Object.values(meshes), impact, sheetGlow);
  // Reused every flash; only position/intensity change. flashLight is the
  // strong local glow along the channel; skyFlash is a scene-wide ambient
  // boost, and the sky colour itself is lerped toward SKY_FLASH_COLOR --
  // together these read as the whole sky catching the flash.
  const flashLight = new THREE.PointLight('#dce8ff', 0, 9000, 1.2);
  const skyFlash = new THREE.AmbientLight('#dce8ff', 0);
  scene.add(flashLight, skyFlash);
  const skyBase = scene.background && scene.background.isColor ? scene.background.clone() : null;
  const SKY_FLASH_COLOR = new THREE.Color('#eef6ff');
  const buildings = tallBuildings(skyline);
  const state = {enabled: false, active: false, stormLevel: 0, candidateCount: 0, buildingTargets: buildings.length, strikesTotal: 0, buildingStrikes: 0, sheetFlashes: 0, lastStrikeAt: null, lastTarget: null, lastFlashKind: null, lastFlashCount: 0, lastThunder: null, audioEnabled: false};
  let nextStrikeAt = 0, flash = null, audioContext = null, masterGain = null, convolver = null, armedAt = 0, firstFlash = false, lastCountdown = null;
  // Thunder renders in a worker (see thunder-worker.js) so the flash never
  // stutters; if workers are unavailable it renders inline instead.
  let worker = null, workerBroken = false, requestId = 0;
  const pending = new Map();
  function renderOffThread(segments, listener, options) {
    if (!workerBroken && !worker && typeof Worker === 'function') {
      try {
        worker = new Worker(new URL('./thunder-worker.js', import.meta.url), {type: 'module'});
        worker.onmessage = ({data}) => { const done = pending.get(data.id); pending.delete(data.id); if (done) done(data.rendered); };
        worker.onerror = e => { workerBroken = true; worker = null; for (const [id, done] of pending) { pending.delete(id); done(null); } console.warn('thunder worker failed; rendering inline', e.message || e); };
      } catch (e) { workerBroken = true; worker = null; }
    }
    if (!worker) return Promise.resolve(renderThunder(segments, listener, options));
    return new Promise(done => { const id = ++requestId; pending.set(id, done); worker.postMessage({id, segments, listener, options}); });
  }

  function candidates() {
    return (weather.rainPoints?.() || []).filter(p => p.classIndex >= STORM_MIN_CLASS);
  }

  function scheduleNext(now, level) {
    // Busier storms flash more often: roughly every 3-8 s at Heavy, 6-14 s at
    // Medium, 8-18 s at Light. Not calibrated to any real flash-rate data.
    const [lo, hi] = level >= 3 ? [3000, 8000] : level >= 2 ? [6000, 14000] : [8000, 18000];
    nextStrikeAt = now + lo + Math.random() * (hi - lo);
  }

  // A dramatic strike -- one of the tallest nearby towers -- when the storm
  // reaches close enough to one; otherwise a jittered ground strike at a
  // storm-reporting camera. Buildings are weighted heavily by height so a
  // supertall dominates its neighbourhood the way it would in reality (tall
  // structures really do take a disproportionate share of strikes).
  // Weighted random choice, with each candidate's weight scaled by how
  // visible its site would be from the current camera (see viewWeight).
  function choose(candidates) {
    const eye = camera ? camera.position : new THREE.Vector3(0, 300, 0);
    const forward = new THREE.Vector3(0, 0, -1); if (camera) camera.getWorldDirection(forward);
    const fl = Math.hypot(forward.x, forward.z) || 1;
    let total = 0;
    for (const c of candidates) {
      const dx = c.x - eye.x, dz = c.z - eye.z, d = Math.hypot(dx, dz) || 1;
      c.viewed = c.weight * viewWeight(d, (dx * forward.x + dz * forward.z) / (d * fl));
      total += c.viewed;
    }
    let r = Math.random() * total;
    for (const c of candidates) { r -= c.viewed; if (r <= 0) return c; }
    return candidates[candidates.length - 1];
  }

  function pickTarget(pool) {
    const nearby = [];
    for (const p of pool) for (const b of buildings) {
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d <= BUILDING_STORM_RADIUS) nearby.push({x: b.x, y: b.height, z: b.z, weight: (b.height ** 1.6) * p.classIndex, building: true});
    }
    if (nearby.length) return choose(nearby);
    const p = choose(pool.map(p => ({x: p.x, z: p.z, weight: p.classIndex - STORM_MIN_CLASS + 1})));
    return {x: p.x + (Math.random() - .5) * 300, y: 2, z: p.z + (Math.random() - .5) * 300, building: false};
  }

  function applySky(strength) {
    skyFlash.intensity = strength * 1.6;
    if (skyBase) scene.background.copy(skyBase).lerp(SKY_FLASH_COLOR, strength);
  }

  // Everything visible follows one brightness curve evaluated per frame, so
  // the channel, its halo, the light on the city and the sky all rise and
  // cool together, stroke by stroke.
  function render(t) {
    const b = brightnessAt(flash.strokes, t), first = brightnessAt(flash.strokes, t, true);
    if (flash.kind === 'sheet') {
      sheetGlow.material.opacity = b * .85;
    } else {
      meshes.mainCore.material.opacity = Math.min(1, b * 1.25);
      meshes.mainHalo.material.opacity = b * .7;
      meshes.branchCore.material.opacity = first * .9;
      meshes.branchHalo.material.opacity = first * .5;
      impact.material.opacity = b;
    }
    flashLight.intensity = flash.peakLight * b;
    applySky(flash.skyScale * b);
    return b;
  }

  function clearFlash() {
    for (const m of Object.values(meshes)) m.material.opacity = 0;
    impact.material.opacity = sheetGlow.material.opacity = 0;
    flashLight.intensity = 0;
    applySky(0);
    flash = null;
  }

  function reset() {
    nextStrikeAt = 0;
    clearFlash();
  }

  function listener() {
    const position = camera ? camera.position : new THREE.Vector3(0, 300, 0);
    const forward = new THREE.Vector3(0, 0, -1);
    if (camera) camera.getWorldDirection(forward);
    return {position: [position.x, position.y, position.z], forward: [forward.x, forward.y, forward.z]};
  }

  function strike(now, pool) {
    if (flash) clearFlash(); // never blend a new flash's meshes over a previous one's
    const cameraPosition = camera ? camera.position : new THREE.Vector3(0, 300, 0);
    const sheet = Math.random() < SHEET_FRACTION;
    let segments, strokes, peakLight, skyScale, target = null;
    if (sheet) {
      const p = choose(pool.map(p => ({x: p.x, z: p.z, weight: p.classIndex})));
      const centre = new THREE.Vector3(p.x + (Math.random() - .5) * 1600, CLOUD_Y - 250, p.z + (Math.random() - .5) * 1600);
      // Forked like a strike's in-cloud section (see below), so the roll's
      // spread never collapses when one arm happens to run toward the listener.
      segments = channelSegments([{points: cloudChannel(centre), weight: 1}, {points: cloudChannel(centre), weight: 1}]);
      strokes = makeStrokes('sheet');
      const size = 2200 + Math.random() * 1600;
      sheetGlow.position.copy(centre); sheetGlow.scale.set(size, size, 1);
      flashLight.position.set(centre.x, centre.y - 300, centre.z);
      peakLight = 6; skyScale = .5;
      state.sheetFlashes++;
    } else {
      target = pickTarget(pool);
      const end = new THREE.Vector3(target.x, target.y, target.z);
      const start = new THREE.Vector3(target.x + (Math.random() - .5) * 900, CLOUD_Y + (Math.random() - .5) * 200, target.z + (Math.random() - .5) * 900);
      const {main, branches} = boltChannel(start, end);
      // Perceived width is glare, not the channel's few centimetres; scale
      // it with viewing distance so it stays a few pixels of core.
      const distance = cameraPosition.distanceTo(end), core = Math.min(10, Math.max(2, distance * .0015));
      const rebuild = (mesh, polylines) => { mesh.geometry.dispose(); mesh.geometry = ribbonGeometry(polylines, cameraPosition); mesh.visible = polylines.length > 0; };
      rebuild(meshes.mainCore, [{points: main, width: core}]);
      rebuild(meshes.mainHalo, [{points: main, width: core * 7}]);
      rebuild(meshes.branchCore, branches.map(points => ({points, width: core * .55})));
      rebuild(meshes.branchHalo, branches.map(points => ({points, width: core * 3.5})));
      // Most of a flash's channel is horizontal, inside the cloud, for
      // kilometres beyond the visible bolt; it is never drawn, but it is
      // where the long tail of the thunder comes from. Without it every
      // strike is a 2.5 km stick whose sound all arrives within a second or
      // two -- a boom, not a roll.
      // Two of them, in different directions: a single one that happens to
      // run toward the listener collapses the arrival spread to a few
      // seconds, and real flashes fork inside the cloud anyway.
      const inCloud = [cloudChannel(start), cloudChannel(start)];
      segments = channelSegments([{points: main, weight: 1}, ...branches.map(points => ({points, weight: .45})), ...inCloud.map(points => ({points, weight: 1.2}))]);
      strokes = makeStrokes('ground');
      const scale = target.building ? 340 : 160;
      impact.position.copy(end); impact.scale.set(scale, scale, 1);
      // Light from partway up the channel, where most of its length is, not
      // just the point of contact.
      flashLight.position.set(target.x, target.y + (CLOUD_Y - target.y) * .35, target.z);
      peakLight = target.building ? 15 : 9; skyScale = target.building ? .95 : .65;
      if (target.building) state.buildingStrikes++;
    }
    flash = {kind: sheet ? 'sheet' : target.building ? 'building' : 'ground', strokes, startedAt: now, peakLight, skyScale, length: flashLengthMs(strokes)};
    render(0);
    state.strikesTotal++;
    state.lastFlashKind = flash.kind;
    state.lastFlashCount = strokes.length;
    state.lastStrikeAt = new Date().toISOString();
    state.lastTarget = target ? {x: Math.round(target.x), z: Math.round(target.z), height: Math.round(target.y), building: target.building} : null;
    // Rendered even with sound off (at a token sample rate) so the timing
    // and distance are still reported in `state.lastThunder` and the panel.
    const ear = listener(), flashKind = flash.kind, strokeCount = strokes.length, sentAt = performance.now();
    renderOffThread(segments, ear.position, {sampleRate: audioContext ? RENDER_RATE : 8000, forward: ear.forward, strokes: strokes.map(s => ({at: s.at / 1000, intensity: s.intensity}))}).then(rendered => {
      if (rendered && !rendered.samples?.length) rendered = null;
      if (rendered && rendered.samples && !(rendered.samples instanceof Float32Array)) rendered.samples = new Float32Array(rendered.samples);
      state.lastThunder = rendered ? {delaySec: +rendered.startDelaySec.toFixed(2), durationSec: +(rendered.audibleSec ?? rendered.durationSec).toFixed(2), nearestM: Math.round(rendered.nearestM), farthestM: Math.round(rendered.farthestM), pan: +rendered.pan.toFixed(2)} : null;
      // Only play a render made at the audio rate: a numbers-only render
      // (sound was off when the flash happened) is not for playback, even if
      // sound was switched on while it was being rendered.
      if (audioContext && rendered && rendered.sampleRate === RENDER_RATE) {
        // The render took real time; start the sound that much sooner so it
        // still lands at the strike's own travel-time delay.
        rendered.elapsedSec = (performance.now() - sentAt) / 1000;
        playThunder(audioContext, masterGain, rendered, convolver);
      }
      const status = $('lightning-status');
      if (status) {
        const what = flashKind === 'sheet' ? 'sheet flash inside the cloud' : flashKind === 'building' ? 'strike on a tall building' : 'ground strike';
        status.dataset.last = rendered
          ? `Last: ${what}, ${strokeCount} stroke${strokeCount === 1 ? '' : 's'} · thunder reaches your viewpoint after ${rendered.startDelaySec.toFixed(1)} s (nearest part of the channel ${(rendered.nearestM / 1000).toFixed(1)} km away) and rolls for about ${(rendered.audibleSec ?? rendered.durationSec).toFixed(0)} s.`
          : `Last: ${what}, ${strokeCount} strokes.`;
        status.textContent = status.dataset.last; lastCountdown = null;
      }
    });
  }

  const lightningToggle = $('lightning-effects'), soundToggle = $('thunder-sound');
  if (lightningToggle) lightningToggle.onchange = () => {
    state.enabled = lightningToggle.checked;
    if (!state.enabled) reset();
    else { armedAt = performance.now(); firstFlash = true; }
  };
  if (soundToggle) soundToggle.onchange = () => {
    state.audioEnabled = soundToggle.checked;
    if (state.audioEnabled && !audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioContext = new AudioCtx();
        masterGain = audioContext.createGain(); masterGain.gain.value = .6; masterGain.connect(audioContext.destination);
        convolver = reverbReturn(audioContext, masterGain);
      }
    }
    if (audioContext) { if (state.audioEnabled) audioContext.resume(); else audioContext.suspend(); }
  };

  return {
    state,
    update(now) {
      // A safety opt-in, not just a layer toggle: nothing here runs -- no
      // flash, no strikes scheduled -- unless the person has explicitly
      // turned Lightning on despite its flashing-images warning.
      if (!state.enabled) { state.active = false; return; }
      const layerOn = $('rain-weather')?.checked;
      const pool = layerOn ? candidates() : [];
      state.candidateCount = pool.length;
      state.stormLevel = pool.reduce((max, p) => Math.max(max, p.classIndex), 0);
      state.active = pool.length > 0;
      if (flash) {
        const t = now - flash.startedAt, b = render(t);
        if (t > flash.length && b < .004) clearFlash();
      }
      const status = $('lightning-status');
      if (!state.active) {
        nextStrikeAt = 0;
        if (status && !flash && lastCountdown !== 'idle') { lastCountdown = 'idle'; status.textContent = layerOn ? 'Armed, but no camera currently reports rain, so nothing to flash over.' : 'Armed, but the CCTV rain density layer is off.'; }
        return;
      }
      if (!nextStrikeAt) {
        // First flash ~2 s after arming, so switching it on shows something
        // promptly; the storm's own pacing takes over after that.
        if (firstFlash) { nextStrikeAt = now + 2000; firstFlash = false; } else scheduleNext(now, state.stormLevel);
        return;
      }
      if (now >= nextStrikeAt) { strike(now, pool); scheduleNext(now, state.stormLevel); return; }
      if (status && !flash) {
        const seconds = Math.ceil((nextStrikeAt - now) / 1000);
        if (seconds !== lastCountdown) { lastCountdown = seconds; status.textContent = (status.dataset.last ? status.dataset.last + ' ' : '') + `Next flash in ~${seconds} s.`; }
      }
    },
  };
}
