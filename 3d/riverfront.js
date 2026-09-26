// The towers along the river tour, modelled in detail from their OSM
// footprints and photographs: Vinhomes Central Park, Saigon Pearl and Sunwah
// Pearl upstream; Grand Marina, The Kross and The Nexus at Ba Son; the
// riverfront from Le Méridien to IFC One -- Vietcombank Tower, Hilton,
// Times Square, the Renaissance Riverside. Each is ~100k triangles of real
// facade (tower-kit.js): every floor and bay.
//
// Levels of detail: at a distance each is a plain block in its colours
// (built at start, a few hundred triangles). Within DETAIL.near of the camera
// its detailed model is built -- one a frame, so the page never stalls --
// and freed once the camera has stayed beyond DETAIL.far for DETAIL.keepMs.
// See RIVERFRONT.md.
import * as THREE from 'three';
import {genericReplacer} from './landmark-kit.js';
import {emitter, shaft, roof, band, inset, roundCorners} from './tower-kit.js';
import {RIVERFRONT_OUTLINES as O} from './riverfront-lines.js';

export const DETAIL = Object.freeze({near: 1600, far: 2400, keepMs: 30000, target: 100000});

const M = (color, o = {}) => new THREE.MeshStandardMaterial({color, roughness: 0.55, ...o});
const GLASS = (color, o = {}) => M(color, {roughness: 0.12, metalness: 0.65, ...o});
function palette(p) {
  return {
    glass: GLASS(p.glass), frame: M(p.frame, {metalness: 0.4, roughness: 0.4}), spandrel: M(p.spandrel ?? p.frame),
    wall: M(p.wall ?? '#e8e2d4', {roughness: 0.85}), rail: GLASS(p.rail ?? '#9bb2bf', {transparent: true, opacity: 0.55, depthWrite: false}),
    slab: M(p.slab ?? p.wall ?? '#e8e2d4', {roughness: 0.8}), roof: M(p.roof ?? '#8a8d90', {roughness: 0.9}),
    accent: M(p.accent ?? p.frame, {metalness: 0.3, roughness: 0.45}), dark: M(p.dark ?? '#2a2e33', {roughness: 0.7}),
    upper: GLASS(p.upper ?? p.glass),
  };
}

