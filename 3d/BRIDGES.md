# Landmark bridges

`bridges.js` models fourteen of the city's bridges, which the generic
city model drew as flat road ribbons 6 m up per OSM `layer`, with 70 m
ramps. Each deck follows its OpenStreetMap centreline (`bridge-lines.js`:
the average of the two carriageways where OSM maps them separately) and
ends at the generic ribbon's height, 6.3 m, where the generic approach
ramps take over. `replaceGeneric()` removes the generic road triangles
(`bridge`, `major`, `street` and `path` meshes) lying wholly above 1 m and
alongside the bridge -- not beyond its ends. The bridges follow the
Buildings checkbox, as one entry, `bridges`, in `LANDMARKS` in `viewer.js`.

Where each bridge crosses the water was found by sampling the model's
water surfaces along its centreline; structures are placed from there.

## The bridges

- **Ba Son (2022, OSM ways 321564421/3, 1531738346).** One arched pylon
  113 m high on the An Khánh bank, leaning towards it. Two legs rise from
  either side of the deck and meet at the top, 12 m east of their feet. A
  200 m main span runs west over the river, with 14 stays per plane on each
  side (56 in all). Triangular fins line the deck edges, and the deck rises
  to about 13.9 m over the river.
- **Phú Mỹ (2009, ways 57533850, 57533839, 760468495 and the motorbike
  lanes).** A 380 m main span centred on the 487 m of water, between two
  modified-H pylons 145 m high with crossbeams under the deck and at 112 m.
  The deck is 27 m wide, 45 m clear of the river, with 18 fanned stays per
  plane each side of each pylon. The approach viaducts stand on single
  columns every 40 m, descending at about 5% to the ramps.
- **Thủ Thiêm (2008, way 35470085 and the eastbound ways).** A humped
  girder about 14 m over the river on wall piers, lined with the swan-neck
  lamp posts the photographs show.
- **Mống (1894, way 203215339, the footway).** The green riveted steel
  "rainbow" across the Bến Nghé: two side girders whose lower chord arches
  up from the abutments, with a lattice between it and the top chord, and
  cross girders under the deck.
- **Bình Lợi railway bridge (2019, way 715033337).** Steel spans on wall
  piers every 45 m, and over the channel a steel arch 101.5 m long and 16 m
  high with network hangers and wind bracing; 7 m clear. Railways are not
  in the generic model, so it has no ribbon to replace and stands alone.

### Girder bridges

