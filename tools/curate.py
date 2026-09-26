"""Curate new images with Claude and grow the museum's generated wings.

Usage:
    python tools/curate.py [--source site|local] [--dry-run] [--limit N]

Runs in GitHub Actions (.github/workflows/curate.yml), authenticated with
Workload Identity Federation: no API key exists anywhere. With --source site
(the default) it reads the *published* manifest and images from the live site,
so works withheld at an artist's request are never sent to the API.

Finds images that nothing covers yet: not in the hand-written catalogue
(src/catalog.js), the generated catalogue (data/catalog.json) or the exclusion
list (content-policy.json). Works that
are "on hold" (catalogued, but waiting on the Entrance Hall's easels for enough company
to form a wing) are reconsidered each run.

Claude writes each work's plaque and callouts and decides where it hangs: a new
generated wing (3-7 works sharing a mood), an existing generated wing with
space, or "hold". Results go to data/catalog.json and data/layout.json, which
the workflow commits; the resulting deploy puts them live.

Credentials: the federation variables (ANTHROPIC_FEDERATION_RULE_ID,
ANTHROPIC_ORGANIZATION_ID, ANTHROPIC_SERVICE_ACCOUNT_ID,
ANTHROPIC_IDENTITY_TOKEN_FILE), or ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN for
a local run. Without any, the script exits 0 and new images stay on the
acquisition easels.
"""
import argparse
import base64
import io
import json
import os
import re
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
DATA = ROOT / "data"
SITE = os.environ.get("COOLIMAGES_SITE", "https://coolimages.alirezaafshan.com")
MODEL = "claude-opus-5"
MIN_WING = 3
MAX_WING = 7
MAX_BATCH = 16
TEMPLATES = ("salon", "white", "night", "pastel", "screening")
HAND_BUILT_WINGS = {"lobby", "gallery", "eyes", "familiars", "bedroom"}
# Architecture for new wings (src/architecture.js): the least-used form for the
# template, with octagons only for small wings.
DEFAULT_FORMS = {
    "salon": ["enfilade", "octagon", "rect"],
    "white": ["spiral", "basilica", "void", "octagon"],
    "night": ["iron", "crypt", "octagon"],
    "pastel": ["attic", "rect"],
    "screening": ["cinema"],
}
MAX_LINKS = 3
DEFAULT_ACCENT = {"salon": "#9a2f2f", "white": "#1f7a8c", "night": "#6c5ce7", "pastel": "#d4679a", "screening": "#c0392b"}

STYLE_GUIDE = """You are the curator of "coolimages", a walkable 3D museum built from one person's folder of images saved from X. The museum's voice: observant, specific, dry, warm, and a little funny. It is modelled on the 1990s Eyewitness museum: pictures floating in white space with small italic labels pointing at details.

For each image you receive, write:
- title: a museum title, 2 to 6 words. Witty is fine; never a pun for its own sake.
- artist: only what is visible (a signature, watermark or handle in the image), or what the post it was saved from says outright (the poster calling it their own work, or naming the artist). The person who posted it is not necessarily the maker. Otherwise "Unknown artist", "Unknown photographer" or "Almost certainly a model" when the image clearly looks AI-generated. Never guess a real person's identity.
- medium: short, e.g. "Digital painting", "Pixel art", "Photograph, dusty corner".
- note: 2 to 4 sentences. Describe what is actually in the picture, then why it is interesting: the tension, the joke, the craft, or the mood. Be specific to this image. No filler, no "this piece invites us to". Be kind about people in photographs; don't speculate about them.
- callouts: 0 to 4 labels pointing at specific visible details. u and v are the target point as fractions of the image width and height, measured from the top-left corner (0 to 1). Labels are 2 to 5 words, often with a dry parenthetical, e.g. "Chips (winning)", "Expression: remorse". Only point at things you can clearly locate.
- placement: where the work hangs (see below).

Some works are videos. They play silently on a loop and with sound when a visitor steps close. You see a video as a contact sheet: six frames in playback order, left to right, top to bottom. Write about the whole video, including what happens over time; the medium can say so ("AI-generated video, 11 seconds"). For a video, give at most 2 callouts, with u and v measured within a single frame (not the whole sheet), and only on something that stays in place for most of the video; otherwise give none.

Grouping: gather works that share a mood, subject or visual language into new wings of 3 to 7 works. A wing needs a key (lowercase slug, e.g. "wing-small-gods"), a name ("The Small Gods"), a subtitle (2 to 4 words), a statement (2 or 3 sentences, in the same voice, about what connects the works), a template matching the mood (salon: gilded frames on cream walls, for anything painterly or grave; white: floating in white space, for graphic, digital or conceptual work; night: dark room with glowing lightboxes, for eerie, cosmic or occult work; pastel: taped polaroids on a lilac bedroom wall, for cute, sweet or sinister-cute work; screening: a dark screening room with glowing screens and velvet benches, made for videos, though videos can hang in any template), and an accent colour as #rrggbb. For a new wing, also name up to 3 related wings: existing generated wings (by key) that it rhymes with in subject, mood or idea, each with a door phrase of 2 to 5 words that says what connects them without explaining too much, e.g. "Robots that don't stop" or "Cute, with teeth". Visitors walk between related wings through doors marked with that phrase. A work may instead join an existing generated wing that has space. When a work doesn't fit anything yet and there aren't enough like it, set placement to "hold": it waits on the entrance easels for company. Never invent a wing for fewer than 3 works.

Existing hand-built wings (closed; do not place works in them), for tone:
- The Grand Gallery, "Serious Treatment": silly things given grave dignity.
- The Hall of Eyes, "The Seer's Chamber": things that see and are seen into.
- The Familiars, "Minds Inside Things": AI, agents and machines with personalities.
- The Bedroom Wall, "Sweet & Sinister": cute things coexisting with something dark."""

