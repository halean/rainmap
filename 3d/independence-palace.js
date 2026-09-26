// A schematic exterior model of the Independence Palace (Dinh Độc Lập),
// Ngô Viết Thụ, 1962–66. Footprint and heading from the OSM building outline
// (way 39598493); height and composition from the palace's official site.
// See INDEPENDENCE-PALACE.md.
import * as THREE from 'three';
import {mergeGeometries} from './vendor/utils/BufferGeometryUtils.js';

// Origin: on the T's axis of symmetry, midway front to back. The main facade
// (local +Z) faces north-east, toward Lê Duẩn boulevard.
export const PALACE = Object.freeze({
  lon: 106.6953124, lat: 10.7769346,
  yaw: 2.397945, width: 85.8, depth: 76.5, height: 26,
});

// Levels (metres above ground). The official 26 m is reached by the rooftop
// pavilion; the floors, mezzanines and roof slab are divided to fit it.
const PLINTH = 1.2, FLOOR2 = 6.2, FLOOR3 = 11.4, EAVES = 16.6, ROOF = 18.2, PAVILION_TOP = 26;

export function createIndependencePalace({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-independence-palace';
  const [ox, oz] = project(PALACE.lon, PALACE.lat);
  group.position.set(ox, 0, oz); group.rotation.y = PALACE.yaw;
  const materials = {
    concrete: new THREE.MeshStandardMaterial({color:'#ece6d6', roughness:0.9}),
    screen: new THREE.MeshStandardMaterial({color:'#e2dac6', roughness:0.85}),
    glass: new THREE.MeshStandardMaterial({color:'#28363e', roughness:0.35, metalness:0.2}),
    roof: new THREE.MeshStandardMaterial({color:'#a7aba4', roughness:0.95}),
    stone: new THREE.MeshStandardMaterial({color:'#cdc3ad', roughness:0.95}),
    metal: new THREE.MeshStandardMaterial({color:'#c9ced3', metalness:0.6, roughness:0.4}),
    olive: new THREE.MeshStandardMaterial({color:'#4f5b3b', roughness:0.8}),
    red: new THREE.MeshStandardMaterial({color:'#b3261e', roughness:0.7}),
    water: new THREE.MeshStandardMaterial({color:'#3f6f7a', roughness:0.25, metalness:0.1}),
  };
  const parts = Object.fromEntries(Object.keys(materials).map(key => [key, []]));
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  function add(key, geometry, px=0, py=0, pz=0, rx=0, ry=0, rz=0) {
    quaternion.setFromEuler(new THREE.Euler(rx, ry, rz));
    matrix.compose(new THREE.Vector3(px, py, pz), quaternion, new THREE.Vector3(1, 1, 1));
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.applyMatrix4(matrix); parts[key].push(g);
  }
  // A box by its extents: x0..x1, y0..y1, z0..z1.
  function slab(key, x0, x1, y0, y1, z0, z1) {
    add(key, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }

  // The T-shaped plan, as axis-aligned blocks: [x0, x1, z0, z1].
  const blocks = [
    [-42.9, 42.9, 14.5, 38.3],     // front block
    [-42.9, -29.9, 9.9, 14.5],     // its deeper ends
    [29.9, 42.9, 9.9, 14.5],
    [-11.6, 11.6, -10.1, 14.5],    // neck
    [-15.9, 15.9, -38.3, -10.1],   // rear wing
  ];
  // Faces of the outline that are exterior (not shared between blocks):
  // [x0, z0, x1, z1] with the outward normal to the right of the direction.
  const outline = [
    [-42.9, 38.3, 42.9, 38.3], [42.9, 38.3, 42.9, 9.9], [42.9, 9.9, 29.9, 9.9], [29.9, 9.9, 29.9, 14.5],
    [29.9, 14.5, 11.6, 14.5], [11.6, 14.5, 11.6, -10.1], [11.6, -10.1, 15.9, -10.1], [15.9, -10.1, 15.9, -38.3],
    [15.9, -38.3, -15.9, -38.3], [-15.9, -38.3, -15.9, -10.1], [-15.9, -10.1, -11.6, -10.1], [-11.6, -10.1, -11.6, 14.5],
    [-11.6, 14.5, -29.9, 14.5], [-29.9, 14.5, -29.9, 9.9], [-29.9, 9.9, -42.9, 9.9], [-42.9, 9.9, -42.9, 38.3],
  ];

  // Plinth, recessed glazed ground floor, upper floors and the flat roof.
  blocks.forEach(([x0, x1, z0, z1], b) => {
    slab('stone', x0 - 1.2, x1 + 1.2, 0, PLINTH + b * 0.004, z0 - 1.2, z1 + 1.2);
    slab('glass', x0 + 1.5, x1 - 1.5, PLINTH, FLOOR2, z0 + 1.5, z1 - 1.5);
    slab('concrete', x0, x1, FLOOR2, EAVES, z0, z1);
    slab('roof', x0, x1, EAVES, ROOF, z0, z1);
  });
  // Ground-floor columns along the recessed glazing.
  for (const [x0, z0, x1, z1] of outline) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 7.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      slab('concrete', x - 0.4, x + 0.4, PLINTH, FLOOR2, z - 0.4, z + 0.4);
    }
  }

  // The three horizontal lines of 三 around the building: two balcony slabs
  // (second and third floors) and the deep roof eaves.
  const reach = {balcony: 2.4, eaves: 3.6};
  // Neighbouring blocks' slabs overlap; a few millimetres' difference in
  // height per block keeps their level faces from z-fighting.
  blocks.forEach(([x0, x1, z0, z1], b) => {
    for (const [y, out, t] of [[FLOOR2, reach.balcony, 0.35], [FLOOR3, reach.balcony, 0.35], [EAVES, reach.eaves, 0.9]])
      slab('concrete', x0 - out, x1 + out, y - t + b * 0.004, y + b * 0.004, z0 - out, z1 + out);
  });

  // Rèm hoa đá: the stone screen of stylised bamboo standing out on the
  // balcony edge around the upper floors -- vertical canes with a node at
  // each joint, as in the palace's screens.
  const SCREEN_PITCH = 0.62, CANE = 0.2, NODE = 1.3;
  for (const [x0, z0, x1, z1] of outline) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    const nx = -uz, nz = ux;                                   // outward (the outline runs clockwise seen from above)
    const sx0 = x0 + nx * (reach.balcony - 0.3), sz0 = z0 + nz * (reach.balcony - 0.3);
    const yaw = Math.atan2(-uz, ux);
    const canes = Math.floor(len / SCREEN_PITCH);
    for (let i = 1; i < canes; i++) {
      const cx = sx0 + ux * i * SCREEN_PITCH, cz = sz0 + uz * i * SCREEN_PITCH;
      add('screen', new THREE.BoxGeometry(CANE, EAVES - 0.9 - FLOOR2, CANE), cx, (FLOOR2 + EAVES - 0.9) / 2, cz, 0, yaw);
    }
    for (let y = FLOOR2 + NODE; y < EAVES - 1; y += NODE)
      add('screen', new THREE.BoxGeometry(len, 0.12, 0.3), sx0 + dx / 2, y, sz0 + dz / 2, 0, yaw);
  }

  // Front: the grand porch canopy, the two tall columns of 興, the entrance
  // steps and the semicircular lotus pond before the hall.
  const front = 38.3;
  slab('concrete', -14, 14, FLOOR2 - 0.5, FLOOR2, front, front + 9);
  for (const x of [-6.5, 6.5]) add('concrete', new THREE.CylinderGeometry(0.75, 0.75, EAVES - PLINTH, 16), x, (EAVES + PLINTH) / 2, front + 3.2);
  for (let i = 0; i < 4; i++) slab('stone', -10 + i * 0.4, 10 - i * 0.4, 0, PLINTH - i * 0.3, front + 1.2, front + 3.2 + (3 - i) * 1.3);
  const pond = new THREE.CircleGeometry(12, 32, Math.PI, Math.PI); pond.rotateX(-Math.PI / 2);
  add('water', pond, 0, 0.15, front + 21);
  const rim = new THREE.RingGeometry(12, 12.8, 32, 1, Math.PI, Math.PI); rim.rotateX(-Math.PI / 2);
  add('stone', rim, 0, 0.3, front + 21);

  // Rooftop: the Pavilion of Universal Peace, a square ring in the shape of
  // 口, with the flagpole rising through its open centre (口 + | = 中).
  const pz = 26, outer = 18, inner = 7, h = PAVILION_TOP - 1.2;
  [
    [-outer / 2, outer / 2, pz + inner / 2, pz + outer / 2], [-outer / 2, outer / 2, pz - outer / 2, pz - inner / 2],
    [-outer / 2, -inner / 2, pz - inner / 2, pz + inner / 2], [inner / 2, outer / 2, pz - inner / 2, pz + inner / 2],
  ].forEach(([x0, x1, z0, z1], b) => {
    slab('glass', x0 + 0.8, x1 - 0.8, ROOF, h, z0 + 0.8, z1 - 0.8);
    slab('roof', x0 - 1.2, x1 + 1.2, h, PAVILION_TOP - 0.012 + b * 0.004, z0 - 1.2, z1 + 1.2);
  });
  add('metal', new THREE.CylinderGeometry(0.18, 0.28, 12, 10), 0, ROOF + 6, pz);

  // The helipad on the rear wing, with the UH-1 kept there and the two red
  // circles marking where bombs struck on 8 April 1975.
  const pad = new THREE.CircleGeometry(9, 32); pad.rotateX(-Math.PI / 2);
  add('stone', pad, 0, ROOF + 0.02, -24);
  for (const [x, z] of [[-5.5, -16], [6, -31]]) {
    const ring = new THREE.RingGeometry(1.2, 1.7, 24); ring.rotateX(-Math.PI / 2);
    add('red', ring, x, ROOF + 0.05, z);
  }
  const hx = 0, hz = -24, hy = ROOF + 0.6;
  add('olive', new THREE.BoxGeometry(2.6, 2.3, 6.5), hx, hy + 1.4, hz + 1.5);        // cabin
  add('olive', new THREE.SphereGeometry(1.3, 12, 8), hx, hy + 1.4, hz + 4.8);        // nose
  add('olive', new THREE.BoxGeometry(0.7, 0.8, 7.5), hx, hy + 1.9, hz - 5.2);        // tail boom
  add('olive', new THREE.BoxGeometry(0.2, 2.2, 1.2), hx, hy + 2.8, hz - 8.8);        // fin
  for (const s of [-1, 1]) slab('metal', hx + s * 1.3 - 0.08, hx + s * 1.3 + 0.08, hy - 0.5, hy - 0.35, hz - 2, hz + 5);   // skids
  add('metal', new THREE.BoxGeometry(14.6, 0.08, 0.5), hx, hy + 2.9, hz + 1.5, 0, 0.35);  // main rotor
  add('metal', new THREE.BoxGeometry(14.6, 0.08, 0.5), hx, hy + 2.9, hz + 1.5, 0, 0.35 + Math.PI / 2);

  let triangles = 0;
  for (const [key, geometries] of Object.entries(parts)) {
    const geometry = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[key]); mesh.name = `palace-${key}`;
    triangles += geometry.attributes.position.count / 3; group.add(mesh);
  }
  scene.add(group); group.updateWorldMatrix(true, true);

  // Same approach as notre-dame.js: remove only the generic OSM building
  // triangles wholly inside the palace footprint, never the neighbourhood.
  const inverse = group.matrixWorld.clone().invert(), v = new THREE.Vector3();
  const replacementBox = new THREE.Box3(new THREE.Vector3(-44.5, -1, -40), new THREE.Vector3(44.5, 40, 40));
  const worldBox = replacementBox.clone().applyMatrix4(group.matrixWorld);
  function replaceGeneric(root) {
    if (!root) return 0;
    root.updateWorldMatrix(true, true); let removed = 0;
    root.traverse(o => {
      if (!o.isMesh || !o.name.startsWith('building') || o.userData.palaceReplaced) return;
      o.userData.palaceReplaced = true;
      const original = o.geometry;
      if (!original.boundingBox) original.computeBoundingBox();
      if (!original.boundingBox.clone().applyMatrix4(o.matrixWorld).intersectsBox(worldBox)) return;
      const g = original.index ? original.toNonIndexed() : original, p = g.attributes.position;
      const transform = new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld), keep = [];
      let cut = 0;
      for (let i = 0; i < p.count; i += 3) {
        let inside = true;
        for (let j = 0; j < 3; j++) { v.fromBufferAttribute(p, i + j).applyMatrix4(transform); inside = inside && replacementBox.containsPoint(v); }
        if (inside) cut++; else keep.push(i, i + 1, i + 2);
      }
      if (cut) {
        const out = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(g.attributes)) {
          const array = new attr.array.constructor(keep.length * attr.itemSize);
          for (let i = 0; i < keep.length; i++) for (let c = 0; c < attr.itemSize; c++) array[i * attr.itemSize + c] = attr.array[keep[i] * attr.itemSize + c];
          out.setAttribute(name, new THREE.BufferAttribute(array, attr.itemSize, attr.normalized));
        }
        out.computeBoundingBox(); out.computeBoundingSphere(); o.geometry = out; original.dispose(); removed += cut;
      }
      if (g !== original) g.dispose();
    });
    return removed;
  }
  // The national flag on the pole through the 口 pavilion (flag.js's createFlagSet).
  group.updateMatrixWorld(true);
  const flags = [{top: group.localToWorld(new THREE.Vector3(0, ROOF + 12, pz)), length: 4.5}];
  const view = {target: group.localToWorld(new THREE.Vector3(0, 12, 10)), eye: group.localToWorld(new THREE.Vector3(-70, 55, 150))};
  const state = {name: 'Independence Palace (Dinh Độc Lập)', lon: PALACE.lon, lat: PALACE.lat, height: PALACE.height, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, flags, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
