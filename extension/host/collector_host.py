"""Native helper for the Coolimages Collector extension.

The browser starts this for each message (Chromium native messaging: a
4-byte little-endian length, then UTF-8 JSON, on stdin/stdout). It writes
into the coolimages folder named in %LOCALAPPDATA%/CoolimagesCollector/
config.json, and nowhere else:

  ping                         -> {ok, folder}
  note {savedPath, note}       -> writes <folder>/<stem>.json beside a file
                                  that was saved directly into the folder
  save {url, name, note}       -> downloads an X photo or video into the
                                  folder (never overwriting), plus its note
  check {url, name}            -> is this picture already in the folder?

Duplicates are caught by picture, not just by name (tools/dupes.py): a save
that looks like a file already in the folder isn't kept, and a file saved
straight into the folder that duplicates another is moved to _duplicates.
Either way the new post is added to the existing file's note as alsoPosted.

Registered by install.ps1 in this directory.
"""
import hashlib
import json
import os
import re
import shutil
import struct
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import dupes  # noqa: E402

CONFIG = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "CoolimagesCollector" / "config.json"
NAME = re.compile(r"^[A-Za-z0-9_-]{4,64}\.(jpg|png|webp|gif|mp4)$")
HOSTS = {"pbs.twimg.com", "video.twimg.com"}


def read_message():
    head = sys.stdin.buffer.read(4)
    if len(head) < 4:
        return None
    (size,) = struct.unpack("<I", head)
    return json.loads(sys.stdin.buffer.read(size).decode("utf-8"))


def send(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def folder():
    try:
        return Path(json.loads(CONFIG.read_text(encoding="utf-8"))["folder"]).resolve()
    except (OSError, KeyError, ValueError):
        return None


def write_note(root, stem, note):
    if not isinstance(note, dict) or note.get("version") != 1:
        return {"ok": False, "reason": "not a collector note"}
    note = {**note, "id": stem}
    path = root / f"{stem}.json"
    path.write_text(json.dumps(note, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    return {"ok": True, "path": str(path)}


def also_posted(root, stem, note):
    if isinstance(note, dict) and note.get("version") == 1:
        dupes.add_also_posted(root, stem, note)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "coolimages-collector"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read()


def fingerprint_bytes(data, suffix):
    if suffix in dupes.VIDEOS:
        # ffmpeg reads a frame from a file; keep it outside the folder so the
        # index never sees it.
        with tempfile.TemporaryDirectory() as scratch:
            clip = Path(scratch) / f"clip{suffix}"
            clip.write_bytes(data)
            return dupes.fingerprint_file(clip)
    return {**dupes.fingerprint_image(data), "sha": hashlib.sha256(data).hexdigest(), "kind": "image"}


def handle(msg, root):
    kind = msg.get("type")
    if kind == "ping":
        return {"ok": root is not None and root.is_dir(), "folder": str(root) if root else None}
    if root is None or not root.is_dir():
        return {"ok": False, "reason": "coolimages folder not configured; run install.ps1"}
    if kind == "note":
        saved = Path(str(msg.get("savedPath", ""))).resolve()
        if saved.parent != root or not saved.is_file() or saved.suffix.lower() == ".json":
            return {"ok": False, "reason": "not saved directly into the coolimages folder"}
        index = dupes.Index(root).refresh()
        key = str(saved).lower()
        hit = index.find(index.entries.get(key) or dupes.fingerprint_file(saved), exclude=saved.name)
        if hit:
            # Same picture as a file already here: set this copy aside.
            aside = root / "_duplicates"
            aside.mkdir(exist_ok=True)
            moved = aside / saved.name
            shutil.move(str(saved), moved)
            also_posted(root, Path(hit[0]).stem, msg.get("note"))
            index.refresh().save()
            return {"ok": True, "duplicate": hit[0], "moved": str(moved)}
        index.save()
        return write_note(root, saved.stem, msg.get("note"))
    if kind == "check":
        url = str(msg.get("url", ""))
        name = str(msg.get("name", ""))
        if not NAME.match(name):
            return {"ok": False, "reason": "bad name"}
        if (root / name).exists():
            return {"ok": True, "duplicate": name}
        suffix = Path(name).suffix.lower()
        if suffix in dupes.VIDEOS or urllib.request.urlparse(url).hostname != "pbs.twimg.com":
            return {"ok": True, "duplicate": None}
        # A small copy is enough to fingerprint.
        small = re.sub(r"name=\w+", "name=small", url) if "name=" in url else url
        index = dupes.Index(root).refresh()
        index.save()
        hit = index.find({**dupes.fingerprint_image(fetch(small)), "kind": "image"})
        return {"ok": True, "duplicate": hit[0] if hit else None}
    if kind == "save":
        url = str(msg.get("url", ""))
        name = str(msg.get("name", ""))
        host = urllib.request.urlparse(url).hostname
        if host not in HOSTS or not url.startswith("https://") or not NAME.match(name):
            return {"ok": False, "reason": "only X photos and videos can be saved"}
        target = root / name
        if target.exists():
            also_posted(root, target.stem, msg.get("note"))
            return {"ok": True, "duplicate": target.name}
        data = fetch(url)
        tmp = target.with_suffix(target.suffix + ".part")
        fp = fingerprint_bytes(data, target.suffix.lower())
        index = dupes.Index(root).refresh()
        hit = index.find(fp)
        if hit:
            also_posted(root, Path(hit[0]).stem, msg.get("note"))
            index.save()
            return {"ok": True, "duplicate": hit[0]}
        tmp.write_bytes(data)
        tmp.replace(target)
        result = write_note(root, target.stem, msg.get("note"))
        index.refresh().save()
        return {**result, "file": str(target)}
    return {"ok": False, "reason": f"unknown message {kind!r}"}


def main():
    msg = read_message()
    if msg is None:
        return
    try:
        send(handle(msg, folder()))
    except Exception as exc:  # noqa: BLE001 - always answer the extension
        send({"ok": False, "reason": str(exc)[:300]})


if __name__ == "__main__":
    main()
