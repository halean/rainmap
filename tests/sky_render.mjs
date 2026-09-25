// Wiring test for 3d/sky-render.js: given a real clock time, does it show
// the right body (sun by day, moon by night), position it plausibly, and
// leave the other one invisible? Uses a mocked scene/lights, no document --
// unlike lightning.js's impact sprite, sky-render.js's textures are built
// with THREE.DataTexture (see dataTexture() in both files), so no canvas
// stand-in is needed here at all.
import * as THREE from '../3d/vendor/three.module.js';
import { createSky } from '../3d/sky-render.js';

function run(name, fn) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { console.log(`FAIL - ${name}: ${e.message}`); process.exitCode = 1; }
}

function makeScene() {
  const added = [];
  return { add: (...os) => added.push(...os), _added: added };
}

const manifest = { originLonLat: [106.7009, 10.7769] };
const noonICT = (y, m, d) => new Date(Date.UTC(y, m, d, 5, 0)); // 12:00 ICT
const midnightICT = (y, m, d) => new Date(Date.UTC(y, m, d, 17, 0)); // 00:00 ICT next day

run('the sun sprite and the moon sprite are both added to the scene', () => {
  const scene = makeScene();
  createSky({ scene, manifest, now: noonICT(2026, 8, 24) });
  if (!scene._added.some(o => o.isSprite)) throw new Error('no sprite was added to the scene');
  if (scene._added.filter(o => o.isSprite).length !== 2) throw new Error('expected exactly two sprites (sun, moon)');
});

run('at local solar noon, the sun is shown and the moon is hidden', () => {
  const scene = makeScene();
  const sky = createSky({ scene, manifest, now: noonICT(2026, 8, 24) });
  if (sky.state.body !== 'sun') throw new Error(`expected body='sun', got '${sky.state.body}'`);
  if (sky.state.altitudeDeg < 60) throw new Error(`expected a high midday sun, got altitude ${sky.state.altitudeDeg}`);
  const [sun, moon] = scene._added;
  if (sun.material.opacity <= 0) throw new Error('sun sprite is invisible at solar noon');
  if (moon.material.opacity !== 0) throw new Error('moon sprite should be fully hidden while the sun is up');
});

run('around local midnight near the mid-autumn full moon, the moon is shown and the sun is hidden', () => {
  const scene = makeScene();
  const sky = createSky({ scene, manifest, now: midnightICT(2026, 8, 25) }); // night of 2026-09-25/26, near full moon
  if (sky.state.body !== 'moon') throw new Error(`expected body='moon', got '${sky.state.body}' (altitude ${sky.state.altitudeDeg})`);
  const [sun, moon] = scene._added;
  if (sun.material.opacity !== 0) throw new Error('sun sprite should be fully hidden at midnight');
  if (moon.material.opacity <= 0) throw new Error('moon sprite is invisible when it should be up');
});

run('the sun sprite has no fully-transparent hard edge -- it stays soft (hazy) to its texture border', () => {
  const scene = makeScene();
  createSky({ scene, manifest, now: noonICT(2026, 8, 24) });
  const [sun] = scene._added;
  const data = sun.material.map.image.data, w = sun.material.map.image.width, h = sun.material.map.image.height;
  const edgeAlpha = data[((h / 2 | 0) * w + (w - 1)) * 4 + 3]; // right-edge midline pixel
  const centerAlpha = data[((h / 2 | 0) * w + (w / 2 | 0)) * 4 + 3];
  if (centerAlpha < 200) throw new Error('sun texture centre is not bright/opaque');
  if (edgeAlpha === 0) throw new Error('sun texture drops straight to zero at the edge -- that is a hard edge, not haze');
});

