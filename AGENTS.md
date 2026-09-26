<!-- al-stack:project:start -->
## Al-stack project

Project: coolimages-museum. Profile: web. Status: active.

Walkable Three.js museum of Alireza's coolimages folder: Eyewitness-style white museum with themed wings, plaques, DK-style callouts, portal paintings and generative music.

`al-stack.toml` records this project's setup and dependencies. Work from the checkout selected for the task; other branches/worktrees are optional history. Use `al-stack register .` once when starting work here. Local registration does not change the project's lifecycle.

Project commands:
- build: `python tools/build_assets.py`
- serve: `python -m http.server 8173`
- start: `start-museum.cmd`
- check: `node --check src/main.js && node --check src/world.js && node --check src/textures.js && node --check src/audio.js && node --check src/catalog.js`
- publish: `python tools/publish_content.py`
- pipeline: `python tools/pipeline.py`
- curate-dry-run: `python tools/curate.py --dry-run`

Declared tools (verify availability in the intended agent):
- ffmpeg (cli): `ffmpeg`.
- ffprobe (cli): `ffprobe`.

Edit project guidance outside this managed section. Use `al-stack configure` for its fields and `al-stack check .` for setup checks. Run the actual project checks for behavioral validation.
<!-- al-stack:project:end -->

## Coolimages Museum

A walkable 3D museum (Three.js r170 via CDN import map, no build step) of the images in
`~/OneDrive/Pictures/coolimages`. The look follows the 1990s *Eyewitness* TV museum: white
space, pictures floating without borders, DK-style callout labels, and travel by walking
*into* paintings (the camera rolls 90° and fades through white).

Live at https://coolimages.alirezaafshan.com/ (public, `noindex`). Code deploys through
Deploy Manager. Content (images and generated data) is published separately and never
enters Git or the Docker image.

### Run
- Local: `start-museum.cmd` rebuilds `content/` from the folder, then serves http://localhost:8173/.
  `node server.mjs` (port 8080) is the production server and applies the CSP.
- It must be served over http: textures and ES modules don't load from `file://`.
- Test URLs: `?test` enables drag-to-look and skips pointer lock; `&mute` starts silent.
  `window.museum` exposes `start()`, `teleport(room)`, `look(x, z, yaw, pitch, y?)`, `inspect()`, `back()`, `step(±1)` (next work while looking closer), `tap(x, y)`, `map()`, `travel(room)`, `walkable(x, z, y)`, `plan` (forms, doors, stairs), `portals` (every door with its position, normal and height; `arrives` is false if a door has no way out on the other side), and `tick(seconds)` / `press(code, down)` to advance the simulation without waiting for frames. A hidden browser pane throttles frames and reports a 0×0 viewport, so drive checks with `tick` and emulate a viewport for anything that uses screen coordinates. The door check: for each portal, stand 1.3 m in front, hold W, and expect to arrive in `dest`, standing somewhere walkable.

