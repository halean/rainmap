# Princess 60 at the Vinhomes Central Park Marina

`yacht.js` builds a Princess 60 flybridge motor yacht, *Saigon Star*, moored
at the Vinhomes Central Park Marina (Tam Sơn Yachting) on the Saigon River,
just south of Landmark 81. It also draws the
marina's floating pontoons, which the city model does not have. It is listed
in `LANDMARKS` in `viewer.js` and follows the Buildings checkbox.

## People aboard

The yacht carries two sets of people, as separate groups; `setMoored()`
shows one or the other:
- **Moored:** three sunbathing, two on the foredeck sunpad and one on the
  flybridge with a book.
- **Underway** (the river tour, `rivertour.js`, so always, in the city):
  - one seated at the helm, leaning in, both hands on the wheel's rim at ten
    and two;
  - two standing on the flybridge behind the helm seat, dressed for 35
    knots: one facing out to port pointing at the bank, one facing
    starboard holding a phone up to take a photo.

  Each arm is placed by a two-bone reach from shoulder to hand, so the hands
  land where they should: on the wheel, on the phone.

`state.crew` says which set is showing.

## Placement

- The marina and its pontoons are from OpenStreetMap: the marina is way
  889441935 and the pontoons way 1160247605. The pontoons are a grey floating
  deck 0.35 m over the water on dark floats, with cleats, a power pedestal
  and lamp posts along the yacht's berth.
- The yacht lies alongside the east face of the long outer pontoon, port side
  to, bow upstream (north), at about 106.72557° E, 10.79464° N, with five
  fenders out and bow, spring and stern lines ashore.

## The yacht

Dimensions are from the builder's specification: 18.61 m overall with the
pulpit (18.36 m hull), 4.83 m beam and 1.27 m draft. The form follows
photographs of the 2011-2017 model.

- **Hull:** lofted from 220 stations. It has a deep-V bottom with two strakes
  and a spray rail, flared topsides, and a sheer rising to a raked bow. It is
  white above a dark boot stripe with antifouling below, with a stainless
  rubbing rail and strake. There are three long rounded hull windows a side
  in stainless surrounds, and exhausts on the quarters.
- **Cockpit and platform:** a teak cockpit floor with seams, a transom sofa
  with piped cushions, a table on a pedestal and two deck chairs. Steps lead
  down to the teak swim platform with a boarding ladder, and the name is in
  gold on the transom. Stairs rise to the flybridge.
- **Saloon:** tumblehome sides with a rounded roof edge. The long side
  glazing and the raked windscreen are part of the same surface, and there
  are wipers, grab rails, the navigation lights, and sliding doors aft.
- **Foredeck:** a three-pad sunpad with a raised backrest and pillows, two
  smoked hatches, the windlass with its chain to the bow roller, the anchor,
  cleats, and a double pulpit rail on stanchions.
- **Flybridge:** it overhangs the cockpit on two posts, inside a curved
  coaming. The helm has two displays, a small windscreen, the wheel,
  throttles and a double seat. There is a sunpad to port, U-seating round a
  teak table, a wet bar with sink and grill, and a cool box. The radar arch
  carries the radome, masthead light, antennas, searchlight and horns, and
  there are rails aft.
- **Ensign:** the shared flag (`flag.js`), on a staff at the transom. It
  turns with the wind like every other flag and waves when the camera is
  near, at its own rate, not in step with the *Nha Rong*'s beside it.
- **Sunbathers:** two on the foredeck sunpad (one in a bikini and straw hat,
  hands behind her head; one with a knee up) and one on the flybridge sunpad
  reading. They lie on striped towels in sunglasses, and there is a drink on
  the flybridge table.

The yacht was built without a triangle budget: about 114,000 triangles in
about 40 draw calls, plus 1,300 for the pontoons. It is a single small
object, drawn only when in view.

## Approximations

Deck layout, window shapes and the interior-free saloon are fitted to
photographs, not builder's drawings. The name *Saigon Star* is invented. The
yacht does not move with the tide, and the pontoon's height over the water
is assumed.

## References

- [Princess 60 specification](https://www.princess.co.uk/wp-content/uploads/2013/05/Princess_Yachts_Flybridge_60_Specification-UK.pdf)
  (Princess Yachts): length overall 18.61 m with the pulpit (18.36 m
  without), beam 4.83 m, draft 1.27 m.
- [Princess 60 (Mk2, 2011-2017)](https://www.yachtbuyer.com/en/princess/new/princess-60-gen2),
  YachtBuyer.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/yacht.mjs
```
