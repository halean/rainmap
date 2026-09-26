# Railway

`railway.js` draws the North-South railway (Đường sắt Bắc-Nam) through the
model's extent, with its sidings and yards. The generic city model has no
railways: the tile builder (`tools/build.py`) takes only highways,
buildings, water and green areas from OpenStreetMap. Metro Line 1 is drawn
separately by `metro.js`, and the Bình Lợi railway bridge by `bridges.js`.

## Data

`railway-lines.js` holds every `railway=rail` way in the model's extent from
OpenStreetMap (148 ways): the main line, 37.3 km from Sài Gòn station (Hòa
Hưng) north through Gò Vấp and over the Saigon at Bình Lợi to Dĩ An, and
30.3 km of sidings, yards and spurs, chiefly at Sài Gòn station and Sóng
Thần. Only the Bình Lợi and Ghềnh bridges (ways 715033337 and 138540676)
are left out, since `bridges.js` models them. Ways are simplified to within 0.6 m and marked
`main` (OSM `usage=main`) or `siding` (sidings, yards and spurs), and
`bridge` where OSM tags `bridge=yes` (450 m in eight ways, over canals).
Metro lines under construction and proposed railways are not included.

## Model

- **Track:** metre gauge (OSM `gauge=1000`), as two steel rails 0.6 m up on
  a ballast bed whose top is 0.45 m up, just above the generic roads
  (0.3 m) so level crossings show the track. The bed is 3 m wide on top for
  the main line and 2.6 m for sidings, sloping out to the ground.
- **Bridges:** where OSM marks a bridge, the bed sits on a concrete deck
  on piers. The terrain is flat, so these are as low as the track; the
  canals' real clearances are not modelled.
- **Bình Lợi and Ghềnh:** the bridges' ends are at rail level, 0.45 m, and
  the track ends there.
- **Size:** about 14,500 triangles in three draw calls (ballast, rails,
  concrete). The track is always shown; the Buildings checkbox does not
  hide it.

## What is approximate or missing

Sleepers, points and crossings are not drawn: the rails are continuous bars
and a junction is two tracks overlapping. There are no embankments or
cuttings, and the level crossings are just the track on the road. Sài Gòn
station's buildings and platforms, the signal boxes and the trains
themselves (the Thống Nhất services) are not modelled.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/railway.mjs
```
