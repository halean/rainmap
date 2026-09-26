# Princess 60 — Nha Rong (second yacht)

**On a continuous river tour** with *Saigon Star*, half a lap apart, round
the Saigon River from off the Vinhomes Central Park Marina to the Phú Mỹ
bridge and back, at 35 knots (`rivertour.js`, see `RIVERTOUR.md`). It never
moors.

`princess60-berth.js` places the yacht in the city and manages its levels of
detail; its starting position, alongside *Saigon Star* on the open-water side
with 5.8 m centreline spacing and a waterline of -0.12 m, is where the model
is first built before the tour takes it. The four raft lines it defines are
no longer drawn, since the two yachts are never both at the berth.
[Moored pair preview](assets/princess60-moored-pair.png) (from when the pair
lay at the marina).

## Inspect and download

- [Interactive inspection page](princess60-nharong.html): orbit/zoom, profile, stern,
  foredeck, flybridge and running-gear views; wireframe and a saloon reveal control.
- [Standalone GLB](assets/princess60-nharong.glb) — **40.71 MiB**.
- [Overview](assets/princess60-nharong-overview.png),
  [stern](assets/princess60-nharong-stern.png),
  [flybridge](assets/princess60-nharong-flybridge.png),
  [sunbathers](assets/princess60-nharong-sunbathers.png).

Serve the repository over HTTP (ES modules cannot load from `file://`):

```sh
python3 -m http.server 8789 --bind 127.0.0.1
```

Open `http://127.0.0.1:8789/3d/princess60-nharong.html`.
The preview is a studio inspection, with the boat above a neutral floor, separate from the city berth. No external services or texture downloads are required.

## Model

`createPrincess60NhaRong()` in `princess60-nharong.js` returns
`{group, components, materials, triangles, dispose}`. Construction has no scene
side effects. The caller may attach `group` to an inspection scene. `dispose()`
removes it and releases its geometry and materials; repeated calls are safe.

Metres, Y up, +X toward the bow, +Z to port, design waterline Y = 0. The model's
metadata still carries `destination: 'Vinhomes Central Park Marina'` and
`status: 'moored-alongside-saigon-star'` from when it was moored; in the city the
tour overrides its position. The standalone asset stays in local coordinates;
`princess60-berth.js` supplies the city transform and `rivertour.js` moves it.

**1,723,097 triangles, 108 material-batched meshes, 12 named assemblies:**

- Smooth flared hull and V bottom, spray strakes, stainless rubbing band, boot
  stripe, oval portlights, four-pane owner-cabin glazing, intake louvers and stern name.
- Individually modelled teak planks, caulking gaps and butt joints; foredeck sunpads,
  piping, stitching, bolsters, towel, deck hatch and engine-room access hatch.
- Raked panoramic saloon glass, glazing mullions, windscreen wipers, triple aft
  sliding doors, sculpted coachroof and flybridge deck with a clear access opening.
- Main saloon sofas and table, galley counter, sink, cooktop, cabinetry and lower helm.
- Flybridge lounge and sunbed, twin helm chairs, wheel, displays, gauges, throttles,
  wet bar, barbecue grate, tap, wind deflector, radar arch, radomes and aerials.
- Cockpit upholstery and dining table, plates, tumblers and bottle; boarding steps,
  open transom notches, teak swim platform and retracted bathing ladder.
- Cleats and fasteners, rail stanchions, filler caps, fenders, rope coils, linked
  anchor chain, windlass, roller, anchor, navigation lights, searchlight and horns.
- Twin shafts, four-blade propellers, struts, rudders, trim tabs and exhausts.
- Three adult sunbathers: two reclining on the foredeck and one with bent knees on
  the flybridge sunbed. Modelled swimwear, hair, sunglasses, facial features,
  jointed limbs, fingers, toes, bracelets, towels and pillows; static poses.
- A curved, static Vietnamese ensign with a five-point star on both sides.

This is a high-detail visual interpretation of the 2012-era Princess 60, not
builder CAD or a surveyed replica. Lower accommodation and engines are not modelled.
There is no transport, physics or cloth animation. The saloon reveal hides the
superstructure, flybridge and its sunbather for inspection; it is not an opening roof mechanism.

