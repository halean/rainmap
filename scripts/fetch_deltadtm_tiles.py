"""
Pulls the two Ho Chi Minh City tiles out of DeltaDTM's 17 GB Asia zip without downloading it.

Plain Python 3, standard library only, so it runs on any machine that can reach data.4tu.nl --
which this server, on 1 Oct 2026, could not (refused, apparently for cloud addresses):

    python3 fetch_deltadtm_tiles.py [ASIA_ZIP_URL] [OUT_DIR]

ASIA_ZIP_URL defaults to DeltaDTM v1.1's Asia.zip; for a newer version, copy the Asia.zip link
from https://data.4tu.nl/datasets/1da2e70f-6c4d-4b03-86bd-b53e789cc629. Reads the zip's index from
its end and then only the two members, in a handful of large range requests -- small ones got this
server refused -- and checks each member's CRC. Copy the results to the server's
data/derived/dem/src/, then run scripts/build_dem.py.
"""

import io
import sys
import urllib.request
import zipfile
from pathlib import Path

DEFAULT_URL = "https://data.4tu.nl/file/1da2e70f-6c4d-4b03-86bd-b53e789cc629/672eba4c-1334-44c6-8119-8879ded25912"
TILES = ["N10E106", "N11E106"]  # 10-12 N, 106-107 E: the city, Can Gio and the Thu Duc hills
CHUNK = 16 << 20


class RangeFile(io.RawIOBase):
    def __init__(self, url):
        self.url, self.pos, self.requests = url, 0, 0
        with urllib.request.urlopen(self._req(0, 0), timeout=60) as r:
            self.size = int(r.headers["Content-Range"].split("/")[-1])

    def _req(self, start, end):
        self.requests += 1
        return urllib.request.Request(self.url, headers={"Range": f"bytes={start}-{end}", "User-Agent": "deltadtm-tiles/1"})

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def readinto(self, b):
        if self.pos >= self.size:
            return 0
        n = min(len(b), self.size - self.pos)
        end = self.pos + n - 1
        with urllib.request.urlopen(self._req(self.pos, end), timeout=300) as r:
            if r.status != 206 or not r.headers.get("Content-Range", "").startswith(f"bytes {self.pos}-{end}/"):
                raise IOError(f"server did not honour range {self.pos}-{end} (status {r.status})")
            data = r.read()
        if len(data) != n:
            raise IOError(f"short read: {len(data)} of {n}")
        b[:n] = data
        self.pos += n
        return n


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    out = Path(sys.argv[2] if len(sys.argv) > 2 else ".")
    out.mkdir(parents=True, exist_ok=True)
    raw = RangeFile(url)
    z = zipfile.ZipFile(io.BufferedReader(raw, buffer_size=CHUNK))
    for tile in TILES:
        names = [n for n in z.namelist() if tile in n and n.endswith(".tif")]
        if not names:
            sys.exit(f"no {tile} tile in this zip")
        name = names[0]
        (out / Path(name).name).write_bytes(z.read(name))  # zipfile verifies the CRC
        print(f"{Path(name).name}: {z.getinfo(name).file_size / 1e6:.1f} MB")
    print(f"done in {raw.requests} requests; copy the .tif files to data/derived/dem/src/ on the server")


if __name__ == "__main__":
    main()
