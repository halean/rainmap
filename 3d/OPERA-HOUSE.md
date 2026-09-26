# Saigon Opera House

`opera-house.js` builds a schematic, exterior-only model of the Opera House
(Nhà hát Thành phố, the Opéra de Saïgon) on Lam Sơn square, facing south-west
down Lê Lợi. It follows the Buildings checkbox and has no dedicated camera
button (`view` looks at the facade from the square).

## Placement and references

The footprint is the theatre's OpenStreetMap outline, way 801710792 (21
corners, tagged `height=26 m`), extruded as-is; the model origin is about
106.7032105° E, 10.7767024° N. The stepped end at +z, towards the square, is
the front.

- [Saigon Opera House, Wikipedia](https://en.wikipedia.org/wiki/Saigon_Opera_House):
  designed by Félix Olivier, built 1898-1900 under Ernest Guichard and Eugène
  Ferret, in the flamboyant style of the French Third Republic; the facade
  after the Petit Palais in Paris; some ornament removed in 1943 and restored
  in 1998.
- [Origin Vietnam guide](https://www.originvietnam.com/destinations/saigon-opera-house/):
  the large arch in the middle of the facade, topped by two seated angels,
  and before the entrance two goddess figures carrying columns about 4.5 m
  high; arched windows with railings on the sides.
- [Vietnam.vn on the Opera House](https://www.vietnam.vn/en/nha-hat-lon-sai-gon):
  the two angels with a lyre between them at the top, and the relief of five
  goddesses (France and the four seasons) in the arch.
- Photographs of the front on Wikimedia Commons, used for its layout and
  proportions: [Saigon Opera House, front.jpg](https://commons.wikimedia.org/wiki/File:Saigon_Opera_House,_front.jpg)
  (TomW712, CC BY-SA 3.0), taken straight on and used for the measurements,
  and [2023-12-10 Saigon Opera House … 02.jpg](https://commons.wikimedia.org/wiki/File:2023-12-10_Saigon_Opera_House_(Nh%C3%A0_h%C3%A1t_Th%C3%A0nh_ph%E1%BB%91,_S%C3%A0i_G%C3%B2n)_02.jpg)
  (源義信, CC BY-SA 4.0).

The front follows those photographs. The great arch, about 12.6 m across and
peaking at 19.6 m, frames a mosaic tympanum, three arched windows over a
balcony, and the two caryatids carrying that balcony between three doors. Two
pairs of columns on tall pedestals flank it, and the angels, cartouche and lyre
top it at about 23 m. The building stands on a 2.2 m terrace up a wide flight
of steps. In each wing, a tall arched window in a white surround sits over a
tan base, with tan strips between white pilasters and a balustrade on top.
Relief panels mark the returns. The roofs are dark slate mansards: one behind
the arch, and a lower one with a round dormer over each wing.

Heights were scaled from the straight-on photograph by the facade's 32 m
width in OSM, so they are rough, perhaps to a metre. OSM's 26 m is taken as the
ridge of the auditorium roof, which is hidden from the square in the photos.
The sides and back (two tiers of arched windows) are not from photographs.
The reliefs (the five goddesses, Pan), the mosaic's pattern, lamps, ironwork
and banners are omitted, and the figures are simple shapes.

## Rendering and integration

Built with `landmark-kit.js`, merged into eight meshes (5,860 triangles), with
no textures, lights or per-frame updates. The generic OSM building is
replaced when its tile (`2_1`) loads: exactly the generic Opera House (61
triangles: its 21-corner outline extruded), with its neighbours untouched.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
