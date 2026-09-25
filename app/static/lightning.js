/* Real strikes from HYMETNET's rich feed (app/services/lightning_vn.py,
 * scripts/hymetnet_poller.py) -- not a dramatization. Every strike within
 * HIMAWARI_BBOX over the trailing window is plotted, fading with age so a
 * quiet map still shows what recently happened nearby, and a strike that is
 * new since the last poll gets a brief pulse so a real one is unmissable. */
(() => {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes lightningPulse { from { transform: scale(0.4); opacity: 0.9; } to { transform: scale(3.4); opacity: 0; } }
    .lightning-pulse-icon { border-radius: 50%; border: 2px solid #f8d94a; animation: lightningPulse 1.4s ease-out; pointer-events: none; }
    .lightning-bolt { display: block; overflow: visible; filter: drop-shadow(0 0 1.5px rgba(0,0,0,0.45)); }
    .legend-box .sw.bolt { border: 0; border-radius: 0; background: none; display: inline-flex; }
  `;
  document.head.appendChild(style);

  map.createPane("lightningPane");
  // Above pinsPane (650), so a real strike stands out, but below Leaflet's
  // popupPane (700): at an equal 700 this pane came later in the DOM and drew
  // bolts over any open popup.
  map.getPane("lightningPane").style.zIndex = 680;
  const layer = L.layerGroup();
  const pulses = L.layerGroup();
  const panel = document.createElement("div");
  panel.innerHTML = `
    <label class="toggle-row"><input type="checkbox" id="lightningToggle" checked> Lightning (HYMETNET, live)</label>
    <div id="lightningOptions" style="max-width:230px">
      <div class="row"><span class="sw bolt" data-color="#d03b3b"></span>Cloud-to-ground</div>
      <div class="row"><span class="sw bolt" data-color="#7c3aed"></span>In-cloud</div>
      <div class="note">Real strikes from Vietnam's national lightning network (HYMETNET), not a camera-based estimate. Markers fade over the trailing window; a strike new since the last check briefly pulses.</div>
      <div id="lightningStatus" class="note" role="status"></div>
    </div>`;
  legendBoxEl.appendChild(panel);
  L.DomEvent.disableScrollPropagation(panel);
  const toggle = panel.querySelector("#lightningToggle");
  const status = panel.querySelector("#lightningStatus");
  const WINDOW_MINUTES = 90;
  // Oldest-in-window strikes stay visible as dim history, not gone. Higher than
  // the old dots' 0.22: a thin bolt at that opacity vanished into the basemap.
  const FADE_FLOOR = 0.45;
  let requestId = 0, seenIds = new Set();

  // A flash symbol rather than a dot, so a strike reads as lightning at a
  // glance and can't be confused with a camera pin. Pale outline for contrast
  // on both the dark rain field and light basemap. The viewBox is the path's
  // 12x20 box plus half a unit of room for the outline on each side (13x21);
  // markers are anchored at the bolt's lower tip, (3.8, 20) in path units.
  const BOLT = "M7.5 0 L0.5 11.2 H5.6 L3.8 20 L11.5 7.6 H6.3 Z";
  const boltSvg = (color, width, opacity = 1) =>
    `<svg class="lightning-bolt" width="${width}" height="${width * 21 / 13}" viewBox="-0.5 -0.5 13 21" style="opacity:${opacity}">` +
    `<path d="${BOLT}" fill="${color}" stroke="#fef3c7" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
  panel.querySelectorAll(".sw.bolt").forEach(el => { el.innerHTML = boltSvg(el.dataset.color, 9); });

  const localLabel = (iso) => new Date(iso).toLocaleString("en-GB", {timeZone: "Asia/Ho_Chi_Minh"});
  const strikeId = (s) => `${s.time}:${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;

  function draw(data) {
    layer.clearLayers();
    const freshIds = new Set();
    for (const s of data.strikes) {
      const id = strikeId(s);
      freshIds.add(id);
      const age = Math.max(0, s.age_seconds);
      const fade = Math.max(FADE_FLOOR, 1 - age / (data.window_minutes * 60));
      const color = s.kind === "cloud" ? "#7c3aed" : "#d03b3b";
      // Scales with peak current like the dots did (radius 4-10 px), a bit
      // larger since a bolt covers far less area than a disc of the same width.
      const width = 1.4 * 2 * (4 + Math.min(6, Math.abs(s.current_ka) / 20));
      const height = width * 21 / 13;
      const popup = document.createElement("div");
      popup.textContent = `${s.kind === "cloud" ? "In-cloud" : "Cloud-to-ground"} · ${Math.abs(s.current_ka).toFixed(0)} kA · ` +
        `${localLabel(s.time)} ICT · ${age < 60 ? `${age}s ago` : `${Math.round(age / 60)} min ago`}`;
      const icon = L.divIcon({className: "", html: boltSvg(color, width, fade),
        iconSize: [width, height], iconAnchor: [width * 4.3 / 13, height * 20.5 / 21], popupAnchor: [0, -height]});
      L.marker([s.lat, s.lon], {pane: "lightningPane", icon, keyboard: false}).bindPopup(popup).addTo(layer);
      if (!seenIds.has(id)) {
        const icon = L.divIcon({className: "", html: `<div class="lightning-pulse-icon" style="width:34px;height:34px"></div>`, iconSize: [34, 34], iconAnchor: [17, 17]});
        const marker = L.marker([s.lat, s.lon], {pane: "lightningPane", icon, interactive: false}).addTo(pulses);
        setTimeout(() => pulses.removeLayer(marker), 1500);
      }
    }
    seenIds = freshIds;
    if (data.collector_stale) {
      status.textContent = `Lightning collector may be down -- no data received in over 20 min` +
        (data.latest_anywhere ? ` (last saw activity ${localLabel(data.latest_anywhere)} ICT).` : ".");
    } else if (data.count === 0) {
      status.textContent = `No lightning detected in the region in the last ${data.window_minutes} min.` +
        (data.latest_anywhere ? ` Collector last saw activity elsewhere at ${localLabel(data.latest_anywhere)} ICT.` : "");
    } else {
      status.textContent = `${data.count} strike${data.count === 1 ? "" : "s"} in the last ${data.window_minutes} min. ` +
        `Latest ${localLabel(data.latest)} ICT.`;
    }
  }

  async function refresh() {
    if (!toggle.checked) return;
    const id = ++requestId;
    try {
      const response = await fetch(`/api/rain-map/lightning?minutes=${WINDOW_MINUTES}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (id !== requestId || !toggle.checked) return;
      draw(data);
    } catch (error) {
      if (id !== requestId) return;
      status.textContent = `Lightning layer unavailable: ${error.message}`;
    }
  }
  toggle.addEventListener("change", () => {
    panel.querySelector("#lightningOptions").style.display = toggle.checked ? "" : "none";
    if (toggle.checked) { layer.addTo(map); pulses.addTo(map); seenIds = new Set(); refresh(); }
    else { ++requestId; map.removeLayer(layer); map.removeLayer(pulses); }
  });
  layer.addTo(map);
  pulses.addTo(map);
  refresh();
  setInterval(refresh, 30000);
})();
