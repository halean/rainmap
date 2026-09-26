// Shared pieces for schematic landmark models whose footprint is an OSM
// outline rather than a few rectangles (majestic.js, rex.js, opera-house.js, state-bank.js). The same
// conventions as notre-dame.js: geometry merged into one mesh per material,
// mesh names that don't start with 'building' (so the generic facade shader
// leaves them alone), and replaceGeneric() removing only the generic OSM
// building triangles wholly inside the landmark's footprint.
//
// Local frame: x along the outline's main axis (u), z across it (v), y up.
// Outlines are [u, v] points in metres around the model origin.
import * as THREE from 'three';
import {mergeGeometries} from './vendor/utils/BufferGeometryUtils.js';

/** Collects geometry per material key; finish() merges it into meshes. */
export function builder(materials, prefix) {
  const parts = Object.fromEntries(Object.keys(materials).map(k => [k, []]));
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  function add(key, geometry, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) {
    quaternion.setFromEuler(new THREE.Euler(rx, ry, rz));
    matrix.compose(new THREE.Vector3(px, py, pz), quaternion, one);
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    if (g.attributes.uv) g.deleteAttribute('uv');
    g.applyMatrix4(matrix); parts[key].push(g);
  }
  function box(key, w, h, d, px, py, pz, yaw = 0) { add(key, new THREE.BoxGeometry(w, h, d), px, py, pz, 0, yaw); }
  function finish(group) {
    let triangles = 0;
    for (const [key, geometries] of Object.entries(parts)) {
      if (!geometries.length) continue;
      const geometry = mergeGeometries(geometries, false);
      for (const g of geometries) g.dispose();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, materials[key]); mesh.name = `${prefix}-${key}`;
      triangles += geometry.attributes.position.count / 3; group.add(mesh);
    }
    return triangles;
  }
  return {add, box, finish};
}

/** A prism over the outline from y0 to y1 (a floor slab, the body, a roof). */
export function extrude(outline, y0, y1) {
  const shape = new THREE.Shape(outline.map(([u, v]) => new THREE.Vector2(u, -v)));
  const g = new THREE.ExtrudeGeometry(shape, {depth: y1 - y0, bevelEnabled: false});
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return g;
}

/** A round-headed opening w wide and h tall (base at y 0), `depth` thick,
 *  centred on z 0: a window, door or arcade bay. */
export function arch(w, h, depth, curveSegments = 4) {
  const r = w / 2, s = new THREE.Shape();
  s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, h - r); s.absarc(0, h - r, r, 0, Math.PI, false); s.lineTo(-r, 0);
  const g = new THREE.ExtrudeGeometry(s, {depth, bevelEnabled: false, curveSegments}); g.translate(0, 0, -depth / 2);
  return g;
}

export function insideOutline([u, v], outline) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ui, vi] = outline[i], [uj, vj] = outline[j];
    if ((vi > v) !== (vj > v) && u < (uj - ui) * (v - vi) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
}

function distanceToEdge([u, v], [u0, v0], [u1, v1]) {
  const du = u1 - u0, dv = v1 - v0, t = Math.max(0, Math.min(1, ((u - u0) * du + (v - v0) * dv) / (du * du + dv * dv || 1e-9)));
  return Math.hypot(u0 + t * du - u, v0 + t * dv - v);
}

/** Edge i of the outline: start, unit direction, length, outward normal, and
 *  the yaw that turns a box's local x along it. */
export function edge(outline, i) {
  const [u0, v0] = outline[i], [u1, v1] = outline[(i + 1) % outline.length];
  const len = Math.hypot(u1 - u0, v1 - v0), du = (u1 - u0) / len, dv = (v1 - v0) / len;
  let nu = dv, nv = -du;
  const mid = [(u0 + u1) / 2 + nu * 0.3, (v0 + v1) / 2 + nv * 0.3];
  if (insideOutline(mid, outline)) { nu = -nu; nv = -nv; }
  return {u0, v0, du, dv, len, nu, nv, yaw: Math.atan2(-dv, du)};
}

/** Remove, from streamed OSM tiles, the generic building triangles lying
 *  wholly inside the outline (grown by `margin`) and below `top` -- the
 *  landmark's own generic block, and nothing next to it. Idempotent per mesh
 *  via userData[flag]; returns the number of triangles removed. */
