"""Parsing for Vietnam's official lightning feed (HYMETNET -- Trung Tam Ky
thuat quan trac KTTV, the national hydro-meteorological observation centre).
Two complementary sources, neither documented, both found by watching the
network tab of their own public map (hymetnet.gov.vn/lightningmaps/) the
same way this project found VRAIN and the TIA flight board:

* `normalize()`, for `GET http://hymetnet.gov.vn/dongset` -- commune-level
  (named places, a few km resolution), a rolling ~1 hour window in 10-minute
  buckets. JSON, no key, `Access-Control-Allow-Origin: *`.
* `parse_embedded_strikes()`, for individual strikes embedded directly in
  the `lightningmaps/` page's own HTML -- precise coordinates, the exact
  second, real peak current in kA, and genuine cloud-to-ground vs in-cloud
  classification, but no place name. Not a separate request at all: a plain
  GET of the page already contains it (see that function for the shape).

Neither supersedes the other -- one has names, the other has precision and
detail -- so scripts/hymetnet_poller.py collects both, into separate
archives. No published rate limit or ToS for either, so it polls gently.
"""

import re
from datetime import datetime, timezone

UTC = timezone.utc
BUCKET_RE = re.compile(r"^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$")
# "<commune>, <province>, <lat>-<lon>": the '-' is a delimiter the source
# chose, not a sign -- every point in Vietnam has positive lat and lon, so
# splitting the last two dot-decimals on '-' is unambiguous.
ITEM_RE = re.compile(r"^(.*),\s*(\d{1,3}\.\d+)-(\d{1,3}\.\d+)\s*$")


def bucket_datetime(key):
    """"202609241230" -> 2026-09-24T12:30:00Z, or None if it doesn't match --
    a key the source might someday format differently must not crash the
    poller, only get skipped."""
    m = BUCKET_RE.match(key or "")
    if not m:
        return None
    year, month, day, hour, minute = (int(g) for g in m.groups())
    try:
        return datetime(year, month, day, hour, minute, tzinfo=UTC)
    except ValueError:
        return None


def split_label(label):
    """"Xa Chieng Son, Tinh Son La" -> ("Xa Chieng Son", "Tinh Son La"). A
    label without a province (unexpected, but the source is unofficial)
    keeps the whole thing as the commune rather than dropping data."""
    if "," in label:
        commune, province = label.rsplit(",", 1)
        return commune.strip(), province.strip()
    return label.strip(), None


def parse_item(text):
    """One bucket entry into {label, commune, province, lat, lon}, or None
    if the source's format doesn't match -- skipped, not fatal, same as a
    malformed CSV row elsewhere in this project."""
    m = ITEM_RE.match((text or "").strip())
    if not m:
        return None
    label, lat, lon = m.groups()
    label = label.strip()
    commune, province = split_label(label)
    return {"label": label, "commune": commune, "province": province, "lat": float(lat), "lon": float(lon)}


def strike_id(bucket_key, item):
    """Stable across repeated polls of the same bucket (every poll returns
    the whole rolling window again), so a poller can dedupe against what it
    already has instead of re-appending the same strike."""
    return f"{bucket_key}:{item['lat']:.6f},{item['lon']:.6f}"


def normalize(payload):
    """The whole `/dongset` response into a flat list of strike records,
    oldest bucket first. Each record: id, time (ISO, the bucket's UTC key),
    bucket, commune, province, lat, lon, label. A payload that isn't the
    expected {bucket: [str, ...]} shape yields no records rather than
    raising -- the poller decides what an empty result means."""
    if not isinstance(payload, dict):
        return []
    records = []
    for bucket_key in sorted(payload):
        when = bucket_datetime(bucket_key)
        if when is None:
            continue
        items = payload[bucket_key]
        if not isinstance(items, list):
            continue
        for raw in items:
            item = parse_item(raw)
            if item is None:
                continue
            records.append({
                "id": strike_id(bucket_key, item),
                "time": when.isoformat().replace("+00:00", "Z"),
                "bucket": bucket_key,
                **item,
            })
    return records