SCHEMA = {
    "type": "object",
    "properties": {
        "works": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                    "artist": {"type": "string"},
                    "medium": {"type": "string"},
                    "note": {"type": "string"},
                    "callouts": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"u": {"type": "number"}, "v": {"type": "number"}, "t": {"type": "string"}},
                            "required": ["u", "v", "t"],
                            "additionalProperties": False,
                        },
                    },
                    "placement": {"type": "string"},
                },
                "required": ["id", "title", "artist", "medium", "note", "callouts", "placement"],
                "additionalProperties": False,
            },
        },
        "newWings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "name": {"type": "string"},
                    "subtitle": {"type": "string"},
                    "statement": {"type": "string"},
                    "template": {"type": "string", "enum": list(TEMPLATES)},
                    "accent": {"type": "string"},
                    "related": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"key": {"type": "string"}, "phrase": {"type": "string"}},
                            "required": ["key", "phrase"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["key", "name", "subtitle", "statement", "template", "accent", "related"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["works", "newWings"],
    "additionalProperties": False,
}


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def handwritten_ids():
    """Keys of the WORKS object in src/catalog.js (two-space indented keys)."""
    text = (ROOT / "src" / "catalog.js").read_text(encoding="utf-8")
    works = text[text.index("export const WORKS"):]
    return set(re.findall(r"^  '?([A-Za-z0-9_-]{8,})'?: \{", works, flags=re.M))


def read_bytes(source):
    """Image bytes from a local path or a URL on the live site."""
    if isinstance(source, Path):
        return source.read_bytes()
    req = urllib.request.Request(source, headers={"User-Agent": "coolimages-curator"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "coolimages-curator", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read())


def has_credentials():
    federation = ("ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_SERVICE_ACCOUNT_ID")
    token = os.environ.get("ANTHROPIC_IDENTITY_TOKEN_FILE") or os.environ.get("ANTHROPIC_IDENTITY_TOKEN")
    if all(os.environ.get(k) for k in federation) and token:
        return True
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def encode_image(source, edge=1024):
    with Image.open(io.BytesIO(read_bytes(source))) as im:
        im = im.convert("RGB")
        im.thumbnail((edge, edge))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=85)
    return base64.standard_b64encode(buf.getvalue()).decode("ascii")


def slug(text):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "wing"
    return s if s.startswith("wing-") else f"wing-{s}"


def clean_work(raw):
    callouts = []
    for c in raw.get("callouts", [])[:4]:
        u, v, t = c.get("u"), c.get("v"), str(c.get("t", "")).strip()
        if isinstance(u, (int, float)) and isinstance(v, (int, float)) and t:
            callouts.append({"u": round(min(0.98, max(0.02, u)), 3), "v": round(min(0.98, max(0.02, v)), 3), "t": t[:48]})
    return {
        "title": str(raw["title"]).strip()[:80],
        "artist": str(raw["artist"]).strip()[:120],
        "medium": str(raw["medium"]).strip()[:120],
        "note": str(raw["note"]).strip()[:900],
        "callouts": callouts,
    }


def ask_claude(client, batch, held, catalog, layout, videos, sources=None):
    open_wings = [
        f'- key "{key}": {w["name"]} ({w["subtitle"]}), template {w["template"]}, {MAX_WING - len(w.get("works", []))} spaces left. {w["statement"]}'
        for key, w in layout["wings"].items()
        if len(w.get("works", [])) < MAX_WING
    ]
    content = []
    for item_id, path in batch:
        label = f"Image ID: {item_id}"
        if item_id in videos:
            v = videos[item_id]
            sound = "with sound" if v.get("audio") else "silent"
            label = f"Image ID: {item_id} (a video, {v.get('duration', 0):.0f} seconds, {sound}; shown as a contact sheet)"
        if item_id in held:
            label += f' (already catalogued as "{catalog[item_id]["title"]}"; keep its text unless it is clearly wrong, and decide its placement)'
        src = (sources or {}).get(item_id)
        if src and src.get("match") in ("exact", "page"):
            author = src.get("author") or {}
            label += f'\nSaved from a post by @{author.get("handle", "?")} ({author.get("name", "")}), {str(src.get("postedAt") or "")[:10]}: "{str(src.get("text", ""))[:500]}"'
            if src.get("alt"):
                label += f'\nAlt text on the post: "{src["alt"][:400]}"'
        content.append({"type": "text", "text": label})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": encode_image(path)}})
    content.append({
        "type": "text",
        "text": "Existing generated wings with space:\n"
        + ("\n".join(open_wings) if open_wings else "(none yet)")
        + "\n\nCatalogue every image above, one entry per Image ID, and decide placements. "
        + 'placement must be a new wing key you define in newWings, an existing generated wing key listed above, or "hold".',
    })
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=STYLE_GUIDE,
        messages=[{"role": "user", "content": content}],
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
    )
    if response.stop_reason == "refusal":
        raise RuntimeError(f"Claude declined the batch: {getattr(response, 'stop_details', None)}")
    if response.stop_reason == "max_tokens":
        raise RuntimeError("Response hit max_tokens; lower --limit")
    text = next(block.text for block in response.content if block.type == "text")
    usage = response.usage
    print(f"Claude usage: {usage.input_tokens} in / {usage.output_tokens} out")
    return json.loads(text)


