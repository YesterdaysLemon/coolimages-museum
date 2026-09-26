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

Registered by install.ps1 in this directory.
"""
import json
import os
import re
import struct
import sys
import urllib.request
from pathlib import Path

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
        return write_note(root, saved.stem, msg.get("note"))
    if kind == "save":
        url = str(msg.get("url", ""))
        name = str(msg.get("name", ""))
        host = urllib.request.urlparse(url).hostname
        if host not in HOSTS or not url.startswith("https://") or not NAME.match(name):
            return {"ok": False, "reason": "only X photos and videos can be saved"}
        target = root / name
        if not target.exists():
            req = urllib.request.Request(url, headers={"User-Agent": "coolimages-collector"})
            with urllib.request.urlopen(req, timeout=120) as res:
                data = res.read()
            tmp = target.with_suffix(target.suffix + ".part")
            tmp.write_bytes(data)
            tmp.replace(target)
        result = write_note(root, target.stem, msg.get("note"))
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
