# Thiên Hậu Temple (Hội quán Tuệ Thành)

`thien-hau.js` builds a schematic, exterior-only model of the Thiên Hậu
Temple, the Cantonese Tuệ Thành assembly hall dedicated to the sea goddess
Mazu, at 710 Nguyễn Trãi in Chợ Lớn. It follows the Buildings checkbox and
has no dedicated camera button.

## Placement and references

OpenStreetMap maps the compound as way 1497050780 (`amenity=place_of_worship`,
not a building), about 26 by 91 m; the generic city model's building inside
it covers the halls from z 26.5 back and has two light wells. The model
uses the halls and the light wells from the generic model, with the porch
recessed across the middle of the front; `replaceGeneric()` clears the whole
compound. The model origin is about 106.6611632° E, 10.7534587° N, and the
forecourt and front face +z (south, on Nguyễn Trãi).

- [Thien Hau Temple (Ho Chi Minh City), Wikipedia](https://en.wikipedia.org/wiki/Thien_Hau_Temple_(Ho_Chi_Minh_City)):
  the Tuệ Thành guildhall of the Cantonese community, dedicated to Mazu,
  opened about 1760.
- Photographs on Wikimedia Commons:
  [20190923 Thien Hau Temple front](https://commons.wikimedia.org/wiki/File:20190923_Thien_Hau_Temple_front.jpg)
  and [20190923 Thien Hau Temple temple roof-1](https://commons.wikimedia.org/wiki/File:20190923_Thien_Hau_Temple_temple_roof-1.jpg)
  (Balon Greyjoy, CC0); and
  [Hội quán Tuệ Thành](https://commons.wikimedia.org/wiki/File:H%E1%BB%99i_qu%C3%A1n_Tu%E1%BB%87_Th%C3%A0nh.jpg)
  (Christopher from Shanghai, CC BY 2.0).

The front follows the photographs:
- **The porch:** grey brick walls, and a porch across the middle three bays
  with stone pillars and a beam. It has green iron screens, a red arched
  gate, the doorway behind, and red lanterns.
- **The side bays:** friezes of glazed ceramic.
- **The roofs:** grey tiles with green-glazed ridges and eaves, and black
  curled "wok-handle" gable ends.
- **The crest:** on the front and main halls' ridges, an ochre frieze and a
  band of blue-glazed ceramic under rows of small figures and little
  pavilions, with a pearl on top.
- **The forecourt:** incense burners.

Heights come from the photographs' proportions, not measurements: the walls
at 5.6 m, the ridges at 9-9.8 m, and the crest to about 14.6 m. The crest's
hundreds of figures are drawn as a few dozen simple shapes. The murals, the
carvings, the burners' form and the hanging incense coils inside are
omitted.

## Rendering and integration

Built with `landmark-kit.js`, merged into ten meshes (about 6,300
triangles). The generic halls are replaced when their tile (`0_3`) loads:
exactly their 118 triangles. It is listed in `LANDMARKS` in `viewer.js`.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
