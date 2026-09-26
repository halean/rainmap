# Saigon Central Post Office

`post-office.js` builds a schematic, exterior-only model of the Central Post
Office (Bưu điện Trung tâm Sài Gòn) on Công xã Paris, beside Notre-Dame. It
follows the Buildings checkbox and has no dedicated camera button (`view`
looks at the front from the square).

## Placement and references

The footprint is the OpenStreetMap outline, way 39514793 (22 corners, tagged
`height=13.5`), extruded as-is; the model origin is about 106.7000434° E,
10.7799977° N. The front block runs the full 70 m width along +z, facing the
square to the south-west, and the great hall runs back from its middle. OSM
maps the entrance porch as a separate small building in front of the doors
(10 triangles in the generic model); the model's canopy stands in for it, so
`POST_OFFICE.replaces` clears it along with the outline.

- [Saigon Central Post Office, Wikipedia](https://en.wikipedia.org/wiki/Saigon_Central_Post_Office):
  designed by Alfred Foulhoux (often wrongly credited to Gustave Eiffel) and
  built 1886-1891; plaques to pioneers of communication on the facade; the
  clock; the painted maps in the hall.
- Photographs on Wikimedia Commons:
  [Ho Chi Minh City, Central Post Office, 2020-01 CN-01](https://commons.wikimedia.org/wiki/File:Ho_Chi_Minh_City,_Central_Post_Office,_2020-01_CN-01.jpg)
  (Steffen Schmitz, CC BY-SA 4.0), straight on, used for the proportions and
  the present yellow; and
  [Oficina Central de Correos … 2013-08-14, DD 01](https://commons.wikimedia.org/wiki/File:Oficina_Central_de_Correos,_Ciudad_Ho_Chi_Minh,_Vietnam,_2013-08-14,_DD_01.JPG)
  (Diego Delso, CC BY-SA 3.0), the same front when it was pink.

The front follows the photographs:
- **Wings:** two storeys of arched windows with green shutters in white
  surrounds, with a balustrade under each upper window. Yellow pilasters with
  white capitals divide them, and green bands run with the string course and
  the frieze. There is a brown plinth and a cornice with a low parapet.
- **Pavilion:** the great arch has a glazed green grille and the clock, over
  a canopy and three doors, and a mask ornament above it. Windows sit either
  side between white pilasters, and steps lead up to the doors.
- **Attic storey:** eight windows between paired columns, a deep cornice, a
  crest of finials with scrolls at the corners, and the red-and-white lattice
  mast with the flag.

Heights are scaled from the straight-on photograph by the pavilion's 17 m
width in OSM, not measured: the cornice at 12.4 m (OSM gives 13.5 m), the
attic storey to 17.4 m, and the mast to about 30 m. The sides and back repeat
the wings' windows without their surrounds, and the great hall's roof is a
plain pitched roof; neither is from photographs. The plaques, the reliefs,
the lettering over the arch and the lamps are omitted.

## Rendering and integration

Built with `landmark-kit.js`, merged into eight meshes (about 11,800
triangles). The generic building is replaced when its tile (`2_1`) loads:
exactly its 64 triangles and the porch's 10, with the neighbours untouched.
It is listed in `LANDMARKS` in `viewer.js`.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
