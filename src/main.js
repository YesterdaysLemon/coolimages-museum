import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WINGS, WORKS } from './catalog.js';
import { CREDITS, REMOVAL_URL } from './credits.js';
import * as TX from './textures.js';
import { buildWorld, walkable, EYE_HEIGHT, formatSaved } from './world.js';
import { MuseumAudio } from './audio.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touchFirst = matchMedia('(pointer: coarse)').matches;
const BASE_FOV = 72;
const SENSITIVITY = 0.0022;
const ACCENT = { lobby: '#8a6d3b', gallery: '#9a2f2f', eyes: '#6c5ce7', familiars: '#1f7a8c', bedroom: '#d4679a' };

// ---------------------------------------------------------------- renderer
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
TX.setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.05, 140);

const audio = new MuseumAudio();
if (params.has('mute')) audio.muted = true;
let world = null;
let collection = null;
let state = 'loading'; // loading | ready | walk | inspect | transition | paused
let locked = false;
let hovered = null;
let anim = null;
let camPose = null;
let inspect = null;
let rollSign = 1;
const keys = new Set();
const player = { x: 0, z: 6.2, yaw: 0, pitch: -0.04, roll: 0, vx: 0, vz: 0, bob: 0, stepAcc: 0, room: 'lobby' };
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

async function loadArt(items) {
  const art = new Map();
  let done = 0;
  const bar = $('#load-bar span');
  await Promise.all(
    items.map(async (item) => {
      try {
        const img = await loadImage(item.file);
        const work = WORKS[item.id] || null;
        const texture = new THREE.Texture(work?.oval ? ovalMask(img) : img);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        if (work?.pixel) texture.magFilter = THREE.NearestFilter;
        texture.needsUpdate = true;
        art.set(item.id, { ...item, work, texture, aspect: item.width / item.height, oval: !!work?.oval });
      } catch (err) {
        console.warn(err);
      }
      done++;
      bar.style.width = `${(done / items.length) * 100}%`;
      setStatus(`Hanging the collection · ${done} / ${items.length}`);
    }),
  );
  return art;
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
  const generated = await fetchJson('content/catalog.json');
  for (const [id, work] of Object.entries(generated || {})) if (!WORKS[id]) WORKS[id] = { ...work, generated: true };
  for (const [id, credit] of Object.entries(CREDITS)) if (WORKS[id]) WORKS[id].credit = credit;
  collection = manifest;
  await loadFonts();
  const art = await loadArt(manifest.items);
  setStatus('Lighting the rooms…');
  await new Promise((r) => setTimeout(r, 30));
  const acquisitions = manifest.items.filter((i) => !WORKS[i.id]).map((i) => i.id).reverse();
  const withheld = new Set(manifest.withheld || []);
  world = buildWorld({
    scene,
    art,
    acquisitions,
    withheld,
    summary: { count: manifest.items.length + withheld.size, range: dateRange(manifest.items) },
  });
  renderCredits();
  renderPreviews();
  enterRoom('lobby');
  updateCamera();
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
}

function enterRoom(id) {
  player.room = id;
  applyRoom(id);
  document.documentElement.style.setProperty('--accent', ACCENT[id]);
  $('#room-name').textContent = WINGS[id].name;
  audio.setMood(id);
}

function arrivalFor(portal) {
  return world.rooms[portal.dest].portals.find((p) => p.dest === portal.room);
}

function spawnFrom(portal, dist = 2.4) {
  return {
    x: portal.pos.x + portal.normal.x * dist,
    z: portal.pos.z + portal.normal.z * dist,
    yaw: Math.atan2(-portal.normal.x, -portal.normal.z),
  };
}

function runAnimators(roomId, t, dt, cam) {
  for (const a of world.animators) if (a.room === roomId) a.fn(t, dt, cam);
}

