import os
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def guess_extension(content_type: str) -> str:
    if not content_type:
        return ".jpg"
    ct = content_type.lower()
    if "jpeg" in ct:
        return ".jpg"
    if "png" in ct:
        return ".png"
    if "gif" in ct:
        return ".gif"
    if "bmp" in ct:
        return ".bmp"
    if "webp" in ct:
        return ".webp"
    return ".jpg"


def download_image(
    session: requests.Session,
    base_url: str,
    camera_id: str,
    out_root: Path,
) -> tuple[Path, int] | None:
    url = f"{base_url}?id={camera_id}"
    try:
        resp = session.get(url, timeout=20)
        if resp.status_code != 200:
            print(f"Skip {camera_id}: HTTP {resp.status_code}")
            return None
        content_type = resp.headers.get("Content-Type", "")
        if "text" in content_type.lower():
            print(f"Skip {camera_id}: non-image content type {content_type}")
            return None
        ext = guess_extension(content_type)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        yyyy, mm, dd = ts[:4], ts[4:6], ts[6:8]
        filename = f"{ts}{ext}"
        camera_dir = out_root / camera_id / yyyy / mm / dd
        ensure_dir(camera_dir)
        out_path = camera_dir / filename
        with out_path.open("wb") as f:
            f.write(resp.content)
        return out_path, len(resp.content)
    except requests.RequestException as e:
        print(f"Error downloading {camera_id}: {e}")
        return None


def resolve_cameras_csv() -> Path:
    cameras_csv = Path(os.getenv("CAMERAS_CSV", "data/metadata/cameras_master.csv"))
    if cameras_csv.exists():
        return cameras_csv
    legacy_path = Path("cameras.csv")
    if legacy_path.exists():
        return legacy_path
    raise SystemExit(f"Camera CSV not found. Checked: {cameras_csv} and {legacy_path}")


def load_camera_ids(cameras_csv: Path) -> list[str]:
    df = pd.read_csv(cameras_csv)
    if "Prop_CamId" not in df.columns:
        raise SystemExit("Column 'Prop_CamId' not found in cameras.csv")
    camera_ids = (
        df["Prop_CamId"].dropna().astype(str).str.strip().replace({"": None}).dropna().unique()
    )
    return list(camera_ids)


def main() -> None:
    cameras_csv = resolve_cameras_csv()
    base_url = "https://giaothong.hochiminhcity.gov.vn/render/ImageHandler.ashx"
    out_root = Path(os.getenv("RAW_OUTPUT_ROOT", "data/raw"))
    ensure_dir(out_root)

    camera_ids = load_camera_ids(cameras_csv)

    print(f"Found {len(camera_ids)} camera IDs. Starting downloads...")

    session = requests.Session()
    # Set a User-Agent to avoid being blocked by basic filters
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36"
    })

    success = 0
    offline_log_path = Path(
        os.getenv("OFFLINE_LOG_CSV", "data/metadata/offline_events.csv")
    )
    ensure_dir(offline_log_path.parent)
    if not offline_log_path.exists():
        with offline_log_path.open("w", encoding="utf-8") as f:
            f.write("timestamp,camera_id,size_bytes,path\n")
    for idx, cam_id in enumerate(camera_ids, start=1):
        result = download_image(session, base_url, cam_id, out_root)
        if result:
            success += 1
            saved_path, size_bytes = result
            print(f"[{idx}/{len(camera_ids)}] Saved {saved_path} ({size_bytes} bytes)")
            if size_bytes < 5 * 1024:
                print(f"Camera OFFLINE detected: {cam_id} (size {size_bytes} bytes)")
                with offline_log_path.open("a", encoding="utf-8") as f:
                    f.write(f"{datetime.now().isoformat()},{cam_id},{size_bytes},{saved_path}\n")
        else:
            print(f"[{idx}/{len(camera_ids)}] Skipped {cam_id}")
        # Small delay to be polite to the server
        time.sleep(0.2)

    print(
        f"Done. {success}/{len(camera_ids)} images saved under {out_root} "
        "with camera/date partitioning."
    )


if __name__ == "__main__":
    main()
