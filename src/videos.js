// Moving images. A video shows its poster until its room is entered, then
// loops silently (only the room you're in plays: sync). Looking closer turns
// its sound on, unless sound is off (sound). When a video can't be served
// (the media Worker is over its free daily allowance, or videos are paused in
// the manifest), its frame shows a plea for donations instead, and so does
// the page, once (the #poor note).
import * as THREE from 'three';
import * as TX from './textures.js';

export function makeVideos({ world, audio, paused = false }) {
  const videos = new Map(); // id -> { entry, meshes, el, texture, poor }
  for (const mesh of world.artworks) {
    const { id, entry } = mesh.userData;
    if (!entry.video) continue;
    if (!videos.has(id)) videos.set(id, { entry, meshes: [], el: null, texture: null, poor: false });
    videos.get(id).meshes.push(mesh);
  }

  let pleaded = false;
  function unavailable(v) {
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
    const note = document.querySelector('#poor');
    note.hidden = false;
    setTimeout(() => note.classList.add('show'), 30);
    setTimeout(() => note.classList.remove('show'), 12000);
  }

  function element(v) {
    if (v.el || v.poor) return v.el;
    if (paused) {
      unavailable(v);
      return null;
    }
    const el = document.createElement('video');
    // Videos come from the media host; CORS lets WebGL use their frames.
    el.crossOrigin = 'anonymous';
    el.addEventListener('error', () => unavailable(v));
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

  return {
    // Play the videos in `roomId` (unless the page is hidden); pause the rest.
    sync(roomId) {
      for (const v of videos.values()) {
        const here = !document.hidden && v.meshes.some((m) => m.userData.room === roomId);
        if (here) element(v)?.play().catch(() => {});
        else v.el?.pause();
      }
    },
    // Sound on (looking closer at it) or off, ducking the music under it.
    sound(mesh, on) {
      const v = mesh && videos.get(mesh.userData.id);
      if (!v?.el || !v.entry.audio) return;
      const audible = on && !audio.muted;
      v.el.muted = !audible;
      audio.duck(audible);
    },
    // Is this work's video not being served?
    poor(id) {
      return !!videos.get(id)?.poor;
    },
  };
}
