// Vietnamese flag: real-scale XPBD cloth, driven by relative air velocity.
// Wind: the Tân Sơn Nhất METAR, the same report flights.js uses, served by
// /api/rain-map/flights. METAR gives the direction the wind blows FROM; a flag
// streams the opposite way.
//
// Size: modelled on the giant flag on Çamlıca Hill, Istanbul -- 1,000 m² on a
// 110 m pole. In the official 2:3 proportions that is about 38.7 x 25.8 m.
//
// Height: METAR wind is measured 10 m above the airfield; the flag flies about
// 500 m up, where wind is usually much stronger. It is scaled with the common
// power-law wind profile, speed ~ height^0.3 -- the exponent wind engineering
// uses for dense city centres, where the rough surface slows the wind near the
// ground far more than open country (0.2) does. An estimate, and labelled so.
import * as THREE from 'three';
import {Cloth} from './cloth.js';
export {Cloth} from './cloth.js';

const $ = id => document.getElementById(id);
const WIND_REFRESH_MS = 10 * 60 * 1000;
const PROFILE_EXPONENT = 0.3;   // wind speed ~ height^0.3 (dense urban terrain)
const METAR_HEIGHT_M = 10;

/** Estimated wind at `heightM` from a 10 m reading, by the power-law profile. */
export function windAloft(surfaceKt, heightM) {
  return surfaceKt * Math.pow(Math.max(heightM, METAR_HEIGHT_M) / METAR_HEIGHT_M, PROFILE_EXPONENT);
}

/** Direction (scene axes: +X east, +Z south) that a wind blowing FROM
 *  `fromDeg` (compass degrees) carries things toward. */
export function downwind(fromDeg) {
  const r = fromDeg * Math.PI / 180;
  return {x: -Math.sin(r), z: Math.cos(r)};
}

/** Rotation about +Y that turns the flag's local +X (hoist to fly end) to
 *  point along `downwind(fromDeg)`. */
export function flagYaw(fromDeg) {
  const d = downwind(fromDeg);
  return Math.atan2(-d.z, d.x);
}

/** Roof of the tallest tower in the skyline layer: centre, height, and the
 *  side of a square with the same area. */
export function tallestRoof(skyline) {
  if (!skyline) return null;
  skyline.updateWorldMatrix(true, true);
  const meshes = [];
  skyline.traverse(o => { if (o.isMesh && o.geometry.getAttribute('position')) meshes.push(o); });
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let top = -Infinity, topX = 0, topZ = 0;
  for (const m of meshes) {
    const p = m.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      a.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (a.y > top) { top = a.y; topX = a.x; topZ = a.z; }
    }
  }
  let area = 0, sx = 0, sz = 0;
  for (const m of meshes) {
    const p = m.geometry.getAttribute('position');
    // build.py writes triangle soup: every 3 vertices are one face.
    for (let i = 0; i + 2 < p.count; i += 3) {
      a.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(p, i + 1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(p, i + 2).applyMatrix4(m.matrixWorld);
      if (Math.min(a.y, b.y, c.y) < top - 0.5) continue;               // roof faces only
      if (Math.hypot(a.x - topX, a.z - topZ) > 200) continue;           // this tower only
      const t = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
      area += t; sx += t * (a.x + b.x + c.x) / 3; sz += t * (a.z + b.z + c.z) / 3;
    }
  }
  return area ? {x: sx / area, z: sz / area, y: top, side: Math.sqrt(area)} : null;
}

