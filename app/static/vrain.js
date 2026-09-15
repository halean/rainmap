/* Gauge amounts stay in millimetres; the blue field is a spatial estimate. */
(() => {
  map.createPane("vrainPane");
  map.getPane("vrainPane").style.zIndex = 460;
  const layer = L.layerGroup();
  const panel = document.createElement("div");
  panel.innerHTML = `
    <label class="toggle-row"><input type="checkbox" id="vrainToggle"> VRAIN gauge density</label>
    <div id="vrainOptions" hidden style="max-width:230px">
      <label>Accumulation <select id="vrainHours" aria-label="VRAIN accumulation period">
        <option value="1">1 hour</option><option value="3" selected>3 hours</option>
        <option value="6">6 hours</option><option value="24">24 hours</option>
      </select></label><br>
      <label>Ending (Vietnam time)<br><input id="vrainAt" type="datetime-local" style="max-width:190px"></label>
      <button id="vrainLatest" type="button">Latest</button>
      <div style="height:9px;margin-top:8px;background:linear-gradient(to right,#dbeafe,#38bdf8,#2563eb,#312e81)"></div>
      <div style="display:flex;justify-content:space-between;font-size:10px"><span>0</span><span>1</span><span>10</span><span>50+ mm</span></div>
      <div class="note">Gauge increases over this period, interpolated within 12 km. Updates roughly hourly. Click gauges for coverage; partial totals may miss rain.</div>
      <div id="vrainStatus" class="note" role="status"></div>
    </div>`;
  legendBoxEl.appendChild(panel);
  L.DomEvent.disableScrollPropagation(panel);
  const toggle = panel.querySelector("#vrainToggle");
  const hours = panel.querySelector("#vrainHours");
  const at = panel.querySelector("#vrainAt");
  const status = panel.querySelector("#vrainStatus");
  let historical = false, requestId = 0;
  const localInput = (iso) => new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 16);
  const localLabel = (iso) => new Date(iso).toLocaleString("en-GB", {timeZone: "Asia/Ho_Chi_Minh"});

  function color(mm) {
    const stops = [[0,219,234,254], [1,56,189,248], [10,37,99,235], [50,49,46,129]];
    mm = Math.min(50, Math.max(0, mm));
    const i = mm <= 1 ? 0 : mm <= 10 ? 1 : 2;
    const a = stops[i], b = stops[i + 1], f = (mm - a[0]) / (b[0] - a[0]);
    return a.slice(1).map((v, j) => Math.round(v + (b[j + 1] - v) * f));
  }

  function draw(data) {
    layer.clearLayers();
    const points = data.points.filter(p => p.rain_mm !== null && !p.stale);
    if (points.length) {
      const south = Math.min(...points.map(p => p.lat)) - 0.11;
      const north = Math.max(...points.map(p => p.lat)) + 0.11;
      const west = Math.min(...points.map(p => p.lon)) - 0.11;
      const east = Math.max(...points.map(p => p.lon)) + 0.11;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 180;
      const ctx = canvas.getContext("2d"), pixels = ctx.createImageData(180, 180);
      const lonKm = 111.32 * Math.cos((north + south) / 2 * Math.PI / 180);
      // Sample in Web Mercator so pixels align with Leaflet's image bounds.
      const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
      const top = merc(north), bottom = merc(south);
      for (let y = 0; y < 180; y++) {
        const lat = (2 * Math.atan(Math.exp(top + (bottom - top) * (y + 0.5) / 180)) - Math.PI / 2) * 180 / Math.PI;
        for (let x = 0; x < 180; x++) {
          const lon = west + (east - west) * (x + 0.5) / 180;
          let weight = 0, amount = 0;
          for (const p of points) {
            const d2 = ((lon - p.lon) * lonKm) ** 2 + ((lat - p.lat) * 110.57) ** 2;
            if (d2 > 144) continue;
            const w = Math.exp(-d2 / 32) * p.coverage;
            weight += w;
            amount += w * p.rain_mm;
          }
          const mm = weight ? amount / weight : 0, i = (y * 180 + x) * 4;
          const rgb = color(mm);
          pixels.data.set(rgb, i);
          pixels.data[i + 3] = Math.round(190 * Math.min(1, weight) * Math.min(1, mm));
        }
      }
      ctx.putImageData(pixels, 0, 0);
      L.imageOverlay(canvas.toDataURL(), [[south, west], [north, east]], {pane: "vrainPane", interactive: false}).addTo(layer);
    }
    for (const p of data.points) {
      const popup = document.createElement("div");
      const amount = p.rain_mm === null ? "Unavailable" : `${p.partial ? "At least " : ""}${p.rain_mm.toFixed(1)} mm`;
      popup.textContent = `${p.station}: ${amount} / ${data.window_hours} h. ` +
        `Coverage ${Math.round(p.coverage * 100)}%. ${p.excluded_intervals} excluded intervals. ` +
        `Last observation ${localLabel(p.observed_at)} ICT.${p.stale ? " Station data stale." : ""}`;
      L.circleMarker([p.lat, p.lon], {pane: "pinsPane", radius: 5, weight: 1,
        color: "#1e3a8a", fillColor: p.rain_mm === null ? "#94a3b8" : `rgb(${color(p.rain_mm).join(",")})`,
        fillOpacity: 0.9, dashArray: p.partial ? "2 2" : undefined}).bindPopup(popup).addTo(layer);
    }
    const wet = points.filter(p => p.rain_mm > 0).length;
    const reset = data.resets.daily.map(r => `around ${String(r.local_hour).padStart(2,"0")}:00 ICT (${r.days_observed} days)`).join(", ");
    status.textContent = `${localLabel(data.start)} – ${localLabel(data.end)} ICT. ` +
      `${wet}/${points.length} gauges increased. ${data.points.filter(p => p.partial).length} partial. ` +
      `${data.stale ? "Log is stale. " : ""}${!data.latest ? "No gauge history. " : ""}` +
      `Inferred daily reset: ${reset || "not enough evidence"}.`;
  }

  async function refresh() {
    if (!toggle.checked) return;
    const id = ++requestId;
    status.textContent = "Loading gauges…";
    try {
      const query = new URLSearchParams({hours: hours.value});
      if (historical && at.value) query.set("at", `${at.value}:00+07:00`);
      const response = await fetch(`/api/rain-map/vrain?${query}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (id !== requestId || !toggle.checked) return;
      if (!historical && data.latest) at.value = localInput(data.latest);
      if (data.history_start) at.min = localInput(data.history_start);
      if (data.latest) at.max = localInput(data.latest);
      draw(data);
    } catch (error) {
      if (id !== requestId) return;
      layer.clearLayers();
      status.textContent = `Gauge layer unavailable: ${error.message}`;
    }
  }
  toggle.addEventListener("change", () => {
    panel.querySelector("#vrainOptions").hidden = !toggle.checked;
    if (toggle.checked) { layer.addTo(map); refresh(); }
    else { ++requestId; map.removeLayer(layer); }
  });
  hours.addEventListener("change", refresh);
  at.addEventListener("change", () => { historical = Boolean(at.value); refresh(); });
  panel.querySelector("#vrainLatest").addEventListener("click", () => { historical = false; refresh(); });
  setInterval(() => { if (!historical) refresh(); }, 60000);
})();
