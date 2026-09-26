# River tours

`rivertour.js` keeps the two Princess 60s, *Saigon Star* (`yacht.js`) and
*Nha Rong* (`princess60-berth.js`), on a continuous sightseeing circuit of
the Saigon River. They never moor: both are always out, half a lap apart,
day and night. The **River tour** button follows the nearer one from low
astern.

## Route

The river's centreline (`river-lines.js`) is OpenStreetMap way 708678320
(waterway=river, Sông Sài Gòn). It runs from off the Vinhomes Central Park
Marina downstream past Ba Son, Bạch Đằng wharf and Nhà Rồng, round the Thủ
Thiêm bend, to the Phú Mỹ bridge.

- **Lanes:** each yacht keeps 35 m to the right of the centreline.
- **The loop:** a half-circle turn under the Phú Mỹ bridge (45 m clear), up
  the other side, and a turn upstream off the marina. It is 27.9 km in all.
- **On water:** the test checks every point lies on the model's water.
- **Bridges:** Ba Son and Thủ Thiêm clear the yachts' ~8 m air draft.

## Speed and position

This is **simulated**: positions follow the clock, not a real operator.

- **Speed:** flat out at **35 knots**, the top of the Princess 60's published
  31-35 knots (twin Volvo D13-800), for over 80% of the lap. They slow to
  4 m/s for each turn and build back up.
- **Afloat:** the bow comes up through the hump before she planes and settles
  to about 2.5° on the plane, with a slow roll and pitch.
- **Timing:** a lap takes 28.3 minutes. Positions are a function of
  continuous time (the Unix clock), so every viewer sees the same yachts in
  the same places, and there is no jump at midnight.

## Aboard

- **Lines:** *Saigon Star*'s mooring lines and fenders are in, and the raft
  lines between the yachts are not drawn. The marina's pontoons stay.
- **Flags:** each ensign is the shared flag (`flag.js`). It sails with its
  yacht and flies in the apparent wind, the true wind less the yacht's
  motion, so it streams aft at speed.
- ***Nha Rong*'s detail levels:** they follow it along the river.

## Camera

**River tour** follows the yacht nearest the view: 48 m astern, low (4°),
aimed above the flybridge, so you look up the river at the skyline. The
wheel sets the distance, and dragging hands the view back.
`cityModel.riverTour` reports both yachts (speed and distance round the lap)
and the one followed.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/rivertour.mjs
```
