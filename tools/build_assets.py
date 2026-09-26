"""Build museum textures and a manifest from the coolimages folder.

Usage:
    python tools/build_assets.py [SOURCE_DIR]

SOURCE_DIR defaults to $COOLIMAGES_DIR, then ~/OneDrive/Pictures/coolimages.
Outputs downscaled copies to content/art/ and writes content/manifest.json.
Rerun whenever images are added; uncatalogued images appear on the
Rotunda's "New Acquisitions" easels. tools/publish_content.py uploads the
public subset (see content-policy.json) to the VPS.

Videos (needs ffmpeg and ffprobe on PATH) become a web-friendly H.264 MP4
(<id>.mp4, max edge 960, 30 fps, capped at 2 Mbit/s), a poster frame (<id>.jpg, the texture shown
until the video plays) and a 3x2 contact sheet for the curator
(<id>.sheet.jpg). Transcodes are cached until the source changes.
"""
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = Path.home() / "OneDrive" / "Pictures" / "coolimages"
OUT = ROOT / "content" / "art"
MAX_EDGE = 1536
SMALL_EDGE = 800  # phones load <id>.sm.* instead
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}
VIDEO_EDGE = 960


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


def build_video(path):
    """Transcode one video; returns its manifest fields."""
    mp4, poster, sheet = OUT / f"{path.stem}.mp4", OUT / f"{path.stem}.jpg", OUT / f"{path.stem}.sheet.jpg"
    fresh = all(f.exists() and f.stat().st_mtime >= path.stat().st_mtime for f in (mp4, poster, sheet))
    if not fresh:
        box = f"scale=w='min({VIDEO_EDGE},iw)':h='min({VIDEO_EDGE},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
        ffmpeg(
            "-i", str(path), "-map", "0:v:0", "-map", "0:a:0?", "-vf", box, "-fpsmax", "30",
            "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-maxrate", "2M", "-bufsize", "4M", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", str(mp4),
        )
        duration = probe(mp4)[2]
        ffmpeg("-ss", f"{duration * 0.2:.2f}", "-i", str(mp4), "-frames:v", "1", "-q:v", "3", str(poster))
        ffmpeg("-i", str(mp4), "-vf", f"fps=6/{duration:.3f},scale=400:-2,tile=3x2", "-frames:v", "1", "-q:v", "4", str(sheet))
    width, height, duration, audio = probe(mp4)
    return {
        "file": f"content/art/{poster.name}",
        "video": f"content/art/{mp4.name}",
        "sheet": f"content/art/{sheet.name}",
        "width": width,
        "height": height,
        "duration": round(duration, 1),
        "audio": audio,
    }


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(os.environ.get("COOLIMAGES_DIR", DEFAULT_SRC))
    if not src.is_dir():
        sys.exit(f"Source folder not found: {src}")
    OUT.mkdir(parents=True, exist_ok=True)

    items = []
    has_ffmpeg = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
    for path in sorted(src.iterdir()):
        saved = datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="minutes")
        if path.suffix.lower() in VIDEO_EXTENSIONS:
            if not has_ffmpeg:
                print(f"Skipping {path.name}: ffmpeg/ffprobe not found")
                continue
            items.append({"id": path.stem, **build_video(path), "saved": saved})
            continue
        if path.suffix.lower() not in EXTENSIONS:
            continue
        with Image.open(path) as im:
            im.load()
            width, height = im.size
            im = flatten(im)
        scale = min(1.0, MAX_EDGE / max(width, height))
        if scale < 1.0:
            im = im.resize((round(width * scale), round(height * scale)), Image.LANCZOS)
        # PNG sources are mostly screenshots and pixel art: keep them lossless.
        small = im.copy()
        small.thumbnail((SMALL_EDGE, SMALL_EDGE), Image.LANCZOS)
        if path.suffix.lower() == ".png":
            out = OUT / f"{path.stem}.png"
            sm = OUT / f"{path.stem}.sm.png"
            im.save(out, optimize=True)
            small.save(sm, optimize=True)
        else:
            out = OUT / f"{path.stem}.jpg"
            sm = OUT / f"{path.stem}.sm.jpg"
            im.save(out, quality=88, optimize=True, progressive=True)
            small.save(sm, quality=84, optimize=True, progressive=True)
        items.append({
            "id": path.stem,
            "file": f"content/art/{out.name}",
            "small": f"content/art/{sm.name}",
            "width": width,
            "height": height,
            "saved": saved,
        })

    items.sort(key=lambda item: item["saved"])
    keep = {Path(item[key]).name for item in items for key in ("file", "small", "video", "sheet") if key in item}
    for stale in OUT.iterdir():
        if stale.name not in keep:
            stale.unlink()

    manifest = {"built": datetime.now().isoformat(timespec="seconds"), "count": len(items), "items": items}
    (ROOT / "content" / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    videos = sum(1 for item in items if "video" in item)
    print(f"Built {len(items) - videos} images and {videos} videos from {src} -> {OUT}")


if __name__ == "__main__":
    main()
