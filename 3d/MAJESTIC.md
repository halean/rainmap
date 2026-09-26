# Hotel Majestic Saigon

`majestic.js` builds an exterior model of the Majestic (1925) on the corner
of Đồng Khởi and Tôn Đức Thắng, facing the Saigon River, detailed enough to
hold up from the river tour: every bay, arch, balcony and baluster. It
follows the Buildings checkbox and has no dedicated camera button (`view`
holds a riverside viewpoint).

## Placement and references

The footprint is the hotel's OpenStreetMap outline, way 193142038 (20
corners, tagged `height=35`), extruded as-is; the model origin is about
106.7059578° E, 10.7729065° N. Edges 0–3 face Đồng Khởi, 3–5 are the rounded
corner, and 6 faces Tôn Đức Thắng; the rest is the back of the block. The
unnamed 15-storey, 50 m building behind it (way 263502875) is not modelled:
no source found ties it to the hotel.

- [Hotel Majestic (Saigon), Wikipedia](https://en.wikipedia.org/wiki/Hotel_Majestic_(Saigon)) and
  [Our history, Hotel Majestic Saigon](https://www.majesticsaigon.com/our-hotel/our-history/):
  opened 1925 with four storeys; two added in 1968; eight floors today; a
  wing on the Tôn Đức Thắng side incorporated in 2003.
- [Tatler Asia on the Majestic](https://www.tatlerasia.com/homes/architecture-design/art-nouveau-architecture-in-hotel-majestic-saigon):
  arched windows and French balconies with wrought-iron balustrades facing the
  river; ornamental ironwork at the rooftop café.
- [Saigoneer, Old Saigon Building of the Week](https://saigoneer.com/saigon-heritage/10793-old-saigon-building-of-the-week-hotel-majestic-saigon):
  the rooftop bar overlooking the river.

- Photographs on Wikimedia Commons, used for the elevations:
  [Hotel Majestic, Saigon, 2023 (01)](https://commons.wikimedia.org/wiki/File:Hotel_Majestic,_Saigon,_2023_(01).jpg)
  (Bahnfrend, CC BY-SA 4.0), the corner from the street;
  [Hotel Majestic SGN wide](https://commons.wikimedia.org/wiki/File:Hotel_Majestic_SGN_wide.JPG)
  (Dragfyre, CC BY-SA 3.0), the corner's upper floors and the rooftop
  colonnade; and [Hotel Majestic, Saigon (20230705 1506)](https://commons.wikimedia.org/wiki/File:Hotel_Majestic,_Saigon_(20230705_1506).jpg)
  (Syced, CC0), the river front.

The model follows the photographs of the floodlit front. The facade runs
unbroken along three frontages: Đồng Khởi, the corner, and the river along
Tôn Đức Thắng. The corner is the smooth curve it is: a quadratic tangent to
both streets, replacing the outline's three corner segments. Bays are 4.4 m,
laid out along each frontage, so they follow the curve.

- **Arcade:** a tall round arch per bay in a moulded ring with a keystone,
  between piers rusticated in bands. The arcade's depth glows gold at night.
  A three-step moulded cornice runs above it.
- **Mezzanine:** two square windows per bay under drip mouldings, and a
  lantern on each pier.
- **Four balcony floors:**
  - French windows in pairs in moulded surrounds, crowned alternately with
    pediments and gilded cartouches;
  - each pair on a balcony slab carried on two consoles, behind a
    wrought-iron railing with real balusters, returned at the ends;
  - string courses at each floor, and pilasters with gilded capitals between
    the bays.
- **Top:**
  - the main cornice in three steps with dentils, and a balustrade of turned
    balusters;
  - the top floor set back 2 m, with its windows;
  - on the river side, the rooftop bar's colonnade and pergola, 6 m back.
- **The corner's crown:** a curved attic following the corner, with three
  arched windows, a cornice and a crest, and MAJESTIC in gold on top.
  HOTEL MAJESTIC is on a curved pediment over the corner entrance, and two
  flags fly from raked staffs above it (the shared, waving flag,
  `flag.js`).
- **At night** (`setNight`, driven by the sky's night level):
  - the stucco is floodlit warm;
  - the arcade, the windows and the lanterns glow;
  - the lettering is lit.

About 119k triangles in 11 batches, always drawn. Heights are scaled from
the photographs' proportions, not measured:

| Part | Height |
|---|---|
| arcade | 6.5 m |
| mezzanine | 3.2 m |
| each of the four balcony floors | 3.6 m |
| main cornice | 24.1 m |
| top floor, to | 27.6 m |
| corner attic, to | 31.0 m |
| lettering, to | ~33.6 m (OSM tags 35 m) |

The taller wing seen at the end of the river front is outside this outline
and not modelled. The following are approximations:
- colours, window sizes and ornament;
- the Saigontourist band, other signage, and interiors, which are omitted.

## Rendering and integration

Built with `landmark-kit.js`:
- the body is the outline, with its corner replaced by the curve, extruded;
- the set-back floor comes from `insetOutline`;
- detail is laid out bay by bay along each frontage, and the letters come
  from `letters`;
- geometry is merged into 11 batches (118,544 triangles), plus the two flag
  staffs.

There are no textures or lights of its own. The only per-frame work is
`setNight(level)`, called by the viewer with `sky.state.cityLights`. It sets
the emissive glow of the stucco, arcade, windows, lanterns and gold, and
does nothing unless the level changed.

The generic OSM building is replaced when its tile (`3_2`) loads: only
building triangles lying inside the outline or within 0.8 m of it, which is
exactly the generic Majestic (58 triangles: its 20-corner outline extruded).
Its neighbours, some built right against it, are untouched.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
