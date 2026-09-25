"""Build 3d/metro-line1.json: HCMC Metro Line 1 track and stations from OSM.

Fetches the Bến Thành -> Suối Tiên route relation (11919223) from the Overpass
API, joins its track ways into one line in running order, and writes a compact
JSON the 3D viewer reads: the track as [lon, lat, height] points, and the 14
stations with their distance along the line and the stop ID the operator's API
uses (see docs/metro-line-1-api.md).

Heights are schematic: OSM tags the first ~2.2 km as tunnel and the rest as
bridge, with no surveyed elevation. Tunnel track is drawn just below ground,
the viaduct deck at VIADUCT_HEIGHT_M, with a ramp at the portal.

    python 3d/tools/metro_line1.py
"""

import json
import math
import time
from pathlib import Path

import requests

RELATION_ID = 11919223          # L1, Bến Thành -> Bến xe Suối Tiên
OVERPASS = ["https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter"]
OUT = Path(__file__).resolve().parents[1] / "metro-line1.json"
VIADUCT_HEIGHT_M = 12.0
TUNNEL_HEIGHT_M = -2.0
RAMP_M = 400.0
# Stop IDs from the HURC app's API, in running order toward Suối Tiên.
STOP_IDS = ["7003", "7004", "7005", "7006", "7007", "7008", "7009",
            "7010", "7011", "7012", "7013", "7016", "7014", "7015"]


def overpass(query):
    """Run a query, retrying on the public servers' frequent 429/504s."""
    last = None
    for attempt in range(3):
        for url in OVERPASS:
            try:
                r = requests.post(url, data={"data": query}, timeout=120,
                                  headers={"User-Agent": "hcmc-rainmap (personal project)"})
                r.raise_for_status()
                return r.json()["elements"]
            except requests.RequestException as e:
                last = e
        time.sleep(10 * (attempt + 1))
    raise SystemExit(f"Overpass unavailable: {last}")


def metres(a, b):
    """Distance between two (lon, lat) points, equirectangular (fine at this scale)."""
    kx = 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 111320)


def join(ways):
    """Chain the track ways end to end, reversing any that point backwards."""
    line = [tuple(p) for p in ways[0]["points"]]
    tags = [(ways[0]["tunnel"], len(line))]
    for w in ways[1:]:
        pts = [tuple(p) for p in w["points"]]
        if metres(line[-1], pts[-1]) < metres(line[-1], pts[0]):
            pts.reverse()
        if metres(line[-1], pts[0]) > 50:
            raise SystemExit("track ways do not join up")
        line += pts[1:]
        tags.append((w["tunnel"], len(line)))
    return line, tags


def main():
    rel = overpass(f"[out:json][timeout:90];relation({RELATION_ID});out body;")[0]
    ways = {e["id"]: e for e in overpass(
        f"[out:json][timeout:90];relation({RELATION_ID});way(r);out tags geom;")}
    nodes = {e["id"]: e for e in overpass(
        f"[out:json][timeout:90];relation({RELATION_ID})->.r;node(r.r);out;")}

    track = []
    for m in rel["members"]:
        if m["type"] == "way" and m["role"] == "":
            w = ways[m["ref"]]
            track.append({"points": [(g["lon"], g["lat"]) for g in w["geometry"]],
                          "tunnel": w.get("tags", {}).get("tunnel") == "yes"})
    stops = [nodes[m["ref"]] for m in rel["members"]
             if m["type"] == "node" and m["role"].startswith("stop")]
    if len(stops) != len(STOP_IDS):
        raise SystemExit(f"expected {len(STOP_IDS)} stops, OSM has {len(stops)}")

    # Start the line at Bến Thành.
    first = (stops[0]["lon"], stops[0]["lat"])
    if metres(first, track[0]["points"][-1]) < metres(first, track[0]["points"][0]):
        track.reverse()
        for t in track:
            t["points"].reverse()
    line, spans = join(track)

    # Chainage and the schematic height profile.
    chain = [0.0]
    for a, b in zip(line, line[1:]):
        chain.append(chain[-1] + metres(a, b))
    tunnel_end = next(chain[end - 1] for tunnel, end in spans if tunnel)
    def height(s):
        if s <= tunnel_end:
            return TUNNEL_HEIGHT_M
        t = min(1.0, (s - tunnel_end) / RAMP_M)
        return TUNNEL_HEIGHT_M + (VIADUCT_HEIGHT_M - TUNNEL_HEIGHT_M) * (3 * t * t - 2 * t * t * t)

    def along(lon, lat):
        """Distance along the line of the closest point to (lon, lat)."""
        best = (1e18, 0.0)
        kx = 111320 * math.cos(math.radians(lat))
        for i, (a, b) in enumerate(zip(line, line[1:])):
            ax, ay = (a[0] - lon) * kx, (a[1] - lat) * 111320
            bx, by = (b[0] - lon) * kx, (b[1] - lat) * 111320
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy or 1e-9
            t = max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
            d = math.hypot(ax + t * dx, ay + t * dy)
            if d < best[0]:
                best = (d, chain[i] + t * (chain[i + 1] - chain[i]))
        return best

    stations = []
    for stop, stop_id in zip(stops, STOP_IDS):
        off, s = along(stop["lon"], stop["lat"])
        tags = stop.get("tags", {})
        stations.append({"name": tags.get("name"), "name_en": tags.get("name:en"),
                         "stopId": stop_id, "along_m": round(s, 1),
                         "underground": s <= tunnel_end, "offset_m": round(off, 1)})

    out = {
        "source": f"OpenStreetMap relation {RELATION_ID} (© OpenStreetMap contributors, ODbL)",
        "note": "Heights are schematic: tunnel just below ground, viaduct deck at "
                f"{VIADUCT_HEIGHT_M:g} m, {RAMP_M:g} m ramp at the portal.",
        "length_m": round(chain[-1], 1),
        "tunnel_end_m": round(tunnel_end, 1),
        "track": [[round(lon, 6), round(lat, 6), round(height(s), 2)] for (lon, lat), s in zip(line, chain)],
        "stations": stations,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {OUT}: {len(line)} points, {out['length_m'] / 1000:.1f} km, "
          f"tunnel to {tunnel_end:.0f} m, {len(stations)} stations")
    for s in stations:
        print(f"  {s['stopId']} {s['along_m']:8.0f} m  {'tunnel ' if s['underground'] else 'viaduct'}  "
              f"{s['offset_m']:5.1f} m off track  {s['name']}")


if __name__ == "__main__":
    main()
