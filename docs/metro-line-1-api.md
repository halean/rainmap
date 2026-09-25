# HCMC Metro Line 1 — the HURC app's API

Research notes, 2026-09-25.

**Used by the 3D map (2026-09-26):** `app/services/metro.py` fetches
`scheduled_trips` for both directions once per local day and serves it at
`GET /api/rain-map/metro/timetable` (cached in `data/derived/metro_timetable.json`,
yesterday's copy served, marked `stale`, if a refetch fails). `3d/metro.js` runs
every trip as a train: each listed time is a departure, with up to 25 s stopped
before it, and an accelerate–cruise–brake run fitted to the gap. Weekdays and
weekends differ (118 vs 115 trips, 6- vs 10-minute morning headways), which is
why it is refetched daily. Add `?metro-time=HH:MM` to the 3D map's URL to
preview another time of day. Track and stations: `3d/metro-line1.json`, built
by `3d/tools/metro_line1.py` from OSM -- whose station names confirm the stop
table below.

Metro Line 1 (Bến Thành – Suối Tiên) has no public live feed, GTFS or open
data. The operator's app, **HCMC Metro HURC** (HURC1; Android `com.fts.metro`,
iOS id6449395180), shows trains moving on a map and times at each station. This
is where that data comes from and what it actually is.

**Summary:** the train positions come from the timetable, not from the trains.
They cannot show a delay. What the API does usefully offer is the official
timetable, station spacing, and hourly crowding profiles per station.

## Endpoints

Host `https://api.metrohcm.ttgt.vn`. All `GET`, no login, no key, no special
headers. Line 1 is `routeId=384`, hard-coded in the app. `varId` is the
direction: `1` toward Suối Tiên, `2` toward Bến Thành. A missing or wrong
parameter makes the server fail with an HTML `500` page, not a JSON error.

| Request | Returns |
|---|---|
| `/transit/vehicles?routeId=384&varId=1` | Every train on the line in that direction, right now |
| `/transit/scheduled_trips?routeId=384&varId=1` | The whole day's timetable at every stop |
| `/transit/route_info?routeId=384&varId=1` | Distance between consecutive stations |
| `/transit/crowd_level?routeId=384&varId=1&stopId=7009&day=4` | Typical crowding by hour for one station |
| `/transit/cameras?routeId=384` | CCTV snapshot links (served by `ttgt.dongnai.gov.vn`) |

### `vehicles`

```json
{"vehicles": [{"angle": 79, "coordinate": [106.74713, 10.80312], "percent": 0.487}]}
```

`coordinate` is **[lon, lat]**. `angle` is the heading in degrees. `percent` is
the fraction of the trip completed, by distance. A train appears at its
scheduled departure and disappears on arrival. Late evening (22:42) showed two
trains each way.

**These positions are computed from the timetable.** Sampled every 5 s for two
minutes, each train advanced by exactly the same amount per poll within each
section between stations, with no acceleration, braking or station stops. A new
train appeared at 0.26% at the timetable's 22:45 departure. A real tracking
feed would be irregular. So this can animate trains, but cannot show delays or
disruption, and should be labelled as scheduled.

### `scheduled_trips`

```json
{"7003": ["05:00", "05:15", "05:30", "..."], "7004": ["05:02", "..."]}
```

One list per stop, one entry per trip, same trip at the same index in every
list. 118 trips a day each way. Toward Suối Tiên the first train leaves Bến
Thành at 05:00, the last at 23:00, about 29 minutes end to end. There is no date
parameter, so it is presumably the current day's timetable. The object's key
order is not line order: sort stops by their first time, or use the table below.

### `route_info`

```json
{"distances": ["0.7 km", "1 km", "1.9 km", "..."]}
```

13 gaps between the 14 stations, in line order, as strings. Sum 19.1 km,
against a published line length of 19.7 km.

### `crowd_level`

```json
[{"crowd_level": 29, "from": "06:01", "to": "07:00"}, "..."]
```

- `stopId` and `varId` are required.
- `day` is **0 = Monday … 6 = Sunday**; 7 and above fail. If left out, it is
  today (matched `day=4` on a Friday).
- Weekdays have 17 hourly slots (05:00–22:00), weekends 18.
- Units are not given. Values seen range 0–71; it may be a percentage of
  capacity, unconfirmed.

