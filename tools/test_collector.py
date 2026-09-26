"""Offline check of the collector pipeline: inbox -> folder -> manifest.

Usage:
    python tools/test_collector.py

Builds a throwaway inbox and folder, runs tools/ingest_inbox.py on them,
then tools/build_assets.py into a temporary content directory, and checks
that notes land beside their files, real save times replace file times,
sources are collected, and a post asking not to be reposted is withheld.
Nothing in the real collection, content/ or content-policy.json is touched.
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def note(id_, file, text, match="exact"):
    return {
        "version": 1,
        "id": id_,
        "file": file,
        "kind": "image",
        "mediaUrl": f"https://pbs.twimg.com/media/{id_}?format=jpg&name=orig",
        "savedAt": "2026-09-20T18:30:00.000Z",
        "match": match,
        "post": {
            "url": f"https://x.com/someone/status/1{len(id_)}",
            "id": "1",
            "postedAt": "2026-09-19T10:00:00.000Z",
            "text": text,
            "lang": "en",
            "sensitive": False,
            "author": {"name": "Some One", "handle": "someone", "url": "https://x.com/someone"},
            "alt": "A test picture",
            "extra": "dropped by ingest",
        },
    }


def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        inbox, folder, content = tmp / "inbox", tmp / "folder", tmp / "content"
        inbox.mkdir()
        folder.mkdir()
        policy = tmp / "policy.json"
        policy.write_text(json.dumps({"exclude": {}}), encoding="utf-8")
        # One save the extension made itself (media + note in the inbox), one
        # saved straight into the folder (note only), one that forbids reposts.
        Image.new("RGB", (40, 30), (200, 80, 60)).save(inbox / "AAAtestAAA.jpg")
        Image.new("RGB", (30, 40), (60, 80, 200)).save(folder / "BBBtestBBB.jpg")
        Image.new("RGB", (32, 32), (60, 200, 80)).save(folder / "CCCtestCCC.jpg")
        for n in (
            note("AAAtestAAA", "AAAtestAAA.jpg", "look at this"),
            note("BBBtestBBB", "BBBtestBBB.jpg", "my new piece https://t.co/xyz"),
            note("CCCtestCCC", "CCCtestCCC.jpg", "new art! please don't repost without credit"),
        ):
            (inbox / f"{n['id']}.json").write_text(json.dumps(n), encoding="utf-8")
        env = {**os.environ, "COOLIMAGES_INBOX": str(inbox), "COOLIMAGES_DIR": str(folder), "COOLIMAGES_POLICY": str(policy)}
        subprocess.run([sys.executable, str(ROOT / "tools" / "ingest_inbox.py")], env=env, check=True)

        assert (folder / "AAAtestAAA.jpg").exists(), "media moved into the folder"
        for id_ in ("AAAtestAAA", "BBBtestBBB", "CCCtestCCC"):
            assert (folder / f"{id_}.json").exists(), f"note beside {id_}"
            assert (inbox / "ingested" / f"{id_}.json").exists(), f"inbox note for {id_} archived"
        filed = json.loads((folder / "BBBtestBBB.json").read_text(encoding="utf-8"))
        assert "extra" not in filed["post"], "unknown fields dropped"
        withheld = json.loads(policy.read_text(encoding="utf-8"))["exclude"]
        assert list(withheld) == ["CCCtestCCC"], f"only the no-repost post is withheld: {withheld}"

        # Build into a temporary content directory.
        spec = importlib.util.spec_from_file_location("build_assets", ROOT / "tools" / "build_assets.py")
        ba = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ba)
        ba.ROOT = tmp
        ba.OUT = content / "art"
        sys.argv = ["build_assets.py", str(folder)]
        ba.main()
        manifest = json.loads((content / "manifest.json").read_text(encoding="utf-8"))
        sources = json.loads((content / "sources.json").read_text(encoding="utf-8"))
        items = {i["id"]: i for i in manifest["items"]}
        assert set(items) == {"AAAtestAAA", "BBBtestBBB", "CCCtestCCC"}, "notes are not mistaken for media"
        assert items["BBBtestBBB"]["saved"].startswith("2026-09-2"), f"save time from the note: {items['BBBtestBBB']['saved']}"
        assert sources["BBBtestBBB"]["author"]["handle"] == "someone"
        assert sources["BBBtestBBB"]["match"] == "exact"
        print("collector pipeline checks passed")


if __name__ == "__main__":
    main()
