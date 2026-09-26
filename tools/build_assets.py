"""Build museum textures and a manifest from the coolimages folder.

Usage:
    python tools/build_assets.py [SOURCE_DIR]

SOURCE_DIR defaults to $COOLIMAGES_DIR, then ~/OneDrive/Pictures/coolimages.
Outputs downscaled WebP copies to content/art/ and writes content/manifest.json.
Rerun whenever images are added; uncatalogued images appear on the
Entrance Hall's "New acquisitions" easels. tools/publish_content.py uploads the
public subset (see content-policy.json) to the VPS.

Images become <id>.webp (max edge 1536) and <id>.sm.webp (max edge 800, for
phones): lossy for photos, lossless for PNG sources (screenshots and pixel
art). Each manifest item also carries `color` (its average colour) and
`blur` (a tiny WebP as a data URI), which the site shows until the real
image has loaded.

Videos (needs ffmpeg and ffprobe on PATH) become a web-friendly H.264 MP4
(<id>.mp4, max edge 960, 30 fps, capped at 1.2 Mbit/s), a poster frame
(<id>.webp, the texture shown until the video plays) and a 3x2 contact sheet
for the curator (<id>.sheet.jpg).

Outputs are reused until their source changes or the encoding settings do
(IMAGE_VERSION, VIDEO_VERSION; the record is content/.build-cache.json).

The same picture saved twice under different names goes in once
(tools/dupes.py compares the pictures themselves, not the names).
"""
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from PIL import Image

import dupes
from curate import handwritten_ids

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = Path.home() / "OneDrive" / "Pictures" / "coolimages"
OUT = ROOT / "content" / "art"
MAX_EDGE = 1536
SMALL_EDGE = 800  # phones load <id>.sm.* instead
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}
VIDEO_EDGE = 960
WEBP_QUALITY = 82
IMAGE_VERSION = 2  # bump to re-encode every image
VIDEO_VERSION = 2  # bump to re-encode every video


def flatten(im):
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        return bg
    return im.convert("RGB")


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    info = json.loads(out.stdout)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    audio = any(s["codec_type"] == "audio" for s in info["streams"])
    return video["width"], video["height"], float(info["format"]["duration"]), audio


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def save_webp(im, path, lossless=False):
    if lossless:
        im.save(path, "WEBP", lossless=True, quality=80, method=4)
    else:
        im.save(path, "WEBP", quality=WEBP_QUALITY, method=4)


