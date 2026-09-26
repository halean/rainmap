// Detailed towers from a footprint, a height and a facade style: every floor,
// every bay -- glass, mullions, spandrels, slab edges, balconies -- written
// straight into vertex buffers, one per material, so a 100k-triangle tower
// builds in tens of milliseconds. Used by riverfront.js. Coordinates are
// local metres, x east, z south, y up.
import * as THREE from 'three';

/** Signed area in (x, z); positive when the outline runs clockwise seen from above. */
const area = pts => pts.reduce((s, [x0, z0], i) => { const [x1, z1] = pts[(i + 1) % pts.length]; return s + x0 * z1 - x1 * z0; }, 0);
/** The outline shrunk by d metres, corner by corner (mitred, clamped). */
export function inset(pts, d) {
  if (!d) return pts;
  const n = pts.length, s = Math.sign(area(pts)) || 1;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const n1 = norm(p[0] - a[0], p[1] - a[1]), n2 = norm(b[0] - p[0], b[1] - p[1]);
    // Inward normals (left of travel for clockwise-positive winding).
    const i1 = [-n1[1] * s, n1[0] * s], i2 = [-n2[1] * s, n2[0] * s];
    let mx = i1[0] + i2[0], mz = i1[1] + i2[1]; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = d / Math.max(0.35, mx * i1[0] + mz * i1[1]);
    return [p[0] + mx * k, p[1] + mz * k];
  });
}
const norm = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

/** Round the corners of an outline: each corner replaced by an arc of radius r. */
export function roundCorners(pts, r, seg = 5) {
  if (!r) return pts;
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const da = norm(a[0] - p[0], a[1] - p[1]), db = norm(b[0] - p[0], b[1] - p[1]);
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]), rr = Math.min(r, la * 0.45, lb * 0.45);
    const s0 = [p[0] + da[0] * rr, p[1] + da[1] * rr], s1 = [p[0] + db[0] * rr, p[1] + db[1] * rr];
    for (let k = 0; k <= seg; k++) {                                  // quadratic curve through the corner
      const t = k / seg, u = 1 - t;
      out.push([u * u * s0[0] + 2 * u * t * p[0] + t * t * s1[0], u * u * s0[1] + 2 * u * t * p[1] + t * t * s1[1]]);
    }
  }
  return out;
}

/** Collects triangles per material; finish() makes one mesh each. */
export function emitter(materials, prefix) {
  const buf = Object.fromEntries(Object.keys(materials).map(k => [k, []]));
  const quad = (key, a, b, c, d) => buf[key].push(...a, ...b, ...c, ...a, ...c, ...d);
  const tri = (key, a, b, c) => buf[key].push(...a, ...b, ...c);
  function finish(group) {
    let triangles = 0;
    for (const [key, arr] of Object.entries(buf)) {
      if (!arr.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals(); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, materials[key]); m.name = `${prefix}-${key}`;
      group.add(m); triangles += arr.length / 9;
    }
    return triangles;
  }
  return {quad, tri, finish, buf};
}

/** A prism of cross-section along an edge from a to b: for mullions, ledges, slabs.
 *  Given the outward normal (nx, nz); `out` and `depth` in metres, y0-y1 height. */
function fin(e, key, a, b, nx, nz, y0, y1, out, back = 0) {
  const A0 = [a[0] + nx * back, y0, a[1] + nz * back], B0 = [b[0] + nx * back, y0, b[1] + nz * back];
  const A1 = [a[0] + nx * out, y0, a[1] + nz * out], B1 = [b[0] + nx * out, y0, b[1] + nz * out];
  const up = p => [p[0], y1, p[2]];
  e.quad(key, A1, B1, up(B1), up(A1));                               // face
  e.quad(key, A0, A1, up(A1), up(A0));                               // ends
  e.quad(key, B1, B0, up(B0), up(B1));
  e.quad(key, up(A1), up(B1), up(B0), up(A0));                       // top
  e.quad(key, A0, B0, B1, A1);                                        // underside
}

/**
 * One shaft of a tower: the outline extruded from y0 to y1 as a facade of
 * `floors` storeys. style:
 *  - kind 'curtain': glass with vertical mullions every `bay` m, a spandrel
 *    band and a slab-edge ledge at each floor, a transom at `transom`.
 *  - kind 'residential': wall with a window per bay, a balcony slab and
 *    glass railing on every `balconyEvery`-th bay, piers between bays.
 * Materials by key: glass, frame, spandrel, wall, rail, slab.
 */
