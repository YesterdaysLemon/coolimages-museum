// The museum's alligator. He has his own business: he wanders a room, pauses
// to look around, and leaves by one of its doors, walking straight into the
// painting. Now and then the room you've just walked into is the one he's
// leaving. Built procedurally: a skinned tube for the body (deformed every
// frame so it sways with his walk), four jointed legs in the diagonal "high
// walk" of a real alligator, and eyes that stare back.
import * as THREE from 'three';
import * as TX from './textures.js';

const LEN = 3.2; // snout to tail tip
const SEGS = 90;
const RING = 20;
const SPEED = 0.55; // an unhurried high walk, m/s
const STRIDE = 0.5;
const TAU = Math.PI * 2;
const ORIGIN = 0.42; // where along the body (0 snout, 1 tail) his position is

// Half-width, half-height and a small vertical offset along the body.
const PROFILE = [
  [0, 0.006, 0.005, -0.01],
  [0.012, 0.052, 0.03, -0.008],
  [0.04, 0.082, 0.04, -0.005],
  [0.1, 0.108, 0.052, 0],
  [0.145, 0.136, 0.076, 0.012],
  [0.185, 0.158, 0.095, 0.006],
  [0.22, 0.162, 0.104, 0],
  [0.3, 0.22, 0.134, 0],
  [0.42, 0.27, 0.15, 0],
  [0.52, 0.232, 0.14, 0],
  [0.6, 0.162, 0.13, 0],
  [0.75, 0.094, 0.1, 0],
  [0.9, 0.044, 0.064, 0],
  [1, 0.006, 0.014, 0],
];
function profile(s) {
  for (let i = 1; i < PROFILE.length; i++) {
    const [s1, w1, h1, y1] = PROFILE[i];
    const [s0, w0, h0, y0] = PROFILE[i - 1];
    if (s <= s1) {
      const u = (s - s0) / (s1 - s0);
      const k = u * u * (3 - 2 * u);
      return [w0 + (w1 - w0) * k, h0 + (h1 - h0) * k, y0 + (y1 - y0) * k];
    }
  }
  return PROFILE[PROFILE.length - 1].slice(1);
}
// The dorsal crests and osteoderms, raised along the top of the back and tail.
function crest(s, top) {
  if (top < 0.8) return 0;
  const k = (top - 0.8) / 0.2;
  if (s > 0.58) return k * 0.05 * (0.5 + 0.5 * Math.cos(s * 150)) * (1.1 - s);
  if (s > 0.22) return k * 0.014 * (0.5 + 0.5 * Math.cos(s * 190));
  return 0;
}

