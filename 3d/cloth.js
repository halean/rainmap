// Metres, seconds, kilograms. No renderer, DOM, or clock dependency.
// XPBD distance constraints: https://matthias-research.github.io/pages/publications/XPBD.pdf
export class Cloth {
  constructor({length = 64.6, height = 43.1, columns = 31, rows = 21,
    top = 91, floor = 2, poleRadius = 0.85, density = 0.3,
    airDensity = 1.2, normalDrag = 1.2, tangentialDrag = 0.04,
    damping = 0.12, bendCompliance = 0.025, turbulence = 1,
    iterations = 4} = {}) {
    if (![length, height, density, airDensity].every(v => Number.isFinite(v) && v > 0) ||
        ![top, floor, poleRadius, normalDrag, tangentialDrag, damping, bendCompliance, turbulence].every(Number.isFinite) ||
        floor > top - height || poleRadius < 0 || poleRadius >= length / (columns - 1) ||
        Math.min(normalDrag, tangentialDrag, damping, bendCompliance, turbulence) < 0 ||
        ![columns, rows, iterations].every(Number.isInteger) || columns < 3 || rows < 3 || columns * rows > 65535 || iterations < 1) {
      throw new RangeError('Invalid cloth dimensions or material parameters');
    }
    Object.assign(this, {length, height, columns, rows, top, floor, poleRadius, density,
      airDensity, normalDrag, tangentialDrag, damping, bendCompliance, turbulence, iterations});
    this.dt = 1 / 120;
    this.time = 0;
    const count = columns * rows;
    this.positions = new Float32Array(count * 3);
    this.previous = new Float32Array(count * 3);
    this.forces = new Float32Array(count * 3);
    this.drag = new Float32Array(count);
    this.inverseMass = new Float32Array(count);
    this.rowWind = new Float32Array(rows * 3);
    const dx = length / (columns - 1), dy = height / (rows - 1);
    const triangles = [], a = [], b = [], rest = [], compliance = [];
    const link = (i, j, distance, softness) => {
      a.push(i); b.push(j); rest.push(distance); compliance.push(softness / this.dt ** 2);
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      const i = r * columns + c, k = i * 3;
      this.positions[k] = c * dx;
      this.positions[k + 1] = top - r * dy;
      // Tiny initial imperfection breaks planar symmetry; never prescribed motion.
      this.positions[k + 2] = 0.08 * c / (columns - 1) * Math.sin(c * 0.6 + r * 0.4);
      if (c + 1 < columns) link(i, i + 1, dx, 0);
      if (r + 1 < rows) link(i, i + columns, dy, 0);
      if (c + 1 < columns && r + 1 < rows) {
        link(i, i + columns + 1, Math.hypot(dx, dy), 0.000002);
        link(i + 1, i + columns, Math.hypot(dx, dy), 0.000002);
        // Same topology and winding as THREE.PlaneGeometry.
        triangles.push(i, i + columns, i + 1, i + columns, i + columns + 1, i + 1);
      }
      if (c + 2 < columns) link(i, i + 2, 2 * dx, bendCompliance);
      if (r + 2 < rows) link(i, i + 2 * columns, 2 * dy, bendCompliance);
    }
    this.triangles = new Uint16Array(triangles);
    // Lump one third of each triangle's REST mass onto its vertices.
    const mass = new Float32Array(count), triangleMass = density * dx * dy / 6;
    for (const i of triangles) mass[i] += triangleMass;
    for (let i = 0; i < count; i++) this.inverseMass[i] = i % columns ? 1 / mass[i] : 0;
    this.previous.set(this.positions);
    this.linkA = new Uint16Array(a); this.linkB = new Uint16Array(b);
    this.rest = new Float32Array(rest); this.compliance = new Float32Array(compliance);
    this.lambda = new Float32Array(a.length);
  }

