import json
import os
from pathlib import Path


def write_json_atomic(path: Path, data) -> None:
    """Write JSON so no reader can ever observe a half-written file.

    rain_sample.json and annotator_state.json are written by both the annotator
    and the watchdog, and read by the web app, so a plain write_text -- which
    truncates the file first and then fills it -- can be caught mid-write. That
    failure is quiet rather than loud: load_json() treats a parse error as "no
    data" and returns the default, so a truncated rain_sample.json surfaces as a
    blank map instead of an exception.

    Two details that matter:
    - The temp file goes in the same directory, because os.replace is only
      atomic within a single filesystem.
    - Its name carries the pid, so the annotator and the watchdog writing the
      same path at the same moment cannot scribble over each other's temp file.
      Last writer still wins, which is inherent, but neither can corrupt.
    """
    tmp = path.with_suffix(f"{path.suffix}.{os.getpid()}.tmp")
    try:
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())  # rename is atomic, but the bytes must land first
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)  # no-op on success; clears the temp if we died mid-write
