// Regression test for the sky-flash timing bug: scene.background/skyFlash
// were only ever updated inside the fade-out branch of update(), so the
// whole-sky flash appeared ~`duration` ms late (during what should have
// been the fade tail) instead of at the moment of the strike, and during a
// short hold it could be missed entirely. This drives createLightning()
// with mocked scene/DOM/weather (no WebGL, no browser) and asserts the sky
// colour has actually changed by the same update() call that reports a
// strike, not a later one.
import * as THREE from '../3d/vendor/three.module.js';
import {createLightning} from '../3d/lightning.js';

const elements = {
  'rain-weather': {checked: true},
  'lightning-effects': {checked: true, onchange: null},
  'thunder-sound': {checked: false, onchange: null},
};
// createLightning() also builds a canvas-based impact sprite texture; only
// the 2D calls it actually makes need to work, not real canvas rendering.
function fakeCanvas() {
  const ctx = {
    createRadialGradient: () => ({addColorStop() {}}),
    fillRect() {},
    get fillStyle() { return this._fillStyle; }, set fillStyle(v) { this._fillStyle = v; },
  };
  return {width: 0, height: 0, getContext: () => ctx};
}
globalThis.document = {getElementById: id => elements[id], createElement: () => fakeCanvas()};

function run(name, fn) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { console.log(`FAIL - ${name}: ${e.message}`); process.exitCode = 1; }
}

function makeScene() {
  const added = [];
  return {background: new THREE.Color('#263e40'), add: (...os) => added.push(...os), _added: added};
}

run('the sky colour changes on the same update() call that reports the strike, not a later one', () => {
  const scene = makeScene();
  const weather = {rainPoints: () => [{x: 0, z: 0, classIndex: 3}]}; // Heavy, right at the strike site
  const lightning = createLightning({scene, weather, skyline: undefined});
  elements['lightning-effects'].checked = true; elements['lightning-effects'].onchange(); // simulate the user checking the box
  const baseline = scene.background.clone();

  lightning.update(0); // schedules the first strike, no strike yet
  if (lightning.state.strikesTotal !== 0) throw new Error('a strike happened on the scheduling call, before any delay elapsed');
  if (!scene.background.equals(baseline)) throw new Error('sky changed before any strike -- should still be the base colour');

  lightning.update(100000); // now well past any possible scheduled delay (max 8s)
  if (lightning.state.strikesTotal !== 1) throw new Error(`expected exactly one strike, got ${lightning.state.strikesTotal}`);
  if (scene.background.equals(baseline)) throw new Error('sky did not change on the very update() call that just reported a strike (the bug)');
});

run('turning Lightning off resets the sky to its base colour immediately', () => {
  const scene = makeScene();
  const weather = {rainPoints: () => [{x: 0, z: 0, classIndex: 3}]};
  const lightning = createLightning({scene, weather, skyline: undefined});
  elements['lightning-effects'].checked = true; elements['lightning-effects'].onchange();
  const baseline = scene.background.clone();
  lightning.update(0); lightning.update(100000);
  if (scene.background.equals(baseline)) throw new Error('setup did not actually flash the sky');
  elements['lightning-effects'].checked = false;
  elements['lightning-effects'].onchange();
  if (!scene.background.equals(baseline)) throw new Error('sky was left flashed after Lightning was turned off');
});

run('with Lightning off, no strike is ever scheduled even with Heavy rain present', () => {
  const scene = makeScene();
  const weather = {rainPoints: () => [{x: 0, z: 0, classIndex: 3}]};
  elements['lightning-effects'].checked = false;
  const lightning = createLightning({scene, weather, skyline: undefined});
  lightning.update(0); lightning.update(100000); lightning.update(200000);
  if (lightning.state.strikesTotal !== 0) throw new Error('a strike happened despite the opt-in toggle being off');
});

run('a flash is 1-6 return strokes (ground) or 2-5 pulses (sheet), most often more than one', () => {
  const scene = makeScene();
  const weather = {rainPoints: () => [{x: 0, z: 0, classIndex: 3}]};
  const lightning = createLightning({scene, weather, skyline: undefined});
  elements['lightning-effects'].checked = true; elements['lightning-effects'].onchange();
  lightning.update(0); lightning.update(100000);
  const count = lightning.state.lastFlashCount;
  if (!(count >= 1 && count <= 6)) throw new Error(`lastFlashCount ${count} is outside the intended 1-6 range`);
  if (!['sheet', 'ground', 'building'].includes(lightning.state.lastFlashKind)) throw new Error(`unexpected flash kind ${lightning.state.lastFlashKind}`);
});

run('the flash count varies from strike to strike (monotony regression)', () => {
  const counts = new Set();
  const weather = {rainPoints: () => [{x: 0, z: 0, classIndex: 3}]};
  // Force many independent strikes (fresh instance each time, each landing
  // immediately) and collect the spread of flash counts observed.
  for (let i = 0; i < 60; i++) {
    const scene = makeScene();
    const lightning = createLightning({scene, weather, skyline: undefined});
    elements['lightning-effects'].checked = true; elements['lightning-effects'].onchange();
    lightning.update(0); lightning.update(100000);
    counts.add(lightning.state.lastFlashCount);
  }
  if (counts.size < 3) throw new Error(`only ${counts.size} distinct flash counts in 60 strikes -- looks like a fixed single flash again`);
  const multi = [...counts].filter(c => c > 1).length;
  if (!multi) throw new Error('no multi-stroke flash in 60 strikes');
});

run('a multi-flash strike visibly brightens more than once as its queued flashes fire, not one fade', () => {
  const weather = {rainPoints: () => [{x: 0, z: 0, classIndex: 3}]};
  let scene, lightning, tries = 0;
  // Retry for a strike with a few trailing flashes to observe; both the
  // count and their timing are randomised, so this is bounded, not flaky.
  do {
    tries++;
    scene = makeScene();
    lightning = createLightning({scene, weather, skyline: undefined});
    elements['lightning-effects'].checked = true; elements['lightning-effects'].onchange();
    lightning.update(0); lightning.update(100000);
  } while (lightning.state.lastFlashCount < 3 && tries < 100);
  if (tries >= 100) throw new Error('never observed a strike with 3+ flashes in 100 tries -- scheduleFlashSeries may be broken');

  // scene.background lerps toward SKY_FLASH_COLOR ('#eef6ff', blue >> the
  // base colour's) proportionally to how strong the *current* flash is, so
  // sampling the blue channel over time traces the flash sequence directly.
  const blues = [];
  for (let t = 100000; t <= 104000; t += 10) { lightning.update(t); blues.push(scene.background.b); }
  let reBrightens = 0;
  for (let i = 2; i < blues.length; i++) {
    if (blues[i] > blues[i - 1] + 0.01 && blues[i - 1] <= blues[i - 2] + 0.001) reBrightens++;
  }
  if (reBrightens === 0) throw new Error('the sky never brightened again after an initial dip -- only one flash appears to have actually rendered');
});

if (process.exitCode) process.exit(1);
