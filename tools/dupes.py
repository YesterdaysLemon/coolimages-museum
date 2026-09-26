"""Spot the same picture saved twice, whatever its file name.

A fingerprint is two 64-bit difference hashes (horizontal and vertical
brightness gradients of a 9x8 greyscale thumbnail), so it survives
resizing, re-compression and format changes. Two files match when their
fingerprints differ in few bits and their shapes agree, or when their bytes
are identical. Videos are fingerprinted from a frame (ffmpeg).

Used by the collector helper (before a save lands in the folder), by
tools/ingest_inbox.py and by tools/build_assets.py (which keeps one copy of
each picture in the museum).

Usage: python tools/dupes.py [FOLDER]   (lists duplicate groups)
"""
import hashlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

IMAGES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEOS = {".mp4", ".mov", ".m4v", ".webm"}
MAX_BITS = 10  # of 128
MAX_ASPECT = 0.04
CACHE = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "CoolimagesCollector" / "fingerprints.json"


def _dhash(img):
    g = img.convert("L")
    h = g.resize((9, 8), Image.LANCZOS)
    v = g.resize((8, 9), Image.LANCZOS)
    flat = lambda im: list(getattr(im, "get_flattened_data", im.getdata)())  # noqa: E731
    hp, vp = flat(h), flat(v)
    bits = 0
    for y in range(8):
        for x in range(8):
            bits = (bits << 1) | (hp[y * 9 + x] > hp[y * 9 + x + 1])
    for y in range(8):
        for x in range(8):
            bits = (bits << 1) | (vp[y * 8 + x] > vp[(y + 1) * 8 + x])
    return bits


def fingerprint_image(data):
    """Fingerprint of image bytes (or an open PIL image)."""
    img = data if isinstance(data, Image.Image) else Image.open(io.BytesIO(data))
    img.load()
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    return {"fp": f"{_dhash(img):032x}", "w": img.width, "h": img.height}


def fingerprint_video(path):
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", "1", "-i", str(path), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
        capture_output=True,
    )
    if out.returncode or not out.stdout:
        return None
    return fingerprint_image(out.stdout)


def fingerprint_file(path):
    path = Path(path)
    ext = path.suffix.lower()
    data = path.read_bytes()
    base = {"sha": hashlib.sha256(data).hexdigest(), "kind": "video" if ext in VIDEOS else "image"}
    try:
        fp = fingerprint_video(path) if ext in VIDEOS else fingerprint_image(data)
    except Exception:  # noqa: BLE001 - an unreadable file still has its sha
        fp = None
    return {**base, **(fp or {})}


def distance(a, b):
    return bin(int(a["fp"], 16) ^ int(b["fp"], 16)).count("1")


def same(a, b):
    """True when a and b look like the same picture (or are the same bytes)."""
    if a.get("sha") and a.get("sha") == b.get("sha"):
        return True
    if not a.get("fp") or not b.get("fp") or a.get("kind", "image") != b.get("kind", "image"):
        return False
    ra, rb = a["w"] / a["h"], b["w"] / b["h"]
    return abs(ra - rb) / max(ra, rb) <= MAX_ASPECT and distance(a, b) <= MAX_BITS


def add_also_posted(folder, stem, note):
    """Record another post of the same picture on <folder>/<stem>.json.

    The existing file keeps its note; the other post is listed under
    alsoPosted. With no note yet, this one becomes the file's note."""
    post = (note or {}).get("post")
    if not post or not post.get("url"):
        return
    path = Path(folder) / f"{stem}.json"
    try:
        existing = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        existing = None
    if not isinstance(existing, dict) or existing.get("version") != 1:
        media = next((f.name for f in Path(folder).glob(f"{stem}.*") if f.suffix.lower() in IMAGES | VIDEOS), None)
        existing = {**note, "id": stem, "file": media}
    elif (existing.get("post") or {}).get("url") == post["url"]:
        return
    else:
        others = existing.setdefault("alsoPosted", [])
        if any(o.get("url") == post["url"] for o in others):
            return
        author = post.get("author") or {}
        others.append({"url": post["url"], "handle": author.get("handle", ""), "name": author.get("name", ""), "postedAt": post.get("postedAt"), "match": note.get("match")})
    path.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


class Index:
    """Fingerprints of a folder's media, cached by name, size and mtime."""

    def __init__(self, folder, cache=None):
        self.folder = Path(folder)
        self.cache = Path(cache or os.environ.get("COOLIMAGES_FINGERPRINTS") or CACHE)
        self.prefix = str(self.folder.resolve()).lower() + os.sep
        try:
            self.entries = json.loads(self.cache.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.entries = {}

    def refresh(self):
        seen = set()
        for path in self.folder.iterdir():
            if not path.is_file() or path.suffix.lower() not in IMAGES | VIDEOS:
                continue
            st = path.stat()
            key = str(path.resolve()).lower()
            seen.add(key)
            e = self.entries.get(key)
            if not e or e.get("size") != st.st_size or e.get("mtime") != int(st.st_mtime):
                self.entries[key] = {**fingerprint_file(path), "name": path.name, "size": st.st_size, "mtime": int(st.st_mtime)}
        self.entries = {k: v for k, v in self.entries.items() if k in seen or not k.startswith(self.prefix)}
        return self

    def save(self):
        self.cache.parent.mkdir(parents=True, exist_ok=True)
        self.cache.write_text(json.dumps(self.entries), encoding="utf-8")

    def mine(self):
        """This folder's entries (the cache holds other folders' too)."""
        return [e for k, e in self.entries.items() if k.startswith(self.prefix) and (self.folder / e["name"]).exists()]

    def find(self, fp, exclude=None):
        """(name, bits apart) of the file here that looks like fp, closest first."""
        best = None
        for e in self.mine():
            if e["name"] == exclude:
                continue
            if same(fp, e):
                d = 0 if fp.get("sha") == e.get("sha") else distance(fp, e)
                if best is None or d < best[1]:
                    best = (e["name"], d)
        return best

    def groups(self):
        """Lists of names that are the same picture, largest file first."""
        items = sorted(self.mine(), key=lambda e: e["name"])
        seen, out = set(), []
        for i, a in enumerate(items):
            if a["name"] in seen:
                continue
            group = [a] + [b for b in items[i + 1:] if b["name"] not in seen and same(a, b)]
            if len(group) > 1:
                seen.update(e["name"] for e in group)
                group.sort(key=lambda e: (-(e.get("w", 0) * e.get("h", 0)), e["name"]))
                out.append([e["name"] for e in group])
        return out


def main():
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(os.environ.get("COOLIMAGES_DIR", Path.home() / "OneDrive" / "Pictures" / "coolimages"))
    index = Index(folder).refresh()
    index.save()
    groups = index.groups()
    print(f"{len(index.mine())} files fingerprinted, {len(groups)} duplicate groups")
    for g in groups:
        print("  same picture:", ", ".join(g))


if __name__ == "__main__":
    main()
