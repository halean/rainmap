// A schematic exterior model of the Thiên Hậu Temple (Hội quán Tuệ Thành,
// the Cantonese assembly hall of the sea goddess Mazu) on Nguyễn Trãi in Chợ
// Lớn. Footprint from the OSM outline of the compound (way 1497050780) and
// the generic model's halls inside it; the front after photographs: grey
// brick walls, a porch with stone pillars, green iron screens and a red
// arched gate, grey tiled roofs edged in green glaze, curled "wok-handle"
// gables, and along the ridge the famous crest of ceramic figures.
// See THIEN-HAU.md.
import * as THREE from 'three';
import {builder, extrude, genericReplacer} from './landmark-kit.js';

export const THIEN_HAU = Object.freeze({
  lon: 106.6611632, lat: 10.7534587, yaw: -0.062757,
  // The compound (OSM) in local metres: the forecourt on Nguyễn Trãi at +z
  // (south), the halls behind it from z 26.5.
  outline: [[-10.9, 36.0], [-4.1, 35.9], [2.8, 35.9], [9.5, 35.8], [15.7, 35.7], [15.7, 26.5], [15.6, 6.8], [15.6, -39.9], [15.6, -54.7], [-10.7, -54.7], [-10.7, -53.6], [-10.7, -40.0], [-10.7, -30.6], [-10.9, 12.9], [-10.9, 21.3], [-10.9, 26.5]],
  halls: [[-10.9, 26.5], [15.6, 26.5], [15.6, -54.7], [-10.7, -54.7]],
  // The light wells between the halls, from the generic model.
  wells: [[[-0.2, 5.5], [5.3, 5.5], [5.4, 15.6], [-0.2, 15.6]], [[0.9, -38.2], [7.9, -38.2], [7.9, -30.8], [0.9, -30.8]]],
});

const WALL = 5.6, FRONT = 26.5, CU = 2.35, W = 26.5;           // halls' walls; the front's plane, axis and width