function renderPreviews() {
  const cam = new THREE.PerspectiveCamera(62, 1, 0.05, 140);
  for (const portal of world.portals) {
    const arrival = arrivalFor(portal);
    if (!arrival) continue;
    const aspect = portal.w / portal.h;
    const rt = new THREE.WebGLRenderTarget(Math.round(760 * aspect), 760, { samples: 4 });
    const s = spawnFrom(arrival, 2.6);
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    cam.position.set(s.x, EYE_HEIGHT, s.z);
    cam.rotation.set(-0.02, s.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
    applyRoom(portal.dest);
    runAnimators(portal.dest, 1.5, 1 / 60, cam);
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    portal.surface.material.map = rt.texture;
    portal.surface.material.needsUpdate = true;
  }
  renderer.setRenderTarget(null);
  // Compile every room's shaders now so first visits don't hitch.
  for (const id of Object.keys(world.rooms)) {
    applyRoom(id);
    renderer.compile(scene, camera);
  }
}

// ------------------------------------------------------------------ camera
function updateCamera() {
  if (camPose) {
    camera.position.set(camPose.x, camPose.y, camPose.z);
    camera.rotation.set(camPose.pitch, camPose.yaw, 0, 'YXZ');
  } else {
    const speed = Math.hypot(player.vx, player.vz);
    const bob = reducedMotion ? 0 : Math.sin(player.bob * Math.PI) * 0.028 * Math.min(1, speed / 2.7);
    camera.position.set(player.x, EYE_HEIGHT + bob, player.z);
    camera.rotation.set(player.pitch, player.yaw, player.roll, 'YXZ');
  }
  camera.updateProjectionMatrix();
}

function playerPose() {
  return { x: player.x, y: EYE_HEIGHT, z: player.z, yaw: player.yaw, pitch: player.pitch };
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
  if (len > 0.05) {
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const n = Math.max(1, len);
    ix = (-sin * f + cos * s) / n;
    iz = (-cos * f - sin * s) / n;
  }
  const k = 1 - Math.exp(-dt * 10);
  player.vx += (ix * speed - player.vx) * k;
  player.vz += (iz * speed - player.vz) * k;
  const room = world.rooms[player.room];
  const nx = player.x + player.vx * dt;
  if (walkable(room, nx, player.z)) player.x = nx;
  else player.vx = 0;
  const nz = player.z + player.vz * dt;
  if (walkable(room, player.x, nz)) player.z = nz;
  else player.vz = 0;
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
    if (along < 0.8 && along > -0.5 && lateral < p.w / 2 - 0.15 && into > 0.4) {
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
    hint = `<b>${escapeHtml(work?.title || 'New acquisition')}</b><span>${touchFirst ? 'Tap' : 'Press <kbd>E</kbd>'} to look closer</span>`;
  } else {
    for (const p of room.portals) {
      const dx = player.x - p.pos.x;
      const dz = player.z - p.pos.z;
      const along = dx * p.normal.x + dz * p.normal.z;
      const lateral = Math.abs(dx * p.normal.z - dz * p.normal.x);
      const facingIt = -(-Math.sin(player.yaw) * p.normal.x - Math.cos(player.yaw) * p.normal.z);
      if (along > 0 && along < 4.5 && lateral < p.w && facingIt > 0.6) {
        hint = `<span>Walk into the painting to enter</span><b>${escapeHtml(WINGS[p.dest].name)}</b>`;
        break;
      }
    }
  }
  setHint(hint);
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
      camera.fov = BASE_FOV + 24 * e;
    }
    setFade(smoothstep(0.55, 0.97, t));
  }, () => {
    enterRoom(portal.dest);
    const s = spawnFrom(arrival);
    const start = { x: arrival.pos.x + arrival.normal.x * 0.2, z: arrival.pos.z + arrival.normal.z * 0.2 };
    player.x = start.x;
    player.z = start.z;
    player.yaw = s.yaw;
    player.pitch = 0;
    player.vx = player.vz = 0;
    runAnim(roll ? 1.1 : 0.45, (t) => {
      const e = 1 - Math.pow(1 - t, 3);
      player.x = lerp(start.x, s.x, e);
      player.z = lerp(start.z, s.z, e);
      if (roll) {
        player.roll = -sign * (Math.PI / 2) * (1 - smoother(t));
        camera.fov = BASE_FOV + 24 * (1 - e);
      }
      setFade(1 - smoothstep(0, 0.55, t));
    }, () => {
      player.roll = 0;
      camera.fov = BASE_FOV;
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
function inspectPose(mesh) {
  const ud = mesh.userData;
  const n = new THREE.Vector3();
  mesh.getWorldDirection(n);
  const c = new THREE.Vector3();
  mesh.getWorldPosition(c);
  const side = innerWidth >= 820;
  const regionW = side ? 0.58 : 0.94;
  const regionH = side ? 0.84 : 0.5;
  const tanH = Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2);
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
  runAnim(reducedMotion ? 0.2 : 1.05, (t) => {
    camPose = lerpPose(from, to, smoother(t));
  }, () => {
    state = 'inspect';
  });
}

function endInspect(immediate = false, relock = true) {
  if (!inspect) return;
  hideCaption();
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
    if (!locked && !dragLook && !touchFirst) showPause();
  });
}

