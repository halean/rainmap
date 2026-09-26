# 7 Khô — standalone restaurant study

The detailed local-space model remains available for standalone inspection.
**Integrated on Lý Thái Tổ** through `seven-kho-city.js`; use **7 Khô** in the city
viewer. The footprint is an aerial estimate, not a surveyed or OSM building polygon.

- [Interactive inspection](seven-kho.html)
- [GLB](assets/seven-kho.glb) — 17.43 MiB
- [Daylight preview](assets/seven-kho-preview.png)
- [Corrected frontage](assets/seven-kho-frontage.png)
- [Interior inspection](assets/seven-kho-interior.png)
- [Earlier furniture lighting study](assets/seven-kho-evening.png) — predates frontage correction
- [Furniture detail study](assets/seven-kho-table-details.png) — predates frontage correction

Serve the repository root (`python3 -m http.server 8789 --bind 127.0.0.1`) and open
`http://127.0.0.1:8789/3d/seven-kho.html`. The preview uses only local assets.

## Identification and research — 26 September 2026

The request named **Lý Thường Kiệt**. Searches found a strong match on **Lý Thái
Tổ**, but no matching Lý Thường Kiệt listing. The user subsequently confirmed Lý Thái Tổ and authorized city integration.

[MoMo](https://www.momo.vn/page/10046672) lists **98B Lý Thái Tổ** and hours of
15:00–23:59. Its menu photograph gives **94–96–98 Lý Thái Tổ, P.2, Q.3**.
[Foody](https://www.foody.vn/ho-chi-minh/7-kho-kho-muc-nuong) independently lists
“7 Khô – Khô Mực Nướng” at **98 Lý Thái Tổ**, with 16:00–23:59 hours. These
address/hour variations remain unresolved; neither is asserted as a verified
current operating schedule.

The MoMo photographs show pavement dining, dark folding chairs, small tables,
string lights, red lanterns, ornamental old façades and hanging dried seafood.
The photographed frontage also includes neighboring businesses: the model does
not claim that every visible shop belongs to the restaurant. Its menu carries
“Năm 1985”; that wording alone does not verify a founding date.

## Menu findings

Selected readable prices from the undated menu photographs in the MoMo gallery.
**Photographed prices, not confirmed current prices.** Amounts are VND.

| Item | Price |
|---|---:|
| Khô cá chỉ vàng | 79,000 |
| Khô cá đuối | 99,000 |
| Khô bạch tuộc | 99,000 |
| Mực một nắng Côn Đảo | 150,000 / 200,000 |
| Mực khô nướng / mực chiên mắm | 180,000–230,000 |
| Tré trộn 7 Khô | 89,000 |
| Chả ram Bình Định | 99,000 |
| Sụn gà rang muối / chiên mắm | 99,000 |
| Bò viên thố | 120,000 |
| Trứng cá lóc kho quẹt, kèm rau củ | 150,000 |
| Bia hơi Hà Nội, 2 L | 139,000 |
| Saigon / Tiger | 20,000 / 23,000 |

Additional photographed sections cover salads, grilled and stir-fried dishes,
and other snacks. This is a research selection, not a complete live menu.

### Direct visual references

All photographs below are linked for provenance, not bundled as model textures.

- [Menu cover and address](https://attachment.momocdn.net/common/u/2e02fb5fe4f64fb55bc713540643c6f8eae702d101cea8c59afc49cfc505fc37/bcca65f1-8780-464f-84de-babe91b32aa2ro6r0fb6.jpeg)
- [Dried seafood menu](https://attachment.momocdn.net/common/u/2e02fb5fe4f64fb55bc713540643c6f8eae702d101cea8c59afc49cfc505fc37/2afa7d27-b420-4830-afa8-93025b15aba0t1dton9n.jpeg)
- [Snack menu](https://attachment.momocdn.net/common/u/2e02fb5fe4f64fb55bc713540643c6f8eae702d101cea8c59afc49cfc505fc37/074de1b3-f239-44d2-a3c8-7e40c6388a08k7j9cyn1.jpeg)
- [Drinks menu](https://attachment.momocdn.net/common/u/2e02fb5fe4f64fb55bc713540643c6f8eae702d101cea8c59afc49cfc505fc37/e62955c4-cda8-4f02-9b22-968a0be191e3xlrbdl3y.jpeg)
- [Frontal façade and pavement dining](https://attachment.momocdn.net/common/u/2e02fb5fe4f64fb55bc713540643c6f8eae702d101cea8c59afc49cfc505fc37/ba4625f8-0fd6-4965-8270-7ddaa2334701ou89bfes.jpeg)
- [Lanterns, trees, chairs and lights](https://attachment.momocdn.net/common/u/2e02fb5fe4f64fb55bc713540643c6f8eae702d101cea8c59afc49cfc505fc37/9ae972c4-cda1-433f-bbc5-06c2c7e26216ux3u654d.jpeg)
- [Dried-seafood display](https://attachment.momocdn.net/common/u/2e02fb5fe4f64fb55bc713540643c6f8eae702d101cea8c59afc49cfc505fc37/fc4699b5-0460-49af-9dbd-a2ab32b13533hipn6j21.jpeg)

A [visitor report](https://ameblo.jp/cocoro-takashi/entry-12961580385.html) was
also located, but its image server returned HTTP 403; it was not used to infer
geometry. Generic review articles were not used to establish menu prices.

## Model and limits

`createSevenKho()` in `seven-kho.js` returns `{group, components, materials,
triangles, state, dispose}`. It has no DOM or network dependency, creates no
lights, attaches to no scene and leaves the group at the origin. Metres, Y up,
+Z toward the street. Callers explicitly attach the group. Disposal is idempotent.

**796,600 triangles, 96 meshes**, batched by component and material. Approximate
whole-study bounds: **15.60 × 7.78 × 22.74 m** (X/Y/Z), including pavement and trees;
building shell width about 4.2 m. These are modeling dimensions, not measurements.

Components:

- Narrow gray-plaster shopfront with four turquoise louvred shutter leaves.
- Timber balcony balusters, folded gray roller screen and alley-side balcony.
- Tiered reed-thatch awnings, dark-green scalloped canvas canopy and utility boxes.
- Ten outdoor drum tables, thirty chrome folding chairs, detailed serving
  dishes, blue-rimmed crockery, sauces, chopsticks, bottles, glasses and ice.
- Hanging dried squid, display trays, plants, pavement tiles and string lights.

**Frontage correction:** the user's supplied street photograph supersedes the
initial gallery interpretation. The ornate wide façade and red-lantern row
belonged to the adjacent frontage and have been removed from this model. The
building is now a single estimated 4.2 m bay, while outdoor dining remains spread
along the pavement. Furniture is not scaled down with the building.

The photo constrains the visible frontage, not exact measurements. The 4.2 m
width and 7.5 m height are visual estimates. The user supplied the 16 m length and an interior photograph; rear details
and exact furniture positions remain inferred. The small restaurant-name lettering interprets the weathered sign;
it is not an exact reproduction of the historical lettering in the supplied
photo. The photo shows closed shutters, which this version retains. No patrons
from the reference images are reproduced.

The geometry has no external photographic textures. The preview's lights and
studio ground are separate from the exported model; emissive bulb
materials are included in the GLB. Preview controls cover overview, façade,
dining, table details and seafood display, roof visibility, evening lighting and menu research.

## Rebuild and verification

```sh
node --loader ./tests/three-loader.mjs 3d/tools/export-seven-kho.mjs
node --loader ./tests/three-loader.mjs tests/seven_kho.mjs
```

The GLB exporter preserves material and component names and model metadata.
Generated assets use the repository's ignored `3d/assets/` convention; source,
preview, exporter and test are reproducible without external packages.

Checks passed for finite positions/normals, bounds, standalone origin, triangle
counts, GLB round-trip bounds/counts and exactly-once resource disposal. Chromium
loaded the inspection page without script errors; camera controls and menu
opening were exercised, and daylight/evening views captured for inspection.

## Furniture and serving-detail refinement

Revisited the [table-setting photograph](https://attachment.momocdn.net/common/u/2e02fb5fe4f64fb55bc713540643c6f8eae702d101cea8c59afc49cfc505fc37/e118a0c4-6e72-46ee-af4c-136c81fa063afmlo9yqk.jpeg)
and [crockery close-up](https://attachment.momocdn.net/common/u/2e02fb5fe4f64fb55bc713540643c6f8eae702d101cea8c59afc49cfc505fc37/a6e11201-1b7b-4f83-a841-1d5f4bed15aec6ch3nvw.jpeg),
plus the frontal dining photo linked above.

The model now has curved chrome chair frames, folding pivots, foot caps, seat
piping and slightly bowed, reclined backs. Drum table bases replace the earlier
pedestals. Rolled rims and small modeled flecks break up the tabletops.

Crockery has hollow profiles and blue rim marks. The table settings alternate
between tofu, shredded squid, vegetable platters and handled clay casseroles;
small garnishes, sauce bowls, chopsticks, napkins, bottles and ridged drinking
glasses complete them. Glasses include liquid, ice and a few foam flecks.
These are photo-informed representations, not exact recipes or portion sizes.

Choose **Table details** in the standalone preview for inspection. Geometry is
still batched by component/material; the richer close-up detail raises the
standalone model to the counts reported above. There is no LOD in this inspection
asset. The standalone asset stays in local coordinates; the city wrapper supplies placement.

## City placement

`seven-kho-site.json` records the published MoMo pin, chosen transform, estimated
outline, OSM road coordinates and sources. The listing pin is 106.6798172 E,
10.7662115 N. The model origin is 106.6797888 E, 10.7661849 N; the frontage faces
south-southeast toward Lý Thái Tổ, with the nearby mapped alley on its east side.

OSM has **no building polygon at this address**. The estimated single-bay envelope
is 4.2 m wide and 16 m deep, constrained by the user’s frontage photo, public Esri World Imagery at zoom 19,
the venue pin and mapped road alignment. Exact rear boundaries and which adjacent
premises belong to the restaurant remain uncertain. This is not a claim of a
verified cadastral footprint. No neighboring generic building geometry is cut.

Both versions use the same 16 m building shell; furniture retains its dimensions. Two
outdoor tables and six chairs on the alley side are omitted, along with the
right-hand studio tree. A narrower city pavement replaces the studio platform.
Tests confirm about 0.31 m main-road clearance and 0.39 m alley clearance for
geometry below 3 m. They check pedestrian-level geometry against both mapped carriageways and the
3.5 m assumed alley width; canopy overhang above 3 m is allowed. Street widths
are the same assumptions used by the map builder, not surveyed kerbs.

**Levels of detail** (`seven-kho-city.js`, `LOD`), like Nha Rong's:

| Camera distance | Drawn | Triangles |
|---|---|---|
| under 60 m | the detailed model | ~592k |
| 60-450 m | a proxy simplified from it | ~35k |
| beyond 450 m | a plain block | 24 |

- **Full model:** built on demand from 90 m, in a Web Worker
  (`model-worker.js`), so the page does not stall; it takes about 1 s of CPU.
  It is freed once the camera has stayed beyond 160 m for 20 s.
- **Proxy:** made offline by vertex clustering at 0.06 m cells, one mesh per
  material (`assets/seven-kho-lod1.glb`, 2.4 MB):
  `node --loader ./tests/three-loader.mjs 3d/tools/build-lod.mjs seven-kho 0.06 1`.
  Rerun it after changing the model.
- **Left out in the city:** both the full model and the proxy omit the
  studio pavement and the shutters (`SEVEN_KHO_CITY_HIDDEN`).
- **Toggle:** the Buildings checkbox also controls this landmark. The standalone inspection and GLB contain 10 outdoor drum tables with 30
folding chairs, plus six indoor wooden tables and 24 stools. City detail has
eight outdoor tables with 24 folding chairs, plus the same indoor furniture.

```sh
node --loader ./tests/three-loader.mjs tests/seven_kho_city.mjs
```

[City placement screenshot](assets/seven-kho-city.png). Chromium verified the
camera button, detailed model loading and absence of script errors.

## Interior from the user reference

The user specified **16 m building length**. Both the standalone envelope and
city footprint now use that length; the street frontage stays fixed. The 4.2 m
width remains estimated. The 22.74 m full asset depth includes the pavement and
small roof/wall thickness allowances and is not the building length.

The supplied interior photo guides a long tiled room, six rectangular plank
tables with 24 A-frame stools along one side, a clear longitudinal aisle,
pendant shades, spotlights, exposed conduit and two ceiling fans. Interior
furniture keeps its scale when the room length changes. Painted street façades
are represented by original, shallow geometric wall graphics; they are a
simplified interpretation, not exact copies of the mural or its portraits.

The standalone preview defaults to **Interior**, looking inward from just outside
the entrance at eye level. The city **7 Khô** button uses the same framing.
Choose **Interior** to return to this view. This view hides the closed front
shutters for inspection and enables four room lights. Returning to another view
restores the shutters. The exported model contains the fixtures with emissive
bulbs, but no extra dynamic lights are added to the city renderer. The city restaurant
shutters are open so the room is visible from the entrance. Existing
city integration loads this revised asset through the same wrapper; no viewer
file edit was needed for this interior update.

## Outdoor furniture scale

At the user's request, outdoor tables, folding chairs and their tableware are
now **65% of their previous size** (35% smaller in every dimension). Each setting
scales around its own table centre, retaining the pavement distribution and
keeping chairs close to their table. Table diameter is approximately 0.77 m,
tabletop height 0.45 m and chair seat height 0.32 m. Indoor wooden tables and
stools, the 16 m building and its placement are unchanged. Both standalone and
city views use this adjustment; the GLB is rebuilt from the same source.

Outdoor seating now uses a fixed staggered arrangement instead of two exact rows.
Tables have varied offsets and rotations; chairs vary in angle and distance
from the table. The arrangement is deterministic and retains the 65% scale.

The city camera allows a closer, lower viewpoint while inspecting 7 Khô;
selecting another named view restores the standard city camera limits.

## Original mural artwork

`seven-kho-murals.js` paints five original scenes across each interior wall:
a noodle vendor beneath a striped canopy, a barber at work, a bicycle beside
old shutters, a flowered balcony with a resting cat, and a coffee corner with
a reader. The opposite wall starts with a different scene. The palette combines
muted teal, warm cream, ochre, faded coral and dusty pink with small worn patches.

These are original stylized illustrations, not reproductions of the restaurant's
photographs. Flat triangulated paint shapes are batched into the model itself,
so the murals appear in both the city and standalone GLB without remote images
or texture-loading dependencies. Furniture and footprint are unchanged.
