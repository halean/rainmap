/* Himawari-9 satellite. One layer; the sun decides what it is made of.

   By day the visible band (0.5 km reflected sunlight) is drawn as greyscale
   cloud texture with the infrared cold-top ramp composited over it. After dark
   the visible band sees nothing, so only the infrared remains.

   Both are drawn in daylight because they are different measurements, not two
   resolutions of one. Reflected light is how thick a cloud is; emitted heat is
   how high it reached. On a morning of thick low cloud the visible band alone
   paints a warm stratus deck as though it were a storm -- the infrared is what
   knows better, and it costs a tenth of what the visible band costs to fetch.

   Neither is rain. Cold tops and bright decks both sit over dry streets. */
(() => {
  map.createPane("himawariPane");
  map.getPane("himawariPane").style.zIndex = 330;  // above the basemap, under the radars
  map.getPane("himawariPane").style.opacity = 0.85;
  const layer = L.layerGroup();
  const panel = document.createElement("div");
  panel.innerHTML = `
    <label class="toggle-row"><input type="checkbox" id="himawariToggle"> Satellite (Himawari-9)</label>
    <div id="himawariOptions" hidden style="max-width:230px">
      <div id="himawariScale" style="height:9px;margin-top:8px"></div>
      <div id="himawariScaleLabels" style="display:flex;justify-content:space-between;font-size:10px"></div>
      <div id="himawariTexture" hidden>
        <div id="himawariTextureBar" style="height:7px;margin-top:6px"></div>
        <div style="display:flex;justify-content:space-between;font-size:10px"><span>thin cloud</span><span>thick</span></div>
      </div>
      <div class="note" id="himawariNote"></div>
      <div id="himawariStatus" class="note" role="status"></div>
    </div>`;
  legendBoxEl.appendChild(panel);
  L.DomEvent.disableScrollPropagation(panel);
  const toggle = panel.querySelector("#himawariToggle");
  const status = panel.querySelector("#himawariStatus");
  const note = panel.querySelector("#himawariNote");
  const texture = panel.querySelector("#himawariTexture");
  let requestId = 0, shownScan = null;
  const localLabel = (iso) => new Date(iso).toLocaleString("en-GB", {timeZone: "Asia/Ho_Chi_Minh"});

  // Ramps come from the API so the key always matches the pixels. Stops are
  // composited onto white here because a gradient swatch has nothing behind it.
  function gradient(scale) {
    const first = scale[0].value, last = scale[scale.length - 1].value;
    return scale.map((s) => {
      const rgb = [1, 3, 5].map((i) => parseInt(s.color.slice(i, i + 2), 16));
      const over = rgb.map((v) => Math.round(255 * (1 - s.opacity) + v * s.opacity));
      return `rgb(${over.join(",")}) ${(((s.value - first) / (last - first)) * 100).toFixed(1)}%`;
    }).join(",");
  }

  function drawScales(data) {
    panel.querySelector("#himawariScale").style.background =
      `linear-gradient(to right, ${gradient(data.scale)})`;
    const mid = Math.floor(data.scale.length / 2);
    panel.querySelector("#himawariScaleLabels").innerHTML =
      `<span>${data.scale[0].label}</span><span>${data.scale[mid].label}</span>` +
      `<span>${data.scale[data.scale.length - 1].label}</span>`;
    texture.hidden = !data.texture_scale;
    if (data.texture_scale) {
      panel.querySelector("#himawariTextureBar").style.background =
        `linear-gradient(to right, ${gradient(data.texture_scale)})`;
    }
  }

  async function refresh() {
    if (!toggle.checked) return;
    const id = ++requestId;
    // A daylight scan is ~71 MB for the server to fetch and decode, so say so
    // rather than leaving the panel silent for half a minute.
    if (!shownScan) status.textContent = "Loading satellite…";
    try {
      const response = await fetch("/api/rain-map/himawari");
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `HTTP ${response.status}`);
      const data = await response.json();
      if (id !== requestId || !toggle.checked) return;
      drawScales(data);
      note.textContent = data.mode === "daylight"
        ? "Colour is cloud-top temperature; grey is cloud thickness at 0.5 km. Cold tops are tall storm clouds — cloud is not rain."
        : "Cloud-top temperature, 2 km, every 10 minutes. Colder tops are taller storm clouds — cloud is not rain.";
      if (data.scan !== shownScan) {
        const image = L.imageOverlay(data.image_url, data.bounds, {
          pane: "himawariPane", interactive: false,
          attribution: 'Cloud tops &copy; <a href="https://www.data.jma.go.jp/mscweb/en/index.html">JMA</a> Himawari-9, via <a href="https://registry.opendata.aws/noaa-himawari/">NOAA on AWS</a>',
        });
        image.once("load", () => layer.getLayers().filter((l) => l !== image).forEach((l) => layer.removeLayer(l)));
        image.addTo(layer);
        shownScan = data.scan;
      }
      const tops = data.coldest_k === null ? "no reading"
        : `${Math.round(data.coldest_k - 273.15)}°C coldest top`;
      status.textContent = `Scan ${localLabel(data.scan)} ICT, ${data.age_minutes} min old. ${tops}. ` +
        `Sun ${data.solar_elevation}°, showing ${data.label}. ` +
        (data.coverage < 1 ? `${Math.round(data.coverage * 100)}% of the box has data.` : "");
    } catch (error) {
      if (id !== requestId) return;
      layer.clearLayers();
      shownScan = null;
      status.textContent = `Satellite layer unavailable: ${error.message}`;
    }
  }

  toggle.addEventListener("change", () => {
    panel.querySelector("#himawariOptions").hidden = !toggle.checked;
    if (toggle.checked) { layer.addTo(map); refresh(); }
    else { ++requestId; map.removeLayer(layer); }
  });
  setInterval(refresh, 120000);
})();
