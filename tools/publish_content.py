"""Publish the public content set to the VPS.

Usage:
    python tools/publish_content.py [--skip-build] [--dry-run]

Rebuilds textures (unless --skip-build), drops works listed in
content-policy.json, uploads the images and manifest over SSH as a new release
directory and atomically repoints /srv/coolimages/content at it. Caddy serves
that directory at https://coolimages.alirezaafshan.com/content/. Curated text
lives in the repo (data/) and ships with the app, not here.

Environment: COOLIMAGES_SSH (default "vps-admin"), COOLIMAGES_REMOTE_BASE
(default "/srv/coolimages").
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
POLICY = ROOT / "content-policy.json"
REMOTE = os.environ.get("COOLIMAGES_SSH", "vps-admin")
REMOTE_BASE = os.environ.get("COOLIMAGES_REMOTE_BASE", "/srv/coolimages")
KEEP_RELEASES = 3


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--skip-build", action="store_true", help="publish the existing content/ folder as-is")
    parser.add_argument("--dry-run", action="store_true", help="stage and report, but do not upload")
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
        for item in items:
            shutil.copy2(ROOT / item["file"], stage / "art" / Path(item["file"]).name)
        public = {"built": manifest.get("built"), "count": len(items), "items": items, "withheld": withheld}
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


if __name__ == "__main__":
    main()