run("the moon sprite is a hard-edged disc -- fully transparent just outside its radius, unlike the sun's haze", () => {
  const scene = makeScene();
  createSky({ scene, manifest, now: midnightICT(2026, 8, 25) });
  const [, moon] = scene._added;
  const data = moon.material.map.image.data, w = moon.material.map.image.width, h = moon.material.map.image.height;
  const corner = data[(0 * w + 0) * 4 + 3]; // corner of the square texture, outside the unit disc
  if (corner !== 0) throw new Error(`moon texture corner should be fully transparent (outside the disc), got alpha ${corner}`);
});

run('near the mid-autumn full moon the moon texture is almost entirely lit, not a thin crescent', () => {
  const scene = makeScene();
  createSky({ scene, manifest, now: midnightICT(2026, 8, 25) });
  const [, moon] = scene._added;
  if (moon.state) throw new Error('unexpected'); // guard against accidental future API confusion
  const data = moon.material.map.image.data, w = moon.material.map.image.width, h = moon.material.map.image.height;
  let lit = 0, total = 0;
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    if (a === 0) continue; // outside the disc entirely
    total++;
    if (data[i * 4] > 20) lit++; // non-black -> lit
  }
  const litFraction = lit / total;
  if (litFraction < 0.85) throw new Error(`expected a near-full moon (>=85% of the disc lit), got ${(litFraction * 100).toFixed(1)}%`);
});

run('a directional light, when supplied, is repositioned toward whichever body is up', () => {
  const scene = makeScene();
  const directionalLight = { position: new THREE.Vector3(), intensity: 1, color: new THREE.Color() };
  const hemisphereLight = { intensity: 1 };
  const before = directionalLight.position.clone();
  createSky({ scene, manifest, directionalLight, hemisphereLight, now: noonICT(2026, 8, 24) });
  if (directionalLight.position.equals(before)) throw new Error('directional light position was never updated');
  if (directionalLight.intensity <= 0) throw new Error('directional light intensity should be positive during the day');
});

run('night lighting is dimmer than midday lighting, when a directional light is supplied', () => {
  const dayLight = { position: new THREE.Vector3(), intensity: 1, color: new THREE.Color() };
  createSky({ scene: makeScene(), manifest, directionalLight: dayLight, now: noonICT(2026, 8, 24) });
  const nightLight = { position: new THREE.Vector3(), intensity: 1, color: new THREE.Color() };
  createSky({ scene: makeScene(), manifest, directionalLight: nightLight, now: midnightICT(2026, 8, 25) });
  if (nightLight.intensity >= dayLight.intensity) {
    throw new Error(`expected night intensity (${nightLight.intensity}) < day intensity (${dayLight.intensity})`);
  }
});

run('update() can be called repeatedly with advancing time without throwing', () => {
  const scene = makeScene();
  const sky = createSky({ scene, manifest, now: noonICT(2026, 8, 24) });
  const start = noonICT(2026, 8, 24).getTime();
  for (let h = 0; h < 48; h++) sky.update(start + h * 3600000);
});

run('the displayed disc stays near the horizon even when the real sun is near zenith (the "too high" fix)', () => {
  const scene = makeScene();
  const sky = createSky({ scene, manifest, now: noonICT(2026, 8, 24) });
  const [sunSprite] = scene._added;
  // state.altitudeDeg reports the real astronomy (should be high at noon);
  // the sprite's own rendered position should not be -- that's the point.
  if (sky.state.altitudeDeg < 60) throw new Error(`expected a true midday altitude, got ${sky.state.altitudeDeg}`);
  const horizontal = Math.hypot(sunSprite.position.x, sunSprite.position.z);
  const renderedAltitudeDeg = Math.atan2(sunSprite.position.y, horizontal) * 180 / Math.PI;
  if (renderedAltitudeDeg > 15) throw new Error(`sprite rendered too high: ${renderedAltitudeDeg}deg (expected capped near the horizon)`);
});

