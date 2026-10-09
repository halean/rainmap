/* Live street floods (app/services/floods.py, scripts/flood_watch.py) -- an experiment.
 * A camera appears here only while the flood watch is following it: the vision model saw
 * water deep enough for wakes on its lanes, and has not yet had three reads in a row with
 * the lanes clear. The marker is a water drop with waves and spreading ripples, so a flood
 * cannot be mistaken for a round rain pin or a lightning bolt. A watch that has gone 15 min
 * without a new frame is drawn grey and still: "flooded when last seen", not "flooded now". */
(() => {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes floodRipple { from { transform: translateX(-50%) scale(0.35); opacity: 0.85; }
                             to   { transform: translateX(-50%) scale(1.6);  opacity: 0; } }
    .flood-marker { position: relative; width: 34px; height: 44px; }
    .flood-marker svg { position: absolute; left: 0; top: 0; overflow: visible;
                        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.45)); }
    .flood-marker .ripple { position: absolute; left: 50%; bottom: -5px; width: 40px; height: 13px;
                            border: 2px solid #1e88e5; border-radius: 50%;
                            animation: floodRipple 2.2s ease-out infinite; pointer-events: none; }
    .flood-marker .ripple.r2 { animation-delay: 1.1s; }
    .flood-marker.stale .ripple { display: none; }
    .popup-card .badge.flood { background: #0d47a1; }
    .popup-card .badge.flood.stale { background: #78909c; }
    .popup-card .flood-facts { font-size: 12px; margin: 6px 0; line-height: 1.45; }
    .popup-card .flood-facts b { font-weight: 600; }
    .popup-card .exp-note { font-size: 10.5px; color: var(--muted); font-style: italic; margin-top: 5px; }
    .flood-warn { filter: drop-shadow(0 1px 2px rgba(0,0,0,0.45)); }
    .flood-banner { position: absolute; z-index: 800; left: 50%; bottom: 28px; transform: translateX(-50%);
                    max-width: calc(100% - 120px); background: #b45309; color: #fff; font-size: 13px; font-weight: 600;
                    padding: 6px 12px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: none;
                    text-align: center; pointer-events: none; }
    .popup-card .badge.warn { background: #b45309; }
    .legend-box .tide-line { font-size: 11.5px; margin: 2px 0 4px; }
    .legend-box .sw.flood { border: 0; border-radius: 0; background: none; width: 14px; height: 18px; display: inline-flex; }
  `;
  document.head.appendChild(style);

  map.createPane("floodPane");
  // Above the rain pins (650) so a flood is never hidden under its own camera's pin, below
  // lightning (680) and Leaflet's popups (700).
  map.getPane("floodPane").style.zIndex = 670;
  const layer = L.layerGroup();

  // A drop: round body, pointed top. The lower half is a lighter "water level" with two
  // white wave lines across it. Anchored at the bottom centre, where the ripples spread.
  const DROP = "M17 1 C17 1 3 17.5 3 27 a14 14 0 0 0 28 0 C31 17.5 17 1 17 1 Z";
  const dropSvg = (stale, w = 34) => {
    const body = stale ? "#90a4ae" : "#0d47a1", water = stale ? "#cfd8dc" : "#42a5f5";
    const id = `fc${Math.random().toString(36).slice(2, 8)}`;
    return `<svg width="${w}" height="${w * 44 / 34}" viewBox="0 0 34 44">
      <defs><clipPath id="${id}"><path d="${DROP}"/></clipPath></defs>
      <path d="${DROP}" fill="${body}"/>
      <g clip-path="url(#${id})">
        <path d="M0 26 q4.25 -3 8.5 0 t8.5 0 t8.5 0 t8.5 0 V44 H0 Z" fill="${water}"/>
        <path d="M2 30 q3.75 -2.6 7.5 0 t7.5 0 t7.5 0 t7.5 0" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M2 35.5 q3.75 -2.6 7.5 0 t7.5 0 t7.5 0 t7.5 0" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
      </g>
      <path d="${DROP}" fill="none" stroke="#fff" stroke-width="2" ${stale ? 'stroke-dasharray="3 2.5"' : ""}/>
    </svg>`;
  };

  const panel = document.createElement("div");
  panel.innerHTML = `
    <label class="toggle-row"><input type="checkbox" id="floodToggle" checked> Street flooding (experimental)</label>
    <div id="floodOptions" style="max-width:230px">
      <div class="tide-line" id="floodTide"></div>
      <div class="row"><span class="sw flood warn-sw"></span>Flood possible: rain here on a high river</div>
      <div class="row"><span class="sw flood" data-stale="0"></span>Flooded now</div>
      <div class="row"><span class="sw flood" data-stale="1"></span>Flooded when last seen; no new frame</div>
      <div class="note">Flood-prone cameras, read by Gemma when the cameras around them report rain. Shown while water lies deep enough on the lanes for vehicles to push a wake, until three reads in a row find them clear.</div>
      <div id="floodStatus" class="note" role="status"></div>
    </div>`;
  // First after the rain key, not appended at the end: a flood is the most urgent thing on the
  // map, and at the bottom of a long legend it sat below the fold on a 1366x768 laptop.
  legendBoxEl.insertBefore(panel, legendBoxEl.querySelector(".toggle-row"));
  L.DomEvent.disableScrollPropagation(panel);
  // A warning triangle with a wave in it: a caution sign, not yet a flood.
  const warnSvg = (w = 26) => `<svg class="flood-warn" width="${w}" height="${w}" viewBox="0 0 26 26">
      <path d="M13 2 L25 23 H1 Z" fill="#f59e0b" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M6.5 18 q1.6 -1.6 3.2 0 t3.2 0 t3.2 0 t3.2 0" fill="none" stroke="#7c2d12" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M13 8.5 V13.5" stroke="#7c2d12" stroke-width="2" stroke-linecap="round"/></svg>`;
  panel.querySelectorAll(".sw.flood").forEach(el => {
    el.innerHTML = el.classList.contains("warn-sw") ? warnSvg(15) : dropSvg(el.dataset.stale === "1", 14); });
  const banner = L.DomUtil.create("div", "flood-banner", map.getContainer());
  const tideLine = panel.querySelector("#floodTide");
  const toggle = panel.querySelector("#floodToggle");
  const status = panel.querySelector("#floodStatus");
  let requestId = 0;

  const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB",
    {timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit"});
  const duration = (min) => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

  function popupFor(f) {
    const el = document.createElement("div");
    el.className = "popup-card";
    const latest = f.latest;
    el.innerHTML = `
      <div class="district">Street flooding</div>
      <div class="loc">${esc(f.name)}</div>
      <span class="badge flood${f.stale ? " stale" : ""}">${f.stale ? "Flooded when last seen" : "Flooded"}</span>
      ${f.stale ? `<div class="stale-note">No new frame for ${duration(f.minutes_since_read)} &mdash; the camera or the site has stopped answering, so this may have drained.</div>` : ""}
      <div class="flood-facts">
        Flooding since <b>${clock(f.since)}</b> (${duration(f.minutes)})<br>
        Deepest seen: <b>${esc(f.peak_depth)}</b><br>
        Latest read ${clock(latest.read_at)}: <b>${esc(latest.depth)}</b>${latest.usable ? "" : " (road not visible)"}
      </div>
      ${latest.justification ? `<div class="just">${esc(latest.justification)}</div>` : ""}
      ${latest.image_url ? `<img src="${latest.image_url}" alt="${esc(f.name)}">` : ""}
      <div class="exp-note">Experimental: read from the city's traffic camera by a vision model; one read is a guess, a watch is several.</div>`;
    const img = el.querySelector("img");
    if (img) img.addEventListener("click", () =>
      openLightbox(latest.image_url, `${f.name} · flooding · ${clock(latest.read_at)} ICT`));
    return el;
  }

  function draw(data) {
    layer.clearLayers();
    for (const f of data.floods) {
      const html = `<div class="flood-marker${f.stale ? " stale" : ""}">` +
        `<span class="ripple"></span><span class="ripple r2"></span>${dropSvg(f.stale)}</div>`;
      const icon = L.divIcon({className: "", html, iconSize: [34, 44], iconAnchor: [17, 44], popupAnchor: [0, -40]});
      L.marker([f.lat, f.lon], {pane: "floodPane", icon, title: `Flooding: ${f.name}`, riseOnHover: true})
        .bindPopup(() => popupFor(f), {maxWidth: 300}).addTo(layer);
    }
    const t = data.tide || {};
    if (t.available && t.level_m != null) {
      const nh = t.next_high;
      tideLine.innerHTML = `Saigon River (Phú An): <b>${t.level_m >= 0 ? "+" : ""}${t.level_m.toFixed(2)} m</b> ` +
        `${t.trend === "rising" ? "\u2197" : "\u2198"}` +
        (nh ? ` &middot; next high ${nh.h.toFixed(2)} m at ${clock(nh.t)}` : "") +
        (t.high ? ` &middot; <b>high</b> (&ge; ${t.alert_level_m} m)` : "");
    } else {
      tideLine.textContent = "River level unavailable.";
    }
    const alerts = data.alerts || [];
    for (const a of alerts) {
      const icon = L.divIcon({className: "", html: warnSvg(), iconSize: [26, 26], iconAnchor: [13, 24], popupAnchor: [0, -22]});
      const pop = `<div class="popup-card"><div class="district">Flood possible</div><div class="loc">${esc(a.name)}</div>` +
        `<span class="badge warn">Rain on a high river</span><div class="flood-facts">` +
        `Raining at ${a.rain_yes} of ${a.rain_fresh} nearby rain-map cameras<br>` +
        `Saigon River at <b>${t.level_m.toFixed(2)} m</b> (warning from ${t.alert_level_m} m): drains here empty into it</div>` +
        `<div class="exp-note">A warning, not a sighting: the flood watch is reading this camera and will show a flood if it sees one.</div></div>`;
      L.marker([a.lat, a.lon], {pane: "floodPane", icon, title: `Flood possible: ${a.name}`, riseOnHover: true})
        .bindPopup(pop, {maxWidth: 280}).addTo(layer);
    }
    banner.textContent = alerts.length
      ? `Rain on a high tide (${t.level_m.toFixed(2)} m): flooding possible at ${alerts.length} spot${alerts.length === 1 ? "" : "s"}`
      : "";
    banner.style.display = alerts.length && toggle.checked ? "block" : "none";
    const live = data.floods.filter(f => !f.stale).length, stale = data.floods.length - live;
    if (data.collector === "missing") {
      status.textContent = "Flood watch is not running -- no state file yet.";
    } else if (!data.floods.length) {
      status.textContent = `No street flooding seen right now across ${data.watched_cameras} watched cameras.`;
    } else {
      status.textContent = `${live} flooded street${live === 1 ? "" : "s"} now` +
        (stale ? `, ${stale} more flooded when last seen` : "") + ".";
    }
  }

  async function refresh() {
    if (!toggle.checked) return;
    const id = ++requestId;
    try {
      const response = await fetch("/api/rain-map/floods");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (id !== requestId || !toggle.checked) return;
      draw(data);
    } catch (error) {
      if (id !== requestId) return;
      status.textContent = `Flood layer unavailable: ${error.message}`;
    }
  }
  toggle.addEventListener("change", () => {
    panel.querySelector("#floodOptions").style.display = toggle.checked ? "" : "none";
    if (toggle.checked) { layer.addTo(map); refresh(); }
    else { ++requestId; map.removeLayer(layer); banner.style.display = "none"; }
  });
  layer.addTo(map);
  refresh();
  setInterval(refresh, 30000);
})();
