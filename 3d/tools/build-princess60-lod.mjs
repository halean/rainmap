// Build the far-view proxy of the Princess 60 Nha Rong: the full procedural
// model (princess60-nharong.js, ~1.72M triangles) simplified by vertex
// clustering and merged into one mesh per material, written as a small GLB.
// node --loader ./tests/three-loader.mjs 3d/tools/build-princess60-lod.mjs <cell metres> <level>
// The viewer uses level 1 (0.14 m cells) and level 2 (0.35 m cells).
import fs from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import {createPrincess60NhaRong} from '../princess60-nharong.js';

const CELL = Number(process.argv[2] || 0.14), LEVEL = process.argv[3] || '1';
const yacht = createPrincess60NhaRong();
yacht.group.updateMatrixWorld(true);
const root = yacht.group.matrixWorld.clone().invert();
// Gather every triangle in the yacht's own frame, by material.
const byMaterial = new Map();
yacht.group.traverse(o => {
  if (!o.isMesh || !o.visible || o.material === yacht.materials.flag || o.material === yacht.materials.star) return;   // the city hangs the shared, waving flag instead
  const m = new THREE.Matrix4().multiplyMatrices(root, o.matrixWorld), g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
  const p = g.attributes.position, v = new THREE.Vector3(), list = byMaterial.get(o.material) ?? [];
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m); list.push(v.x, v.y, v.z); }
  byMaterial.set(o.material, list);
});
// Vertex clustering: snap each vertex to its cell's average, drop triangles
// that collapse and duplicates. Cells are per material, so colours stay put.
const out = [];
let before = 0, after = 0;
for (const [material, pos] of byMaterial) {
  before += pos.length / 9;
  const key = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  const cells = new Map(), ids = new Int32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) {
    const k = key(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
    let c = cells.get(k); if (!c) { c = {id: cells.size, x: 0, y: 0, z: 0, n: 0}; cells.set(k, c); }
    c.x += pos[3 * i]; c.y += pos[3 * i + 1]; c.z += pos[3 * i + 2]; c.n++; ids[i] = c.id;
  }
  const centres = new Float32Array(cells.size * 3);
  for (const c of cells.values()) { centres[3 * c.id] = c.x / c.n; centres[3 * c.id + 1] = c.y / c.n; centres[3 * c.id + 2] = c.z / c.n; }
  const seen = new Set(), tri = [];
  for (let t = 0; t < ids.length; t += 3) {
    const a = ids[t], b = ids[t + 1], c = ids[t + 2];
    if (a === b || b === c || a === c) continue;
        const k = `${a},${b},${c}`, r = [b, c, a].join(','), r2 = [c, a, b].join(',');
    if (seen.has(k) || seen.has(r) || seen.has(r2)) continue;
    seen.add(k); tri.push(a, b, c);
  }
  after += tri.length / 3;
  if (!tri.length) continue;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(centres, 3));
  g.setIndex(new THREE.BufferAttribute(cells.size > 65535 ? new Uint32Array(tri) : new Uint16Array(tri), 1));
  const flat = g.toNonIndexed(); flat.computeVertexNormals();                 // flat shading reads crisp at a distance
  out.push({material, geometry: flat});
}
// Write a GLB: one node per material.
const gltf = {asset: {version: '2.0', generator: `Rainmap / Princess 60 Nha Rong LOD${LEVEL}`}, scene: 0, scenes: [{nodes: [0]}], nodes: [{name: `princess60-nharong-lod${LEVEL}`, children: []}], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: []};
const chunks = []; let offset = 0;
const accessor = (array, type, target, min, max) => {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength), view = gltf.bufferViews.length;
  gltf.bufferViews.push({buffer: 0, byteOffset: offset, byteLength: bytes.length, target}); chunks.push(bytes); offset += bytes.length;
  const pad = (4 - offset % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  gltf.accessors.push({bufferView: view, componentType: 5126, count: array.length / 3, type, ...(min ? {min, max} : {})}); return gltf.accessors.length - 1;
};
for (const {material: m, geometry: g} of out) {
  const mat = gltf.materials.length;
  gltf.materials.push({name: m.name || `m${mat}`, pbrMetallicRoughness: {baseColorFactor: [m.color.r, m.color.g, m.color.b, m.opacity], metallicFactor: m.metalness, roughnessFactor: m.roughness}, emissiveFactor: m.emissive.toArray().map(v => v * m.emissiveIntensity), doubleSided: true, alphaMode: m.transparent ? 'BLEND' : 'OPAQUE'});
  g.computeBoundingBox();
  const POSITION = accessor(g.attributes.position.array, 'VEC3', 34962, g.boundingBox.min.toArray(), g.boundingBox.max.toArray()), NORMAL = accessor(g.attributes.normal.array, 'VEC3', 34962);
  gltf.nodes[0].children.push(gltf.nodes.length); gltf.nodes.push({name: `lod${LEVEL}-${mat}`, mesh: gltf.meshes.length});
  gltf.meshes.push({primitives: [{attributes: {POSITION, NORMAL}, material: mat, mode: 4}]});
}
gltf.buffers = [{byteLength: offset}];
const raw = Buffer.from(JSON.stringify(gltf)), json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 0x20); raw.copy(json);
const bin = Buffer.concat(chunks), header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
jh.writeUInt32LE(json.length); jh.writeUInt32LE(0x4e4f534a, 4); bh.writeUInt32LE(bin.length); bh.writeUInt32LE(0x004e4942, 4);
const path = new URL(`../assets/princess60-nharong-lod${LEVEL}.glb`, import.meta.url);
fs.writeFileSync(path, Buffer.concat([header, jh, json, bh, bin]));
console.log(`cell ${CELL} m: ${before} -> ${after} triangles (${(after / before * 100).toFixed(1)}%), ${out.length} meshes, ${(fs.statSync(path).size / 1048576).toFixed(2)} MiB`);
yacht.dispose();