run('a low real altitude is shown at its true position, not artificially raised', () => {
  const scene = makeScene();
  // An hour after sunrise near the equinox: a real, low, positive altitude.
  const sky = createSky({ scene, manifest, now: new Date(Date.UTC(2026, 8, 24, 23, 0)) }); // 06:00 ICT
  const [sunSprite] = scene._added;
  if (sky.state.body !== 'sun') throw new Error(`expected the sun shortly after sunrise, got '${sky.state.body}'`);
  const horizontal = Math.hypot(sunSprite.position.x, sunSprite.position.z);
  const renderedAltitudeDeg = Math.atan2(sunSprite.position.y, horizontal) * 180 / Math.PI;
  if (Math.abs(renderedAltitudeDeg - sky.state.altitudeDeg) > 0.5) {
    throw new Error(`a low real altitude should pass through uncapped: real=${sky.state.altitudeDeg}, rendered=${renderedAltitudeDeg}`);
  }
});

run('registerWater() finds a mesh named "water" in a loaded group and leaves everything else alone', () => {
  const scene = makeScene();
  const sky = createSky({ scene, manifest, now: noonICT(2026, 8, 24) });
  const waterMaterial = {};
  const buildingMaterial = {};
  const group = {
    traverse(visit) {
      visit({ isMesh: true, name: 'water', material: waterMaterial, userData: {} });
      visit({ isMesh: true, name: 'building', material: buildingMaterial, userData: {} });
      visit({ isMesh: false, name: 'water', material: {}, userData: {} }); // not a mesh -- must be skipped
    },
  };
  sky.registerWater(group);
  if (typeof waterMaterial.onBeforeCompile !== 'function') throw new Error('water material was not given a glint shader');
  if (waterMaterial.needsUpdate !== true) throw new Error('water material.needsUpdate was not set after patching its shader');
  if (buildingMaterial.onBeforeCompile) throw new Error('a non-water mesh was given the glint shader');
});

run('registerWater() is idempotent -- calling it again on the same mesh does not reapply the patch', () => {
  const sky = createSky({ scene: makeScene(), manifest, now: noonICT(2026, 8, 24) });
  let applyCount = 0;
  const waterMesh = {
    isMesh: true, name: 'water', userData: {},
    get material() { return this._material; },
    set material(m) { this._material = new Proxy(m, { set: (t, k, v) => { if (k === 'onBeforeCompile') applyCount++; t[k] = v; return true; } }); },
  };
  waterMesh.material = {};
  const group = { traverse: (visit) => visit(waterMesh) };
  sky.registerWater(group);
  sky.registerWater(group);
  if (applyCount !== 1) throw new Error(`expected the glint shader to be applied exactly once, got ${applyCount}`);
});

run("registerWater()'s shader patch shares live uniform references with update(), so the glint tracks whichever body is up", () => {
  const sky = createSky({ scene: makeScene(), manifest, now: noonICT(2026, 8, 24) });
  const waterMaterial = {};
  sky.registerWater({ traverse: (visit) => visit({ isMesh: true, name: 'water', material: waterMaterial, userData: {} }) });

  const shader = { uniforms: {}, vertexShader: '#include <common>\nx\n#include <begin_vertex>\ny', fragmentShader: '#include <common>\nz\n#include <dithering_fragment>' };
  waterMaterial.onBeforeCompile(shader);
  for (const key of ['uGlintDir', 'uGlintColor', 'uGlintTime', 'uGlintIntensity']) {
    if (!(key in shader.uniforms)) throw new Error(`shader is missing uniform ${key}`);
  }
  if (!shader.vertexShader.includes('vGlintWorldPos')) throw new Error('vertex shader was not patched with the world-position varying');
  if (!shader.fragmentShader.includes('uGlintIntensity')) throw new Error('fragment shader was not patched with the glint term');

  sky.update(noonICT(2026, 8, 24)); // sun up -- some glint expected
  const dayIntensity = shader.uniforms.uGlintIntensity.value;
  if (!(dayIntensity > 0)) throw new Error(`expected positive glint intensity while the sun is up, got ${dayIntensity}`);

  sky.update(midnightICT(2026, 8, 20)); // well off the full-moon date, but still night either way
  const nightBody = sky.state.body;
  const nightIntensity = shader.uniforms.uGlintIntensity.value;
  if (nightBody === 'none' && nightIntensity !== 0) throw new Error(`expected zero glint with neither body up, got ${nightIntensity}`);
});