export function genericReplacer(group, outline, {margin = 0.8, top = 200, flag}) {
  group.updateWorldMatrix(true, true);
  const inverse = group.matrixWorld.clone().invert(), v = new THREE.Vector3();
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const [u, w] of outline) { umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, w); vmax = Math.max(vmax, w); }
  const worldBox = new THREE.Box3(new THREE.Vector3(umin - margin, -1, vmin - margin), new THREE.Vector3(umax + margin, top, vmax + margin)).applyMatrix4(group.matrixWorld);
  // Inside the outline, or within `margin` of it: the generic walls stand
  // exactly on the outline, and the outline is often concave.
  const near = p => insideOutline(p, outline) || outline.some((_, i) => distanceToEdge(p, outline[i], outline[(i + 1) % outline.length]) <= margin);
  return function replaceGeneric(root) {
    if (!root) return 0;
    root.updateWorldMatrix(true, true); let removed = 0;
    root.traverse(o => {
      if (!o.isMesh || !o.name.startsWith('building') || o.userData[flag]) return;
      o.userData[flag] = true;
      const original = o.geometry;
      if (!original.boundingBox) original.computeBoundingBox();
      if (!original.boundingBox.clone().applyMatrix4(o.matrixWorld).intersectsBox(worldBox)) return;
      const g = original.index ? original.toNonIndexed() : original, p = g.attributes.position;
      const transform = new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld), keep = [];
      let cut = 0;
      for (let i = 0; i < p.count; i += 3) {
        let inside = true;
        for (let j = 0; j < 3 && inside; j++) {
          v.fromBufferAttribute(p, i + j).applyMatrix4(transform);
          inside = v.y > -1 && v.y < top && near([v.x, v.z]);
        }
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
  };
}

/** The outline with each edge i moved inward by offsets[i] metres (0 keeps
 *  it): a set-back upper floor. Corners are mitred; nearly straight corners
 *  just move along the normal. */
export function insetOutline(outline, offsets) {
  const n = outline.length, edges = outline.map((_, i) => edge(outline, i));
  return outline.map((p, i) => {
    const a = edges[(i - 1 + n) % n], b = edges[i], da = offsets[(i - 1 + n) % n] || 0, db = offsets[i] || 0;
    // Solve na.q = -da, nb.q = -db for the corner's displacement q.
    const det = a.nu * b.nv - a.nv * b.nu;
    if (Math.abs(det) < 0.05) { const d = Math.max(da, db); return [p[0] - b.nu * d, p[1] - b.nv * d]; }
    const qu = (-da * b.nv + db * a.nv) / det, qv = (-db * a.nu + da * b.nu) / det;
    return [p[0] + qu, p[1] + qv];
  });
}

// Capital letters as strokes in a unit cell (x right, y up).
const GLYPHS = {
  A: [[0, 0, 0.5, 1], [0.5, 1, 1, 0], [0.22, 0.42, 0.78, 0.42]],
  C: [[1, 1, 0, 1], [0, 1, 0, 0], [0, 0, 1, 0]],
  E: [[0, 0, 0, 1], [0, 1, 1, 1], [0, 0.5, 0.8, 0.5], [0, 0, 1, 0]],
  G: [[1, 1, 0, 1], [0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 1, 0.45], [1, 0.45, 0.55, 0.45]],
  H: [[0, 0, 0, 1], [1, 0, 1, 1], [0, 0.5, 1, 0.5]],
  I: [[0.5, 0, 0.5, 1], [0.2, 1, 0.8, 1], [0.2, 0, 0.8, 0]],
  J: [[0.3, 1, 1, 1], [0.8, 1, 0.8, 0.15], [0.8, 0.15, 0.6, 0], [0.6, 0, 0.1, 0], [0.1, 0, 0, 0.2]],
  L: [[0, 0, 0, 1], [0, 0, 1, 0]],
  M: [[0, 0, 0, 1], [1, 0, 1, 1], [0, 1, 0.5, 0.45], [0.5, 0.45, 1, 1]],
  N: [[0, 0, 0, 1], [0, 1, 1, 0], [1, 0, 1, 1]],
  O: [[0, 0, 0, 1], [1, 0, 1, 1], [0, 1, 1, 1], [0, 0, 1, 0]],
  R: [[0, 0, 0, 1], [0, 1, 0.8, 1], [0.8, 1, 1, 0.8], [1, 0.8, 1, 0.62], [1, 0.62, 0.8, 0.5], [0, 0.5, 0.8, 0.5], [0.35, 0.5, 1, 0]],
  S: [[1, 1, 0, 1], [0, 1, 0, 0.5], [0, 0.5, 1, 0.5], [1, 0.5, 1, 0], [1, 0, 0, 0]],
  T: [[0.5, 0, 0.5, 1], [0, 1, 1, 1]],
  X: [[0, 0, 1, 1], [0, 1, 1, 0]],
};

/** Block letters built from bars, h tall, centred on x 0 with their base at
 *  y 0, reading left to right seen from +z: no font to load. */
export function letters(text, {h = 1, w = 0.7 * h, stroke = 0.14 * h, gap = 0.3 * h, depth = stroke} = {}) {
  const parts = [], span = text.length * w + (text.length - 1) * gap;
  [...text].forEach((ch, k) => {
    const x0 = -span / 2 + k * (w + gap);
    for (const [a0, b0, a1, b1] of GLYPHS[ch] || []) {
      const dx = (a1 - a0) * w, dy = (b1 - b0) * h;
      const g = new THREE.BoxGeometry(Math.hypot(dx, dy) + stroke, stroke, depth).toNonIndexed();
      g.deleteAttribute('uv');
      g.rotateZ(Math.atan2(dy, dx)); g.translate(x0 + (a0 + a1) / 2 * w, (b0 + b1) / 2 * h, 0);
      parts.push(g);
    }
  });
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

/** The yaw that turns a geometry's +z to face along the outward normal (nu, nv). */
export const facing = (nu, nv) => Math.atan2(nu, nv);

/** A tapering tower over `outline`: the outline scaled about `centre` by
 *  scale(y) at each height in `levels` (ascending), each column cut off at
 *  top([u, v]) -- a flat or sloping roof -- and capped there. Returns the
 *  walls and the cap as one geometry, and the rings for adding floor bands. */
export function loft(outline, {levels, scale = () => 1, centre = [0, 0], top}) {
  // Walls face outward when the outline runs clockwise in (x, z).
  const area = outline.reduce((sum, [u0, v0], i) => { const [u1, v1] = outline[(i + 1) % outline.length]; return sum + u0 * v1 - u1 * v0; }, 0);
  if (area > 0) outline = [...outline].reverse();
  const at = ([u, v], y) => { const s = scale(y); return [centre[0] + (u - centre[0]) * s, centre[1] + (v - centre[1]) * s]; };
  const tops = outline.map(p => top(p)), n = outline.length, positions = [], rings = [];
  const ys = [...new Set([...levels.filter(y => y < Math.max(...tops)), ...tops])].sort((a, b) => a - b);
  let previous = null;
  for (const y of ys) {
    const ring = outline.map((p, i) => { const h = Math.min(y, tops[i]); const [u, v] = at(p, h); return [u, h, v]; });
    if (levels.includes(y)) rings.push({y, ring});
    if (previous) for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = previous[i], b = previous[j], c = ring[j], d = ring[i];
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    previous = ring;
  }
  // The cap: the outline at its tops, triangulated in plan.
  const plan = outline.map((p, i) => { const [u, v] = at(p, tops[i]); return new THREE.Vector2(u, v); });
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(plan, [])) {
    const P = k => [plan[k].x, tops[k], plan[k].y];
    positions.push(...P(a), ...P(c), ...P(b));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return {geometry: g, rings};
}

/** Thin bands proud of a loft's rings: floor lines on a curtain wall. */
export function bands(rings, {out = 0.25, height = 0.35, centre = [0, 0]} = {}) {
  const positions = [];
  for (const {y, ring} of rings) {
    const n = ring.length;
    const push = ([u, , v]) => { const du = u - centre[0], dv = v - centre[1], l = Math.hypot(du, dv) || 1; return [u + du / l * out, v + dv / l * out]; };
    for (let i = 0; i < n; i++) {
      const [u0, v0] = push(ring[i]), [u1, v1] = push(ring[(i + 1) % n]);
      if (ring[i][1] < y - 0.01 || ring[(i + 1) % n][1] < y - 0.01) continue;   // above a sloping roof
      positions.push(u0, y, v0, u1, y, v1, u1, y + height, v1, u0, y, v0, u1, y + height, v1, u0, y + height, v0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}
