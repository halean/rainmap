import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LOG_DIR = REPO / "logs"

# Logs live inside the project (on the large disk) rather than in /tmp: these are
# long-running unattended services, so their logs must outlive whatever shell
# happened to start them, and must not accumulate on the space-constrained root disk.
MAX_BYTES = 5_000_000
BACKUP_COUNT = 3


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:  # idempotent: re-importing must not stack duplicate handlers
        return logger

    LOG_DIR.mkdir(exist_ok=True)
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter(
        "%(asctime)s %(levelname)-7s %(message)s", datefmt="%Y-%m-%dT%H:%M:%S%z"
    )

    file_handler = RotatingFileHandler(
        LOG_DIR / f"{name}.log",
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(fmt)
    logger.addHandler(file_handler)

    # Keep stdout too, so `nohup ... &` output and `docker logs`-style tailing still work.
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(fmt)
    logger.addHandler(stream_handler)

    return logger
