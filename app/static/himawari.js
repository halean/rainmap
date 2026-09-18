/* Himawari-9 cloud-top temperature. Cold tops mean deep convection, which is
   where the city's rain comes from -- but this is cloud, not rain, and it is
   labelled that way: the tops can be cold over a street that stays dry. */
(() => {
  map.createPane("himawariPane");
  map.getPane("himawariPane").style.zIndex = 330;  // above the basemap, under the radars
  map.getPane("himawariPane").style.opacity = 0.85;
  const layer = L.layerGroup();
  const panel = document.createElement("div");
  panel.innerHTML = `
    <label class="toggle-row"><input type="checkbox" id="himawariToggle"> Satellite cloud tops (Himawari-9)</label>
    <div id="himawariOptions" hidden style="max-width:230px">
      <div id="himawariScale" style="height:9px;margin-top:8px"></div>
      <div id="himawariScaleLabels" style="display:flex;justify-content:space-between;font-size:10px"></div>
      <div class="note">Band 13 infrared, 2 km, every 10 minutes. Colder tops are taller storm clouds. Cloud is not rain &mdash; compare it with the cameras rather than reading it as rainfall.</div>
      <div id="himawariStatus" class="note" role="status"></div>
    </div>`;
  legendBoxEl.appendChild(panel);
  L.DomEvent.disableScrollPropagation(panel);
  const toggle = panel.querySelector("#himawariToggle");
  const status = panel.querySelector("#himawariStatus");
  let requestId = 0, shownScan = null;
  const localLabel = (iso) => new Date(iso).toLocaleString("en-GB", {timeZone: "Asia/Ho_Chi_Minh"});

  // The ramp comes from the API so the key always matches the pixels. Stops are
  // composited onto white here because a gradient swatch has nothing behind it.
  function drawScale(scale) {
    const warmest = scale[0].celsius, coldest = scale[scale.length - 1].celsius;
    const stops = scale.map((s) => {
      const rgb = [1, 3, 5].map((i) => parseInt(s.color.slice(i, i + 2), 16));
      const over = rgb.map((v) => Math.round(255 * (1 - s.opacity) + v * s.opacity));
      const at = ((warmest - s.celsius) / (warmest - coldest)) * 100;
      return `rgb(${over.join(",")}) ${at.toFixed(1)}%`;
    });
    panel.querySelector("#himawariScale").style.background = `linear-gradient(to right, ${stops.join(",")})`;
    panel.querySelector("#himawariScaleLabels").innerHTML =
      `<span>${warmest}&deg;C</span><span>${Math.round((warmest + coldest) / 2)}&deg;C</span><span>${coldest}&deg;C or colder</span>`;
  }

  async function refresh() {
    if (!toggle.checked) return;
    const id = ++requestId;
    if (!shownScan) status.textContent = "Loading satellite…";
    try {
      const response = await fetch("/api/rain-map/himawari");
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `HTTP ${response.status}`);
      const data = await response.json();
      if (id !== requestId || !toggle.checked) return;
      drawScale(data.scale);
      // Each scan is a separate cached image; only swap when a new one lands.
      if (data.scan !== shownScan) {
        const image = L.imageOverlay(data.image_url, data.bounds, {
          pane: "himawariPane", interactive: false,
          attribution: 'Cloud tops &copy; <a href="https://www.data.jma.go.jp/mscweb/en/index.html">JMA</a> Himawari-9, via <a href="https://registry.opendata.aws/noaa-himawari/">NOAA on AWS</a>',
        });
        image.once("load", () => layer.getLayers().filter((l) => l !== image).forEach((l) => layer.removeLayer(l)));
        image.addTo(layer);
        shownScan = data.scan;
      }
      const coldest = data.coldest_k === null ? "no reading" : `${Math.round(data.coldest_k - 273.15)}°C coldest top`;
      status.textContent = `Scan ${localLabel(data.scan)} ICT, ${data.age_minutes} min old. ${coldest}. ` +
        (data.coverage < 1 ? `${Math.round(data.coverage * 100)}% of the box has data.` : "");
    } catch (error) {
      if (id !== requestId) return;
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