def placeholder(im):
    """Average colour and a tiny blurred preview (data URI) of an image."""
    tiny = im.copy()
    tiny.thumbnail((24, 24), Image.LANCZOS)
    r, g, b = tiny.resize((1, 1), Image.BOX).getpixel((0, 0))[:3]
    buf = io.BytesIO()
    tiny.save(buf, "WEBP", quality=50)
    return {"color": f"#{r:02x}{g:02x}{b:02x}", "blur": "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()}


def stamp(path):
    st = path.stat()
    return f"{int(st.st_mtime)}:{st.st_size}"


def build_image(path, cache):
    """Encode one image (or reuse the last encode); returns its manifest fields."""
    out, sm = OUT / f"{path.stem}.webp", OUT / f"{path.stem}.sm.webp"
    key = f"image:{path.name}"
    hit = cache.get(key)
    if hit and hit.get("v") == IMAGE_VERSION and hit.get("src") == stamp(path) and out.exists() and sm.exists():
        return hit["fields"]
    with Image.open(path) as im:
        im.load()
        width, height = im.size
        im = flatten(im)
    scale = min(1.0, MAX_EDGE / max(width, height))
    if scale < 1.0:
        im = im.resize((round(width * scale), round(height * scale)), Image.LANCZOS)
    small = im.copy()
    small.thumbnail((SMALL_EDGE, SMALL_EDGE), Image.LANCZOS)
    # PNG sources are mostly screenshots and pixel art: keep them lossless.
    lossless = path.suffix.lower() == ".png"
    save_webp(im, out, lossless)
    save_webp(small, sm, lossless)
    fields = {"file": f"content/art/{out.name}", "small": f"content/art/{sm.name}", "width": width, "height": height, **placeholder(small)}
    cache[key] = {"v": IMAGE_VERSION, "src": stamp(path), "fields": fields}
    return fields


def build_video(path, cache):
    """Transcode one video (or reuse the last transcode); returns its manifest fields."""
    mp4, poster, sheet = OUT / f"{path.stem}.mp4", OUT / f"{path.stem}.webp", OUT / f"{path.stem}.sheet.jpg"
    key = f"video:{path.name}"
    hit = cache.get(key)
    if hit and hit.get("v") == VIDEO_VERSION and hit.get("src") == stamp(path) and all(f.exists() for f in (mp4, poster, sheet)):
        return hit["fields"]
    box = f"scale=w='min({VIDEO_EDGE},iw)':h='min({VIDEO_EDGE},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
    ffmpeg(
        "-i", str(path), "-map", "0:v:0", "-map", "0:a:0?", "-vf", box, "-fpsmax", "30",
        "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-maxrate", "1200k", "-bufsize", "2400k", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "80k", "-ac", "2", "-movflags", "+faststart", str(mp4),
    )
    width, height, duration, audio = probe(mp4)
    with tempfile.TemporaryDirectory() as tmp:
        frame = Path(tmp) / "poster.png"
        ffmpeg("-ss", f"{duration * 0.2:.2f}", "-i", str(mp4), "-frames:v", "1", str(frame))
        with Image.open(frame) as im:
            im = im.convert("RGB")
            save_webp(im, poster)
            blur = placeholder(im)
    ffmpeg("-i", str(mp4), "-vf", f"fps=6/{duration:.3f},scale=400:-2,tile=3x2", "-frames:v", "1", "-q:v", "4", str(sheet))
    fields = {
        "file": f"content/art/{poster.name}",
        "video": f"content/art/{mp4.name}",
        "sheet": f"content/art/{sheet.name}",
        "width": width,
        "height": height,
        "duration": round(duration, 1),
        "audio": audio,
        **blur,
    }
    cache[key] = {"v": VIDEO_VERSION, "src": stamp(path), "fields": fields}
    return fields


def read_note(path):
    note_path = path.with_suffix(".json")
    try:
        note = json.loads(note_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    return note if isinstance(note, dict) and note.get("version") == 1 else None


def note_saved(note):
    try:
        when = datetime.fromisoformat(str(note["savedAt"]).replace("Z", "+00:00"))
    except (TypeError, KeyError, ValueError):
        return None
    return when.astimezone().replace(tzinfo=None).isoformat(timespec="minutes")


def public_source(note):
    """The post a work was saved from, as the site and the curator use it."""
    post = note["post"]
    author = post.get("author") or {}
    return {
        "url": post.get("url"),
        "postedAt": post.get("postedAt"),
        "author": {"name": author.get("name", ""), "handle": author.get("handle", ""), "url": author.get("url", "")},
        "text": post.get("text", ""),
        "alt": post.get("alt", ""),
        "match": note.get("match", "none"),
    }


def second_copies(src):
    """Files that are the same picture as another in the folder (tools/dupes.py).

    Of each group the museum keeps the copy the catalogue already describes,
    else the largest; returns {left-out name: kept name}."""
    index = dupes.Index(src).refresh()
    index.save()
    known = handwritten_ids()
    try:
        known |= set(json.loads((ROOT / "data" / "catalog.json").read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    skip = {}
    for group in index.groups():
        keep = next((name for name in group if Path(name).stem in known), group[0])
        skip.update({name: keep for name in group if name != keep})
    return skip


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(os.environ.get("COOLIMAGES_DIR", DEFAULT_SRC))
    if not src.is_dir():
        sys.exit(f"Source folder not found: {src}")
    OUT.mkdir(parents=True, exist_ok=True)

    items = []
    sources = {}
    has_ffmpeg = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
    cache_path = OUT.parent / ".build-cache.json"
    try:
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    skip = second_copies(src)
    for path in sorted(src.iterdir()):
        if path.name in skip:
            print(f"Skipping {path.name}: same picture as {skip[path.name]}")
            continue
        # The collector extension's note (<stem>.json beside the file) knows
        # when it was really saved; OneDrive re-stamps file times.
        note = read_note(path)
        saved = note_saved(note) or datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="minutes")
        if note and note.get("post"):
            sources[path.stem] = public_source(note)
        if path.suffix.lower() in VIDEO_EXTENSIONS:
            if not has_ffmpeg:
                print(f"Skipping {path.name}: ffmpeg/ffprobe not found")
                continue
            items.append({"id": path.stem, **build_video(path, cache), "saved": saved})
        elif path.suffix.lower() in EXTENSIONS:
            items.append({"id": path.stem, **build_image(path, cache), "saved": saved})

    items.sort(key=lambda item: item["saved"])
    keep = {Path(item[key]).name for item in items for key in ("file", "small", "video", "sheet") if key in item}
    for stale in OUT.iterdir():
        if stale.name not in keep:
            stale.unlink()

    cache_path.write_text(json.dumps(cache), encoding="utf-8")
    manifest = {"built": datetime.now().isoformat(timespec="seconds"), "count": len(items), "items": items}
    (ROOT / "content" / "sources.json").write_text(json.dumps(sources, indent=2, ensure_ascii=False), encoding="utf-8")
    (ROOT / "content" / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    videos = sum(1 for item in items if "video" in item)
    print(f"Built {len(items) - videos} images and {videos} videos from {src} -> {OUT}")


if __name__ == "__main__":
    main()
