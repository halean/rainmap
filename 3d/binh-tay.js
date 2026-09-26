// A schematic exterior model of Bình Tây Market (Chợ Bình Tây, the Marché
// Central de Cholon, 1930) in Chợ Lớn. Footprint from the OSM multipolygon
// (relation 2552505: the ring of halls round a courtyard); the elevations
// after photographs: yellow walls under two tiers of terracotta roofs, the
// street's arcade of stalls, and on Tháp Mười the gatehouse with its blue
// ceramic tympanum and the clock tower with its tiled roofs and dragons;
// small pagoda-roofed towers at the middles of the other sides. See
// BINH-TAY.md.
import * as THREE from 'three';
import {builder, edge, genericReplacer} from './landmark-kit.js';

export const BINH_TAY = Object.freeze({
  lon: 106.6510177, lat: 10.7492646, yaw: 0.193911,
  // The ring's outline and its courtyard in local metres; the gate faces -z
  // (north, on Tháp Mười) on the axis x 8.3.
  outline: [[-51.0, -60.2], [-51.6, 39.1], [-54.4, 40.3], [-54.3, 46.3], [65.1, 45.9], [65.0, 34.2], [62.0, 34.2], [61.9, -59.9], [8.3, -59.8]],
  courtyard: [[-9.5, -27.5], [8.3, -27.5], [26.0, -27.5], [26.0, -11.7], [25.9, 8.0], [8.3, 8.0], [-9.5, 8.0], [-9.5, -12.0]],
  axis: 8.3,
});

// Heights from the photographs' proportions: the arcade's pent roof, the
// halls' walls and roofs, the gatehouse, the clock tower's stages.
const PENT = 4.6, WALL = 8.5, RIDGE = 11.5, GATE = 12.5, CLOCK = 19.5, TOP = 25.5;

