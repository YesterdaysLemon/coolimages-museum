// Keeping frames smooth: nothing big happens in one frame. Measured on a
// Windows desktop (Chrome draws WebGL through Direct3D there), the stutters
// were never the steady cost of a frame but one-off work: uploading a room's
// textures, first-time shader work, drawing door pictures. So:
//
// - Rooms are warmed ahead of need, the room you're in and its neighbours
//   first: their own textures go up a few milliseconds a frame, then the room
//   is drawn once where it can't be seen (warmDraw), into each kind of target
//   it will be drawn into; Direct3D finishes compiling a shader the first
//   time it draws into each kind of target, and compileAsync alone doesn't
//   reach that. prepare() (while loading) compiles each kind of room for the
//   screen and for targets, and warm-draws one room of each kind.
// - Each door shows a picture of the room behind it, drawn as it's needed (a
//   blank door in your room straight away, the rest of your room's and its
//   neighbours' a few a second in quick frames, once its room is warm) into a
//   shared multisampled target and copied into the door's own texture.
// - On phones, once every room is warm, the canvases the rooms' textures were
//   drawn on are let go (they're a few hundred MB a phone's Safari would
//   rather have back).
import * as THREE from 'three';
import { EYE_HEIGHT, ground, roomsFrom } from './world.js';

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'bumpMap', 'lightMap'];

// The textures a room's own materials use.
export function roomTextures(room) {
  const out = new Set();
  room.group.traverse((o) => {
    for (const m of [o.material].flat()) {
      for (const slot of TEXTURE_SLOTS) {
        const t = m?.[slot];
        if (t?.isTexture && t.image && !t.isRenderTargetTexture && !t.isVideoTexture) out.add(t);
      }
    }
  });
  return [...out];
}

// Where a portal lets you out: the destination's door back to where you came
// from, else its landing (the Stair Hall's balcony), else its entrance.
export function arrivalFor(world, portal) {
  const dest = world.rooms[portal.dest];
  return dest.portals.find((p) => p.dest === portal.room) || dest.landing || dest.portals.find((p) => p.entrance) || dest.portals[0];
}

// Standing `dist` in front of a door, facing into its room.
export function spawnFrom(portal, dist = 2.4) {
  return {
    x: portal.pos.x + portal.normal.x * dist,
    z: portal.pos.z + portal.normal.z * dist,
    y: portal.pos.y || 0,
    yaw: Math.atan2(-portal.normal.x, -portal.normal.z),
  };
}