// Per-building looks, from photographs (see RIVERFRONT.md). `body` is the
// top of the main shaft; `crown` adds what stands above it.
const CURTAIN = (o = {}) => ({kind: 'curtain', bay: 1.2, mullion: 0.22, mullionDepth: 0.14, ledge: 0.25, spandrel: 0.24, ...o});
const RESIDENTIAL = (o = {}) => ({kind: 'residential', bay: 2.4, window: 0.62, balconyEvery: 2, balconyDepth: 1.3, stagger: false, pier: 3, ...o});
const SPECS = [
  // Upstream: Vinhomes Central Park, nine cream towers of 180 m.
  ...['Park1', 'Park2', 'Park3', 'Park4', 'Park5', 'Park6', 'Park7', 'Central1', 'Central2'].map(n => ({key: `vinhomes${n}`, name: `Vinhomes Central Park – ${n.replace(/(\d)/, ' $1')}`,
    colours: {wall: '#eadfc6', glass: '#394650', frame: '#d9ccb0', slab: '#f1ebdc', roof: '#b9b0a0'}, podium: {h: 12, floors: 3, style: CURTAIN({bay: 3})},
    body: 168, floors: 48, style: RESIDENTIAL(), crown: 'frames'})),
  // Saigon Pearl and Sunwah Pearl.
  {key: 'pearlRuby', name: 'Saigon Pearl – Ruby', colours: {wall: '#e6dcc4', glass: '#3a4550', frame: '#cbbd9f'}, body: 112, floors: 36, style: RESIDENTIAL({balconyEvery: 3}), crown: 'penthouse'},
  {key: 'pearlTopaz', name: 'Saigon Pearl – Topaz', height: 120, colours: {wall: '#e6dcc4', glass: '#3a4550', frame: '#cbbd9f'}, body: 112, floors: 36, style: RESIDENTIAL({balconyEvery: 3}), crown: 'penthouse'},
  ...[['sunwahGolden', 'Golden House', 140], ['sunwahWhite', 'White House', 140], ['sunwahSilver', 'Silver House', 140]].map(([key, n, h]) => ({key, name: `Sunwah Pearl – ${n}`, height: h,
    colours: {wall: key === 'sunwahWhite' ? '#e9e8e2' : key === 'sunwahGolden' ? '#cdb58a' : '#b9bcbe', glass: '#28313a', frame: '#f2f0ea', slab: '#f2f0ea'},
    podium: {h: 14, floors: 3, style: CURTAIN({bay: 3})}, body: 132, floors: 45, style: RESIDENTIAL({balconyEvery: 2, stagger: true}), crown: 'lit-frame'})),
  // Ba Son: Grand Marina Saigon's two glass towers, The Kross, The Nexus, The Waterfront.
  {key: 'grandMarinaA', name: 'Grand Marina Saigon – Marriott tower', colours: {glass: '#50657a', frame: '#9aa6b0', spandrel: '#3e4f60'}, body: 228, floors: 55, style: CURTAIN(), crown: 'fins'},
  {key: 'grandMarinaB', name: 'Grand Marina Saigon – JW Marriott tower', colours: {glass: '#50657a', frame: '#9aa6b0', spandrel: '#3e4f60'}, podium: {h: 20, floors: 4, style: CURTAIN({bay: 3})}, body: 224, floors: 54, style: CURTAIN(), crown: 'fins'},
  {key: 'kross', name: 'The Kross', colours: {glass: '#5f84bb', frame: '#c9d3dc', spandrel: '#46648d'}, body: 134, floors: 35, style: CURTAIN(), crown: 'parapet'},
  {key: 'krossTop', name: 'The Kross (upper)', colours: {glass: '#5f84bb', frame: '#c9d3dc', spandrel: '#46648d'}, body: 136, floors: 36, style: CURTAIN(), crown: 'parapet'},
  {key: 'nexus', name: 'The Nexus', colours: {glass: '#5f84bb', frame: '#d6dde4', spandrel: '#4a6a96'}, body: 133, floors: 35, style: CURTAIN(), crown: 'parapet'},
  {key: 'riverfrontFinancial', name: 'Riverfront Financial Centre', colours: {glass: '#6c8fb5', frame: '#d6dde4', spandrel: '#50709a'}, body: 95, floors: 25, style: CURTAIN(), crown: 'parapet'},
  {key: 'waterfront', name: 'The Waterfront Saigon', colours: {glass: '#6d7b88', frame: '#c5ccd2', spandrel: '#56626d'}, body: 108, floors: 25, style: CURTAIN(), crown: 'parapet'},
  // The riverfront of District 1.
  {key: 'leMeridien', name: 'Le Méridien Saigon', colours: {glass: '#4f8a7c', frame: '#d4dcd8', spandrel: '#3e6d62'}, podium: {h: 12, floors: 3, style: CURTAIN({bay: 3})}, body: 89, floors: 23, style: CURTAIN({ledge: 0.4}), crown: 'parapet'},
  {key: 'vietcombank', name: 'Vietcombank Tower', colours: {glass: '#9fb6c7', frame: '#e4e8eb', spandrel: '#c7cfd5', accent: '#d9dee2'}, podium: {h: 18, floors: 4, style: CURTAIN({bay: 2.5, glassKey: 'glass'})},
    body: 146, floors: 32, style: CURTAIN({bay: 1.2, mullion: 0.3, mullionDepth: 0.22, transom: 0.3}), crown: 'vcb'},
  {key: 'hilton', name: 'Hilton Saigon', colours: {glass: '#2e4a6b', frame: '#8c9aa8', spandrel: '#243b56', accent: '#d8d5cc'}, podium: {h: 26, floors: 6, style: CURTAIN({bay: 2.2})},
    body: 140, floors: 30, style: CURTAIN({ledge: 0.35, ledgeDepth: 0.3}), crown: 'hilton'},
  {key: 'timesSquare', name: 'Saigon Times Square', round: 7, colours: {glass: '#2f8d93', frame: '#1f3438', spandrel: '#2a7c82', accent: '#aab4b8', dark: '#2a2622'},
    podium: {h: 26, floors: 6, style: CURTAIN({bay: 2.6, glassKey: 'glass', spandrelKey: 'dark'})}, body: 161, floors: 34, style: CURTAIN({bay: 1.2, mullion: 0.35, mullionDepth: 0.35, ledge: 0}), crown: 'parapet'},
  {key: 'renaissance', name: 'Renaissance Riverside Hotel Saigon', height: 75, colours: {wall: '#efe4d3', glass: '#5d86a8', frame: '#c98f7a', slab: '#f3ece0'},
    podium: {h: 13, floors: 3, style: RESIDENTIAL({bay: 3.5, window: 0.55, balconyEvery: 0}), key: 'frame'}, body: 70, floors: 18, style: RESIDENTIAL({bay: 1.6, window: 0.7, balconyEvery: 0, pier: 2}), crown: 'penthouse'},
  {key: 'ifcOne', name: 'IFC One Saigon', colours: {glass: '#8aa3b6', frame: '#dfe5ea', spandrel: '#a8b8c4'}, podium: {h: 20, floors: 4, style: CURTAIN({bay: 2.5})}, body: 188, floors: 42, style: CURTAIN(), crown: 'fins'},
];

