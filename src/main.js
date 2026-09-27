import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WINGS, WORKS } from './catalog.js';
import { CREDITS, REMOVAL_URL } from './credits.js';
import * as TX from './textures.js';
import { buildWorld, walkable, ground, heightsAt, floorTop, faceAhead, EYE_HEIGHT, formatSaved, TEMPLATES } from './world.js';
import { MuseumAudio } from './audio.js';
import { makeGator } from './gator.js';
import { makeFx, pickTransition, TRANSITIONS } from './transitions.js';
import { makePerf } from './perf.js';
import { makeArt } from './art.js';
import { makeGpu, arrivalFor, spawnFrom } from './gpu.js';
import { makeVideos } from './videos.js';
import { drawMinimap } from './minimap.js';
import { mergeStatic } from './batch.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touchFirst = matchMedia('(pointer: coarse)').matches;
// Phones and small-memory devices get a lower render scale and smaller textures.
const lowPower = touchFirst || (navigator.deviceMemory || 8) <= 4;
const MAX_TEXTURE = lowPower ? 1024 : 2048;
// Door pictures' height in pixels (every door has one).
const PREVIEW_H = lowPower ? 384 : 640;
// Portrait screens get a taller field of view, so a room isn't a keyhole.
function fovFor(aspect) {
  if (aspect >= 1) return 72;
  const h = THREE.MathUtils.degToRad(64);
  return Math.min(100, Math.max(72, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect))));
}
let baseFov = fovFor(innerWidth / innerHeight);
const SENSITIVITY = 0.0022;
const SPONSORS = 'https://github.com/sponsors/YesterdaysLemon';
const ACCENT = { lobby: '#8a6d3b', gallery: '#9a2f2f', eyes: '#6c5ce7', familiars: '#1f7a8c', bedroom: '#d4679a' };
const accentFor = (id) => WINGS[id]?.accent || ACCENT[id] || ACCENT.lobby;
// Generated wings borrow the score of the hand-built wing their template imitates.
const moodFor = (id) => (WINGS[id]?.template ? TEMPLATES[WINGS[id].template]?.mood || 'gallery' : WINGS[id]?.hub ? 'lobby' : id);

// ---------------------------------------------------------------- renderer
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
// Screen effects for going through doors (transitions.js); idle otherwise.
const fx = makeFx(renderer);
// Once textures' own images have been let go (art.js, gpu.js), a lost WebGL
// context (a phone can drop it while the page is in the background) can't be
// rebuilt: start over instead.
canvas.addEventListener('webglcontextlost', (e) => {
  if (!art?.released && !gpu?.released) return;
  e.preventDefault();
  location.reload();
});
// Frame timing (perf.js): `?perf` shows it; `museum.perf` has the numbers.
const perf = makePerf(renderer, { show: params.has('perf') });
let forcedTransition = null;
TX.setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
if (lowPower) TX.setDetail(0.5);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(baseFov, innerWidth / innerHeight, 0.05, 140);

const audio = new MuseumAudio();
if (params.has('mute')) audio.muted = true;
let world = null;
let gator = null; // the alligator (gator.js)
let collection = null;
let art = null; // the works' images (art.js)
let gpu = null; // warming rooms, door pictures (gpu.js)
let videos = null; // moving images (videos.js)
// Where works were saved from (the collector extension's notes).
let SOURCES = {};
const traced = (src) => src?.url && (src.match === 'exact' || src.match === 'page');
let state = 'loading'; // loading | ready | walk | inspect | transition | paused
let locked = false;
let hovered = null;
let anim = null;
let camPose = null;
let inspect = null;
const keys = new Set();
const player = { x: 0, z: 19.6, y: 0, ey: 0, yaw: 0, pitch: -0.04, roll: 0, vx: 0, vz: 0, bob: 0, stepAcc: 0, room: 'lobby' };
const touchMove = { x: 0, y: 0 };

// ------------------------------------------------------------------ helpers
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const smoothstep = (a, b, t) => smooth(clamp((t - a) / (b - a), 0, 1));
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const lerpAngle = (a, b, t) => a + angleDelta(a, b) * t;

function runAnim(duration, update, done) {
  anim = { t: 0, duration: Math.max(0.001, duration), update, done };
}

function stepAnim(dt) {
  if (!anim) return;
  anim.t = Math.min(1, anim.t + dt / anim.duration);
  const current = anim;
  current.update(current.t);
  if (current.t >= 1 && anim === current) {
    anim = null;
    current.done?.();
  }
}

function setFade(v) {
  $('#fade').style.opacity = String(v);
}

function draw() {
  if (fx.on) fx.render(scene, camera);
  else renderer.render(scene, camera);
}

// ------------------------------------------------------------------ loading
function setStatus(text) {
  $('#load-status').textContent = text;
}


async function loadFonts() {
  if (!document.fonts) return;
  const wanted = ['500 40px "EB Garamond"', 'italic 500 40px "EB Garamond"', '600 40px "EB Garamond"', '40px "Patrick Hand"'];
  await Promise.race([Promise.all(wanted.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 3500))]).catch(() => {});
}

