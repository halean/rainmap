// No packages, DOM, or three.js (the loader only makes Node treat 3d/*.js as ES modules): node --loader ./tests/three-loader.mjs tests/cloth.mjs
import assert from 'node:assert/strict';
import {Cloth} from '../3d/cloth.js';

function check(c) {
  assert(c.positions.every(Number.isFinite), 'finite positions');
  assert(c.previous.every(Number.isFinite), 'finite Verlet history');
  for (let r = 0; r < c.rows; r++) for (let col = 0; col < c.columns; col++) {
    const k = (r * c.columns + col) * 3;
    assert(c.positions[k + 1] >= c.floor, 'roof clearance');
    if (!col) {
      assert.equal(c.positions[k], 0, 'pinned hoist x');
      assert.equal(c.positions[k + 2], 0, 'pinned hoist z');
      assert(Math.abs(c.positions[k + 1] - (c.top - r * c.height / (c.rows - 1))) < 1e-5, 'pinned hoist y');
    } else {
      assert(c.positions[k] >= c.poleRadius - 1e-6, 'downstream of pole');
      const distance = Math.hypot(c.positions[k], c.positions[k + 1] - (c.top - r * c.height / (c.rows - 1)), c.positions[k + 2]);
      assert(distance < col * c.length / (c.columns - 1) * 1.02, 'bounded stretch');
    }
  }
}
function meanFly(c, axis) {
  let sum = 0;
  for (let r = 0; r < c.rows; r++) sum += c.positions[(r * c.columns + c.columns - 1) * 3 + axis];
  return sum / c.rows;
}
function simulate(wind, gust = wind, options = {}) {
  const c = new Cloth(options);
  for (let i = 0; i < 3600; i++) {
    c.step(typeof wind === 'function' ? wind(i) : wind, gust);
    if (i % 120 === 0) check(c);
  }
  check(c);
  return c;
}
const windy = simulate(10);
assert(meanFly(windy, 0) > 0.5 * windy.length, 'free end streams downwind at 10 m/s');
const calm = simulate(0);
assert(meanFly(calm, 1) < calm.top - calm.height, 'free end hangs below the hoist midpoint');
assert(calm.positions[(calm.columns - 1) * 3 + 1] < calm.top - 10, 'top fly corner actually falls');
for (const knots of [5, 25, 40]) simulate(knots * 0.514444, 40 * 0.514444);
simulate(i => i % 480 < 240 ? 0 : 40 * 0.514444, 40 * 0.514444);
// Direct relative-air test: a cloth translating with the air sees zero drag.
const moving = new Cloth({turbulence: 0});
for (let k = 0; k < moving.positions.length; k += 3) moving.previous[k] -= 10 * moving.dt;
moving.step(10);
assert(Math.max(...moving.forces.map(Math.abs)) < 0.002, 'drag uses cloth velocity');
assert.throws(() => moving.step(NaN), RangeError);
console.log(`ok - 30 s calm, steady wind, 0–40 kt gusts, collisions, pins, relative drag (10 m/s fly x=${meanFly(windy, 0).toFixed(1)} m)`);
