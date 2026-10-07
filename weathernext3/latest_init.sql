SELECT MAX(init_time) AS latest FROM `test-gemini-441412.weathernext_3.weathernext_3_0_0_0p1deg`
WHERE init_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 3 DAY)