// Red field with a centred yellow five-pointed star; the star's outer radius
// is 1/5 of the flag's length. Row 0 is the bottom (DataTexture order).
function flagTexture(width = 480) {
  const height = Math.round(width * 2 / 3), data = new Uint8Array(width * height * 4);
  const cx = width / 2, cy = height / 2, outer = width / 5, inner = outer * 0.382;
  const corners = [];
  for (let i = 0; i < 10; i++) {
    const ang = Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? inner : outer;
    corners.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]);
  }
  const inside = (x, y) => {
    let hit = false;
    for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
      const [xi, yi] = corners[i], [xj, yj] = corners[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const star = inside(x + 0.5, y + 0.5), k = (y * width + x) * 4;
    data[k] = star ? 255 : 218; data[k + 1] = star ? 255 : 37; data[k + 2] = star ? 0 : 29; data[k + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createFlag({scene, skyline, camera = null}) {
  const state = {placed: false, roof: null, length: null, height: null, windFrom: null, windKt: null, yawDeg: null, windObserved: null};
  const status = text => { if ($('flag-status')) $('flag-status').textContent = text; };
  const roof = tallestRoof(skyline);
  if (!roof) { status('Tallest tower not found in the skyline model.'); return {state, group: null, update() {}}; }

  // Preserve the existing pole dimensions. A collision plane above the roof
  // also keeps the fully hanging cloth clear in calm air.
  const MAX_DROOP = 0.7;
  const FLAG_AREA_M2 = 1000, POLE_HEIGHT_M = 110;          // Çamlıca Hill
  const length = Math.sqrt(FLAG_AREA_M2 * 3 / 2), height = length * 2 / 3;
  // Even hanging in calm air the flag clears the roof on a pole this tall.
  const poleHeight = Math.max(POLE_HEIGHT_M, Math.ceil(height + length * Math.sin(MAX_DROOP) + 6));
  const flagAltitude = roof.y + poleHeight - height / 2;   // middle of the flag, metres above ground
  Object.assign(state, {placed: true, flagAltitude: Math.round(flagAltitude), roof: {x: Math.round(roof.x), z: Math.round(roof.z), y: +roof.y.toFixed(1), side: +roof.side.toFixed(1)}, length: +length.toFixed(1), height: +height.toFixed(1)});

  const group = new THREE.Group();
  group.position.set(roof.x, roof.y, roof.z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.8, poleHeight, 12), new THREE.MeshStandardMaterial({color: '#c9ced3', metalness: 0.6, roughness: 0.4}));
  pole.position.y = poleHeight / 2;
  // Subdivided so the surface can bend; the hoist edge sits on the pole, the
  // top edge level with the pole's top.
  // Light polyester (0.2 kg/m², usual for giant flags) and a realistic along-
  // wind drag for a flapping flag (0.15; measured values run ~0.1-0.3). With
  // the solver's defaults (0.3 kg/m², 0.04) nothing held the flag out along the
  // wind and it hung ~22 m low at 11 kt; with these it stays ~97% extended.
  // turbulence 3: the air varies up to ±75% in speed and ±30° in direction --
  // gusty, as at the top of the city's tallest tower. That variation is what
  // makes this model's flag roll; at 1 it settled nearly flat (swing 0.2 m at
  // 13 kt, against ~1.5 m now, still ~97% extended).
  const solver = new Cloth({length, height, top: poleHeight, density: 0.2, tangentialDrag: 0.15, turbulence: 3});
  const cloth = new THREE.PlaneGeometry(length, height, solver.columns - 1, solver.rows - 1);
  const pos = cloth.attributes.position;
  pos.setUsage(THREE.DynamicDrawUsage);
  pos.array.set(solver.positions);
  cloth.computeVertexNormals();
  const flag = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({map: flagTexture(), side: THREE.DoubleSide, roughness: 0.85}));
  flag.frustumCulled = false;
  const turn = new THREE.Group();   // rotates the flag about the pole to face downwind
  turn.add(flag);
  group.add(pole, turn);
  scene.add(group);

  async function refreshWind() {
    try {
      const r = await fetch('/api/rain-map/flights', {cache: 'no-store'});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const w = (await r.json()).wind;
      state.windObserved = w?.observed ?? null;
      // Older responses expose the raw METAR but omit its parsed gust.
      const rawGust = /\b(?:\d{3}|VRB)\d{2,3}G(\d{2,3})KT\b/.exec(w?.raw ?? '');
      const surfaceGust = Number.isFinite(w?.gust_kt) ? w.gust_kt : rawGust ? +rawGust[1] : null;
      const surfaceSpeed = Number.isFinite(w?.speed_kt) ? Math.max(0, w.speed_kt) : 0;
      gustKt = surfaceGust === null ? 0 : windAloft(Math.max(0, surfaceGust), flagAltitude);
      state.gustKt = surfaceGust;
      if (w && Number.isFinite(w.dir)) {
        turn.rotation.y = flagYaw(w.dir);
        windKt = windAloft(surfaceSpeed, flagAltitude);
        Object.assign(state, {windFrom: w.dir, windKt: w.speed_kt, flagKt: +windKt.toFixed(1), yawDeg: Math.round(turn.rotation.y * 180 / Math.PI)});
        status(`Wind from ${w.dir}° at ${w.speed_kt} kt at ground level (Tân Sơn Nhất METAR${w.observed ? ', ' + w.observed.slice(11, 16) + ' UTC' : ''}); about ${Math.round(windKt)} kt estimated at the flag, ${Math.round(flagAltitude)} m up.`);
      } else {
        Object.assign(state, {windFrom: null, windKt: w?.speed_kt ?? null});
        windKt = windAloft(surfaceSpeed, flagAltitude);
        status(w ? `Wind variable or calm (${w.speed_kt ?? '?'} kt); flag left as it was.` : 'Wind unavailable; flag left as it was.');
      }
    } catch (e) {
      status(`Wind unavailable (${e.message}); flag left as it was.`);
    }
  }
  let windKt = 0, gustKt = 0, shownKt = 0, shownGustKt = 0;
  refreshWind();
  setInterval(refreshWind, WIND_REFRESH_MS);

  const STEP = solver.dt, MAX_STEPS = 6, KNOTS_TO_MPS = 0.514444;
  let lastMs = null, accumulator = 0;
  const cameraPosition = new THREE.Vector3(), flagPosition = new THREE.Vector3();
  // The optional camera is preferred. Old callers also acquire the actual
  // render camera automatically, without changing update(nowMs).
  let renderCamera = camera;
  flag.onBeforeRender = (_renderer, _scene, activeCamera) => { renderCamera = camera || activeCamera; };
  const resetClock = () => { lastMs = null; accumulator = 0; };
  document.addEventListener('visibilitychange', resetClock);
  const toggle = $('flag');
  if (toggle) {
    group.visible = toggle.checked;
    toggle.onchange = () => { group.visible = toggle.checked; resetClock(); };
  }
  function update(nowMs) {
    let visible = flag.visible && turn.visible;
    for (let parent = group; parent; parent = parent.parent) visible = visible && parent.visible;
    let distant = false;
    if (renderCamera) {
      renderCamera.getWorldPosition(cameraPosition);
      group.updateWorldMatrix(true, false);
      flagPosition.set(0, poleHeight - height / 2, 0).applyMatrix4(group.matrixWorld);
      distant = cameraPosition.distanceToSquared(flagPosition) > 20000 ** 2;
    }
    if (!visible || document.hidden || distant || !Number.isFinite(nowMs)) {
      resetClock(); return;
    }
    if (lastMs === null) { lastMs = nowMs; return; }
    const elapsed = (nowMs - lastMs) / 1000;
    lastMs = nowMs;
    // Background tabs and debugger stops never create catch-up work.
    if (elapsed < 0 || elapsed > 0.25) { accumulator = 0; return; }
    accumulator = Math.min(accumulator + elapsed, MAX_STEPS * STEP);
    let steps = 0;
    while (accumulator + 1e-10 >= STEP && steps < MAX_STEPS) {
      const ease = 1 - Math.exp(-STEP / 3);
      shownKt += (windKt - shownKt) * ease;
      shownGustKt += (Math.max(windKt, gustKt) - shownGustKt) * ease;
      solver.step(shownKt * KNOTS_TO_MPS, shownGustKt * KNOTS_TO_MPS);
      accumulator -= STEP;
      steps++;
    }
    if (steps) {
      pos.array.set(solver.positions);
      pos.needsUpdate = true;
      cloth.computeVertexNormals();
    }
  }
  return {state, group, update};
}