/** Build one tower's detailed model in its local frame (centre at origin). */
function buildDetail(spec, local, height, materials) {
  const e = emitter(materials, `rf-${spec.key}`), outline = spec.round ? roundCorners(local, spec.round) : local;
  const perim = outline.reduce((s, p, i) => s + Math.hypot(outline[(i + 1) % outline.length][0] - p[0], outline[(i + 1) % outline.length][1] - p[1]), 0);
  // Bay width chosen so the facade comes to about DETAIL.target triangles.
  const perBay = spec.style.kind === 'curtain' ? (spec.style.transom ? 14 : 12) : 16;
  const bay = Math.max(spec.style.bay, perim * spec.floors * perBay / DETAIL.target);
  let y = 0;
  if (spec.podium) {
    const pod = inset(outline, -0.6);                                  // the podium stands a little proud
    shaft(e, pod, {y0: 0, y1: spec.podium.h, floors: spec.podium.floors, style: spec.podium.style});
    roof(e, 'roof', pod, spec.podium.h); band(e, 'frame', pod, spec.podium.h, spec.podium.h + 1.1, 0.25);
    y = spec.podium.h;
  }
  shaft(e, outline, {y0: y, y1: spec.body, floors: Math.max(1, Math.round(spec.floors * (spec.body - y) / spec.body)), style: {...spec.style, bay}});
  crown(e, spec, outline, height);
  const group = new THREE.Group(); group.name = `riverfront-${spec.key}-detail`;
  const triangles = e.finish(group);
  return {group, triangles};
}
function crown(e, spec, o, height) {
  const B = spec.body;
  switch (spec.crown) {
    case 'vcb': {                                                       // stepped louvred crown, and the blade to 186 m
      const louvre = CURTAIN({bay: 1.1, mullion: 0.35, mullionDepth: 0.2, glassKey: 'accent', spandrel: 0.1, ledge: 0});
      const t1 = inset(o, 1.6), t2 = inset(o, 4.5);
      shaft(e, t1, {y0: B, y1: B + 9, floors: 3, style: louvre}); roof(e, 'roof', t1, B + 9);
      shaft(e, t2, {y0: B + 9, y1: B + 17, floors: 3, style: louvre}); roof(e, 'roof', t2, B + 17);
      // The blade: a slim louvred mast rising from the crown's corner nearest the river.
      const c = o.reduce((best, p) => (p[0] - p[1] > best[0] - best[1] ? p : best), o[0]);
      const k = [c, [c[0] - 5, c[1]], [c[0] - 5, c[1] + 3], [c[0], c[1] + 3]].map(([x, z]) => [x * 0.8, z * 0.8]);
      shaft(e, k, {y0: B, y1: height, floors: 12, style: louvre}); roof(e, 'roof', k, height);
      break;
    }
    case 'hilton': {                                                    // the pale open frame over the top floors
      const f = CURTAIN({bay: 3, glassKey: 'accent', mullion: 0.6, mullionDepth: 0.5, spandrel: 0.5, ledge: 0.6});
      shaft(e, o, {y0: B, y1: height - 2, floors: 3, style: f}); roof(e, 'roof', inset(o, 0.4), height - 6); band(e, 'accent', o, height - 2, height, 0.3);
      break;
    }
    case 'fins': {                                                      // a screen of vertical fins round the roof plant
      shaft(e, o, {y0: B, y1: height, floors: 1, style: CURTAIN({bay: 1.8, glassKey: 'spandrel', mullion: 0.5, mullionDepth: 0.4, spandrel: 0, ledge: 0})});
      roof(e, 'roof', inset(o, 0.3), height - 3);
      break;
    }
    case 'frames': {                                                    // parapet and two tall frames over the lift cores
      band(e, 'frame', o, B, B + 1.2, 0.3); roof(e, 'roof', o, B + 0.2);
      const c = inset(o, Math.min(8, Math.sqrt(Math.abs(area2(o))) / 4));
      shaft(e, c, {y0: B, y1: height - 4, floors: 2, style: RESIDENTIAL({bay: 3, balconyEvery: 0, pier: 0})}); roof(e, 'roof', c, height - 4);
      band(e, 'frame', inset(c, -0.8), height - 4, height, 0.6);
      break;
    }
    case 'penthouse': {
      band(e, 'frame', o, B, B + 1.2, 0.3); roof(e, 'roof', o, B + 0.2);
      const c = inset(o, 3.5);
      shaft(e, c, {y0: B, y1: height, floors: 2, style: RESIDENTIAL({bay: 3, window: 0.8, balconyEvery: 0, pier: 0})}); roof(e, 'roof', c, height); band(e, 'frame', c, height, height + 0.8, 0.4);
      break;
    }
    case 'lit-frame': {                                                  // the white frame that lights up at night
      band(e, 'frame', o, B, B + 1.2, 0.3); roof(e, 'roof', o, B + 0.2);
      const c = inset(o, 2);
      shaft(e, c, {y0: B, y1: height - 2, floors: 2, style: RESIDENTIAL({bay: 3, balconyEvery: 0, pier: 0})}); roof(e, 'roof', c, height - 2);
      band(e, 'frame', inset(o, -0.3), height - 2, height, 0.5);
      break;
    }
    default:                                                            // parapet
      band(e, 'frame', o, B, B + 1.4, 0.25); roof(e, 'roof', o, B + 0.3);
      if (height > B + 2) { const c = inset(o, 6); band(e, 'dark', c, B, height, 0); roof(e, 'roof', c, height); }
  }
}
const area2 = pts => pts.reduce((s, [x0, z0], i) => { const [x1, z1] = pts[(i + 1) % pts.length]; return s + x0 * z1 - x1 * z0; }, 0) / 2;

