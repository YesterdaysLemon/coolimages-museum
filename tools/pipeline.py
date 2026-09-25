"""Scheduled museum update: rebuild textures, curate new images, publish content.

Usage:
    python tools/pipeline.py [--no-curate] [--no-publish]

Runs every couple of days from Windows Task Scheduler (tools/run_pipeline.ps1).
A curation failure is logged but does not stop publishing, so new images
still reach the Rotunda's acquisition easels.
"""
import argparse
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / "content" / ".pipeline.lock"
STALE_LOCK_SECONDS = 2 * 60 * 60


def step(name, *args):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {name}", flush=True)
    return subprocess.run([sys.executable, str(ROOT / "tools" / name), *args], cwd=ROOT).returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--no-curate", action="store_true")
    parser.add_argument("--no-publish", action="store_true")
    args = parser.parse_args()

    LOCK.parent.mkdir(parents=True, exist_ok=True)
    if LOCK.exists() and time.time() - LOCK.stat().st_mtime < STALE_LOCK_SECONDS:
        print("Another pipeline run is in progress; skipping.")
        return 0
    LOCK.write_text(str(time.time()), encoding="utf-8")
    try:
        if step("build_assets.py") != 0:
            return 1
        if not args.no_curate and step("curate.py") != 0:
            print("Curation failed; publishing the images anyway.", flush=True)
        if not args.no_publish and step("publish_content.py", "--skip-build") != 0:
            return 1
        print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] done", flush=True)
        return 0
    finally:
        LOCK.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
