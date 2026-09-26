// A schematic exterior model of the State Bank of Vietnam's Saigon building,
// the former Banque de l'Indochine (Félix Dumail, 1929-1930), filling its
// block on Võ Văn Kiệt by the Bến Nghé canal. Footprint and heading from the
// OSM outline (way 39598469); five storeys of grey granite, square columns of
// a giant order, and Khmer-inspired ornament along the roof edge. See
// STATE-BANK.md.
import * as THREE from 'three';
import {builder, extrude, edge, insideOutline, genericReplacer} from './landmark-kit.js';

export const STATE_BANK = Object.freeze({
  lon: 106.7036105, lat: 10.7693667, yaw: 0.407877, storeys: 5,
  // The OSM outline in local metres: +z towards the canal (south-south-east).
  outline: [[36.3, -36.3], [36.5, -29.1], [38.2, -29.1], [37.7, 36.8], [35.7, 38.5], [29.9, 39.1], [29.8, 41.0], [-30.3, 41.0], [-30.4, 39.1], [-38.2, 39.2], [-37.5, -28.1], [-36.4, -34.8], [-31.2, -39.9], [-25.9, -41.5], [26.5, -42.0], [26.3, -39.8], [31.8, -39.8]],
  entrance: 6,                     // the edge facing Võ Văn Kiệt and the canal
});

const PLINTH = 1.6, GROUND = 5.5, STOREY = 4.2, ORDER = GROUND + 3 * STOREY;   // the giant order runs to 18.1 m
const BODY = ORDER + 4.1;                                                      // attic storey above it: 22.2 m