function dateRange(items) {
  const fmt = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric' });
  if (!items.length) return 'recently';
  const last = items[items.length - 1].saved;
  return `${fmt(items[0].saved)} and ${fmt(last)}, ${new Date(last).getFullYear()}`;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function boot() {
  setStatus('Unpacking the crates…');
  const manifest = await fetchJson('content/manifest.json');
  if (!manifest) throw new Error('The collection is missing (content/manifest.json). Run: python tools/build_assets.py');
  // Entries written by the curation pipeline never override hand-written ones.
  SOURCES = (await fetchJson('content/sources.json')) || {};
  const generated = await fetchJson('data/catalog.json');
  for (const [id, work] of Object.entries(generated || {})) if (!WORKS[id]) WORKS[id] = { ...work, generated: true };
  const layout = await fetchJson('data/layout.json');
  for (const [key, wing] of Object.entries(layout?.wings || {})) {
    WINGS[key] = { name: wing.name, subtitle: wing.subtitle, statement: wing.statement, accent: wing.accent, template: wing.template, generated: true };
  }
  // Plaque text the collector approved in the private lab wins over both catalogues.
  const overrides = await fetchJson('data/overrides.json');
  for (const [id, text] of Object.entries(overrides || {})) {
    WORKS[id] = { ...(WORKS[id] || { wing: 'lobby', artist: 'Unknown artist', generated: true }), ...text };
  }
  for (const [id, credit] of Object.entries(CREDITS)) if (WORKS[id]) WORKS[id].credit = credit;
  collection = manifest;
  await loadFonts();
  art = makeArt({ renderer, perf, works: WORKS, lowPower, maxTexture: MAX_TEXTURE, isLoading: () => state === 'loading' });
  await art.prepare(manifest.items);
  setStatus('Lighting the rooms…');
  await new Promise((r) => setTimeout(r, 30));
  // Anything no room has claimed goes on the Entrance Hall's acquisition easels.
  const placed = new Set(Object.keys(WORKS).filter((id) => !WORKS[id].generated));
  for (const wing of Object.values(layout?.wings || {})) for (const id of wing.works || []) placed.add(id);
  const acquisitions = manifest.items.filter((i) => !placed.has(i.id)).map((i) => i.id).reverse();
  const withheld = new Set(manifest.withheld || []);
  world = buildWorld({
    scene,
    art: art.entries,
    acquisitions,
    withheld,
    layout,
    summary: {
      count: manifest.items.length + withheld.size,
      videos: manifest.items.filter((i) => i.video).length,
      touch: touchFirst,
      range: dateRange(manifest.items),
    },
  });
  gator = makeGator({
    world,
    ground,
    walkable,
    heightsAt,
    floorTop,
    faceAhead,
    modelUrl: manifest.gator || null,
    // His name, if you've learned it here before (gator.js: by following him).
    known: guideKnown(),
    onName: introduce,
    // Compile his materials as soon as he arrives, not on first sight.
    onReady: (root) => renderer.compile(root, camera, scene),
  });
  // Fewer draw calls: what never moves, merged per material (batch.js; `?nomerge` to compare).
  if (!params.has('nomerge')) {
    const merged = mergeStatic(world);
    perf.note(`meshes ${merged.before} -> ${merged.after}`);
  }
  gpu = makeGpu({ renderer, scene, camera, fx, perf, world, gator, lowPower, previewHeight: PREVIEW_H, applyRoom, runAnimators, player, state: () => state });
  art.attach(world, { onRoomArrived: (id) => gpu.roomChanged(id) });
  videos = makeVideos({ world, audio, paused: !!collection.videosPaused });
  renderCredits();
  enterRoom('lobby');
  await gpu.prepare();
  arriveAtStart(world.rooms.lobby);
  updateCamera();
  // The way in loads first; everything else keeps arriving while you walk.
  const entrance = [...new Set([...world.rooms.lobby.artworks.map((m) => m.userData.id), ...world.featured])];
  art.plan('lobby', entrance);
  const bar = $('#load-bar span');
  await art.whenLoaded(entrance, 12000, (done, total) => {
    bar.style.width = `${(done / total) * 100}%`;
    setStatus(`Hanging the entrance · ${done} / ${total}`);
  });
  draw();
  state = 'ready';
  setStatus(acquisitions.length ? `${manifest.items.length} works on view · ${acquisitions.length} new acquisition${acquisitions.length > 1 ? 's' : ''}` : `${manifest.items.length} works on view`);
  const enter = $('#enter');
  enter.disabled = false;
  enter.focus({ preventScroll: true });
  $('#intro').classList.add('ready');
}

// ------------------------------------------------------------------- rooms
// Keep only the room you're in playing (and nothing while the page is hidden).
document.addEventListener('visibilitychange', () => videos?.sync(player.room));

function applyRoom(id) {
  for (const [rid, room] of Object.entries(world.rooms)) room.group.visible = rid === id;
  const env = world.rooms[id].env;
  // (Made once per room.)
  env.background ||= new THREE.Color(env.bg);
  env.sceneFog ||= env.fog.type === 'exp2' ? new THREE.FogExp2(env.fog.color, env.fog.density) : new THREE.Fog(env.fog.color, env.fog.near, env.fog.far);
  scene.background = env.background;
  scene.fog = env.sceneFog;
  scene.environmentIntensity = env.envI;
  camera.far = env.far || 140;
}

function enterRoom(id) {
  if (world.rooms[id].pleinAir) gpu.paintPleinAir();
  player.room = id;
  autoWalk = null;
  markVisited(id);
  applyRoom(id);
  videos.sync(id);
  if (state !== 'loading') art.plan(id);
  document.documentElement.style.setProperty('--accent', accentFor(id));
  $('#room-name').textContent = WINGS[id].name;
  audio.setMood(moodFor(id));
}

const clockTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;


function settle(roomId) {
  const h = ground(world.rooms[roomId], player.x, player.z, player.y);
  if (h !== null) player.y = h;
}

function runAnimators(roomId, t, dt, cam) {
  for (const a of world.animators) if (a.room === roomId) a.fn(t, dt, cam);
}


// ------------------------------------------------------------------ camera
function updateCamera() {
  if (camPose) {
    camera.position.set(camPose.x, camPose.y, camPose.z);
    camera.rotation.set(camPose.pitch, camPose.yaw, 0, 'YXZ');
  } else {
    const speed = Math.hypot(player.vx, player.vz);
    const bob = reducedMotion ? 0 : Math.sin(player.bob * Math.PI) * 0.028 * Math.min(1, speed / 2.7);
    camera.position.set(player.x, player.ey + EYE_HEIGHT + bob, player.z);
    camera.rotation.set(player.pitch, player.yaw, player.roll, 'YXZ');
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

function playerPose() {
  return { x: player.x, y: player.ey + EYE_HEIGHT, z: player.z, yaw: player.yaw, pitch: player.pitch };
}

function lerpPose(a, b, t) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), yaw: lerpAngle(a.yaw, b.yaw, t), pitch: lerp(a.pitch, b.pitch, t) };
}

// ----------------------------------------------------------------- walking
function key(code) {
  return keys.has(code);
}

function walkUpdate(dt) {
  const f = (key('KeyW') || key('ArrowUp') ? 1 : 0) - (key('KeyS') || key('ArrowDown') ? 1 : 0) + touchMove.y;
  const s = (key('KeyD') ? 1 : 0) - (key('KeyA') ? 1 : 0) + touchMove.x;
  const turn = (key('ArrowLeft') ? 1 : 0) - (key('ArrowRight') ? 1 : 0);
  if (turn) player.yaw += turn * 1.9 * dt;
  const speed = key('ShiftLeft') || key('ShiftRight') ? 5.2 : 2.7;
  let ix = 0;
  let iz = 0;
  const len = Math.hypot(f, s);
  if (len > 0.05 || turn) autoWalk = null;
  if (len > 0.05) {
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const n = Math.max(1, len);
    ix = (-sin * f + cos * s) / n;
    iz = (-cos * f - sin * s) / n;
  } else if (autoWalk) {
    // Tap-to-walk: head for the spot, turning to face it; give up if blocked.
    const dx = autoWalk.x - player.x;
    const dz = autoWalk.z - player.z;
    const dist = Math.hypot(dx, dz);
    autoWalk.t += dt;
    if (autoWalk.t > 0.7) {
      if (Math.hypot(player.x - autoWalk.px, player.z - autoWalk.pz) < 0.15) autoWalk = null;
      else Object.assign(autoWalk, { t: 0, px: player.x, pz: player.z });
    }
    if (autoWalk && dist < 0.3 && !autoWalk.door) autoWalk = null;
    if (autoWalk) {
      const ease = autoWalk.door ? 1 : Math.min(1, dist / 1.2 + 0.25);
      ix = (dx / dist) * ease;
      iz = (dz / dist) * ease;
      player.yaw = lerpAngle(player.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 3.5));
    }
  }
  const k = 1 - Math.exp(-dt * 10);
  player.vx += (ix * speed - player.vx) * k;
  player.vz += (iz * speed - player.vz) * k;
  const room = world.rooms[player.room];
  // If you ever end up somewhere you couldn't have walked to, any step onto
  // floor is allowed until you're clear again.
  const stuck = walkable(room, player.x, player.z, 0.38, player.y) === null;
  const step = (x, z) => walkable(room, x, z, 0.38, player.y) ?? (stuck ? ground(room, x, z, player.y) : null);
  const nx = player.x + player.vx * dt;
  const hx = step(nx, player.z);
  if (hx !== null) {
    player.x = nx;
    player.y = hx;
  } else player.vx = 0;
  const nz = player.z + player.vz * dt;
  const hz = step(player.x, nz);
  if (hz !== null) {
    player.z = nz;
    player.y = hz;
  } else player.vz = 0;
  if (room.wrap) {
    const { x: ox, z: oz, L } = room.wrap;
    const sx = Math.round((player.x - ox) / L) * L;
    const sz = Math.round((player.z - oz) / L) * L;
    if (sx || sz) {
      player.x -= sx;
      player.z -= sz;
      autoWalk = null;
    }
  }
  player.ey += (player.y - player.ey) * Math.min(1, dt * 14);
  const moving = Math.hypot(player.vx, player.vz);
  if (moving > 0.3) {
    player.bob += dt * moving * 0.75;
    player.stepAcc += moving * dt;
    if (player.stepAcc > 0.7) {
      player.stepAcc = 0;
      audio.step(room.surface);
    }
  }
  for (const p of room.portals) {
    const dx = player.x - p.pos.x;
    const dz = player.z - p.pos.z;
    const along = dx * p.normal.x + dz * p.normal.z;
    const lateral = Math.abs(dx * p.normal.z - dz * p.normal.x);
    const into = -(player.vx * p.normal.x + player.vz * p.normal.z);
    if (along < 0.8 && along > -0.5 && lateral < p.w / 2 - 0.15 && into > 0.4 && Math.abs(player.y - p.pos.y) < 1.2) {
      startPortal(p);
      return;
    }
  }
}

