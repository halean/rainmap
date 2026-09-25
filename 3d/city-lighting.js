// Nearby nighttime street lights, without shadow maps.
import * as THREE from 'three';

export function createCityLighting({scene, camera, controls, sky}) {
  const state = {lights: true, activeLights: 0};
  const eye = new THREE.Vector3();
  const candidates = new Map();
  const lamps = Array.from({length: 8}, () => {
    const light = new THREE.SpotLight('#ffd39a', 0, 180, Math.PI * 0.36, 0.55, 2);
    scene.add(light, light.target);
    return light;
  });
  let lastSelection = -Infinity;
  let disposed = false;

  function register(root) {
    if (!root) return;
    root.updateWorldMatrix(true, true);
    const points = [], cells = new Set(), v = new THREE.Vector3();
    root.traverse(o => {
      if (!(o.isMesh || o.isLineSegments) || !['major', 'bridge', 'street'].includes(o.name)) return;
      const p = o.geometry.getAttribute('position');
      if (!p) return;
      const stride = Math.max(1, Math.ceil(p.count / 1500));
      for (let i = 0; i < p.count; i += stride) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        const key = `${Math.round(v.x / 90)},${Math.round(v.z / 90)}`;
        if (cells.has(key)) continue;
        cells.add(key); points.push(v.clone());
      }
    });
    candidates.set(root, points);
    lastSelection = -Infinity;
  }

  function unregister(root) { candidates.delete(root); lastSelection = -Infinity; }

  function update(nowMs) {
    if (disposed) return;
    camera.getWorldPosition(eye);
    const local = eye.distanceTo(controls.target) < 6000;
    const night = sky.state.cityLights ?? 0;
    const active = state.lights && local && night > 0.01;
    if (active && nowMs - lastSelection > 500) {
      const near = [];
      for (const [root, points] of candidates) {
        if (!root.visible) continue;
        for (const point of points) {
          const distance = point.distanceToSquared(controls.target);
          if (distance < 1500 ** 2) near.push({point, distance});
        }
      }
      near.sort((a, b) => a.distance - b.distance);
      const chosen = [];
      for (const item of near) {
        if (chosen.every(p => p.distanceToSquared(item.point) > 90 ** 2)) chosen.push(item.point);
        if (chosen.length === lamps.length) break;
      }
      lamps.forEach((light, i) => {
        light.userData.placed = !!chosen[i];
        if (!chosen[i]) return;
        const point = chosen[i];
        if (!light.userData.positioned || light.target.position.distanceToSquared(point) > 0.01) {
          light.position.copy(point).add(new THREE.Vector3(0, 26, 0));
          light.target.position.copy(point);
          light.userData.positioned = true;
        }
      });
      lastSelection = nowMs;
    }
    state.activeLights = 0;
    for (const light of lamps) {
      light.visible = active && !!light.userData.placed;
      light.intensity = light.visible ? 2200 * night : 0;
      if (light.visible) state.activeLights++;
    }

  }

  function dispose() {
    disposed = true; candidates.clear();
    for (const light of lamps) { scene.remove(light, light.target); light.dispose(); }
  }
  return {state, register, unregister, update, dispose};
}
