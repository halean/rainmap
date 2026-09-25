// node --loader ./tests/three-loader.mjs tests/flag_cloth.mjs
import assert from 'node:assert/strict';
import * as THREE from '../3d/vendor/three.module.js';
import {Cloth, createFlag, tallestRoof} from '../3d/flag.js';

const events = new EventTarget(), toggle = {checked: true}, status = {};
globalThis.document = {hidden: false, addEventListener: events.addEventListener.bind(events),
  getElementById: id => id === 'flag' ? toggle : id === 'flag-status' ? status : null};
globalThis.fetch = async () => ({ok: true, json: async () => ({wind: {
  dir: 270, speed_kt: 9, raw: 'METAR VVTS 251200Z 27009G14KT', observed: '2026-09-25T12:00:00Z',
}})});
// Do not leave the ten-minute refresh interval running in Node.
globalThis.setInterval = () => 0;
const scene = new THREE.Scene(), skyline = new THREE.Group();
const roof = new THREE.Mesh(new THREE.PlaneGeometry(96.9, 96.9).rotateX(-Math.PI / 2).toNonIndexed());
roof.position.y = 459; skyline.add(roof); scene.add(skyline);
const camera = new THREE.PerspectiveCamera(); camera.position.set(100, 530, 100);
assert(Math.abs(tallestRoof(skyline).side - 96.9) < 1e-4);
assert.equal(createFlag({scene, skyline: null}).update(), undefined);
const flag = createFlag({scene, skyline, camera});
await new Promise(resolve => setImmediate(resolve));
assert.equal(flag.state.gustKt, 14, 'gust parsed from existing API raw METAR');
const geometry = flag.group.children[1].children[0].geometry;
const attribute = geometry.attributes.position;
let now = 0;
const tick = (ms = 1000 / 60) => flag.update(now += ms);
const snapshot = () => Array.from(attribute.array);
const same = a => assert.deepEqual(snapshot(), a);
for (let i = 0; i < 60; i++) tick();
let before = snapshot();
flag.group.visible = false; tick(1000); same(before);
flag.group.visible = true; tick(); same(before); tick(); assert.notDeepEqual(snapshot(), before);
before = snapshot(); camera.position.x = 50000; tick(); same(before);
camera.position.x = 100; tick(); same(before); tick(); assert.notDeepEqual(snapshot(), before);
before = snapshot(); document.hidden = true; tick(); same(before);
document.hidden = false; events.dispatchEvent(new Event('visibilitychange')); tick(); same(before);
tick(); assert.notDeepEqual(snapshot(), before);
before = snapshot(); tick(60000); same(before); tick(); assert.notDeepEqual(snapshot(), before);
before = snapshot(); scene.visible = false; tick(); same(before); scene.visible = true; tick(); same(before);
// Count fixed steps to verify that short frames accumulate and slow frames cap.
const step = Cloth.prototype.step; let steps = 0;
Cloth.prototype.step = function (...args) { steps++; return step.apply(this, args); };
tick(1); assert.equal(steps, 0); tick(8); assert.equal(steps, 1);
steps = 0; tick(200); assert.equal(steps, 6);
Cloth.prototype.step = step;
assert.equal(attribute, geometry.attributes.position, 'attribute updated in place');
assert(geometry.attributes.normal.array.every(Number.isFinite));
assert(status.textContent.includes('Tân Sơn Nhất METAR'));
console.log('ok - flag integration: gust, camera distance, visibility, accumulator, capped steps, resume, normals');