function showCaption(ud) {
  const work = ud.work;
  const panel = $('#caption');
  panel.querySelector('.kicker').textContent = work ? WINGS[work.wing].name : 'New acquisition';
  panel.querySelector('h2').textContent = work?.title || 'Untitled acquisition';
  panel.querySelector('.artist').textContent = work?.artist || 'Curatorial notes pending';
  panel.querySelector('.medium').textContent = work?.medium || '';
  panel.querySelector('.saved').textContent = formatSaved(ud.entry.saved);
  renderCaptionCredit(panel.querySelector('.credit'), work);
  panel.querySelector('.note').textContent =
    work?.note || 'This image arrived after the catalogue was written. The curator is still deciding why it resonates.';
  panel.querySelector('.back').innerHTML = touchFirst ? 'Tap anywhere to step back' : 'Press <kbd>E</kbd> or move to step back';
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

function renderCaptionCredit(el, work) {
  el.replaceChildren();
  const credit = work?.credit;
  if (credit?.sourceUrl || credit?.profileUrl) {
    el.append('Credit: ');
    el.append(credit.profileUrl ? link(credit.profileUrl, credit.creator || credit.handle || 'the artist') : credit.creator || 'the artist');
    if (credit.sourceUrl) el.append(' · ', link(credit.sourceUrl, 'original'));
    if (credit.license) el.append(` · ${credit.license}`);
  } else {
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
      if (c?.profileUrl) li.append(link(c.profileUrl, c.creator || c.handle));
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
  if (touchFirst || dragLook) return;
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
  if (locked || touchFirst || e.button !== 0) return;
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
  audio.start(player.room);
  $('#mute').textContent = audio.muted ? 'Music off' : 'Music on';
  $('#mute').setAttribute('aria-pressed', String(!audio.muted));
  $('#pause-mute').textContent = audio.muted ? 'Turn music on' : 'Turn music off';
  state = 'walk';
  requestLock();
  showBanner('lobby');
  $('#legend').classList.add('show');
  setTimeout(() => $('#legend').classList.remove('show'), 9000);
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
  const label = audio.muted ? 'Music off' : 'Music on';
  $('#mute').textContent = label;
  $('#mute').setAttribute('aria-pressed', String(!audio.muted));
  $('#pause-mute').textContent = audio.muted ? 'Turn music on' : 'Turn music off';
}

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

canvas.addEventListener('click', () => {
  if (touchFirst) return;
  if (lastDragMoved > 6) {
    lastDragMoved = 0;
    return;
  }
  if (!locked && !dragLook && (state === 'walk' || state === 'paused')) {
    resume();
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
  if (e.code === 'Escape' && !$('#credits').hasAttribute('hidden')) closeCredits();
  if (state === 'inspect' && MOVE_KEYS.has(e.code)) endInspect();
  if (e.code === 'Escape' && state === 'inspect') endInspect(false, false);
  if (MOVE_KEYS.has(e.code) || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// Touch: left side is a joystick, right side looks around, tap to inspect.
if (touchFirst) {
  document.body.classList.add('touch');
  const stick = $('#stick');
  const knob = stick.querySelector('span');
  let stickId = null;
  let lookId = null;
  let origin = null;
  let last = null;
  let tap = null;
  canvas.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.42 && stickId === null && state === 'walk') {
        stickId = t.identifier;
        origin = { x: t.clientX, y: t.clientY };
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
      if (t.identifier === stickId) {
        stickId = null;
        touchMove.x = touchMove.y = 0;
        knob.style.transform = '';
        stick.classList.remove('show');
      } else if (t.identifier === lookId) {
        lookId = null;
        const quick = tap && performance.now() - tap.time < 280 && Math.hypot(t.clientX - tap.x, t.clientY - tap.y) < 12;
        if (quick) {
          if (state === 'walk' && hovered) startInspect(hovered);
          else if (state === 'inspect') endInspect();
        }
      }
    }
  };
  canvas.addEventListener('touchend', end);
  canvas.addEventListener('touchcancel', end);
  $('#caption').addEventListener('click', (e) => {
    if (!e.target.closest('a') && state === 'inspect') endInspect();
  });
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
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
  const b = room.bounds;
  const [minX, maxX, minZ, maxZ] = b.type === 'circle' ? [b.x - b.r, b.x + b.r, b.z - b.r, b.z + b.r] : [b.x0, b.x1, b.z0, b.z1];
  const pad = S * 0.1;
  const scale = (S - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  const ox = S / 2 - ((minX + maxX) / 2) * scale;
  const oz = S / 2 - ((minZ + maxZ) / 2) * scale;
  const X = (x) => ox + x * scale;
  const Z = (z) => oz + z * scale;
  mctx.clearRect(0, 0, S, S);
  mctx.fillStyle = 'rgba(255,255,255,0.9)';
  mctx.strokeStyle = 'rgba(40,32,24,0.55)';
  mctx.lineWidth = S * 0.012;
  mctx.beginPath();
  if (b.type === 'circle') mctx.arc(X(b.x), Z(b.z), b.r * scale, 0, Math.PI * 2);
  else mctx.rect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * scale, (b.z1 - b.z0) * scale);
  mctx.fill();
  mctx.stroke();
  mctx.fillStyle = 'rgba(40,32,24,0.12)';
  for (const o of room.obstacles) {
    mctx.beginPath();
    if (o.type === 'circle') mctx.arc(X(o.x), Z(o.z), o.r * scale, 0, Math.PI * 2);
    else if (o.type === 'rect') mctx.rect(X(o.x0), Z(o.z0), (o.x1 - o.x0) * scale, (o.z1 - o.z0) * scale);
    mctx.fill();
  }
  const accent = ACCENT[player.room];
  mctx.fillStyle = accent;
  for (const m of room.artworks) {
    m.getWorldPosition(tmpV);
    mctx.fillRect(X(tmpV.x) - S * 0.018, Z(tmpV.z) - S * 0.018, S * 0.036, S * 0.036);
  }
  mctx.strokeStyle = '#c9a24c';
  mctx.lineWidth = S * 0.03;
  for (const p of room.portals) {
    const tx = p.normal.z * (p.w / 2);
    const tz = -p.normal.x * (p.w / 2);
    mctx.beginPath();
    mctx.moveTo(X(p.pos.x - tx), Z(p.pos.z - tz));
    mctx.lineTo(X(p.pos.x + tx), Z(p.pos.z + tz));
    mctx.stroke();
  }
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
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!world) return;
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
  start: begin,
  teleport(roomId, dist = 2.4) {
    const room = world.rooms[roomId];
    const p = room.portals[0];
    enterRoom(roomId);
    Object.assign(player, spawnFrom(p, dist), { vx: 0, vz: 0, pitch: 0, roll: 0 });
  },
  look(x, z, yaw, pitch = 0) {
    Object.assign(player, { x, z, yaw, pitch });
  },
  inspect() {
    if (hovered) startInspect(hovered);
  },
  back: () => endInspect(),
};
