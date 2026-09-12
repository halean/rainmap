import threading
import time
import uuid
from datetime import datetime, timezone

import requests

from app import config
from app.models import FetchJobRecord, JobState
from src.fetch.check import download_image, ensure_dir, load_camera_ids, resolve_cameras_csv


class FetchJobManager:
    def __init__(self) -> None:
        self.state = JobState()
        self._history: list[FetchJobRecord] = []
        self._history_by_id: dict[str, FetchJobRecord] = {}

    def _trim_history_locked(self) -> None:
        if len(self._history) <= config.FETCH_KEEP_LAST:
            return
        over = len(self._history) - config.FETCH_KEEP_LAST
        for _ in range(over):
            old = self._history.pop(0)
            self._history_by_id.pop(old.job_id, None)

    def start(self) -> dict:
        with self.state.lock:
            if self.state.status == "running":
                raise RuntimeError("A fetch job is already running.")
            now_iso = datetime.now(timezone.utc).isoformat()
            new_job_id = uuid.uuid4().hex[:12]
            self.state = JobState(
                job_id=new_job_id,
                status="running",
                started_at=now_iso,
            )
            rec = FetchJobRecord(
                job_id=new_job_id,
                job_type="download_fetch",
                status="running",
                description="Download traffic camera snapshots from cameras_master.csv",
                created_at=now_iso,
                started_at=now_iso,
                result_summary="Started",
            )
            self._history.append(rec)
            self._history_by_id[new_job_id] = rec
            self._trim_history_locked()
            worker = threading.Thread(target=self._run, daemon=True)
            self.state.worker = worker
            worker.start()
            return self.snapshot()

    def stop(self) -> dict:
        with self.state.lock:
            if self.state.status != "running":
                raise RuntimeError("No running job to stop.")
            self.state.stop_event.set()
        return self.snapshot()

    def snapshot(self) -> dict:
        with self.state.lock:
            self._refresh_derived_metrics_locked()
            return {
                "job_id": self.state.job_id,
                "status": self.state.status,
                "started_at": self.state.started_at,
                "finished_at": self.state.finished_at,
                "total_cameras": self.state.total_cameras,
                "processed": self.state.processed,
                "online": self.state.online,
                "offline": self.state.offline,
                "failed": self.state.failed,
                "bytes_downloaded": self.state.bytes_downloaded,
                "current_camera_id": self.state.current_camera_id,
                "error": self.state.error,
                "elapsed_seconds": round(self.state.elapsed_seconds, 2),
                "throughput_cameras_per_min": round(self.state.throughput_cameras_per_min, 2),
                "throughput_images_per_sec": round(self.state.throughput_images_per_sec, 2),
                "completion_pct": round(
                    (self.state.processed / self.state.total_cameras) * 100.0, 2
                )
                if self.state.total_cameras
                else 0.0,
            }

    def _refresh_derived_metrics_locked(self) -> None:
        if not self.state.started_at:
            self.state.elapsed_seconds = 0.0
            self.state.throughput_cameras_per_min = 0.0
            self.state.throughput_images_per_sec = 0.0
            return
        start_dt = datetime.fromisoformat(self.state.started_at)
        end_dt = (
            datetime.fromisoformat(self.state.finished_at)
            if self.state.finished_at
            else datetime.now(timezone.utc)
        )
        elapsed = max((end_dt - start_dt).total_seconds(), 1e-9)
        self.state.elapsed_seconds = elapsed
        self.state.throughput_images_per_sec = self.state.processed / elapsed
        self.state.throughput_cameras_per_min = (self.state.processed / elapsed) * 60.0

    def _run(self) -> None:
        try:
            ensure_dir(config.RAW_OUTPUT_ROOT)
            ensure_dir(config.OFFLINE_LOG_CSV.parent)
            if not config.OFFLINE_LOG_CSV.exists():
                config.OFFLINE_LOG_CSV.write_text(
                    "timestamp,camera_id,size_bytes,path\n", encoding="utf-8"
                )

            cameras_csv = resolve_cameras_csv()
            camera_ids = load_camera_ids(cameras_csv)

            with self.state.lock:
                self.state.total_cameras = len(camera_ids)
                self.state.processed = 0
                self.state.online = 0
                self.state.offline = 0
                self.state.failed = 0

            session = requests.Session()
            session.headers.update(
                {
                    "User-Agent": (
                        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/118 Safari/537.36"
                    )
                }
            )

            sweep_no = 0
            while True:
                with self.state.lock:
                    if self.state.stop_event.is_set():
                        self.state.status = "stopped"
                        self.state.finished_at = datetime.now(timezone.utc).isoformat()
                        self.state.current_camera_id = None
                        rec = self._history_by_id.get(self.state.job_id or "")
                        if rec:
                            rec.status = "stopped"
                            rec.finished_at = self.state.finished_at
                            rec.result_summary = (
                                f"Stopped during sweep {sweep_no} at "
                                f"{self.state.processed}/{self.state.total_cameras} "
                                f"(online {self.state.online}, offline {self.state.offline}, failed {self.state.failed})"
                            )
                        return

                    sweep_no += 1
                    self.state.processed = 0
                    self.state.online = 0
                    self.state.offline = 0
                    self.state.failed = 0
                    rec = self._history_by_id.get(self.state.job_id or "")
                    if rec:
                        rec.result_summary = f"Running sweep {sweep_no}..."

                # Pace the pass across SWEEP_INTERVAL_SEC instead of running flat out.
                sweep_started = time.monotonic()
                slot_sec = (
                    config.SWEEP_INTERVAL_SEC / len(camera_ids) if camera_ids else 0.0
                )

                for cam_index, cam_id in enumerate(camera_ids):
                    with self.state.lock:
                        if self.state.stop_event.is_set():
                            self.state.status = "stopped"
                            self.state.finished_at = datetime.now(timezone.utc).isoformat()
                            self.state.current_camera_id = None
                            rec = self._history_by_id.get(self.state.job_id or "")
                            if rec:
                                rec.status = "stopped"
                                rec.finished_at = self.state.finished_at
                                rec.result_summary = (
                                    f"Stopped during sweep {sweep_no} at "
                                    f"{self.state.processed}/{self.state.total_cameras} "
                                    f"(online {self.state.online}, offline {self.state.offline}, failed {self.state.failed})"
                                )
                            return
                        self.state.current_camera_id = cam_id

                    result = download_image(
                        session=session,
                        base_url=config.BASE_URL,
                        camera_id=cam_id,
                        out_root=config.RAW_OUTPUT_ROOT,
                    )

                    with self.state.lock:
                        self.state.processed += 1
                        if result is None:
                            self.state.failed += 1
                        else:
                            saved_path, size_bytes = result
                            self.state.bytes_downloaded += size_bytes
                            if size_bytes < config.OFFLINE_SIZE_THRESHOLD:
                                self.state.offline += 1
                                with config.OFFLINE_LOG_CSV.open("a", encoding="utf-8") as f:
                                    f.write(
                                        f"{datetime.now(timezone.utc).isoformat()},{cam_id},{size_bytes},{saved_path}\n"
                                    )
                            else:
                                self.state.online += 1
                        self._refresh_derived_metrics_locked()
                        rec = self._history_by_id.get(self.state.job_id or "")
                        if rec:
                            rec.result_summary = (
                                f"Sweep {sweep_no}: {self.state.processed}/{self.state.total_cameras} "
                                f"(online {self.state.online}, offline {self.state.offline}, failed {self.state.failed})"
                            )

                    # Hold this camera's slot in the paced window. If the source site is
                    # already slow enough that we've overrun the slot, don't wait at all --
                    # never make a bad day worse by adding delay on top of it.
                    next_slot_at = sweep_started + (cam_index + 1) * slot_sec
                    remaining = next_slot_at - time.monotonic()
                    # Wait on the stop event rather than sleeping, so a stop request is
                    # honoured immediately instead of sitting out the pacing delay.
                    self.state.stop_event.wait(max(config.FETCH_DELAY_SEC, remaining))

                with self.state.lock:
                    self.state.current_camera_id = None
                    rec = self._history_by_id.get(self.state.job_id or "")
                    if rec:
                        rec.result_summary = (
                            f"Completed sweep {sweep_no}: {self.state.processed}/{self.state.total_cameras} "
                            f"(online {self.state.online}, offline {self.state.offline}, failed {self.state.failed})"
                        )
        except Exception as e:
            with self.state.lock:
                self.state.status = "failed"
                self.state.error = str(e)
                self.state.finished_at = datetime.now(timezone.utc).isoformat()
                self.state.current_camera_id = None
                self._refresh_derived_metrics_locked()
                rec = self._history_by_id.get(self.state.job_id or "")
                if rec:
                    rec.status = "failed"
                    rec.error = str(e)
                    rec.finished_at = self.state.finished_at
                    rec.result_summary = str(e)[:220]

    def jobs_table_items(self) -> list[dict]:
        with self.state.lock:
            out: list[dict] = []
            for rec in reversed(self._history):
                out.append(
                    {
                        "job_id": rec.job_id,
                        "job_type": rec.job_type,
                        "status": rec.status,
                        "description": rec.description,
                        "created_at": rec.created_at,
                        "started_at": rec.started_at,
                        "finished_at": rec.finished_at,
                        "result_summary": rec.result_summary,
                        "result_full": None,
                        "error": rec.error,
                        "metadata": rec.metadata,
                    }
                )
            return out
