# Open-top tour bus

`opentour.js` runs the city's open-top hop-on hop-off bus, the City
Sightseeing Saigon **Red Route**, round its loop. The **Open tour** button
follows a bus from behind with the same chase camera as Metro 1.

## Route

The Red Route's ten stops, in order, from
[City Sightseeing / GetYourGuide](https://www.getyourguide.com/ho-chi-minh-city-l272/saigon-hop-on-hop-off-bus-tour-4-24-or-48-hours-t392990/)
and [hop-on-hop-off-tickets.com](https://www.hop-on-hop-off-tickets.com/ho-chi-minh-city-bus-tours/):

1. Saigon Opera House
2. Nguyễn Huệ Street
3. Nhà Rồng Wharf
4. Trần Hưng Đạo Statue (Mê Linh Square)
5. Museum of Vietnamese History
6. War Remnants Museum
7. Phạm Ngũ Lão Street
8. Bến Thành Market
9. Independence Palace
10. Notre-Dame Cathedral / Central Post Office

The operator publishes the stops but not the streets between them. The path
in `opentour-route.js` was routed once, by car, through the stops in order
with OSRM ([router.project-osrm.org](https://router.project-osrm.org), on
OpenStreetMap data), and stored: a 14.3 km loop that crosses the Bến Nghé on
the Khánh Hội bridge to reach Nhà Rồng. A stop point is the kerb nearest the
sight. The road height under the path is stored every 5 m, sampled from the
model's roads and the modelled bridges, with 7% ramps where the generic
model has a step and a 10 m false reading under an overpass removed.

## Timetable and motion

This is **simulated, not tracked**: no live position feed is published.

- **Departures:** from the Opera House every 30 minutes, 09:00-22:30. The
  day service runs 09:00-16:00; the evening service, which leaves from
  Nguyễn Huệ, is folded into the same loop.
- **Motion:** each bus drives at 18 km/h, a guess for the centre's traffic,
  accelerating and braking at 0.9 m/s². It waits 90 s at each stop and keeps
  1.9 m right of the road's centreline.
- **Loop:** it takes 64 minutes, so two or three buses are on the loop at
  once.

## The bus

An open-top double-decker 10.5 m long and 2.5 m wide, in red with the white
wave. The lower saloon has tinted windows, a lit destination sign, doors on
the kerb side and lamps. The open upper deck has blue seats, with sightseers
in most of them: some in sun hats, some holding up a phone. All buses share
one set of geometry.

## Camera

**Open tour** follows the bus nearest the view from 32 m behind. The wheel
sets the distance (12-2000 m); dragging the view hands it back. Before 09:00
and after the last loop it shows the Opera House stop instead.
`cityModel.openTour` reports the buses running and the one followed: its
departure time and its last stop.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/opentour.mjs
```
