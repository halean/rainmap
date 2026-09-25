// HCMC Metro Line 1 (Bến Thành – Suối Tiên): track, viaduct, stations and its
// trains. Trains run to the operator's published timetable (HURC1's app API,
// served by /api/rain-map/metro/timetable): every trip in service is on the
// line at once, leaving each station at its timetabled minute. These are
// SCHEDULED positions, not tracked trains -- see docs/metro-line-1-api.md. If
// the timetable can't be had, one DEMO train shuttles end to end instead.
//
// Track and stations come from metro-line1.json (3d/tools/metro_line1.py, from
// OpenStreetMap). Heights there are schematic: tunnel just below ground, the
// viaduct deck at 12 m. Underground, the train is drawn as a faint ghost at
// street level so it can still be followed.
import * as THREE from 'three';

const $ = id => document.getElementById(id);

// Demo running: Line 1's top speed is 110 km/h in service but ~80 km/h is
// typical between these stations; 1 m/s² is ordinary metro acceleration.
export const DEMO = {cruise: 80 / 3.6, accel: 1.0, dwell: 30, terminalDwell: 90};
const CAR_LENGTH = 20.5, CAR_GAP = 0.6, CARS = 3, CAR_WIDTH = 3.0, CAR_HEIGHT = 3.7;
const DECK_WIDTH = 9, DECK_DEPTH = 1.6, PILLAR_SPACING = 35;
const PLATFORM_LENGTH = 125, PLATFORM_WIDTH = 22, PLATFORM_HEIGHT = 7;
const GHOST_Y = 0.4;

/** Seconds to run `d` metres from standstill to standstill (accelerate,
 *  cruise if there is room, brake). */
export function runTime(d, {cruise, accel} = DEMO) {
  const dAccel = cruise * cruise / accel;          // distance to reach cruise and brake again
  return d >= dAccel ? d / cruise + cruise / accel : 2 * Math.sqrt(d / accel);
}

/** Distance covered `t` seconds into a hop of `d` metres. */
export function runDistance(t, d, {cruise, accel} = DEMO) {
  const T = runTime(d, {cruise, accel});
  t = Math.max(0, Math.min(T, t));
  const vPeak = Math.min(cruise, Math.sqrt(accel * d));
  const tA = vPeak / accel, dA = 0.5 * accel * tA * tA;
  if (t <= tA) return 0.5 * accel * t * t;
  if (t <= T - tA) return dA + vPeak * (t - tA);
  const tb = T - t;
  return d - 0.5 * accel * tb * tb;
}

/** The demo timetable: a list of legs {kind: 'dwell'|'run', from, to, start,
 *  end} covering one round trip, and its period in seconds. */
export function demoCycle(stationsAlong, opts = DEMO) {
  const legs = [];
  let t = 0;
  const order = [...stationsAlong.keys(), ...[...stationsAlong.keys()].reverse().slice(1)];
  for (let i = 0; i < order.length; i++) {
    const here = order[i], terminal = here === 0 || here === stationsAlong.length - 1;
    const dwell = terminal ? opts.terminalDwell : opts.dwell;
    legs.push({kind: 'dwell', at: here, start: t, end: t + dwell}); t += dwell;
    const next = order[i + 1];
    if (next === undefined) break;
    const d = Math.abs(stationsAlong[next] - stationsAlong[here]);
    const T = runTime(d, opts);
    legs.push({kind: 'run', from: here, to: next, start: t, end: t + T, d}); t += T;
  }
  return {legs, period: t};
}

/** Where the demo train is at `t` seconds: {along, heading (+1 toward Suối
 *  Tiên, -1 back), leg}. */
export function demoPosition(cycle, stationsAlong, t, opts = DEMO) {
  const tm = ((t % cycle.period) + cycle.period) % cycle.period;
  const leg = cycle.legs.find(l => tm >= l.start && tm < l.end) || cycle.legs[cycle.legs.length - 1];
  if (leg.kind === 'dwell') {
    const prev = cycle.legs[cycle.legs.indexOf(leg) - 1];
    const heading = prev ? Math.sign(stationsAlong[prev.to] - stationsAlong[prev.from]) : 1;
    return {along: stationsAlong[leg.at], heading, leg};
  }
  const s = runDistance(tm - leg.start, leg.d, opts), dir = Math.sign(stationsAlong[leg.to] - stationsAlong[leg.from]);
  return {along: stationsAlong[leg.from] + dir * s, heading: dir, leg};
}

