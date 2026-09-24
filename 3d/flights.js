import * as THREE from 'three';
import {movementPose, chooseRunway, ACTIVE_WINDOW, AIRCRAFT_SIZES} from './flights-motion.js';
const $ = id => document.getElementById(id);
const clock = iso => new Date(iso).toLocaleTimeString('en-GB', {timeZone:'Asia/Ho_Chi_Minh', hour:'2-digit', minute:'2-digit'});
// Aircraft only animate while the view is centred this close to the airport
// reference point; Central HCMC is about 7 km away and stays quiet.
export const NEAR_METRES = 5000;
// The live board rounds to 5-minute marks, so several flights of the same
// kind often share an identical published time -- and every flight of a
// kind is animated on the same single assumed runway (see chooseRunway in
// flights-motion.js), so animating them at that literal time would draw
// multiple aircraft exactly on top of each other. This keeps same-kind
// flights at least this far apart *for animation only*, in time order; the
// flight list panel still shows each one's real, un-shifted time.
export const MIN_ANIM_SEPARATION_MS = 90000;

export function assignAnimTimes(flights, minSeparationMs = MIN_ANIM_SEPARATION_MS) {
  if (!flights) return;
  for (const kind of ['arrival', 'departure']) {
    const ordered = flights.filter(f => f.kind === kind).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    let last = -Infinity;
    for (const f of ordered) {
      const t = Date.parse(f.time);
      f.animAt = Number.isFinite(t) ? Math.max(t, last + minSeparationMs) : t;
      last = f.animAt;
    }
  }
}

function runwayTexture(name) {
  const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a4245'; ctx.fillRect(0, 0, 2048, 96);
  ctx.fillStyle = '#d9dcd6';
  for (let x = 120; x < 1928; x += 30) ctx.fillRect(x, 46, 16, 4);       // centreline dashes
  for (const x0 of [22, 1990]) for (let i = 0; i < 6; i++) { ctx.fillRect(x0, 8 + i * 15, 36, 8); }  // threshold bars
  ctx.font = 'bold 40px system-ui'; ctx.textBaseline = 'middle';
  const [low, high] = name.split('/');
  ctx.save(); ctx.translate(100, 48); ctx.rotate(Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(low, 0, 0); ctx.restore();
  ctx.save(); ctx.translate(1948, 48); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(high, 0, 0); ctx.restore();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return texture;
}

// A low-polygon airliner: fuselage along +X (nose forward), Y up. One metre per unit.
function airlinerTemplate() {
  const body = new THREE.MeshStandardMaterial({color:'#e9edf0', roughness:.55, metalness:.1});
  const dark = new THREE.MeshStandardMaterial({color:'#5a6470', roughness:.6, metalness:.3});
  const accent = new THREE.MeshStandardMaterial({color:'#1f6fb5', roughness:.5});
  const wingShape = (span, root, tip, sweep) => {
    const s = new THREE.Shape();
    s.moveTo(root / 2, 0); s.lineTo(-sweep + tip / 2, span / 2); s.lineTo(-sweep - tip / 2, span / 2);
    s.lineTo(-root / 2, 0); s.lineTo(-sweep - tip / 2, -span / 2); s.lineTo(-sweep + tip / 2, -span / 2); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {depth:.35, bevelEnabled:false}); g.rotateX(Math.PI / 2); return g;
  };
  const group = new THREE.Group();
  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(1.9, 30, 4, 10), body); fuselage.rotation.z = -Math.PI / 2; fuselage.position.y = 1.9;
  const wing = new THREE.Mesh(wingShape(34, 6, 2.2, 6), body); wing.position.set(-2, 1.3, 0);
  const tailplane = new THREE.Mesh(wingShape(11, 3, 1.3, 2.6), body); tailplane.position.set(-15.5, 2.2, 0);
  const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(-6, 0); fin.lineTo(-8, 6.5); fin.lineTo(-5, 6.5); fin.closePath();
  const vertical = new THREE.Mesh(new THREE.ExtrudeGeometry(fin, {depth:.35, bevelEnabled:false}), accent); vertical.position.set(-10, 2.5, .17);
  group.add(fuselage, wing, tailplane, vertical);
  for (const side of [-1, 1]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 4.2, 10), dark);
    engine.rotation.z = Math.PI / 2; engine.position.set(-1.5, .2, side * 6.5); group.add(engine);
  }
  return group;
}

