"""Build museum textures and a manifest from the coolimages folder.

Usage:
    python tools/build_assets.py [SOURCE_DIR]

SOURCE_DIR defaults to $COOLIMAGES_DIR, then ~/OneDrive/Pictures/coolimages.
Outputs downscaled copies to content/art/ and writes content/manifest.json.
Rerun whenever images are added; uncatalogued images appear on the
Rotunda's "New Acquisitions" easels. tools/publish_content.py uploads the
public subset (see content-policy.json) to the VPS.
"""
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = Path.home() / "OneDrive" / "Pictures" / "coolimages"
OUT = ROOT / "content" / "art"
MAX_EDGE = 1536
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def flatten(im):
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        return bg
    return im.convert("RGB")


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(os.environ.get("COOLIMAGES_DIR", DEFAULT_SRC))
    if not src.is_dir():
        sys.exit(f"Source folder not found: {src}")
    OUT.mkdir(parents=True, exist_ok=True)

    items = []
    for path in sorted(src.iterdir()):
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
        if path.suffix.lower() == ".png":
            out = OUT / f"{path.stem}.png"
            im.save(out, optimize=True)
        else:
            out = OUT / f"{path.stem}.jpg"
            im.save(out, quality=88, optimize=True, progressive=True)
        items.append({
            "id": path.stem,
            "file": f"content/art/{out.name}",
            "width": width,
            "height": height,
            "saved": datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="minutes"),
        })

    items.sort(key=lambda item: item["saved"])
    keep = {Path(item["file"]).name for item in items}
    for stale in OUT.iterdir():
        if stale.name not in keep:
            stale.unlink()

    manifest = {"built": datetime.now().isoformat(timespec="seconds"), "count": len(items), "items": items}
    (ROOT / "content" / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    # Curatorial data files are owned by tools/curate.py; seed empty ones so the
    # site never requests a missing file.
    for name, empty in (("catalog.json", {}), ("credits.json", {}), ("layout.json", {"version": 1, "wings": {}})):
        target = ROOT / "content" / name
        if not target.exists():
            target.write_text(json.dumps(empty, indent=2), encoding="utf-8")
    print(f"Built {len(items)} images from {src} -> {OUT}")


if __name__ == "__main__":
    main()