// ---------------------------------------------------------------------------
// Timetable running. The API gives one time per stop per trip, to the minute,
// and says nothing about dwell; each listed time is taken as the departure,
// with a stop of up to TIMETABLE.dwell before it (less when the gap is tight),
// and the final time as the arrival at the terminus.

export const TIMETABLE = {dwell: 25, minDwell: 5, originWait: 60, terminalWait: 45};

const toSeconds = hhmm => Number(hhmm.slice(0, 2)) * 3600 + Number(hhmm.slice(3, 5)) * 60;

/** Trips from one direction's timetable, as station indices in running order
 *  with departure seconds: [{id, heading, stops: [{i, t}]}]. `stationIndex`
 *  maps stopId -> index along the line (0 = Bến Thành). Trips whose times go
 *  backwards are dropped rather than drawn wrong. */
export function tripsFromTimetable(byStop, varId, stationIndex) {
  const heading = varId === '1' ? 1 : -1;
  const stops = Object.keys(byStop).filter(id => id in stationIndex)
    .sort((a, b) => heading * (stationIndex[a] - stationIndex[b]));
  const n = stops.length ? byStop[stops[0]].length : 0, trips = [];
  for (let k = 0; k < n; k++) {
    const seq = stops.map(id => ({i: stationIndex[id], t: toSeconds(byStop[id][k])}));
    if (seq.every((s, j) => j === 0 || s.t >= seq[j - 1].t)) trips.push({id: `${varId}-${k}`, heading, stops: seq});
  }
  return trips;
}

/** Where a trip's train is at `t` (seconds after local midnight), or null if
 *  it isn't on the line then: {along, heading, at (station index while
 *  stopped) , next (station index while running), nextIn (seconds)}. */
export function tripPosition(trip, stationsAlong, t, opts = TIMETABLE) {
  const s = trip.stops, last = s.length - 1;
  if (t < s[0].t - opts.originWait || t > s[last].t + opts.terminalWait) return null;
  if (t <= s[0].t) return {along: stationsAlong[s[0].i], heading: trip.heading, at: s[0].i, next: null};
  for (let j = 0; j < last; j++) {
    const a = s[j], b = s[j + 1], d = Math.abs(stationsAlong[b.i] - stationsAlong[a.i]);
    const gap = b.t - a.t, natural = runTime(d);
    const dwell = j + 1 === last ? 0 : Math.max(opts.minDwell, Math.min(opts.dwell, gap - natural));
    const arrive = b.t - dwell;
    if (t <= a.t) return {along: stationsAlong[a.i], heading: trip.heading, at: a.i, next: null};
    if (t < arrive) {
      // Stretch or squeeze the natural accelerate-cruise-brake run to fit the
      // timetabled gap, so it leaves and arrives exactly on time.
      const u = (t - a.t) / Math.max(1, arrive - a.t);
      const covered = runDistance(u * natural, d);
      return {along: stationsAlong[a.i] + trip.heading * covered, heading: trip.heading, at: null, next: b.i, nextIn: arrive - t};
    }
    if (t <= b.t) return {along: stationsAlong[b.i], heading: trip.heading, at: b.i, next: null};
  }
  return {along: stationsAlong[s[last].i], heading: trip.heading, at: s[last].i, next: null};
}

/** Seconds since local (ICT) midnight for a Unix time in ms. */
export function ictSecondsOfDay(ms) {
  return (((ms / 1000 + 7 * 3600) % 86400) + 86400) % 86400;
}

