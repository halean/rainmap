# Ho Chi Minh City Hall

`city-hall.js` builds a schematic, exterior-only model of City Hall (the
former Hôtel de Ville, now the seat of the People's Committee) at the head of
Nguyễn Huệ. It follows the Buildings checkbox and has no dedicated camera
button (`view` looks at the front from down Nguyễn Huệ).

## Placement and references

The footprint is the OpenStreetMap outline, way 341504305 (48 corners,
`building:levels=3`, no height), extruded as-is; the model origin is about
106.7009599° E, 10.7765951° N. In the local frame z runs along the front and
+x faces south-east down Nguyễn Huệ; the central projection is z -8.2 to 19.
The outline runs about 200 m along the front.

- [Ho Chi Minh City Hall, Wikipedia](https://en.wikipedia.org/wiki/Ho_Chi_Minh_City_Hall):
  designed under Fernand Gardès, built 1898-1908 after the Hôtel de Ville in
  Paris, with a tower flanked by two attic towers and long lower blocks at
  the sides; Corinthian columns, iron doors and three figures of Marianne on
  the front.
- Photographs on Wikimedia Commons:
  [Ayuntamiento … 2013-08-14, DD 01](https://commons.wikimedia.org/wiki/File:Ayuntamiento,_Ciudad_Ho_Chi_Minh,_Vietnam,_2013-08-14,_DD_01.JPG)
  (Diego Delso, CC BY-SA 3.0), the centre straight on, used for the
  proportions; [Ho Chi Minh City, City Hall, 2020-01 CN-01](https://commons.wikimedia.org/wiki/File:Ho_Chi_Minh_City,_City_Hall,_2020-01_CN-01.jpg)
  (Steffen Schmitz, CC BY-SA 4.0), the whole front; and
  [Ho Chi Minh City Hall, 2023 (01)](https://commons.wikimedia.org/wiki/File:Ho_Chi_Minh_City_Hall,_2023_(01).jpg)
  (Bahnfrend, CC BY-SA 4.0).

The model follows the photographs:
- **The centre:** five arched doors with green iron grilles, steps up to
  them, five open arches of the first-floor loggia over balustrades, and
  paired white columns. A pediment with a sculpture group sits in front of
  the clock tower. The tower has clocks on four faces, a balcony, an arcaded
  belvedere, a lantern and a cupola, and the flag.
- **The side pavilions (the attic towers):** raised to 14 m, each has an
  arched door, a great arched loggia with columns, a relief in its pediment,
  and a steep orange-tiled hipped roof with white cresting.
- **The end pavilions:** lower orange-tiled hipped roofs.
- **The wings:** cream walls, two storeys of green-shuttered windows (arched
  below), white pilasters, a cornice and a balustrade.

Heights are scaled from the straight-on photograph by the central
projection's 27 m width in OSM, not measured: the first floor at 5.2 m, the
cornice at 10.3 m, the pavilions to 14 m under roofs to about 16.6 m, the
tower to 24.4 m, and the flag to about 30 m. The photographs cover the
historic middle; the wings beyond the end pavilions, to the outline's ends,
repeat the wings' windows, and the sides and back are plain. The Marianne
figures and sculpture are simple shapes, and the ironwork, lamps, gardens and
the Ho Chi Minh statue in the square are omitted.

## Rendering and integration

Built with `landmark-kit.js`, merged into seven meshes (about 11,200
triangles). The generic building is replaced when its tile (`2_1`) loads:
exactly its 142 triangles. Neighbours built against the back are 10.6 m tall
and share wall lines with the 9.7 m generic block, so only triangles below
10.2 m are cleared. It is listed in `LANDMARKS` in `viewer.js`.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
