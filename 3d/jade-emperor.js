// A schematic exterior model of the Jade Emperor Pagoda (Chùa Ngọc Hoàng,
// officially Phước Hải Tự, 1909) in Đa Kao. Footprint and heading from the
// OSM outline (way 1272651080: the halls, 10 m by 27 m); the front after
// photographs: the red gate front of the main hall with its signboard 玉皇殿,
// the green-glazed porch roof, glazed ceramic figures and dragons along the
// ridges, and the three-tiered incense tower in the courtyard before it.
// See JADE-EMPEROR.md.
import * as THREE from 'three';
import {builder, extrude, genericReplacer} from './landmark-kit.js';

export const JADE_EMPEROR = Object.freeze({
  lon: 106.6976869, lat: 10.7915281, yaw: -0.717719,
  // The OSM outline in local metres: the halls run along z, the front at
  // z -13.5 facing the courtyard and Mai Thị Lựu (north-east).
  outline: [[-4.9, 13.4], [-4.9, -13.5], [4.9, -13.5], [4.9, 13.5]],
});

// Heights from the photographs' proportions: the hall walls, the gate
// front and its crest.
const WALL = 6.0, GATE = 10.4, FRONT = -13.5;

export function createJadeEmperor({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-jade-emperor';
  const [x, z] = project(JADE_EMPEROR.lon, JADE_EMPEROR.lat);
  group.position.set(x, 0, z); group.rotation.y = JADE_EMPEROR.yaw;
  const materials = {
    wall: new THREE.MeshStandardMaterial({color: '#cf6663', roughness: 0.85}),
    tile: new THREE.MeshStandardMaterial({color: '#3f7a5f', roughness: 0.6, metalness: 0.1}),
    ceramic: new THREE.MeshStandardMaterial({color: '#4f8da0', roughness: 0.5, metalness: 0.1}),
    stone: new THREE.MeshStandardMaterial({color: '#8d8a82', roughness: 0.9}),
    dark: new THREE.MeshStandardMaterial({color: '#2f2522', roughness: 0.7}),
    board: new THREE.MeshStandardMaterial({color: '#e7dcc0', roughness: 0.7}),
    red: new THREE.MeshStandardMaterial({color: '#c3261f', roughness: 0.6}),
    gold: new THREE.MeshStandardMaterial({color: '#d4a93e', emissive: '#5a400c', emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.4}),
    bronze: new THREE.MeshStandardMaterial({color: '#3f4a45', roughness: 0.5, metalness: 0.5}),
  };
  const {add, box, finish} = builder(materials, 'jade-emperor');
  const outline = JADE_EMPEROR.outline;

  add('wall', extrude(outline, 0, WALL));
  box('stone', 10.2, 0.8, 27.4, 0, 0.4, 0);                                    // the plinth

  // A glazed-tile gable roof with upturned ends, ridge along z, and a crest
  // of ceramic figures along its ridge.
  const roof = (z0, z1, w, eaves, ridge) => {
    const g = new THREE.Shape([[-w / 2, 0], [w / 2, 0], [0, ridge - eaves]].map(([a, b]) => new THREE.Vector2(a, b)));
    add('tile', new THREE.ExtrudeGeometry(g, {depth: z1 - z0, bevelEnabled: false}), 0, eaves, z0);
    box('ceramic', 0.5, 0.6, z1 - z0, 0, ridge + 0.1, (z0 + z1) / 2);
    for (let zz = z0 + 1.5; zz < z1 - 1; zz += 2.5) add('ceramic', new THREE.SphereGeometry(0.28, 6, 4), 0, ridge + 0.55, zz);
    for (const s of [-1, 1]) for (const zz of [z0, z1]) add('tile', new THREE.ConeGeometry(0.25, 1.0, 5), s * (w / 2 - 0.1), eaves + 0.3, zz, 0, 0, -s * 1.0);
  };
  roof(-12.3, -1.0, 11.2, WALL, 9.2);                                          // the front hall
  roof(-0.6, 13.9, 11.2, WALL - 0.4, 8.6);                                     // the halls behind

  // The gate front: a tall red wall with a signboard, a tiled coping with a
  // crest of dragons and a pearl, and turrets at its corners.
  box('wall', 9.8, GATE, 1.2, 0, GATE / 2, FRONT - 0.6);
  box('tile', 10.6, 0.5, 2.0, 0, GATE + 0.25, FRONT - 0.6);
  box('ceramic', 8.0, 0.9, 0.8, 0, GATE + 0.95, FRONT - 0.6);                 // the crest of glazed figures
  for (const s of [-1, 1]) {
    const dragon = new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 3.8, GATE + 1.4, 0), new THREE.Vector3(s * 3.0, GATE + 2.0, 0), new THREE.Vector3(s * 2.2, GATE + 1.5, 0),
      new THREE.Vector3(s * 1.4, GATE + 2.1, 0), new THREE.Vector3(s * 0.8, GATE + 1.7, 0),
    ]);
    add('ceramic', new THREE.TubeGeometry(dragon, 16, 0.14, 5, false), 0, 0, FRONT - 0.6);
    add('ceramic', new THREE.SphereGeometry(0.25, 6, 4), s * 0.7, GATE + 1.8, FRONT - 0.6);
    box('wall', 1.1, GATE + 1.2, 1.4, s * 4.75, (GATE + 1.2) / 2, FRONT - 0.6);  // the corner posts
    add('ceramic', new THREE.CylinderGeometry(0.45, 0.35, 0.7, 8), s * 4.75, GATE + 1.55, FRONT - 0.6);
    add('gold', new THREE.ConeGeometry(0.25, 0.9, 8), s * 4.75, GATE + 2.35, FRONT - 0.6);
    box('ceramic', 2.2, 1.0, 0.2, s * 3.1, GATE - 3.6, FRONT - 1.25);           // relief panels either side
  }
  add('ceramic', new THREE.SphereGeometry(0.4, 10, 8), 0, GATE + 2.3, FRONT - 0.6);
  add('gold', new THREE.ConeGeometry(0.18, 0.8, 8), 0, GATE + 3.0, FRONT - 0.6);
  // The signboard: gold frame, pale panel, three red characters.
  box('gold', 5.2, 1.7, 0.12, 0, GATE - 2.1, FRONT - 1.22);
  box('board', 4.8, 1.35, 0.12, 0, GATE - 2.1, FRONT - 1.28);
  for (const du of [-1.5, 0, 1.5]) box('red', 0.95, 1.0, 0.06, du, GATE - 2.1, FRONT - 1.36);
  // The porch: a green-glazed roof on two posts over the dark doorway,
  // and red lanterns.
  box('dark', 3.4, 4.0, 0.12, 0, 2.8, FRONT - 1.26);
  const porch = new THREE.Shape([[-3.8, 0], [3.8, 0], [3.2, 0.9], [-3.2, 0.9]].map(([a, b]) => new THREE.Vector2(a, b)));
  const porchRoof = new THREE.ExtrudeGeometry(porch, {depth: 2.8, bevelEnabled: false}); porchRoof.rotateX(-0.25);
  add('tile', porchRoof, 0, 5.4, FRONT - 3.9);
  for (const s of [-1, 1]) {
    add('dark', new THREE.CylinderGeometry(0.16, 0.18, 4.8, 8), s * 3.0, 3.2, FRONT - 3.4);
    add('tile', new THREE.ConeGeometry(0.22, 0.9, 5), s * 3.9, 5.5, FRONT - 3.9, 0, 0, -s * 1.0);
    add('red', new THREE.SphereGeometry(0.4, 8, 6), s * 1.9, 4.3, FRONT - 2.8);
  }
  for (let s = 0; s < 3; s++) box('stone', 5 - s * 0.8, 0.2 * (s + 1), 1.8 - s * 0.5, 0, 0.1 * (s + 1), FRONT - 1.2 - (1.8 - s * 0.5) / 2);

  // The incense tower in the courtyard: three tiers of bronze roofs.
  const [tu, tv] = [2.2, FRONT - 7.5];
  box('stone', 1.4, 1.0, 1.4, tu, 0.5, tv);
  for (let k = 0; k < 3; k++) {
    const y = 1.0 + k * 1.1;
    box('bronze', 0.9 - k * 0.15, 0.8, 0.9 - k * 0.15, tu, y + 0.4, tv);
    const r = new THREE.ConeGeometry(1.1 - k * 0.2, 0.45, 6); add('bronze', r, tu, y + 1.0, tv);
  }
  add('bronze', new THREE.ConeGeometry(0.12, 0.6, 6), tu, 4.6, tv);

  const triangles = finish(group);
  scene.add(group);
  const replaceGeneric = genericReplacer(group, outline, {flag: 'jadeEmperorReplaced', top: 40});
  const view = {target: group.localToWorld(new THREE.Vector3(0, 6, FRONT)), eye: group.localToWorld(new THREE.Vector3(10, 10, FRONT - 32))};
  const state = {name: 'Jade Emperor Pagoda (Chùa Ngọc Hoàng)', lon: JADE_EMPEROR.lon, lat: JADE_EMPEROR.lat, height: GATE + 3.4, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