const raycaster = new THREE.Raycaster();
raycaster.far = 8;
const center = new THREE.Vector2(0, 0);

function updateHover() {
  const room = world.rooms[player.room];
  raycaster.setFromCamera(center, camera);
  const hit = raycaster.intersectObjects(room.artworks, false)[0];
  hovered = hit ? hit.object : null;
  let hint = '';
  if (hovered) {
    const work = hovered.userData.work;
    const listen = hovered.userData.entry.audio && !audio.muted ? ' and listen' : '';
    hint = `<b>${escapeHtml(work?.title || 'New acquisition')}</b><span>${usingTouch ? 'Tap it' : 'Press <kbd>E</kbd>'} to look closer${listen}</span>`;
  } else {
    for (const p of room.portals) {
      const dx = player.x - p.pos.x;
      const dz = player.z - p.pos.z;
      const along = dx * p.normal.x + dz * p.normal.z;
      const lateral = Math.abs(dx * p.normal.z - dz * p.normal.x);
      const facingIt = -(-Math.sin(player.yaw) * p.normal.x - Math.cos(player.yaw) * p.normal.z);
      if (along > 0 && along < 4.5 && lateral < p.w && facingIt > 0.6 && Math.abs(player.y - p.pos.y) < 1.2) {
        hint = `<span>${usingTouch ? 'Tap the door or walk in' : 'Walk into the painting to enter'}</span><b>${escapeHtml(WINGS[p.dest].name)}</b>`;
        break;
      }
    }
  }
  setHint(hint || guideHint());
}

// Callout labels: on the work you're looking at (the default), on every
// work, or off. Never while looking closer: the caption has the words then.
const LABEL_MODES = ['look', 'always', 'off'];
const LABEL_TEXT = { look: 'Labels: on the work you look at', always: 'Labels: always on', off: 'Labels: off' };
let labelMode = 'look';
try {
  const saved = localStorage.getItem('coolimages.labels');
  if (LABEL_MODES.includes(saved)) labelMode = saved;
} catch {}
function cycleLabels() {
  labelMode = LABEL_MODES[(LABEL_MODES.indexOf(labelMode) + 1) % LABEL_MODES.length];
  try {
    localStorage.setItem('coolimages.labels', labelMode);
  } catch {}
  $('#labels-toggle').textContent = LABEL_TEXT[labelMode];
  toast(LABEL_TEXT[labelMode]);
}
function updateDecals(dt) {
  const k = Math.min(1, dt * 7);
  for (const m of world.rooms[player.room].artworks) {
    const d = m.userData.decal;
    if (!d) continue;
    const want = state === 'inspect' || state === 'transition' || labelMode === 'off' ? 0 : labelMode === 'always' || (state === 'walk' && hovered === m) ? 1 : 0;
    const o = d.material.opacity + (want - d.material.opacity) * k;
    d.material.opacity = o < 0.01 ? 0 : o;
    d.visible = d.material.opacity > 0;
    // The work you're looking at gets its labels drawn over everything (until
    // they have faded out), so a nearby wall, column or frame can't cut them.
    if (hovered === m) d.userData.over = true;
    else if (!d.visible) d.userData.over = false;
    d.material.depthTest = !d.userData.over;
  }
}
let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

let lastHint = null;
function setHint(html) {
  if (html === lastHint) return;
  lastHint = html;
  const el = $('#hint');
  el.innerHTML = html;
  el.classList.toggle('show', !!html);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// --------------------------------------------------------------- portals
function startPortal(portal) {
  const arrival = arrivalFor(world, portal);
  if (!arrival) return;
  autoWalk = null;
  state = 'transition';
  setHint('');
  audio.whoosh();
  // A different way through each time (transitions.js); a plain fade for
  // reduced motion.
  const way = reducedMotion ? null : pickTransition(forcedTransition);
  forcedTransition = null;
  const apply = (o) => {
    player.roll = o.roll || 0;
    camera.fov = baseFov + (o.fov || 0);
    setFade(o.fade || 0);
    fx.set(o.fx || 0, o.amount || 0, o.dir ?? way?.dir ?? 1);
  };
  const from = { x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch };
  const targetYaw = Math.atan2(portal.normal.x, portal.normal.z);
  const through = { x: portal.pos.x - portal.normal.x * 0.1, z: portal.pos.z - portal.normal.z * 0.1 };
  runAnim(way ? way.dur[0] : 0.45, (t) => {
    const e = t * t * t;
    player.x = lerp(from.x, through.x, e);
    player.z = lerp(from.z, through.z, e);
    player.yaw = lerpAngle(from.yaw, targetYaw, smooth(Math.min(1, t * 1.6)));
    player.pitch = lerp(from.pitch, 0, smooth(t));
    apply(way ? way.out(t, way.dir) : { fade: smoothstep(0.3, 1, t) });
  }, () => {
    enterRoom(portal.dest);
    perf.time('gatorEnter', () => gator?.entered(portal.dest, arrival, elapsed));
    const s = spawnFrom(arrival);
    const start = { x: arrival.pos.x + arrival.normal.x * 0.2, z: arrival.pos.z + arrival.normal.z * 0.2 };
    player.x = start.x;
    player.z = start.z;
    player.y = player.ey = s.y;
    player.yaw = s.yaw;
    player.pitch = 0;
    player.vx = player.vz = 0;
    runAnim(way ? way.dur[1] : 0.45, (t) => {
      const e = 1 - Math.pow(1 - t, 3);
      player.x = lerp(start.x, s.x, e);
      player.z = lerp(start.z, s.z, e);
      settle(portal.dest);
      player.ey = player.y;
      apply(way ? way.in(t, way.dir) : { fade: 1 - smoothstep(0, 0.7, t) });
    }, () => {
      apply({});
      camera.fov = baseFov;
      state = 'walk';
      showBanner(portal.dest);
    });
  });
}

let bannerTimer = null;

// The alligator has a name you learn by following him (gator.js). Once you
// have, it's remembered on this device (not the name: that you know it), and
// looking at him shows it.
const GUIDE_KEY = 'coolimages:guide';
function guideKnown() {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1';
  } catch {
    return false;
  }
}
function introduce(name) {
  try {
    localStorage.setItem(GUIDE_KEY, '1');
  } catch {
    // (private browsing: he'll just have to tell you again)
  }
  // After the room's own banner has had a moment, as he turns to face you.
  setTimeout(() => {
    const el = $('#banner');
    el.querySelector('h2').textContent = name;
    el.querySelector('p').textContent = 'You followed him far enough to learn his name.';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show', 'long');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('show'), 6500);
  }, 2200);
}
// Looking straight at him, close enough, once you know him.
function guideHint() {
  const name = gator?.name;
  const at = name && gator.where;
  if (!at || at.room !== player.room || Math.abs(at.y - player.y) > 1.5) return '';
  const dx = at.x - player.x;
  const dz = at.z - player.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 9 || dist < 0.5) return '';
  const facing = (-Math.sin(player.yaw) * dx - Math.cos(player.yaw) * dz) / dist;
  return facing > 0.96 ? `<b>${escapeHtml(name)}</b><span>Your guide</span>` : '';
}
function showBanner(id) {
  const el = $('#banner');
  el.querySelector('h2').textContent = WINGS[id].name;
  el.querySelector('p').textContent = WINGS[id].subtitle;
  el.classList.remove('show', 'long');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), 3600);
}

// ---------------------------------------------------------------- inspect
// The caption sits beside the work on wide or landscape screens, below it on
// portrait phones (matches the CSS media queries).
const sideCaption = () => innerWidth >= 820 || innerWidth > innerHeight * 1.2;