// `applyRoom(id)` shows a room (and its fog, background); `runAnimators(id, t,
// dt, cam)` moves its moving things; `player.room` is where you are and
// `state()` what you're doing.
export function makeGpu({ renderer, scene, camera, fx, perf, world, gator, lowPower, previewHeight, applyRoom, runAnimators, player, state }) {
  const warm = new Map(); // room id -> its textures still to go up
  const drawn = new Map(); // room id -> how many of the two warming draws are done
  const stale = new Set(); // doors whose picture is missing or out of date
  const roomWarm = (id) => drawn.get(id) === 2;
  let previewWait = 0;
  let released = !lowPower;
  let toRelease = null;
  let warmTarget = null;

  // Draw a room once where it can't be seen, with nothing culled: into a tiny
  // target of the kind door pictures and the transitions draw into, then onto
  // a single pixel of the screen. `count` draws of the two, the target first.
  function warmDraw(id, count = 2) {
    warmTarget ||= new THREE.WebGLRenderTarget(16, 16, { type: fx.target.texture.type, samples: 4 });
    const done = drawn.get(id) || 0;
    const to = Math.min(2, done + count);
    const room = world.rooms[id];
    applyRoom(id);
    // (The alligator too, unless he's out in a room: then he's drawn anyway.)
    const borrow = !gator.root.parent;
    if (borrow) {
      gator.root.position.set(0, -60, 0);
      room.group.add(gator.root);
    }
    const culled = [];
    room.group.traverse((o) => {
      if (!o.frustumCulled) return;
      o.frustumCulled = false;
      culled.push(o);
    });
    if (done < 1) {
      renderer.setRenderTarget(warmTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
    }
    if (to > 1) {
      renderer.setScissorTest(true);
      renderer.setScissor(0, 0, 1, 1);
      renderer.render(scene, camera);
      renderer.setScissorTest(false);
    }
    for (const o of culled) o.frustumCulled = true;
    if (borrow) room.group.remove(gator.root);
    drawn.set(id, to);
    // (Drawing it put up anything of its own still waiting.)
    warm.delete(id);
    perf.note(`warmed ${id} ${to}/2`);
    applyRoom(player.room);
  }

  // On phones, once every room is warm: let the canvases go (after making sure
  // each texture is on the GPU). True while there's still some to do this frame.
  function releaseCanvases(until) {
    if (released || drawn.size < Object.keys(world.rooms).length || [...drawn.values()].some((n) => n < 2)) return false;
    toRelease ||= Object.values(world.rooms).flatMap(roomTextures);
    while (toRelease.length && performance.now() < until) renderer.initTexture(toRelease.pop());
    if (toRelease.length) return true;
    for (const room of Object.values(world.rooms)) {
      for (const t of roomTextures(room)) {
        if (t.image instanceof HTMLCanvasElement) t.image.width = t.image.height = 0;
      }
    }
    released = true;
    perf.note('canvases released');
    return false;
  }

  // Draw a door's picture of the room behind it.
  const preview = { cam: null, shared: new Map(), copyMat: null, copyScene: null, copyCam: null };
  function renderPreview(portal) {
    const arrival = arrivalFor(world, portal);
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
    const W = Math.round(previewHeight * aspect);
    const key = `${W}`;
    if (!shared.has(key)) shared.set(key, new THREE.WebGLRenderTarget(W, previewHeight, { type: fx.target.texture.type, samples: 4 }));
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
    portal.previewTarget ||= new THREE.WebGLRenderTarget(W, previewHeight, { depthBuffer: false });
    copyMat.map = big.texture;
    renderer.setRenderTarget(portal.previewTarget);
    renderer.render(copyScene, copyCam);
    renderer.setRenderTarget(null);
    if (portal.surface.material.map !== portal.previewTarget.texture) {
      portal.surface.material.map = portal.previewTarget.texture;
      portal.surface.material.needsUpdate = true;
    }
  }

  return {
    // While loading: every door is stale, every room is to be warmed, and
    // the shaders for every kind of room (by its fog and lights; the outside
    // is its own kind) are compiled for the screen and for targets (which
    // three.js compiles apart), the alligator's with them.
    async prepare() {
      for (const p of world.portals) stale.add(p);
      for (const [id, room] of Object.entries(world.rooms)) warm.set(id, roomTextures(room));
      gator.root.position.set(0, -60, 0);
      const kinds = new Map();
      for (const [id, room] of Object.entries(world.rooms)) {
        let lights = 0;
        room.group.traverse((o) => {
          if (o.isLight) lights++;
        });
        const kind = id === 'outside' ? id : `${room.env.fog.type}:${lights}`;
        if (!kinds.has(kind)) kinds.set(kind, id);
      }
      for (const id of kinds.values()) {
        applyRoom(id);
        world.rooms[id].group.add(gator.root);
        for (const target of [null, fx.target]) {
          renderer.setRenderTarget(target);
          const compiled = renderer.compileAsync(scene, camera);
          renderer.setRenderTarget(null);
          await compiled.catch(() => {});
        }
        world.rooms[id].group.remove(gator.root);
        // Drawing a room of each kind takes the most compiling: that's now, too.
        warmDraw(id);
      }
      fx.warm();
      applyRoom(player.room);
    },

    // A frame's warming, nearest rooms first (more while the welcome screen
    // is up, when there's time). `busy`: a work's image went up this frame.
    pump(busy) {
      const now = state();
      if (now === 'loading' || now === 'transition' || (busy && now !== 'ready')) return;
      const until = performance.now() + (now === 'ready' ? 12 : 3);
      if (releaseCanvases(until)) return;
      for (const id of roomsFrom(world, player.room)) {
        if (roomWarm(id)) continue;
        const list = warm.get(id);
        while (list?.length && performance.now() < until) renderer.initTexture(list.shift());
        if (list?.length) return;
        warm.delete(id);
        // One draw a frame (while walking, only when the last frame was quick).
        if (now !== 'ready' && perf.last > 20) return;
        warmDraw(id, now === 'ready' ? 2 : 1);
        if (now !== 'ready' || performance.now() >= until) return;
      }
    },

    // A door picture, if one's due: a blank door in your room straight away
    // (one a frame), else your room's and its neighbours' stale ones a few a
    // second in quick frames; only once the room behind is warm.
    refreshPreviews(dt) {
      const now = state();
      if (!stale.size || now === 'transition' || now === 'loading') return;
      previewWait -= dt;
      const here = world.rooms[player.room];
      const ready = (p) => stale.has(p) && roomWarm(p.dest);
      let next = here.portals.find((p) => ready(p) && !p.previewTarget);
      if (!next) {
        if (previewWait > 0 || perf.last > 20) return;
        const near = new Set([player.room, ...here.portals.map((p) => p.dest)]);
        next = here.portals.find(ready) || [...stale].find((p) => near.has(p.room) && roomWarm(p.dest));
        if (!next) return;
      }
      stale.delete(next);
      previewWait = 0.2;
      perf.note(`preview ${next.dest}`);
      renderPreview(next);
      applyRoom(player.room);
    },

    // The doors into a room need new pictures (its works have all arrived).
    roomChanged(roomId) {
      for (const p of world.portals) if (p.dest === roomId) stale.add(p);
    },

    // The outside's easel: a painting of the view past it, made the first
    // time you're out there.
    paintPleinAir() {
      const room = Object.values(world.rooms).find((r) => r.pleinAir);
      if (!room || room.painted) return;
      room.painted = true;
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
    },

    // Canvases have been let go (so a lost WebGL context can't be rebuilt).
    get released() {
      return released && lowPower;
    },
    stats() {
      return { previews: stale.size, warming: [...warm.values()].reduce((n, l) => n + l.length, 0) };
    },
  };
}
