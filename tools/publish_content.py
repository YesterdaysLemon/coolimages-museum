"""Publish the public content set to the VPS.

Usage:
    python tools/publish_content.py [--skip-build] [--dry-run]

Rebuilds textures (unless --skip-build), drops works listed in
content-policy.json, uploads the images, videos and manifest over SSH as a new release
directory and atomically repoints /srv/coolimages/content at it. Caddy serves
that directory at https://coolimages.alirezaafshan.com/content/. Curated text
lives in the repo (data/) and ships with the app, not here.

Videos are served from R2 by the coolimages-media Worker (media/worker.js),
not from the site: each is published as <id>.<first 8 hex of its SHA-256>.mp4,
the public manifest points at https://coolimages-media.alirezaafshan.com/,
and after the upload this asks the Worker to sync (it copies new videos from
the site into R2 and deletes ones the site no longer lists).

--pause-videos publishes with videos switched off: the museum shows its "the
server is super poor" notice in their place. Publish again without it to
switch them back on.

Environment: COOLIMAGES_SSH (default "vps-admin"), COOLIMAGES_REMOTE_BASE
(default "/srv/coolimages"), COOLIMAGES_MEDIA (default
"https://coolimages-media.alirezaafshan.com").
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
POLICY = ROOT / "content-policy.json"
REMOTE = os.environ.get("COOLIMAGES_SSH", "vps-admin")
REMOTE_BASE = os.environ.get("COOLIMAGES_REMOTE_BASE", "/srv/coolimages")
KEEP_RELEASES = 3
MEDIA = os.environ.get("COOLIMAGES_MEDIA", "https://coolimages-media.alirezaafshan.com").rstrip("/")


def sync_media():
    """Ask the media Worker to mirror the published videos into R2."""
    req = urllib.request.Request(f"{MEDIA}/sync", method="POST", headers={"User-Agent": "coolimages-publish"})
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            result = json.loads(res.read())
    except Exception as exc:  # noqa: BLE001 - the Worker's cron retries every 6 hours
        print(f"Media sync failed ({exc}); the Worker's 6-hourly sync will retry.")
        return
    print(f"Media: {result.get('videos')} videos in R2, added {len(result.get('added', []))}, removed {len(result.get('removed', []))}")
    if result.get("failed"):
        print("  not copied:", ", ".join(result["failed"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--skip-build", action="store_true", help="publish the existing content/ folder as-is")
    parser.add_argument("--dry-run", action="store_true", help="stage and report, but do not upload")
    parser.add_argument("--pause-videos", action="store_true", help="show the donate notice instead of videos")
    args = parser.parse_args()

    if not args.skip_build:
        subprocess.run([sys.executable, str(ROOT / "tools" / "build_assets.py")], check=True)

    excluded = set(json.loads(POLICY.read_text(encoding="utf-8")).get("exclude", {}))
    manifest = json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8"))
    items = [item for item in manifest["items"] if item["id"] not in excluded]
    withheld = sorted(excluded & {item["id"] for item in manifest["items"]})
    stamp = time.strftime("%Y%m%dT%H%M%S")

    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp) / stamp
        (stage / "art").mkdir(parents=True)
        public_items = []
        for item in items:
            # Videos also carry an MP4 and the curator's contact sheet.
            for key in ("file", "small", "sheet"):
                if key in item:
                    shutil.copy2(ROOT / item[key], stage / "art" / Path(item[key]).name)
            item = dict(item)
            if "video" in item:
                src = ROOT / item["video"]
                name = f"{item['id']}.{hashlib.sha256(src.read_bytes()).hexdigest()[:8]}.mp4"
                shutil.copy2(src, stage / "art" / name)
                item["video"] = f"{MEDIA}/{name}"
            public_items.append(item)
        items = public_items
        public = {"built": manifest.get("built"), "count": len(items), "items": items, "withheld": withheld}
        if args.pause_videos:
            public["videosPaused"] = True
        # Where each public work was saved from (tools/ingest_inbox.py notes).
        sources = json.loads((CONTENT / "sources.json").read_text(encoding="utf-8")) if (CONTENT / "sources.json").exists() else {}
        ids = {item["id"] for item in items}
        (stage / "sources.json").write_text(json.dumps({k: v for k, v in sources.items() if k in ids}, indent=2, ensure_ascii=False), encoding="utf-8")
        # Written last so a reader never sees a manifest pointing at missing files.
        (stage / "manifest.json").write_text(json.dumps(public, indent=2), encoding="utf-8")

        size = sum(f.stat().st_size for f in stage.rglob("*") if f.is_file())
        print(f"Staged {len(items)} works ({size / 1e6:.1f} MB), withheld {len(withheld)}: {', '.join(withheld) or 'none'}")
        if args.dry_run:
            return

        archive = Path(tmp) / "content.tgz"
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(stage, arcname=stamp)
        remote_cmd = " && ".join([
            "set -e",
            f"mkdir -p {REMOTE_BASE}/releases",
            f"tar -xzf - -C {REMOTE_BASE}/releases",
            f"chmod -R a+rX {REMOTE_BASE}/releases/{stamp}",
            f"ln -sfn releases/{stamp} {REMOTE_BASE}/content.next",
            f"mv -Tf {REMOTE_BASE}/content.next {REMOTE_BASE}/content",
            f"ls -1dt {REMOTE_BASE}/releases/*/ | tail -n +{KEEP_RELEASES + 1} | xargs -r rm -rf",
            f"echo published {stamp}",
        ])
        with archive.open("rb") as stream:
            subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", REMOTE, remote_cmd], stdin=stream, check=True)
    sync_media()


if __name__ == "__main__":
    main()
