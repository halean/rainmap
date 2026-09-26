# Museum of Ho Chi Minh City (Gia Long Palace)

`city-museum.js` builds a schematic, exterior-only model of the Museum of Ho
Chi Minh City, the former Gia Long Palace, on Lý Tự Trọng. It follows the
Buildings checkbox and has no dedicated camera button.

## Placement and references

The footprint is the OpenStreetMap outline, way 802105071 (32 corners,
`old_name=Dinh Gia Long`), extruded as-is; the model origin is about
106.6996545° E, 10.7759327° N. The front faces +x, south-east, between two
short wings; the curved run in the middle of it is the porte-cochère, built
separately as a one-storey porch.

- [Museum of Ho Chi Minh City, Wikipedia](https://en.wikipedia.org/wiki/Ho_Chi_Minh_City_Museum):
  built 1885-1890 to designs by Alfred Foulhoux, first for a commercial
  museum and then the residence of the Governor of Cochinchina. As the Gia
  Long Palace it was President Ngô Đình Diệm's last seat, in 1962-1963. It
  has two storeys in a classical style with ornament along the roof, and has
  been a museum since 1978, under its present name since 1999.
- Photographs on Wikimedia Commons:
  [Museum of Ho Chi Minh City (formerly Gia Long Palace)](https://commons.wikimedia.org/wiki/File:Museum_of_Ho_Chi_Minh_City_(formerly_Gia_Long_Palace).jpg)
  (Gary Todd, CC0), the entrance straight on;
  [Gia Long Palace](https://commons.wikimedia.org/wiki/File:Gia_Long_Palace.jpg)
  (David Stanley, CC BY 4.0); and
  [Museum of Ho Chi Minh City 01](https://commons.wikimedia.org/wiki/File:Museum_of_Ho_Chi_Minh_City_01.JPG)
  (Thomas1313, CC BY-SA 3.0), a corner with the long side.

The model follows the photographs:
- **Walls:** pale grey over a white plinth, with a giant order of white
  columns with Corinthian capitals through both storeys, about every 3.6 m,
  all round.
- **Windows:** two tiers of grey shutters, with awnings over the upper ones.
- **Top:** a heavy entablature and cornice, then a balustrade with cartouches
  along the roof edge.
- **Entrance:** a central pavilion with a pediment and a head in its
  tympanum, and the flag. The curved porte-cochère stands on columns and
  carries a balustraded balcony in front of an arched window.

Heights come from the photographs' proportions, not measurements: the order
to 11 m, the cornice at 13.2 m, and the pediment at 18.8 m. The column rhythm,
the ornament's form, the roof's sculpture (not visible in these photographs),
and the gardens are approximations or omitted.

## Rendering and integration

Built with `landmark-kit.js`, merged into six meshes (about 11,700
triangles). The generic block is replaced when its tile (`2_1`) loads:
exactly its 96 triangles. It is listed in `LANDMARKS` in `viewer.js`.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