run('the sun sits on the right side of the sky: east in the morning, west in the evening, south at a September noon', () => {
  // sky.js gives azimuth from SOUTH toward west (suncalc); the scene is +X
  // east, +Z south. Reading it as a compass bearing rotated everything 180 deg.
  const at = (hourICT) => {
    const scene = makeScene();
    const light = { position: new THREE.Vector3(), intensity: 1, color: new THREE.Color() };
    const sky = createSky({ scene, manifest, directionalLight: light, now: new Date(Date.UTC(2026, 8, 25, hourICT - 7, 0)) });
    return { sky, sprite: scene._added[0].position, light: light.position };
  };
  const morning = at(8), evening = at(17), noon = at(12);
  if (!(morning.sprite.x > 0 && morning.light.x > 0)) throw new Error(`08:00 sun should be east (+X), got sprite x=${morning.sprite.x}`);
  if (!(evening.sprite.x < 0 && evening.light.x < 0)) throw new Error(`17:00 sun should be west (-X), got sprite x=${evening.sprite.x}`);
  if (!(noon.sprite.z > 0)) throw new Error(`a late-September noon sun at 10.8N should be south (+Z), got z=${noon.sprite.z}`);
  if (Math.abs(evening.sky.state.azimuthDeg - 270) > 15) throw new Error(`17:00 compass bearing should be near 270 (west), got ${evening.sky.state.azimuthDeg}`);
});

run('registerBuildings() gives window glass to building meshes only, once, and shares the live glint uniforms', () => {
  const sky = createSky({ scene: makeScene(), manifest, now: noonICT(2026, 8, 24) });
  const mats = { building: {}, tagged: {}, skyline: {}, water: {}, street: {} };
  const group = {
    traverse(visit) {
      visit({ isMesh: true, name: 'building', material: mats.building, userData: {} });
      visit({ isMesh: true, name: 'building-tagged', material: mats.tagged, userData: {} });
      visit({ isMesh: true, name: 'building-skyline__0_0__building-tagged', material: mats.skyline, userData: {} });
      visit({ isMesh: true, name: 'water', material: mats.water, userData: {} });
      visit({ isMesh: true, name: 'street', material: mats.street, userData: {} });
    },
  };
  sky.registerBuildings(group);
  for (const k of ['building', 'tagged', 'skyline']) if (typeof mats[k].onBeforeCompile !== 'function') throw new Error(`${k} was not given window glass`);
  for (const k of ['water', 'street']) if (mats[k].onBeforeCompile) throw new Error(`${k} should not get window glass`);

  const compile = (m) => {
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <dithering_fragment>' };
    m.onBeforeCompile(shader); return shader;
  };
  const a = compile(mats.building), b = compile(mats.skyline);
  if (a.uniforms.uGlintDir !== b.uniforms.uGlintDir) throw new Error('building materials do not share the live glint direction');
  if (!(b.uniforms.uGlassBias.value > a.uniforms.uGlassBias.value)) throw new Error('skyline towers should lean more toward curtain-wall glass than ordinary buildings');
  if (!a.fragmentShader.includes('fwidth')) throw new Error('window grid is not distance-filtered (would moire at city scale)');

  const again = { isMesh: true, name: 'building', material: mats.building, userData: { glassApplied: true } };
  const before = mats.building.onBeforeCompile;
  sky.registerBuildings({ traverse: (visit) => visit(again) });
  if (mats.building.onBeforeCompile !== before) throw new Error('registerBuildings() reapplied the patch');
});

if (process.exitCode) process.exit(1);