The published nominal dimensions are 18.61 m overall, 4.83 m beam and 1.27 m draft.
Actual generated bounds including rails, fenders and aerials are approximately
18.493 × 5.213 × 8.422 m (length × width × total height); lowest point Y = -1.270 m,
highest Y = 7.152 m. Small fittings and interpreted hull proportions explain the
nominal-versus-mesh difference. There is no LOD or automatic triangle reduction.
Procedural non-indexed position/normal buffers total approximately 118.32 MiB; the
GLB shares vertices without reducing the triangle count.

## References

- [Princess 60 UK brochure](https://www.princess.co.uk/wp-content/uploads/2013/05/60-UK1.pdf):
  principal dimensions, layouts and equipment.
- [Princess Yachts Monaco — 2012 Princess 60](https://princessyachtsmonaco.com/yachts/princess-p60):
  exterior photograph and equipment references.

All model geometry and studio reflections are procedural. Reference photographs
are not bundled or used as textures. Furniture placement and small fittings are
interpretations, not measured dimensions.

## Build and verification

From the repository root:

```sh
node --loader ./tests/three-loader.mjs 3d/tools/export-princess60-nharong.mjs
node --loader ./tests/three-loader.mjs tests/princess60_nharong.mjs
```

The exporter writes the standalone GLB under `3d/assets/` (a generated, ignored
asset directory in this repository). Its twelve assemblies and named materials
remain separate in the GLB.

Checks cover finite vertex/normal buffers, outward-facing hull normals on both
sides, dimensions and draft, upper stairwell clearance, local-space asset
construction, disposal, and loading the generated GLB back through the vendored
Three.js GLTFLoader with matching triangle count, bounds and placement metadata.
The WebGL preview was inspected in Chromium from overview, profile, stern,
flybridge and underwater views. Refinements corrected hull winding, opened the
flybridge and transom boarding paths, moved the aft sunpad clear of the stairs,
raised the foredeck upholstery, corrected the ensign star and adjusted running gear.

## Berth verification

```sh
node --loader ./tests/three-loader.mjs tests/princess60_berth.mjs
node --loader ./tests/three-loader.mjs tests/yacht.mjs
```

Checks cover the starting placement beside *Saigon Star*, parallel headings,
clearance, waterline, the four raft lines, the levels of detail (built on demand,
released on leaving), independent disposal and preservation of the other yacht.
The tour itself is covered by `tests/rivertour.mjs`; the viewer's **River tour**
button follows the yachts (the former Yachts button is gone).

## In the city: levels of detail

In the city the yacht runs the river tour. The full model is never built at
page load. Which level is drawn depends on the camera's distance to the yacht,
wherever it is on the river:

| Distance | Drawn | Triangles |
|---|---|---|
| under 180 m | the full model | ~1.72 M |
| 180-700 m (and while the full model is building) | LOD1 proxy | ~42 k |
| 700 m-3 km | LOD2 proxy | ~9 k |
| beyond 3 km | nothing | 0 |

- **Full model:** built on demand in a Web Worker (`princess60-worker.js`,
  about 3-5 s in the test browser), so the page does not stall while it
  builds. Its geometry comes back as transferable buffers. It is freed once
  the camera has stayed beyond 350 m for 20 s, and rebuilt on return.
- **Proxies:** made offline from the full model by vertex clustering, at
  0.14 m and 0.35 m cells, one mesh per material:
  `node --loader ./tests/three-loader.mjs 3d/tools/build-princess60-lod.mjs 0.14 1`
  (and `0.35 2`), written to `assets/princess60-nharong-lod1.glb` (2.9 MB)
  and `-lod2.glb` (0.65 MB). Rerun both after changing the model.
- **Ensign:** in the city the ensign is the shared, waving flag (`flag.js`
  createFlagSet), hung at the top of the raked staff. It sails with the yacht
  and streams aft in the apparent wind. The model's own static
  flag is left out of the worker build and the proxies; the standalone
  inspection page still shows it.

`state.lod`, `state.triangles` and `state.cameraDistance` report the current
level.