**Typical profiles, not live counts:** the same answer every time for a given
station, direction and day. It does look derived from real ridership:

- At a mid-line station (7009), toward Bến Thành peaks at 71 in 07:00–08:00,
  while toward Suối Tiên peaks at 71 in 17:00–18:00 (morning in, evening out).
- Sunday 06:00–07:00 is 11 against 29–34 on weekdays.
- Bến Thành toward Bến Thành is 0 all day, since nobody boards at the end of
  that direction.

The full set is 14 stations × 2 directions × 7 days = 196 requests, which would
suit a weekly cache.

## Stops

The IDs are not numbered in line order: 7016 sits between 7013 and 7014. The
**order** below comes from the timetable. The **names** are matched by position
to the line's published station list; the API has not confirmed them.

| # | stopId | Station (inferred) | Gap to next |
|---|---|---|---|
| 1 | 7003 | Bến Thành | 0.7 km |
| 2 | 7004 | Nhà hát Thành phố | 1 km |
| 3 | 7005 | Ba Son | 1.9 km |
| 4 | 7006 | Văn Thánh | 0.9 km |
| 5 | 7007 | Tân Cảng | 1.2 km |
| 6 | 7008 | Thảo Điền | 1 km |
| 7 | 7009 | An Phú | 1.7 km |
| 8 | 7010 | Rạch Chiếc | 1.5 km |
| 9 | 7011 | Phước Long | 1.4 km |
| 10 | 7012 | Bình Thái | 1.7 km |
| 11 | 7013 | Thủ Đức | 2.4 km |
| 12 | 7016 | Khu Công nghệ cao | 1.6 km |
| 13 | 7014 | Đại học Quốc gia | 2.1 km |
| 14 | 7015 | Bến xe Suối Tiên | — |

## What else was checked

- **Other routes:** no other route has data here. 384 is the only route ID in
  the app's metro code. Ten other route IDs and six HCMC bus routes, the buses
  tried with their own direction IDs from the app's bundled bus data, all failed.
  The bus routes in the app (136) are bundled as fixed JSON files.
- **Not usable for the metro:** `transit/predictions/findOne` (404),
  `transit/routes/timetables` (404). They appear to belong to the Đà Nẵng and
  Hải Phòng versions of the same codebase.
- **Not train tracking:** `transit/tracking` belongs to an "NTCB-2024" feature
  alongside `transit/departments` and `transit/usersInfo`. It looks like
  tracking people, not trains.
- **Other hosts:** the operator's website `hurc.vn` has no live data. It is a
  Next.js site reading a content system at `admin.metrohcm.ttgt.vn` and news
  from `api.metrohcm.ttgt.vn/metro-hcm/articles/…`; its "Lịch chạy tàu" page is
  a fixed timetable. `gobus.vn/app` was down ("Bandwidth Quota Exceeded").

## How this was found

1. **The app package:** HCMC Metro HURC 1.5.13 (build 1050013) from APKPure, as
   an XAPK of split APKs. It is a Flutter app: the logic is compiled into
   `lib/arm64-v8a/libapp.so`.
2. **Strings:** `strings libapp.so` gave the host and the `transit/…` paths, but
   not how they are combined.
3. **Decompiling:** [blutter](https://github.com/worawit/blutter) (Dart 3.8.1,
   android arm64) recovered which code uses which strings. The app is
   name-obfuscated, but string literals survive. Key findings:
   - The base URL is chosen by package name: `com.fts.metro` →
     `https://api.metrohcm.ttgt.vn/`.
   - Metro calls interpolate `"/transit/vehicles?routeId=" + "384" + "&varId=" + …`.
   - blutter needs g++ 13 or newer. On this Ubuntu 20.04 ARM64 host it was built
     with conda-forge GCC 13 via micromamba, all under `/media/150G/re-tools`.
   - blutter's static-field indexes are half the byte offsets in the field table
     (index `0x1e60` is `[field_table, #0x3cc0]`).

## Caveats

- Undocumented government-hosted API, as with the HYMETNET and TIA sources
  elsewhere in this repo. It can change or disappear, and it has no stated terms.
- Poll gently: `vehicles` at most every ~10 s, and the timetable, stop order,
  distances and crowding at most daily or weekly. Keep bulk requests throttled.
- When the app updates, its route ID or endpoints may change. Re-running the
  decompile on the new APK is the reliable check.