# ---------------------------------------------------------------------------
# The richer source: individual strikes embedded in the live map page itself
# (hymetnet.gov.vn/lightningmaps/), not a separate endpoint. Server-rendered
# directly into the plain HTML as JS array literals `set[N] = [{...}, ...];`
# -- found by loading the page in a real browser and reading its rendered
# Leaflet markers/popups, since no XHR/fetch ever requests this; a plain GET
# of the page (no JS execution needed) already contains it.
#
# Eighteen buckets (set[0]..set[17]) exist. The first several (observed:
# indices 0-5) carry only {nam,thang,ngay,gio,phut,lat,lng,style,loaiset} --
# a coarser, longer-range tier with no per-strike detail. The rest carry the
# full per-strike record this module cares about: {..., giay (seconds),
# giatri (peak current, kA, signed), sensor (sensor count), dof (degrees of
# freedom / solution quality)} -- exactly the fields the page's own popup
# shows for a marker. Their counts grow with bucket index (635, 687, 749,
# ... 1245 in one observed fetch), consistent with each being a *cumulative*
# trailing window ("N minutes before now"), not a disjoint 10-minute slice
# -- so records are deduplicated across buckets here rather than assumed
# distinct, and which bucket indices happen to carry full detail is
# detected from the fields present, not hardcoded, in case the source's
# layout shifts.
STRIKE_ARRAY_RE = re.compile(r"set\[\d+\]\s*=\s*\[(.*?)\];", re.DOTALL)
STRIKE_OBJECT_RE = re.compile(r"\{([^{}]*)\}")
STRIKE_FIELD_RE = re.compile(r"(\w+):(-?[\d.]+)")
# 0 = "Set xuong dat" (cloud-to-ground), 1 = "Set trong may" (in-cloud/intracloud) --
# from the page's own popup template, not guessed.
LOAISET_KIND = {0: "ground", 1: "cloud"}


def parse_embedded_object(text):
    """One `{...}` chunk's bare `key:number` pairs (no quotes, not JSON) into
    a dict of floats. Only ever called on regex-matched object bodies, so a
    field list that doesn't include the rich set (giay/giatri/sensor/dof)
    just means this came from one of the coarser buckets -- the caller skips
    those, not an error here."""
    return {k: float(v) for k, v in STRIKE_FIELD_RE.findall(text)}


def strike_record(fields):
    """One parsed object into our record shape, or None if it's missing any
    of the rich fields (a coarser-tier record) or has an out-of-range date
    component."""
    required = ("nam", "thang", "ngay", "gio", "phut", "giay", "giatri", "sensor", "dof", "lat", "lng", "loaiset")
    if not all(k in fields for k in required):
        return None
    try:
        when = datetime(int(fields["nam"]), int(fields["thang"]), int(fields["ngay"]),
                        int(fields["gio"]), int(fields["phut"]), int(fields["giay"]), tzinfo=UTC)
    except ValueError:
        return None
    lat, lon = fields["lat"], fields["lng"]
    time_iso = when.isoformat().replace("+00:00", "Z")
    return {
        "id": f"{time_iso}:{lat:.4f},{lon:.4f}",
        "time": time_iso,
        "lat": lat,
        "lon": lon,
        "current_ka": fields["giatri"],
        "sensor_count": int(fields["sensor"]),
        "dof": int(fields["dof"]),
        "kind": LOAISET_KIND.get(int(fields["loaiset"]), "unknown"),
    }


def parse_embedded_strikes(html):
    """Every rich per-strike record embedded in a `lightningmaps/` page
    fetch, deduplicated (see the module note on why buckets overlap).
    Returns [] for a page that doesn't have this structure -- a redesign
    should be a silent miss here, not a crash in the poller."""
    seen = {}
    for array_body in STRIKE_ARRAY_RE.findall(html or ""):
        for object_body in STRIKE_OBJECT_RE.findall(array_body):
            record = strike_record(parse_embedded_object(object_body))
            if record:
                seen[record["id"]] = record
    return sorted(seen.values(), key=lambda r: r["time"])

