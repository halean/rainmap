# More of the city's towers

`citytowers.js` models 50 more towers across the city in detail, the same
way as the riverfront's (`RIVERFRONT.md`). Each comes from its
OpenStreetMap footprint, height and levels (`citytowers-lines.js`, fetched
from Overpass on 2026-09-26) and is built by `tower-kit.js`, every floor and
every bay.

## The towers

| Where | Towers |
|---|---|
| District 1 | Saigon Centre: office tower (193 m) and residence tower (170 m); Lim Tower (blue glass, 34 floors) |
| Vinhomes Golden River, Ba Son | Aqua 1-4, Lux 6, The Lake (126-176 m) |
| Vinhomes Central Park and nearby | Central 3; Saigon Pearl's older block; Riverside 90 |
| Thủ Thiêm | four 100 m towers across from District 1 (OSM gives no names) |
| District 4 | Masteri Millennium |
| Thảo Điền | Masteri Thảo Điền T1, T2, T3, T5; Gateway Thảo Điền Aspen, Rio, Sol, Madison; Towers 1-4 |
| District 10 | Hà Đô Centrosa: Iris 1-4, Jasmine 1-2, Orchid 1-2 |
| Bình Thạnh | City Garden: Promenade 2, Boulevard 1 |
| District 7, off Nguyễn Hữu Thọ | W1-W4, X1, X2, Blocks A, B, C, and two more |

Colours and styles come from photographs of each development:
- **Glass offices** (Saigon Centre, Lim Tower, the Thủ Thiêm towers): curtain
  walls with mullions, spandrels, ledges and transoms.
- **Residential towers:** walls with recessed windows and balconies, and
  staggered balconies at Golden River, Masteri and parts of District 7.

Each tower has a podium where it stands on one, and a crown: fins,
lift-core frames, a penthouse or a lit frame.

Names in District 7 and Thảo Điền are as OSM gives them; where OSM has
none, the tower is named by its place.

## Triangles

- **Larger towers:** about 100k each. The bay width is chosen from an
  estimate, and a tower that comes out well off the target is rebuilt once
  with its bays scaled to match (`calibrate`, in `riverfront.js`).
- **Slim towers** (~30 storeys on small footprints): 46-66k. They are
  already at the narrowest bays (1.5 m residential, 1 m curtain wall), and
  narrower would no longer look like windows.
- **All 50:** 78k on average, 3.9M in all. Only those within 1.6 km of the
  camera are built.

## Levels of detail

Shared with the riverfront (`createTowerSet` in `riverfront.js`):
- **From afar:** each tower is a plain block in its main colour.
- **Close up:** the detailed model is built within 1.6 km, nearest first
  and one a frame.
- **Released:** it is freed after 30 s beyond 2.4 km.
- **In the river:** the block also stands in for the tower's reflection
  (`riverwater.js`).

Each tower replaces the generic block in its tile, as the riverfront's do.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/citytowers.mjs
```

The checks cover:
- no tower duplicates a riverfront one;
- each detailed model is finite, 40k-125k triangles, and reaches the tagged
  height;
- all are released far away;
- the generic blocks are replaced in the tiles that hold the towers.

In Chromium they were viewed at Saigon Centre, Golden River, Masteri Thảo
Điền (close up), Hà Đô Centrosa, District 7 and City Garden.