export function createThienHau({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-thien-hau';
  const [x, z] = project(THIEN_HAU.lon, THIEN_HAU.lat);
  group.position.set(x, 0, z); group.rotation.y = THIEN_HAU.yaw;
  const materials = {
    brick: new THREE.MeshStandardMaterial({color: '#8e8a84', roughness: 0.9}),
    stone: new THREE.MeshStandardMaterial({color: '#b3ada2', roughness: 0.85}),
    tile: new THREE.MeshStandardMaterial({color: '#6c6f6c', roughness: 0.8}),
    glaze: new THREE.MeshStandardMaterial({color: '#4f8f7a', roughness: 0.5}),
    ceramic: new THREE.MeshStandardMaterial({color: '#5d8ea0', roughness: 0.5}),
    ochre: new THREE.MeshStandardMaterial({color: '#c9a25a', roughness: 0.6}),
    dark: new THREE.MeshStandardMaterial({color: '#262221', roughness: 0.7}),
    red: new THREE.MeshStandardMaterial({color: '#c42a22', roughness: 0.6}),
    iron: new THREE.MeshStandardMaterial({color: '#2f8a6a', roughness: 0.5, metalness: 0.3, transparent: true, opacity: 0.7, depthWrite: false}),
    lantern: new THREE.MeshStandardMaterial({color: '#e0402c', emissive: '#7a1508', emissiveIntensity: 0.4, roughness: 0.6}),
  };
  const {add, box, finish} = builder(materials, 'thien-hau');

  // The halls round their light wells, with the porch recessed into the
  // front across the middle three bays.
  const P0 = CU - 8.05, P1 = CU + 8.05, PD = 3.2;
  const plan = [[-10.9, FRONT], [P0, FRONT], [P0, FRONT - PD], [P1, FRONT - PD], [P1, FRONT], [15.6, FRONT], [15.6, -54.7], [-10.7, -54.7]];
  const shape = new THREE.Shape(plan.map(([u, v]) => new THREE.Vector2(u, -v)));
  for (const well of THIEN_HAU.wells) shape.holes.push(new THREE.Path(well.map(([u, v]) => new THREE.Vector2(u, -v))));
  const body = new THREE.ExtrudeGeometry(shape, {depth: WALL, bevelEnabled: false}); body.rotateX(-Math.PI / 2);
  add('brick', body);

  // Gable roofs across the compound, ridges along x, each with green-glazed
  // eaves and ridge.
  const roof = (z0, z1, ridge, crest) => {
    const d = (z1 - z0) / 2, g = new THREE.Shape([[-d - 0.6, 0], [d + 0.6, 0], [0, ridge - WALL]].map(([a, b]) => new THREE.Vector2(a, b)));
    const geometry = new THREE.ExtrudeGeometry(g, {depth: W + 0.4, bevelEnabled: false});
    geometry.rotateY(Math.PI / 2);                                         // shape x -> -z, extruded along +x
    add('tile', geometry, -10.9 - 0.2, WALL, (z0 + z1) / 2);
    box('glaze', W + 0.6, 0.35, 0.5, CU, ridge + 0.1, (z0 + z1) / 2);
    for (const s of [-1, 1]) box('glaze', W + 0.6, 0.2, 0.4, CU, WALL + 0.05, (z0 + z1) / 2 + s * (d + 0.5));
    // Curled gable ends: a black crest sweeping up and over at each side.
    for (const su of [-1, 1]) {
      const u = CU + su * (W / 2 + 0.25);
      const curl = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, WALL + 0.2, -d), new THREE.Vector3(0, ridge - 0.6, -d * 0.45), new THREE.Vector3(0, ridge + 0.9, -0.2),
        new THREE.Vector3(0, ridge + 1.5, 0.8), new THREE.Vector3(0, ridge + 0.8, 1.3),
      ]);
      add('dark', new THREE.TubeGeometry(curl, 16, 0.35, 6, false), u, 0, (z0 + z1) / 2);
    }
    if (!crest) return;
    // The crest of ceramic figures along the ridge: a frieze, then rows of
    // small figures and little pavilions, and a pearl on top.
    const cz = (z0 + z1) / 2;
    box('ochre', W - 3, 0.9, 0.5, CU, ridge + 0.75, cz);
    box('ceramic', W - 4, 1.0, 0.6, CU, ridge + 1.7, cz);
    for (let k = 0; k < 22; k++) {
      const u = CU - (W - 5) / 2 + k * (W - 5) / 21, h = 0.6 + 0.3 * ((k * 7) % 3);
      add(k % 3 ? 'ceramic' : 'ochre', new THREE.CylinderGeometry(0.16, 0.22, h, 6), u, ridge + 2.2 + h / 2, cz);
      add('ceramic', new THREE.SphereGeometry(0.15, 6, 4), u, ridge + 2.3 + h, cz);
    }
    for (const du of [-6, 0, 6]) {
      const p = new THREE.CylinderGeometry(0, 0.9, 0.6, 4); p.rotateY(Math.PI / 4);
      add('glaze', p, CU + du, ridge + 3.4, cz);
    }
    add('ceramic', new THREE.SphereGeometry(0.4, 10, 8), CU, ridge + 4.2, cz);
    add('red', new THREE.TorusGeometry(0.55, 0.07, 6, 16), CU, ridge + 4.2, cz);
  };
  roof(16.2, FRONT, 9.2, true);                                            // the front hall
  roof(-6.9, 5.5, 9.8, true);                                              // the main hall
  roof(-30.8, -6.9, 9.4, false);
  roof(-54.7, -38.2, 9.0, false);

  // The front: a porch across the middle three bays, stone pillars and
  // beams, the green iron screens and the red arched gate, lanterns; a
  // frieze of figures over the side bays.
  const P = FRONT + 0.05, porch = PD;
  box('dark', 3.0, 3.6, 0.12, CU, 2.0, FRONT - porch + 0.07);                       // the doorway at the back of the porch
  box('brick', 16.2, 0.6, porch, CU, 0.3, FRONT - porch / 2);                          // the porch floor
  for (const du of [-8, -2.4, 2.4, 8]) box('stone', 0.6, WALL, 0.6, CU + du, WALL / 2, P - 0.3);
  box('stone', 16.8, 0.6, 0.7, CU, WALL - 0.3, P - 0.3);                               // the beam
  for (const du of [-5.2, 5.2]) box('iron', 5.0, 2.8, 0.06, CU + du, 2.0, P - 0.2);
  for (const s of [-1, 1]) box('red', 0.4, 3.4, 0.3, CU + s * 1.6, 2.3, P - 0.2);
  const gate = new THREE.TorusGeometry(1.6, 0.18, 6, 16, Math.PI); add('red', gate, CU, 4.0, P - 0.2);
  box('iron', 2.8, 3.2, 0.05, CU, 2.2, P - 0.15);
  for (const du of [-5.5, -1.2, 1.2, 5.5]) add('lantern', new THREE.SphereGeometry(0.55, 10, 8), CU + du, WALL - 1.4, FRONT - 1.2);
  for (const s of [-1, 1]) {
    const du = s * 11.2;
    box('brick', 3.8, WALL, 0.4, CU + du, WALL / 2, P - 0.2);                        // the side bays' walls
    box('dark', 1.4, 2.6, 0.1, CU + du, 1.5, P);
    box('ceramic', 3.4, 0.9, 0.3, CU + du, WALL - 0.9, P);
  }
  for (let s = 0; s < 3; s++) box('stone', 12 - s * 1.5, 0.2 * (s + 1), 1.8 - s * 0.55, CU, 0.1 * (s + 1), FRONT + (1.8 - s * 0.55) / 2);

  // Incense burners in the forecourt.
  for (const du of [-2.5, 2.5]) {
    add('dark', new THREE.CylinderGeometry(0.55, 0.45, 0.9, 10), CU + du, 0.45, FRONT + 5);
    add('dark', new THREE.CylinderGeometry(0.2, 0.2, 0.6, 6), CU + du, 1.2, FRONT + 5);
  }

  const triangles = finish(group);
  scene.add(group);
  const replaceGeneric = genericReplacer(group, THIEN_HAU.outline, {flag: 'thienHauReplaced', top: 40});
  const view = {target: group.localToWorld(new THREE.Vector3(CU, 6, FRONT)), eye: group.localToWorld(new THREE.Vector3(CU + 8, 9, FRONT + 26))};
  const state = {name: 'Thiên Hậu Temple (Hội quán Tuệ Thành)', lon: THIEN_HAU.lon, lat: THIEN_HAU.lat, height: 14.6, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
