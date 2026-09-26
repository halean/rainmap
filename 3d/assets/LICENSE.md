# Licenses of the files in `3d/assets`

The repository's [MIT License](../../LICENSE) covers the project's original
code and modelling. It does **not** cover the map data in these files.
Several of them are generated from OpenStreetMap and stay under OSM's
license. This file says which is which.

## OpenStreetMap-derived: ODbL 1.0

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

These files re-encode OSM data (building footprints and heights, roads,
bridges, water and parks, in local metres) and are made available under the
ODbL:

| File | What it holds |
|---|---|
| `tiles/*.glb` | the city in 2 km tiles: buildings, roads, bridges, water, parks |
| `overview.glb` | the whole city at low detail |
| `skyline.glb` | the high-rises, for the distant view |
| `streets.json` | street names and centrelines |
| `manifest.json` | the tile index, the build's source and statistics |

The build's source is the Geofabrik extract of Vietnam dated 18 Sep 2026
(`vietnam-260918.osm.pbf`). Its URL and SHA-256 hash are recorded in
`manifest.json`. Anyone can rebuild these files with
[`3d/tools/build.py`](../tools/build.py) and [`3d/tools/skyline.py`](../tools/skyline.py).

**Landmarks built on OSM outlines.** Several landmark and tower models take
their footprints and heights from OSM: the Majestic, Rex, the Opera House,
the riverfront and city towers, and others. The outlines and heights are
listed in the code (`riverfront-lines.js`, `citytowers-lines.js`, and the
landmark modules' constants). These models are built in the browser, not
stored here. Where their geometry is exported, the OSM-derived part is
likewise ODbL, and the modelling added on top is MIT.

If you use or redistribute these files, you must:
- keep the attribution "© OpenStreetMap contributors";
- keep derived data under the ODbL;
- for maps, images and video made from them, credit OpenStreetMap as its
  [attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
  describe.

## Original models: MIT

These models are the project's own procedural modelling, with no OSM
geometry, and are covered by the repository's MIT License:

| File | What it holds |
|---|---|
| `princess60-nharong.glb` | the Princess 60 *Nha Rong*, full model |
| `princess60-nharong-lod1.glb`, `princess60-nharong-lod2.glb` | its simplified proxies |
| `seven-kho.glb` | 7 Khô, full model (its footprint is estimated from photographs) |
| `seven-kho-lod1.glb` | its simplified proxy |

## Third-party data

| File | Terms |
|---|---|
| `cameras.json` | the traffic-camera list (ids, names, positions) from the city's public camera service; it stays subject to that provider's terms, and neither MIT nor the ODbL applies |

This file describes the project's licensing intent. It is not legal advice.
