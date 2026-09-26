"""Offline check of the collector pipeline: inbox -> folder -> manifest.

Usage:
    python tools/test_collector.py

Builds a throwaway inbox and folder, runs tools/ingest_inbox.py on them,
then tools/build_assets.py into a temporary content directory, and checks
that notes land beside their files, real save times replace file times,
sources are collected, a post asking not to be reposted is withheld, and
the same picture saved twice (resized, re-encoded, renamed) goes in once.
Then drives the native helper's note/save/check handlers the same way.
Nothing in the real collection, content/, content-policy.json or the
fingerprint cache is touched.
"""
import importlib.util
import io
import json
import os
import random
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def picture(seed, size):
    """A distinct smooth pattern (solid colours would all hash alike)."""
    rng = random.Random(seed)
    grid = Image.new("RGB", (6, 6))
    grid.putdata([tuple(rng.randrange(256) for _ in range(3)) for _ in range(36)])
    return grid.resize(size, Image.BICUBIC)


def note(id_, file, text, match="exact", status="1"):
    return {
        "version": 1,
        "id": id_,
        "file": file,
        "kind": "image",
        "mediaUrl": f"https://pbs.twimg.com/media/{id_}?format=jpg&name=orig",
        "savedAt": "2026-09-20T18:30:00.000Z",
        "match": match,
        "post": {
            "url": f"https://x.com/someone/status/{status}",
            "id": status,
            "postedAt": "2026-09-19T10:00:00.000Z",
            "text": text,
            "lang": "en",
            "sensitive": False,
            "author": {"name": "Some One", "handle": "someone", "url": "https://x.com/someone"},
            "alt": "A test picture",
            "extra": "dropped by ingest",
        },
    }


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def pipeline(tmp):
    inbox, folder, content = tmp / "inbox", tmp / "folder", tmp / "content"
    inbox.mkdir()
    folder.mkdir()
    policy = tmp / "policy.json"
    policy.write_text(json.dumps({"exclude": {}}), encoding="utf-8")
    # One save the extension made itself (media + note in the inbox), one
    # saved straight into the folder (note only), one that forbids reposts.
    picture(1, (400, 300)).save(inbox / "AAAtestAAA.jpg", quality=92)
    picture(2, (300, 400)).save(folder / "BBBtestBBB.jpg", quality=92)
    picture(3, (320, 320)).save(folder / "CCCtestCCC.jpg", quality=92)
    # Duplicates: AAA again from another post, bigger and as PNG, in the
    # inbox; BBB again, smaller and heavily compressed, straight in the folder.
    picture(1, (400, 300)).resize((800, 600), Image.LANCZOS).save(inbox / "DDDtestDDD.png")
    picture(2, (300, 400)).resize((150, 200), Image.LANCZOS).save(folder / "EEEtestEEE.jpg", quality=40)
    for n in (
        note("AAAtestAAA", "AAAtestAAA.jpg", "look at this"),
        note("BBBtestBBB", "BBBtestBBB.jpg", "my new piece https://t.co/xyz"),
        note("CCCtestCCC", "CCCtestCCC.jpg", "new art! please don't repost without credit"),
        note("DDDtestDDD", "DDDtestDDD.png", "reposting this one", status="2"),
    ):
        (inbox / f"{n['id']}.json").write_text(json.dumps(n), encoding="utf-8")
    env = {**os.environ, "COOLIMAGES_INBOX": str(inbox), "COOLIMAGES_DIR": str(folder), "COOLIMAGES_POLICY": str(policy)}
    subprocess.run([sys.executable, str(ROOT / "tools" / "ingest_inbox.py")], env=env, check=True)

    assert (folder / "AAAtestAAA.jpg").exists(), "media moved into the folder"
    for id_ in ("AAAtestAAA", "BBBtestBBB", "CCCtestCCC"):
        assert (folder / f"{id_}.json").exists(), f"note beside {id_}"
        assert (inbox / "ingested" / f"{id_}.json").exists(), f"inbox note for {id_} archived"
    filed = load(folder / "BBBtestBBB.json")
    assert "extra" not in filed["post"], "unknown fields dropped"
    withheld = load(policy)["exclude"]
    assert list(withheld) == ["CCCtestCCC"], f"only the no-repost post is withheld: {withheld}"
    # The inbox duplicate stays out of the folder, and its post is credited.
    assert not (folder / "DDDtestDDD.png").exists() and not (folder / "DDDtestDDD.json").exists(), "duplicate kept out"
    assert (inbox / "duplicates" / "DDDtestDDD.png").exists() and (inbox / "duplicates" / "DDDtestDDD.json").exists(), "duplicate set aside"
    also = load(folder / "AAAtestAAA.json").get("alsoPosted", [])
    assert [a["url"] for a in also] == ["https://x.com/someone/status/2"], f"other post recorded: {also}"

    # Build into a temporary content directory.
    spec = importlib.util.spec_from_file_location("build_assets", ROOT / "tools" / "build_assets.py")
    ba = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ba)
    ba.ROOT = tmp
    ba.OUT = content / "art"
    sys.argv = ["build_assets.py", str(folder)]
    ba.main()
    manifest = load(content / "manifest.json")
    sources = load(content / "sources.json")
    items = {i["id"]: i for i in manifest["items"]}
    assert set(items) == {"AAAtestAAA", "BBBtestBBB", "CCCtestCCC"}, f"one copy of each picture, no notes: {sorted(items)}"
    assert items["BBBtestBBB"]["saved"].startswith("2026-09-2"), f"save time from the note: {items['BBBtestBBB']['saved']}"
    assert sources["BBBtestBBB"]["author"]["handle"] == "someone"
    assert sources["BBBtestBBB"]["match"] == "exact"
    print("pipeline checks passed")


