# Tân Định Church

`tan-dinh.js` builds a schematic, exterior-only model of Tân Định Church (the
Church of the Sacred Heart of Jesus), the pink church on Hai Bà Trưng. It
follows the Buildings checkbox and has no dedicated camera button.

## Placement and references

The footprint is the OpenStreetMap outline, way 60118189 (21 corners),
extruded as-is. The model origin is about 106.6906444° E, 10.7883301° N;
the nave runs along z, with the front at z -25.8 (north-east, on Hai Bà
Trưng) and the rounded apse at +z.

- [Tân Định Church, Wikipedia](https://en.wikipedia.org/wiki/Tan_Dinh_Church):
  completed on 16 December 1876 and founded by Donatien Éveillard; mainly
  neo-Romanesque with neo-Gothic and neo-Renaissance elements; 52.6 m at its
  highest; painted pink inside and out since 1957.
- Photographs on Wikimedia Commons:
  [Tân Định Church 20190922](https://commons.wikimedia.org/wiki/File:T%C3%A2n_%C4%90%E1%BB%8Bnh_Church_20190922.jpg)
  (Suicasmo, CC BY-SA 4.0) and
  [Goc chup thang Nha tho Tan Dinh](https://commons.wikimedia.org/wiki/File:Goc_chup_thang_Nha_tho_Tan_Dinh.jpg)
  (Prof MK, CC BY-SA 4.0), the front and tower.

The model follows the photographs:
- **The tower:** a square tower projecting from the middle of the front. It
  has an arched portal, the clock above it, and two stages of paired louvred
  openings on every face between white string courses. Four corner
  pinnacles, a gablet on each face and an octagonal grey spire with its
  cross rise to 52.6 m.
- **The front:** a side bay either side of the tower with lancets and a
  scroll, stair turrets beside the tower, and pinnacles at the corners.
- **The sides:** two tiers of lancets filled with white tracery between
  pinnacled buttresses, under a clerestory and a grey roof.
- **The apse:** a half-dome over the rounded end.

Everything is pink picked out in white. Heights come from the photographs'
proportions scaled to the published 52.6 m, not measurements: the aisle
walls at 11 m, the nave's ridge at 20.5 m, and the tower's top at 36 m under
the spire. The tracery, the scrolls' form and the fence are approximations
or omitted.

## Rendering and integration

Built with `landmark-kit.js`, merged into seven meshes (about 7,300
triangles). The generic block is replaced when its tile (`2_1`) loads:
exactly its 61 triangles. It is listed in `LANDMARKS` in `viewer.js`.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
