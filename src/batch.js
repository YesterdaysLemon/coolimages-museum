// Fewer draw calls. Rooms are built from many small meshes (every baluster,
// frame moulding, coffer and bench leg), and each is a draw call: ~460 in the
// Stair Hall. Meshes that never move and share a material are merged, per
// room, into one mesh per material, which is what the GPU is then asked to
// draw.
//
// What's never merged: anything transparent (it's drawn sorted, one by one);
// anything carrying data or referred to by it (artworks, their labels, door
// pictures, the easel), or inside something that does; and anything that
// moves, shows, hides or changes material. That last is found by trying:
// each room's animations run for a while from several places (by every door,
// since doors open as you come close), and whatever changed is left alone.
// The outside is left as it is (its ground and horizon follow you about).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TIMES = [0.4, 2.3, 7.9, 23.1];

export function mergeStatic(world, { keep = [] } = {}) {
  const kept = new Set(keep);
  for (const p of world.portals) if (p.surface) kept.add(p.surface);
  for (const m of world.artworks) kept.add(m);
  const stats = { before: 0, after: 0 };
  for (const [id, room] of Object.entries(world.rooms)) {
    if (room.wrap || room.pleinAir || id === 'outside') continue;
    const [before, after] = mergeRoom(world, room, kept);
    stats.before += before;
    stats.after += after;
  }
  return stats;
}

function mergeRoom(world, room, kept) {
  const group = room.group;
  // Things referred to from data (a work's label, say) stay as they are.
  const referred = new Set();
  group.traverse((o) => {
    for (const v of Object.values(o.userData)) for (const x of [v].flat()) if (x?.isObject3D) referred.add(x);
  });
  const candidates = [];
  let meshes = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    if (o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material) || o.material.transparent) return;
    if (kept.has(o) || referred.has(o) || o.renderOrder !== 0 || o.geometry.morphAttributes?.position) return;
    if (o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
    for (let a = o; a && a !== group; a = a.parent) if (!a.visible || Object.keys(a.userData).length || kept.has(a)) return;
    candidates.push(o);
  });

  // Try the room's animations; leave out whatever they change.
  group.updateMatrixWorld(true);
  const snapshot = (o) => [...o.matrixWorld.elements, o.material.id, visibleChain(o, group) ? 1 : 0];
  const before = new Map(candidates.map((o) => [o, snapshot(o)]));
  const animators = world.animators.filter((a) => a.room === room.id);
  if (animators.length) {
    const cam = new THREE.PerspectiveCamera();
    const spots = [...room.portals.map((p) => p.pos), room.start && new THREE.Vector3(room.start.x, 1.6, room.start.z)].filter(Boolean);
    for (const at of spots) {
      cam.position.set(at.x, (at.y || 0) + 1.6, at.z);
      cam.updateMatrixWorld();
      for (const t of TIMES) for (let k = 0; k < 3; k++) for (const a of animators) a.fn(t + k / 60, 1 / 60, cam);
    }
    group.updateMatrixWorld(true);
  }
  const still = candidates.filter((o) => {
    const a = before.get(o);
    const b = snapshot(o);
    return a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  });

  // One mesh per material (and kind of geometry), in the room's own space.
  const inverse = group.matrixWorld.clone().invert();
  const sets = new Map();
  for (const o of still) {
    const g = o.geometry;
    const kind = `${o.material.id}|${Object.keys(g.attributes).sort().map((n) => `${n}${g.attributes[n].itemSize}`).join(',')}`;
    if (!sets.has(kind)) sets.set(kind, []);
    sets.get(kind).push(o);
  }
  let merged = 0;
  let removed = 0;
  for (const list of sets.values()) {
    if (list.length < 2) continue;
    const geos = list.map((o) => {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      const m = new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld);
      g.applyMatrix4(m);
      // (A mirrored mesh's triangles face the other way once its matrix is baked in.)
      if (m.determinant() < 0) flipWinding(g);
      return g;
    });
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!geo) continue;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, list[0].material);
    mesh.name = 'merged';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    for (const o of list) o.removeFromParent();
    merged++;
    removed += list.length;
  }
  return [meshes, meshes - removed + merged];
}

function visibleChain(o, top) {
  for (let a = o; a && a !== top; a = a.parent) if (!a.visible) return false;
  return true;
}

// Reverse every triangle (a non-indexed triangle list).
function flipWinding(g) {
  for (const attr of Object.values(g.attributes)) {
    const a = attr.array;
    const n = attr.itemSize;
    for (let i = 0; i + 2 < attr.count; i += 3) {
      for (let k = 0; k < n; k++) {
        const t = a[(i + 1) * n + k];
        a[(i + 1) * n + k] = a[(i + 2) * n + k];
        a[(i + 2) * n + k] = t;
      }
    }
  }
}
