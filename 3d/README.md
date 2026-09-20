# HCMC Rain Map · 3D

The 3D viewer is served at https://muaroi.dynv6.net/3d/ from
`/media/150G/rainmap/3d/`. The main `/rain-map` page links here.
Nginx serves these static files directly; weather requests use the existing
same-origin `/api/rain-map` routes. No separate 3D service is required.

The initial Central HCMC view looks through the falling rain. Camera density
refreshes every minute; VRAIN accumulation and Himawari cloud imagery refresh
every two minutes. The legend shares the 2D map's saved hide/show preference.

## What belongs in Git

Keep the viewer HTML/CSS/JavaScript, bundled `vendor/` runtime and its license,
this README, and `tools/` in Git. Generated `3d/assets/` (GLBs, manifest,
search/camera indexes and compressed feature records), `3d/build-cache/`,
`3d/.venv-build/` and downloaded OSM PBFs are ignored. Ignoring files leaves the
currently deployed assets on disk. A fresh checkout needs a build before the
3D map can load.

Source camera coordinates are already versioned at
`data/derived/camera_locations.json`. The builder uses the full coordinate list,
not the rotating live rain sample. Keep the source camera revision and OSM PBF
for reproducibility.

## Rebuild assets on the Oracle VM

Run from `/media/150G/rainmap`. Use Python **3.10 or newer**; the VM's default
`python3` is 3.8, while the existing service `.venv/bin/python` is 3.10.
Create a separate build environment; these commands do not install anything
into the service environment:

```sh
cd /media/150G/rainmap
.venv/bin/python -m venv 3d/.venv-build
3d/.venv-build/bin/python -m pip install -r 3d/tools/requirements.txt
mkdir -p 3d/build-cache
curl -L --fail --retry 3 \
  -o 3d/build-cache/vietnam-260918.osm.pbf \
  https://download.geofabrik.de/asia/vietnam-260918.osm.pbf
```

The deployed model used the 18 September 2026 extract. Verify that exact input:

```sh
printf '%s\n' 'c9809abbc9ea4c9be0be9823f09a1b1268abb86249040245a8ba193a8057231b  3d/build-cache/vietnam-260918.osm.pbf' | sha256sum -c -
```

Historical extracts may expire. If the URL is unavailable, use an archived copy
of that PBF for the same source, or download `vietnam-latest.osm.pbf` from the
same Geofabrik directory. For a different extract, pass its actual URL with
`--source-url` and expect different geometry/counts; do not apply the old hash.
The builder records the supplied URL and computes the PBF hash in the manifest.

Build into a new staging directory, then validate it before publishing:

```sh
build_stage="3d/build-cache/assets-$(date +%Y%m%d-%H%M%S)"
3d/.venv-build/bin/python -u 3d/tools/build.py \
  3d/build-cache/vietnam-260918.osm.pbf \
  --cameras data/derived/camera_locations.json \
  --source-url https://download.geofabrik.de/asia/vietnam-260918.osm.pbf \
  --output "$build_stage"
3d/.venv-build/bin/python 3d/tools/validate_models.py --assets "$build_stage"
```

Use the same shell for these commands so `build_stage` remains set. National
OSM parsing and mesh generation take several minutes and substantial memory;
allow space for the PBF, staging output and the previous assets. The deployed
snapshot has 504 tiles plus an overview, approximately 486 MB of GLB data.
The builder writes only inside the output directory. Validation checks GLB
structure, vertex data, manifest sizes, triangle winding and camera coverage.

After validation succeeds, publish during a quiet moment (the two renames
leave a brief gap for new asset requests). Keep the backup for rollback:

```sh
assets_backup="3d/build-cache/assets-previous-$(date +%Y%m%d-%H%M%S)"
if [ -d 3d/assets ]; then mv 3d/assets "$assets_backup"; fi
if ! mv "$build_stage" 3d/assets; then
  if [ -d "$assets_backup" ]; then mv "$assets_backup" 3d/assets; fi
  exit 1
fi
```

No FastAPI restart or Nginx reload is needed for updated static assets. Reload
`/3d/`, confirm Central HCMC loads detailed buildings, try street search, and
check the camera rain, gauge and cloud statuses. Weather service availability
is independent of the asset build.

## Coverage and accuracy

The original build covers the rectangle around 753 camera locations, padded
by 0.01 degrees: west 106.442713, south 10.632472, east 106.860624, north
10.998295. This is not the full municipal boundary. Source data is OpenStreetMap
via Geofabrik, © OpenStreetMap contributors, ODbL 1.0.

Models use metres, X east / Y up / Z south, relative to 106.65° E, 10.81° N.
Road widths and most building heights are estimated from OSM tags or defaults;
terrain is flat. The manifest documents the assumptions. The camera rain field
is spatial interpolation of ordinal readings, not measured mm/h. Cloud imagery
is shown at a schematic 2.5 km height, not a measured cloud altitude.
