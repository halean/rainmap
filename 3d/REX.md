# Rex Hotel

`rex.js` builds a schematic, exterior-only model of the Rex on the corner of
Lê Lợi and Nguyễn Huệ, with its corner tower, the golden crown on it, and the
Rooftop Garden. It follows the Buildings checkbox
and has no dedicated camera button (`view` looks at the corner).

## Placement and references

The footprint is the hotel's OpenStreetMap outline, way 39598474 ("Khách sạn
Rex Sài Gòn", 23 corners, about 8,200 m²), extruded as-is; the model origin is
about 106.7010558° E, 10.7754976° N. Edges 15–17 face Nguyễn Huệ, 18–21 are the
corner and 22 faces Lê Lợi.

- [Rex Hotel, Wikipedia](https://en.wikipedia.org/wiki/Rex_Hotel) and
  [Rex history](https://www.rexhotelsaigon.com/rex-history/): built 1927 as the
  Bainier auto hall; a six-storey, 286-room hotel on the corner; the rooftop
  bar of the "Five O'Clock Follies"; the Rex Arcade at street level.
- [AFAR on the Rex](https://www.afar.com/places/rex-hotel-ho-chi-minh-city) and
  [Rooftop Garden Bar](https://www.rexhotelsaigon.com/dining/rooftop-garden-bar/):
  the giant crown on the corner of the terrace, which rotates at night, and
  the red neon REX sign.

- Photographs on Wikimedia Commons, used for the elevations:
  [Rex Hotel P1310939](https://commons.wikimedia.org/wiki/File:Rex_Hotel_P1310939.jpg)
  (FredTC, CC BY-SA 4.0), the corner by day, used for the proportions;
  [Rex Hotel, a legend on Saigon's Nguyen Hue walking street](https://commons.wikimedia.org/wiki/File:Rex_Hotel,_a_legend_on_Saigon%27s_Nguyen_Hue_walking_street_(31759347710).jpg)
  (shankar s., CC BY 2.0) and
  [Rex Hotel and Nguyễn Huệ roundabout … 01](https://commons.wikimedia.org/wiki/File:Rex_Hotel_and_Nguy%E1%BB%85n_Hu%E1%BB%87_roundabout,_Ho_Chi_Minh_City,_Vietnam_-_20121013-01.jpg)
  (Smuconlaw, CC BY-SA 3.0), by night.

The model follows the photographs:
- **The corner tower:** a flat tower faces the intersection. It has a
  shopfront at street level and a column of four windows over a balustrade on
  each floor. Round porthole ornaments run up its side piers, and REX HOTEL
  crosses its top, which rises a storey above the roof.
- **The crown:** a gold crown with a dome and jewels stands on the tower, with
  the flag behind it.
- **The fronts:** shopfronts sit under a canopy. Above them, giant white piers
  frame bays, and each bay has a window group over a white balustraded
  balcony on each of four floors.
- **The Rooftop Garden:** planters and lamps line the roof edge. Its sign
  stands behind the crown over the Nguyễn Huệ side: REX HOTEL in lights over
  two lit bars standing in for the smaller lines ("Rooftop Garden Bar",
  "five o'clock follies").

Heights are scaled from the daytime photograph, not measured: a 5.5 m shop
floor, four 4.2 m floors to the roof at 22.3 m, the tower to 25.5 m, the crown
to 30.7 m and the flag to 32.5 m. The OSM corner is only a small chamfer, so
the 8 m tower stands up to about a metre proud of the street lines at its
ends. The whole outline is modelled at one height, though photographs show
taller later blocks behind the Nguyễn Huệ front. The crown is static; the
terrace's elephant statues, the pergola frames and string lights, and shop
signs are omitted.

## Rendering and integration

Built with `landmark-kit.js` (shared with `majestic.js`), merged into ten
meshes (13,060 triangles). The lettering is built from bars, so no font is
loaded. The generic OSM building is replaced when its tile (`2_1`) loads:
exactly the generic Rex (67 triangles: its 23-corner outline extruded), with
the neighbours untouched.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
