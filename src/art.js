// The works' images, loaded as they're needed and at the detail they're seen
// at. Every work starts as its blurred placeholder (the manifest's `blur`, a
// tiny inline WebP; level 0). The works in the room you're in and the rooms a
// door away (the ones the doors' pictures show) get their small image (the
// manifest's `small`, 800 px; level 1): plan() on each room change; nothing
// further off is fetched. A work you walk up to, or look closer at, gets its
// full image (level 2: want()), and goes back to the small one once none of
// its rooms is near (settle()), so full-size images only ever take up the GPU
// for what's around you.
//
// Images are decoded off the main thread where the browser can
// (createImageBitmap, which also scales them to fit and flips them for WebGL
// as they decode), then wait to go onto the GPU one a frame (pump), so no
// frame does much of it; once one is up, its decoded copy is let go.
import * as THREE from 'three';
import * as TX from './textures.js';

export function makeArt({ renderer, perf, works, lowPower, maxTexture, isLoading }) {
  // id -> { ...manifest item, work, texture, aspect, oval, level, want, loaded }
  const entries = new Map();
  const rooms = new Map(); // id -> the rooms it hangs in
  const queue = []; // { id, level, urgent }: images to fetch, first first
  const inFlight = new Map(); // "id:level" -> true
  const maxLoads = lowPower ? 3 : 6;
  const decoded = []; // images waiting to go onto the GPU
  const waiters = [];
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
        // (A work with no separate small image has its full one at level 1.)
        const single = !item.small || item.small === item.file;
        entries.set(item.id, { ...item, work, texture, aspect: item.width / item.height, oval: !!work?.oval, single, level: 0, want: 0, loaded: false });
      }),
    );
    return entries;
  }

  const urlFor = (entry, level) => (level >= 2 || entry.single ? entry.file : entry.small);
  // What a level actually is for this work (a single-image work's small is its full).
  const levelOf = (entry, level) => (entry.single && level >= 1 ? 2 : level);

  // Can createImageBitmap flip an image as it decodes? (Where it can't, or
  // isn't there, images go the <img> way.)
  let canFlip = null;
  const canFlipBitmaps = () => (canFlip ||= flipTest());

  // An image, decoded off the main thread and scaled to fit this device
  // where the browser can (an ImageBitmap, already flipped for WebGL); else an
  // <img>, scaled on a canvas. (Don't wait on img.decode(): in a page that
  // isn't showing, it never settles.)
  async function decode(entry, url) {
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

  // Ask for at least `level` of a work (urgent: ahead of everything else),
  // and fetch whatever level it should now be at (`want`: raised by asking,
  // lowered by plan()).
  function request(id, level, urgent = false) {
    const entry = entries.get(id);
    if (!entry) return;
    entry.want = Math.max(entry.want, levelOf(entry, level));
    const target = entry.want;
    if (entry.level === target || inFlight.has(`${id}:${target}`)) return;
    const i = queue.findIndex((j) => j.id === id && j.level === target);
    if (i >= 0) {
      if (!urgent) return;
      queue.splice(i, 1);
    }
    if (urgent) queue.unshift({ id, level: target });
    else queue.push({ id, level: target });
  }

  function fetchMore() {
    while (inFlight.size < maxLoads && queue.length) {
      const { id, level } = queue.shift();
      const entry = entries.get(id);
      // (Asked for, then wanted at another level, or already there.)
      if (entry.level === level || entry.want !== level) continue;
      const key = `${id}:${level}`;
      inFlight.set(key, true);
      fetchLevel(entry, level).finally(() => {
        inFlight.delete(key);
        fetchMore();
      });
    }
  }

  async function fetchLevel(entry, level) {
    try {
      const job = { entry, level, ...(await decode(entry, urlFor(entry, level))) };
      // (Before the doors open nothing is on view, so straight up.)
      if (isLoading()) upload(job);
      else decoded.push(job);
    } catch (err) {
      console.warn(err);
      if (!entry.loaded) arrived(entry);
    }
  }

  function upload({ entry, level, image, flipY }) {
    // (Only what's still wanted: the level it should be at, or a step up
    // towards it; it may have been dropped, or bettered, meanwhile.)
    const keep = level === entry.want || (level > entry.level && level <= entry.want);
    if (keep) {
      const t = entry.texture;
      // A new size needs new GPU storage: drop the old one's first.
      t.dispose();
      t.image = image;
      t.flipY = flipY;
      if (entry.work?.pixel) t.magFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      renderer.initTexture(t);
      entry.level = level;
      perf.note(`image ${image.width}px`);
      if (!entry.loaded) arrived(entry);
    }
    // On the GPU now (and drawn on any banner that wanted it), or not wanted:
    // the decoded copy can go.
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
      image.close();
      if (keep) released = true;
    }
  }

  // A work has its first image (or won't get one). A room whose works all
  // have theirs is reported (its doors' pictures are out of date).
  function arrived(entry) {
    entry.loaded = true;
    world.artLoaded(entry.id);
    for (const roomId of rooms.get(entry.id) || []) {
      const room = world.rooms[roomId];
      if (room.sharp || !room.artworks.every((m) => entries.get(m.userData.id)?.loaded)) continue;
      room.sharp = true;
      roomArrived?.(roomId);
    }
    for (const w of waiters) w();
  }

  // The room you're in and the rooms a door away from it.
  function near(roomId) {
    return new Set([roomId, ...world.rooms[roomId].portals.map((p) => p.dest).filter((id) => world.rooms[id])]);
  }

  // Resolves when all of `ids` have arrived (or failed), or after `ms`.
  function whenLoaded(ids, ms, onProgress) {
    return new Promise((resolve) => {
      const check = () => {
        const done = ids.filter((id) => entries.get(id)?.loaded).length;
        onProgress?.(done, ids.length);
        if (done < ids.length) return;
        waiters.splice(waiters.indexOf(check), 1);
        resolve();
      };
      waiters.push(check);
      setTimeout(() => {
        if (waiters.includes(check)) waiters.splice(waiters.indexOf(check), 1);
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
      for (const m of world.artworks) {
        if (!rooms.has(m.userData.id)) rooms.set(m.userData.id, new Set());
        rooms.get(m.userData.id).add(m.userData.room);
      }
    },
    // You're in `roomId`: `first` (the entrance's works, at the start), then
    // the works of this room and the rooms a door away, small; full-size
    // images of works none of whose rooms is near go back to small.
    plan(roomId, first = []) {
      const close = near(roomId);
      for (const id of first) request(id, 1);
      for (const m of world.rooms[roomId].artworks) request(m.userData.id, 1);
      for (const id of close) if (id !== roomId) for (const m of world.rooms[id].artworks) request(m.userData.id, 1);
      for (const [id, entry] of entries) {
        if (entry.want < 2 || entry.single) continue;
        if ([...(rooms.get(id) || [])].some((r) => close.has(r))) continue;
        entry.want = 1;
        request(id, 1);
      }
      fetchMore();
    },
    // Full-size images for these works (nearest first); `urgent` for the one
    // you're looking closer at.
    want(ids, urgent = false) {
      for (const id of urgent ? [...ids].reverse() : ids) request(id, 2, urgent);
      fetchMore();
    },
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
      const all = [...entries.values()];
      // (full: works shown at full size that also have a small image)
      return { loaded: all.filter((e) => e.loaded).length, full: all.filter((e) => e.level >= 2 && !e.single).length, total: entries.size, queued: queue.length, active: inFlight.size, uploading: decoded.length };
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
