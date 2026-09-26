// A schematic model of the Bitexco Financial Tower (Carlos Zapata, 2010),
// the lotus-bud glass tower on Hải Triều. The generic city model has only its
// podium; this adds the tower from OSM's building parts (ways 1222241871-4):
// a tall petal to the north-west whose roof slopes from 262.5 m down to the
// 52nd floor, the lower south-east section ending there at 191 m under the
// cantilevered helipad, and the six-storey podium. Both sections taper and
// bulge as photographs show; silver bands mark the floors. See BITEXCO.md.
import * as THREE from 'three';
import {builder, extrude, loft, bands, genericReplacer} from './landmark-kit.js';

export const BITEXCO = Object.freeze({
  lon: 106.7044358, lat: 10.7718557, yaw: 0.716416,
  // The podium's OSM outline (way 804073951) in local metres: +x north-east,
  // +z south-east (towards the river).
  outline: [[-19.4, 31.8], [-17.5, 31.5], [-8.8, 29.2], [-1.6, 26.8], [6.6, 27.5], [21.5, 30.9], [25.7, 30.7], [28.3, 29.6], [30.6, 28.0], [32.8, 25.0], [34.5, 22.4], [35.7, 20.6], [29.4, -27.7], [24.2, -29.6], [15.6, -32.2], [-12.9, -31.7], [-15.0, -31.7], [-17.3, -31.5], [-19.1, -31.1], [-21.2, -29.4], [-24.4, -26.1], [-27.4, -22.0], [-28.8, -20.1], [-30.0, -17.8], [-32.0, -14.1], [-33.9, -9.0], [-36.1, -0.9], [-36.7, 3.8], [-36.4, 8.7], [-35.9, 12.5], [-35.2, 15.2], [-34.2, 18.2], [-33.2, 20.0], [-32.0, 21.5], [-27.4, 27.4], [-22.6, 31.0]],
  // OSM building parts, same frame.
  petal: [[-0.3, 0.3], [-0.1, -5.8], [-0.3, -11.5], [-1.7, -17.5], [-3.2, -22.3], [-27.4, -22.0], [-28.8, -20.1], [-30.0, -17.8], [-32.0, -14.1], [-33.9, -9.0], [-36.1, -0.9], [-30.7, -2.1], [-25.4, -3.0], [-18.0, -3.4], [-11.6, -3.5], [-5.3, -2.1]],   // way 1222241874: 262.5 m, roof sloping 71.5 m
  tip: [[-3.2, -22.3], [-4.8, -25.7], [-7.3, -28.8], [-12.9, -31.7], [-15.0, -31.7], [-17.3, -31.5], [-19.1, -31.1], [-21.2, -29.4], [-24.4, -26.1], [-27.4, -22.0]],                                                  // way 1222241872: 269 m, roof sloping 6.5 m
  lower: [[-27.4, 27.4], [-22.6, 31.0], [-19.4, 31.7], [-17.5, 31.5], [-8.8, 29.2], [-4.4, 20.3], [-2.8, 14.8], [-1.8, 9.6], [-0.6, 4.0], [-0.3, 0.3], [-5.3, -2.1], [-11.6, -3.5], [-18.0, -3.4], [-25.4, -3.0], [-30.7, -2.1], [-36.1, -0.9], [-36.7, 3.8], [-36.4, 8.7], [-35.9, 12.5], [-35.2, 15.2], [-34.2, 18.2], [-33.2, 20.0], [-32.0, 21.5]],   // way 1222241871: 191 m
  podium: [[-12.9, -31.7], [-7.3, -28.8], [-4.8, -25.7], [-3.2, -22.3], [-1.7, -17.5], [-0.3, -11.5], [-0.1, -5.8], [-0.3, 0.3], [-0.6, 4.0], [-1.8, 9.6], [-2.8, 14.8], [-4.4, 20.3], [-8.8, 29.2], [-1.6, 26.8], [6.6, 27.5], [21.5, 30.9], [25.7, 30.7], [28.3, 29.6], [30.6, 28.0], [32.8, 25.0], [34.5, 22.4], [35.7, 20.6], [29.4, -27.7], [24.2, -29.6], [15.6, -32.2]],   // way 1222241873: 22.5 m
  // OSM's roof:direction 127.5° (downhill), turned into this frame.
  downhill: [0.198, 0.980],
  centre: [-18, 0],                // the tower's plan centre, which it tapers towards
});

