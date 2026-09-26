# Hotel Continental Saigon

`continental.js` builds a schematic, exterior-only model of the Hotel
Continental (1880) on the corner of Đồng Khởi and Lam Sơn square, across from
the Opera House. It follows the Buildings checkbox and has no dedicated
camera button.

## Placement and references

OpenStreetMap maps the hotel as a multipolygon, relation 2204742: the block
(way 165491094, about 51 by 73 m) and its courtyard (way 165491085). Both
are used as-is; the model origin is about 106.7025417° E, 10.7770036° N.
The two street fronts are the edges facing +x (towards the Opera House) and
-z; Lam Sơn square lies off the corner between them. The 11-storey building
OSM calls "Continental Saigon Hotel" (way 263502874), further east, is a
different building and is left alone.

- [Hotel Continental Saigon, Wikipedia](https://en.wikipedia.org/wiki/Hotel_Continental_Saigon):
  built 1880 by Pierre Cazeau; four floors and 86 rooms; the "Continental
  Shelf" bar and the press bureaux of the war years; Graham Greene's room
  214; reopened in 1989 after restoration; owned by Saigontourist.
- Photographs on Wikimedia Commons:
  [Hotel Continental Saigon P1310949](https://commons.wikimedia.org/wiki/File:Hotel_Continental_Saigon_P1310949.jpg)
  (FredTC, CC BY-SA 4.0), the corner with both fronts;
  [Hotel Continental Saigon 20190921](https://commons.wikimedia.org/wiki/File:Hotel_Continental_Saigon_20190921.jpg)
  (Suicasmo, CC BY-SA 4.0); and
  [Hotel Continental Saigon 2025](https://commons.wikimedia.org/wiki/File:Hotel_Continental_Saigon_2025.jpg)
  (David Stanley, CC BY 4.0).

The street fronts follow the photographs:
- **Ground floor:** shopfronts between piers, under a canopy whose fascia
  carries HOTEL CONTINENTAL SAIGON in gold.
- **Upper floors:** three floors of tall arched French windows in white
  surrounds, with balconies in every bay of the first floor and every other
  bay of the second. Pilasters run every third bay.
- **Top floor:** a continuous balcony with a white balustrade along its
  whole length, then the cornice and a parapet.

The courtyard and back walls have plain windows. Heights come from the
photographs' proportions, not measurements: a 5 m shop floor, 4 m floors and
the cornice at 17 m. The bay width (about 4 m), the balcony pattern, the
awnings, the potted trees and the lamps are approximations or omitted.

## Rendering and integration

Built with `landmark-kit.js`, merged into five meshes (about 12,500
triangles). The generic block is replaced when its tile (`2_1`) loads:
exactly its 24 triangles, the courtyard walls included. It is listed in
`LANDMARKS` in `viewer.js`.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
