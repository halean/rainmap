import base64
import mimetypes
from pathlib import Path

import requests
from PIL import Image

from app import config

try:
    from google import genai
    from google.genai import types as google_types
except Exception:
    genai = None
    google_types = None


class InsightsService:
    """Image lookup + Gemma vision calls -- the shared pieces the rain pipeline needs."""

    def __init__(self) -> None:
        self.raw_root = config.RAW_OUTPUT_ROOT
        self.image_exts = config.IMAGE_EXTS

    def is_usable_image(self, path: Path) -> bool:
        try:
            if path.stat().st_size < config.OFFLINE_SIZE_THRESHOLD:
                return False
            with Image.open(path) as im:
                im.verify()
            return True
        except Exception:
            return False

    def latest_images_for_camera(self, camera_id: str, limit: int = 10) -> list[Path]:
        cam_dir = self.raw_root / camera_id
        if not cam_dir.exists() or not cam_dir.is_dir():
            return []
        files = sorted(
            [
                p
                for p in cam_dir.rglob("*")
                if p.is_file() and p.suffix.lower() in self.image_exts
            ]
        )
        files = [p for p in files if self.is_usable_image(p)]
        if not files:
            return []
        return files[-limit:]

    def google_generate_with_prompt(self, images: list[Path], prompt: str) -> str:
        if not config.GOOGLE_API_KEY:
            raise RuntimeError("GOOGLE_API_KEY is not set.")
        if not images:
            raise RuntimeError("No images to analyze.")

        if genai is not None and google_types is not None:
            try:
                client = genai.Client(api_key=config.GOOGLE_API_KEY)
                contents: list = [prompt]
                for img in images:
                    mime = mimetypes.guess_type(str(img))[0] or "image/jpeg"
                    contents.append(
                        google_types.Part.from_bytes(data=img.read_bytes(), mime_type=mime)
                    )
                response = client.models.generate_content(
                    model=config.GOOGLE_MODEL,
                    contents=contents,
                    config=google_types.GenerateContentConfig(
                        media_resolution=google_types.MediaResolution.MEDIA_RESOLUTION_HIGH,
                    ),
                )
                text = getattr(response, "text", None)
                if text:
                    return text.strip()
                raise RuntimeError(f"Unexpected SDK response: {response}")
            except Exception as e:
                print(f"google-genai SDK path failed, falling back to REST: {e}")

        parts = [{"text": prompt}]
        for img in images:
            mime = mimetypes.guess_type(str(img))[0] or "image/jpeg"
            encoded = base64.b64encode(img.read_bytes()).decode("utf-8")
            parts.append({"inline_data": {"mime_type": mime, "data": encoded}})

        body = {"contents": [{"role": "user", "parts": parts}]}
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{config.GOOGLE_MODEL}:generateContent?key={config.GOOGLE_API_KEY}"
        )
        resp = requests.post(url, json=body, timeout=config.GOOGLE_API_TIMEOUT_SEC)
        if resp.status_code >= 400:
            raise RuntimeError(f"Google API error {resp.status_code}: {resp.text[:500]}")
        payload = resp.json()
        try:
            return payload["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception:
            raise RuntimeError(f"Unexpected Google response: {payload}")
