import threading
from dataclasses import dataclass, field


@dataclass
class JobState:
    job_id: str | None = None
    status: str = "idle"
    started_at: str | None = None
    finished_at: str | None = None
    total_cameras: int = 0
    processed: int = 0
    online: int = 0
    offline: int = 0
    failed: int = 0
    bytes_downloaded: int = 0
    current_camera_id: str | None = None
    error: str | None = None
    elapsed_seconds: float = 0.0
    throughput_cameras_per_min: float = 0.0
    throughput_images_per_sec: float = 0.0
    lock: threading.Lock = field(default_factory=threading.Lock)
    worker: threading.Thread | None = None
    stop_event: threading.Event = field(default_factory=threading.Event)


@dataclass
class FetchJobRecord:
    job_id: str
    job_type: str
    status: str
    description: str
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    result_summary: str | None = None
    error: str | None = None
    metadata: dict = field(default_factory=dict)


@dataclass
class AnalysisJob:
    job_id: str
    job_type: str
    status: str
    description: str
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    result_summary: str | None = None
    result_full: str | None = None
    error: str | None = None
    metadata: dict = field(default_factory=dict)
