<!-- al-stack:project:start -->
## Al-stack project

Project: coolimages-museum. Profile: web. Status: experimental.

Walkable Three.js museum of Alireza's coolimages folder: Eyewitness-style white museum with themed wings, plaques, DK-style callouts, portal paintings and generative music.

`al-stack.toml` records this project's setup and dependencies. Work from the checkout selected for the task; other branches/worktrees are optional history. Use `al-stack register .` once when starting work here. Local registration does not change the project's lifecycle.

Project commands:
- build: `python tools/build_assets.py`
- serve: `python -m http.server 8173`
- start: `start-museum.cmd`
- check: `node --check src/main.js && node --check src/world.js && node --check src/textures.js && node --check src/audio.js && node --check src/catalog.js`

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
  `window.museum` exposes `start()`, `teleport(room)`, `look(x, z, yaw, pitch)`, `inspect()` and `back()`.

### Content vs code
- `python tools/build_assets.py` writes `content/art/*` and `content/manifest.json`. Both are gitignored because they are third-party art.
- `python tools/publish_content.py` rebuilds and drops works listed in `content-policy.json`. It uploads over SSH (`vps-admin`) to `/srv/coolimages/releases/<stamp>`, then atomically repoints `/srv/coolimages/content`. Caddy serves that directory at `/content/`. No redeploy is needed.
- Optional generated data sits beside the images: `content/catalog.json` (pipeline-written works, merged under the hand-written `WORKS`), `content/layout.json` and `content/credits.json`.
- Push to `main` runs `.github/workflows/deploy.yml`: syntax checks, a server smoke test, then the signed Deploy Manager webhook (app id `coolimages`, ports 3280/3281, `/opt/coolimages/app`).

### Layout
- `src/catalog.js` holds the hand-written curatorial data: wings, titles, notes and callouts (`{u, v, t}` in image space), keyed by filename stem.
- `src/credits.js` holds verified attributions (`creator`, `handle`, `profileUrl`, `sourceUrl`, `license`) plus the removal-request URL. Research notes are in `research/attributions.json`.
- `src/world.js` builds the rooms. Rooms sit ~200 m apart in one scene; only the current room is visible, and every room has exactly 1 hemisphere light + 2 point lights so shader programs are shared. Collision uses each room's walkable bounds minus its obstacles (`circle`/`rect`/`sector`).
- `src/textures.js` holds the procedural canvas textures, plaques, wall text, notices and callout decals.
- `src/audio.js` is the generative Web Audio score (a mood per wing), footsteps and the portal whoosh.
- `src/main.js` holds the renderer, controls (pointer lock, drag-look fallback, arrow-key turning, touch), inspect mode, portal transitions, the credits panel, HUD and minimap.
- `server.mjs` is the static server: `/healthz`, a strict CSP (the inline import map is allowed by hash, computed at startup after CRLF normalization), `X-Robots-Tag: noindex`, and an allowlist of served paths.

### Decisions
- The public site stays public but unindexed. Every work carries credit where traced plus a removal-request link (GitHub issues). Works in `content-policy.json` are never uploaded; a "Not shown online" card takes their place. `HS-zGlbbEAAgsIJ` is excluded because its watermark forbids reuploading and AI training.
- Deploy Manager's `docker run` has no volume mounts, so content is served by Caddy from the host rather than from the container.
- Images in the folder that aren't in `WORKS` or the generated catalog appear on the Rotunda's "New acquisitions" easels (up to 4, newest first).
- Portal paintings show render-to-texture previews made once at load; `renderer.compile` then warms every room.

### Verify
- `node --check` on each `src/*.js` file and `server.mjs`; `python -m py_compile tools/*.py`.
- In a browser: the console is clean (the CSP is enforced by `server.mjs`), every room renders, a portal walk-through arrives in the right room, and inspect frames the work with its caption and credit. Check the phone layout.
- Production: `https://coolimages.alirezaafshan.com/healthz` reports the deployed SHA, and `/content/manifest.json` is served with no withheld works.
