// The works' images. Every work starts as its blurred placeholder (the
// manifest's `blur`, a tiny inline WebP) and sharpens when its image arrives:
// the Entrance Hall's first, then room by room outward from wherever you are
// (plan). Images are decoded off the main thread where the browser can
// (createImageBitmap, which also scales them to fit and flips them for WebGL
// as they decode), then wait to go onto the GPU one a frame (pump), so no
// frame does much of it; once one is up, its decoded copy is let go.
import * as THREE from 'three';
import * as TX from './textures.js';
import { roomsFrom } from './world.js';

export function makeArt({ renderer, perf, works, lowPower, maxTexture, isLoading }) {
  const entries = new Map(); // id -> { ...manifest item, work, texture, aspect, oval, loaded, requested }
  const loads = { active: 0, order: [], rooms: new Map(), waiters: [] };
  const maxLoads = lowPower ? 3 : 6;
  const decoded = []; // images waiting to go onto the GPU
  let world = null;
  let roomArrived = null;
  let released = false; // some decoded images have been let go

  // Every work as its placeholder (for building the world).
  async function prepare(items) {
    await Promise.all(
      items.map(async (item) => {
        const work = works[item.id] || null;
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
        entries.set(item.id, { ...item, work, texture, aspect: item.width / item.height, oval: !!work?.oval, loaded: false, requested: false });
      }),
    );
    return entries;
  }

  // Can createImageBitmap flip an image as it decodes? (Where it can't, or
  // isn't there, images go the <img> way.)
  let canFlip = null;
  const canFlipBitmaps = () => (canFlip ||= flipTest());

  // A work's image, decoded off the main thread and scaled to fit this device
  // where the browser can (an ImageBitmap, already flipped for WebGL); else an
  // <img>, scaled on a canvas. (Don't wait on img.decode(): in a page that
  // isn't showing, it never settles.)
  async function decode(entry) {
    const url = lowPower && entry.small ? entry.small : entry.file;
    if (!entry.oval && (await canFlipBitmaps())) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not load ${url}`);
        let bmp = await createImageBitmap(await res.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
        const s = maxTexture / Math.max(bmp.width, bmp.height);
        if (s < 1) {
          const fit = await createImageBitmap(bmp, {
            resizeWidth: Math.round(bmp.width * s),
            resizeHeight: Math.round(bmp.height * s),
            resizeQuality: entry.work?.pixel ? 'pixelated' : 'high',
            premultiplyAlpha: 'none',
          });
          bmp.close();
          bmp = fit;
        }
        return { image: bmp, flipY: false };
      } catch (err) {
        console.warn(err);
      }
    }
    const img = await loadImage(url);
    return { image: entry.oval ? ovalMask(fitTexture(img)) : fitTexture(img), flipY: true };
  }

  // Downscale anything larger than this device should hold on the GPU.
  function fitTexture(img) {
    const s = maxTexture / Math.max(img.width, img.height);
    if (s >= 1) return img;
    const c = TX.makeCanvas(Math.round(img.width * s), Math.round(img.height * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  async function sharpen(entry) {
    try {
      const job = { entry, ...(await decode(entry)) };
      // (Before the doors open nothing is on view, so straight up.)
      if (isLoading()) upload(job);
      else decoded.push(job);
    } catch (err) {
      console.warn(err);
      arrived(entry);
    }
  }

  function upload({ entry, image, flipY }) {
    const t = entry.texture;
    // A new size needs new GPU storage: drop the placeholder's first.
    t.dispose();
    t.image = image;
    t.flipY = flipY;
    if (entry.work?.pixel) t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    renderer.initTexture(t);
    perf.note(`image ${image.width}px`);
    arrived(entry);
    // On the GPU now (and drawn on any banner that wanted it): the decoded copy can go.
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
      image.close();
      released = true;
    }
  }

  // A work has its image (or won't get one). A room whose works have all
  // arrived is reported (its doors' pictures are out of date).
  function arrived(entry) {
    entry.loaded = true;
    world.artLoaded(entry.id);
    for (const roomId of loads.rooms.get(entry.id) || []) {
      const room = world.rooms[roomId];
      if (room.sharp || !room.artworks.every((m) => entries.get(m.userData.id)?.loaded)) continue;
      room.sharp = true;
      roomArrived?.(roomId);
    }
    for (const w of loads.waiters) w();
  }

  // Load order: `first`, then the works of each room by how many doors away it is.
  function plan(roomId, first = []) {
    if (!loads.rooms.size) {
      for (const m of world.artworks) {
        const set = loads.rooms.get(m.userData.id) || new Set();
        set.add(m.userData.room);
        loads.rooms.set(m.userData.id, set);
      }
    }
    const ids = [...first, ...roomsFrom(world, roomId).flatMap((id) => world.rooms[id].artworks.map((m) => m.userData.id)), ...entries.keys()];
    loads.order = [...new Set(ids)].filter((id) => entries.has(id) && !entries.get(id).requested);
    fetchMore();
  }

  function fetchMore() {
    while (loads.active < maxLoads && loads.order.length) {
      const entry = entries.get(loads.order.shift());
      if (entry.requested) continue;
      entry.requested = true;
      loads.active++;
      sharpen(entry).finally(() => {
        loads.active--;
        fetchMore();
      });
    }
  }

  // Resolves when all of `ids` have arrived (or failed), or after `ms`.
  function whenLoaded(ids, ms, onProgress) {
    return new Promise((resolve) => {
      const check = () => {
        const done = ids.filter((id) => entries.get(id)?.loaded).length;
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

  return {
    entries,
    prepare,
    // The world, once built from the placeholders; `onRoomArrived(roomId)`
    // when all of a room's works have their images.
    attach(builtWorld, { onRoomArrived }) {
      world = builtWorld;
      roomArrived = onRoomArrived;
    },
    plan,
    whenLoaded,
    // One decoded image onto the GPU (a frame's worth); true if there was one.
    pump() {
      if (!decoded.length) return false;
      upload(decoded.shift());
      return true;
    },
    get released() {
      return released;
    },
    stats() {
      return { loaded: [...entries.values()].filter((e) => e.loaded).length, total: entries.size, queued: loads.order.length, active: loads.active, uploading: decoded.length };
    },
  };
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

async function flipTest() {
  try {
    const c = TX.makeCanvas(1, 2);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f00';
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = '#00f';
    ctx.fillRect(0, 1, 1, 1);
    const b = await createImageBitmap(c, { imageOrientation: 'flipY' });
    const out = TX.makeCanvas(1, 2).getContext('2d');
    out.drawImage(b, 0, 0);
    return out.getImageData(0, 0, 1, 1).data[2] > 128;
  } catch {
    return false; // (no createImageBitmap, or no options for it)
  }
}
