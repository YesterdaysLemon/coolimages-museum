import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WINGS, WORKS } from './catalog.js';
import { CREDITS, REMOVAL_URL } from './credits.js';
import * as TX from './textures.js';
import { buildWorld, walkable, ground, EYE_HEIGHT, formatSaved, TEMPLATES } from './world.js';
import { MuseumAudio } from './audio.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touchFirst = matchMedia('(pointer: coarse)').matches;
// Phones and small-memory devices get a lower render scale and smaller textures.
const lowPower = touchFirst || (navigator.deviceMemory || 8) <= 4;
const MAX_TEXTURE = lowPower ? 1024 : 2048;
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
TX.setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(baseFov, innerWidth / innerHeight, 0.05, 140);

const audio = new MuseumAudio();
if (params.has('mute')) audio.muted = true;
let world = null;
let collection = null;
let collectionArt = new Map(); // id -> { ...manifest item, work, texture, loaded }
// Where works were saved from (the collector extension's notes).
let SOURCES = {};
const traced = (src) => src?.url && (src.match === 'exact' || src.match === 'page');
let state = 'loading'; // loading | ready | walk | inspect | transition | paused
let locked = false;
let hovered = null;
let anim = null;
let camPose = null;
let inspect = null;
let rollSign = 1;
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