// --------------------------------------------------------------- the skin
// A canvas unwrapped around the body: u along it (snout to tail), v around
// it (0 one side, 0.25 the top, 0.5 the other side, 0.75 the belly).
function skin() {
  const W = 2048;
  const H = 512;
  const color = TX.makeCanvas(W, H);
  const bump = TX.makeCanvas(W, H);
  const c = color.getContext('2d');
  const b = bump.getContext('2d');
  const r = TX.rng(1847);
  const g = c.createLinearGradient(0, 0, 0, H);
  for (const [v, col] of [[0, '#454a36'], [0.09, '#343827'], [0.17, '#23261c'], [0.33, '#23261c'], [0.41, '#343827'], [0.5, '#454a36'], [0.58, '#8c8764'], [0.63, '#cbc29e'], [0.87, '#cbc29e'], [0.92, '#8c8764'], [1, '#454a36']]) g.addColorStop(v, col);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, W, H);
  const X = (s) => s * W;
  const Y = (v) => v * H;
  // Small scales all over the flanks and head.
  for (let i = 0; i < 9000; i++) {
    const s = r();
    const v = r();
    if (v > 0.6 && v < 0.9 && s > 0.2) continue;
    const rx = 2 + r() * 4;
    const ry = 2 + r() * 3;
    c.fillStyle = r() < 0.5 ? 'rgba(20,22,15,0.35)' : 'rgba(110,112,84,0.25)';
    c.beginPath();
    c.ellipse(X(s), Y(v), rx, ry, 0, 0, TAU);
    c.fill();
    b.fillStyle = 'rgba(210,210,210,0.6)';
    b.beginPath();
    b.ellipse(X(s), Y(v), rx * 0.8, ry * 0.8, 0, 0, TAU);
    b.fill();
  }
  // Belly: rectangular plates in neat rows.
  c.strokeStyle = 'rgba(90,82,55,0.55)';
  b.strokeStyle = 'rgba(40,40,40,0.9)';
  for (const ctx of [c, b]) {
    ctx.lineWidth = 2;
    for (let s = 0.2; s < 0.62; s += 0.0075) {
      ctx.beginPath();
      ctx.moveTo(X(s), Y(0.62));
      ctx.lineTo(X(s), Y(0.88));
      ctx.stroke();
    }
    for (let v = 0.62; v < 0.88; v += 0.024) {
      ctx.beginPath();
      ctx.moveTo(X(0.2), Y(v));
      ctx.lineTo(X(0.62), Y(v));
      ctx.stroke();
    }
  }
  // Back: rows of raised osteoderms.
  for (let s = 0.21; s < 0.6; s += 0.0115) {
    const across = s < 0.3 ? 4 : 6;
    for (let k = 0; k < across; k++) {
      const v = 0.25 + (k - (across - 1) / 2) * 0.03;
      const w = 0.0085 * W;
      const h = 0.022 * H;
      c.fillStyle = '#16180f';
      c.fillRect(X(s) - w / 2, Y(v) - h / 2, w, h);
      c.fillStyle = 'rgba(95,100,72,0.55)';
      c.fillRect(X(s) - w / 2, Y(v) - h / 2, w, 3);
      b.fillStyle = '#f0f0f0';
      b.fillRect(X(s) - w / 2 + 1, Y(v) - h / 2 + 1, w - 2, h - 2);
    }
  }
  // Tail: rings of scales, darker bands, and the crest along the top.
  for (let s = 0.6; s < 1; s += 0.021) {
    c.fillStyle = 'rgba(15,16,10,0.45)';
    c.fillRect(X(s), 0, 3, H);
    b.fillStyle = '#303030';
    b.fillRect(X(s), 0, 3, H);
  }
  for (let s = 0.63; s < 1; s += 0.085) {
    c.fillStyle = 'rgba(12,13,8,0.35)';
    c.fillRect(X(s), Y(0.05), 0.03 * W, Y(0.4));
  }
  for (let s = 0.6; s < 1; s += 0.021) {
    c.fillStyle = '#12140c';
    c.beginPath();
    c.moveTo(X(s), Y(0.23));
    c.lineTo(X(s + 0.01), Y(0.25));
    c.lineTo(X(s), Y(0.27));
    c.fill();
    b.fillStyle = '#ffffff';
    b.fillRect(X(s), Y(0.235), 0.009 * W, Y(0.03));
  }
  // The mouth: a dark line along each side of the snout, teeth hanging over it.
  for (const v of [0.515, 0.985]) {
    c.fillStyle = '#0d0e09';
    c.fillRect(X(0.008), Y(v) - 3, X(0.19) - X(0.008), 6);
    b.fillStyle = '#101010';
    b.fillRect(X(0.008), Y(v) - 3, X(0.19) - X(0.008), 6);
    for (let s = 0.02; s < 0.18; s += 0.0105) {
      c.fillStyle = '#e8e2cc';
      c.beginPath();
      const up = v < 0.9 ? 1 : -1;
      c.moveTo(X(s) - 4, Y(v) - up * 2);
      c.lineTo(X(s) + 4, Y(v) - up * 2);
      c.lineTo(X(s), Y(v) + up * 9);
      c.fill();
    }
  }
  // Rows of the canvas are v from the top, as drawn (no vertical flip).
  const map = TX.toTexture(color);
  const bumpMap = TX.toTexture(bump, { srgb: false });
  map.flipY = bumpMap.flipY = false;
  return { map, bumpMap };
}