export function createRiverfront({scene, project}) {
  const root = new THREE.Group(); root.name = 'landmark-riverfront';
  const buildings = SPECS.map(spec => {
    const src = O[spec.key], height = spec.height ?? src.height ?? src.levels * 3.2;
    const world = src.outline.map(([lon, lat]) => project(lon, lat));
    const cx = world.reduce((s, p) => s + p[0], 0) / world.length, cz = world.reduce((s, p) => s + p[1], 0) / world.length;
    const local = world.map(([x, z]) => [x - cx, z - cz]);
    const group = new THREE.Group(); group.name = `riverfront-${spec.key}`; group.position.set(cx, 0, cz); root.add(group);
    const s = {...spec, body: Math.min(spec.body, height)};
    // The far block: the footprint extruded in the facade's main colour.
    const farMat = M(spec.colours.wall && spec.style.kind === 'residential' ? spec.colours.wall : spec.colours.glass, {roughness: 0.5, metalness: spec.style.kind === 'curtain' ? 0.35 : 0});
    const shape = new THREE.Shape(local.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, {depth: height, bevelEnabled: false}); g.rotateX(-Math.PI / 2);
    const far = new THREE.Mesh(g, farMat); far.name = `riverfront-${spec.key}-far`; group.add(far);
    return {spec: s, src, height, local, group, far, detail: null, materials: null, away: 0, center: new THREE.Vector3(cx, height / 2, cz)};
  });
  scene.add(root);
  root.updateMatrixWorld(true);
  const replacers = buildings.map(b => genericReplacer(b.group, b.local, {flag: `riverfront-${b.spec.key}`, top: b.height + 30}));
  const state = {buildings: buildings.length, detailed: [], triangles: 0};

  function build(b) {
    b.materials = palette(b.spec.colours);
    const {group, triangles} = buildDetail(b.spec, b.local, b.height, b.materials);
    b.detail = group; b.triangles = triangles; b.group.add(group); b.far.visible = false;
  }
  function release(b) {
    b.detail.removeFromParent(); b.detail.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    Object.values(b.materials).forEach(m => m.dispose()); b.detail = null; b.materials = null; b.far.visible = true;
  }
  const eye = new THREE.Vector3();
  function update(camera, nowMs = performance.now()) {
    if (!camera) return;
    camera.getWorldPosition(eye);
    let built = false;
    // Nearest first, one build a frame.
    const order = buildings.map(b => [b, eye.distanceTo(b.center)]).sort((a, c) => a[1] - c[1]);
    for (const [b, d] of order) {
      if (d < DETAIL.near) { b.away = 0; if (!b.detail && !built) { build(b); built = true; } }
      else if (b.detail && d > DETAIL.far) { if (!b.away) b.away = nowMs; else if (nowMs - b.away > DETAIL.keepMs) release(b); }
      else b.away = 0;
    }
    state.detailed = buildings.filter(b => b.detail).map(b => b.spec.key);
    state.triangles = buildings.reduce((s, b) => s + (b.detail ? b.triangles : 0), 0);
  }
  function buildAll() { for (const b of buildings) if (!b.detail) build(b); }
  return {group: root, state, buildings, update, buildAll,
    replaceGeneric: r => replacers.reduce((s, f) => s + f(r), 0),
    dispose() { for (const b of buildings) { if (b.detail) release(b); b.far.geometry.dispose(); b.far.material.dispose(); } root.removeFromParent(); }};
}
