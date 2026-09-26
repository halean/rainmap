// A schematic exterior model of Nhà Rồng, the Dragon House (1863), built as
// the headquarters of the Messageries Maritimes at the mouth of the Bến Nghé
// and now the Ho Chi Minh Museum. Footprint and heading from the OSM outline
// (way 808022726); the elevations after photographs: an arcade of round
// arches round the ground floor, a veranda of square piers with iron
// railings above, the roof terrace, and on it the tiled hall with the two
// dragons on its ridge that give the house its name. See NHA-RONG.md.
import * as THREE from 'three';
import {builder, extrude, edge, genericReplacer} from './landmark-kit.js';

export const NHA_RONG = Object.freeze({
  lon: 106.7068074, lat: 10.7682508, yaw: 0.439472,
  // The OSM outline, a rectangle 34.6 m by 27.6 m; x runs north-east.
  outline: [[-17.3, -13.8], [-17.3, 13.8], [17.3, 13.8], [17.3, -13.8]],
});

// Heights from the photographs' proportions: the ground floor under its
// arcade, the upper floor, the terrace railing, and the roof hall.
const FLOOR1 = 5.5, TERRACE = 10.5, HALL = 11.8, RIDGE = 15.0, INSET = 2.6;

export function createNhaRong({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-nha-rong';
  const [x, z] = project(NHA_RONG.lon, NHA_RONG.lat);
  group.position.set(x, 0, z); group.rotation.y = NHA_RONG.yaw;
  const materials = {
    wall: new THREE.MeshStandardMaterial({color: '#f4b99c', roughness: 0.85}),
    trim: new THREE.MeshStandardMaterial({color: '#f7f2ea', roughness: 0.8}),
    door: new THREE.MeshStandardMaterial({color: '#3b2d27', roughness: 0.6}),
    iron: new THREE.MeshStandardMaterial({color: '#2b2a28', roughness: 0.6, metalness: 0.4, transparent: true, opacity: 0.6, depthWrite: false}),
    tile: new THREE.MeshStandardMaterial({color: '#c8633a', roughness: 0.8}),
    roof: new THREE.MeshStandardMaterial({color: '#9b948a', roughness: 0.9}),
    dragon: new THREE.MeshStandardMaterial({color: '#d8ddd4', roughness: 0.6}),
    pearl: new THREE.MeshStandardMaterial({color: '#e6c25a', emissive: '#5a4510', emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.4}),
  };
  const {add, box, finish} = builder(materials, 'nha-rong');
  const outline = NHA_RONG.outline;

  // The house behind the verandas, and the floor slabs they hang from.
  const core = outline.map(([u, v]) => [u - Math.sign(u) * INSET, v - Math.sign(v) * INSET]);
  add('wall', extrude(core, 0, TERRACE));
  add('trim', extrude(outline, FLOOR1 - 0.35, FLOOR1));
  add('roof', extrude(outline, TERRACE - 0.4, TERRACE));

  // A bay of wall with an opening cut through it, arched or square-headed.
  const frame = (w, h, openW, openH, arched) => {
    const s = new THREE.Shape([[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]].map(([a, b]) => new THREE.Vector2(a, b)));
    const r = openW / 2, hole = new THREE.Path();
    hole.moveTo(-r, 0); hole.lineTo(-r, openH - (arched ? r : 0));
    if (arched) hole.absarc(0, openH - r, r, Math.PI, 0, true); else hole.lineTo(r, openH);
    hole.lineTo(r, 0); hole.lineTo(-r, 0);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, {depth: 0.6, bevelEnabled: false, curveSegments: 6}); g.translate(0, 0, -0.3);
    return g;
  };

  outline.forEach((_, i) => {
    const e = edge(outline, i), bays = Math.round(e.len / 3.9), bw = e.len / bays;
    const at = (t, out) => [e.u0 + e.du * t + e.nu * out, e.v0 + e.dv * t + e.nv * out];
    for (let k = 0; k < bays; k++) {
      const t = (k + 0.5) * bw, [fu, fv] = at(t, -0.3), [cu, cv] = at(t, -INSET + 0.05);
      add('wall', frame(bw, FLOOR1 - 0.35, bw - 1.1, 4.3, true), fu, 0, fv, 0, e.yaw);                     // the arcade
      add('wall', frame(bw, TERRACE - FLOOR1 - 0.4, bw - 1.3, TERRACE - FLOOR1 - 1.4, false), fu, FLOOR1, fv, 0, e.yaw);   // the veranda
      box('door', 1.4, 3.0, 0.1, cu, 1.5, cv, e.yaw);                                                   // doors and windows on the house
      box('door', 1.3, 2.4, 0.1, cu, FLOOR1 + 1.5, cv, e.yaw);
      const [ru, rv] = at(t, -0.15);
      box('iron', bw - 1.3, 1.0, 0.05, ru, FLOOR1 + 0.5, rv, e.yaw);                                     // veranda railing
      box('iron', bw - 0.6, 1.0, 0.05, ru, TERRACE + 0.5, rv, e.yaw);                                    // terrace railing
    }
    // Pier caps and posts: white bands at the arch springing and the floor,
    // and the piers standing up as posts round the terrace.
    const [bu, bv] = at(e.len / 2, 0.05);
    box('trim', e.len + 0.2, 0.3, 0.2, bu, 3.4, bv, e.yaw);
    box('trim', e.len + 0.2, 0.3, 0.2, bu, TERRACE - 1.2, bv, e.yaw);
    for (let k = 0; k <= bays; k++) {
      const [pu, pv] = at(k * bw, -0.3);
      box('wall', 0.8, 1.3, 0.8, pu, TERRACE + 0.65, pv, e.yaw);
      box('trim', 0.95, 0.2, 0.95, pu, TERRACE + 1.35, pv, e.yaw);
    }
  });

  // The roof hall: low walls, a tiled roof hipped along its sides with
  // gables at its ends, and the two dragons on the ridge facing the pearl.
  const HW = 13.0, HD = 8.6;                                            // half its length and width
  box('wall', 2 * HW, HALL - TERRACE, 2 * HD, 0, (HALL + TERRACE) / 2, 0);
  const hip = new THREE.Shape([[-HD - 0.6, 0], [HD + 0.6, 0], [0, RIDGE - HALL]].map(([a, b]) => new THREE.Vector2(a, b)));
  const roof = new THREE.ExtrudeGeometry(hip, {depth: 2 * HW + 1.2, bevelEnabled: false});
  roof.rotateY(Math.PI / 2);                                            // ridge along x
  add('tile', roof, -HW - 0.6, HALL, 0);
  for (const s of [-1, 1]) {
    const gable = new THREE.Shape([[-HD, 0], [HD, 0], [0, RIDGE - HALL - 0.3]].map(([a, b]) => new THREE.Vector2(a, b)));
    const g = new THREE.ExtrudeGeometry(gable, {depth: 0.3, bevelEnabled: false}); g.rotateY(Math.PI / 2);
    add('wall', g, s * (HW + 0.65) - 0.15, HALL, 0);
    box('trim', 0.5, 0.3, 2 * HD + 1.4, s * (HW + 0.7), HALL, 0);
    add('trim', new THREE.ConeGeometry(0.3, 1.2, 6), s * (HW + 0.6), RIDGE + 0.4, 0, 0, 0, -s * 0.5);   // the ridge's upturned ends
  }
  box('tile', 2 * HW + 1.2, 0.35, 0.5, 0, RIDGE, 0);
  for (const s of [-1, 1]) {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 8.5, RIDGE + 0.2, 0), new THREE.Vector3(s * 7.2, RIDGE + 0.9, 0), new THREE.Vector3(s * 5.9, RIDGE + 0.3, 0),
      new THREE.Vector3(s * 4.6, RIDGE + 1.0, 0), new THREE.Vector3(s * 3.4, RIDGE + 0.5, 0), new THREE.Vector3(s * 2.4, RIDGE + 1.2, 0),
    ]);
    add('dragon', new THREE.TubeGeometry(path, 24, 0.2, 6, false));
    add('dragon', new THREE.SphereGeometry(0.42, 8, 6), s * 2.1, RIDGE + 1.35, 0);                      // head
    add('dragon', new THREE.ConeGeometry(0.25, 0.9, 5), s * 8.9, RIDGE + 0.6, 0, 0, 0, s * 0.8);          // tail
  }
  add('pearl', new THREE.SphereGeometry(0.5, 12, 8), 0, RIDGE + 1.2, 0);
  add('dragon', new THREE.TorusGeometry(0.75, 0.08, 6, 16), 0, RIDGE + 1.2, 0);

  const triangles = finish(group);
  scene.add(group);
  const replaceGeneric = genericReplacer(group, outline, {flag: 'nhaRongReplaced', top: 40});
  const view = {target: group.localToWorld(new THREE.Vector3(0, 8, 0)), eye: group.localToWorld(new THREE.Vector3(70, 30, 60))};
  const state = {name: 'Nhà Rồng (Ho Chi Minh Museum)', lon: NHA_RONG.lon, lat: NHA_RONG.lat, height: RIDGE + 1.7, triangles, drawCalls: group.children.length, schematic: true};
  return {group, state, view, replaceGeneric, dispose() { scene.remove(group); for (const m of group.children) m.geometry.dispose(); for (const m of Object.values(materials)) m.dispose(); }};
}