// ------------------------------------------------------------------ loading
function setStatus(text) {
  $('#load-status').textContent = text;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

function ovalMask(img) {
  const c = TX.makeCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.ellipse(img.width / 2, img.height / 2, img.width * 0.492, img.height * 0.495, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, 0, 0);
  return c;
}

// Downscale anything larger than this device should hold on the GPU.
function fitTexture(img) {
  const s = MAX_TEXTURE / Math.max(img.width, img.height);
  if (s >= 1) return img;
  const c = TX.makeCanvas(Math.round(img.width * s), Math.round(img.height * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// Every work starts as its blurred preview (the manifest's `blur`, a tiny
// inline WebP) and sharpens when its image arrives: the Entrance Hall's works
// first, then room by room outward from wherever you are (planLoads).
async function prepareArt(items) {
  const art = new Map();
  await Promise.all(
    items.map(async (item) => {
      const work = WORKS[item.id] || null;
      let img = null;
      if (item.blur) img = await loadImage(item.blur).catch(() => null);
      if (!img) {
        img = TX.makeCanvas(4, 4);
        const ctx = img.getContext('2d');
        ctx.fillStyle = item.color || '#d9d3c7';
        ctx.fillRect(0, 0, 4, 4);
      }
      const texture = new THREE.Texture(work?.oval ? ovalMask(img) : img);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true;
      art.set(item.id, { ...item, work, texture, aspect: item.width / item.height, oval: !!work?.oval, loaded: false, requested: false });
    }),
  );
  return art;
}

const MAX_LOADS = lowPower ? 3 : 6;
const loads = { active: 0, order: [], rooms: new Map(), waiters: [] };
let previewQueue = [];

async function sharpen(entry) {
  try {
    const img = await loadImage(lowPower && entry.small ? entry.small : entry.file);
    const t = entry.texture;
    // A new size needs new GPU storage: drop the placeholder's first.
    t.dispose();
    t.image = entry.oval ? ovalMask(fitTexture(img)) : fitTexture(img);
    if (entry.work?.pixel) t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
  } catch (err) {
    console.warn(err);
  }
  entry.loaded = true;
  world.artLoaded(entry.id);
  // A room whose works have all arrived gets fresh previews on its doors.
  for (const roomId of loads.rooms.get(entry.id) || []) {
    const room = world.rooms[roomId];
    if (room.sharp || !room.artworks.every((m) => collectionArt.get(m.userData.id)?.loaded)) continue;
    room.sharp = true;
    previewQueue.push(...world.portals.filter((p) => p.dest === roomId));
  }
  for (const w of loads.waiters) w();
}

// Load order: `first`, then the works of each room by how many doors away it is.
function planLoads(roomId, first = []) {
  if (!loads.rooms.size) {
    for (const m of world.artworks) {
      const set = loads.rooms.get(m.userData.id) || new Set();
      set.add(m.userData.room);
      loads.rooms.set(m.userData.id, set);
    }
  }
  const seen = new Set([roomId]);
  const queue = [roomId];
  for (let i = 0; i < queue.length; i++) {
    for (const p of world.rooms[queue[i]].portals) {
      if (seen.has(p.dest)) continue;
      seen.add(p.dest);
      queue.push(p.dest);
    }
  }
  for (const id of Object.keys(world.rooms)) if (!seen.has(id)) queue.push(id);
  const ids = [...first, ...queue.flatMap((id) => world.rooms[id].artworks.map((m) => m.userData.id)), ...collectionArt.keys()];
  loads.order = [...new Set(ids)].filter((id) => collectionArt.has(id) && !collectionArt.get(id).requested);
  pumpLoads();
}

function pumpLoads() {
  while (loads.active < MAX_LOADS && loads.order.length) {
    const entry = collectionArt.get(loads.order.shift());
    if (entry.requested) continue;
    entry.requested = true;
    loads.active++;
    sharpen(entry).finally(() => {
      loads.active--;
      pumpLoads();
    });
  }
}

// Resolves when all of `ids` have arrived (or failed), or after `ms`.
function whenLoaded(ids, ms, onProgress) {
  return new Promise((resolve) => {
    const check = () => {
      const done = ids.filter((id) => collectionArt.get(id)?.loaded).length;
      onProgress?.(done, ids.length);
      if (done < ids.length) return;
      loads.waiters = loads.waiters.filter((w) => w !== check);
      resolve();
    };
    loads.waiters.push(check);
    setTimeout(() => {
      loads.waiters = loads.waiters.filter((w) => w !== check);
      resolve();
    }, ms);
    check();
  });
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
  const art = await prepareArt(manifest.items);
  collectionArt = art;
  setStatus('Lighting the rooms…');
  await new Promise((r) => setTimeout(r, 30));
  // Anything no room has claimed goes on the Entrance Hall's acquisition easels.
  const placed = new Set(Object.keys(WORKS).filter((id) => !WORKS[id].generated));
  for (const wing of Object.values(layout?.wings || {})) for (const id of wing.works || []) placed.add(id);
  const acquisitions = manifest.items.filter((i) => !placed.has(i.id)).map((i) => i.id).reverse();
  const withheld = new Set(manifest.withheld || []);
  world = buildWorld({
    scene,
    art,
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
  registerVideos();
  renderCredits();
  renderPreviews();
  enterRoom('lobby');
  arriveAtStart(world.rooms.lobby);
  updateCamera();
  // The way in loads first; everything else keeps arriving while you walk.
  const entrance = [...new Set([...world.rooms.lobby.artworks.map((m) => m.userData.id), ...world.featured])];
  planLoads('lobby', entrance);
  const bar = $('#load-bar span');
  await whenLoaded(entrance, 12000, (done, total) => {
    bar.style.width = `${(done / total) * 100}%`;
    setStatus(`Hanging the entrance · ${done} / ${total}`);
  });
  renderer.render(scene, camera);
  state = 'ready';
  setStatus(acquisitions.length ? `${manifest.items.length} works on view · ${acquisitions.length} new acquisition${acquisitions.length > 1 ? 's' : ''}` : `${manifest.items.length} works on view`);
  const enter = $('#enter');
  enter.disabled = false;
  enter.focus({ preventScroll: true });
  $('#intro').classList.add('ready');
}

// ------------------------------------------------------------------- rooms
function applyRoom(id) {
  for (const [rid, room] of Object.entries(world.rooms)) room.group.visible = rid === id;
  const env = world.rooms[id].env;
  scene.background = new THREE.Color(env.bg);
  scene.fog = env.fog.type === 'exp2' ? new THREE.FogExp2(env.fog.color, env.fog.density) : new THREE.Fog(env.fog.color, env.fog.near, env.fog.far);
  scene.environmentIntensity = env.envI;
  camera.far = env.far || 140;
}

function enterRoom(id) {
  player.room = id;
  autoWalk = null;
  markVisited(id);
  applyRoom(id);
  syncVideos();
  if (state !== 'loading') planLoads(id);
  document.documentElement.style.setProperty('--accent', accentFor(id));
  $('#room-name').textContent = WINGS[id].name;
  audio.setMood(moodFor(id));
}

// ------------------------------------------------------------------ videos
// A video shows its poster until its room is entered, then loops silently.
// Looking closer (E) turns its sound on, unless sound is off.
const videos = new Map(); // id -> { entry, meshes, el, texture }

function registerVideos() {
  for (const mesh of world.artworks) {
    const { id, entry } = mesh.userData;
    if (!entry.video) continue;
    if (!videos.has(id)) videos.set(id, { entry, meshes: [], el: null, texture: null });
    videos.get(id).meshes.push(mesh);
  }
}

// When a video can't be served (the media Worker is over its free daily
// allowance, or videos are paused in the manifest), its frame shows a plea.
let pleaded = false;
function videoUnavailable(v) {
  if (v.poor) return;
  v.poor = true;
  v.el?.pause();
  const texture = TX.toTexture(TX.poorNotice(v.entry.width / v.entry.height));
  for (const mesh of v.meshes) {
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
  }
  if (pleaded) return;
  pleaded = true;
  const note = $('#poor');
  note.hidden = false;
  setTimeout(() => note.classList.add('show'), 30);
  setTimeout(() => note.classList.remove('show'), 12000);
}

function videoElement(v) {
  if (v.el || v.poor) return v.el;
  if (collection.videosPaused) {
    videoUnavailable(v);
    return null;
  }
  const el = document.createElement('video');
  // Videos come from the media host; CORS lets WebGL use their frames.
  el.crossOrigin = 'anonymous';
  el.addEventListener('error', () => videoUnavailable(v));
  Object.assign(el, { muted: true, loop: true, playsInline: true, preload: 'auto', src: v.entry.video });
  // Keep the poster until a real frame has been decoded, so a slow start
  // never shows a black screen.
  const swap = () => {
    if (v.texture) return;
    v.texture = new THREE.VideoTexture(el);
    v.texture.colorSpace = THREE.SRGBColorSpace;
    for (const mesh of v.meshes) {
      mesh.material.map = v.texture;
      mesh.material.needsUpdate = true;
    }
  };
  el.addEventListener(
    'playing',
    () => {
      if (el.requestVideoFrameCallback) el.requestVideoFrameCallback(swap);
      else el.addEventListener('timeupdate', swap, { once: true });
    },
    { once: true },
  );
  v.el = el;
  return el;
}

function syncVideos() {
  for (const v of videos.values()) {
    const here = !document.hidden && v.meshes.some((m) => m.userData.room === player.room);
    if (here) videoElement(v)?.play().catch(() => {});
    else v.el?.pause();
  }
}
document.addEventListener('visibilitychange', () => world && syncVideos());

function videoSound(mesh, on) {
  const v = mesh && videos.get(mesh.userData.id);
  if (!v?.el || !v.entry.audio) return;
  const audible = on && !audio.muted;
  v.el.muted = !audible;
  audio.duck(audible);
}

const clockTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// Where a portal lets you out: the destination's door back to where you came
// from, else its landing (the Stair Hall's balcony), else its entrance.
function arrivalFor(portal) {
  const dest = world.rooms[portal.dest];
  return dest.portals.find((p) => p.dest === portal.room) || dest.landing || dest.portals.find((p) => p.entrance) || dest.portals[0];
}

function spawnFrom(portal, dist = 2.4) {
  return {
    x: portal.pos.x + portal.normal.x * dist,
    z: portal.pos.z + portal.normal.z * dist,
    y: portal.pos.y || 0,
    yaw: Math.atan2(-portal.normal.x, -portal.normal.z),
  };
}

function settle(roomId) {
  const h = ground(world.rooms[roomId], player.x, player.z, player.y);
  if (h !== null) player.y = h;
}

function runAnimators(roomId, t, dt, cam) {
  for (const a of world.animators) if (a.room === roomId) a.fn(t, dt, cam);
}

// Each door shows a picture of the room behind it, rendered into a shared
// multisampled target and copied into the door's own small texture. Doors are
// rendered once at load, and again when their room's works have all arrived.
const preview = { cam: null, shared: new Map(), copyMat: null, copyScene: null, copyCam: null };
function renderPreview(portal) {
  const arrival = arrivalFor(portal);
  if (!arrival) return;
  if (!preview.cam) {
    preview.cam = new THREE.PerspectiveCamera(62, 1, 0.05, 140);
    preview.copyMat = new THREE.MeshBasicMaterial({ toneMapped: false, depthTest: false });
    preview.copyScene = new THREE.Scene();
    preview.copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), preview.copyMat));
    preview.copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  const { cam, shared, copyMat, copyScene, copyCam } = preview;
  const aspect = portal.w / portal.h;
  const W = Math.round(640 * aspect);
  const key = `${W}`;
  if (!shared.has(key)) shared.set(key, new THREE.WebGLRenderTarget(W, 640, { samples: 4 }));
  const big = shared.get(key);
  const s = spawnFrom(arrival, 2.6);
  const destRoom = world.rooms[portal.dest];
  const floorY = ground(destRoom, s.x, s.z, s.y) ?? s.y;
  cam.aspect = aspect;
  cam.far = destRoom.env.far || 140;
  cam.updateProjectionMatrix();
  cam.position.set(s.x, floorY + EYE_HEIGHT, s.z);
  cam.rotation.set(-0.02, s.yaw, 0, 'YXZ');
  cam.updateMatrixWorld();
  applyRoom(portal.dest);
  runAnimators(portal.dest, 1.5, 1 / 60, cam);
  renderer.setRenderTarget(big);
  renderer.render(scene, cam);
  portal.previewTarget ||= new THREE.WebGLRenderTarget(W, 640, { depthBuffer: false });
  copyMat.map = big.texture;
  renderer.setRenderTarget(portal.previewTarget);
  renderer.render(copyScene, copyCam);
  renderer.setRenderTarget(null);
  if (portal.surface.material.map !== portal.previewTarget.texture) {
    portal.surface.material.map = portal.previewTarget.texture;
    portal.surface.material.needsUpdate = true;
  }
}

function paintPleinAir() {
  const room = Object.values(world.rooms).find((r) => r.pleinAir);
  if (!room) return;
  const { material, from, to, hide } = room.pleinAir;
  const cam = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, room.env.far || 140);
  cam.position.copy(from);
  cam.lookAt(to);
  cam.updateMatrixWorld();
  applyRoom(room.id);
  runAnimators(room.id, 30, 1 / 60, cam);
  const target = new THREE.WebGLRenderTarget(640, 480, { samples: 4 });
  // The easel paints the view past itself, not itself.
  hide.visible = false;
  renderer.setRenderTarget(target);
  renderer.render(scene, cam);
  renderer.setRenderTarget(null);
  hide.visible = true;
  material.color.set(0xffffff);
  material.map = target.texture;
  material.needsUpdate = true;
}

function renderPreviews() {
  paintPleinAir();
  for (const portal of world.portals) renderPreview(portal);
  // Compile every room's shaders now so first visits don't hitch.
  for (const id of Object.keys(world.rooms)) {
    applyRoom(id);
    renderer.compile(scene, camera);
  }
}

// One refreshed door per frame, then back to the room you're in.
function refreshPreviews() {
  if (!previewQueue.length || state === 'transition' || state === 'loading') return;
  renderPreview(previewQueue.shift());
  applyRoom(player.room);
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
  setHint(hint);
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
  const arrival = arrivalFor(portal);
  if (!arrival) return;
  autoWalk = null;
  state = 'transition';
  setHint('');
  audio.whoosh();
  rollSign = -rollSign;
  const sign = rollSign;
  const from = { x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch };
  const targetYaw = Math.atan2(portal.normal.x, portal.normal.z);
  const through = { x: portal.pos.x - portal.normal.x * 0.1, z: portal.pos.z - portal.normal.z * 0.1 };
  const roll = !reducedMotion;
  runAnim(roll ? 1.0 : 0.45, (t) => {
    const e = t * t * t;
    player.x = lerp(from.x, through.x, e);
    player.z = lerp(from.z, through.z, e);
    player.yaw = lerpAngle(from.yaw, targetYaw, smooth(Math.min(1, t * 1.6)));
    player.pitch = lerp(from.pitch, 0, smooth(t));
    if (roll) {
      player.roll = sign * (Math.PI / 2) * smoother(t);
      camera.fov = baseFov + 24 * e;
    }
    setFade(smoothstep(0.55, 0.97, t));
  }, () => {
    enterRoom(portal.dest);
    const s = spawnFrom(arrival);
    const start = { x: arrival.pos.x + arrival.normal.x * 0.2, z: arrival.pos.z + arrival.normal.z * 0.2 };
    player.x = start.x;
    player.z = start.z;
    player.y = player.ey = s.y;
    player.yaw = s.yaw;
    player.pitch = 0;
    player.vx = player.vz = 0;
    runAnim(roll ? 1.1 : 0.45, (t) => {
      const e = 1 - Math.pow(1 - t, 3);
      player.x = lerp(start.x, s.x, e);
      player.z = lerp(start.z, s.z, e);
      settle(portal.dest);
      player.ey = player.y;
      if (roll) {
        player.roll = -sign * (Math.PI / 2) * (1 - smoother(t));
        camera.fov = baseFov + 24 * (1 - e);
      }
      setFade(1 - smoothstep(0, 0.55, t));
    }, () => {
      player.roll = 0;
      camera.fov = baseFov;
      setFade(0);
      state = 'walk';
      showBanner(portal.dest);
    });
  });
}

let bannerTimer = null;
function showBanner(id) {
  const el = $('#banner');
  el.querySelector('h2').textContent = WINGS[id].name;
  el.querySelector('p').textContent = WINGS[id].subtitle;
  el.classList.remove('show');
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
  videoSound(mesh, true);
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
  videoSound(inspect.mesh, false);
  const from = { ...camPose };
  const to = inspectPose(next);
  inspect.mesh = next;
  showCaption(next.userData);
  videoSound(next, true);
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
  videoSound(inspect.mesh, false);
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
  if (videos.get(ud.id)?.poor) {
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
    videoSound(inspect.mesh, true);
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
function drawMinimap() {
  const room = world.rooms[player.room];
  const S = mini.width;
  const b = room.wrap ? { type: 'rect', x0: player.x - 60, x1: player.x + 60, z0: player.z - 60, z1: player.z + 60 } : room.bounds;
  const [minX, maxX, minZ, maxZ] = b.type === 'circle' ? [b.x - b.r, b.x + b.r, b.z - b.r, b.z + b.r] : [b.x0, b.x1, b.z0, b.z1];
  const pad = S * 0.1;
  const scale = (S - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  const ox = S / 2 - ((minX + maxX) / 2) * scale;
  const oz = S / 2 - ((minZ + maxZ) / 2) * scale;
  const X = (x) => ox + x * scale;
  const Z = (z) => oz + z * scale;
  mctx.clearRect(0, 0, S, S);
  const levelOf = (f) => (f.type === 'helix' ? player.y : f.ramp ? Math.max(f.ramp.h0, f.ramp.h1) : f.h ?? 0);
  const floors = [...room.floors].sort((a, c) => Math.abs(levelOf(c) - player.y) - Math.abs(levelOf(a) - player.y));
  for (const f of floors) {
    const near = Math.abs(levelOf(f) - player.y) < 1.5 || (f.ramp && player.y >= Math.min(f.ramp.h0, f.ramp.h1) - 0.5 && player.y <= Math.max(f.ramp.h0, f.ramp.h1) + 0.5);
    mctx.fillStyle = near ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.45)';
    mctx.beginPath();
    if (f.type === 'rect') mctx.rect(X(f.x0), Z(f.z0), (f.x1 - f.x0) * scale, (f.z1 - f.z0) * scale);
    else if (f.type === 'circle') mctx.arc(X(f.x), Z(f.z), f.r * scale, 0, Math.PI * 2);
    else {
      const a0 = f.type === 'sector' ? f.a0 : 0;
      const a1 = f.type === 'sector' ? f.a0 + f.span : Math.PI * 2;
      mctx.arc(X(f.x), Z(f.z), f.r1 * scale, a0, a1);
      mctx.arc(X(f.x), Z(f.z), f.r0 * scale, a1, a0, true);
      mctx.closePath();
    }
    mctx.fill();
    if (f.ramp) {
      mctx.strokeStyle = 'rgba(40,32,24,0.25)';
      mctx.lineWidth = S * 0.006;
      const steps = 8;
      for (let i = 1; i < steps; i++) {
        mctx.beginPath();
        if (f.ramp.axis === 'z') {
          const z = f.z0 + ((f.z1 - f.z0) * i) / steps;
          mctx.moveTo(X(f.x0), Z(z));
          mctx.lineTo(X(f.x1), Z(z));
        } else {
          const x = f.x0 + ((f.x1 - f.x0) * i) / steps;
          mctx.moveTo(X(x), Z(f.z0));
          mctx.lineTo(X(x), Z(f.z1));
        }
        mctx.stroke();
      }
    }
  }
  mctx.strokeStyle = 'rgba(40,32,24,0.55)';
  mctx.lineWidth = S * 0.012;
  mctx.beginPath();
  if (b.type === 'circle') mctx.arc(X(b.x), Z(b.z), b.r * scale, 0, Math.PI * 2);
  else mctx.rect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * scale, (b.z1 - b.z0) * scale);
  mctx.stroke();
  mctx.fillStyle = 'rgba(40,32,24,0.12)';
  for (const o of room.obstacles) {
    if (o.y0 !== undefined && (player.y < o.y0 || player.y > o.y1)) continue;
    mctx.beginPath();
    if (o.type === 'circle') mctx.arc(X(o.x), Z(o.z), o.r * scale, 0, Math.PI * 2);
    else if (o.type === 'rect') mctx.rect(X(o.x0), Z(o.z0), (o.x1 - o.x0) * scale, (o.z1 - o.z0) * scale);
    mctx.fill();
  }
  const accent = accentFor(player.room);
  mctx.fillStyle = accent;
  for (const m of room.artworks) {
    m.getWorldPosition(tmpV);
    mctx.fillRect(X(tmpV.x) - S * 0.018, Z(tmpV.z) - S * 0.018, S * 0.036, S * 0.036);
  }
  mctx.strokeStyle = '#c9a24c';
  mctx.lineWidth = S * 0.03;
  for (const p of room.portals) {
    mctx.globalAlpha = Math.abs(p.pos.y - player.y) < 1.5 ? 1 : 0.3;
    const tx = p.normal.z * (p.w / 2);
    const tz = -p.normal.x * (p.w / 2);
    mctx.beginPath();
    mctx.moveTo(X(p.pos.x - tx), Z(p.pos.z - tz));
    mctx.lineTo(X(p.pos.x + tx), Z(p.pos.z + tz));
    mctx.stroke();
  }
  mctx.globalAlpha = 1;
  const px = X(player.x);
  const pz = Z(player.z);
  mctx.save();
  mctx.translate(px, pz);
  mctx.rotate(-player.yaw);
  mctx.fillStyle = '#1d1a16';
  mctx.beginPath();
  mctx.moveTo(0, -S * 0.05);
  mctx.lineTo(S * 0.032, S * 0.035);
  mctx.lineTo(-S * 0.032, S * 0.035);
  mctx.closePath();
  mctx.fill();
  mctx.restore();
}

// ------------------------------------------------------------------- loop
const clock = new THREE.Clock();
let elapsed = 0;
let miniTimer = 0;
function simulate(dt) {
  elapsed += dt;
  stepAnim(dt);
  if (state === 'walk') walkUpdate(dt);
  else {
    player.vx *= 0.8;
    player.vz *= 0.8;
  }
  updateCamera();
  runAnimators(player.room, elapsed, dt, camera);
  if (state === 'walk') updateHover();
  else if (state !== 'inspect') setHint('');
  updateDecals(dt);
  updateMarker(dt);
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!world) return;
  simulate(dt);
  refreshPreviews();
  renderer.render(scene, camera);
  miniTimer += dt;
  if (miniTimer > 0.066) {
    miniTimer = 0;
    drawMinimap();
  }
}
requestAnimationFrame(frame);

boot().catch((err) => {
  console.error(err);
  setStatus(err.message || 'Something went wrong while hanging the collection.');
  $('#intro').classList.add('error');
});

// Debug/testing hooks (used by automated checks; harmless otherwise).
window.museum = {
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
    return world.portals.map((p) => ({ room: p.room, dest: p.dest, entrance: !!p.entrance, x: p.pos.x, y: p.pos.y, z: p.pos.z, nx: p.normal.x, nz: p.normal.z, subtitle: p.subtitle, arrives: arrivalFor(p)?.room === p.dest }));
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
  // For checks: how many works have their full image, and what's still queued.
  get loading() {
    return { loaded: [...collectionArt.values()].filter((e) => e.loaded).length, total: collectionArt.size, queued: loads.order.length, active: loads.active, previews: previewQueue.length };
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
        if (!o.isMesh || !o.material) return;
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
        if (blocked) out.push({ room: room.id, id: art.userData.id, blocked: `${blocked}/${total}`, by: [...blockers.entries()].map(([k, n]) => `${k} (${n})`) });
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
      refreshPreviews();
    }
    renderer.render(scene, camera);
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
