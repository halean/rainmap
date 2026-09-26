# Hotel Majestic Saigon

`majestic.js` builds a schematic, exterior-only model of the Majestic (1925) on
the corner of Đồng Khởi and Tôn Đức Thắng, facing the Saigon River. It follows
the Buildings checkbox and has no dedicated camera button (`view` holds a
riverside viewpoint).

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

The model follows the photographs:
- **Street level:** an arcade of round arches under a continuous white canopy,
  with HOTEL MAJESTIC in gold on a curved pediment over the corner entrance.
- **Mezzanine:** a floor of small windows above the canopy.
- **Main floors:** four floors of rectangular windows in pairs. On the
  straight fronts each pair shares a balcony with an iron railing; round the
  corner there are no balconies, only gold ornaments. Pilasters with gold
  capitals divide the bays.
- **Top:** a heavy main cornice with a balustrade, then a top floor set back
  2 m, and MAJESTIC in gold letters over the corner. On the river side the
  top floor is set back 6 m behind a white colonnade and pergola, where the
  rooftop bar is.

Heights are scaled from the photographs' proportions, not measured: a 6 m
arcade, a 3 m mezzanine, 3.6 m floors, the cornice at 23.4 m, the top floor to
26.8 m, and the letters to 30.6 m. OSM's 35 m is above anything the
photographs show on this block, so it is not used; the taller wing seen at
the end of the river front is outside this outline and not modelled. The
colours, window sizes and bay widths are approximations. Signage other than
the two names, the Saigontourist band, flags, lamps and interiors are
omitted.

## Rendering and integration

Built with `landmark-kit.js`: the outline extruded, the set-back floor from
`insetOutline`, detail added edge by edge, the letters from `letters`, and
geometry merged into six meshes (12,032 triangles). The railings are a
see-through panel rather than individual bars. No textures, lights or per-frame updates.

The generic OSM building is replaced when its tile (`3_2`) loads: only
building triangles lying inside the outline or within 0.8 m of it, which is
exactly the generic Majestic (58 triangles: its 20-corner outline extruded).
Its neighbours, some built right against it, are untouched.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