def pick_form(spec, wings):
    options = [f for f in DEFAULT_FORMS.get(spec["template"], ["rect"]) if f != "octagon" or len(spec["works"]) <= 4]
    used = [w.get("form") for w in wings.values()]
    return min(options, key=lambda f: (used.count(f), options.index(f)))


def add_links(layout, key, related):
    """Doors between a new wing and the generated wings it rhymes with."""
    links = layout.setdefault("links", [])
    degree = lambda k: sum(k in link[:2] for link in links)  # noqa: E731
    for target, phrase in related:
        if target == key or target not in layout["wings"] or not phrase:
            continue
        if degree(key) >= MAX_LINKS or degree(target) >= MAX_LINKS:
            continue
        if any({key, target} == set(link[:2]) for link in links):
            continue
        links.append([key, target, phrase])


def apply_result(result, batch_ids, held, catalog, layout, now):
    wings = layout["wings"]

    # 1. Plaque text. Held works keep the text they already have.
    placements = {}
    for raw in result.get("works", []):
        item_id = raw.get("id")
        if item_id not in batch_ids:
            continue
        if item_id not in held:
            catalog[item_id] = {**clean_work(raw), "curatedAt": now}
        placements[item_id] = raw.get("placement", "hold")

    # 2. New wings, with keys made unique and fields validated.
    proposed = {}
    taken = set(wings) | HAND_BUILT_WINGS
    for w in result.get("newWings", []):
        key = slug(w["key"] or w["name"])
        if key.startswith("rotunda"):  # reserved for the generated hubs
            key = f"wing-{key}"
        while key in taken:
            key += "-2"
        taken.add(key)
        template = w["template"] if w["template"] in TEMPLATES else "salon"
        accent = w["accent"] if re.fullmatch(r"#[0-9a-fA-F]{6}", w.get("accent", "")) else DEFAULT_ACCENT[template]
        related = [(r.get("key", ""), str(r.get("phrase", "")).strip()[:40]) for r in w.get("related", [])][:MAX_LINKS]
        proposed[w["key"]] = (key, related, {
            "name": w["name"][:60],
            "subtitle": w["subtitle"][:60],
            "statement": w["statement"][:600],
            "template": template,
            "accent": accent,
            "created": now,
            "works": [],
        })

    # 3. Hang works. Undersized new wings and overflow fall back to hold.
    members = {}
    for item_id, target in placements.items():
        members.setdefault(target, []).append(item_id)
    hung = {}
    for target, ids in members.items():
        if target in proposed and len(ids) >= MIN_WING:
            key, related, spec = proposed[target]
            spec["works"] = ids[:MAX_WING]
            spec["form"] = pick_form(spec, wings)
            wings[key] = spec
            hung.update({item_id: key for item_id in spec["works"]})
            add_links(layout, key, related)
        elif target in wings and target not in HAND_BUILT_WINGS:
            space = max(0, MAX_WING - len(wings[target]["works"]))
            wings[target]["works"].extend(ids[:space])
            hung.update({item_id: target for item_id in ids[:space]})

    for item_id in placements:
        entry = catalog[item_id]
        if item_id in hung:
            entry["wing"] = hung[item_id]
            entry.pop("hold", None)
        else:
            entry["wing"] = "lobby"
            entry["hold"] = True


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", choices=("site", "local"), default="site", help="published site (default) or local content/")
    parser.add_argument("--dry-run", action="store_true", help="list what would be curated; no API call")
    parser.add_argument("--limit", type=int, default=MAX_BATCH, help=f"images per request (default {MAX_BATCH})")
    args = parser.parse_args()

    # Videos are shown to Claude through their contact sheet.
    if args.source == "site":
        manifest = fetch_json(f"{SITE}/content/manifest.json")
        items = {item["id"]: f"{SITE}/{item.get('sheet', item['file'])}" for item in manifest["items"]}
    else:
        manifest = load_json(CONTENT / "manifest.json", {"items": []})
        items = {item["id"]: ROOT / item.get("sheet", item["file"]) for item in manifest["items"]}
    videos = {item["id"]: item for item in manifest["items"] if "video" in item}
    # Where each work was saved from, when the collector extension noted it.
    if args.source == "site":
        try:
            sources = fetch_json(f"{SITE}/content/sources.json")
        except Exception:  # noqa: BLE001 - optional context
            sources = {}
    else:
        sources = load_json(CONTENT / "sources.json", {})
    catalog = load_json(DATA / "catalog.json", {})
    layout = load_json(DATA / "layout.json", {"version": 1, "wings": {}})
    layout.setdefault("wings", {})
    excluded = set(load_json(ROOT / "content-policy.json", {}).get("exclude", {}))
    known = handwritten_ids()

    new_ids = [i for i in items if i not in known and i not in catalog and i not in excluded]
    held = {i for i, w in catalog.items() if w.get("hold") and i in items and i not in excluded}
    queue = new_ids + sorted(held)
    print(f"{len(new_ids)} new, {len(held)} on hold, {len(layout['wings'])} generated wings")
    if not queue:
        return
    if args.dry_run:
        print("Would curate:", ", ".join(queue))
        return
    if not has_credentials():
        print("No Anthropic credentials in the environment; new images stay on the acquisition easels.")
        return

    import anthropic

    # One client for the whole run: under federation it exchanges the identity
    # token once and refreshes from the token file before expiry (GitHub's
    # tokens are single-use, so a client per batch would be rejected).
    client = anthropic.Anthropic()
    now = datetime.now().isoformat(timespec="minutes")
    DATA.mkdir(exist_ok=True)
    for start in range(0, len(queue), args.limit):
        batch = [(i, items[i]) for i in queue[start:start + args.limit]]
        result = ask_claude(client, batch, held, catalog, layout, videos, sources)
        apply_result(result, {i for i, _ in batch}, held, catalog, layout, now)
        # Save after every batch so a later failure keeps earlier work.
        write_json(DATA / "catalog.json", catalog)
        write_json(DATA / "layout.json", layout)
    placed = sum(len(w["works"]) for w in layout["wings"].values())
    holding = sum(1 for w in catalog.values() if w.get("hold"))
    print(f"Catalogue: {len(catalog)} generated entries; {placed} hung in {len(layout['wings'])} wings; {holding} on hold")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - the scheduled run logs and continues to publish
        print(f"Curation failed: {exc}", file=sys.stderr)
        sys.exit(2)
