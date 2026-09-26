"""Bring saves from the Coolimages Collector extension into the collection.

Usage:
    python tools/ingest_inbox.py [--dry-run]

The browser extension (extension/) writes into <Downloads>/coolimages-inbox:
media it saved itself (<id>.jpg|png|webp|gif|mp4) and one note per save,
<id>.json, describing the post it came from. This moves media into the
coolimages folder and puts each note beside its file as <id>.json, where
tools/build_assets.py reads it. Processed notes are kept in the inbox's
"ingested" subfolder.

A post that asks not to be reposted gets its work added to
content-policy.json, so it is never uploaded (the museum's standing rule).

Environment: COOLIMAGES_INBOX (default ~/Downloads/coolimages-inbox),
COOLIMAGES_DIR (default ~/OneDrive/Pictures/coolimages).
"""
import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INBOX = Path(os.environ.get("COOLIMAGES_INBOX", Path.home() / "Downloads" / "coolimages-inbox"))
FOLDER = Path(os.environ.get("COOLIMAGES_DIR", Path.home() / "OneDrive" / "Pictures" / "coolimages"))
POLICY = Path(os.environ.get("COOLIMAGES_POLICY", ROOT / "content-policy.json"))
MEDIA = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov", ".m4v", ".webm"}
NO_REPOST = re.compile(
    r"\b(do\s*n[o'’]?t|please\s+do\s*n[o'’]?t|no)\s+(re-?\s?post(ing)?|re-?\s?upload(ing)?|repost|reupload|steal|use\s+(my|this)\s+art)"
    r"|\bno\s+ai\b|\bnot\s+for\s+ai\b",
    re.IGNORECASE,
)


def load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def clean_note(raw):
    """Keep what the museum uses; drop anything that isn't about the post."""
    post = raw.get("post") or None
    if post:
        author = post.get("author") or {}
        post = {
            "url": str(post.get("url", ""))[:300],
            "id": str(post.get("id", ""))[:40],
            "postedAt": post.get("postedAt"),
            "text": str(post.get("text", ""))[:2000],
            "lang": post.get("lang"),
            "sensitive": bool(post.get("sensitive")),
            "author": {"name": str(author.get("name", ""))[:120], "handle": str(author.get("handle", ""))[:40], "url": str(author.get("url", ""))[:200]},
            "alt": str(post.get("alt", ""))[:1000],
        }
    return {
        "version": 1,
        "id": raw["id"],
        "file": raw.get("file"),
        "kind": raw.get("kind"),
        "mediaUrl": raw.get("mediaUrl"),
        "savedAt": raw.get("savedAt"),
        "match": raw.get("match", "none"),
        "post": post,
    }


def rank(note):
    return {"exact": 3, "page": 2, "nearby": 1}.get((note or {}).get("match"), 0)


def main():
    # Post text can hold emoji; never let a console code page stop the run.
    sys.stdout.reconfigure(errors="replace")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not FOLDER.is_dir():
        sys.exit(f"Coolimages folder not found: {FOLDER}")
    done = INBOX / "ingested"
    moved = notes = withheld = 0
    inbox = sorted(INBOX.iterdir()) if INBOX.is_dir() else []

    # 1. Media the extension saved.
    for path in inbox:
        if not path.is_file() or path.suffix.lower() not in MEDIA:
            continue
        target = FOLDER / path.name
        if target.exists():
            print(f"already in the folder: {path.name}")
            if not args.dry_run:
                done.mkdir(exist_ok=True)
                shutil.move(str(path), done / path.name)
            continue
        print(f"moving {path.name}")
        if not args.dry_run:
            shutil.move(str(path), target)
        moved += 1

    # 2. Notes: next to their file, keeping the best-traced one.
    policy = load(POLICY, {"exclude": {}})
    policy.setdefault("exclude", {})
    for path in [p for p in inbox if p.suffix.lower() == ".json"]:
        raw = load(path, None)
        if not isinstance(raw, dict) or not raw.get("id") or raw.get("version") != 1:
            print(f"skipping {path.name}: not a collector note")
            continue
        note = clean_note(raw)
        target = FOLDER / f"{note['id']}.json"
        existing = load(target, None)
        if existing and rank(existing) > rank(note):
            print(f"keeping the better-traced note for {note['id']}")
        else:
            print(f"note for {note['id']}: {note['match']}" + (f", @{note['post']['author']['handle']}" if note["post"] else ""))
            if not args.dry_run:
                target.write_text(json.dumps(note, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
            notes += 1
        if not args.dry_run:
            done.mkdir(exist_ok=True)
            shutil.move(str(path), done / path.name)

    # 3. Every note in the folder (the native helper writes there directly):
    # a post that asks not to be reposted keeps its work off the site.
    for path in sorted(FOLDER.glob("*.json")):
        note = load(path, None)
        if not isinstance(note, dict) or note.get("version") != 1 or note.get("id") in policy["exclude"]:
            continue
        text = (note.get("post") or {}).get("text", "")
        hit = NO_REPOST.search(text)
        if hit:
            snippet = text[max(0, hit.start() - 30): hit.end() + 30].strip()
            policy["exclude"][note["id"]] = f"Withheld: the post it was saved from says “{snippet}”."
            print(f"WITHHOLDING {note['id']}: the post says “{snippet}”")
            withheld += 1
    if withheld and not args.dry_run:
        POLICY.write_text(json.dumps(policy, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print("content-policy.json changed: commit it so the site keeps the works withheld.")
    print(f"Inbox: {moved} files moved, {notes} notes filed, {withheld} withheld")
    return 0


if __name__ == "__main__":
    sys.exit(main())