export function shaft(e, outline, {y0, y1, floors, style}) {
  const pts = outline, n = pts.length, s = Math.sign(area(pts)) || 1, fh = (y1 - y0) / floors;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) continue;
    const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len, nx = tz * s, nz = -tx * s;   // outward normal
    const P = (t, y, o = 0) => [a[0] + tx * t + nx * o, y, a[1] + tz * t + nz * o], XZ = t => [a[0] + tx * t, a[1] + tz * t], G = style.glassKey ?? 'glass';
    const bays = Math.max(1, Math.round(len / style.bay)), bw = len / bays;
    for (let f = 0; f < floors; f++) {
      const fy = y0 + f * fh, top = fy + fh;
      if (style.kind === 'curtain') {
        const sp = fy + fh * (style.spandrel ?? 0.22);
        e.quad(style.spandrelKey ?? 'spandrel', P(0, fy), P(len, fy), P(len, sp), P(0, sp));
        for (let k = 0; k < bays; k++) {
          const t0 = k * bw, t1 = t0 + bw;
          if (style.transom) {
            const tr = sp + (top - sp) * style.transom;
            e.quad(G, P(t0, sp), P(t1, sp), P(t1, tr), P(t0, tr));
            e.quad(style.upperKey ?? G, P(t0, tr), P(t1, tr), P(t1, top), P(t0, top));
          } else e.quad(G, P(t0, sp), P(t1, sp), P(t1, top), P(t0, top));
          if (style.mullion) fin(e, style.mullionKey ?? 'frame', XZ(t0 - style.mullion / 2), XZ(t0 + style.mullion / 2), nx, nz, fy, top, style.mullionDepth ?? 0.12);
        }
        if (style.ledge) fin(e, 'frame', [a[0], a[1]], [b[0], b[1]], nx, nz, fy, fy + style.ledge, style.ledgeDepth ?? 0.18);
      } else {
        // Residential: wall below and above each window, piers between.
        const sill = fy + fh * 0.28, head = fy + fh * 0.86, w = style.window ?? 0.7;
        e.quad('wall', P(0, fy), P(len, fy), P(len, sill), P(0, sill));
        e.quad('wall', P(0, head), P(len, head), P(len, top), P(0, top));
        for (let k = 0; k < bays; k++) {
          const t0 = k * bw, g0 = t0 + bw * (1 - w) / 2, g1 = t0 + bw * (1 + w) / 2;
          e.quad('wall', P(t0, sill), P(g0, sill), P(g0, head), P(t0, head));
          e.quad('wall', P(g1, sill), P(t0 + bw, sill), P(t0 + bw, head), P(g1, head));
          e.quad(G, P(g0, sill, -0.15), P(g1, sill, -0.15), P(g1, head, -0.15), P(g0, head, -0.15));
          // Window reveals.
          e.quad('wall', P(g0, sill), P(g0, sill, -0.15), P(g0, head, -0.15), P(g0, head));
          e.quad('wall', P(g1, sill, -0.15), P(g1, sill), P(g1, head), P(g1, head, -0.15));
          if (style.balconyEvery && (k + (f % 2) * (style.stagger ? 1 : 0)) % style.balconyEvery === 0 && f > 0) {
            fin(e, 'slab', [a[0] + tx * (t0 + 0.1), a[1] + tz * (t0 + 0.1)], [a[0] + tx * (t0 + bw - 0.1), a[1] + tz * (t0 + bw - 0.1)], nx, nz, fy, fy + 0.18, style.balconyDepth ?? 1.4);
            e.quad('rail', P(t0 + 0.1, fy + 0.18, style.balconyDepth ?? 1.4), P(t0 + bw - 0.1, fy + 0.18, style.balconyDepth ?? 1.4), P(t0 + bw - 0.1, fy + 1.2, style.balconyDepth ?? 1.4), P(t0 + 0.1, fy + 1.2, style.balconyDepth ?? 1.4));
          }
        }
        if (style.pier && bays > 1) for (let k = style.pier; k < bays; k += style.pier) fin(e, 'frame', [a[0] + tx * (k * bw - 0.3), a[1] + tz * (k * bw - 0.3)], [a[0] + tx * (k * bw + 0.3), a[1] + tz * (k * bw + 0.3)], nx, nz, fy, top, 0.35);
      }
    }
  }
}

/** A flat roof over an outline at height y (triangulated). */
export function roof(e, key, outline, y) {
  const shape = outline.map(([x, z]) => new THREE.Vector2(x, z));
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(shape, [])) {
    const P = k => [outline[k][0], y, outline[k][1]];
    const up = (area(outline) > 0) ? [P(a), P(c), P(b)] : [P(a), P(b), P(c)];
    e.tri(key, ...up);
  }
}
/** A plain band round an outline, y0-y1, standing `out` proud: parapets, fascias, podium walls. */
export function band(e, key, outline, y0, y1, out = 0) {
  const n = outline.length, s = Math.sign(area(outline)) || 1;
  for (let i = 0; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.05) continue;
    const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len, nx = tz * s, nz = -tx * s;
    if (out) fin(e, key, a, b, nx, nz, y0, y1, out); else e.quad(key, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]);
  }
}