export function createBinhTay({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-binh-tay';
  const [x, z] = project(BINH_TAY.lon, BINH_TAY.lat);
  group.position.set(x, 0, z); group.rotation.y = BINH_TAY.yaw;
  const materials = {
    wall: new THREE.MeshStandardMaterial({color: '#f2c753', roughness: 0.8}),
    trim: new THREE.MeshStandardMaterial({color: '#f3e8c8', roughness: 0.8}),
    tile: new THREE.MeshStandardMaterial({color: '#b6603e', roughness: 0.85}),
    dark: new THREE.MeshStandardMaterial({color: '#2e2621', roughness: 0.7}),
    lattice: new THREE.MeshStandardMaterial({color: '#f4efe2', roughness: 0.7}),
    ceramic: new THREE.MeshStandardMaterial({color: '#4a68a8', roughness: 0.5}),
    board: new THREE.MeshStandardMaterial({color: '#8c6a3a', roughness: 0.6, metalness: 0.2}),
  };
  const {add, box, finish} = builder(materials, 'binh-tay');
  const {outline, courtyard, axis: A} = BINH_TAY;

  // The ring of halls round the courtyard.
  const shape = new THREE.Shape(outline.map(([u, v]) => new THREE.Vector2(u, -v)));
  shape.holes.push(new THREE.Path(courtyard.map(([u, v]) => new THREE.Vector2(u, -v))));
  const ring = new THREE.ExtrudeGeometry(shape, {depth: WALL, bevelEnabled: false}); ring.rotateX(-Math.PI / 2);
  add('wall', ring);
  const flat = new THREE.ExtrudeGeometry(shape, {depth: 0.3, bevelEnabled: false}); flat.rotateX(-Math.PI / 2); flat.translate(0, WALL, 0);
  add('tile', flat);

  // A roof plane along an edge: eaves `out` beyond the wall, `width` deep,
  // rising `rise` towards the side `side` of the edge's normal (-1: the
  // outline's inside; +1 for the courtyard, whose normals point into the
  // ring).
  const slope = (e, t0, t1, out, y, width, rise, side = -1) => {
    const len = t1 - t0, tilt = Math.atan2(rise, width), g = new THREE.BoxGeometry(len, 0.25, Math.hypot(width, rise));
    const zAlongNormal = -e.dv * e.nu + e.du * e.nv > 0;                  // where the box's +z points after the yaw
    g.rotateX(zAlongNormal === (side > 0) ? -tilt : tilt);                 // lift the end that lies up-slope
    const t = (t0 + t1) / 2, offset = -side * out + side * width / 2;
    add('tile', g, e.u0 + e.du * t + e.nu * offset, y + rise / 2, e.v0 + e.dv * t + e.nv * offset, 0, e.yaw);
  };
  outline.forEach((_, i) => {
    const e = edge(outline, i);
    if (e.len < 4) return;
    const at = (t, out) => [e.u0 + e.du * t + e.nu * out, e.v0 + e.dv * t + e.nv * out];
    // The pent roof over the stalls, stopping either side of the gatehouse.
    const atGate = ([u, v]) => Math.abs(u - A) < 0.1 && Math.abs(v + 59.8) < 0.5;
    const t0 = atGate(outline[i]) ? 8.6 : -1.5, t1 = atGate(outline[(i + 1) % outline.length]) ? e.len - 8.6 : e.len + 1.5;
    slope(e, t0, t1, 3.2, PENT - 0.8, 3.4, 0.9);
    slope(e, -0.6, e.len + 0.6, 0.8, WALL, 9, RIDGE - WALL);                          // the halls' roof
    const [cu, cv] = at(e.len / 2, 0.08);
    box('dark', e.len - 1, PENT - 1.4, 0.12, cu, (PENT - 1.4) / 2 + 0.3, cv, e.yaw);   // the stalls' openings
    const [bu, bv] = at(e.len / 2, 0.1);
    box('trim', e.len + 0.2, 0.3, 0.3, bu, WALL - 0.4, bv, e.yaw);
    for (let t = 4; t < e.len - 3; t += 8) {
      const [lu, lv] = at(t, 0.07);
      box('lattice', 2.2, 1.6, 0.12, lu, PENT + 1.8, lv, e.yaw);                        // lattice vents over the pent roof
    }
  });
  courtyard.forEach((_, i) => {
    const e = edge(courtyard, i);
    if (e.len < 4) return;
    slope(e, -0.6, e.len + 0.6, 0.8, WALL, 7, RIDGE - WALL - 0.8, 1);
  });

  // The gatehouse on Tháp Mười: yellow, the entrance under a canopy on
  // brackets, the signboard, and the gable with its blue ceramic tympanum.
  const F = -59.9;                                                           // the front's plane
  box('wall', 15, GATE, 9, A, GATE / 2, F + 3.6);
  box('dark', 7.5, 5.6, 0.12, A, 2.8, F - 0.95);
  box('board', 7.8, 1.5, 0.15, A, 6.6, F - 0.97);
  box('trim', 16, 0.35, 2.8, A, 8.0, F - 1.8);                               // canopy
  for (const s of [-1, 1]) box('wall', 0.5, 2.2, 1.6, A + s * 7.0, 6.9, F - 1.4);
  const gable = new THREE.Shape([[-7.2, 0], [7.2, 0], [0, 4.2]].map(([a, b]) => new THREE.Vector2(a, b)));
  add('wall', new THREE.ExtrudeGeometry(gable, {depth: 0.8, bevelEnabled: false}), A, 8.2, F - 0.9);
  const tympanum = new THREE.Shape([[-5.0, 0], [5.0, 0], [0, 2.8]].map(([a, b]) => new THREE.Vector2(a, b)));
  add('ceramic', new THREE.ExtrudeGeometry(tympanum, {depth: 0.1, bevelEnabled: false}), A, 9.0, F - 0.98);
  box('dark', 10.5, 0.6, 0.1, A, 8.7, F - 0.98);
  box('tile', 17, 0.3, 11, A, GATE + 0.1, F + 3.6);                          // eaves over the gatehouse, on brackets
  for (const s of [-1, 1]) for (const d of [-1, 1]) box('wall', 0.3, 1.4, 0.3, A + s * 7.8, GATE - 0.8, F + 3.6 + d * 4.8);

  // The clock tower: lattice windows and a clock on each face, a tiled
  // roof with dragons on its ridges, and a small top stage.
  const T = F + 3.6;
  box('wall', 8.0, CLOCK - GATE, 8.0, A, (CLOCK + GATE) / 2, T);
  for (const [du, dv, ry] of [[0, -4.0, 0], [0, 4.0, 0], [-4.0, 0, Math.PI / 2], [4.0, 0, Math.PI / 2]]) {
    const o = [Math.sign(du) * 0.07, Math.sign(dv) * 0.07];
    add('lattice', new THREE.BoxGeometry(2.2, 2.6, 0.12), A + du + o[0] + (ry ? 0 : -2.6), GATE + 3.0, T + dv + o[1] + (ry ? -2.6 : 0), 0, ry);
    add('lattice', new THREE.BoxGeometry(2.2, 2.6, 0.12), A + du + o[0] + (ry ? 0 : 2.6), GATE + 3.0, T + dv + o[1] + (ry ? 2.6 : 0), 0, ry);
    add('lattice', new THREE.CylinderGeometry(1.25, 1.25, 0.12, 24), A + du + o[0] * 2, GATE + 3.3, T + dv + o[1] * 2, ry ? 0 : Math.PI / 2, 0, ry ? Math.PI / 2 : 0);
    add('dark', new THREE.BoxGeometry(0.1, 0.9, 0.05), A + du + o[0] * 3, GATE + 3.6, T + dv + o[1] * 3, 0, ry);
  }
  const hip = (w, h, y) => { const g = new THREE.CylinderGeometry(Math.SQRT1_2 * w * 0.35, Math.SQRT1_2 * w, h, 4, 1); g.rotateY(Math.PI / 4); add('tile', g, A, y + h / 2, T); };
  hip(12.5, 2.2, CLOCK);
  box('wall', 4.2, 2.4, 4.2, A, CLOCK + 3.3, T);
  hip(6.5, 1.6, CLOCK + 4.5);
  for (const s of [-1, 1]) {
    const dragon = new THREE.CatmullRomCurve3([new THREE.Vector3(s * 2.6, 0, 0), new THREE.Vector3(s * 1.8, 0.6, 0), new THREE.Vector3(s * 1.0, 0.1, 0), new THREE.Vector3(s * 0.4, 0.6, 0)]);
    add('ceramic', new THREE.TubeGeometry(dragon, 10, 0.12, 5, false), A, CLOCK + 2.3, T);
  }
  add('trim', new THREE.CylinderGeometry(0.05, 0.07, 5, 5), A, TOP + 1.9, T);

  // Pagoda-roofed towers at the middles of the other three sides.
  const towers = [[-51.3, -10.5], [63.5, -12.9], [5.3, 46.1]];
  for (const [u, v] of towers) {
    box('wall', 5, 4, 5, u, WALL + 2, v);
    for (const [du, dv, ry] of [[0, 2.55, 0], [0, -2.55, 0], [2.55, 0, Math.PI / 2], [-2.55, 0, Math.PI / 2]]) add('lattice', new THREE.BoxGeometry(2.4, 1.5, 0.1), u + du, WALL + 2.3, v + dv, 0, ry);
    const g = new THREE.CylinderGeometry(Math.SQRT1_2 * 2.2, Math.SQRT1_2 * 8.4, 2.4, 4, 1); g.rotateY(Math.PI / 4);
    add('tile', g, u, WALL + 5.2, v);
    add('trim', new THREE.ConeGeometry(0.25, 1.4, 6), u, WALL + 7.1, v);
  }

  // The shrine pavilion in the courtyard.
  const [su, sv] = [8.3, -9.8];
  box('wall', 4, 3.5, 4, su, 1.75, sv);
  const shrine = new THREE.CylinderGeometry(Math.SQRT1_2 * 1.2, Math.SQRT1_2 * 6.4, 1.8, 4, 1); shrine.rotateY(Math.PI / 4);
  add('tile', shrine, su, 4.4, sv);

  const triangles = finish(group);
  scene.add(group);
  group.updateMatrixWorld(true);
  const flags = [{top: group.localToWorld(new THREE.Vector3(A, TOP + 4.4, T)), length: 2.1}];
  const replaceGeneric = genericReplacer(group, outline, {flag: 'binhTayReplaced', top: 40});
  const view = {target: group.localToWorld(new THREE.Vector3(A, 10, -60)), eye: group.localToWorld(new THREE.Vector3(A + 30, 30, -140))};
  const state = {name: 'Bình Tây Market', lon: BINH_TAY.lon, lat: BINH_TAY.lat, height: TOP + 6.1, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, flags, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
