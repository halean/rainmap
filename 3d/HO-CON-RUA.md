# Hồ Con Rùa — Turtle Lake

`ho-con-rua.js` adds the modernist tower and its pool setting at Công trường Quốc
Tế, the roundabout at Phạm Ngọc Thạch, Võ Văn Tần and Trần Cao Vân. Use **Hồ Con
Rùa** in the viewer's camera buttons. Visibility follows **Buildings**.

The centre, **106.6959464° E, 10.7826372° N**, is the mean of the eight water-polygon
vertices in the project's OSM-derived `assets/tiles/2_1.glb`. The actual octagonal
outline is retained, approximately 53.7 m across. Surrounding roads and buildings
are untouched.

## Geometry

The model has five open concrete piers, five fans of five flaring crown ribs,
raised rib edges, an open pentagonal finial, casting joints and weathering details.
Its top is 34 m above the project's flat ground. The setting includes the basin,
stone seating rim, paving joints, mapped curved footbridges, raised viewing
platform, stairs, handrails, planters and schematic trees.

There are **77,400 triangles** including the mapped paths, batched by material.
No new lights, animation loops, external textures or per-frame work are added.
The viewer uses its existing lighting. Preview images:
[model](assets/ho-con-rua-preview.png), [city placement](assets/ho-con-rua-city.png).

`ho-con-rua-paths.json` stores local-space geometry recovered from the existing
OSM bridge meshes. Original bridge heights of 6.08–6.3 m and 12.08–12.3 m were generic
map assumptions, not surveyed elevations. The model remaps these to approximately
0.31–0.53 m for the footbridges and a sloped approach rising to the 3.3 m oval platform. Those
heights, the stair layout, column dimensions, crown proportions, planting and
surface colours are visual interpretations, not a survey or exact representation
of a particular renovation date. The lost turtle statue is not recreated.

The scoped replacement removes only `bridge` and `path` triangles and overview
line segments fully within
31.8 m of the lake centre and below 13 m. Against the current detailed tile, it
removes **652 triangles**, including the incorrectly elevated generic footbridges.
Water, green areas, road meshes and buildings are preserved. Replacement is
idempotent and also applies when a detailed tile is reloaded.

## References

- [Wikimedia Commons photograph](https://commons.wikimedia.org/wiki/File:Cong_truong_con_rua.jpg):
  existing supports, flared crown, central finial and elevated access platform.
- [Thanh Niên architectural drawings and description](https://thanhnien.vn/goc-ky-hoa-ho-con-rua-18524060120222476.htm):
  five supports, 34 m published height and five groups of five ribs.
- [Aerial photograph](https://cdn.xanhsm.com/2024/12/493bd9d7-ho-con-rua-2.jpg):
  crown, octagonal basin and curved footbridge arrangement.
- Map geometry: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
  ODbL 1.0, from the existing `vietnam-260918.osm.pbf` build recorded in
  `assets/manifest.json`.

Reference imagery is not bundled or used as a texture. The generated preview
images show the model itself.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/ho_con_rua.mjs
```

Checks verify finite positions/normals, height, placement, mapped-path loading,
actual-tile replacement, preservation of roads/buildings/water/green areas,
idempotence and disposal. The returned `ready` promise completes path loading;
`state.pathsError` reports failures. `dispose()` also prevents a pending path load
from attaching geometry after disposal.
