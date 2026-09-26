# Bình Tây Market

`binh-tay.js` builds a schematic, exterior-only model of Bình Tây Market
(Chợ Bình Tây, the Marché Central de Cholon) in Chợ Lớn. It follows the
Buildings checkbox and has no dedicated camera button.

## Placement and references

OpenStreetMap maps the market as a multipolygon, relation 2552505: the ring
of halls (way 189027804, about 119 by 106 m) round a courtyard (way
675640291). Both are used as-is. The model origin is about 106.6510177° E,
10.7492646° N; the gate is on the axis x 8.3, facing -z (north) towards
Tháp Mười.

- [Bình Tây Market, Wikipedia](https://en.wikipedia.org/wiki/B%C3%ACnh_T%C3%A2y_Market):
  begun in 1928 and opened in 1930, financed by Quách Đàm, in a Chinese
  style; renovated in 1992 and 2016-2018. It gives 89.2 by 108.6 m, against
  OSM's outline of about 119 by 106 m, which is kept.
- Photographs on Wikimedia Commons:
  [Chợ Bình Tây](https://commons.wikimedia.org/wiki/File:Ch%E1%BB%A3_B%C3%ACnh_T%C3%A2y.jpg)
  (Bùi Thụy Đào Nguyên, CC BY 3.0), the gate close up;
  [Binh Tay Market 2011](https://commons.wikimedia.org/wiki/File:Binh_Tay_Market_2011.jpg)
  (Ken Marshall, CC BY 2.0), the gate and clock tower; and
  [Binh Tay Market Saigon](https://commons.wikimedia.org/wiki/File:Binh_Tay_Market_Saigon.jpg)
  (Adam, CC BY-SA 2.0), a side with its tower.

The model follows the photographs:
- **The ring of halls:** yellow walls with a pent roof of terracotta tiles
  over the stalls' openings. Above it are lattice vents, then the halls'
  tiled roofs sloping up from both the street and the courtyard.
- **The gatehouse:** the entrance under a canopy on brackets, and the
  signboard. The gable over it carries its blue ceramic tympanum.
- **The clock tower:** lattice windows and a clock on each face, a wide tiled
  roof with dragons, a small top stage with its own roof, and the flag.
- **The other three sides:** a pagoda-roofed tower in the middle of each.
- **The courtyard:** a shrine pavilion.

Heights come from the photographs' proportions, not measurements: the pent
roof at 4.6 m, the walls at 8.5 m, the gatehouse at 12.5 m, the clock stage
to 19.5 m, and the top to about 26 m. The roofs are flat planes, not the
real ridges and hips, and the side towers' positions are the sides'
middles. Signage, awnings and stalls are omitted.

## Rendering and integration

Built with `landmark-kit.js`, merged into eight meshes (about 2,500
triangles). The generic block is replaced when its tile (`0_3`) loads:
exactly its 51 triangles, the courtyard walls included. It is listed in
`LANDMARKS` in `viewer.js`.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
