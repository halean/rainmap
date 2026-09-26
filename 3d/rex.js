// A schematic exterior model of the Rex Hotel, on the corner of Lê Lợi and
// Nguyễn Huệ. Footprint and heading from the OSM outline (way 39598474); the
// elevations after photographs: shopfronts under a canopy, four floors of
// balconied bays between giant piers, the corner tower with REX HOTEL across
// its top and the golden crown on it, the Rooftop Garden's planters and
// lamps, and its sign behind the crown. See REX.md.
import * as THREE from 'three';
import {builder, extrude, edge, insideOutline, letters, facing, genericReplacer} from './landmark-kit.js';

export const REX = Object.freeze({
  lon: 106.7010558, lat: 10.7754976, yaw: 0.726290,
  outline: [[-0.8, 56.6], [-7.0, 21.4], [-53.9, 5.3], [-39.7, -41.7], [-37.0, -51.2], [-34.5, -54.2], [-30.7, -55.7], [-23.6, -56.4], [-11.4, -56.6], [-10.4, -43.7], [-3.8, -44.3], [9.4, -45.9], [27.3, -48.0], [36.1, -48.6], [40.8, -47.4], [43.3, -44.8], [45.5, -37.5], [46.4, -27.4], [53.5, 45.3], [53.9, 47.0], [53.1, 49.7], [51.2, 51.9], [48.4, 52.9]],
  // Edges facing the streets: Nguyễn Huệ (15-17), the corner (18-21) and
  // Lê Lợi (22).
  frontage: [15, 16, 17, 18, 19, 20, 21, 22],
  nguyenHue: 17, leLoi: 22,
  tower: {at: [52.4, 50.65], width: 8, depth: 9},    // the middle of its front, level with the outline's corner
});

// Heights from the daytime photograph's proportions: a tall shop floor, four
// floors, and the tower rising one storey-height above the roof.
const GROUND = 5.5, STOREY = 4.2, FLOORS = 4, BODY = GROUND + FLOORS * STOREY;   // 22.3 m
const TOWER = BODY + 3.2;