export function createStateBank({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-state-bank';
  const [x, z] = project(STATE_BANK.lon, STATE_BANK.lat);
  group.position.set(x, 0, z); group.rotation.y = STATE_BANK.yaw;
  const materials = {
    stone: new THREE.MeshStandardMaterial({color: '#bdb9b0', roughness: 0.9}),
    dark: new THREE.MeshStandardMaterial({color: '#8f8b83', roughness: 0.9}),
    glass: new THREE.MeshStandardMaterial({color: '#2a333a', roughness: 0.3, metalness: 0.25}),
    roof: new THREE.MeshStandardMaterial({color: '#85827c', roughness: 0.95}),
    skylight: new THREE.MeshStandardMaterial({color: '#4d6470', roughness: 0.2, metalness: 0.4}),
  };
  const {add, box, finish} = builder(materials, 'state-bank');
  const outline = STATE_BANK.outline;

  add('stone', extrude(outline, 0, BODY));
  add('roof', extrude(outline, BODY, BODY + 0.4));

  // A pointed, flame-like finial after Khmer roof ornament: a four-sided spire.
  const finial = () => new THREE.ConeGeometry(0.45, 1.5, 4);

  outline.forEach((_, i) => {
    const e = edge(outline, i), front = i === STATE_BANK.entrance;
    const at = (t, out) => [e.u0 + e.du * t + e.nu * out, e.v0 + e.dv * t + e.nv * out];
    const [mu, mv] = at(e.len / 2, 0.2);
    box('dark', e.len + 0.4, PLINTH, 0.5, mu, PLINTH / 2, mv, e.yaw);               // granite plinth
    box('dark', e.len + 0.3, 0.4, 0.45, mu, GROUND, mv, e.yaw);                      // string course
    const [ku, kv] = at(e.len / 2, 0.35);
    box('stone', e.len + 0.8, 1.3, 0.9, ku, ORDER + 0.65, kv, e.yaw);                // entablature
    box('stone', e.len + 1.0, 0.7, 1.1, ku, BODY - 0.35, kv, e.yaw);                 // cornice
    // Finials along the roof edge.
    for (let t = 1.2; t < e.len - 0.6; t += 2.5) {
      const [fu, fv] = at(t, 0.1);
      add('dark', finial(), fu, BODY + 0.75, fv, 0, e.yaw + Math.PI / 4);
    }
    if (e.len < 3) return;
    // Bays between square columns of the giant order.
    const pitch = 5.0, n = Math.max(1, Math.round(e.len / pitch)), bay = e.len / n;
    for (let k = 0; k <= n; k++) {
      const [pu, pv] = at(k * bay, 0.35);
      box('stone', 1.2, ORDER - PLINTH, 0.7, pu, (ORDER + PLINTH) / 2, pv, e.yaw);
    }
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) * bay, [wu, wv] = at(t, 0.06);
      if (!front) box('glass', Math.min(2.2, bay - 1.8), 3.0, 0.12, wu, PLINTH + 0.4 + 1.5, wv, e.yaw);
      for (let s = 0; s < 3; s++) box('glass', Math.min(2.2, bay - 1.8), 2.7, 0.12, wu, GROUND + s * STOREY + 0.8 + 1.35, wv, e.yaw);
      box('glass', Math.min(1.8, bay - 2), 1.4, 0.12, wu, ORDER + 1.9 + 0.7, wv, e.yaw);     // attic
    }
  });

  // The entrance on Võ Văn Kiệt: a projecting centre with four great piers,
  // three tall doors behind them, steps, and a raised attic with finials.
  const e = edge(outline, STATE_BANK.entrance);
  const mid = [e.u0 + e.du * e.len / 2, e.v0 + e.dv * e.len / 2];
  const at = (t, out) => [mid[0] + e.du * t + e.nu * out, mid[1] + e.dv * t + e.nv * out];
  let [cu, cv] = at(0, 0.8);
  box('stone', 17, BODY + 2.2, 1.6, cu, (BODY + 2.2) / 2, cv, e.yaw);
  [cu, cv] = at(0, 1.2);
  box('stone', 18.2, 1.0, 2.6, cu, BODY + 1.7, cv, e.yaw);
  for (const t of [-6.6, -2.2, 2.2, 6.6]) {
    const [pu, pv] = at(t, 1.9);
    box('stone', 1.7, ORDER + 1.2 - PLINTH, 1.1, pu, (ORDER + 1.2 + PLINTH) / 2, pv, e.yaw);
  }
  for (const t of [-4.4, 0, 4.4]) {
    const [du, dv] = at(t, 1.66);
    box('glass', 2.6, 6.5, 0.12, du, PLINTH + 3.25, dv, e.yaw);
    const [wu, wv] = at(t, 1.66);
    box('glass', 2.6, 6.2, 0.12, wu, 10.6 + 3.1, wv, e.yaw);
  }
  for (let s = 0; s < 4; s++) {
    const [su, sv] = at(0, 1.6 + (3.2 - s * 0.8) / 2);
    box('dark', 16 - s * 0.8, PLINTH * (s + 1) / 4, 3.2 - s * 0.8, su, PLINTH * (s + 1) / 8, sv, e.yaw);
  }
  for (const t of [-8, -4, 0, 4, 8]) {
    const [fu, fv] = at(t, 1.6);
    add('dark', new THREE.ConeGeometry(0.6, t === 0 ? 2.6 : 1.8, 4), fu, BODY + 2.7 + (t === 0 ? 1.3 : 0.9), fv, 0, e.yaw + Math.PI / 4);
  }

  // The skylight over the art deco banking hall at the heart of the block.
  if (!insideOutline([0, 0], outline)) throw new Error('hall outside the footprint');
  box('skylight', 22, 1.4, 22, 0, BODY + 0.4 + 0.7, 0);
  box('dark', 23, 0.3, 23, 0, BODY + 0.55, 0);

  const triangles = finish(group);
  scene.add(group);
  const replaceGeneric = genericReplacer(group, outline, {flag: 'stateBankReplaced', top: BODY + 30});
  const view = {target: group.localToWorld(new THREE.Vector3(0, 10, 38)), eye: group.localToWorld(new THREE.Vector3(-60, 55, 150))};
  const state = {name: 'State Bank of Vietnam (former Banque de l’Indochine)', lon: STATE_BANK.lon, lat: STATE_BANK.lat, height: BODY, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