  // Exactly one fixed step. Speeds are m/s, not knots. gustSpeed is an
  // optional peak speed, not an additional speed. Zero wind stays truly calm.
  step(windSpeed = 0, gustSpeed = windSpeed) {
    if (!Number.isFinite(windSpeed) || !Number.isFinite(gustSpeed)) throw new RangeError('Non-finite wind');
    const speed = Math.max(0, Math.min(40, windSpeed));
    const gust = Math.max(speed, Math.min(40, gustSpeed));
    const {positions: p, previous: old, forces: f, inverseMass: w, dt, columns, rows} = this;
    const t = this.time;
    f.fill(0); this.drag.fill(0);
    for (let r = 0; r < rows; r++) {
      // Correlated eddies, delayed down the height: the lower hem feels the
      // gust later. They change AIR velocity, never particle positions.
      const phase = t - 1.8 * r / (rows - 1), k = r * 3;
      const pulse = Math.pow(Math.max(0, Math.sin(phase * 0.29 - 1)), 12);
      const variation = 1 + 0.25 * Math.min(3, this.turbulence) *
        (0.45 * Math.sin(phase * 0.47) + 0.20 * Math.sin(phase * 1.13 + 2) + 0.35 * pulse);
      const base = speed * variation;
      const s = gust > speed ? base + (gust - base) * pulse : base;
      const angle = Math.min(3, this.turbulence) * (Math.PI / 18) *
        (0.7 * Math.sin(phase * 0.71) + 0.3 * Math.sin(phase * 1.37 + 0.9));
      // Updrafts and downdrafts: up to ±10° per unit of turbulence (±30° at 3),
      // on their own rhythm, so the flag dips and lifts as well as swinging
      // sideways. Measured at turbulence 3: fly-end up-down swing 1.42 -> 1.88 m
      // at 13 kt and 0.72 -> 1.43 m at 20 kt, extension unchanged (97-99%).
      const lift = Math.min(3, this.turbulence) * (Math.PI / 18) *
        (0.6 * Math.sin(phase * 0.83 + 0.4) + 0.4 * Math.sin(phase * 1.61 + 2.2));
      const level = s * Math.cos(lift);
      this.rowWind[k] = level * Math.cos(angle);
      this.rowWind[k + 1] = s * Math.sin(lift);
      this.rowWind[k + 2] = level * Math.sin(angle);
    }
    const tri = this.triangles, wind = this.rowWind;
    for (let j = 0; j < tri.length; j += 3) {
      const ia = tri[j], ib = tri[j + 1], ic = tri[j + 2];
      const a = ia * 3, b = ib * 3, c = ic * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const area2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (area2 < 1e-9) continue;
      nx /= area2; ny /= area2; nz /= area2;
      const wa = Math.floor(ia / columns) * 3, wb = Math.floor(ib / columns) * 3, wc = Math.floor(ic / columns) * 3;
      const rx = (wind[wa] + wind[wb] + wind[wc] - (p[a] - old[a] + p[b] - old[b] + p[c] - old[c]) / dt) / 3;
      const ry = (wind[wa + 1] + wind[wb + 1] + wind[wc + 1] - (p[a + 1] - old[a + 1] + p[b + 1] - old[b + 1] + p[c + 1] - old[c + 1]) / dt) / 3;
      const rz = (wind[wa + 2] + wind[wb + 2] + wind[wc + 2] - (p[a + 2] - old[a + 2] + p[b + 2] - old[b + 2] + p[c + 2] - old[c + 2]) / dt) / 3;
      const vn = rx * nx + ry * ny + rz * nz;
      const tx = rx - vn * nx, ty = ry - vn * ny, tz = rz - vn * nz;
      const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
      // F = 1/2 rho A [Cd vn |vn| n + Ct |vt| vt], shared equally.
      const q = this.airDensity * area2 / 12;
      const normal = this.normalDrag * vn * Math.abs(vn), tangent = this.tangentialDrag * vt;
      const fx = q * (normal * nx + tangent * tx), fy = q * (normal * ny + tangent * ty), fz = q * (normal * nz + tangent * tz);
      f[a] += fx; f[b] += fx; f[c] += fx;
      f[a + 1] += fy; f[b + 1] += fy; f[c + 1] += fy;
      f[a + 2] += fz; f[b + 2] += fz; f[c + 2] += fz;
      const drag = 2 * q * (this.normalDrag * Math.abs(vn) + tangent);
      this.drag[ia] += drag; this.drag[ib] += drag; this.drag[ic] += drag;
    }
    const decay = Math.exp(-this.damping * dt);
    for (let i = 0; i < w.length; i++) {
      if (!w[i]) continue;
      // Diagonal implicit drag prevents explicit quadratic drag from
      // reversing velocity explosively during a sharp gust.
      const k = i * 3, scale = dt * dt * w[i] / (1 + dt * w[i] * this.drag[i]);
      for (let axis = 0; axis < 3; axis++) {
        const j = k + axis, current = p[j];
        p[j] += (current - old[j]) * decay + f[j] * scale - (axis === 1 ? 9.81 * dt * dt : 0);
        old[j] = current;
      }
    }
    this.lambda.fill(0);
    const {linkA, linkB, rest, compliance, lambda} = this;
    for (let iteration = 0; iteration < this.iterations; iteration++) {
      // Alternating sweeps avoid a persistent diagonal solver bias.
      for (let n = 0; n < rest.length; n++) {
        const j = iteration % 2 ? rest.length - 1 - n : n;
        const ia = linkA[j], ib = linkB[j], sum = w[ia] + w[ib];
        if (!sum) continue;
        const a = ia * 3, b = ib * 3;
        const x = p[b] - p[a], y = p[b + 1] - p[a + 1], z = p[b + 2] - p[a + 2];
        const distance = Math.sqrt(x * x + y * y + z * z);
        if (distance < 1e-9) continue;
        const dl = (distance - rest[j] - compliance[j] * lambda[j]) / (sum + compliance[j]);
        lambda[j] += dl;
        const sa = dl * w[ia] / distance, sb = dl * w[ib] / distance;
        p[a] += x * sa; p[a + 1] += y * sa; p[a + 2] += z * sa;
        p[b] -= x * sb; p[b + 1] -= y * sb; p[b + 2] -= z * sb;
      }
      for (let r = 0; r < rows; r++) for (let c = 1; c < columns; c++) {
        const k = (r * columns + c) * 3, pinY = this.top - r * this.height / (rows - 1);
        // Unilateral long-range tether: limits accumulated stretch without
        // resisting compression/folds as a spring to the rest pose would.
        const x = p[k], y = p[k + 1] - pinY, z = p[k + 2];
        const distance = Math.sqrt(x * x + y * y + z * z), limit = c * this.length / (columns - 1) * 1.015;
        if (distance > limit) {
          const s = limit / distance;
          p[k] *= s; p[k + 1] = pinY + y * s; p[k + 2] *= s;
        }
        // Conservative downstream half-space prevents triangles cutting
        // across the cylinder between particles. The x=0 pinned seam is
        // intentionally embedded in the pole; only that attachment strip
        // may enter its sleeve. This flag cannot wrap around the mast.
        if (p[k] < this.poleRadius) { p[k] = this.poleRadius; old[k] = Math.max(old[k], this.poleRadius); }
        if (p[k + 1] < this.floor) { p[k + 1] = this.floor; old[k + 1] = Math.max(old[k + 1], this.floor); }
      }
    }
    this.time += dt;
  }
}