const FLOOR = 3.9, HELIPAD = 191, ROOF = 262.5, TIP = 269, PODIUM = 22.5;
// The taper photographs show: slightly fuller a quarter of the way up, then
// narrowing to about two-thirds of the base at the top.
const scale = y => 1 + 0.08 * Math.sin(Math.PI * y / 180) - 0.28 * (y / ROOF) ** 2;

export function createBitexco({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-bitexco';
  const [x, z] = project(BITEXCO.lon, BITEXCO.lat);
  group.position.set(x, 0, z); group.rotation.y = BITEXCO.yaw;
  const materials = {
    glass: new THREE.MeshStandardMaterial({color: '#93aab6', roughness: 0.2, metalness: 0.35}),
    podium: new THREE.MeshStandardMaterial({color: '#6c808a', roughness: 0.25, metalness: 0.35}),
    fin: new THREE.MeshStandardMaterial({color: '#c9ced2', roughness: 0.35, metalness: 0.7}),
    deck: new THREE.MeshStandardMaterial({color: '#b9bcbd', roughness: 0.6, metalness: 0.3}),
  };
  const {add, finish} = builder(materials, 'bitexco');
  const {centre, downhill: [du, dv]} = BITEXCO;
  const levels = []; for (let y = 0; y <= TIP + 0.1; y += FLOOR) levels.push(+y.toFixed(2));

  // A roof sloping downhill across a part, from `high` to `low`.
  const sloping = (part, high, low) => {
    const d = part.map(([u, v]) => u * du + v * dv), lo = Math.min(...d), hi = Math.max(...d);
    return ([u, v]) => high - (high - low) * ((u * du + v * dv) - lo) / (hi - lo);
  };
  const parts = [
    [BITEXCO.petal, sloping(BITEXCO.petal, ROOF, HELIPAD)],
    [BITEXCO.tip, sloping(BITEXCO.tip, TIP, ROOF)],
    [BITEXCO.lower, () => HELIPAD],
  ];
  for (const [part, top] of parts) {
    const {geometry, rings} = loft(part, {levels, scale, centre, top});
    add('glass', geometry);
    add('fin', bands(rings.filter(r => r.y > PODIUM), {centre}));
  }
  const {geometry: base, rings: baseRings} = loft(BITEXCO.podium, {levels: [0, 4.5, 9, 13.5, 18, PODIUM], top: () => PODIUM});
  add('podium', base);
  add('fin', bands(baseRings.filter(r => r.y > 0 && r.y < PODIUM), {centre: [5, 0], out: 0.2, height: 0.5}));

  // The helipad, cantilevered from the 52nd floor 22 m beyond the lower
  // section's south-east end, with the flag near the tower.
  const deck = new THREE.CylinderGeometry(1, 0.8, 1.8, 40); deck.scale(11, 1, 13.5);
  add('deck', deck, -19, HELIPAD + 0.9, 35);
  const rim = new THREE.TorusGeometry(1, 0.012, 4, 40); rim.scale(11, 13.5, 1);
  add('fin', rim, -19, HELIPAD + 1.85, 35, Math.PI / 2);
  add('fin', new THREE.CylinderGeometry(0.06, 0.08, 7, 5), -13, HELIPAD + 5.3, 29);

  const triangles = finish(group);
  scene.add(group);
  group.updateMatrixWorld(true);
  const flags = [{top: group.localToWorld(new THREE.Vector3(-13, HELIPAD + 8.8, 29)), length: 2.4}];
  const replaceGeneric = genericReplacer(group, BITEXCO.outline, {flag: 'bitexcoReplaced', top: 11});
  const view = {target: group.localToWorld(new THREE.Vector3(-18, 140, 0)), eye: group.localToWorld(new THREE.Vector3(-260, 160, 380))};
  const state = {name: 'Bitexco Financial Tower', lon: BITEXCO.lon, lat: BITEXCO.lat, height: TIP, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, flags, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