function inspectPose(mesh) {
  const ud = mesh.userData;
  const n = new THREE.Vector3();
  mesh.getWorldDirection(n);
  const c = new THREE.Vector3();
  mesh.getWorldPosition(c);
  const side = sideCaption();
  const regionW = side ? 0.58 : 0.94;
  const regionH = side ? 0.84 : 0.5;
  const tanH = Math.tan(THREE.MathUtils.degToRad(baseFov) / 2);
  const aspect = innerWidth / innerHeight;
  const d = Math.max(ud.viewH / (2 * tanH * regionH), ud.viewW / (2 * tanH * aspect * regionW), 0.6);
  const visH = 2 * d * tanH;
  const visW = visH * aspect;
  let yaw;
  let pitch;
  if (Math.abs(n.y) > 0.95) {
    yaw = player.yaw;
    pitch = -1.5;
  } else {
    yaw = Math.atan2(n.x, n.z);
    pitch = Math.asin(clamp(-n.y, -1, 1));
  }
  const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const pos = c.clone().addScaledVector(n, d);
  if (side) pos.addScaledVector(right, (0.5 - regionW / 2) * visW);
  else pos.addScaledVector(up, -(0.5 - regionH / 2) * visH);
  return { x: pos.x, y: pos.y, z: pos.z, yaw, pitch };
}

function startInspect(mesh) {
  if (state !== 'walk') return;
  state = 'transition';
  setHint('');
  audio.chime();
  const from = playerPose();
  const to = inspectPose(mesh);
  inspect = { mesh, from };
  if (locked) {
    freeingPointer = true;
    document.exitPointerLock();
  }
  camPose = { ...from };
  showCaption(mesh.userData);
  // Its full-size image, ahead of everything else.
  art.want([mesh.userData.id], true);
  videos.sound(mesh, true);
  runAnim(reducedMotion ? 0.2 : 1.05, (t) => {
    camPose = lerpPose(from, to, smoother(t));
  }, () => {
    state = 'inspect';
  });
}

// Next or previous work in the same room, in walking order.
function roomOrder(roomId) {
  const room = world.rooms[roomId];
  if (room.order) return room.order;
  const b = room.bounds;
  const cx = b.type === 'circle' ? b.x : (b.x0 + b.x1) / 2;
  const cz = b.type === 'circle' ? b.z : (b.z0 + b.z1) / 2;
  const spiral = room.floors.some((f) => f.type === 'helix');
  const key = (m) => {
    m.getWorldPosition(tmpV);
    return spiral ? tmpV.y : Math.atan2(tmpV.x - cx, tmpV.z - cz);
  };
  room.order = [...room.artworks].map((m) => [key(m), m]).sort((a, c) => a[0] - c[0]).map(([, m]) => m);
  return room.order;
}

function inspectStep(dir) {
  if (state !== 'inspect' || !inspect) return;
  const list = roomOrder(inspect.mesh.userData.room);
  if (list.length < 2) return;
  const next = list[(list.indexOf(inspect.mesh) + dir + list.length) % list.length];
  videos.sound(inspect.mesh, false);
  const from = { ...camPose };
  const to = inspectPose(next);
  inspect.mesh = next;
  showCaption(next.userData);
  art.want([next.userData.id], true);
  videos.sound(next, true);
  audio.chime();
  state = 'transition';
  runAnim(reducedMotion ? 0.2 : 0.9, (t) => {
    camPose = lerpPose(from, to, smoother(t));
  }, () => {
    state = 'inspect';
  });
}

function endInspect(immediate = false, relock = true) {
  if (!inspect) return;
  hideCaption();
  videos.sound(inspect.mesh, false);
  const back = inspect.from;
  const from = camPose ? { ...camPose } : back;
  inspect = null;
  if (immediate) {
    camPose = null;
    anim = null;
    return;
  }
  if (relock) requestLock();
  state = 'transition';
  runAnim(reducedMotion ? 0.2 : 0.8, (t) => {
    camPose = lerpPose(from, back, smoother(t));
  }, () => {
    camPose = null;
    state = 'walk';
    if (!locked && !dragLook && !usingTouch) showPause();
  });
}

function showCaption(ud) {
  const work = ud.work;
  const panel = $('#caption');
  panel.querySelector('.kicker').textContent = WINGS[work?.wing]?.name || 'New acquisition';
  panel.querySelector('h2').textContent = work?.title || 'Untitled acquisition';
  panel.querySelector('.artist').textContent = work?.artist || 'Curatorial notes pending';
  panel.querySelector('.medium').textContent = work?.medium || '';
  const { entry } = ud;
  const sound = entry.audio ? (audio.muted ? `, sound off${usingTouch ? '' : ' (press M)'}` : ', with sound') : '';
  panel.querySelector('.saved').textContent = entry.video
    ? `${formatSaved(entry.saved)} · Moving image, ${clockTime(entry.duration || 0)}${sound}`
    : formatSaved(entry.saved);
  renderCaptionCredit(panel.querySelector('.credit'), work, SOURCES[ud.id]);
  if (videos.poor(ud.id)) {
    const plea = document.createElement('span');
    plea.className = 'plea';
    plea.append('Not playing right now: the server is super poor. ', link(SPONSORS, 'Please donate to help \u2665'));
    panel.querySelector('.credit').append(plea);
  }
  panel.querySelector('.note').textContent =
    work?.note || 'This image arrived after the catalogue was written. The curator is still deciding why it resonates.';
  panel.querySelector('.back').innerHTML = usingTouch
    ? 'Swipe for the next work · tap the picture to step back'
    : '<kbd>&larr;</kbd><kbd>&rarr;</kbd> next work · <kbd>E</kbd> or <kbd>W</kbd> to step back';
  const many = roomOrder(ud.room).length > 1;
  panel.querySelector('.nav').hidden = !many;
  panel.classList.add('show');
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('inspecting');
}