Six more are girder bridges, built by one routine, `girderBridge()`, from
their photographs. Each has a deck on piers humped over the water, a
striped red-and-white kerb (the city's standard), railings and double-arm
street lamps every 32 m. Piers on land are twin columns under a cap beam.
In the canals they stand on a pile cap at the waterline, as the Calmette
photograph shows; in the main river they are wall piers.

- **Sài Gòn (1961, ways 32581944 and 1012023452):** 986 m in 32 spans,
  24 m wide, four lanes. Its ways are on OSM layers 2 and 1, so the deck
  meets the main carriageway's ramps at 12.3 m in the east and 6.3 m in the
  west. The layer-1 motorbike way's ramp in the east is left 6 m lower.
- **Sài Gòn 2 (2013, ways 306073179/80 and 1344826626):** 987 m in 30
  spans, just downstream; 12.3 m at both ends.
- **Khánh Hội, Ông Lãnh, Calmette and Nguyễn Văn Cừ:** the Bến Nghé canal
  bridges, humped to 7.8-8.2 m over the canal; Nguyễn Văn Cừ also crosses
  the Tàu Hủ.

### Chữ Y and Tân Thuận

- **Chữ Y (1938-1941, ways 795134733/4, 32587377, 722332277, 795077194/201,
  978349749).** Three reinforced-concrete branches, 9 m wide, meeting over
  the junction of the Tàu Hủ and Đôi canals. Each branch is its own deck
  from the junction, level at 8.6 m for its first 18 m (6.3 m clear of the
  water), then down to its 6.3 m ramp. The piers in the water are the white
  art-deco towers of the photographs, with a round medallion on each face
  and octagonal openings below the deck: one under the junction, and one
  on the far side of each canal.
- **Tân Thuận 1 (1905, way 165222495).** The French steel bridge over the
  Kênh Tẻ, 8 m wide; over the water, two 50 m through trusses whose top
  chords arch up from the ends, with bracing overhead, painted pale.
- **Tân Thuận 2 (2005, ways 290409207 and 849635694).** Beside it, a 14 m
  deck hung over the water from two white arches of concrete-filled steel
  tube, each a pair of laced tubes rising 11 m.

Both Tân Thuận bridges are on OSM layer 2, so the generic model puts them,
and their ramps, at 12.3 m; the decks keep that level.

## References

- [Phú Mỹ Bridge](https://en.wikipedia.org/wiki/Phu_My_Bridge): 2,100 m,
  main span 380 m, modified-H towers 145 m, 45 m clearance, 27 m deck,
  opened 2 September 2009.
- [Ba Son Bridge](https://en.wikipedia.org/wiki/Ba_Son_Bridge) and
  [Cầu Ba Son](https://vi.wikipedia.org/wiki/C%E1%BA%A7u_Ba_Son): 885.7 m,
  main span 200 m, arch-shaped pylon 113 m on the An Khánh side leaning
  towards it, 56 stays, opened 28 April 2022.
- [Cầu Thủ Thiêm](https://vi.wikipedia.org/wiki/C%E1%BA%A7u_Th%E1%BB%A7_Thi%C3%AAm):
  1,250 m, five main spans, six lanes, opened 2008.
- [Cầu Mống](https://vi.wikipedia.org/wiki/C%E1%BA%A7u_M%E1%BB%91ng):
  1893-1894, steel, 128 m by 5.2 m, the arch that named it *Arc-en-ciel*.
- [Cầu đường sắt Bình Lợi](https://vi.wikipedia.org/wiki/C%E1%BA%A7u_%C4%91%C6%B0%E1%BB%9Dng_s%E1%BA%AFt_B%C3%ACnh_L%E1%BB%A3i):
  the 2019 bridge, 1.3 km of steel spans with an arched main span 101.5 m
  long and 16 m high, 7 m clear.
- Photographs on Wikimedia Commons:
  [Cầu Ba Son, TP.HCM, 042022](https://commons.wikimedia.org/wiki/File:C%E1%BA%A7u_Ba_Son,_TP.HCM,_042022.jpg)
  (Prenn, CC BY-SA 4.0);
  [Ba Son Bridge, Saigon (20230705 1516)](https://commons.wikimedia.org/wiki/File:Ba_Son_Bridge,_Saigon_(20230705_1516).jpg)
  (Syced, CC0);
  [Phu My Bridge 1](https://commons.wikimedia.org/wiki/File:Phu_My_Bridge_1.JPG)
  (BrightRaven, CC BY 3.0);
  [Thủ Thiêm Bridge](https://commons.wikimedia.org/wiki/File:Th%E1%BB%A7_Thi%C3%AAm_Bridge.JPG)
  (Ngô Trung, CC BY-SA 3.0);
  [Puente Mong … 2013-08-14, DD 01](https://commons.wikimedia.org/wiki/File:Puente_Mong,_Ciudad_Ho_Chi_Minh,_Vietnam,_2013-08-14,_DD_01.JPG)
  (Diego Delso, CC BY-SA 3.0); and
  [Toàn cảnh cầu đường sắt Bình Lợi](https://commons.wikimedia.org/wiki/File:To%C3%A0n_c%E1%BA%A3nh_c%E1%BA%A7u_%C4%91%C6%B0%E1%BB%9Dng_s%E1%BA%AFt_B%C3%ACnh_L%E1%BB%A3i.jpg)
  (Tokeisan, public domain; the old bridge, for the setting).
- [Cầu Sài Gòn](https://vi.wikipedia.org/wiki/C%E1%BA%A7u_S%C3%A0i_G%C3%B2n):
  the 1961 bridge, 986.12 m, 24 m, four lanes, 32 spans; Sài Gòn 2 (2013),
  over 987 m in 30 spans, 3 m downstream.
- More photographs on Wikimedia Commons:
  [Cầu Sài Gòn, Vietnam](https://commons.wikimedia.org/wiki/File:C%E1%BA%A7u_S%C3%A0i_G%C3%B2n,_Vietnam.jpg)
  (Vodka Hanoi, CC BY 2.0);
  [Saigon Bridge, Sep 2006](https://commons.wikimedia.org/wiki/File:Saigon_Bridge,_Sep_2006.jpg)
  (Haydn Blackey, CC BY-SA 2.0);
  [Khanh Hoi Bridge](https://commons.wikimedia.org/wiki/File:Khanh_Hoi_Bridge.JPG)
  (Eternal Dragon, CC BY 3.0);
  [Cau Ong Lanh, Saigon (28346991971)](https://commons.wikimedia.org/wiki/File:Cau_Ong_Lanh,_Saigon_(28346991971).jpg)
  (sbphsho, public domain);
  [Calmette Bridge 7](https://commons.wikimedia.org/wiki/File:Calmette_Bridge_7.jpg)
  (Syced, CC0); and
  [Cầu Nguyễn Văn Cừ, Bến Vân Đồn](https://commons.wikimedia.org/wiki/File:C%E1%BA%A7u_Nguy%E1%BB%85n_V%C4%83n_C%E1%BB%AB,B%E1%BA%BFn_v%C4%83n_%C4%91%E1%BB%93n_,_qu%E1%BA%ADn_4,_hcmvn_-_panoramio.jpg)
  (trungydang, CC BY 3.0).
- [Cầu chữ Y](https://vi.wikipedia.org/wiki/C%E1%BA%A7u_ch%E1%BB%AF_Y): built
  1938-1941, three branches (175, 178.3 and 137 m), 9 m wide, 6.3 m clear,
  rebuilt in part in 2006. [Cầu Tân Thuận](https://vi.wikipedia.org/wiki/C%E1%BA%A7u_T%C3%A2n_Thu%E1%BA%ADn):
  Tân Thuận 1, 1905, steel, 241 m by 8 m; Tân Thuận 2, 2005, concrete-filled
  steel tube arches, three lanes.
- Photographs on Wikimedia Commons:
  [Trụ cẩu chữ Y](https://commons.wikimedia.org/wiki/File:Tr%E1%BB%A5_c%E1%BA%A9u_ch%E1%BB%AF_Y.JPG)
  and [Nhánh cầu quận 5](https://commons.wikimedia.org/wiki/File:Nh%C3%A1nh_c%E1%BA%A7u_qu%E1%BA%ADn_5.JPG)
  (Ngô Trung, CC BY-SA 3.0);
  [Cầu Chử y, Đi qua quận 8](https://commons.wikimedia.org/wiki/File:C%E1%BA%A7u_Ch%E1%BB%AD_y-%C4%90i_qua_qu%E1%BA%ADn_8,_hcm_-_panoramio.jpg)
  (trungydang, CC BY 3.0);
  [Tan Thuan 1 Bridge](https://commons.wikimedia.org/wiki/File:Tan_Thuan_1_Bridge.jpg)
  and [Tan Thuan 2 Bridge](https://commons.wikimedia.org/wiki/File:Tan_Thuan_2_Bridge.jpg)
  (Unpear, CC BY-SA 4.0); and
  [Cau Tan thuan nhin tu Song Saigon](https://commons.wikimedia.org/wiki/File:Cau_Tan_thuan_nhin_tu_Song_Saigon_,_vn_-_panoramio.jpg)
  (trungydang, CC BY 3.0).

## What is approximate

- **Pylons and stays:** positions come from the published spans and where
  the water is, not from drawings. Stay counts per plane, anchorages and
  the fans' spread are fitted to the photographs.
- **Profiles:** the Ba Son and Thủ Thiêm humps and Phú Mỹ's approach
  grades are smooth curves fitted to the published clearances; the ends are
  held at the generic ramps' 6.3 m, not measured levels.
- **Thủ Thiêm:** its span arrangement and pier positions are placed
  evenly; the published data do not give them.
- **Mống:** it is modelled on its 93 m OSM footway, not the published
  128 m. Its lattice is schematic.
- **Girder bridges:** span lengths are the published totals divided
  evenly, with longer spans over the water; the canal bridges' spans and
  crests are from the photographs. Their decks are single slabs where OSM
  has separate carriageways a few metres apart.
- **Tân Thuận:** which of the two pairs of arches in the river photograph
  belongs to which bridge is read from the sources' descriptions (steel
  bridge of 1905; steel-tube arches of 2005); the truss and arch geometry
  is fitted by eye. The real Tân Thuận 1 sits lower than the 12.3 m the
  generic model gives both.
- **Omitted:** lighting at night, traffic, and the metro viaduct beside
  Ba Son, which `metro.js` draws.

The rest of the city's ~200 bridges remain generic ribbons without piers.
The fourteen add about 136,000 triangles in a dozen draw calls.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/bridges.mjs
```
