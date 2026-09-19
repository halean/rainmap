/* Himawari-9 satellite imagery, two bands of the same instrument.

   Infrared reads cloud-top temperature day and night -- cold tops mean deep
   convection, which is where the city's rain comes from. Visible is four times
   finer and shows the texture of individual towers, but it only sees reflected
   sunlight, so it is offered when the sun is up.

   Both are cloud, not rain, and the panel says so: tops can be cold, or a deck
   can be bright, over a street that stays dry. */
(() => {
  map.createPane("himawariPane");
  map.getPane("himawariPane").style.zIndex = 330;  // above the basemap, under the radars
  map.getPane("himawariPane").style.opacity = 0.85;
  const layer = L.layerGroup();
  const panel = document.createElement("div");
  panel.innerHTML = `
    <label class="toggle-row"><input type="checkbox" id="himawariToggle"> Satellite (Himawari-9)</label>
    <div id="himawariOptions" hidden style="max-width:230px">
      <label>Band <select id="himawariBand" aria-label="Himawari band">
        <option value="B13" selected>Cloud tops (infrared)</option>
        <option value="B03">Visible (daylight only)</option>
      </select></label>
      <div id="himawariScale" style="height:9px;margin-top:8px"></div>
      <div id="himawariScaleLabels" style="display:flex;justify-content:space-between;font-size:10px"></div>
      <div class="note" id="himawariNote"></div>
      <div id="himawariStatus" class="note" role="status"></div>
    </div>`;
  legendBoxEl.appendChild(panel);
  L.DomEvent.disableScrollPropagation(panel);
  const toggle = panel.querySelector("#himawariToggle");
  const bandSel = panel.querySelector("#himawariBand");
  const status = panel.querySelector("#himawariStatus");
  const note = panel.querySelector("#himawariNote");
  let requestId = 0, shownKey = null;
  const localLabel = (iso) => new Date(iso).toLocaleString("en-GB", {timeZone: "Asia/Ho_Chi_Minh"});

  const NOTES = {
    infrared: "Band 13 infrared, 2 km, every 10 minutes. Colder tops are taller storm clouds.",
    visible: "Band 3 visible, 0.5 km, every 10 minutes. Brighter means thicker cloud — but reflected light cannot tell a low deck from a storm.",
  };

  // The ramp comes from the API so the key always matches the pixels. Stops are
  // composited onto white here because a gradient swatch has nothing behind it.
  function drawScale(scale) {
    const first = scale[0].value, last = scale[scale.length - 1].value;
    const stops = scale.map((s) => {
      const rgb = [1, 3, 5].map((i) => parseInt(s.color.slice(i, i + 2), 16));
      const over = rgb.map((v) => Math.round(255 * (1 - s.opacity) + v * s.opacity));
      const at = ((s.value - first) / (last - first)) * 100;
      return `rgb(${over.join(",")}) ${at.toFixed(1)}%`;
    });
    panel.querySelector("#himawariScale").style.background = `linear-gradient(to right, ${stops.join(",")})`;
    panel.querySelector("#himawariScaleLabels").innerHTML =
      `<span>${scale[0].label}</span><span>${scale[Math.floor(scale.length / 2)].label}</span>` +
      `<span>${scale[scale.length - 1].label}</span>`;
  }

  async function refresh() {
    if (!toggle.checked) return;
    const id = ++requestId;
    const band = bandSel.value;
    if (!shownKey || !shownKey.startsWith(band)) {
      // A visible scan is ~65 MB for the server to fetch and decode, so say so
      // rather than leaving the panel silent for twenty seconds.
      status.textContent = band === "B03" ? "Loading visible scan (this takes a moment)…"
                                          : "Loading satellite…";
    }
    try {
      const response = await fetch(`/api/rain-map/himawari?band=${band}`);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `HTTP ${response.status}`);
      const data = await response.json();
      if (id !== requestId || !toggle.checked || bandSel.value !== band) return;
      drawScale(data.scale);
      note.textContent = NOTES[data.kind] || "";
      const key = `${data.band}@${data.scan}`;
      if (key !== shownKey) {
        const image = L.imageOverlay(data.image_url, data.bounds, {
          pane: "himawariPane", interactive: false,
          attribution: 'Cloud tops &copy; <a href="https://www.data.jma.go.jp/mscweb/en/index.html">JMA</a> Himawari-9, via <a href="https://registry.opendata.aws/noaa-himawari/">NOAA on AWS</a>',
        });
        image.once("load", () => layer.getLayers().filter((l) => l !== image).forEach((l) => layer.removeLayer(l)));
        image.addTo(layer);
        shownKey = key;
      }
      const reading = data.extreme === null ? "no reading"
        : data.kind === "infrared" ? `${Math.round(data.extreme - 273.15)}°C coldest top`
        : `${Math.round(data.extreme * 100)}% brightest cloud`;
      status.textContent = `Scan ${localLabel(data.scan)} ICT, ${data.age_minutes} min old. ${reading}. ` +
        (data.coverage < 1 ? `${Math.round(data.coverage * 100)}% of the box has data.` : "");
    } catch (error) {
      if (id !== requestId) return;
      // The visible band going dark is expected once a day, not a fault.
      layer.clearLayers();
      shownKey = null;
      status.textContent = `Satellite layer unavailable: ${error.message}`;
    }
  }

  toggle.addEventListener("change", () => {
    panel.querySelector("#himawariOptions").hidden = !toggle.checked;
    if (toggle.checked) { layer.addTo(map); refresh(); }
    else { ++requestId; map.removeLayer(layer); }
  });
  bandSel.addEventListener("change", () => { layer.clearLayers(); shownKey = null; refresh(); });
  setInterval(refresh, 120000);
})();
