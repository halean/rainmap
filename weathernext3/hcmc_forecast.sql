# WeatherNext 3 (0.1 deg ensemble) hourly rain over HCMC for one run, for 7 Oct 2026 ICT.
# Box 10.35-11.20 N, 106.35-107.05 E. Only three rain columns: each extra column costs ~70-130 GB.
SELECT
  init_time, ST_Y(geography) AS lat, ST_X(geography) AS lon, f.time AS valid_utc,
  f.total_precipitation_1hr_p50 AS tp_p50, f.total_precipitation_1hr_p90 AS tp_p90,
  f.total_precipitation_1hr_mean AS tp_mean
FROM `test-gemini-441412.weathernext_3.weathernext_3_0_0_0p1deg`, UNNEST(forecast) AS f
WHERE init_time = TIMESTAMP('2026-10-06 11:00:00')
  AND ST_INTERSECTS(geography, ST_GEOGFROMTEXT('POLYGON((106.35 10.35, 107.05 10.35, 107.05 11.20, 106.35 11.20, 106.35 10.35))'))
  AND f.time >= TIMESTAMP('2026-10-06 17:00:00') AND f.time < TIMESTAMP('2026-10-07 17:00:00')
ORDER BY valid_utc, lat, lon
