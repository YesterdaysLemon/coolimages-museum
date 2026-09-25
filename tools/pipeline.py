"""Scheduled museum update on this PC: rebuild textures and publish them.

Usage:
    python tools/pipeline.py [--no-publish] [--no-dispatch]

Runs every couple of days from Windows Task Scheduler (tools/run_pipeline.ps1).
Curation happens in GitHub Actions (.github/workflows/curate.yml) with Workload
Identity Federation. When this run publishes works the live site didn't have,
it dispatches that workflow straight away through the gh CLI; the workflow's
daily schedule is the fallback.
"""
import argparse
import json
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / "content" / ".pipeline.lock"
STALE_LOCK_SECONDS = 2 * 60 * 60
SITE = "https://coolimages.alirezaafshan.com"
REPO = "YesterdaysLemon/coolimages-museum"


def log(message):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {message}", flush=True)


def step(name, *args):
    log(name)
    return subprocess.run([sys.executable, str(ROOT / "tools" / name), *args], cwd=ROOT).returncode


def live_ids():
    try:
        req = urllib.request.Request(f"{SITE}/content/manifest.json", headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=30) as res:
            return {item["id"] for item in json.loads(res.read())["items"]}
    except Exception as exc:  # noqa: BLE001 - treat an unreachable site as "everything is new"
        log(f"could not read the live manifest ({exc})")
        return set()


def public_ids():
    manifest = json.loads((ROOT / "content" / "manifest.json").read_text(encoding="utf-8"))
    excluded = set(json.loads((ROOT / "content-policy.json").read_text(encoding="utf-8")).get("exclude", {}))
    return {item["id"] for item in manifest["items"]} - excluded


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--no-publish", action="store_true")
    parser.add_argument("--no-dispatch", action="store_true", help="don't trigger the curation workflow")
    args = parser.parse_args()

    LOCK.parent.mkdir(parents=True, exist_ok=True)
    if LOCK.exists() and time.time() - LOCK.stat().st_mtime < STALE_LOCK_SECONDS:
        log("another pipeline run is in progress; skipping")
        return 0
    LOCK.write_text(str(time.time()), encoding="utf-8")
    try:
        before = live_ids()
        if step("build_assets.py") != 0:
            return 1
        if args.no_publish:
            return 0
        if step("publish_content.py", "--skip-build") != 0:
            return 1
        new = public_ids() - before
        log(f"{len(new)} newly published works")
        if new and not args.no_dispatch:
            if shutil.which("gh"):
                done = subprocess.run(["gh", "workflow", "run", "curate.yml", "-R", REPO, "--ref", "main"], cwd=ROOT)
                log("curation workflow dispatched" if done.returncode == 0 else "could not dispatch curation; the daily schedule will pick it up")
            else:
                log("gh CLI not found; the daily curation schedule will pick up the new works")
        log("done")
        return 0
    finally:
        LOCK.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