function eyeTexture() {
  const S = 128;
  const cv = TX.makeCanvas(S, S);
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#e2c65a');
  g.addColorStop(0.6, '#a88a2c');
  g.addColorStop(1, '#4a3a12');
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  c.fillStyle = '#050505';
  c.beginPath();
  c.ellipse(S / 2, S / 2, 7, S * 0.42, 0, 0, TAU);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.8)';
  c.beginPath();
  c.arc(S * 0.36, S * 0.34, 7, 0, TAU);
  c.fill();
  return TX.toTexture(cv);
}

// ----------------------------------------------------------------- the model
function build() {
  const root = new THREE.Group();
  root.userData.gator = true;
  const { map, bumpMap } = skin();
  const skinMat = new THREE.MeshStandardMaterial({ map, bumpMap, bumpScale: 2.2, roughness: 0.58 });
  const limbMat = new THREE.MeshStandardMaterial({ color: 0x2e3224, bumpMap, bumpScale: 1.4, roughness: 0.62 });

  // Body: a tube whose rings are placed along a spine every frame.
  const count = (SEGS + 1) * RING;
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const index = [];
  for (let i = 0; i <= SEGS; i++) {
    for (let j = 0; j < RING; j++) {
      const k = i * RING + j;
      uv[k * 2] = i / SEGS;
      uv[k * 2 + 1] = j / RING;
    }
  }
  for (let i = 0; i < SEGS; i++) {
    for (let j = 0; j < RING; j++) {
      const a = i * RING + j;
      const b2 = (i + 1) * RING + j;
      const c2 = (i + 1) * RING + ((j + 1) % RING);
      const d = i * RING + ((j + 1) % RING);
      index.push(a, d, b2, b2, d, c2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  const body = new THREE.Mesh(geo, skinMat);
  body.frustumCulled = false;
  root.add(body);

  // Head details ride on a frame at the skull.
  const head = new THREE.Group();
  root.add(head);
  const eyeMat = new THREE.MeshStandardMaterial({ map: eyeTexture(), roughness: 0.15, emissive: 0x3a2a08, emissiveIntensity: 0.6 });
  for (const side of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 10, 0, TAU, 0, Math.PI / 2), skinMat);
    brow.position.set(-0.01, 0.07, side * 0.062);
    brow.scale.set(1.3, 0.8, 1);
    head.add(brow);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), eyeMat);
    eye.position.set(0.012, 0.075, side * 0.078);
    eye.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    eye.rotation.x = -side * 0.45;
    head.add(eye);
  }
  const nose = new THREE.Group();
  root.add(nose);
  for (const side of [-1, 1]) {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), skinMat);
    nostril.position.set(0, 0.03, side * 0.018);
    nostril.scale.set(1.3, 0.6, 1);
    nose.add(nostril);
  }

  // Legs: upper and lower segment and a splayed foot with toes.
  const unit = (r0, r1) => new THREE.CylinderGeometry(r1, r0, 1, 10, 1).translate(0, 0.5, 0);
  const legs = [];
  for (const [front, side] of [[true, 1], [true, -1], [false, 1], [false, -1]]) {
    const upper = new THREE.Mesh(unit(front ? 0.075 : 0.1, front ? 0.058 : 0.072), limbMat);
    const lower = new THREE.Mesh(unit(front ? 0.056 : 0.068, front ? 0.042 : 0.05), limbMat);
    const foot = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.BoxGeometry(front ? 0.1 : 0.13, 0.025, front ? 0.07 : 0.08), limbMat);
    pad.position.set(0.02, 0.0125, 0);
    foot.add(pad);
    const toes = front ? 5 : 4;
    for (let k = 0; k < toes; k++) {
      const a = ((k - (toes - 1) / 2) / toes) * 1.3;
      const toe = new THREE.Mesh(new THREE.BoxGeometry(front ? 0.08 : 0.1, 0.016, 0.014), limbMat);
      toe.position.set(0.06 + Math.cos(a) * 0.04, 0.008, Math.sin(a) * 0.05);
      toe.rotation.y = -a;
      foot.add(toe);
    }
    root.add(upper, lower, foot);
    legs.push({ front, side, upper, lower, foot, l1: front ? 0.21 : 0.24, l2: front ? 0.2 : 0.22, s: front ? 0.29 : 0.53, phase: (front ? 0 : 0.5) + (side > 0 ? 0 : 0.5) });
  }

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 1.2),
    new THREE.MeshBasicMaterial({ map: TX.toTexture(glowCanvas()), color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(-0.25, 0.012, 0);
  root.add(shadow);
  root.traverse((o) => (o.userData.gator = true));
  return { root, body, geo, pos, head, nose, legs };
}

function glowCanvas() {
  const S = 128;
  const c = TX.makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return c;
}

// ------------------------------------------------------------- the animal
export function makeGator({ world, ground, walkable }) {
  const m = build();
  const rooms = Object.keys(world.rooms).filter((id) => id !== 'outside');
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const g = {
    enabled: true,
    room: pick(rooms.filter((id) => id !== 'lobby')),
    x: 0,
    z: 0,
    y: 0,
    heading: 0,
    speed: 0,
    walked: 0,
    mode: 'away', // away | wander | idle | toDoor | exit | emerge
    target: null,
    door: null,
    timer: 25 + Math.random() * 40,
    bored: 0,
    look: 0,
    lastStaged: -1e9,
    attachedTo: null,
  };
  // He takes up floor: three circles along his body, so you can't walk through him.
  const blocks = [0.9, 0, -0.95].map((dx) => ({ type: 'circle', x: 0, z: 0, r: 0.42, dx, gator: true }));

  function attach() {
    if (g.attachedTo === g.room) return;
    detach();
    const room = world.rooms[g.room];
    room.group.add(m.root);
    room.obstacles.push(...blocks);
    g.attachedTo = g.room;
  }
  function detach() {
    if (!g.attachedTo) return;
    const room = world.rooms[g.attachedTo];
    room.group.remove(m.root);
    room.obstacles = room.obstacles.filter((o) => !o.gator);
    g.attachedTo = null;
  }
  // Floor height where he could stand, ignoring himself.
  function free(x, z) {
    const room = world.rooms[g.room];
    for (const b of blocks) b.r = -100; // (the check pads every circle)
    const h = walkable(room, x, z, 0.75, g.y);
    for (const b of blocks) b.r = 0.42;
    return h;
  }
  function spot(awayFrom) {
    const b = world.rooms[g.room].bounds;
    for (let i = 0; i < 80; i++) {
      const x = b.type === 'circle' ? b.x + (Math.random() * 2 - 1) * b.r : b.x0 + Math.random() * (b.x1 - b.x0);
      const z = b.type === 'circle' ? b.z + (Math.random() * 2 - 1) * b.r : b.z0 + Math.random() * (b.z1 - b.z0);
      if (awayFrom && Math.hypot(x - awayFrom.x, z - awayFrom.z) < 6) continue;
      const h = free(x, z);
      if (h !== null) return { x, z, y: h };
    }
    return null;
  }
  const headingTo = (dx, dz) => Math.atan2(-dz, dx);
  const doorsOf = (roomId, y) => world.rooms[roomId].portals.filter((p) => p.dest !== 'outside' && world.rooms[p.dest] && Math.abs(p.pos.y - y) < 0.5);

  // Into the painting, facing its wall, from `dist` metres out.
  function leaveBy(door, dist) {
    g.door = door;
    g.x = door.pos.x + door.normal.x * dist;
    g.z = door.pos.z + door.normal.z * dist;
    g.y = door.pos.y;
    g.heading = headingTo(-door.normal.x, -door.normal.z);
    g.mode = 'exit';
  }

  // The player just arrived in `roomId` (through `arrival`, if by a door).
  function entered(roomId, arrival, t) {
    if (!g.enabled || roomId === 'outside') return;
    g.y = arrival ? arrival.pos.y : 0;
    const from = arrival ? { x: arrival.pos.x + arrival.normal.x * 2.4, z: arrival.pos.z + arrival.normal.z * 2.4 } : null;
    if (g.room === roomId) {
      const s = spot(from);
      if (s) Object.assign(g, s, { mode: 'wander', target: null, heading: Math.random() * TAU });
      return;
    }
    if (t - g.lastStaged < 60 || Math.random() > 0.22) return;
    stage(roomId, arrival);
    g.lastStaged = t;
  }
  function stage(roomId, arrival) {
    const y = arrival ? arrival.pos.y : 0;
    g.y = y;
    const doors = doorsOf(roomId, y).filter((p) => p !== arrival).sort(() => Math.random() - 0.5);
    const prev = g.room;
    g.room = roomId;
    for (const door of doors) {
      const d = 4.2;
      if (free(door.pos.x + door.normal.x * d, door.pos.z + door.normal.z * d) === null) continue;
      if (free(door.pos.x + door.normal.x * 2, door.pos.z + door.normal.z * 2) === null) continue;
      leaveBy(door, d);
      return true;
    }
    g.room = prev;
    return false;
  }

  function steer(want, dt, rate = 1.3) {
    let diff = want - g.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.heading += Math.max(-rate * dt, Math.min(rate * dt, diff));
    return Math.abs(diff);
  }

  function think(dt, player) {
    const fx = Math.cos(g.heading);
    const fz = -Math.sin(g.heading);
    let want = 0;
    if (g.mode === 'wander' || g.mode === 'toDoor') {
      if (!g.target) g.target = spot(null);
      if (!g.target) {
        g.mode = 'idle';
        g.timer = 3;
        return;
      }
      const dx = g.target.x - g.x;
      const dz = g.target.z - g.z;
      const off = steer(headingTo(dx, dz), dt);
      want = off < 0.9 ? SPEED : 0.15;
      if (Math.hypot(dx, dz) < 0.6) {
        if (g.mode === 'toDoor') {
          g.mode = 'exit';
        } else {
          g.mode = 'idle';
          g.timer = 3 + Math.random() * 6;
          g.target = null;
          want = 0;
        }
      }
    } else if (g.mode === 'idle') {
      g.timer -= dt;
      g.look = Math.sin(g.timer * 0.9) * 0.5;
      if (g.timer <= 0) {
        g.look = 0;
        g.bored++;
        const doors = doorsOf(g.room, g.y);
        if (g.bored >= 2 + Math.floor(Math.random() * 3) && doors.length) {
          g.bored = 0;
          g.door = pick(doors);
          g.target = { x: g.door.pos.x + g.door.normal.x * 1.6, z: g.door.pos.z + g.door.normal.z * 1.6 };
          g.mode = 'toDoor';
        } else g.mode = 'wander';
      }
    } else if (g.mode === 'exit') {
      steer(headingTo(-g.door.normal.x, -g.door.normal.z), dt, 2);
      want = SPEED;
      const along = (g.x - g.door.pos.x) * g.door.normal.x + (g.z - g.door.pos.z) * g.door.normal.z;
      if (along < -2.1) {
        // Gone: he's in the next room now.
        const next = g.door.dest;
        detach();
        g.room = world.rooms[next] && next !== 'outside' ? next : g.room;
        g.mode = 'away';
        g.timer = 25 + Math.random() * 45;
        g.speed = 0;
        return;
      }
    } else if (g.mode === 'emerge') {
      want = SPEED;
      const along = (g.x - g.door.pos.x) * g.door.normal.x + (g.z - g.door.pos.z) * g.door.normal.z;
      if (along > 2.6) {
        g.mode = 'wander';
        g.target = null;
      }
    }
    g.speed += (want - g.speed) * Math.min(1, dt * 2.5);
    const nx = g.x + fx * g.speed * dt;
    const nz = g.z + fz * g.speed * dt;
    if (g.mode === 'exit' || g.mode === 'emerge') {
      g.x = nx;
      g.z = nz;
    } else {
      const h = free(nx + fx * 1.2, nz + fz * 1.2) !== null ? free(nx, nz) : null;
      if (h === null) {
        g.target = null;
        g.speed = 0;
        g.heading += (Math.random() < 0.5 ? -1 : 1) * 0.6;
      } else {
        g.x = nx;
        g.z = nz;
        g.y = h;
      }
    }
    g.walked += g.speed * dt;
    const room = world.rooms[g.room];
    const h = ground(room, g.x, g.z, g.y);
    if (h !== null && g.mode !== 'exit' && g.mode !== 'emerge') g.y = h;
  }

  // Elsewhere in the museum he moves on now and then; into your room, he
  // comes out of a painting.
  function away(dt, player, playing) {
    g.timer -= dt;
    if (g.timer > 0) return;
    g.timer = 25 + Math.random() * 45;
    const doors = world.rooms[g.room].portals.filter((p) => p.dest !== 'outside' && world.rooms[p.dest]);
    if (!doors.length) return;
    const via = pick(doors);
    const prev = g.room;
    g.room = via.dest;
    if (g.room !== player.room || !playing) return;
    const back = world.rooms[g.room].portals.find((p) => p.dest === prev && Math.abs(p.pos.y - player.y) < 1);
    if (!back) {
      g.room = prev;
      return;
    }
    g.door = back;
    g.x = back.pos.x - back.normal.x * 2.2;
    g.z = back.pos.z - back.normal.z * 2.2;
    g.y = back.pos.y;
    g.heading = headingTo(back.normal.x, back.normal.z);
    g.mode = 'emerge';
  }

  const tmp = new THREE.Vector3();
  const spine = new Array(SEGS + 1);
  for (let i = 0; i <= SEGS; i++) spine[i] = { p: new THREE.Vector3(), t: new THREE.Vector3(), side: new THREE.Vector3(), up: new THREE.Vector3() };
  const UP = new THREE.Vector3(0, 1, 0);

  // Place every ring of the body along a swaying spine, then the head, nose and legs.
  function pose(t) {
    const cycle = g.walked / STRIDE;
    const moving = Math.min(1, g.speed / SPEED);
    const wave = TAU * cycle;
    for (let i = 0; i <= SEGS; i++) {
      const s = i / SEGS;
      const tail = Math.max(0, (s - 0.4) / 0.6);
      const sway = moving * (0.02 + 0.17 * tail ** 1.5) * Math.sin(TAU * 1.05 * s - wave) + (1 - moving) * 0.07 * tail ** 2 * Math.sin(t * 0.8 - s * 3);
      const headTurn = s < 0.26 ? (0.26 - s) * Math.tan(g.look) : 0;
      const base = 0.21 + (s < 0.2 ? 0.02 : 0);
      const drop = s > 0.55 ? (base - 0.045) * ((s - 0.55) / 0.45) ** 1.3 : 0;
      spine[i].p.set(LEN * (ORIGIN - s), base - drop + (s < 0.6 ? Math.sin(wave * 2) * 0.006 * moving : 0), sway + headTurn);
    }
    for (let i = 0; i <= SEGS; i++) {
      const a = spine[Math.max(0, i - 1)].p;
      const b = spine[Math.min(SEGS, i + 1)].p;
      const f = spine[i];
      f.t.subVectors(a, b).normalize();
      f.side.crossVectors(f.t, UP).normalize();
      f.up.crossVectors(f.side, f.t).normalize();
    }
    const pos = m.pos;
    for (let i = 0; i <= SEGS; i++) {
      const s = i / SEGS;
      const [w, h, yc] = profile(s);
      const f = spine[i];
      for (let j = 0; j < RING; j++) {
        const th = (j / RING) * TAU;
        const cs = Math.cos(th);
        const sn = Math.sin(th);
        const x = w * Math.sign(cs) * Math.abs(cs) ** 0.75;
        const y = (sn < 0 ? h * 0.85 * -(Math.abs(sn) ** 0.55) : h * sn ** 0.8) + yc + crest(s, sn);
        const k = (i * RING + j) * 3;
        pos[k] = f.p.x + f.side.x * x + f.up.x * y;
        pos[k + 1] = f.p.y + f.side.y * x + f.up.y * y;
        pos[k + 2] = f.p.z + f.side.z * x + f.up.z * y;
      }
    }
    m.geo.attributes.position.needsUpdate = true;
    m.geo.computeVertexNormals();
    const frame = (group, s) => {
      const f = spine[Math.round(s * SEGS)];
      group.position.copy(f.p);
      group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.t, f.up, f.side));
    };
    frame(m.head, 0.145);
    frame(m.nose, 0.016);
    for (const leg of m.legs) {
      const f = spine[Math.round(leg.s * SEGS)];
      const [w, h] = profile(leg.s);
      const hip = tmp.copy(f.p).addScaledVector(f.side, leg.side * w * 0.8).addScaledVector(f.up, -h * 0.25).clone();
      const p = (((cycle + leg.phase) % 1) + 1) % 1;
      let off;
      let lift = 0;
      if (p < 0.72) off = STRIDE * (0.5 - p / 0.72);
      else {
        const u = (p - 0.72) / 0.28;
        off = STRIDE * (-0.5 + u);
        lift = 0.07 * Math.sin(Math.PI * u) * moving;
      }
      const foot = new THREE.Vector3(LEN * (ORIGIN - leg.s) + (leg.front ? 0.05 : 0.02) + off * moving * 0.8, lift, leg.side * (w + (leg.front ? 0.2 : 0.23)));
      // Two-bone reach, the joint bent up and outward (a sprawling reptile).
      const d = Math.min(leg.l1 + leg.l2 - 0.005, hip.distanceTo(foot));
      const dir = new THREE.Vector3().subVectors(foot, hip).normalize();
      const a = (leg.l1 * leg.l1 - leg.l2 * leg.l2 + d * d) / (2 * d);
      const hk = Math.sqrt(Math.max(0, leg.l1 * leg.l1 - a * a));
      const hint = new THREE.Vector3(0, 1, leg.side).normalize();
      const bend = hint.addScaledVector(dir, -hint.dot(dir)).normalize();
      const knee = hip.clone().addScaledVector(dir, a).addScaledVector(bend, hk);
      const seg = (mesh, from, to) => {
        const v = new THREE.Vector3().subVectors(to, from);
        mesh.position.copy(from);
        mesh.quaternion.setFromUnitVectors(UP, v.clone().normalize());
        mesh.scale.set(1, v.length(), 1);
      };
      seg(leg.upper, hip, knee);
      const reach = foot.clone().sub(knee);
      const toe = knee.clone().add(reach.setLength(Math.min(reach.length(), leg.l2)));
      seg(leg.lower, knee, toe);
      leg.foot.position.copy(toe);
      leg.foot.rotation.y = -leg.side * 0.35;
    }
  }

  function update(dt, t, player, state) {
    if (!g.enabled) {
      detach();
      return;
    }
    const playing = state === 'walk' || state === 'inspect' || state === 'paused' || state === 'map';
    if (g.room !== player.room || g.mode === 'away') {
      detach();
      if (state !== 'transition') away(dt, player, playing);
      if (g.room !== player.room || g.mode === 'away') return;
    }
    attach();
    if (state !== 'transition') think(Math.min(dt, 0.05), player);
    m.root.position.set(g.x, g.y, g.z);
    m.root.rotation.y = g.heading;
    const fx = Math.cos(g.heading);
    const fz = -Math.sin(g.heading);
    for (const b of blocks) {
      b.x = g.x + fx * b.dx;
      b.z = g.z + fz * b.dx;
    }
    pose(t);
  }

  return {
    root: m.root,
    update,
    entered,
    get state() {
      return { room: g.room, mode: g.mode, x: +g.x.toFixed(2), z: +g.z.toFixed(2), enabled: g.enabled };
    },
    set enabled(v) {
      g.enabled = !!v;
      if (!v) detach();
    },
    get enabled() {
      return g.enabled;
    },
    // For checks: stage his exit from the room you're in, if a door allows it.
    summon(roomId, arrival = null) {
      g.enabled = true;
      return stage(roomId, arrival);
    },
    // For checks: have him already wandering in a room, away from `near`.
    meet(roomId, near) {
      g.enabled = true;
      g.room = roomId;
      const s = spot(near);
      if (s) Object.assign(g, s, { mode: 'wander', target: null });
      return !!s;
    },
  };
}