def helper(tmp):
    folder = tmp / "helper"
    folder.mkdir()
    picture(7, (500, 400)).save(folder / "KEEPtest01.jpg", quality=92)
    (folder / "KEEPtest01.json").write_text(json.dumps(note("KEEPtest01", "KEEPtest01.jpg", "first post", status="10")), encoding="utf-8")
    spec = importlib.util.spec_from_file_location("collector_host", ROOT / "extension" / "host" / "collector_host.py")
    host = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(host)
    root = folder.resolve()

    def served(pic, fmt="JPEG", **kw):
        buf = io.BytesIO()
        pic.save(buf, fmt, **kw)
        return buf.getvalue()

    # A different picture is new; the same one (smaller, recompressed) isn't.
    host.fetch = lambda url: served(picture(8, (400, 400)))
    res = host.handle({"type": "check", "url": "https://pbs.twimg.com/media/NEWtest01?format=jpg&name=orig", "name": "NEWtest01.jpg"}, root)
    assert res == {"ok": True, "duplicate": None}, res
    host.fetch = lambda url: served(picture(7, (500, 400)).resize((250, 200)), quality=50)
    res = host.handle({"type": "check", "url": "https://pbs.twimg.com/media/DUPtest01?format=jpg&name=orig", "name": "DUPtest01.jpg"}, root)
    assert res == {"ok": True, "duplicate": "KEEPtest01.jpg"}, res
    res = host.handle({"type": "check", "url": "https://pbs.twimg.com/media/KEEPtest01?format=jpg&name=orig", "name": "KEEPtest01.jpg"}, root)
    assert res["duplicate"] == "KEEPtest01.jpg", "same name"

    # Save: the duplicate isn't written; its post is credited on the kept file.
    host.fetch = lambda url: served(picture(7, (500, 400)).resize((1000, 800)), "PNG")
    res = host.handle({"type": "save", "url": "https://pbs.twimg.com/media/DUPtest02?format=png&name=orig", "name": "DUPtest02.png", "note": note("DUPtest02", "DUPtest02.png", "again", status="11")}, root)
    assert res == {"ok": True, "duplicate": "KEEPtest01.jpg"}, res
    assert not (folder / "DUPtest02.png").exists() and not (folder / "DUPtest02.png.part").exists()
    host.fetch = lambda url: served(picture(9, (300, 300)))
    res = host.handle({"type": "save", "url": "https://pbs.twimg.com/media/NEWtest02?format=jpg&name=orig", "name": "NEWtest02.jpg", "note": note("NEWtest02", "NEWtest02.jpg", "fresh", status="12")}, root)
    assert res["ok"] and not res.get("duplicate") and (folder / "NEWtest02.jpg").exists() and (folder / "NEWtest02.json").exists(), res

    # Saved straight into the folder under another name: set aside.
    picture(7, (500, 400)).save(folder / "DUPtest03.jpg", quality=70)
    res = host.handle({"type": "note", "savedPath": str(folder / "DUPtest03.jpg"), "note": note("DUPtest03", "DUPtest03.jpg", "third", status="13")}, root)
    assert res["duplicate"] == "KEEPtest01.jpg" and (folder / "_duplicates" / "DUPtest03.jpg").exists() and not (folder / "DUPtest03.jpg").exists(), res
    # A new picture saved straight in gets its note as before.
    picture(11, (300, 200)).save(folder / "NEWtest03.jpg")
    res = host.handle({"type": "note", "savedPath": str(folder / "NEWtest03.jpg"), "note": note("NEWtest03", "NEWtest03.jpg", "new", status="14")}, root)
    assert res["ok"] and not res.get("duplicate") and (folder / "NEWtest03.json").exists(), res

    kept = load(folder / "KEEPtest01.json")
    assert kept["post"]["url"].endswith("/10"), "the kept file's own post stays"
    assert [a["url"].rsplit("/", 1)[1] for a in kept["alsoPosted"]] == ["11", "13"], kept["alsoPosted"]
    print("helper checks passed")


def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        os.environ["COOLIMAGES_FINGERPRINTS"] = str(tmp / "fingerprints.json")
        pipeline(tmp)
        helper(tmp)
        print("collector checks passed")


if __name__ == "__main__":
    main()
