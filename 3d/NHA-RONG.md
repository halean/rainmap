# Nhà Rồng (the Dragon House)

`nha-rong.js` builds a schematic, exterior-only model of Nhà Rồng. It was
built in 1862-1863 as the port's headquarters at the mouth of the Bến Nghé,
and is now the Ho Chi Minh Museum; Nguyễn Tất Thành (Ho Chi Minh) sailed
from this wharf in 1911. It follows the Buildings
checkbox and has no dedicated camera button.

## Placement and references

The footprint is the OpenStreetMap outline, way 808022726, a rectangle
34.6 m by 27.6 m tagged `building:colour=#EBC3A7` and `roof:colour=#E69151`;
the model origin is about 106.7068074° E, 10.7682508° N.

- [Dragon House (Ho Chi Minh City), Wikipedia](https://en.wikipedia.org/wiki/Dragon_House_(Ho_Chi_Minh_City)):
  built 1862-1863 as the port's headquarters where the Saigon River meets
  the Bến Nghé; Nguyễn Tất Thành left from it on 5 June 1911; made a
  memorial in 1979 and now the Ho Chi Minh Museum's city branch. OSM's
  `old_name` gives it as the headquarters of the Messageries Maritimes.
- Photographs on Wikimedia Commons:
  [Ben Nha Rong](https://commons.wikimedia.org/wiki/File:Ben_Nha_Rong.JPG)
  (Handyhuy, CC BY-SA 3.0), a corner and the gable;
  [Ho Chi Minh Museum, Saigon](https://commons.wikimedia.org/wiki/File:Ho_Chi_Minh_Museum,_Saigon.jpg)
  (Gary Todd, CC0); and
  [Ho Chi Minh Museum Bến Nhà Rồng](https://commons.wikimedia.org/wiki/File:Ho_Chi_Minh_Museum_B%E1%BA%BFn_Nh%C3%A0_R%E1%BB%93ng.jpg)
  (Mini Good.vn, CC0), the long front with the dragons on the ridge.

The model follows the photographs:
- **Ground floor:** an arcade of round arches round all four sides, in front
  of the house's doors, with white bands at the springing.
- **Upper floor:** a veranda of square piers with iron railings.
- **Roof terrace:** railed, with the piers standing up as posts.
- **The hall on the roof:** low walls under an orange-tiled roof with gables
  at its ends and upturned ridge ends, and on the ridge two dragons facing a
  golden pearl.

Heights come from the photographs' proportions, not measurements: the upper
floor at 5.5 m, the terrace at 10.5 m, and the ridge at 15 m with the dragons
to about 17 m. The bay counts (nine on the long sides, seven on the short),
the veranda's depth and the dragons' shape are approximations. The statue of
Nguyễn Tất Thành, the gardens, and the flags are omitted.

## Rendering and integration

Built with `landmark-kit.js`; each bay of the arcade and veranda is a wall
panel with its opening cut out. Merged into eight meshes (about 6,900
triangles). The generic block is replaced when its tile (`3_2`) loads:
exactly its 10 triangles. It is listed in `LANDMARKS` in `viewer.js`.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