function link(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function renderCaptionCredit(el, work, source) {
  el.replaceChildren();
  const credit = work?.credit;
  const credited = credit?.sourceUrl || credit?.profileUrl;
  if (credited) {
    el.append('Credit: ');
    el.append(credit.profileUrl ? link(credit.profileUrl, credit.creator || credit.handle || 'the artist') : credit.creator || 'the artist');
    if (credit.sourceUrl) el.append(' · ', link(credit.sourceUrl, 'original'));
    if (credit.license) el.append(` · ${credit.license}`);
  }
  if (traced(source)) {
    if (credited) el.append(document.createElement('br'));
    const when = source.postedAt ? `, ${new Date(source.postedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
    el.append('Saved from ', link(source.url, `@${source.author.handle}\u2019s post`), when);
    if (!credited) el.append(document.createElement('br'), 'Maker not confirmed. ', link(REMOVAL_URL, 'Know who made it?'));
  } else if (!credited) {
    el.append('Creator not yet identified. ', link(REMOVAL_URL, 'Know who made it?'));
  }
}

function renderCredits() {
  const list = $('#credit-list');
  list.replaceChildren();
  const present = new Set([...collection.items.map((i) => i.id), ...(collection.withheld || [])]);
  const withheld = new Set(collection.withheld || []);
  for (const wing of Object.keys(WINGS)) {
    const works = Object.entries(WORKS).filter(([id, w]) => w.wing === wing && present.has(id));
    if (!works.length) continue;
    const h = document.createElement('h3');
    h.textContent = WINGS[wing].name;
    list.append(h);
    const ul = document.createElement('ul');
    for (const [id, w] of works) {
      const li = document.createElement('li');
      const title = document.createElement('i');
      title.textContent = w.title;
      li.append(title, ' — ');
      const c = w.credit;
      const src = SOURCES[id];
      if (c?.profileUrl) li.append(link(c.profileUrl, c.creator || c.handle));
      else if (traced(src)) li.append(c?.creator || w.artist, ' · via ', link(src.url, `@${src.author.handle}`));
      else li.append(c?.creator || w.artist);
      if (c?.sourceUrl) li.append(' · ', link(c.sourceUrl, 'original'));
      if (withheld.has(id)) li.append(' · not shown online');
      ul.append(li);
    }
    list.append(ul);
  }
  if (collection.gator) {
    const h = document.createElement('h3');
    h.textContent = 'Also in the museum';
    const ul = document.createElement('ul');
    const li = document.createElement('li');
    li.append(
      'The alligator: ',
      link('https://sketchfab.com/3d-models/alligator-realistic-3d-model-demo-free-80af5463728149baba78b12f70f6ff5c', '“ALLIGATOR – Realistic 3D Model (DEMO FREE)”'),
      ' by ',
      link('https://sketchfab.com/WildMesh_3D', 'WildMesh 3D'),
      ', ',
      link('https://creativecommons.org/licenses/by-nc/4.0/', 'CC BY-NC 4.0'),
      '. Converted, scaled and set walking by the museum.',
    );
    ul.append(li);
    list.append(h, ul);
  }
}

function openCredits() {
  if (state === 'walk' || state === 'inspect') {
    if (locked) document.exitPointerLock();
    else showPause();
  }
  $('#credits').removeAttribute('hidden');
  $('#credits-close').focus({ preventScroll: true });
}

function closeCredits() {
  $('#credits').setAttribute('hidden', '');
}

function hideCaption() {
  const panel = $('#caption');
  document.body.classList.remove('inspecting');
  panel.classList.remove('show');
  panel.setAttribute('aria-hidden', 'true');
}

// ------------------------------------------------------------------ input
// Pointer lock gives mouse-look; where it's unavailable (embedded browsers,
// some privacy settings) fall back to click-and-drag looking.
let dragLook = TEST;
let lastUnlock = 0;
let freeingPointer = false;
let lockWorked = false;
let drag = null;
let lastDragMoved = 0;
if (dragLook) document.body.classList.add('drag-look');

function enableDragLook() {
  dragLook = true;
  document.body.classList.add('drag-look');
  $('#pause').setAttribute('hidden', '');
  if (state === 'paused') state = 'walk';
}

function lockFailed() {
  // Once pointer lock has worked, a refusal (the post-Esc cooldown, or a
  // request without a user gesture) means "retry", not "unsupported".
  if (lockWorked || performance.now() - lastUnlock < 1600) showPause('Click to resume');
  else enableDragLook();
}

function requestLock() {
  if (usingTouch || dragLook) return;
  if (!canvas.requestPointerLock) {
    enableDragLook();
    return;
  }
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(lockFailed);
  } catch {
    lockFailed();
  }
}
document.addEventListener('pointerlockerror', lockFailed);

canvas.addEventListener('mousedown', (e) => {
  if (locked || usingTouch || e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
});
addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (state !== 'walk') return;
  player.yaw -= dx * 0.005;
  player.pitch = clamp(player.pitch - dy * 0.005, -1.35, 1.35);
});
addEventListener('mouseup', () => {
  lastDragMoved = drag ? drag.moved : 0;
  drag = null;
});

function begin() {
  if (state !== 'ready') return;
  $('#intro').classList.add('gone');
  setTimeout(() => $('#intro').setAttribute('hidden', ''), 900);
  audio.start(moodFor(player.room));
  $('#mute').textContent = audio.muted ? 'Sound off' : 'Sound on';
  $('#mute').setAttribute('aria-pressed', String(!audio.muted));
  $('#pause-mute').textContent = audio.muted ? 'Turn sound on' : 'Turn sound off';
  state = 'walk';
  requestLock();
  showBanner('lobby');
  $('#legend').classList.add('show');
  setTimeout(() => $('#legend').classList.remove('show'), 9000);
  if (usingTouch) {
    // A ghost joystick shows where the left thumb goes, until it's used.
    const stick = $('#stick');
    stick.style.transform = `translate(28px, ${innerHeight - 190}px)`;
    stick.classList.add('show', 'ghost');
    $('#touch-legend').classList.add('show');
    setTimeout(() => {
      stick.classList.remove('ghost');
      if (!touchMove.x && !touchMove.y) stick.classList.remove('show');
      $('#touch-legend').classList.remove('show');
    }, 7000);
  }
}

function showPause(message = 'Paused') {
  if (inspect) endInspect(true);
  if (state === 'walk' || state === 'inspect') state = 'paused';
  $('#pause h2').textContent = message;
  $('#pause').removeAttribute('hidden');
}

function resume() {
  $('#pause').setAttribute('hidden', '');
  if (state === 'paused') state = 'walk';
  requestLock();
}

function toggleMute() {
  audio.setMuted(!audio.muted);
  $('#mute').textContent = audio.muted ? 'Sound off' : 'Sound on';
  $('#mute').setAttribute('aria-pressed', String(!audio.muted));
  $('#pause-mute').textContent = audio.muted ? 'Turn sound on' : 'Turn sound off';
  if (inspect) {
    videos.sound(inspect.mesh, true);
    showCaption(inspect.mesh.userData);
  }
}

// ------------------------------------------------------------------- map
// A map of every room and door, laid out once by a small force simulation.
// Rooms you've been to can be revisited straight from it.
const visited = new Set(['lobby']);
try {
  for (const id of JSON.parse(localStorage.getItem('coolimages.visited') || '[]')) visited.add(id);
} catch {}
function markVisited(id) {
  if (visited.has(id)) return;
  visited.add(id);
  if (world?.rooms[id]?.secret) mapLayout = null;
  try {
    localStorage.setItem('coolimages.visited', JSON.stringify([...visited]));
  } catch {}
}

let mapLayout = null;
let mapPick = null;
// Floors as bands: upstairs on top, the ground floor, the basement below.
// Within a floor, rooms are ordered by where their neighbours sit (a few
// barycentre passes), then wrapped into rows that fit the screen.
function layoutMap() {
  const portrait = innerWidth < innerHeight;
  const W = portrait ? 600 : 1000;
  const perRow = portrait ? 3 : 5;
  const font = portrait ? 25 : 17;
  const rowGap = portrait ? 132 : 104;
  const shown = (id) => !world.rooms[id].secret || visited.has(id);
  const ids = Object.keys(world.rooms).filter(shown);
  const edges = [];
  const seen = new Set();
  for (const p of world.portals) {
    if (!shown(p.room) || !shown(p.dest)) continue;
    const k = [p.room, p.dest].sort().join('|');
    if (!seen.has(k)) {
      seen.add(k);
      edges.push([p.room, p.dest]);
    }
  }
  const floor = (id) => (world.plan?.stairs?.down === id ? 'down' : WINGS[id]?.generated ? 'up' : 'ground');
  const neighbours = Object.fromEntries(ids.map((id) => [id, []]));
  for (const [a, b] of edges) {
    neighbours[a].push(b);
    neighbours[b].push(a);
  }
  const levels = ['up', 'ground', 'down'].map((f) => ids.filter((id) => floor(id) === f)).filter((l) => l.length);
  const x = Object.fromEntries(ids.map((id, i) => [id, i]));
  const place = (level) => {
    const rows = [];
    for (let i = 0; i < level.length; i += perRow) rows.push(level.slice(i, i + perRow));
    for (const row of rows) row.forEach((id, i) => (x[id] = W / 2 + (i - (row.length - 1) / 2) * (W / perRow)));
    return rows;
  };
  let rows = [];
  for (let pass = 0; pass < 8; pass++) {
    rows = [];
    for (const level of levels) {
      const bary = (id) => (neighbours[id].length ? neighbours[id].reduce((sum, n) => sum + x[n], 0) / neighbours[id].length : x[id]);
      level.sort((a, b) => bary(a) - bary(b));
      rows.push(...place(level).map((row) => ({ row, level: floor(row[0]) })));
    }
  }
  const pos = {};
  const labels = [];
  let y = 64;
  let lastLevel = null;
  for (const { row, level } of rows) {
    if (level !== lastLevel) {
      labels.push({ y: y - (portrait ? 44 : 34), text: { up: 'Upstairs', ground: 'Ground floor', down: 'Basement' }[level] });
      lastLevel = level;
    }
    for (const id of row) pos[id] = { x: x[id], y };
    y += rowGap;
  }
  return { pos, edges, floor, labels, font, W, H: y - rowGap + 60, portrait, maxW: W / perRow - 16 };
}

// Long names break over two lines.
function mapLines(name, max = 16) {
  if (name.length <= max) return [name];
  const mid = name.length / 2;
  let cut = -1;
  for (let i = 0; i < name.length; i++) if (name[i] === ' ' && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
  return cut < 0 ? [name] : [name.slice(0, cut), name.slice(cut + 1)];
}

function drawMap() {
  const portrait = innerWidth < innerHeight;
  if (!mapLayout || mapLayout.portrait !== portrait) mapLayout = layoutMap();
  const { pos, edges, floor, labels, font, W, H, maxW } = mapLayout;
  const svg = $('#map-svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, text) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text) n.textContent = text;
    return n;
  };
  svg.replaceChildren();
  const pick = mapPick || player.room;
  for (const l of labels) svg.append(mk('text', { x: 14, y: l.y, class: 'level', style: `font-size:${font * 0.7}px` }, l.text));
  for (const [a, b] of edges) {
    const hot = a === pick || b === pick;
    svg.append(mk('line', { x1: pos[a].x, y1: pos[a].y, x2: pos[b].x, y2: pos[b].y, class: hot ? 'edge hot' : 'edge' }));
  }
  for (const id of Object.keys(pos)) {
    const { x, y } = pos[id];
    const lines = mapLines(WINGS[id].name, mapLayout.portrait ? 12 : 16);
    const w = Math.min(maxW, Math.max(...lines.map((t) => t.length)) * font * 0.52 + font * 1.4);
    const h = font * (lines.length === 1 ? 2 : 2.9);
    const g = mk('g', { class: `room ${floor(id)}${visited.has(id) ? ' visited' : ''}${id === player.room ? ' here' : ''}${id === pick ? ' pick' : ''}`, 'data-id': id, tabindex: 0, role: 'button', 'aria-label': WINGS[id].name });
    g.append(mk('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: Math.min(h / 2, 22) }));
    lines.forEach((t, i) => g.append(mk('text', { x, y: y + font * 0.35 + (i - (lines.length - 1) / 2) * font * 1.05, 'text-anchor': 'middle', style: `font-size:${font}px` }, t)));
    if (id === player.room) g.append(mk('text', { x, y: y + h / 2 + font * 0.85, 'text-anchor': 'middle', class: 'you', style: `font-size:${font * 0.62}px` }, 'You are here'));
    svg.append(g);
  }
  const info = $('#map-info');
  const doors = world.rooms[pick].portals.filter((p) => !world.rooms[p.dest].secret || visited.has(p.dest)).map((p) => WINGS[p.dest].name);
  const where = { ground: 'Ground floor', up: 'Upstairs', down: 'Basement' }[floor(pick)];
  info.textContent = `${WINGS[pick].name} \u00b7 ${where}. Doors to ${[...new Set(doors)].join(', ')}.`;
  const go = $('#map-go');
  go.hidden = pick === player.room;
  go.disabled = !visited.has(pick);
  go.textContent = visited.has(pick) ? `Go to ${WINGS[pick].name}` : 'Not visited yet: find a door that leads here';
}

function openMap() {
  if (state === 'transition' || state === 'loading' || state === 'ready') return;
  if (inspect) endInspect(true);
  if (locked) {
    freeingPointer = true;
    document.exitPointerLock();
  }
  $('#pause').setAttribute('hidden', '');
  state = 'map';
  autoWalk = null;
  mapPick = null;
  drawMap();
  $('#museum-map').removeAttribute('hidden');
  $('#map-close').focus({ preventScroll: true });
}

function closeMap(relock = true) {
  $('#museum-map').setAttribute('hidden', '');
  if (state === 'map') state = 'walk';
  if (relock) requestLock();
}

// Where a room is entered from the map: its start (inside the museum's front
// doors), else in front of its entrance.
function arriveAtStart(room) {
  const s = room.start ? { y: 0, ...room.start } : spawnFrom(room.portals.find((p) => p.entrance) || room.landing || room.portals[0]);
  Object.assign(player, { x: s.x, z: s.z, y: s.y, ey: s.y, yaw: s.yaw, pitch: room.start ? -0.04 : 0, vx: 0, vz: 0 });
  settle(room.id);
  player.ey = player.y;
}

// Revisit a room: fade out, arrive at its entrance, fade in.
function travelTo(id) {
  closeMap(false);
  requestLock();
  state = 'transition';
  audio.whoosh();
  runAnim(reducedMotion ? 0.2 : 0.5, (t) => setFade(smooth(t)), () => {
    enterRoom(id);
    arriveAtStart(world.rooms[id]);
    perf.time('gatorEnter', () => gator?.entered(id, null, elapsed));
    runAnim(reducedMotion ? 0.2 : 0.6, (t) => setFade(1 - smooth(t)), () => {
      state = 'walk';
      showBanner(id);
    });
  });
}

$('#map-svg').addEventListener('click', (e) => {
  const g = e.target.closest('[data-id]');
  if (!g) return;
  mapPick = g.dataset.id;
  drawMap();
});
$('#map-svg').addEventListener('keydown', (e) => {
  const g = e.target.closest('[data-id]');
  if (!g || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  mapPick = g.dataset.id;
  drawMap();
  $('#map-go').focus();
});
$('#map-go').addEventListener('click', () => {
  if (mapPick && visited.has(mapPick) && mapPick !== player.room) travelTo(mapPick);
});
$('#map-close').addEventListener('click', () => closeMap());
$('#museum-map').addEventListener('click', (e) => {
  if (e.target.id === 'museum-map') closeMap();
});
$('#minimap').addEventListener('click', openMap);
for (const el of document.querySelectorAll('[data-open-map]')) el.addEventListener('click', openMap);
$('#labels-toggle').textContent = LABEL_TEXT[labelMode];
$('#labels-toggle').addEventListener('click', cycleLabels);
$('#menu').addEventListener('click', () => {
  if (state === 'walk' || state === 'inspect') showPause('Menu');
});
$('#caption').querySelector('.prev').addEventListener('click', (e) => {
  e.stopPropagation();
  inspectStep(-1);
});
$('#caption').querySelector('.next').addEventListener('click', (e) => {
  e.stopPropagation();
  inspectStep(1);
});

$('#enter').addEventListener('click', begin);
$('#resume').addEventListener('click', resume);
$('#pause-mute').addEventListener('click', toggleMute);
$('#mute').addEventListener('click', toggleMute);
for (const el of document.querySelectorAll('[data-open-credits]')) el.addEventListener('click', openCredits);
$('#credits-close').addEventListener('click', closeCredits);
$('#removal-link').href = REMOVAL_URL;

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) {
    lockWorked = true;
    $('#pause').setAttribute('hidden', '');
    if (state === 'paused') state = 'walk';
  } else {
    lastUnlock = performance.now();
    if (freeingPointer) freeingPointer = false;
    else if (state === 'walk' || state === 'inspect') showPause();
  }
});

document.addEventListener('mousemove', (e) => {
  if (!locked || state !== 'walk') return;
  player.yaw -= clamp(e.movementX, -250, 250) * SENSITIVITY;
  player.pitch = clamp(player.pitch - clamp(e.movementY, -250, 250) * SENSITIVITY, -1.35, 1.35);
});

canvas.addEventListener('click', (e) => {
  if (usingTouch && e.sourceCapabilities?.firesTouchEvents) return;
  if (lastDragMoved > 6) {
    lastDragMoved = 0;
    return;
  }
  if (!locked && !dragLook && (state === 'walk' || state === 'paused')) {
    resume();
    return;
  }
  // Without pointer lock, a click acts where it lands, like a tap.
  if (dragLook && !locked) {
    tapAt(e.clientX, e.clientY);
    return;
  }
  if (state === 'walk' && hovered) startInspect(hovered);
  else if (state === 'inspect') endInspect();
});

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && state === 'ready') {
    begin();
    return;
  }
  keys.add(e.code);
  if (e.code === 'KeyE') {
    if (state === 'walk' && hovered) startInspect(hovered);
    else if (state === 'inspect') endInspect();
  }
  if (e.code === 'KeyM' && state !== 'loading') toggleMute();
  if (e.code === 'KeyC' && state !== 'loading') openCredits();
  if (e.code === 'KeyL' && state !== 'loading' && state !== 'ready') cycleLabels();
  if (e.code === 'Tab' && (state === 'walk' || state === 'inspect') && $('#credits').hasAttribute('hidden')) {
    e.preventDefault();
    openMap();
    return;
  }
  if (e.code === 'Escape' && !$('#museum-map').hasAttribute('hidden')) {
    closeMap();
    return;
  }
  if (e.code === 'Escape' && !$('#credits').hasAttribute('hidden')) closeCredits();
  if (state === 'inspect' && (e.code === 'ArrowLeft' || e.code === 'KeyA')) inspectStep(-1);
  else if (state === 'inspect' && (e.code === 'ArrowRight' || e.code === 'KeyD')) inspectStep(1);
  else if (state === 'inspect' && MOVE_KEYS.has(e.code)) endInspect();
  if (e.code === 'Escape' && state === 'inspect') endInspect(false, false);
  if (MOVE_KEYS.has(e.code) || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// Touch: the left thumb is a joystick, the right thumb looks around, and a
// quick tap acts on what it lands on (see tapAt). Hybrid devices switch to
// touch mode on their first touch.
let usingTouch = touchFirst;
if (touchFirst) document.body.classList.add('touch');
// On an iPhone or iPad in Safari, how to have it full screen: as an app, from
// the Home Screen (index.html and app/manifest.webmanifest set that up).
const appleTouch = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const asApp = navigator.standalone || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
if (appleTouch && !asApp) $('#install-tip').hidden = false;
{
  const stick = $('#stick');
  const knob = stick.querySelector('span');
  let stickId = null;
  let lookId = null;
  let origin = null;
  let last = null;
  let tap = null;
  let swipe = null;
  canvas.addEventListener('touchstart', (e) => {
    if (!usingTouch) {
      usingTouch = true;
      document.body.classList.add('touch');
    }
    for (const t of e.changedTouches) {
      if (state === 'inspect') {
        swipe = { id: t.identifier, x: t.clientX, y: t.clientY, time: performance.now() };
      } else if (t.clientX < innerWidth * 0.42 && stickId === null && state === 'walk') {
        stickId = t.identifier;
        autoWalk = null;
        origin = { x: t.clientX, y: t.clientY };
        stick.classList.remove('ghost');
        stick.style.transform = `translate(${origin.x - 60}px, ${origin.y - 60}px)`;
        stick.classList.add('show');
      } else if (lookId === null) {
        lookId = t.identifier;
        last = { x: t.clientX, y: t.clientY };
        tap = { time: performance.now(), x: t.clientX, y: t.clientY };
      }
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        const dx = clamp((t.clientX - origin.x) / 50, -1, 1);
        const dy = clamp((t.clientY - origin.y) / 50, -1, 1);
        touchMove.x = dx;
        touchMove.y = -dy;
        knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
      } else if (t.identifier === lookId && state === 'walk') {
        player.yaw -= (t.clientX - last.x) * 0.006;
        player.pitch = clamp(player.pitch - (t.clientY - last.y) * 0.006, -1.3, 1.3);
        last = { x: t.clientX, y: t.clientY };
      }
    }
    e.preventDefault();
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (swipe && t.identifier === swipe.id) {
        const dx = t.clientX - swipe.x;
        const dy = t.clientY - swipe.y;
        const quick = performance.now() - swipe.time < 600;
        if (quick && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) inspectStep(dx < 0 ? 1 : -1);
        else if (Math.hypot(dx, dy) < 12) endInspect();
        swipe = null;
      } else if (t.identifier === stickId) {
        stickId = null;
        touchMove.x = touchMove.y = 0;
        knob.style.transform = '';
        stick.classList.remove('show');
      } else if (t.identifier === lookId) {
        lookId = null;
        const quick = tap && performance.now() - tap.time < 280 && Math.hypot(t.clientX - tap.x, t.clientY - tap.y) < 12;
        if (quick) tapAt(t.clientX, t.clientY);
      }
    }
  };
  canvas.addEventListener('touchend', end);
  canvas.addEventListener('touchcancel', end);
}

// A tap (or a click without pointer lock) acts on what it lands on: a
// picture to look closer, a door to walk through, the floor to walk to.
let autoWalk = null;
const tapRay = new THREE.Raycaster();
const tapNdc = new THREE.Vector2();
const tapNormal = new THREE.Vector3();
const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.22, 0.3, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
);
marker.renderOrder = 5;
scene.add(marker);
function tapAt(clientX, clientY) {
  if (state === 'inspect') {
    endInspect();
    return;
  }
  if (state !== 'walk') return;
  const room = world.rooms[player.room];
  tapNdc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  tapRay.setFromCamera(tapNdc, camera);
  tapRay.far = 45;
  const doors = new Map(room.portals.map((p) => [p.surface, p]));
  const hit = tapRay
    .intersectObject(room.group, true)
    .find((h) => h.object.isMesh && (room.artworks.includes(h.object) || doors.has(h.object) || !h.object.material.transparent));
  if (!hit) return;
  if (room.artworks.includes(hit.object) && hit.distance < 16) {
    startInspect(hit.object);
    return;
  }
  const door = doors.get(hit.object);
  if (door && Math.abs(door.pos.y - player.y) < 1.2) {
    autoWalk = { x: door.pos.x - door.normal.x * 0.4, z: door.pos.z - door.normal.z * 0.4, door: true, t: 0, px: player.x, pz: player.z };
    showMarker(door.pos.x + door.normal.x * 0.5, door.pos.y, door.pos.z + door.normal.z * 0.5);
    return;
  }
  if (!hit.face) return;
  tapNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  if (tapNormal.y < 0.6 || Math.abs(hit.point.y - player.y) > 2.6) return;
  autoWalk = { x: hit.point.x, z: hit.point.z, door: false, t: 0, px: player.x, pz: player.z };
  showMarker(hit.point.x, hit.point.y, hit.point.z);
}
let markerT = 1;
function showMarker(x, y, z) {
  marker.position.set(x, y + 0.03, z);
  markerT = 0;
}
function updateMarker(dt) {
  if (markerT >= 1) return;
  markerT = Math.min(1, markerT + dt / 0.9);
  marker.material.opacity = 0.9 * (1 - markerT);
  marker.scale.setScalar(1 + markerT * 0.8);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  baseFov = fovFor(camera.aspect);
  if (state !== 'transition') camera.fov = baseFov;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  sizeMinimap();
});

// ---------------------------------------------------------------- minimap
const mini = $('#minimap');
const mctx = mini.getContext('2d');
function sizeMinimap() {
  const css = mini.clientWidth || 150;
  const dpr = Math.min(devicePixelRatio, 2);
  mini.width = css * dpr;
  mini.height = css * dpr;
}
sizeMinimap();

const tmpV = new THREE.Vector3();

// ------------------------------------------------------------------- loop
const clock = new THREE.Clock();
let elapsed = 0;
let miniTimer = 0;
function simulate(dt) {
  elapsed += dt;
  stepAnim(dt);
  if (state === 'walk') perf.time('walk', () => walkUpdate(dt));
  else {
    player.vx *= 0.8;
    player.vz *= 0.8;
  }
  updateCamera();
  perf.time('animators', () => runAnimators(player.room, elapsed, dt, camera));
  perf.time('gator', () => gator?.update(dt, elapsed, player, state));
  if (state === 'walk') perf.time('hover', updateHover);
  else if (state !== 'inspect') setHint('');
  updateDecals(dt);
  updateMarker(dt);
}

// `sync` (for checks) waits for the GPU before the frame is counted done.
// Works you've walked up to get their full-size images (art.js), nearest
// first. (On phones, only the one you look closer at.)
const UP_CLOSE = 6;
let closeTimer = 0;
function wantCloseWorks(dt) {
  closeTimer -= dt;
  if (lowPower || state !== 'walk' || closeTimer > 0) return;
  closeTimer = 0.25;
  const close = [];
  for (const m of world.rooms[player.room].artworks) {
    m.getWorldPosition(tmpV);
    const d = Math.hypot(tmpV.x - player.x, tmpV.z - player.z);
    if (d < UP_CLOSE && Math.abs(tmpV.y - (player.y + EYE_HEIGHT)) < 3) close.push([d, m.userData.id]);
  }
  if (close.length) art.want(close.sort((a, b) => a[0] - b[0]).map(([, id]) => id));
}

function runFrame(dt, sync = null) {
  perf.begin();
  simulate(dt);
  wantCloseWorks(dt);
  perf.time('uploads', () => gpu.pump(art.pump()));
  perf.time('previews', () => gpu.refreshPreviews(dt));
  // The alligator's room grids, a little each frame.
  if (state !== 'loading') perf.time('grids', () => gator?.buildGrids(2.5));
  perf.time('draw', draw);
  miniTimer += dt;
  if (miniTimer > 0.066) {
    miniTimer = 0;
    perf.time('minimap', () => drawMinimap(mctx, world.rooms[player.room], player, accentFor(player.room)));
  }
  if (sync) perf.time('gpu', sync);
  perf.end();
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!world) return;
  runFrame(dt);
}
requestAnimationFrame(frame);

boot().catch((err) => {
  console.error(err);
  setStatus(err.message || 'Something went wrong while hanging the collection.');
  $('#intro').classList.add('error');
});

// Debug/testing hooks (used by automated checks; harmless otherwise).
window.museum = {
  // The built world, for checks (?test only).
  get world() {
    return TEST ? world : undefined;
  },
  get state() {
    return state;
  },
  get player() {
    return { ...player };
  },
  get hovered() {
    return hovered?.userData.id || null;
  },
  get portals() {
    return world.portals.map((p) => ({ room: p.room, dest: p.dest, entrance: !!p.entrance, x: p.pos.x, y: p.pos.y, z: p.pos.z, nx: p.normal.x, nz: p.normal.z, subtitle: p.subtitle, arrives: arrivalFor(world, p)?.room === p.dest }));
  },
  start: begin,
  teleport(roomId, dist = 2.4) {
    const room = world.rooms[roomId];
    const p = room.portals.find((q) => q.entrance) || room.portals[0];
    enterRoom(roomId);
    Object.assign(player, spawnFrom(p, dist), { vx: 0, vz: 0, pitch: 0, roll: 0 });
    settle(roomId);
    player.ey = player.y;
  },
  look(x, z, yaw, pitch = 0, y) {
    Object.assign(player, { x, z, yaw, pitch });
    if (y !== undefined) player.y = y;
    settle(player.room);
    player.ey = player.y;
  },
  walkable: (x, z, y) => walkable(world.rooms[player.room], x, z, 0.38, y),
  tap: (x, y) => tapAt(x, y),
  // The alligator: where he is and what he's doing; `enabled` (turn him off
  // for door checks, he takes up floor); summon() stages his exit from the
  // room you're in.
  gator: {
    get state() {
      return gator.state;
    },
    set enabled(v) {
      gator.enabled = v;
    },
    get enabled() {
      return gator.enabled;
    },
    summon: () => gator.summon(player.room),
    meet: () => gator.meet(player.room, player),
    navStats: (id) => gator.navStats(id),
    walkTo: (x, z, y) => gator.walkTo(x, z, y),
    get clearance() {
      return gator.clearance;
    },
    get y() {
      return gator.y;
    },
  },
  // The ways through a door, and one to use for the next door (for checks).
  transitions: Object.keys(TRANSITIONS),
  set nextTransition(name) {
    forcedTransition = name;
  },
  // For checks: how many works have their full image, and what's still queued.
  // Frame timing: stats(), summary(), reset(), and bench(frames), which runs
  // frames back to back and waits for the GPU after each (so a hidden pane,
  // which otherwise draws no frames, can still be measured).
  perf: {
    stats: () => perf.stats(),
    summary: () => perf.summary(),
    reset: () => perf.reset(),
    bench(frames = 120, dt = 1 / 60) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < frames; i++) runFrame(dt, sync);
      return perf.stats();
    },
  },
  get loading() {
    return { ...art.stats(), ...gpu.stats() };
  },
  // For checks: works that something hides from a viewer standing in front
  // of them (a wall they poke into, a column, an easel). Casts rays to a grid
  // over each picture; returns the ones with blocked points and what blocks.
  audit(roomId) {
    const ray = new THREE.Raycaster();
    const eye = new THREE.Vector3();
    const target = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const out = [];
    for (const room of roomId ? [world.rooms[roomId]] : Object.values(world.rooms)) {
      room.group.updateMatrixWorld(true);
      const solids = [];
      room.group.traverse((o) => {
        if (!o.isMesh || !o.material || o.userData.gator) return;
        const m = o.material;
        if (m.blending === THREE.AdditiveBlending || m.depthWrite === false || (m.transparent && m.opacity < 0.5 && !m.alphaTest)) return;
        solids.push(o);
      });
      for (const art of room.artworks) {
        const { width: w, height: h } = art.geometry.parameters;
        const { viewW, viewH } = art.userData;
        const own = new Set();
        art.userData.group.traverse((o) => own.add(o));
        art.getWorldPosition(target);
        normal.set(0, 0, 1).transformDirection(art.matrixWorld);
        const d = THREE.MathUtils.clamp(1.4 * Math.max(viewW, viewH), 2, 5);
        eye.copy(target).addScaledVector(normal, d);
        const blockers = new Map();
        let blocked = 0;
        let total = 0;
        for (let i = 0; i < 5; i++) {
          for (let j = 0; j < 5; j++) {
            const p = new THREE.Vector3((i / 4 - 0.5) * w * 0.94, (j / 4 - 0.5) * h * 0.94, 0.002).applyMatrix4(art.matrixWorld);
            const dir = p.clone().sub(eye);
            const dist = dir.length();
            ray.set(eye, dir.normalize());
            ray.far = dist - 0.03;
            const hit = ray.intersectObjects(solids, false).find((x) => !own.has(x.object));
            total++;
            if (hit) {
              blocked++;
              const o = hit.object;
              const key = `${o.geometry.type} @ ${o.getWorldPosition(new THREE.Vector3()).toArray().map((v) => v.toFixed(1)).join(',')}`;
              blockers.set(key, (blockers.get(key) || 0) + 1);
            }
          }
        }
        if (blocked) out.push({ room: room.id, id: art.userData.id, blocked: `${blocked}/${total}`, by: [...blockers.entries()].map(([k, n]) => `${k} (${n})`), at: target.toArray().map((v) => +v.toFixed(2)), facing: [+normal.x.toFixed(2), +normal.z.toFixed(2)] });
      }
    }
    return out;
  },
  // Look closer at a work by id, from wherever you are (for checks).
  show(id) {
    const m = world.artworks.find((a) => a.userData.id === id);
    if (!m) return false;
    if (player.room !== m.userData.room) enterRoom(m.userData.room);
    state = 'walk';
    startInspect(m);
    return true;
  },
  // Advance the simulation without waiting for frames (for scripted checks).
  tick(seconds = 1) {
    for (let t = 0; t < seconds; t += 1 / 60) {
      simulate(1 / 60);
      gpu.pump(art.pump());
      gpu.refreshPreviews(1 / 60);
    }
    draw();
  },
  press(code, down = true) {
    if (down) keys.add(code);
    else keys.delete(code);
  },
  map: () => openMap(),
  travel: (id) => travelTo(id),
  step: (dir) => inspectStep(dir),
  get plan() {
    return world.plan;
  },
  inspect() {
    if (hovered) startInspect(hovered);
  },
  back: () => endInspect(),
};
