# State Bank of Vietnam (former Banque de l'Indochine)

`state-bank.js` builds a schematic, exterior-only model of the State Bank of
Vietnam's building at 17 Bến Chương Dương, now Võ Văn Kiệt, by the Bến Nghé
canal: built for the Banque de l'Indochine and a national relic since 2016. It
follows the Buildings checkbox and has no dedicated camera button (`view`
looks at the canal front).

This is the historic block (way 39598469, about 6,100 m²). The two other
State Bank buildings mapped nearby are left generic: the former Hongkong and
Shanghai Bank next door (way 39598470) and the modern 13-storey southern
office (way 804073938).

## Placement and references

The footprint is the OSM outline, 17 corners, extruded as-is; the model
origin is about 106.7036105° E, 10.7693667° N. Edge 6, facing Võ Văn Kiệt and
the canal, carries the entrance.

- [Banque de l'Indochine, Wikipedia](https://en.wikipedia.org/wiki/Banque_de_l'Indochine):
  the Saigon seat on the Quai de Belgique (now Bến Chương Dương), completed in
  late 1930 and inaugurated in 1931, by Félix Dumail, neoclassical with
  exterior details inspired by Cham and Khmer architecture and a large art
  deco atrium; passed to the National Bank of Vietnam in 1955 and the State
  Bank in 1976.
- [Saigoneer: Saigon's State Bank Building to Be Named a National Relic](https://saigoneer.com/saigon-heritage/7240-saigon-s-state-bank-building-to-be-named-a-national-relic):
  a monumental exterior of Biên Hòa granite with imposing square columns, and
  Khmer-inspired decoration particularly around the roof edge.
- [Vietnam.vn, "Saigon's Wall Street" over 150 years ago](https://www.vietnam.vn/en/pho-wall-sai-gon-hon-150-nam-truoc):
  a massive five-storey structure in silver-grey, four facades filling the
  whole block.

Five storeys make 22.2 m in the model: a 5.5 m ground floor, three 4.2 m
floors spanned by the giant order of square columns, and an attic storey.
The entrance bay rises to 24.9 m and its tallest finial to 27.5 m. The
entrance's design, column spacing, windows, the finials standing in for the
Khmer ornament, and the skylight over the banking hall are visual
approximations; OSM has no height for the building and no source gave these
dimensions.

## Rendering and integration

Built with `landmark-kit.js`, merged into five meshes (6,272 triangles). The
generic OSM building is replaced when its tile (`2_2`) loads: exactly the
generic bank (49 triangles: its 17-corner outline extruded), with its
neighbours untouched.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
