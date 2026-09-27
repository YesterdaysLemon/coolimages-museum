// The museum's alligator. He has his own business: he wanders a room, pauses
// to look around (at you, if you're close), and leaves by one of its doors,
// walking straight into the painting. Now and then the room you've just
// walked into is the one he's leaving. His body (the model, or a procedural
// stand-in) is gator-body.js; how he finds his way, nav.js.
import { standIn, loadModel } from './gator-body.js';
import { navSteps } from './nav.js';

const TAU = Math.PI * 2;
// ------------------------------------------------------------- the animal
// His name. It isn't written anywhere you'd come across it: you learn it by
// following him, as Dante followed his guide. Walk after him into the
// painting he's just gone through, and he leads you on to another door;
// the third time in a row, he stops, turns and tells you (onName).
const NAME = atob('VmlyZ2ls');
const FOLLOWS = 3;
const FOLLOW_WITHIN = 25; // seconds after he's gone through

export function makeGator({ world, ground, walkable, heightsAt, floorTop, faceAhead, modelUrl = null, onReady = null, onName = null, known = false }) {
  const m = standIn();
  // Until the real one loads he isn't anywhere; if it can't, the stand-in walks.
  let active = m;
  let ready = !modelUrl;
  if (modelUrl) {
    loadModel(modelUrl)
      .then((real) => {
        detach();
        active = real;
        onReady?.(real.root);
      })
      .catch((err) => console.warn('The alligator model did not load; using the stand-in.', err))
      .finally(() => {
        ready = true;
      });
  }
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
    omega: 0, // turning speed, rad/s
    path: null, // waypoints from nav.js
    pathIdx: 0,
    pitch: 0, // tilt on slopes
    lift: 0, // how far the stairs' steps stand above the ramp under him
    pause: 0,
    hissing: false,
    wantHiss: false,
    left: null, // the door he last went through: { from, to, at }
    follows: 0, // how many doors in a row you've followed him through
    hissCool: 0,
    seed: Math.random() * 10,
  };
  // He takes up floor: three circles along his body, so you can't walk through him.
  const blocks = [0.9, 0, -0.95].map((dx) => ({ type: 'circle', x: 0, z: 0, r: 0.42, dx, gator: true }));

  function attach() {
    if (g.attachedTo === g.room) return;
    detach();
    const room = world.rooms[g.room];
    room.group.add(active.root);
    room.obstacles.push(...blocks);
    g.attachedTo = g.room;
  }
  function detach() {
    if (!g.attachedTo) return;
    const room = world.rooms[g.attachedTo];
    room.group.remove(active.root);
    room.obstacles = room.obstacles.filter((o) => !o.gator);
    g.attachedTo = null;
  }
  // Checks of the room made as if he weren't in it (they pad every circle).
  function ignoringHimself(check) {
    for (const b of blocks) b.r = -100;
    try {
      return check();
    } finally {
      for (const b of blocks) b.r = 0.42;
    }
  }
  // Floor height where he could stand; with a heading (fx, fz), also with
  // nothing where his snout would go.
  const SNOUT = 1.35;
  function free(x, z, fx = 0, fz = 0, y = g.y) {
    const room = world.rooms[g.room];
    return ignoringHimself(() => {
      const h = walkable(room, x, z, 0.75, y);
      return h !== null && (fx || fz) && faceAhead(room, x, z, h, fx, fz, SNOUT) ? null : h;
    });
  }
  // Can he walk straight from where he is to `p`?
  const straightTo = (p) => ignoringHimself(() => navOf(g.room).clear({ x: g.x, z: g.z, y: g.y }, p));
  // Somewhere to put him down: a node of the room's grid with room around it
  // (or, before the grid is ready, anywhere he fits).
  function spot(awayFrom) {
    if (!navReady(g.room)) return looseSpot(awayFrom);
    const nav = navOf(g.room);
    if (!nav.nodes.length) return null;
    for (let i = 0; i < 80; i++) {
      const k = Math.floor(Math.random() * nav.nodes.length);
      const n = nav.nodes[k];
      if (awayFrom && Math.hypot(n.x - awayFrom.x, n.z - awayFrom.z) < 6) continue;
      if (i < 60 && !nav.roomy(k)) continue;
      if (free(n.x, n.z, 0, 0, n.y) !== null) return { x: n.x, z: n.z, y: n.y };
    }
    return null;
  }
  function looseSpot(awayFrom) {
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

  // Each room's navigation grid (nav.js). They're built in the background, a
  // few milliseconds a frame (buildGrids), the room you're entering first;
  // anything that needs one before then finishes it on the spot.
  const navs = new Map();
  const building = new Map(); // roomId -> the build, part done
  const navOpts = { walkable, heightsAt, faceAhead };
  let gridOrder = [...rooms];
  // Build `roomId`'s grid until it's done (true) or it's time to stop.
  function advance(roomId, until) {
    if (!building.has(roomId)) building.set(roomId, navSteps(world.rooms[roomId], navOpts));
    const steps = building.get(roomId);
    return ignoringHimself(() => {
      for (;;) {
        const r = steps.next();
        if (r.done) {
          navs.set(roomId, r.value);
          building.delete(roomId);
          return true;
        }
        if (performance.now() >= until) return false;
      }
    });
  }
  const navReady = (roomId) => navs.has(roomId);
  function navOf(roomId) {
    if (!navs.has(roomId)) advance(roomId, Infinity);
    return navs.get(roomId);
  }
  // Put a room's grid first in line, then its neighbours'.
  function wantGrid(roomId) {
    const next = [roomId, ...world.rooms[roomId].portals.map((p) => p.dest)];
    gridOrder = [...new Set([...next, ...gridOrder])].filter((id) => world.rooms[id] && id !== 'outside' && !navs.has(id));
  }
  function buildGrids(budgetMs) {
    const until = performance.now() + budgetMs;
    while (gridOrder.length && performance.now() < until) {
      if (navs.has(gridOrder[0]) || advance(gridOrder[0], until)) gridOrder.shift();
    }
  }
  // Doors he can walk to from where he is (any level: the stairs are fine).
  function reachableDoors() {
    if (!navReady(g.room)) return [];
    const nav = navOf(g.room);
    const here = nav.nearest(g.x, g.z, g.y);
    if (here < 0) return [];
    return world.rooms[g.room].portals.filter((d) => {
      if (d.dest === 'outside' || !world.rooms[d.dest]) return false;
      const k = nav.nearest(d.pos.x + d.normal.x * 1.8, d.pos.z + d.normal.z * 1.8, d.pos.y);
      return k >= 0 && nav.nodes[k].comp === nav.nodes[here].comp && Math.abs(nav.nodes[k].y - d.pos.y) < 0.5;
    });
  }
  // A route (waypoints) to (x, z, y), or somewhere of his choosing. It starts
  // at the grid point nearest him; he heads for the next one if he can walk
  // straight there, else to that first one.
  function plan(goal) {
    // (Until his room's grid is ready, he rests.)
    if (!navReady(g.room)) {
      wantGrid(g.room);
      return null;
    }
    const nav = navOf(g.room);
    const here = nav.nearest(g.x, g.z, g.y);
    const to = goal ? nav.nearest(goal.x, goal.z, goal.y) : nav.pick(here, { minDist: 3, climb: nav.levels > 1 && Math.random() < 0.4 });
    const path = here >= 0 && to >= 0 ? nav.route(here, to) : null;
    g.path = path;
    g.pathIdx = path && path.length > 1 && straightTo(path[1]) ? 1 : 0;
    return path;
  }
  const doorsOf = (roomId, y) => world.rooms[roomId].portals.filter((p) => p.dest !== 'outside' && world.rooms[p.dest] && Math.abs(p.pos.y - y) < 0.5);

  // Into the painting, facing its wall, from `dist` metres out.
  function leaveBy(door, dist) {
    g.door = door;
    g.x = door.pos.x + door.normal.x * dist;
    g.z = door.pos.z + door.normal.z * dist;
    g.y = door.pos.y;
    g.heading = headingTo(-door.normal.x, -door.normal.z);
    g.mode = 'exit';
    g.omega = 0;
    g.placed = true;
    g.path = null;
  }

  // The player just arrived in `roomId` (through `arrival`, if by a door).
  function entered(roomId, arrival, t) {
    if (!g.enabled || !ready || roomId === 'outside') return;
    // This room's grid next.
    wantGrid(roomId);
    // Did you follow him? (Through the painting he just went through, soon
    // after him.) Anything else breaks the run.
    const left = g.left;
    g.left = null;
    if (left && g.room === roomId && left.to === roomId && arrival?.dest === left.from && t - left.at < FOLLOW_WITHIN && lead(roomId, arrival)) return;
    g.follows = 0;
    g.y = arrival ? arrival.pos.y : 0;
    const from = arrival ? { x: arrival.pos.x + arrival.normal.x * 2.4, z: arrival.pos.z + arrival.normal.z * 2.4 } : null;
    if (g.room === roomId) {
      const s = spot(from);
      if (s) Object.assign(g, s, { mode: 'wander', target: null, heading: Math.random() * TAU, omega: 0, placed: true, path: null });
      return;
    }
    if (t - g.lastStaged < 60 || Math.random() > 0.22) return;
    stage(roomId, arrival);
    g.lastStaged = t;
  }
  // You followed him in: he's a few steps ahead of you, walking on to
  // another door for you to follow him through; or, the third time, turned
  // round to face you, and he tells you his name.
  function lead(roomId, arrival) {
    const y = arrival.pos.y;
    let at = null;
    for (const d of [5.5, 4.5, 7]) {
      const x = arrival.pos.x + arrival.normal.x * d;
      const z = arrival.pos.z + arrival.normal.z * d;
      if (free(x, z, 0, 0, y) !== null) {
        at = { x, z };
        break;
      }
    }
    if (!at) return false;
    g.follows++;
    Object.assign(g, at, { y, omega: 0, placed: true, path: null, target: null, look: 0 });
    if (g.follows >= FOLLOWS) {
      g.follows = 0;
      g.heading = headingTo(-arrival.normal.x, -arrival.normal.z);
      g.speed = 0;
      g.mode = 'idle';
      g.timer = 9;
      g.wantHiss = true;
      g.hissCool = 0;
      known = true;
      onName?.(NAME);
      return true;
    }
    const on = doorsOf(roomId, y).filter((p) => p !== arrival);
    if (!on.length) return false;
    g.heading = headingTo(arrival.normal.x, arrival.normal.z);
    g.speed = 0.5;
    g.door = pick(on);
    g.mode = 'toDoor';
    // (Leading, he doesn't stop to hiss at you.)
    g.hissCool = 60;
    return true;
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

  // Turning eases in and out (no snapping): an angular velocity that follows
  // the wanted one, capped.
  function steer(want, dt, maxRate = 1.0) {
    let diff = want - g.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const desired = Math.max(-maxRate, Math.min(maxRate, diff * 1.8));
    g.omega += (desired - g.omega) * Math.min(1, dt * 3);
    g.heading += g.omega * dt;
    return Math.abs(diff);
  }
  function settle(dt) {
    g.omega -= g.omega * Math.min(1, dt * 3);
    g.heading += g.omega * dt;
  }
  // His pace drifts: two slow waves, so he's never quite the same speed.
  const cruise = (t) => Math.max(0.7, Math.min(1.25, 0.95 + 0.22 * Math.sin(t * 0.23 + g.seed) + 0.14 * Math.sin(t * 0.61 + g.seed * 2.3)));

  function think(dt, player, t) {
    const fx = Math.cos(g.heading);
    const fz = -Math.sin(g.heading);
    const px = player.x - g.x;
    const pz = player.z - g.z;
    const near = Math.hypot(px, pz);
    let rel = headingTo(px, pz) - g.heading;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    g.hissCool -= dt;
    let want = 0;
    if (g.mode === 'wander' || g.mode === 'toDoor') {
      // Step close in front of him and he stops to hiss at you.
      if (g.mode === 'wander' && near < 3.4 && Math.abs(rel) < 1.3 && g.hissCool <= 0) {
        g.mode = 'idle';
        g.timer = 7;
        g.wantHiss = true;
        g.target = null;
      } else {
        // Plan a route (around benches and columns, through arches, up and
        // down stairs), then follow its waypoints.
        if (!g.path && g.mode === 'toDoor' && !navReady(g.room)) {
          // (Leading you somewhere, he waits for the room's grid rather than give up.)
          wantGrid(g.room);
        } else if (!g.path) {
          const door = g.mode === 'toDoor' ? { x: g.door.pos.x + g.door.normal.x * 1.8, z: g.door.pos.z + g.door.normal.z * 1.8, y: g.door.pos.y } : null;
          if (!plan(door)) {
            g.mode = 'idle';
            g.timer = 2 + Math.random() * 2;
            return;
          }
        }
      }
      if (g.path && (g.mode === 'wander' || g.mode === 'toDoor')) {
        const last = g.pathIdx >= g.path.length - 1;
        const wp = g.path[Math.min(g.pathIdx, g.path.length - 1)];
        const dx = wp.x - g.x;
        const dz = wp.z - g.z;
        const off = steer(headingTo(dx, dz), dt);
        // Waiting (something in the way): stand and turn before moving on.
        if (g.pause > 0) g.pause -= dt;
        else want = (off < 0.7 ? cruise(t) : off < 1.6 ? 0.4 : 0.18) * (Math.abs(g.pitch) > 0.15 ? 0.7 : 1);
        // On to the next waypoint a little before this one, if he can walk
        // straight there from here (no cutting corners into anything).
        const d = Math.hypot(dx, dz);
        if (!last && (d < 0.35 || (d < 1.0 && straightTo(g.path[g.pathIdx + 1])))) g.pathIdx++;
        else if (last && d < 0.6) {
          if (g.mode === 'toDoor') {
            g.path = null;
            g.mode = 'exit';
          } else {
            g.path = null;
            g.mode = 'idle';
            g.timer = 3 + Math.random() * 5;
            want = 0;
          }
        }
      }
    } else if (g.mode === 'idle') {
      settle(dt);
      if (near < 7) g.look = Math.max(-0.75, Math.min(0.75, rel));
      else g.look = Math.sin(t * 0.5 + g.seed) * 0.45;
      // Once he has come to a halt: hiss, if you're close (or he meant to).
      if (!g.hissing && g.speed < 0.06 && (g.wantHiss || (near < 4.5 && g.hissCool <= 0))) {
        g.hissing = true;
        g.wantHiss = false;
        g.hissCool = 14;
        g.timer = Math.max(g.timer, 1.5);
      }
      if (g.hissing) g.timer = Math.max(g.timer, 1.2);
      g.timer -= dt;
      if (g.timer <= 0) {
        g.look = 0;
        g.bored++;
        const doors = reachableDoors();
        g.path = null;
        if (g.bored >= 2 + Math.floor(Math.random() * 3) && doors.length) {
          g.bored = 0;
          g.door = pick(doors);
          g.mode = 'toDoor';
        } else g.mode = 'wander';
      }
    } else if (g.mode === 'exit') {
      steer(headingTo(-g.door.normal.x, -g.door.normal.z), dt, 0.9);
      want = cruise(t);
      const along = (g.x - g.door.pos.x) * g.door.normal.x + (g.z - g.door.pos.z) * g.door.normal.z;
      if (along < -2.4) {
        // Gone: he's in the next room now.
        const next = g.door.dest;
        detach();
        const from = g.room;
        g.room = world.rooms[next] && next !== 'outside' ? next : g.room;
        g.left = { from, to: g.room, at: t };
        g.mode = 'away';
        g.timer = 25 + Math.random() * 45;
        g.speed = 0;
        g.omega = 0;
        return;
      }
    } else if (g.mode === 'emerge') {
      settle(dt);
      want = cruise(t);
      const along = (g.x - g.door.pos.x) * g.door.normal.x + (g.z - g.door.pos.z) * g.door.normal.z;
      if (along > 2.6) {
        g.mode = 'wander';
        g.target = null;
      }
    }
    // Speed eases too: he gathers pace and comes to a halt, never jumps.
    g.speed += (want - g.speed) * Math.min(1, dt * (want > g.speed ? 1.6 : 2.4));
    const nx = g.x + fx * g.speed * dt;
    const nz = g.z + fz * g.speed * dt;
    if (g.mode === 'exit' || g.mode === 'emerge') {
      g.x = nx;
      g.z = nz;
    } else if (g.speed > 0.001) {
      const blockedByYou = Math.hypot(player.x - (g.x + fx * 1.6), player.z - (g.z + fz * 1.6)) < 0.9 && Math.abs(player.y - g.y) < 1;
      let to = blockedByYou ? null : [nx, nz];
      let h = to && free(nx, nz, fx, fz);
      // Brushing a corner, he slides along it (as you do).
      if (to && h === null) {
        to = null;
        for (const [sx, sz] of [[nx, g.z], [g.x, nz]]) {
          if (Math.hypot(sx - g.x, sz - g.z) < g.speed * dt * 0.3) continue;
          h = free(sx, sz, fx, fz);
          if (h !== null) {
            to = [sx, sz];
            break;
          }
        }
      }
      if (!to) {
        // Something's in the way: stop, wait a moment, then plan again.
        g.speed *= 0.5;
        g.pause = blockedByYou ? 1.2 : 0.8;
        g.path = null;
      } else {
        [g.x, g.z] = to;
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
    g.omega = 0;
    g.placed = true;
    g.path = null;
  }


  function update(dt, t, player, state) {
    if (!g.enabled || !ready) {
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
    if (state !== 'transition') think(Math.min(dt, 0.05), player, t);
    const fx = Math.cos(g.heading);
    const fz = -Math.sin(g.heading);
    // On slopes and stairs his torso tilts to the steps between hips and
    // shoulders, and rides on the steps' tops (not the ramp inside them).
    const room = world.rooms[g.room];
    const back = floorTop(room, g.x - fx * 0.45, g.z - fz * 0.45, g.y);
    const fore = floorTop(room, g.x + fx * 0.75, g.z + fz * 0.75, g.y);
    const mid = floorTop(room, g.x, g.z, g.y);
    const wantPitch = back !== null && fore !== null ? Math.atan2(fore - back, 1.2) : 0;
    const k = Math.min(1, dt * 5);
    g.pitch += (Math.max(-0.6, Math.min(0.6, wantPitch)) - g.pitch) * k;
    const raise = Math.max(mid ?? g.y, back ?? g.y, fore ?? g.y, g.y) - g.y;
    g.lift += (Math.min(0.3, raise) - g.lift) * k;
    active.root.position.set(g.x, g.y + g.lift, g.z);
    active.root.rotation.set(0, g.heading, g.pitch);
    for (const b of blocks) {
      b.x = g.x + fx * b.dx;
      b.z = g.z + fz * b.dx;
    }
    if (g.mode !== 'idle') g.look = 0;
    active.pose(t, Math.min(dt, 0.1), g, (x, z, y) => floorTop(room, x, z, y));
  }

  return {
    get root() {
      return active.root;
    },
    get ready() {
      return ready;
    },
    get model() {
      return active.root === m.root ? 'stand-in' : 'wildmesh';
    },
    update,
    entered,
    buildGrids,
    get state() {
      return { room: g.room, mode: g.mode, x: +g.x.toFixed(2), z: +g.z.toFixed(2), heading: +g.heading.toFixed(2), speed: +g.speed.toFixed(2), hissing: g.hissing, enabled: g.enabled, door: g.door?.dest ?? null, follows: g.follows };
    },
    // Where he is, if he's in a room you could see him in (for looking at him).
    get where() {
      return g.attachedTo ? { room: g.room, x: g.x, y: g.y, z: g.z } : null;
    },
    // His name, once you've learned it.
    get name() {
      return known ? NAME : null;
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
    // For checks: his room's grid, a walk to a point, and his clearances.
    navStats(roomId = g.room) {
      const t0 = performance.now();
      const nav = navOf(roomId);
      const ms = +(performance.now() - t0).toFixed(1);
      // Each door's approach (where he heads to leave by it): on the grid, and in which part.
      const parts = world.rooms[roomId].portals
        .filter((d) => d.dest !== 'outside' && world.rooms[d.dest])
        .map((d) => {
          const ax = d.pos.x + d.normal.x * 1.8;
          const az = d.pos.z + d.normal.z * 1.8;
          const k = nav.nearest(ax, az, d.pos.y);
          const n = nav.nodes[k];
          return k >= 0 && Math.abs(n.y - d.pos.y) < 0.5 && Math.hypot(n.x - ax, n.z - az) < 1.2 ? n.comp : -1;
        });
      return {
        nodes: nav.nodes.length,
        levels: nav.levels,
        comps: new Set(nav.nodes.map((n) => n.comp)).size,
        ms,
        doors: parts.length,
        doorsOff: parts.filter((c) => c < 0).length,
        doorParts: new Set(parts.filter((c) => c >= 0)).size,
      };
    },
    walkTo(x, z, y = 0) {
      g.mode = 'wander';
      g.hissCool = 60;
      return plan({ x, z, y })?.length || 0;
    },
    get clearance() {
      return active.clearance ? active.clearance() : null;
    },
    get y() {
      return +g.y.toFixed(2);
    },
    // For checks: have him already wandering in a room, away from `near`.
    meet(roomId, near) {
      g.enabled = true;
      g.room = roomId;
      const s = spot(near);
      if (s) Object.assign(g, s, { mode: 'wander', target: null, omega: 0, placed: true, path: null });
      return !!s;
    },
  };
}
