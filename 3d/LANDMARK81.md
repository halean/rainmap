# Landmark 81

`landmark81.js` builds a schematic model of Landmark 81, Vietnam's tallest
building, by the Saigon River in Bình Thạnh. The generic city model extruded
the whole site (OSM way 622296615, tagged 461.2 m) into a slab about 100 m by
140 m, in both the tiles and the skyline layer; this replaces it with the
tower. It follows the Buildings checkbox and has no dedicated camera button.

The flag on the roof (`flag.js`) used to find its place as the highest point
of the skyline layer, which was that slab's roof. It now takes the model's
`roof` (the top of the spire), passed by `viewer.js` to `createFlag()`; the
flag's size and 110 m pole are unchanged.

## Placement and references

- **Frame:** the site's outline is extruded as a 28 m podium; the model
  origin is its centre, about 106.721754° E, 10.7948403° N.
- **Tube positions:** OSM's building parts fix where the tubes stand. Way
  622296616 (150 m) is the tower's base, 56 by 62 m; way 622296617 (300 m)
  is where the tubes above 300 m stand; way 622296618 (461.2 m), 8 by 12.5 m,
  is the spire's footprint.
- **The ten tubes:** within those, the heights step as photographs show:
  395.2, 370, 338, 300, 286, 222, 187, 167, 150 and 150 m.

- [Landmark 81, Wikipedia](https://en.wikipedia.org/wiki/Landmark_81):
  461.3 m with 81 storeys, the roof at 395.2 m and the spire 65 m above it.
  Designed by Atkins, completed 2018, and partly inspired by a bundle of
  bamboo; SkyView deck on floors 79-81 (369.65-382.65 m).
- Photographs on Wikimedia Commons:
  [Landmark 81 in 2021](https://commons.wikimedia.org/wiki/File:Landmark_81_in_2021.jpg)
  (Joefrance1995, CC BY-SA 4.0) and
  [Landmark 81 view from Saigon River](https://commons.wikimedia.org/wiki/File:Landmark_81_view_from_Saigon_River.jpg)
  (Josemite, CC BY-SA 4.0), for the steps of the tubes and the spire; and
  [Landmark 81, Ho Chi Minh City, Vietnam - February 2021](https://commons.wikimedia.org/wiki/File:Landmark_81,_Ho_Chi_Minh_City,_Vietnam_-_February_2021.jpg)
  (Thomas Galvez, CC BY 2.0).

The tubes are pale blue-green glass, with dark strips down their corners
where they meet and dark lines every four floors. The spire is an open steel
lattice of four legs and a ring every 4.5 m, narrowing from the 8 by 12.5 m
footprint to about 3 by 4 m, with a plate at 461.2 m. The number of tubes,
their plan and all heights but the roof and the top are fitted by eye to
photographs, not taken from drawings. The podium's height is a guess, and
its shops, the lighting and the mullion grid are omitted.

## Rendering and integration

Merged into five meshes (about 3,100 triangles). The generic slab is
replaced in the skyline layer at start-up and in tile `3_0` when it loads:
exactly its 73 triangles. It is listed in `LANDMARKS` in `viewer.js`.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
node --loader ./tests/three-loader.mjs tests/flag_cloth.mjs
```
