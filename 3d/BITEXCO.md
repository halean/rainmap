# Bitexco Financial Tower

`bitexco.js` builds a schematic model of the Bitexco Financial Tower on Hải
Triều. The generic city model and its skyline layer have only the podium
(10.6 m), so the city's second-best-known tower was missing; this adds it. It
follows the Buildings checkbox and has no dedicated camera button (`view`
frames the whole tower).

## Placement and references

OpenStreetMap maps the tower in detail as building parts, used as-is for the
plan and heights:
- **Way 804073951:** the whole site's outline (36 corners), which the generic
  podium was built from and which `replaceGeneric()` clears.
- **Way 1222241874, the petal:** 262.5 m, with a skillion roof sloping 71.5 m
  down towards 127.5° (south-east).
- **Way 1222241872, the tip:** 269 m, sloping 6.5 m.
- **Way 1222241871, the lower section:** 191 m, with the helipad (way
  1231606415) on its roof.
- **Way 1222241873, the podium:** 22.5 m.

The model origin is the site's centre, about 106.7044358° E, 10.7718557° N;
+x faces north-east and +z south-east, towards the river.

- [Bitexco Financial Tower, Wikipedia](https://en.wikipedia.org/wiki/Bitexco_Financial_Tower):
  262.5 m and 68 floors, designed by Carlos Zapata after the lotus, opened
  31 October 2010. The Saigon Skydeck is on floor 49 at about 178 m, and the
  helipad cantilevers 22 m from the 52nd floor.
- Photographs on Wikimedia Commons:
  [Bitexco Financial Tower … 2013-08-14, DD 01](https://commons.wikimedia.org/wiki/File:Bitexco_Financial_Tower,_Ciudad_Ho_Chi_Minh,_Vietnam,_2013-08-14,_DD_01.JPG)
  (Diego Delso, CC BY-SA 3.0), the whole tower's profile;
  [DJI 0550-HDR-Pano Bitexco Financial Tower](https://commons.wikimedia.org/wiki/File:DJI_0550-HDR-Pano_Bitexco_Financial_Tower.jpg)
  (Lê Minh Phát, CC BY-SA 4.0), the petal and the helipad from above; and
  [Bitexco Financial Tower Helipad](https://commons.wikimedia.org/wiki/File:Bitexco_Financial_Tower_Helipad.jpg)
  (Mkoff, CC BY-SA 4.0).

The model follows the photographs. Each part is lofted: stacked at every
3.9 m floor and scaled about the tower's plan centre. It is about 5% fuller a
quarter of the way up, then narrows to about two-thirds of the base at the
top. Silver bands mark the floors. The petal's roof slopes as OSM gives it;
the lower section ends flat at 191 m under an elliptical deck 22 by 27 m that
reaches 22 m past the section's south-east end, with the flag near the
tower. The taper curve, the deck's shape, and the colours are approximations
fitted by eye to the photographs; the dark band of plant floors, the
Skydeck's glazing, the podium's shopfronts and the lettering are omitted.
OSM's 269 m for the tip is kept, 6.5 m above the published 262.5 m.

## Rendering and integration

The lofting is `loft()` and `bands()` in `landmark-kit.js`, merged into five
meshes (about 12,400 triangles). The generic podium is replaced when its
tile (`2_2`) loads: exactly its 106 triangles, and only below 11 m. The tower
is not in `skyline.glb`, so it does not appear in the clustered high-rise
list the viewer uses for double-click navigation. It is listed in
`LANDMARKS` in `viewer.js`.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