function label(text, sample) {
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 80;
  const ctx = canvas.getContext('2d'); ctx.font = '600 38px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#10222688'; ctx.fillRect(0, 0, 320, 80); ctx.fillStyle = sample ? '#ffc777' : '#e6f4ee'; ctx.fillText(text, 160, 42);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:texture, depthTest:false, transparent:true}));
  sprite.scale.set(64, 16, 1); sprite.center.set(.5, 0); return sprite;
}

export function createFlights({scene, project, controls}) {
  const airport = new THREE.Group(), fleet = new THREE.Group(); scene.add(airport, fleet);
  const template = airlinerTemplate(); const active = new Map();
  const state = {provider:null, sample:false, flights:0, active:0, near:false, runwayDirection:null, error:null, fetchedAt:null};
  let data = null, runways = {}, centre = null, lastList = 0, busy = false;
  async function refresh() {
    if (busy) return; busy = true; $('flights-status').textContent = 'Loading…';
    try {
      const response = await fetch('/api/rain-map/flights', {signal:AbortSignal.timeout(60000), cache:'no-store'});
      if (!response.ok) throw new Error(`API HTTP ${response.status}`);
      const next = await response.json();
      if (!Array.isArray(next.flights) || !Array.isArray(next.runways)) throw new Error('Invalid flights response');
      data = next; build(); state.error = null;
    } catch (error) {
      state.error = error.message;
      $('flights-status').textContent = `Unavailable: ${error.message}. Retrying automatically.`;
    } finally { busy = false; lastList = 0; }
  }
  function build() {
    assignAnimTimes(data.flights);
    for (const o of [...airport.children]) { airport.remove(o); o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); }
    runways = {}; const [cx, cz] = project(data.airport.lon, data.airport.lat); centre = new THREE.Vector2(cx, cz);
    for (const r of data.runways) {
      const [lowName, highName] = r.name.split('/');
      const low = r.ends[lowName], high = r.ends[highName];
      const [ax, az] = project(low.lon, low.lat), [bx, bz] = project(high.lon, high.lat);
      const a = new THREE.Vector2(ax, az), b = new THREE.Vector2(bx, bz), length = a.distanceTo(b);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, r.width_m), new THREE.MeshStandardMaterial({map:runwayTexture(r.name), roughness:.95}));
      mesh.rotation.order = 'YXZ'; mesh.rotation.x = -Math.PI / 2; mesh.rotation.y = Math.atan2(-(bz - az), bx - ax);
      mesh.position.set((ax + bx) / 2, .35, (az + bz) / 2); mesh.name = 'runway'; airport.add(mesh);
      // Thresholds keyed by designator: the animation moves from a threshold toward the far end.
      runways[lowName] = {name:r.name, from:a, to:b, length}; runways[highName] = {name:r.name, from:b, to:a, length};
    }
    state.provider = data.source.provider; state.sample = !!data.source.sample; state.flights = data.flights.length;
    state.fetchedAt = data.source.fetched_at; state.runwayDirection = data.wind?.runway_direction ?? '25';
  }
  function spawn(flight) {
    const size = AIRCRAFT_SIZES[flight.size] || AIRCRAFT_SIZES.narrow;
    const model = template.clone(); model.scale.setScalar(size.length / 38);
    const group = new THREE.Group(); group.add(model, label(flight.number || flight.callsign || 'flight', state.sample));
    group.children[1].position.y = 12 * model.scale.x + 8;
    group.userData = {flight, materials:[]};
    // Per-aircraft opacity needs per-aircraft materials; clone once at spawn.
    model.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; group.userData.materials.push(o.material); } });
    fleet.add(group); active.set(flight.id, group); return group;
  }
  function despawn(id) {
    const group = active.get(id); if (!group) return;
    fleet.remove(group); for (const m of group.userData.materials) m.dispose();
    const sprite = group.children[1]; sprite.material.map.dispose(); sprite.material.dispose(); active.delete(id);
  }
  function list(nowMs) {
    if (!data) return;
    const upcoming = data.flights.filter(f => Date.parse(f.time) > nowMs - 5 * 60000).slice(0, 8);
    $('flights-list').replaceChildren(...upcoming.map(f => {
      const el = document.createElement('p'); el.className = f.time_source === 'sample' ? 'flight-sample' : '';
      const firm = f.time_source === 'estimated' ? 'estimated' : f.time_source === 'sample' ? 'sample' : 'scheduled' + (f.kind === 'departure' && f.time_source !== 'estimated' ? ` +${data.taxi_out_minutes} min taxi` : '');
      const detail = [f.terminal ? `T${f.terminal}` : null, f.gate ? `gate ${f.gate}` : null, f.belt ? `belt ${f.belt}` : null, f.remark].filter(Boolean).join(' · ');
      el.textContent = `${clock(f.time)} ${f.kind === 'arrival' ? '↓' : '↑'} ${f.number || f.callsign || '—'} · ${f.other?.name || 'unknown'} · ${firm}${detail ? ' · ' + detail : ''}`;
      return el;
    }));
    const src = data.source, wind = data.wind;
    const windText = wind ? `Wind ${wind.dir ?? 'variable'}°/${wind.speed_kt ?? '?'} kt → runway ${wind.runway_direction}` : `Wind unavailable → runway 25 assumed${data.wind_error ? ' (' + data.wind_error + ')' : ''}`;
    const sourceText = src.sample ? `SAMPLE SCHEDULE · ${src.error || 'live board unavailable'}; these are not real flights` : `Live board fetched ${clock(src.fetched_at)} ICT · Tân Sơn Nhất's own flight display`;
    $('flights-status').textContent = `${data.flights.length} movements in window · ${windText}. ${sourceText}. ${state.near ? `${active.size} aircraft moving` : 'Zoom to the airport to see aircraft'}.`;
  }
  $('flights').onchange = () => { airport.visible = fleet.visible = $('flights').checked; if (fleet.visible) refresh(); };
  airport.visible = fleet.visible = $('flights').checked;
  refresh(); setInterval(refresh, 600000);
  return {
    state, get centre() { return centre; }, runways: () => runways,
    // Positions of the currently animated aircraft, for debugging and external tools.
    get aircraft() { return [...active.values()].map(g => ({id:g.userData.flight.id, kind:g.userData.flight.kind, x:g.position.x, y:g.position.y, z:g.position.z, opacity:g.userData.materials[0]?.opacity})); },
    update(now) {
      if (!data || !centre) return;
      const nowMs = Date.now();
      state.near = $('flights').checked && Math.hypot(controls.target.x - centre.x, controls.target.z - centre.y) < NEAR_METRES;
      if (nowMs - lastList > 15000) { lastList = nowMs; list(nowMs); }
      if (!state.near) { for (const id of [...active.keys()]) despawn(id); state.active = 0; return; }
      const seen = new Set();
      for (const f of data.flights) {
        const t = (nowMs - (f.animAt ?? Date.parse(f.time))) / 1000, window = ACTIVE_WINDOW[f.kind];
        if (!(t >= window[0] && t <= window[1])) continue;
        seen.add(f.id);
        const group = active.get(f.id) || spawn(f);
        const runway = chooseRunway(f, runways, data.default_runway, state.runwayDirection);
        if (!runway) continue;
        const pose = movementPose(f.kind, t, runway);
        group.position.set(pose.x, pose.y, pose.z);
        group.rotation.set(0, Math.atan2(-runway.dir.y, runway.dir.x), pose.pitch, 'YXZ');
        for (const m of group.userData.materials) m.opacity = pose.opacity;
        group.children[1].material.opacity = pose.opacity;
      }
      for (const id of [...active.keys()]) if (!seen.has(id)) despawn(id);
      state.active = active.size;
    },
  };
}
