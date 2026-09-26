// The North-South railway through the city -- from Sài Gòn station (Hòa
// Hưng) north through Gò Vấp, over the Saigon at Bình Lợi, to Dĩ An -- with
// the sidings and yards around it, chiefly at Sài Gòn station and Sóng Thần.
// The generic city model has no railways. Track is metre gauge on a ballast
// bed at street level (the terrain is flat); where OSM marks a rail bridge,
// the bed sits on a concrete deck on piers. The Bình Lợi bridge itself is in
// bridges.js, and meets this track at rail level. See RAILWAY.md.
import * as THREE from 'three';
import {RAILWAY_WAYS} from './railway-lines.js';

export const RAIL = Object.freeze({gauge: 1.0, ballastTop: 0.45, railTop: 0.6});

/** Offset a polyline sideways by `o` (left positive) with mitred joins. */
function offset(points, o) {
  const n = points.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)], p = points[i];
    let nx = 0, nz = 0;
    for (const [u, v] of [[a, p], [p, b]]) {
      const dx = v[0] - u[0], dz = v[1] - u[1], l = Math.hypot(dx, dz);
      if (l > 1e-6) { nx += dz / l; nz += -dx / l; }
    }
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    // Lengthen at corners so both sides stay parallel, within reason.
    let m = 1;
    if (i > 0 && i < n - 1) { const dx = b[0] - p[0], dz = b[1] - p[1], L = Math.hypot(dx, dz) || 1; m = 1 / Math.max(0.5, nx * dz / L - nz * dx / L); }
    out.push([p[0] + nx * o * m, p[1] + nz * o * m]);
  }
  return out;
}

export function createRailway({scene, project}) {
  const group = new THREE.Group(); group.name = 'railway';
  const materials = {
    ballast: new THREE.MeshStandardMaterial({color: '#80776c', roughness: 1}),
    rail: new THREE.MeshStandardMaterial({color: '#9a9ea2', roughness: 0.35, metalness: 0.7}),
    concrete: new THREE.MeshStandardMaterial({color: '#bdbbb5', roughness: 0.85}),
  };
  const parts = {ballast: [], rail: [], concrete: []};
  // A prism along the polyline: cross-section [[offset, y], ...] (left to
  // right along the top), open at the ends, faces outward.
  function prism(key, pts, section) {
    const sides = section.map(([o]) => offset(pts, o)), out = parts[key];
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < section.length - 1; k++) {
      const [a, b] = [sides[k][i], sides[k][i + 1]], [c, d] = [sides[k + 1][i], sides[k + 1][i + 1]];
      const ya = section[k][1], yc = section[k + 1][1];
      out.push(a[0], ya, a[1], c[0], yc, c[1], b[0], ya, b[1], c[0], yc, c[1], d[0], yc, d[1], b[0], ya, b[1]);
    }
  }
  const {gauge, ballastTop: B, railTop: R} = RAIL;
  const stats = {main: 0, siding: 0, bridge: 0};
  for (const way of RAILWAY_WAYS) {
    const pts = way.pts.map(([lon, lat]) => project(lon, lat));
    const length = pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
    stats[way.kind] += length;
    const top = way.kind === 'main' ? 1.5 : 1.3, foot = top + 0.8;
    // The ballast bed: a low trapezoid, its top 0.45 m up.
    prism('ballast', pts, [[foot, 0.02], [top, B], [-top, B], [-foot, 0.02]]);
    // Two rails, each a narrow bar standing on the ballast.
    for (const side of [-1, 1]) {
      const c = side * gauge / 2;
      prism('rail', pts, [[c + 0.04, B], [c + 0.04, R], [c - 0.04, R], [c - 0.04, B]]);
    }
    if (way.bridge) {
      stats.bridge += length;
      prism('concrete', pts, [[foot + 0.4, -0.7], [foot + 0.4, 0.05], [-foot - 0.4, 0.05], [-foot - 0.4, -0.7]]);
      for (let s = 0; s <= length; s += 12) {                     // piers under the deck
        let t = s, i = 0;
        while (i < pts.length - 2 && t > Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])) { t -= Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); i++; }
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az) || 1, f = Math.min(1, t / l);
        const g = new THREE.BoxGeometry(foot * 2, 2.2, 1.2);
        g.rotateY(Math.atan2(bx - ax, bz - az)); g.translate(ax + (bx - ax) * f, -1.8, az + (bz - az) * f);
        const p = g.toNonIndexed().attributes.position.array; parts.concrete.push(...p);
      }
    }
  }
  let triangles = 0;
  for (const [key, array] of Object.entries(parts)) {
    if (!array.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(array, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, materials[key]);
    mesh.name = `railway-${key}`;
    // Both faces: the prisms' winding follows each way's direction.
    materials[key].side = THREE.DoubleSide;
    group.add(mesh); triangles += array.length / 9;
  }
  scene.add(group);
  const state = {ways: RAILWAY_WAYS.length, mainKm: +(stats.main / 1000).toFixed(1), sidingKm: +(stats.siding / 1000).toFixed(1), bridgeM: Math.round(stats.bridge), triangles, drawCalls: group.children.length};
  return {group, state, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
