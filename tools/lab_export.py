"""Build the private notes lab's data: lab/works.json and lab/thumbs/.

Usage:
    python tools/lab_export.py

The lab (lab/index.html, published as a private claude.ai artifact) shows
every work with its current plaque so the collector can write notes and
approve new plaque text. This script merges the hand-written catalogue
(src/catalog.js), the curator's catalogue (data/catalog.json) and approved
overrides (data/overrides.json), and writes 768 px thumbnails from content/.
Works withheld by content-policy.json get an entry but no image. Both
outputs are gitignored (third-party art); republish the artifact with them.
"""
import json
import shutil
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "lab"
THUMBS = OUT / "thumbs"
EDGE = 768


def load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def js_catalogue():
    script = (
        "import {WORKS, WINGS} from './src/catalog.js';"
        "import {CREDITS} from './src/credits.js';"
        "console.log(JSON.stringify({WORKS, WINGS, CREDITS}));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(out.stdout)


def thumb(src, dest, edge=EDGE):
    with Image.open(src) as im:
        im = im.convert("RGB")
        im.thumbnail((edge, edge), Image.LANCZOS)
        im.save(dest, quality=82, optimize=True, progressive=True)


def credit_line(c):
    if not c:
        return ""
    who = c.get("creator") or c.get("handle") or ""
    return f"{who} ({c['handle']})" if c.get("handle") and c.get("creator") else who


def main():
    js = js_catalogue()
    works, wings, credits = js["WORKS"], js["WINGS"], js["CREDITS"]
    catalog = load(ROOT / "data" / "catalog.json", {})
    layout = load(ROOT / "data" / "layout.json", {"wings": {}})
    overrides = load(ROOT / "data" / "overrides.json", {})
    manifest = load(ROOT / "content" / "manifest.json", None)
    if manifest is None:
        raise SystemExit("content/manifest.json is missing; run python tools/build_assets.py first")
    excluded = set(load(ROOT / "content-policy.json", {}).get("exclude", {}))

    hung = {wid: key for key, w in layout["wings"].items() for wid in w.get("works", [])}
    wing_names = {k: w["name"] for k, w in wings.items()} | {k: w["name"] for k, w in layout["wings"].items()}

    if THUMBS.exists():
        shutil.rmtree(THUMBS)
    THUMBS.mkdir(parents=True)

    items = []
    for item in manifest["items"]:
        wid = item["id"]
        hand = works.get(wid)
        entry = dict(hand or catalog.get(wid) or {})
        entry.update(overrides.get(wid, {}))
        if hand:
            wing = hand["wing"]
        elif wid in hung:
            wing = hung[wid]
        elif entry:
            wing = "held"
        else:
            wing = "new"
        record = {
            "id": wid,
            "kind": "video" if "video" in item else "image",
            "duration": item.get("duration"),
            "saved": item["saved"],
            "wing": wing,
            "wingName": wing_names.get(wing, {"held": "On the easels", "new": "New acquisitions"}.get(wing, wing)),
            "handWritten": bool(hand),
            "title": entry.get("title", ""),
            "artist": entry.get("artist", ""),
            "medium": entry.get("medium", ""),
            "note": entry.get("note", ""),
            "credit": credit_line(credits.get(wid)),
            "withheld": wid in excluded,
            "thumb": None,
            "sheet": None,
        }
        if not record["withheld"]:
            thumb(ROOT / item["file"], THUMBS / f"{wid}.jpg")
            record["thumb"] = f"thumbs/{wid}.jpg"
            if item.get("sheet"):
                thumb(ROOT / item["sheet"], THUMBS / f"{wid}.sheet.jpg", edge=1200)
                record["sheet"] = f"thumbs/{wid}.sheet.jpg"
        items.append(record)

    items.sort(key=lambda r: r["saved"], reverse=True)
    wing_order = list(wings) + list(layout["wings"]) + ["held", "new"]
    used = {r["wing"] for r in items}
    payload = {
        "items": items,
        "wings": [{"key": k, "name": wing_names.get(k, {"held": "On the easels", "new": "New acquisitions"}.get(k, k))} for k in wing_order if k in used],
    }
    (OUT / "works.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    size = sum(f.stat().st_size for f in THUMBS.iterdir())
    print(f"Lab data: {len(items)} works, {sum(r['withheld'] for r in items)} withheld, thumbnails {size / 1e6:.1f} MB -> {OUT}")


if __name__ == "__main__":
    main()