export function createRex({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-rex';
  const [x, z] = project(REX.lon, REX.lat);
  group.position.set(x, 0, z); group.rotation.y = REX.yaw;
  const materials = {
    facade: new THREE.MeshStandardMaterial({color: '#f3e9d6', roughness: 0.9}),
    trim: new THREE.MeshStandardMaterial({color: '#fbf8f1', roughness: 0.85}),
    glass: new THREE.MeshStandardMaterial({color: '#262d33', roughness: 0.3, metalness: 0.25}),
    roof: new THREE.MeshStandardMaterial({color: '#9a958b', roughness: 0.95}),
    green: new THREE.MeshStandardMaterial({color: '#557d3e', roughness: 1}),
    gold: new THREE.MeshStandardMaterial({color: '#d9ad3c', emissive: '#6b4d10', emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.35}),
    letter: new THREE.MeshStandardMaterial({color: '#8a857b', roughness: 0.6, metalness: 0.3}),
    neon: new THREE.MeshStandardMaterial({color: '#ffe07a', emissive: '#ffb400', emissiveIntensity: 1.4, roughness: 0.4}),
    lamp: new THREE.MeshStandardMaterial({color: '#fff4d0', emissive: '#ffe2a0', emissiveIntensity: 1.2, roughness: 0.5}),
    red: new THREE.MeshStandardMaterial({color: '#da251d', emissive: '#5a0a08', emissiveIntensity: 0.3, roughness: 0.7}),
  };
  const {add, box, finish} = builder(materials, 'rex');
  const outline = REX.outline;

  add('facade', extrude(outline, 0, BODY));
  add('roof', extrude(outline, BODY, BODY + 0.4));

  // The corner tower's frame: b faces the intersection, p runs across the
  // tower towards Lê Lợi.
  const n1 = edge(outline, REX.nguyenHue), n2 = edge(outline, REX.leLoi);
  let bu = n1.nu + n2.nu, bv = n1.nv + n2.nv; const bl = Math.hypot(bu, bv); bu /= bl; bv /= bl;
  const pu = -bv, pv = bu, towerYaw = facing(bu, bv);
  const T = (across, out) => [REX.tower.at[0] + pu * across + bu * out, REX.tower.at[1] + pv * across + bv * out];
  const nearTower = ([u, v]) => Math.hypot(u - REX.tower.at[0], v - REX.tower.at[1]) < REX.tower.width * 0.75;

  outline.forEach((_, i) => {
    const e = edge(outline, i), front = REX.frontage.includes(i);
    const at = (t, out) => [e.u0 + e.du * t + e.nu * out, e.v0 + e.dv * t + e.nv * out];
    const put = (key, w, h, d, t, out, y) => { const [qu, qv] = at(t, out); if (!(front && nearTower([qu, qv]))) box(key, w, h, d, qu, y, qv, e.yaw); };
    put('trim', e.len + 0.5, 0.6, 0.9, e.len / 2, 0.3, BODY - 0.2);                  // cornice
    if (!front) {
      const pitch = 5.0, n = Math.floor(e.len / pitch);
      if (n < 1) return;
      const start = (e.len - (n - 1) * pitch) / 2;
      for (let k = 0; k < n; k++) for (let s = 0; s <= FLOORS; s++)
        put('glass', 1.4, 1.7, 0.12, start + k * pitch, 0.06, s === 0 ? 2.2 : GROUND + (s - 1) * STOREY + 2.0);
      return;
    }
    // Shopfronts under a canopy; a white railing round the roof garden.
    put('glass', Math.max(0.5, e.len - 0.6), GROUND - 1.4, 0.14, e.len / 2, 0.08, (GROUND - 1.4) / 2 + 0.2);
    put('trim', e.len + 0.6, 0.3, 1.8, e.len / 2, 0.9, GROUND - 0.3);
    put('trim', e.len, 1.0, 0.15, e.len / 2, -0.2, BODY + 0.9);
    if (e.len < 4) return;
    // Bays between giant piers, each with a window group over a white
    // balustraded balcony on every floor.
    const bays = Math.max(1, Math.round(e.len / 5.2)), bw = e.len / bays;
    for (let k = 0; k <= bays; k++) put('trim', 0.9, BODY - GROUND + 0.3, 0.5, k * bw, 0.25, (BODY + GROUND + 0.3) / 2);
    for (let k = 0; k < bays; k++) for (let s = 0; s < FLOORS; s++) {
      const y = GROUND + s * STOREY, t = (k + 0.5) * bw;
      put('glass', bw - 2.0, 2.2, 0.12, t, 0.06, y + 1.1 + 1.1);
      put('trim', bw - 1.3, 0.2, 0.8, t, 0.4, y + 0.9);
      put('trim', bw - 1.3, 1.0, 0.12, t, 0.75, y + 1.5);
    }
    // Planters and lamps along the roof edge.
    for (let t = 3; t < e.len - 2; t += 7) {
      const [gu, gv] = at(t, -1.3);
      if (nearTower([gu, gv]) || !insideOutline([gu, gv], outline)) continue;
      box('green', 2.4, 0.9, 1.0, gu, BODY + 0.85, gv, e.yaw);
      add('green', new THREE.SphereGeometry(0.9, 8, 6), gu, BODY + 1.8, gv);
      const [lu, lv] = at(t + 3.5, -0.6);
      add('trim', new THREE.CylinderGeometry(0.06, 0.08, 2.8, 6), lu, BODY + 1.8, lv);
      add('lamp', new THREE.SphereGeometry(0.22, 8, 6), lu, BODY + 3.3, lv);
    }
  });

  // The corner tower.
  const {width: W, depth: D} = REX.tower;
  add('facade', new THREE.BoxGeometry(W, TOWER, D), ...xyz(T(0, -D / 2), TOWER / 2), 0, towerYaw);
  const onFace = (key, geometry, across, y, out = 0) => add(key, geometry, ...xyz(T(across, out), y), 0, towerYaw);
  onFace('glass', new THREE.BoxGeometry(W - 1.5, GROUND - 1.2, 0.14), 0, (GROUND - 1.2) / 2 + 0.2, 0.07);
  onFace('trim', new THREE.BoxGeometry(W + 0.4, 0.3, 1.8), 0, GROUND - 0.3, 0.9);
  for (const s of [-1, 1]) onFace('trim', new THREE.BoxGeometry(1.4, TOWER - GROUND, 0.5), s * (W / 2 - 0.7), (TOWER + GROUND) / 2, 0.25);
  for (let f = 0; f < FLOORS; f++) {
    const y = GROUND + f * STOREY;
    for (const a of [-1.8, -0.6, 0.6, 1.8]) onFace('glass', new THREE.BoxGeometry(0.9, 2.2, 0.12), a, y + 2.2, 0.06);
    for (const a of [-1.2, 0, 1.2]) onFace('trim', new THREE.BoxGeometry(0.25, 2.4, 0.3), a, y + 2.2, 0.15);
    onFace('trim', new THREE.BoxGeometry(5.0, 0.9, 0.15), 0, y + 1.5, 0.35);
    for (const s of [-1, 1]) for (const dy of [1.6, 2.3]) {                            // portholes on the piers
      const c = new THREE.CircleGeometry(0.2, 10);
      onFace('glass', c, s * (W / 2 - 0.7), y + dy, 0.52);
    }
  }
  onFace('letter', letters('REX HOTEL', {h: 1.1, w: 0.62, gap: 0.22, stroke: 0.2}), 0, BODY + 0.9, 0.12);

  // The crown on the tower, and the flag behind it.
  const [ku, kv] = T(0, -2.8);
  add('trim', new THREE.CylinderGeometry(1.3, 1.45, 0.8, 16), ku, TOWER + 0.4, kv);
  add('gold', new THREE.CylinderGeometry(1.65, 1.45, 1.3, 20), ku, TOWER + 1.45, kv);
  for (let j = 0; j < 8; j++) {
    const a = j * Math.PI / 4;
    add('red', new THREE.SphereGeometry(0.16, 6, 4), ku + Math.cos(a) * 1.58, TOWER + 1.45, kv + Math.sin(a) * 1.58);
  }
  add('gold', new THREE.SphereGeometry(1.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), ku, TOWER + 2.1, kv);
  add('gold', new THREE.SphereGeometry(0.35, 10, 6), ku, TOWER + 3.9, kv);
  add('gold', new THREE.ConeGeometry(0.12, 1.0, 6), ku, TOWER + 4.7, kv);
  const [fu, fv] = T(0, -6.5);
  add('trim', new THREE.CylinderGeometry(0.07, 0.09, 7, 6), fu, TOWER + 3.5, fv);

  // The Rooftop Garden's sign behind the crown, over the Nguyễn Huệ side:
  // REX HOTEL in lights over two lines of smaller lettering.
  const [su, sv] = T(-4, -10);
  if (!insideOutline([su, sv], outline)) throw new Error('rooftop sign outside the footprint');
  const signAt = (key, geometry, across, y, out = 0) => add(key, geometry, ...xyz(T(-4 + across, -10 + out), y), 0, towerYaw);
  for (const s of [-1, 1]) signAt('trim', new THREE.BoxGeometry(0.2, 4.2, 0.2), s * 4.2, BODY + 2.1);
  signAt('trim', new THREE.BoxGeometry(9, 0.2, 0.2), 0, BODY + 4.3);
  signAt('trim', new THREE.BoxGeometry(9, 0.2, 0.2), 0, BODY + 1.4);
  signAt('neon', letters('REX HOTEL', {h: 1.0, stroke: 0.16}), 0, BODY + 3.05, 0.12);
  signAt('lamp', new THREE.BoxGeometry(7.2, 0.35, 0.08), 0, BODY + 2.5, 0.12);
  signAt('lamp', new THREE.BoxGeometry(6.0, 0.3, 0.08), 0, BODY + 1.85, 0.12);

  // The garden's pergola over the terrace.
  for (let gu = 24; gu <= 44; gu += 5) for (let gv = 18; gv <= 36; gv += 6)
    if (insideOutline([gu, gv], outline)) box('trim', 0.3, 3.2, 0.3, gu, BODY + 2.0, gv);
  for (let gv = 18; gv <= 36; gv += 3) box('trim', 21, 0.2, 0.25, 34, BODY + 3.6, gv);

  const triangles = finish(group);
  scene.add(group);
  group.updateMatrixWorld(true);
  const flags = [{top: group.localToWorld(new THREE.Vector3(...xyz(T(0, -6.5), TOWER + 7))), length: 2.4}];
  const replaceGeneric = genericReplacer(group, outline, {flag: 'rexReplaced', top: 60});
  const view = {target: group.localToWorld(new THREE.Vector3(...xyz(T(0, 0), 14))), eye: group.localToWorld(new THREE.Vector3(...xyz(T(0, 110), 45)))};
  const state = {name: 'Rex Hotel', lon: REX.lon, lat: REX.lat, height: BODY, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, flags, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}

// [u, v] and a height -> the [x, y, z] builder.add() takes.
function xyz([u, v], y) { return [u, y, v]; }
