"""Hourly city summary of a WeatherNext 3 HCMC pull (rain in the table is metres per hour)."""
import csv
import sys
from collections import defaultdict
from datetime import datetime, timedelta

path = sys.argv[1] if len(sys.argv) > 1 else "hcmc_2026-10-06T11Z.csv"
rows = list(csv.DictReader(open(path)))
by_hour = defaultdict(list)
for r in rows:
    by_hour[r["valid_utc"]].append({k: float(r[k]) * 1000 for k in ("tp_p50", "tp_p90", "tp_mean")})
print(f"run {rows[0]['init_time']} UTC; {len({(r['lat'], r['lon']) for r in rows})} cells of 0.1 deg; mm/h")
print("hour ICT   median cell p50   mean of means   max p90   cells mean>=1   cells p90>=5")
day_mean = 0
for t in sorted(by_hour):
    c = by_hour[t]
    ict = datetime.fromisoformat(t) + timedelta(hours=7)
    p50 = sorted(x["tp_p50"] for x in c)[len(c) // 2]
    mean = sum(x["tp_mean"] for x in c) / len(c)
    day_mean += mean
    print(f"{ict:%d %b %H:%M}      {p50:6.2f}         {mean:6.2f}      {max(x['tp_p90'] for x in c):6.1f}"
          f"        {sum(x['tp_mean'] >= 1 for x in c):3d}/{len(c)}       {sum(x['tp_p90'] >= 5 for x in c):3d}/{len(c)}")
print(f"city-average ensemble-mean total for the day: {day_mean:.1f} mm")