export function createMetro({scene, project}) {
  let following = false;
  const state = {loaded: false, demo: true, following: false, along: null, heading: null, atStation: null, nextStation: null, underground: null};
  const status = text => { if ($('metro-status')) $('metro-status').textContent = text; };
  const group = new THREE.Group();
  scene.add(group);
  let line = null, cycle = null, stationsAlong = [], stationIndex = {};
  let trips = null, timetableInfo = null;               // null until the timetable arrives
  const pool = [];                                      // train meshes, reused frame to frame
  let followId = null, lastFollow = null;
  // ?metro-time=HH:MM previews another time of day (the clock then runs on
  // from there) -- handy at night, when no trains run.
  const preview = new URLSearchParams(location.search).get('metro-time');
  const clockOffset = /^\d{1,2}:\d{2}$/.test(preview || '')
    ? (() => { const [h, m] = preview.split(':').map(Number); return (h * 3600 + m * 60 - ictSecondsOfDay(Date.now())) * 1000; })()
    : 0;
  const now = () => Date.now() + clockOffset;

  // A three-car train: deep-blue cars with a white band. A little self-glow in
  // the same blue keeps it readable against the grey viaduct at night.
  const bodyGeo = new THREE.BoxGeometry(CAR_LENGTH, CAR_HEIGHT, CAR_WIDTH);
  const bandGeo = new THREE.BoxGeometry(CAR_LENGTH * 0.98, 0.7, CAR_WIDTH + 0.06);
  function makeTrain() {
    const train = new THREE.Group(), mats = [];
    for (let c = 0; c < CARS; c++) {
      const body = new THREE.MeshStandardMaterial({color: '#0b2a6f', emissive: '#0b2a6f', emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.3, transparent: true});
      const band = new THREE.MeshStandardMaterial({color: '#f4f6f8', emissive: '#f4f6f8', emissiveIntensity: 0.15, roughness: 0.5, transparent: true});
      mats.push(body, band);
      const car = new THREE.Group();
      const b = new THREE.Mesh(bodyGeo, body); b.position.y = CAR_HEIGHT / 2;
      const st = new THREE.Mesh(bandGeo, band); st.position.y = 1.1;
      car.add(b, st); train.add(car);
    }
    train.userData.mats = mats;
    group.add(train);
    return train;
  }
  function placeTrain(train, along, heading) {
    const underground = along < line.tunnelEnd;
    train.children.forEach((car, c) => {
      // Cars trail behind the lead car along the track.
      const s = along - heading * (c * (CAR_LENGTH + CAR_GAP) + CAR_LENGTH / 2);
      const {pos, dir} = pointAt(s);
      const ghost = s < line.tunnelEnd;
      car.position.set(pos.x, ghost ? GHOST_Y : pos.y, pos.z);
      car.rotation.set(0, Math.atan2(-dir.z, dir.x), ghost ? 0 : Math.asin(Math.max(-1, Math.min(1, dir.y))));
    });
    for (const m of train.userData.mats) { m.opacity = underground ? 0.45 : 1; m.depthWrite = !underground; }
    train.visible = true;
  }

  function build(data) {
    // Track in scene coordinates, with distance along it.
    const pts = data.track.map(([lon, lat, h]) => { const [x, z] = project(lon, lat); return new THREE.Vector3(x, h, z); });
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const scale = data.length_m / along[along.length - 1];      // keep OSM's chainage exact
    for (let i = 0; i < along.length; i++) along[i] *= scale;
    line = {pts, along, tunnelEnd: data.tunnel_end_m};
    stationsAlong = data.stations.map(s => s.along_m);

    // Tunnel: a faint dashed line at street level, like its route on a map.
    const tunnelPts = pts.filter((_, i) => along[i] <= data.tunnel_end_m + 1).map(p => new THREE.Vector3(p.x, GHOST_Y, p.z));
    const tunnel = new THREE.Line(new THREE.BufferGeometry().setFromPoints(tunnelPts), new THREE.LineDashedMaterial({color: '#9fb3c8', dashSize: 12, gapSize: 8, transparent: true, opacity: 0.8}));
    tunnel.computeLineDistances(); group.add(tunnel);

    // Viaduct: a deck ribbon plus pillars, from the portal onward.
    const deckMat = new THREE.MeshStandardMaterial({color: '#b9bcb4', roughness: 0.9});
    const deck = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      if (along[i] < data.tunnel_end_m) continue;
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, nx = -dz / L * DECK_WIDTH / 2, nz = dx / L * DECK_WIDTH / 2;
      const y = pts[i].y;
      deck.push(pts[i].x + nx, y, pts[i].z + nz, pts[i].x - nx, y, pts[i].z - nz,
                pts[i].x + nx, y - DECK_DEPTH, pts[i].z + nz, pts[i].x - nx, y - DECK_DEPTH, pts[i].z - nz);
    }
    const rings = deck.length / 12;
    for (let r = 0; r < rings - 1; r++) {
      const a = r * 4, b = (r + 1) * 4;
      idx.push(a, b, a + 1, a + 1, b, b + 1);            // top
      idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); // underside
      idx.push(a, a + 2, b, a + 2, b + 2, b);             // side
      idx.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3); // side
    }
    const deckGeo = new THREE.BufferGeometry();
    deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(deck, 3));
    deckGeo.setIndex(idx); deckGeo.computeVertexNormals();
    group.add(new THREE.Mesh(deckGeo, deckMat));

    const pillarPositions = [];
    for (let s = data.tunnel_end_m + 120; s < data.length_m; s += PILLAR_SPACING) pillarPositions.push(pointAt(s).pos);
    const pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 1, 2.2), deckMat, pillarPositions.length);
    const m = new THREE.Matrix4();
    pillarPositions.forEach((p, i) => { const h = Math.max(0.1, p.y - DECK_DEPTH); m.makeScale(1, h, 1).setPosition(p.x, h / 2, p.z); pillars.setMatrixAt(i, m); });
    group.add(pillars);

    // Stations: on the viaduct, a platform either side of the track and a
    // see-through roof above, so a stopped train stays visible; a small blue
    // entrance at street level for the underground three.
    const platMat = new THREE.MeshStandardMaterial({color: '#dfe3e6', roughness: 0.7});
    const roofMat = new THREE.MeshStandardMaterial({color: '#cfd8df', roughness: 0.5, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide});
    const entranceMat = new THREE.MeshStandardMaterial({color: '#1c6fb4', roughness: 0.6});
    const sideGeo = new THREE.BoxGeometry(PLATFORM_LENGTH, 1.2, 5);
    const roofGeo = new THREE.BoxGeometry(PLATFORM_LENGTH, 0.4, PLATFORM_WIDTH);
    for (const s of data.stations) {
      const {pos, dir} = pointAt(s.along_m);
      const station = new THREE.Group();
      station.name = `metro-station ${s.name}`;
      station.rotation.y = Math.atan2(-dir.z, dir.x);
      if (s.underground) {
        const entrance = new THREE.Mesh(new THREE.BoxGeometry(24, 4, 10), entranceMat);
        entrance.position.y = 2;
        station.position.set(pos.x + 18 * -dir.z, 0, pos.z + 18 * dir.x);   // beside the line, not on it
        station.add(entrance);
      } else {
        station.position.copy(pos);
        for (const side of [-1, 1]) {
          const platform = new THREE.Mesh(sideGeo, platMat);
          platform.position.set(0, 0.6, side * (CAR_WIDTH / 2 + 3));
          station.add(platform);
        }
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.y = PLATFORM_HEIGHT;
        station.add(roof);
      }
      group.add(station);
    }

    stationIndex = Object.fromEntries(data.stations.map((st, k) => [st.stopId, k]));
    cycle = demoCycle(stationsAlong);
    state.loaded = true;
    state.stations = data.stations.length;
    state.lengthKm = +(data.length_m / 1000).toFixed(1);
    state.names = data.stations.map(s => s.name);
  }

  // Position and direction on the track at distance `s` metres.
  function pointAt(s) {
    const {pts, along} = line;
    s = Math.max(0, Math.min(along[along.length - 1], s));
    let i = 1;
    while (i < along.length - 1 && along[i] < s) i++;
    const a = pts[i - 1], b = pts[i], t = (s - along[i - 1]) / ((along[i] - along[i - 1]) || 1);
    const pos = new THREE.Vector3().lerpVectors(a, b, t);
    const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    return {pos, dir};
  }

  // Trains in service now: from the timetable if we have it, else the demo.
  // Both run on the wall clock (plus any preview offset), so every viewer sees
  // the same trains in the same places.
  function running() {
    const ms = now();
    if (trips) {
      const t = ictSecondsOfDay(ms), out = [];
      for (const trip of trips) { const p = tripPosition(trip, stationsAlong, t); if (p) out.push({id: trip.id, ...p}); }
      return out;
    }
    const p = demoPosition(cycle, stationsAlong, ms / 1000), leg = p.leg;
    return [{id: 'demo', along: p.along, heading: p.heading, at: leg.kind === 'dwell' ? leg.at : null,
             next: leg.kind === 'run' ? leg.to : null, nextIn: leg.kind === 'run' ? leg.end - ((ms / 1000) % cycle.period + cycle.period) % cycle.period : null}];
  }

  function update() {
    if (!state.loaded || !group.visible) return;
    const trains = running();
    while (pool.length < trains.length) pool.push(makeTrain());
    pool.forEach((mesh, k) => { if (k < trains.length) placeTrain(mesh, trains[k].along, trains[k].heading); else mesh.visible = false; });
    const names = state.names, followed = trains.find(tr => tr.id === followId);
    const hhmm = new Date(now()).toLocaleTimeString('en-GB', {timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit'});
    Object.assign(state, {mode: trips ? 'timetable' : 'demo', running: trains.length, time: hhmm, following: following && !!followed});
    let text;
    if (trips) {
      const stale = timetableInfo?.stale ? ` (the timetable from ${timetableInfo.date}; today's could not be fetched)` : '';
      text = trains.length
        ? `${trains.length} train${trains.length === 1 ? '' : 's'} on the line at ${hhmm} · published HURC1 timetable${stale}: scheduled, not tracked`
        : `No trains at ${hhmm} · service runs about 05:00–23:30 (published timetable)${stale}`;
    } else {
      text = 'DEMO train, not real positions (timetable unavailable)';
    }
    if (following && followed) {
      text += ` · following the train toward ${followed.heading > 0 ? 'Suối Tiên' : 'Bến Thành'}, ` +
        (followed.at !== null ? `stopped at ${names[followed.at]}` : `next ${names[followed.next]} in ${Math.max(0, Math.round(followed.nextIn))} s`) +
        ' (Esc or pan to stop)';
    }
    if (preview && clockOffset) text += ` · previewing ${preview}`;
    status(text);
  }

  fetch('metro-line1.json')
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(build)
    .then(loadTimetable)
    .catch(e => status(`Metro line data unavailable: ${e.message}`));

  async function loadTimetable() {
    try {
      const r = await fetch('/api/rain-map/metro/timetable', {cache: 'no-store'});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const tt = await r.json();
      trips = [...tripsFromTimetable(tt.directions['1'], '1', stationIndex), ...tripsFromTimetable(tt.directions['2'], '2', stationIndex)];
      timetableInfo = {date: tt.date, stale: !!tt.stale};
      state.trips = trips.length;
    } catch (e) {
      trips = null; state.timetableError = e.message;   // the demo keeps running
    }
  }
  // Pick up the next day's timetable after midnight.
  setInterval(() => { if (state.loaded) loadTimetable(); }, 3 * 3600 * 1000);

  const toggle = $('metro');
  if (toggle) { group.visible = toggle.checked; toggle.onchange = () => { group.visible = toggle.checked; }; }
  /** The followed train's middle car, the track direction there, and
   *  `forward` (its direction of travel), for the chase camera. Locks onto the
   *  train nearest the last one followed -- or nearest `near` when starting --
   *  and moves on to the nearest other train when its trip ends. Null if the
   *  line hasn't loaded or no train is running. */
  function trainView(near = null) {
    if (!state.loaded) return null;
    const trains = running();
    if (!trains.length) return null;
    let tr = trains.find(x => x.id === followId);
    if (!tr) {
      const ref = near || lastFollow;
      const dist = x => { if (!ref) return 0; const {pos} = pointAt(x.along); return pos.distanceToSquared(ref); };
      tr = trains.reduce((best, x) => dist(x) < dist(best) ? x : best);
      followId = tr.id;
    }
    const {pos, dir} = pointAt(tr.along - tr.heading * (CAR_LENGTH + CAR_GAP + CAR_LENGTH / 2));
    if (tr.along < line.tunnelEnd) pos.y = GHOST_Y;
    lastFollow = pos.clone();
    return {pos, dir, forward: dir.clone().multiplyScalar(tr.heading)};
  }
  function setFollowing(on) { following = on; state.following = on; if (!on) followId = null; }
  return {state, group, update, trainView, setFollowing, get stationsAlong() { return stationsAlong; }};
}
