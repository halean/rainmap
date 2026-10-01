"""The flood-risk map's endpoints: the packed terrain layers and their metadata."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import routes
from app.main import app


class FloodRiskRouteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        d = Path(self.temp.name)
        self.meta, self.elev, self.spill, self.cams = d / "m.json", d / "e.png", d / "s.png", d / "c.json"
        self.client = TestClient(app)
        for target, value in [("DEM_META_PATH", self.meta), ("FLOOD_CAMERAS_PATH", self.cams),
                              ("DEM_PNG_PATHS", {"elevation": self.elev, "spill": self.spill})]:
            p = patch.object(routes, target, value)
            p.start()
            self.addCleanup(p.stop)

    def test_page(self):
        r = self.client.get("/flood-risk")
        self.assertEqual(r.status_code, 200)
        self.assertIn("HCMC Flood Risk", r.text)

    def test_unbuilt_terrain_says_how_to_build_it(self):
        for url in ("/api/rain-map/dem", "/api/rain-map/dem/elevation.png"):
            r = self.client.get(url)
            self.assertEqual(r.status_code, 404)
            self.assertIn("build_dem.py", r.json()["detail"])

    def test_only_known_layers_are_served(self):
        self.elev.write_bytes(b"\x89PNG")
        self.assertEqual(self.client.get("/api/rain-map/dem/elevation.png").status_code, 200)
        self.assertEqual(self.client.get("/api/rain-map/dem/hcmc_dem.png").status_code, 404)
        self.assertEqual(self.client.get("/api/rain-map/dem/..%2Fhcmc_dem.png").status_code, 404)

    def test_meta_carries_the_flood_cameras(self):
        self.meta.write_text(json.dumps({"width": 2, "height": 2}))
        self.cams.write_text(json.dumps({"cameras": [
            {"camera_id": "a", "name": "TL43", "lat": 10.87, "lon": 106.77, "score": 6, "why": ["x"]}]}))
        got = self.client.get("/api/rain-map/dem").json()
        self.assertEqual(got["cameras"], [{"camera_id": "a", "name": "TL43", "lat": 10.87, "lon": 106.77, "why": ["x"]}])


if __name__ == "__main__":
    unittest.main()