### Content vs code
- `python tools/build_assets.py` writes `content/art/*` and `content/manifest.json`. Both are gitignored because they are third-party art.
- Each image also gets `<id>.sm.jpg` (or `.sm.png`), max edge 800, as the manifest's `small`; phones and low-memory devices (`lowPower` in `src/main.js`) load those, and every device caps textures (1024 on phones, 2048 otherwise).
- Videos (`.mp4/.mov/.m4v/.webm`) need `ffmpeg`/`ffprobe` on PATH. Each becomes `<id>.mp4` (H.264, max edge 960, ≤30 fps, capped at 2 Mbit/s, faststart), `<id>.jpg` (poster, the item's `file`) and `<id>.sheet.jpg` (a 3×2 contact sheet the curator sees instead of the video). Manifest items carry `video`, `sheet`, `duration` and `audio`. Transcodes are reused until the source file changes; delete `content/art/<id>.mp4` to force one.
- `python tools/publish_content.py` rebuilds and drops works listed in `content-policy.json`. It uploads over SSH (`vps-admin`) to `/srv/coolimages/releases/<stamp>`, then atomically repoints `/srv/coolimages/content`. Caddy serves that directory at `/content/`. No redeploy is needed.
- Curated text is code-adjacent data in the repo: `data/catalog.json` (pipeline-written works, merged under the hand-written `WORKS`) and `data/layout.json` (generated wings). Both ship in the app image and are validated in CI.
- Push to `main` runs `.github/workflows/deploy.yml`: syntax checks, a server smoke test, then the signed Deploy Manager webhook (app id `coolimages`, ports 3280/3281, `/opt/coolimages/app`).

### Growth pipeline
- **PC (Windows Task Scheduler)** runs "Coolimages Museum Pipeline" every 2 days at 11:00 (`tools/install_schedule.ps1` registers it; entry point `tools/run_pipeline.ps1`, log in `logs/pipeline.log`). `tools/pipeline.py` does build, then publish. If the live site gained works, it runs `gh workflow run curate.yml` so curation starts right away.
- **GitHub Actions** (`.github/workflows/curate.yml`, daily at 21:17 UTC and on dispatch) runs `tools/curate.py`. It reads the **published** manifest and images from the live site, so withheld works never reach the API. It calls `claude-opus-5` with structured JSON output, `effort: high` and server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). It commits `data/catalog.json` (plaques and callouts) and `data/layout.json` (generated wings of 3 to 7 works, templates `salon`/`white`/`night`/`pastel`; works that don't fit are held on the Rotunda easels), then dispatches `deploy.yml`.
- **Auth is Workload Identity Federation**, with no API key anywhere. The job gets a GitHub OIDC token with audience `https://api.anthropic.com`; a refresher loop keeps it fresh because tokens are single-use and last about 5 minutes. The SDK exchanges it using the repository variables `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID` and optional `ANTHROPIC_WORKSPACE_ID`. These are identifiers, not secrets. The Anthropic rule `coolimages-curate` (`fdrl_01Rhtjp1ac69rHdviNWpVrPC`, service account `coolimages-curator`, Default workspace) pins the subject to `repo:YesterdaysLemon@129180138/coolimages-museum@1386815787:ref:refs/heads/main`. GitHub's `sub` now embeds the owner and repository numeric IDs, so the plain `repo:owner/repo:...` form fails with `match_subject_prefix`. The rule also requires the claims `repository_owner_id`, `repository_id`, `ref` and `job_workflow_ref` (this workflow file), `event_name` in `schedule`/`workflow_dispatch` (CEL), and audience `https://api.anthropic.com`. Denied exchanges show their reason under Console > Settings > Workload identity > history. Keep `curate.py` on a single client per run.
- **The association web.** Wings connect by two-way doors between related rooms, listed in `data/layout.json` as `links: [[a, b, "door phrase"], …]`; the phrase is the door's sign on both sides. Each original wing has one far door (its first link). Each generated wing takes up to 3 links (the attic 2; the classic box 2 when it holds more than 6 works) plus a door back to **the Stair Hall**. The Rotunda's welcome slab opens onto the Stair Hall: a grand flight up to a U-shaped balcony (`layout.stairs.up`, up to 5 doors) and a flight down into a pit (`layout.stairs.down`, the basement). `planWeb()` in `src/world.js` drops links over capacity and adds Stair Hall doors (then extra links) until every wing is reachable. With no generated wings, the original wings' far doors chain gallery → eyes → familiars → bedroom → gallery. `stairhall` is a reserved key.
- **Architecture** (`src/architecture.js`): every generated wing has a `form`: `spiral` (a ramp around an atrium up to a landing; Guggenheim), `basilica` (white temple nave, coffered vault, gold apse), `iron` (iron-and-glass hall with rails), `crypt` (low stone vaults, candles), `octagon` (domed chapel, or a white octagon for white wings; at most 4 works), `enfilade` (three salons through arches), `attic` (rafters, roof lights, fairy lights), or the classic box: `void` (white), `cinema` (screening room) or `rect`. The curator picks the least-used form for the template when a wing is created; a missing or unfit form falls back to a stable default.
- **Floors at several heights:** each room has `room.floors` (rects, circles, ring sectors at a height `h`, rects with a `ramp` for stairs, and helices). `ground()` and `walkable()` in `src/world.js` keep you on the surface within a step (0.45 m) of where you are, so balconies can overhang halls and you can't step off an edge. Obstacles may carry a height band (`y0`, `y1`). Doors have a height (`pos.y`) and only open at your level.
- Local runs: `python tools/curate.py --dry-run` lists the queue. `--source local` reads `content/` instead of the site; it needs `ANTHROPIC_API_KEY` or an `ant auth login` profile. Python deps: `pip install -r tools/requirements.txt`.

### Notes lab (private)
- `lab/index.html` is a private claude.ai artifact where the collector writes notes per work and drafts plaque text with Claude (`sample` capability). Notes live in the artifact's `db` store (`notes/<id>`: `text`, `updatedAt`, `draft`, `approved`), read-locked to the owner and editors by db rules. Raw notes must never be committed: this repo is public.
- Build its data with `python tools/lab_export.py` (writes the gitignored `lab/works.json` and `lab/thumbs/`), then republish the artifact with those files. Withheld works get an entry but no image.
- "Sync my lab" means: read `notes` with ArtifactData, copy each `approved` `{title, note}` into `data/overrides.json`, commit and deploy, then re-export and republish the lab so those works show as live. `src/main.js` applies overrides over both the hand-written and the generated catalogue.

### Layout
- `src/catalog.js` holds the hand-written curatorial data: wings, titles, notes and callouts (`{u, v, t}` in image space), keyed by filename stem.
- `src/credits.js` holds verified attributions (`creator`, `handle`, `profileUrl`, `sourceUrl`, `license`, `confidence`) plus the removal-request URL. Research with evidence is in `research/attributions.json`: high and medium confidence are credited, low is not. Key claims were re-checked against the creators' own posts.
- `src/world.js` builds the rooms. Rooms sit ~200 m apart in one scene; only the current room is visible, and every room has exactly 1 hemisphere light + 2 point lights so shader programs are shared. Collision uses each room's floors minus its obstacles (`circle`/`rect`/`sector`). Door previews render once at load into a shared multisampled target and are copied into small per-door textures.
- `src/textures.js` holds the procedural canvas textures, plaques, wall text, notices and callout decals.
- `src/audio.js` is the generative Web Audio score (a mood per wing), footsteps and the portal whoosh.
- `src/main.js` holds the renderer, controls, inspect mode, portal transitions, the museum map, the credits panel, HUD and minimap. Controls: pointer lock with a drag-look fallback; arrow keys turn; on touch the left thumb is a joystick and the right thumb looks. A tap (or a click without pointer lock) acts where it lands (`tapAt`): a picture to look closer, a door to walk through, the floor to walk to. While looking closer, ←/→, A/D, a swipe or the caption buttons step to the next work in the room. Tab, the minimap or the menu opens the museum map (floors as bands); rooms you've visited (kept in localStorage) can be revisited from it. Portrait screens widen the field of view (`fovFor`).
- `server.mjs` is the static server: `/healthz`, a strict CSP (the inline import map is allowed by hash, computed at startup after CRLF normalization), `X-Robots-Tag: noindex`, and an allowlist of served paths.

### Decisions
- The public site stays public but unindexed. Every work carries credit where traced plus a removal-request link (GitHub issues). Works in `content-policy.json` are never uploaded; a "Not shown online" card takes their place. `HS-zGlbbEAAgsIJ` is excluded because its watermark forbids reuploading and AI training. `HS_hSswasAAIOeB` is excluded because its artist's profile says "DON'T re-upload my art". Apply the same rule to any new work whose creator forbids reposting.
- Caching: a Cloudflare Cache Rule for this hostname (zone `alirezaafshan.com`, phase `http_request_cache_settings`) respects origin headers. Without it Cloudflare rewrites `no-cache` to a 4-hour browser TTL and mixes old and new JS modules after a deploy. HTML, JS and JSON are `no-cache`. Existing images are `public, max-age=86400` (Caddy `@art` + `file` matcher, so 404s are not long-cached).
- Takedowns: add the ID to `content-policy.json`, run `python tools/publish_content.py`, then purge `https://coolimages.alirezaafshan.com/content/art/<ID>.jpg` (or `.png`) in Cloudflare. Otherwise edges can serve the old copy for up to a day.
- Deploy Manager's `docker run` has no volume mounts, so content is served by Caddy from the host rather than from the container.
- Images in the folder that aren't in `WORKS` or the generated catalog appear on the Rotunda's "New acquisitions" easels (up to 4, newest first).
- Portal paintings show render-to-texture previews made once at load; `renderer.compile` then warms every room.
- Callout labels (the DK-style points of interest) are hidden by default and fade in on the work you're looking at; never while looking closer. L or the menu cycles "on the work you look at" / "always on" / "off" (kept in localStorage). `TX.calloutDecal` measures labels first: margins fit the text and clear the frame border (`gap`), wrapped labels are split evenly, and the canvas grows so nothing is cut off.
- How works are shown is mixed per wing (`PALETTES` / `displayModes` in `src/architecture.js`, `hang()`): on the wall, on an easel, leaning against the wall, on wires from a rail, floating, or on a freestanding panel. Floor-standing works stand in front of their wall spot. The spiral and the cinema stay on the walls. `easel()` in `src/world.js` is shared: the work rests on the ledge in front of the legs and the clamp grips its top edge.
- Videos show their poster until their room is entered, then loop muted (`syncVideos` in `src/main.js`; only the current room's videos load or play). Looking closer (E) unmutes a video with audio and ducks the music, unless sound is off (M). The `screening` template (dark velvet room, bezel screens with light spill, benches) is meant for videos, but videos can hang in any template. `server.mjs` answers byte ranges locally; Caddy does in production.

### Verify
- `node --check` on each `src/*.js` file and `server.mjs`; `python -m py_compile tools/*.py`.
- In a browser: the console is clean (the CSP is enforced by `server.mjs`), every room renders, a portal walk-through arrives in the right room, and inspect frames the work with its caption and credit. Check the phone layout.
- Production: `https://coolimages.alirezaafshan.com/healthz` reports the deployed SHA, and `/content/manifest.json` is served with no withheld works.
