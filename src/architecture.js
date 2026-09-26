// Architecture for the upstairs: the Stair Hall and the generated wings.
// Each generated wing is built in one "form": a spiral ramp, a basilica (as a
// temple, an iron hall or a crypt), an octagon, an enfilade of salons, an
// attic, or the classic box (white void, screening room, plain room). Rooms
// may have floors at several heights; see ground() and walkable() in world.js.
import * as THREE from 'three';
import * as TX from './textures.js';

const TAU = Math.PI * 2;

// cap: how many association doors the form has room for.
export const FORMS = {
  spiral: { cap: 3, maxWorks: 7 },
  basilica: { cap: 3, maxWorks: 8 },
  iron: { cap: 3, maxWorks: 8 },
  crypt: { cap: 3, maxWorks: 8 },
  octagon: { cap: 3, maxWorks: 4 },
  enfilade: { cap: 3, maxWorks: 7 },
  attic: { cap: 2, maxWorks: 8 },
  void: { cap: 3, maxWorks: 7 },
  cinema: { cap: 3, maxWorks: 7 },
  rect: { cap: 3, maxWorks: 7 },
};

export const DEFAULT_FORMS = {
  salon: ['enfilade', 'octagon', 'rect'],
  white: ['spiral', 'basilica', 'void', 'octagon'],
  night: ['iron', 'crypt', 'octagon'],
  pastel: ['attic', 'rect'],
  screening: ['cinema'],
};

// A wing's own form if it fits its works, else a stable default for its template.
export function formFor(spec, key, works) {
  const fits = (f) => FORMS[f] && works <= FORMS[f].maxWorks;
  if (spec.form && fits(spec.form)) return spec.form;
  const options = (DEFAULT_FORMS[spec.template] || DEFAULT_FORMS.salon).filter(fits);
  return options[Math.floor(TX.hash(key) * options.length)] || 'rect';
}

export function capacityOf(form, works) {
  if ((form === 'void' || form === 'cinema' || form === 'rect') && works > 6) return 2;
  return FORMS[form]?.cap ?? 2;
}

// Splits a rectangle into walkable rectangles that avoid the given holes.
export function rectMinus(outer, holes, h = 0) {
  const cuts = (a, b, keys) => [...new Set([a, b, ...keys.filter((v) => v > a && v < b)])].sort((p, q) => p - q);
  const xs = cuts(outer.x0, outer.x1, holes.flatMap((r) => [r.x0, r.x1]));
  const zs = cuts(outer.z0, outer.z1, holes.flatMap((r) => [r.z0, r.z1]));
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const mx = (xs[i] + xs[i + 1]) / 2;
      const mz = (zs[j] + zs[j + 1]) / 2;
      if (holes.some((r) => mx > r.x0 && mx < r.x1 && mz > r.z0 && mz < r.z1)) continue;
      out.push({ type: 'rect', x0: xs[i], x1: xs[i + 1], z0: zs[j], z1: zs[j + 1], h });
    }
  }
  return out;
}

// How works are shown, mixed per room: on the wall, on an easel, leaning
// against the wall, hung on wires, floating, or on a freestanding panel.
// Each wing takes its form's palette from a stable offset, so neighbouring
// works differ and every wing mixes differently.
const PALETTES = {
  enfilade: ['wall', 'easel', 'wall', 'wire', 'wall', 'lean'],
  basilica: ['wall', 'float', 'wire', 'wall', 'easel', 'wall'],
  iron: ['wire', 'float', 'wall', 'wire', 'float', 'lean'],
  crypt: ['lean', 'wall', 'easel', 'lean', 'wall'],
  octagon: ['wall', 'easel', 'wall', 'lean'],
  attic: ['wall', 'easel', 'wall', 'lean', 'wall', 'easel'],
  void: ['float', 'easel', 'float', 'panel', 'float', 'easel'],
  rect: ['wall', 'easel', 'wall', 'lean', 'wire'],
};
export function displayModes(form, key, n) {
  const palette = PALETTES[form] || ['wall'];
  const offset = Math.floor(TX.hash(`${key}:display`) * palette.length);
  return Array.from({ length: n }, (_, k) => palette[(k + offset) % palette.length]);
}

export function makeArchitecture(ctx) {
  const { M, V3, facing, additive, glowTex, beamTex, makeRoom, addLights, addWork, addPortal, addText, animate, pictureLight, rectRoom, easel, art, withheld, TEMPLATES, whenArt, customPlaque } = ctx;
  const std = (color, roughness = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const twoSided = (color, roughness = 0.9, extra = {}) => std(color, roughness, { side: THREE.DoubleSide, ...extra });

  // ------------------------------------------------------------- helpers
  function mesh(room, geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    room.group.add(m);
    return m;
  }
  function box(room, w, h, d, x, y, z, mat, rotY = 0) {
    const m = mesh(room, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
    m.rotation.y = rotY;
    return m;
  }
  // A square beam from point a to point b.
  function beam(room, a, b, size, mat) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = mesh(room, new THREE.BoxGeometry(size, dir.length(), size), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  }
  function floorPlane(room, x0, x1, z0, z1, y, mat) {
    const m = mesh(room, new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat, (x0 + x1) / 2, y, (z0 + z1) / 2);
    m.rotation.x = -Math.PI / 2;
    return m;
  }
  function ceilingPlane(room, x0, x1, z0, z1, y, mat) {
    const m = mesh(room, new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat, (x0 + x1) / 2, y, (z0 + z1) / 2);
    m.rotation.x = Math.PI / 2;
    return m;
  }
  // A textured wall plane facing `dir`, from y0 to y0 + H.
  function wall(room, len, H, canvasTex, x, z, dir, y0 = 0, tile = 4) {
    const t = canvasTex.clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(len / tile, 1);
    const m = mesh(room, new THREE.PlaneGeometry(len, H), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }), x, y0 + H / 2, z);
    m.rotation.y = facing(dir);
    return m;
  }
  // Balustrade along a polyline of walking-surface points.
  function rail(room, pts, mat, height = 1.0) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      beam(room, V3(a.x, a.y + height, a.z), V3(b.x, b.y + height, b.z), 0.07, mat);
      beam(room, V3(a.x, a.y + 0.12, a.z), V3(b.x, b.y + 0.12, b.z), 0.05, mat);
      const n = Math.max(1, Math.round(a.distanceTo(b) / 0.45));
      for (let k = 0; k <= n; k++) {
        const p = a.clone().lerp(b, k / n);
        box(room, 0.04, height - 0.12, 0.04, p.x, p.y + 0.12 + (height - 0.12) / 2, p.z, mat);
      }
    }
  }
  function column(room, x, z, y0, h, r, mat, { capital = true, base = true, obstacle = true } = {}) {
    mesh(room, new THREE.CylinderGeometry(r * 0.92, r, h, 20), mat, x, y0 + h / 2, z);
    if (base) box(room, r * 2.6, 0.26, r * 2.6, x, y0 + 0.13, z, mat);
    if (capital) box(room, r * 2.7, 0.3, r * 2.7, x, y0 + h - 0.15, z, mat);
    if (obstacle) room.obstacles.push({ type: 'circle', x, z, r: r * 1.25, y0: y0 - 0.6, y1: y0 + h - 0.5 });
  }
  // A straight flight of steps. The run goes from `from` (height h0) to `to`
  // (height h1) along `axis`; a0..a1 spans the other axis. Returns its ramp.
  function flight(room, { axis, from, to, a0, a1, h0, h1, mat }) {
    const n = Math.max(1, Math.round(Math.abs(h1 - h0) / 0.17));
    const run = (to - from) / n;
    const dh = (h1 - h0) / n;
    const bottom = Math.min(h0, h1) - 0.06;
    const width = a1 - a0;
    const mid = (a0 + a1) / 2;
    for (let i = 0; i < n; i++) {
      const top = h0 + (i + 1) * dh;
      const c = from + (i + 0.5) * run;
      const hgt = Math.max(0.05, top - bottom);
      if (axis === 'z') box(room, width, hgt, Math.abs(run) + 0.01, mid, bottom + hgt / 2, c, mat);
      else box(room, Math.abs(run) + 0.01, hgt, width, c, bottom + hgt / 2, mid, mat);
    }
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const rect = axis === 'z' ? { x0: a0, x1: a1, z0: lo, z1: hi } : { x0: lo, x1: hi, z0: a0, z1: a1 };
    return { type: 'rect', ...rect, ramp: { axis, from, to, h0, h1 } };
  }
  // A wall with a round-headed opening, centred on x (along the x axis at z).
  function archWall(room, { x, z, w, H, aw, ah, depth = 0.4, mat, rotY = 0 }) {
    const s = new THREE.Shape();
    const r = aw / 2;
    s.moveTo(-w / 2, 0);
    s.lineTo(-r, 0);
    s.lineTo(-r, ah - r);
    s.absarc(0, ah - r, r, Math.PI, 0, true);
    s.lineTo(r, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2, H);
    s.lineTo(-w / 2, H);
    s.lineTo(-w / 2, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 20 });
    geo.translate(0, 0, -depth / 2);
    const m = mesh(room, geo, mat, x, 0, z);
    m.rotation.y = rotY;
    return m;
  }
  function glowPoints(room, positions, color, size, opacity = 0.9) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ map: glowTex, size, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    room.group.add(pts);
    return pts;
  }
  // Arched window: a glowing panel with glazing bars.
  function archWindow(room, x, y, z, dir, w, h, frameMat, color = 0xfff6e6) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2, h - w / 2);
    s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false);
    s.lineTo(-w / 2, 0);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = facing(dir);
    room.group.add(g);
    g.add(new THREE.Mesh(new THREE.ShapeGeometry(s, 16), new THREE.MeshBasicMaterial({ color, toneMapped: false })));
    for (const bx of [-w / 6, w / 6]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, h - 0.1, 0.05), frameMat);
      bar.position.set(bx, (h - 0.1) / 2, 0.03);
      g.add(bar);
    }
    for (const by of [h * 0.33, h * 0.62]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.05), frameMat);
      bar.position.set(0, by, 0.03);
      g.add(bar);
    }
    return g;
  }
  // Flat ribbon following a helix, between radii rIn and rOut.
  function helixStrip(cx, cz, rIn, rOut, a0, u0, u1, rise, yOff, segs) {
    const pos = [];
    const idx = [];
    for (let i = 0; i <= segs; i++) {
      const u = u0 + ((u1 - u0) * i) / segs;
      const a = a0 + u * TAU;
      const y = rise * u + yOff;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(cx + rIn * c, y, cz + rIn * s, cx + rOut * c, y, cz + rOut * s);
      if (i) {
        const k = 2 * i;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  // Vertical ribbon at radius r following u, from bottom(u) to top(u).
  function helixBand(cx, cz, r, a0, u0, u1, bottom, top, segs) {
    const pos = [];
    const idx = [];
    for (let i = 0; i <= segs; i++) {
      const u = u0 + ((u1 - u0) * i) / segs;
      const a = a0 + u * TAU;
      const x = cx + r * Math.cos(a);
      const z = cz + r * Math.sin(a);
      pos.push(x, bottom(u), z, x, top(u), z);
      if (i) {
        const k = 2 * i;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  // Ring sector lying flat, in this module's angle convention (from +x toward +z).
  function ringSector(rIn, rOut, a0, span, segs = 32) {
    const g = new THREE.RingGeometry(rIn, rOut, segs, 1, -a0 - span, span);
    g.rotateX(-Math.PI / 2);
    return g;
  }
  // Angle convention bridge for world.js 'sector' obstacles (from -z, clockwise).
  const sectorAngle = (a) => a + Math.PI / 2;

  function hangDoors(room, slots, doors, style) {
    doors.forEach((d, i) => {
      if (slots[i]) addPortal(room, { ...slots[i], dest: d.dest, subtitle: d.subtitle, style });
    });
    return slots.slice(doors.length);
  }
  function wingText(room, spec, pos, dir, ink, width = 3.0) {
    return addText(room, { kicker: 'Generated wing', title: spec.name, subtitle: spec.subtitle, body: spec.statement, width, style: ink }, pos, dir);
  }
  function worksOf(spec) {
    return (spec.works || []).filter((id) => art.has(id) || withheld.has(id));
  }
  // Shows one work. `slot` is where it would hang on a wall (centre, facing
  // `dir`); floor-standing modes stand `inset` metres out from that spot.
  const wireMat = std(0x2a2622, 0.4, { metalness: 0.6 });
  function hang(room, id, slot, mode, common, env = {}) {
    const floorY = env.floorY ?? 0;
    const d = slot.dir.clone().normalize();
    const at = (dist, y) => V3(slot.pos.x + d.x * dist, y, slot.pos.z + d.z * dist);
    const inset = env.inset ?? 1.8;
    if (mode === 'easel') return easel(room, id, at(inset, floorY), d, { ...common, h: Math.min(1.25, slot.h), maxW: 1.5 });
    if (mode === 'float') {
      const glow = env.dark ? { floorGlow: common.glow } : { shadow: true };
      return addWork(room, id, { ...common, ...glow, pos: at(inset + 0.4, floorY + 2.0), dir: d, h: Math.min(slot.h, 1.8), maxW: 2.4, float: true, obstacle: true, floorY });
    }
    if (mode === 'panel') {
      const res = addWork(room, id, { ...common, pos: at(inset + 0.12, floorY + 1.75), dir: d, h: Math.min(slot.h, 1.7), maxW: 2.2 });
      const fw = (res?.frame.w ?? 1.6) + 1.1;
      const c = at(inset, floorY + 1.55);
      box(room, fw, 3.1, 0.2, c.x, c.y, c.z, M.slab, facing(d));
      const hx = Math.abs(d.z) * (fw / 2) + Math.abs(d.x) * 0.1;
      const hz = Math.abs(d.x) * (fw / 2) + Math.abs(d.z) * 0.1;
      room.obstacles.push({ type: 'rect', x0: c.x - hx, x1: c.x + hx, z0: c.z - hz, z1: c.z + hz, y0: floorY - 0.5, y1: floorY + 0.5 });
      return res;
    }
    if (mode === 'lean') {
      const lean = 0.13;
      const res = addWork(room, id, { ...common, ...slot, h: Math.min(slot.h * 1.05, env.leanMax ?? 2.0), lean, pos: at(0.3, floorY + 1) });
      if (!res) return res;
      const fh = res.frame.h;
      res.group.position.copy(at(0.06 + (fh / 2) * Math.sin(lean), floorY + 0.03 + (fh / 2) * Math.cos(lean)));
      const foot = at(0.32, floorY);
      room.obstacles.push({ type: 'circle', x: foot.x, z: foot.z, r: Math.min(0.9, res.frame.w / 2), y0: floorY - 0.5, y1: floorY + 0.5 });
      return res;
    }
    if (mode === 'wire') {
      const res = addWork(room, id, { ...common, ...slot, pos: at(0.1, slot.pos.y), lean: -0.05 });
      if (!res) return res;
      const top = slot.pos.y + res.frame.h / 2 + (res.frame.cy || 0);
      const railY = env.wireTo ?? top + 1.1;
      if (railY < top + 0.25) return res;
      const r = V3(d.z, 0, -d.x);
      const fw = res.frame.w;
      const c = at(0.03, railY);
      box(room, fw + 0.5, 0.05, 0.05, c.x, c.y, c.z, M.brass, facing(d));
      for (const sx of [-1, 1]) {
        const off = (fw / 2 - 0.12) * sx;
        const a = V3(slot.pos.x + d.x * 0.14 + r.x * off, top - 0.03, slot.pos.z + d.z * 0.14 + r.z * off);
        const b = V3(slot.pos.x + d.x * 0.03 + r.x * off * 0.7, railY, slot.pos.z + d.z * 0.03 + r.z * off * 0.7);
        beam(room, a, b, 0.012, wireMat);
      }
      return res;
    }
    return addWork(room, id, { ...common, ...slot });
  }

  function workStyle(t, accent) {
    return { frame: t.frame, plaque: t.plaque, ink: t.ink, margin: 1.0, maxW: 3.0, glow: accent.getHex() };
  }

  // ------------------------------------------------------------ Stair Hall
  // A double-height hall: a grand flight up to a U-shaped balcony (doors to
  // the upper wings) and a flight down into a pit (the basement door).
  function buildStairHall({ up = [], down = null, ground = [], directory }) {
    const SX = 0;
    const SZ = -600;
    const X = (x) => SX + x;
    const Z = (z) => SZ + z;
    const UP = 4.6;
    const DOWN = -2.9;
    const H = 10.5;
    const bounds = { type: 'rect', x0: X(-11), x1: X(11), z0: Z(-12), z1: Z(12) };
    const room = makeRoom('stairhall', bounds, 'marble', {
      bg: '#efe8dc',
      fog: { type: 'linear', color: '#efe8dc', near: 30, far: 90 },
      envI: 0.5,
    });
    const stone = std(0xefe7da, 0.8);
    const darkStone = std(0x8d8272, 0.9);
    const brass = M.brass;
    const stairFoot = { x0: X(-2.7), x1: X(2.7), z0: Z(-8.6), z1: Z(-0.75) };
    const pit = { x0: X(-10.8), x1: X(-8.0), z0: Z(-0.4), z1: Z(6.5) };
    const groundFloors = rectMinus(bounds, [stairFoot, pit], 0);
    room.floors = [
      ...groundFloors,
      flight(room, { axis: 'z', from: Z(-0.75), to: Z(-8.6), a0: X(-2.7), a1: X(2.7), h0: 0, h1: UP, mat: stone }),
      { type: 'rect', x0: X(-11), x1: X(11), z0: Z(-12), z1: Z(-8.6), h: UP },
      { type: 'rect', x0: X(-11), x1: X(-7.6), z0: Z(-12), z1: Z(4), h: UP },
      { type: 'rect', x0: X(7.6), x1: X(11), z0: Z(-12), z1: Z(4), h: UP },
      flight(room, { axis: 'z', from: Z(6.5), to: Z(1.6), a0: X(-10.8), a1: X(-8.0), h0: 0, h1: DOWN, mat: darkStone }),
      { type: 'rect', x0: X(-10.8), x1: X(-8.0), z0: Z(-0.4), z1: Z(1.6), h: DOWN },
    ];

    // Floor (with holes for the flight and the pit), walls, coffered ceiling.
    const floorMat = new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.tileFloor(), { repeat: [5.5, 6] }), roughness: 0.35 });
    for (const f of groundFloors) {
      const mat = floorMat.clone();
      mat.map = floorMat.map.clone();
      mat.map.repeat.set((f.x1 - f.x0) / 4, (f.z1 - f.z0) / 4);
      mat.map.offset.set(f.x0 / 4, -f.z1 / 4);
      mat.map.needsUpdate = true;
      floorPlane(room, f.x0, f.x1, f.z0, f.z1, 0, mat);
    }
    floorPlane(room, pit.x0, pit.x1, Z(-0.4), Z(1.6), DOWN, darkStone);
    const wallTex = TX.toTexture(TX.plainWall(H, '#ece3d3', '#c9b99c'));
    wall(room, 22, H, wallTex, X(0), Z(-12), V3(0, 0, 1));
    wall(room, 22, H, wallTex, X(0), Z(12), V3(0, 0, -1));
    wall(room, 24, H, wallTex, X(-11), Z(0), V3(1, 0, 0));
    wall(room, 24, H, wallTex, X(11), Z(0), V3(-1, 0, 0));
    ceilingPlane(room, X(-11), X(11), Z(-12), Z(12), H, new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.coffers(), { repeat: [5.5, 6] }), roughness: 1 }));
    // Pit walls.
    for (const [x, z, len, dir] of [
      [X(-10.8), Z(3.05), 6.9, V3(1, 0, 0)],
      [X(-8.0), Z(3.05), 6.9, V3(-1, 0, 0)],
    ]) {
      const m = mesh(room, new THREE.PlaneGeometry(len, -DOWN), darkStone, x, DOWN / 2, z);
      m.rotation.y = facing(dir);
    }
    mesh(room, new THREE.PlaneGeometry(2.8, -DOWN), darkStone, X(-9.4), DOWN / 2, Z(-0.4));

    // Balconies, columns and balustrades.
    const slab = std(0xf3ede3, 0.85);
    box(room, 22, 0.36, 3.4, X(0), UP - 0.18, Z(-10.3), slab);
    box(room, 3.4, 0.36, 16, X(-9.3), UP - 0.18, Z(-4), slab);
    box(room, 3.4, 0.36, 16, X(9.3), UP - 0.18, Z(-4), slab);
    box(room, 22, 0.14, 0.1, X(0), UP - 0.3, Z(-8.62), brass);
    for (const sx of [-1, 1]) {
      box(room, 0.1, 0.14, 12.6, X(sx * 7.62), UP - 0.3, Z(-2.3), brass);
      for (const z of [-8.6, -2.3, 4]) column(room, X(sx * 7.6), Z(z), 0, UP - 0.36, 0.3, stone);
      column(room, X(sx * 4.6), Z(-8.6), 0, UP - 0.36, 0.3, stone);
    }
    const railMat = std(0x2b2520, 0.5, { metalness: 0.4 });
    rail(room, [V3(X(-7.6), UP, Z(-8.6)), V3(X(-2.7), UP, Z(-8.6))], railMat);
    rail(room, [V3(X(2.7), UP, Z(-8.6)), V3(X(7.6), UP, Z(-8.6))], railMat);
    for (const sx of [-1, 1]) {
      rail(room, [V3(X(sx * 7.6), UP, Z(-8.6)), V3(X(sx * 7.6), UP, Z(4)), V3(X(sx * 11), UP, Z(4))], railMat);
      rail(room, [V3(X(sx * 2.75), 0, Z(-0.75)), V3(X(sx * 2.75), UP, Z(-8.6))], railMat);
    }
    rail(room, [V3(X(-8.0), 0, Z(6.5)), V3(X(-8.0), 0, Z(-0.4)), V3(X(-10.8), 0, Z(-0.4))], railMat);
    // A runner up the middle of the grand flight.
    const runner = std(0x7a1f2b, 1);
    const n = Math.round(UP / 0.17);
    for (let i = 0; i < n; i++) {
      const z = Z(-0.75) + ((i + 0.5) * (Z(-8.6) - Z(-0.75))) / n;
      box(room, 2.2, 0.012, 0.3, X(0), ((i + 1) * UP) / n + 0.006, z, runner);
      box(room, 2.2, UP / n, 0.012, X(0), ((i + 0.5) * UP) / n, z + (Z(-0.75) - Z(-8.6)) / n / 2 + 0.006, runner);
    }

    // Tall windows above the balconies, and a chandelier over the stair foot.
    const frameMat = std(0x4a3c2c, 0.6);
    for (const sx of [-1, 1]) {
      for (const z of [-7, 0]) archWindow(room, X(sx * 10.96), UP + 1.1, Z(z), V3(-sx, 0, 0), 1.9, 4.2, frameMat);
    }
    const chX = X(0);
    const chZ = Z(-2.5);
    beam(room, V3(chX, H, chZ), V3(chX, 7.9, chZ), 0.05, brass);
    const lights = [];
    for (const [r, y, count] of [[1.8, 7.5, 18], [1.1, 7.1, 12], [0.5, 6.8, 6]]) {
      const ring = mesh(room, new THREE.TorusGeometry(r, 0.03, 6, 48), brass, chX, y, chZ);
      ring.rotation.x = Math.PI / 2;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU;
        lights.push(chX + Math.cos(a) * r, y + 0.1, chZ + Math.sin(a) * r);
      }
    }
    const bulbs = glowPoints(room, lights, 0xffe2b0, 0.34);
    animate(room, (t) => {
      bulbs.material.opacity = 0.82 + Math.sin(t * 2.3) * 0.06;
    });
    addLights(room, [0xfff4e6, 0x8a7a66, 1.0], [
      [chX, 7.2, chZ, 0xffe6c0, 60, 34],
      [X(-9.4), 1.2, Z(1.4), 0xffc890, 8, 9],
    ]);

    // Doors: in from the Entrance Hall; up on the balconies; down in the pit.
    addPortal(room, { pos: V3(X(0), 0, Z(12) - 0.06), dir: V3(0, 0, -1), dest: 'lobby', w: 2.6, h: 3.4, signW: 3.2, entrance: true, subtitle: 'Back to the Entrance Hall' });
    const upSlots = [
      { pos: V3(X(0), UP, Z(-12) + 0.06), dir: V3(0, 0, 1), w: 2.4, h: 3.2, signW: 2.8 },
      { pos: V3(X(-6.2), UP, Z(-12) + 0.06), dir: V3(0, 0, 1), w: 2.4, h: 3.2, signW: 2.8 },
      { pos: V3(X(6.2), UP, Z(-12) + 0.06), dir: V3(0, 0, 1), w: 2.4, h: 3.2, signW: 2.8 },
      { pos: V3(X(-11) + 0.06, UP, Z(-3.5)), dir: V3(1, 0, 0), w: 2.4, h: 3.2, signW: 2.8 },
      { pos: V3(X(11) - 0.06, UP, Z(-3.5)), dir: V3(-1, 0, 0), w: 2.4, h: 3.2, signW: 2.8 },
    ];
    hangDoors(room, upSlots, up, 'dark');
    if (down) addPortal(room, { pos: V3(X(-9.4), DOWN, Z(-0.4) + 0.06), dir: V3(0, 0, 1), dest: down.dest, subtitle: down.subtitle, w: 2.2, h: 2.1, signW: 2.1 });
    const groundSlots = [
      { pos: V3(X(11) - 0.06, 0, Z(8)), dir: V3(-1, 0, 0), w: 2.4, h: 3.2, signW: 2.8 },
      { pos: V3(X(6.5), 0, Z(12) - 0.06), dir: V3(0, 0, -1), w: 2.4, h: 3.2, signW: 2.8 },
      { pos: V3(X(-5.5), 0, Z(12) - 0.06), dir: V3(0, 0, -1), w: 2.4, h: 3.2, signW: 2.8 },
    ];
    hangDoors(room, groundSlots, ground, 'dark');

    // Directory on a freestanding stand at the foot of the stairs.
    box(room, 2.3, 2.6, 0.12, X(4.9), 1.3, Z(2.2), std(0x2d2721, 0.6));
    addText(room, { ...directory, width: 2.0, style: 'light' }, V3(X(4.9), 1.55, Z(2.2) + 0.07), V3(0, 0, 1));
    room.obstacles.push({ type: 'rect', x0: X(3.7), x1: X(6.1), z0: Z(2.05), z1: Z(2.35) });

    // Where you arrive from a wing that has no door of its own here.
    room.landing = { room: 'stairhall', pos: V3(X(0), UP, Z(-12) + 0.1), normal: V3(0, 0, 1), w: 2.4, h: 3.2 };
    return room;
  }

  // ------------------------------------------------------------ wing forms
  function buildWing(key, spec, index, form, doors) {
    const t = TEMPLATES[spec.template] || TEMPLATES.salon;
    const kind = TEMPLATES[spec.template] ? spec.template : 'salon';
    const accent = new THREE.Color(spec.accent || '#8a6d3b');
    const ids = worksOf(spec).slice(0, FORMS[form].maxWorks);
    const cx = -400 + (index % 5) * 200;
    const z0 = 400 + Math.floor(index / 5) * 200;
    const args = { key, spec, t, kind, accent, ids, cx, z0, doors };
    const build = { spiral, basilica, iron: basilica, crypt: basilica, octagon, enfilade, attic }[form] || classic;
    return build({ ...args, form });
  }

  // Spiral: a ramp winding up around an atrium to a landing at the top.
  function spiral({ key, spec, t, accent, ids, cx, z0, doors }) {
    const cz = z0 + 16;
    const r0 = 4.2;
    const r1 = 8.2;
    const rise = 3.5;
    const turns = 1.75;
    const a0 = Math.PI / 2;
    const top = rise * turns;
    const aEnd = a0 + turns * TAU;
    const roofY = top + 3.9;
    const room = makeRoom(key, { type: 'circle', x: cx, z: cz, r: r1 }, 'marble', {
      bg: '#f4f2ee',
      fog: { type: 'linear', color: '#f4f2ee', near: 26, far: 70 },
      envI: 0.9,
    });
    room.floors = [
      { type: 'circle', x: cx, z: cz, r: r0, h: 0 },
      { type: 'helix', x: cx, z: cz, r0, r1, a0, turns, rise, h0: 0 },
      { type: 'sector', x: cx, z: cz, r0, r1, a0: aEnd, span: Math.PI / 2, h: top },
    ];
    const concrete = twoSided(0xe7e2d8, 0.85);
    const underside = twoSided(0xd3cdc1, 0.95);
    const parapetMat = twoSided(0xfbfaf7, 0.95);
    const handrail = twoSided(0x4d443b, 0.5, { metalness: 0.4 });
    mesh(room, new THREE.CircleGeometry(r1, 96).rotateX(-Math.PI / 2), std(0xeeebe4, 0.6), cx, 0, cz);
    mesh(room, helixStrip(cx, cz, r0, r1, a0, 0, turns, rise, 0, 260), concrete);
    mesh(room, helixStrip(cx, cz, r0, r1, a0, 0, turns, rise, -0.32, 260), underside);
    const bottom = (u) => (u < 1 ? 0 : rise * u - 0.32);
    const crest = (u) => rise * u + 1.05;
    mesh(room, helixBand(cx, cz, r0, a0, 0.1, turns, bottom, crest, 240), parapetMat);
    mesh(room, helixBand(cx, cz, r0 + 0.16, a0, 0.1, turns, (u) => rise * u, crest, 240), parapetMat);
    mesh(room, helixStrip(cx, cz, r0 - 0.01, r0 + 0.17, a0, 0.1, turns, rise, 1.05, 240), parapetMat);
    mesh(room, helixStrip(cx, cz, r0 + 0.03, r0 + 0.13, a0, 0.1, turns, rise, 1.065, 240), handrail);
    mesh(room, helixBand(cx, cz, r0 - 0.012, a0, 0.1, turns, (u) => rise * u + 1.0, (u) => rise * u + 1.06, 240), handrail);
    // Landing slab and its parapet.
    mesh(room, ringSector(r0, r1, aEnd, Math.PI / 2), concrete, cx, top, cz);
    mesh(room, ringSector(r0, r1, aEnd, Math.PI / 2), underside, cx, top - 0.32, cz);
    mesh(room, helixBand(cx, cz, r0, aEnd, 0, 0.25, () => top - 0.32, () => top + 1.05, 40), parapetMat);
    mesh(room, helixStrip(cx, cz, r0 - 0.01, r0 + 0.17, aEnd, 0, 0.25, 0, top + 1.05, 40), parapetMat);
    mesh(room, helixStrip(cx, cz, r0 + 0.03, r0 + 0.13, aEnd, 0, 0.25, 0, top + 1.065, 40), handrail);
    // Cheek wall where the ramp begins, closing the space under the first turn.
    const cheek = mesh(room, new THREE.PlaneGeometry(r1 - r0, rise - 0.32), parapetMat, cx + ((r0 + r1) / 2) * Math.cos(a0 - 0.01), (rise - 0.32) / 2, cz + ((r0 + r1) / 2) * Math.sin(a0 - 0.01));
    cheek.rotation.y = facing(V3(-Math.sin(a0), 0, Math.cos(a0)));
    // Where the parapet begins, keep people from stepping through it.
    const pa = a0 + 0.1 * TAU;
    room.obstacles.push({ type: 'sector', x: cx, z: cz, r0: r0 - 0.15, r1: r0 + 0.2, a: sectorAngle(pa + 0.35), half: 0.38, y0: -1, y1: 0.9 });
    // Outer drum and the glass roof.
    mesh(room, new THREE.CylinderGeometry(r1, r1, roofY, 96, 1, true), std(0xf8f7f3, 0.95, { side: THREE.BackSide }), cx, roofY / 2, cz);
    mesh(room, new THREE.CircleGeometry(r1, 64).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2f7ff, toneMapped: false }), cx, roofY, cz);
    const rib = std(0xdcd8cf, 0.7);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      beam(room, V3(cx + Math.cos(a) * 1.2, roofY - 0.08, cz + Math.sin(a) * 1.2), V3(cx + Math.cos(a) * r1, roofY - 0.08, cz + Math.sin(a) * r1), 0.14, rib);
    }
    for (const r of [1.2, 4.2]) mesh(room, new THREE.TorusGeometry(r, 0.07, 6, 64).rotateX(Math.PI / 2), rib, cx, roofY - 0.1, cz);
    addLights(room, [0xffffff, 0xe6e2da, 1.25], [
      [cx, roofY - 1.2, cz, 0xffffff, 40, 30],
      [cx, 2.4, cz, 0xfff4e6, 10, 12],
    ]);

    const style = t.ink === 'light' ? 'light' : 'dark';
    const at = (a, r, y) => V3(cx + r * Math.cos(a), y, cz + r * Math.sin(a));
    const inward = (a) => V3(-Math.cos(a), 0, -Math.sin(a));
    const ea = a0 + 0.24;
    addPortal(room, { pos: at(ea, r1 - 0.12, (rise * 0.24) / TAU), dir: inward(ea), dest: doors.back.dest, subtitle: doors.back.subtitle, w: 2.2, h: 2.5, signW: 2.4, entrance: true, style });
    const m = doors.links.length;
    doors.links.forEach((d, i) => {
      const a = aEnd + ((i + 1) / (m + 1)) * (Math.PI / 2);
      addPortal(room, { pos: at(a, r1 - 0.12, top), dir: inward(a), dest: d.dest, subtitle: d.subtitle, w: 2.2, h: 2.8, signW: 2.2, style });
    });
    // Works climb the outer wall.
    const common = workStyle(t, accent);
    ids.forEach((id, k) => {
      const u = 0.32 + (k * (turns - 0.62)) / Math.max(1, ids.length - 1);
      const a = a0 + u * TAU;
      addWork(room, id, { ...common, pos: at(a, r1 - 0.17, rise * u + 1.6), dir: inward(a), h: 1.8, maxW: 2.5 });
    });
    box(room, 2.5, 1.75, 0.14, cx, 0.875, cz - 2.2, std(0x3b342e, 0.6));
    wingText(room, spec, V3(cx, 0.95, cz - 2.2 + 0.08), V3(0, 0, 1), 'light', 2.2);
    room.obstacles.push({ type: 'rect', x0: cx - 1.3, x1: cx + 1.3, z0: cz - 2.3, z1: cz - 2.1 });
    return room;
  }

  // Basilica: a nave between colonnades, aisles hung with works. As a white
  // temple (coffered vault, gold apse), an iron-and-glass hall, or a crypt.
  function basilica({ key, spec, t, kind, accent, ids, cx, z0, doors, form }) {
    const v = form === 'iron' ? 'iron' : form === 'crypt' ? 'crypt' : 'temple';
    const nb = Math.max(2, Math.ceil(ids.length / 2));
    const bay = v === 'crypt' ? 4.2 : 4.6;
    const x0 = cx - 7.5;
    const x1 = cx + 7.5;
    const colX = 3.3;
    const zc0 = z0 + 3.5;
    const z1 = zc0 + nb * bay + 3.0;
    const apse = v !== 'iron';
    const Hw = { temple: 5.2, iron: 6.5, crypt: 3.4 }[v];
    const spring = { temple: 6.0, iron: 6.5, crypt: 2.9 }[v];
    const palette = {
      temple: { bg: '#f4f0e8', wall: ['#ebe4d6', '#cfc3ae'], col: 0xefe8dc, floor: 0xece6da, hemi: [0xfff6e8, 0xb9ae98, 0.8], light: 0xfff0dc, ink: 'dark', surface: 'marble' },
      iron: { bg: '#1a1c22', wall: ['#2a2b33', '#17181d'], col: 0x2f3440, floor: 0x2a2b30, hemi: [0x9fb2c8, 0x15151b, 0.75], light: 0xdfe8ff, ink: 'light', surface: 'stone' },
      crypt: { bg: '#120e0b', wall: ['#3b342d', '#221d18'], col: 0x5a5046, floor: 0x3a342c, hemi: [0x6a5a4a, 0x0c0908, 0.5], light: 0xffb070, ink: 'light', surface: 'stone' },
    }[v];
    const dark = v !== 'temple';
    const room = makeRoom(key, { type: 'rect', x0, x1, z0, z1: apse ? z1 + colX : z1 }, palette.surface, {
      bg: palette.bg,
      fog: dark ? { type: 'exp2', color: palette.bg, density: v === 'crypt' ? 0.045 : 0.02 } : { type: 'linear', color: palette.bg, near: 30, far: 80 },
      envI: dark ? 0.25 : 0.6,
    });
    room.floors = [{ type: 'rect', x0, x1, z0, z1, h: 0 }];
    if (apse) room.floors.push({ type: 'circle', x: cx, z: z1, r: colX, h: 0 });
    const colMat = std(palette.col, v === 'iron' ? 0.45 : 0.7, v === 'iron' ? { metalness: 0.6 } : {});
    const floorMat = v === 'temple'
      ? new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.tileFloor(), { repeat: [15 / 4, (z1 - z0) / 4] }), roughness: 0.3 })
      : std(palette.floor, v === 'iron' ? 0.35 : 0.95, v === 'iron' ? { metalness: 0.25 } : {});
    floorPlane(room, x0, x1, z0, z1, 0, floorMat);
    const wallTex = TX.toTexture(TX.plainWall(Hw, ...palette.wall));
    const L = z1 - z0;
    wall(room, L, Hw, wallTex, x0, (z0 + z1) / 2, V3(1, 0, 0));
    wall(room, L, Hw, wallTex, x1, (z0 + z1) / 2, V3(-1, 0, 0));
    wall(room, 15, Hw, wallTex, cx, z0, V3(0, 0, 1));
    if (apse) {
      wall(room, 7.5 - colX, Hw, wallTex, cx - (7.5 + colX) / 2, z1, V3(0, 0, -1));
      wall(room, 7.5 - colX, Hw, wallTex, cx + (7.5 + colX) / 2, z1, V3(0, 0, -1));
    } else wall(room, 15, Hw, wallTex, cx, z1, V3(0, 0, -1));

    // Colonnades.
    const colR = { temple: 0.42, iron: 0.17, crypt: 0.45 }[v];
    const colH = { temple: 5.2, iron: 6.5, crypt: 2.9 }[v];
    for (let i = 0; i <= nb; i++) {
      const z = zc0 + i * bay;
      for (const sx of [-1, 1]) column(room, cx + sx * colX, z, 0, colH, colR, colMat, { capital: v !== 'iron' });
    }
    if (v === 'temple') {
      // Entablature, aisle ceilings, a coffered barrel vault with a skylight.
      for (const sx of [-1, 1]) {
        box(room, 0.95, 0.8, L, cx + sx * colX, 5.6, (z0 + z1) / 2, colMat);
        ceilingPlane(room, sx < 0 ? x0 : cx + colX, sx < 0 ? cx - colX : x1, z0, z1, 5.2, std(0xf3eee4, 1));
      }
      const vaultTex = TX.toTexture(TX.coffers(), { repeat: [L / 2.2, 5] });
      const vault = new THREE.CylinderGeometry(colX, colX, L, 40, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
      mesh(room, vault, new THREE.MeshStandardMaterial({ map: vaultTex, roughness: 1, side: THREE.BackSide }), cx, spring, (z0 + z1) / 2);
      const sky = mesh(room, new THREE.PlaneGeometry(0.9, L - 1), new THREE.MeshBasicMaterial({ color: 0xfffaf0, toneMapped: false }), cx, spring + colX - 0.04, (z0 + z1) / 2);
      sky.rotation.x = Math.PI / 2;
      // Apse: a half-drum with a gold half-dome.
      mesh(room, new THREE.CylinderGeometry(colX, colX, spring, 32, 1, true, -Math.PI / 2, Math.PI), std(0xefe8da, 0.9, { side: THREE.BackSide }), cx, spring / 2, z1);
      mesh(room, new THREE.SphereGeometry(colX, 32, 12, 0, Math.PI, 0, Math.PI / 2), std(0xc9a24c, 0.45, { metalness: 0.6, side: THREE.BackSide }), cx, spring, z1);
      box(room, 15, spring - Hw, 0.3, cx, Hw + (spring - Hw) / 2, z0, std(0xf1ece2, 0.95));
      mesh(room, new THREE.CircleGeometry(colX, 32, 0, Math.PI), std(0xf1ece2, 0.95), cx, spring, z0 + 0.02);
    } else if (v === 'iron') {
      // An elliptical glass roof on iron ribs, and rails down the nave.
      const roof = new THREE.CylinderGeometry(7.5, 7.5, L, 48, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
      roof.scale(1, 0.56, 1);
      mesh(room, roof, new THREE.MeshStandardMaterial({ color: 0xbfcad6, emissive: 0x6b7f93, emissiveIntensity: 0.55, roughness: 0.2, side: THREE.DoubleSide }), cx, Hw, (z0 + z1) / 2);
      for (let i = 0; i <= nb; i++) {
        const arc = new THREE.TorusGeometry(7.4, 0.08, 6, 48, Math.PI);
        arc.scale(1, 0.56, 1);
        mesh(room, arc, colMat, cx, Hw, zc0 + i * bay);
      }
      for (const a of [0.35, 0.8, 1.2, 1.57, 1.94, 2.34, 2.79]) {
        box(room, 0.07, 0.07, L, cx + Math.cos(a) * 7.4, Hw + Math.sin(a) * 7.4 * 0.56, (z0 + z1) / 2, colMat);
      }
      for (const sx of [-1, 1]) {
        box(room, 0.08, 0.05, L - 1, cx + sx * 0.72, 0.025, (z0 + z1) / 2, std(0x8a8f99, 0.3, { metalness: 0.9 }));
      }
      for (let z = z0 + 1; z < z1 - 0.5; z += 0.8) box(room, 2.1, 0.03, 0.22, cx, 0.015, z, std(0x3a2f26, 0.9));
      const lunette = new THREE.Shape();
      lunette.moveTo(-7.5, 0);
      lunette.absellipse(0, 0, 7.5, 7.5 * 0.56, Math.PI, 0, true);
      lunette.lineTo(-7.5, 0);
      mesh(room, new THREE.ShapeGeometry(lunette, 32), std(0x2a2b33, 0.9, { side: THREE.DoubleSide }), cx, Hw, z0 + 0.02);
      const fan = mesh(room, new THREE.ShapeGeometry(lunette, 32), new THREE.MeshBasicMaterial({ color: 0xcfdcea, toneMapped: false, side: THREE.DoubleSide }), cx, Hw, z1 - 0.02);
      fan.scale.set(0.96, 0.94, 1);
      for (let i = 1; i < 8; i++) {
        const a = (i / 8) * Math.PI;
        beam(room, V3(cx, Hw, z1 - 0.06), V3(cx + Math.cos(a) * 7.2, Hw + Math.sin(a) * 7.2 * 0.56, z1 - 0.06), 0.09, colMat);
      }
      mesh(room, new THREE.TorusGeometry(3.6, 0.06, 6, 32, Math.PI).scale(1, 0.56, 1), colMat, cx, Hw, z1 - 0.07);
    } else {
      // Crypt: low barrel vaults over nave and aisles, candles by every work.
      const stone = std(0x4a423a, 0.95, { side: THREE.BackSide });
      const vault = new THREE.CylinderGeometry(colX, colX, L, 32, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
      mesh(room, vault, stone, cx, spring, (z0 + z1) / 2);
      for (const sx of [-1, 1]) {
        const ar = (7.5 - colX) / 2;
        const aisle = new THREE.CylinderGeometry(ar, ar, L, 24, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
        mesh(room, aisle, stone, cx + sx * (colX + ar), spring, (z0 + z1) / 2);
        box(room, 0.7, spring + 0.9 - colH, L, cx + sx * colX, colH + (spring + 0.9 - colH) / 2, (z0 + z1) / 2, std(0x5a5046, 0.95));
      }
      mesh(room, new THREE.CylinderGeometry(colX, colX, spring, 32, 1, true, -Math.PI / 2, Math.PI), std(0x3d352e, 0.95, { side: THREE.BackSide }), cx, spring / 2, z1);
      mesh(room, new THREE.SphereGeometry(colX, 24, 10, 0, Math.PI, 0, Math.PI / 2), std(0x3d352e, 0.95, { side: THREE.BackSide }), cx, spring, z1);
      box(room, 15, 3.4, 0.3, cx, Hw + 1.7, z0, std(0x3b342d, 0.95));
    }
    addLights(room, palette.hemi, [
      [cx, dark ? spring - 0.4 : 8, z0 + L * 0.3, palette.light, v === 'crypt' ? 9 : v === 'temple' ? 20 : 28, v === 'crypt' ? 14 : 26],
      [cx, dark ? spring - 0.4 : 8, z1 - 2, palette.light, v === 'crypt' ? 9 : v === 'temple' ? 18 : 26, v === 'crypt' ? 14 : 26],
    ]);

    const ink = palette.ink;
    const dh = v === 'crypt' ? 2.6 : 3.2;
    addPortal(room, { pos: V3(cx, 0, z0 + 0.06), dir: V3(0, 0, 1), dest: doors.back.dest, subtitle: doors.back.subtitle, w: 2.4, h: dh, signW: 2.8, entrance: true, style: ink });
    const slots = apse
      ? [
          { pos: V3(cx, 0, z1 + colX - 0.28), dir: V3(0, 0, -1), w: 2.2, h: dh, signW: 2.4 },
          { pos: V3(cx - 5.4, 0, z1 - 0.06), dir: V3(0, 0, -1), w: 2.2, h: dh, signW: 2.4 },
          { pos: V3(cx + 5.4, 0, z1 - 0.06), dir: V3(0, 0, -1), w: 2.2, h: dh, signW: 2.4 },
        ]
      : [
          { pos: V3(cx, 0, z1 - 0.06), dir: V3(0, 0, -1), w: 2.4, h: 3.4, signW: 2.8 },
          { pos: V3(cx - 5.2, 0, z1 - 0.06), dir: V3(0, 0, -1), w: 2.4, h: 3.4, signW: 2.8 },
          { pos: V3(cx + 5.2, 0, z1 - 0.06), dir: V3(0, 0, -1), w: 2.4, h: 3.4, signW: 2.8 },
        ];
    hangDoors(room, slots, doors.links, ink);
    wingText(room, spec, V3(cx - 4.9, v === 'crypt' ? 1.8 : 2.4, z0 + 0.03), V3(0, 0, 1), ink, 2.8);

    const common = workStyle(t, accent);
    const wy = { temple: 2.5, iron: 2.8, crypt: 1.8 }[v];
    const wh = { temple: 2.1, iron: 2.3, crypt: 1.45 }[v];
    const flames = [];
    const plan = displayModes(v === 'temple' ? 'basilica' : v, key, ids.length);
    const env = { dark, inset: 1.7, wireTo: v === 'iron' ? Hw + 0.3 : v === 'crypt' ? 2.8 : Hw - 0.1, leanMax: v === 'crypt' ? 1.6 : 2.0 };
    ids.forEach((id, k) => {
      const i = Math.floor(k / 2);
      const west = k % 2 === 0;
      const z = zc0 + (i + 0.5) * bay;
      const mode = plan[k];
      const placed = hang(room, id, { pos: V3(west ? x0 + 0.05 : x1 - 0.05, wy, z), dir: V3(west ? 1 : -1, 0, 0), h: wh, maxW: 3.1 }, mode, common, env);
      if (kind === 'salon' && mode === 'wall') pictureLight(placed);
      if (v === 'crypt' && (mode === 'wall' || mode === 'lean')) {
        const fx = west ? x0 + 0.9 : x1 - 0.9;
        for (const dz of [-1.6, 1.6]) {
          mesh(room, new THREE.CylinderGeometry(0.035, 0.05, 1.25, 8), M.brass, fx, 0.62, z + dz);
          mesh(room, new THREE.CylinderGeometry(0.045, 0.045, 0.16, 8), std(0xf3ead8, 0.8), fx, 1.33, z + dz);
          flames.push(fx, 1.47, z + dz);
          room.obstacles.push({ type: 'circle', x: fx, z: z + dz, r: 0.2 });
        }
      }
    });
    if (flames.length) {
      const f = glowPoints(room, flames, 0xffb35c, 0.42);
      animate(room, (tt) => {
        f.material.opacity = 0.75 + Math.sin(tt * 9.1) * 0.08 + Math.sin(tt * 13.7) * 0.05;
      });
    }
    return room;
  }

  // Octagon: eight faces under a dome with an open lantern. A chapel (warm
  // stone, gold) or a white octagon whose light comes through as scanlines.
  function octagon({ key, spec, t, accent, ids, cx, z0, doors }) {
    const white = spec.template === 'white';
    const cz = z0 + 10;
    const A = 7.2;
    const R = A / Math.cos(Math.PI / 8);
    const Hw = 6.4;
    const room = makeRoom(key, { type: 'circle', x: cx, z: cz, r: A }, 'marble', {
      bg: white ? '#f3f3f1' : '#efe4d0',
      fog: { type: 'linear', color: white ? '#f3f3f1' : '#efe4d0', near: 24, far: 70 },
      envI: white ? 0.8 : 0.5,
    });
    room.floors = [{ type: 'circle', x: cx, z: cz, r: A, h: 0 }];
    const floorTex = white ? TX.toTexture(TX.tileFloor(), { repeat: [3.5, 3.5] }) : TX.lobbyFloor(R, `${spec.name.toUpperCase()} · `);
    const floor = mesh(room, new THREE.CircleGeometry(R, 8, Math.PI / 8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.35 }), cx, 0, cz);
    floor.rotation.y = 0;
    const wallTex = TX.toTexture(white ? TX.plainWall(Hw, '#f6f6f4', '#dcdcd8') : TX.plainWall(Hw, '#e8dcc4', '#b8a27a'));
    wallTex.wrapS = THREE.RepeatWrapping;
    wallTex.repeat.set(8 * 1.4, 1);
    const walls = mesh(room, new THREE.CylinderGeometry(R, R, Hw, 8, 1, true, Math.PI / 8), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, side: THREE.BackSide }), cx, Hw / 2, cz);
    walls.rotation.y = 0;
    const trim = white ? std(0xaeb3bc, 0.5, { metalness: 0.2 }) : std(0xc9a24c, 0.45, { metalness: 0.5 });
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      const p = box(room, 0.5, Hw, 0.3, cx + Math.sin(a) * (R - 0.12), Hw / 2, cz + Math.cos(a) * (R - 0.12), trim);
      p.rotation.y = a;
    }
    mesh(room, new THREE.TorusGeometry(R - 0.12, 0.12, 8, 8, TAU).rotateX(Math.PI / 2), trim, cx, Hw, cz).rotation.y = Math.PI / 8;
    const dome = mesh(room, new THREE.SphereGeometry(R, 48, 16, 0, TAU, 0, Math.PI / 2), std(white ? 0xfbfbfa : 0xf2e9d6, 1, { side: THREE.BackSide }), cx, Hw, cz);
    dome.scale.y = 0.62;
    const topY = Hw + R * 0.62;
    mesh(room, new THREE.CircleGeometry(1.4, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), cx, topY - 0.06, cz);
    const shaft = mesh(
      room,
      new THREE.CylinderGeometry(1.3, 2.2, topY - 0.1, 40, 1, true),
      new THREE.MeshBasicMaterial({ map: beamTex, color: white ? 0xe8f4ff : 0xfff1d4, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
      cx,
      (topY - 0.1) / 2,
      cz,
    );
    if (white) {
      const lines = mesh(room, new THREE.CircleGeometry(R * 0.98, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ map: TX.scanlines(), transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }), cx, topY - 0.3, cz);
      animate(room, (tt) => {
        lines.material.opacity = 0.25 + (Math.sin(tt * 0.7) > 0.96 ? 0.35 : 0);
        shaft.material.opacity = 0.16 + Math.sin(tt * 1.3) * 0.03;
      });
    }
    addLights(room, white ? [0xffffff, 0xdedede, 1.3] : [0xfff0d8, 0x5a4a38, 0.8], [
      [cx, topY - 1, cz, white ? 0xf4f8ff : 0xffe6bc, 40, 26],
      [cx, 2.6, cz + 2, white ? 0xffffff : 0xffd9a0, 10, 12],
    ]);

    const ink = 'dark';
    const face = (phi, inset, y) => ({ pos: V3(cx + Math.sin(phi) * (A - inset), y, cz + Math.cos(phi) * (A - inset)), dir: V3(-Math.sin(phi), 0, -Math.cos(phi)) });
    addPortal(room, { ...face(0, 0.06, 0), dest: doors.back.dest, subtitle: doors.back.subtitle, w: 2.4, h: 3.3, signW: 2.8, entrance: true, style: ink });
    const doorFaces = [Math.PI, Math.PI / 2, -Math.PI / 2];
    const slots = doorFaces.map((phi) => ({ ...face(phi, 0.06, 0), w: 2.4, h: 3.3, signW: 2.8 }));
    const spare = hangDoors(room, slots, doors.links, ink);
    // The statement takes a spare door face, else a lectern by the entrance.
    if (spare.length) {
      const phi = doorFaces[doorFaces.length - spare.length];
      const f = face(phi, 0.04, 2.5);
      wingText(room, spec, f.pos, f.dir, ink, 3.0);
    } else {
      box(room, 1.9, 1.4, 0.12, cx + 2.4, 0.7, cz + 4.2, std(0x3a3028, 0.6));
      wingText(room, spec, V3(cx + 2.4, 1.0, cz + 4.2 - 0.07), V3(0, 0, -1), 'light', 1.7);
      room.obstacles.push({ type: 'rect', x0: cx + 1.4, x1: cx + 3.4, z0: cz + 4.1, z1: cz + 4.3 });
    }
    const common = workStyle(t, accent);
    const flames = [];
    const plan = displayModes('octagon', key, ids.length);
    [(3 * Math.PI) / 4, (-3 * Math.PI) / 4, Math.PI / 4, -Math.PI / 4].slice(0, ids.length).forEach((phi, k) => {
      const f = face(phi, 0.06, 2.6);
      const mode = plan[k];
      const placed = hang(room, ids[k], { pos: f.pos, dir: f.dir, h: 2.2, maxW: 3.6 }, mode, common, { inset: 1.8, wireTo: Hw - 0.2, leanMax: 2.0 });
      if (!white && mode === 'wall') {
        pictureLight(placed);
        const bx = cx + Math.sin(phi) * (A - 1.2);
        const bz = cz + Math.cos(phi) * (A - 1.2);
        mesh(room, new THREE.CylinderGeometry(0.04, 0.12, 1.1, 10), M.brass, bx, 0.55, bz);
        flames.push(bx, 1.2, bz);
        room.obstacles.push({ type: 'circle', x: bx, z: bz, r: 0.25 });
      }
    });
    if (flames.length) {
      const f = glowPoints(room, flames, 0xffb35c, 0.45);
      animate(room, (tt) => {
        f.material.opacity = 0.78 + Math.sin(tt * 8.3) * 0.08;
      });
    }
    return room;
  }

  // Enfilade: three salons in a row, joined by arched openings.
  function enfilade({ key, spec, t, accent, ids, cx, z0, doors, kind }) {
    const D = 8.5;
    const W = 9;
    const H = 5.6;
    const x0 = cx - W / 2;
    const x1 = cx + W / 2;
    const z1 = z0 + 3 * D;
    const room = makeRoom(key, { type: 'rect', x0, x1, z0, z1 }, 'wood', {
      bg: '#f1ebe0',
      fog: { type: 'linear', color: '#f1ebe0', near: 30, far: 80 },
      envI: 0.45,
    });
    rectRoom(room, {
      x0, x1, z0, z1, H,
      wallCanvas: TX.galleryWall(H),
      floorMat: new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.parquet(), { repeat: [W / 2, (3 * D) / 2] }), roughness: 0.5 }),
      ceilingMat: new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.coffers(), { repeat: [W / 1.5, (3 * D) / 1.5] }), roughness: 1 }),
    });
    const wallMat = std(0xe9dfcf, 0.95);
    const gold = std(0xc9a24c, 0.4, { metalness: 0.7 });
    for (const k of [1, 2]) {
      const z = z0 + k * D;
      archWall(room, { x: cx, z, w: W, H, aw: 2.8, ah: 4.0, depth: 0.5, mat: wallMat });
      const moulding = new THREE.TorusGeometry(1.45, 0.07, 8, 32, Math.PI);
      for (const s of [-1, 1]) mesh(room, moulding, gold, cx, 4.0 - 1.4, z + s * 0.26);
      room.obstacles.push({ type: 'rect', x0, x1: cx - 1.4, z0: z - 0.28, z1: z + 0.28 });
      room.obstacles.push({ type: 'rect', x0: cx + 1.4, x1, z0: z - 0.28, z1: z + 0.28 });
    }
    // A lantern skylight in each salon's ceiling, and an ottoman in the middle one.
    for (let k = 0; k < 3; k++) {
      const zc = z0 + (k + 0.5) * D;
      const sky = mesh(room, new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ color: 0xfff8ea, toneMapped: false }), cx, H - 0.02, zc);
      sky.rotation.x = Math.PI / 2;
      for (const [w, d, dx, dz] of [[2.9, 0.15, 0, 1.37], [2.9, 0.15, 0, -1.37], [0.15, 2.9, 1.37, 0], [0.15, 2.9, -1.37, 0]]) box(room, w, 0.18, d, cx + dx, H - 0.09, zc + dz, gold);
    }
    const velvet = std(0x6b1d25, 0.95);
    mesh(room, new THREE.CylinderGeometry(0.9, 0.95, 0.45, 32), velvet, cx, 0.225, z0 + 1.5 * D);
    mesh(room, new THREE.CylinderGeometry(0.22, 0.3, 0.7, 16), velvet, cx, 0.6, z0 + 1.5 * D);
    room.obstacles.push({ type: 'circle', x: cx, z: z0 + 1.5 * D, r: 1.0 });
    addLights(room, [0xfff1dc, 0x6e5a44, 0.9], [
      [cx, H - 1, z0 + 0.5 * D, 0xfff1d8, 20, 14],
      [cx, H - 1, z0 + 2.5 * D, 0xfff1d8, 20, 14],
    ]);

    const ink = 'dark';
    addPortal(room, { pos: V3(cx, 0, z0 + 0.06), dir: V3(0, 0, 1), dest: doors.back.dest, subtitle: doors.back.subtitle, w: 2.4, h: 3.2, signW: 2.8, entrance: true, style: ink });
    const mid = z0 + 1.5 * D;
    const slots = [
      { pos: V3(cx, 0, z1 - 0.06), dir: V3(0, 0, -1), w: 2.4, h: 3.2, signW: 2.8 },
      { pos: V3(x0 + 0.06, 0, mid), dir: V3(1, 0, 0), w: 2.4, h: 3.2, signW: 2.8 },
      { pos: V3(x1 - 0.06, 0, mid), dir: V3(-1, 0, 0), w: 2.4, h: 3.2, signW: 2.8 },
    ];
    const spare = hangDoors(room, slots, doors.links, ink);
    wingText(room, spec, V3(cx - 3.1, 2.4, z0 + 0.03), V3(0, 0, 1), ink, 2.3);

    // Works: the side walls of the first and last salons, then any free wall.
    const common = workStyle(t, accent);
    const wallSlot = (x, z, west) => ({ pos: V3(west ? x0 + 0.04 : x1 - 0.04, 2.35, z), dir: V3(west ? 1 : -1, 0, 0), h: 2.0, maxW: 4.2 });
    const workSlots = [
      wallSlot(x0, z0 + 0.5 * D, true),
      wallSlot(x1, z0 + 0.5 * D, false),
      wallSlot(x0, z0 + 2.5 * D, true),
      wallSlot(x1, z0 + 2.5 * D, false),
      ...spare.filter((s) => s.dir.z === 0).map((s) => wallSlot(s.pos.x, s.pos.z, s.dir.x > 0)),
    ];
    if (spare.some((s) => s.dir.z !== 0)) workSlots.push({ pos: V3(cx, 2.4, z1 - 0.04), dir: V3(0, 0, -1), h: 2.3, maxW: 4 });
    for (const k of [1, 2]) {
      for (const s of [-1, 1]) workSlots.push({ pos: V3(cx + s * 2.95, 2.3, z0 + k * D - 0.27), dir: V3(0, 0, -1), h: 1.35, maxW: 2.0, plaqueSide: 'below', fixed: true });
    }
    const plan = displayModes('enfilade', key, ids.length);
    ids.forEach((id, k) => {
      const slot = workSlots[k];
      if (!slot) return;
      const mode = slot.fixed ? 'wall' : plan[k];
      const placed = hang(room, id, slot, mode, common, { inset: 1.9, wireTo: H - 0.15, leanMax: 2.2 });
      if (kind === 'salon' && mode === 'wall') pictureLight(placed);
    });
    return room;
  }

  // Attic: under a pitched roof with exposed rafters, skylights and fairy
  // lights; polaroids along the knee walls.
  function attic({ key, spec, t, accent, ids, cx, z0, doors }) {
    const W = 9;
    const eave = 2.3;
    const ridge = 5.4;
    const x0 = cx - W / 2;
    const x1 = cx + W / 2;
    const perSide = Math.max(2, Math.ceil(ids.length / 2));
    const L = Math.max(14, 6 + perSide * 3.4);
    const z1 = z0 + L;
    const zm = (z0 + z1) / 2;
    const room = makeRoom(key, { type: 'rect', x0, x1, z0, z1 }, 'wood', {
      bg: '#2a2340',
      fog: { type: 'linear', color: '#2a2340', near: 20, far: 60 },
      envI: 0.4,
    });
    floorPlane(room, x0, x1, z0, z1, 0, new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.parquet(), { repeat: [W / 2.4, L / 2.4] }), roughness: 0.6 }));
    const rug = mesh(room, new THREE.CircleGeometry(1.8, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.checkerRug()), roughness: 1 }), cx, 0.01, zm);
    rug.scale.set(1, 1, 1.6);
    const knee = TX.toTexture(TX.bedroomWall(eave));
    wall(room, L, eave, knee, x0, zm, V3(1, 0, 0), 0, 3);
    wall(room, L, eave, knee, x1, zm, V3(-1, 0, 0), 0, 3);
    const run = W / 2;
    const slope = Math.hypot(run, ridge - eave);
    const pitch = Math.atan2(ridge - eave, run);
    const boards = std(0xc49a6c, 0.9, { side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const roof = mesh(room, new THREE.PlaneGeometry(L, slope), boards, cx + (s * run) / 2, (eave + ridge) / 2, zm);
      roof.rotation.order = 'YXZ';
      roof.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
      roof.rotation.x = Math.PI / 2 - pitch;
    }
    // Gable ends.
    const gable = new THREE.Shape();
    gable.moveTo(-run, 0);
    gable.lineTo(run, 0);
    gable.lineTo(run, eave);
    gable.lineTo(0, ridge);
    gable.lineTo(-run, eave);
    gable.lineTo(-run, 0);
    const gableMat = std(0xd9c7ef, 0.95, { side: THREE.DoubleSide });
    mesh(room, new THREE.ShapeGeometry(gable), gableMat, cx, 0, z0);
    mesh(room, new THREE.ShapeGeometry(gable), gableMat, cx, 0, z1);
    const moon = mesh(room, new THREE.CircleGeometry(0.55, 32), new THREE.MeshBasicMaterial({ map: TX.nightWindow(), toneMapped: false }), cx, 4.3, z1 - 0.02);
    moon.rotation.y = Math.PI;
    // Rafters, ridge beam, collar ties.
    const timber = std(0x7a5534, 0.8);
    box(room, 0.18, 0.24, L, cx, ridge - 0.12, zm, timber);
    for (let z = z0 + 0.6; z < z1 - 0.3; z += 1.2) {
      for (const s of [-1, 1]) beam(room, V3(cx + s * (run - 0.05), eave - 0.02, z), V3(cx + s * 0.1, ridge - 0.08, z), 0.12, timber);
    }
    for (let z = z0 + 1.8; z < z1 - 1; z += 3.6) box(room, run * 2 * ((ridge - 4.1) / (ridge - eave)), 0.12, 0.12, cx, 4.1, z, timber);
    // Roof lights on one slope, fairy lights along the ridge.
    const sky = TX.nightWindow();
    for (let z = z0 + 3; z < z1 - 2; z += 5) {
      const u = 0.45;
      const win = mesh(room, new THREE.PlaneGeometry(1.1, 1.3), new THREE.MeshBasicMaterial({ map: sky, toneMapped: false, side: THREE.DoubleSide }), cx + run * (1 - u) - 0.03, eave + (ridge - eave) * u - 0.03, z);
      win.rotation.order = 'YXZ';
      win.rotation.y = -Math.PI / 2;
      win.rotation.x = Math.PI / 2 - pitch;
    }
    const fairy = [];
    for (let i = 0; i <= 40; i++) {
      const z = z0 + 0.4 + ((L - 0.8) * i) / 40;
      const sag = Math.sin(((z - z0) / L) * Math.PI * 5) ** 2 * 0.28;
      fairy.push(cx + 0.35, ridge - 0.35 - sag, z);
    }
    const lights = glowPoints(room, fairy, 0xffd9a8, 0.22);
    animate(room, (tt) => {
      lights.material.opacity = 0.8 + Math.sin(tt * 1.7) * 0.12;
    });
    addLights(room, [0xffe0f0, 0x5a4a7e, 0.85], [
      [cx, 4.2, z0 + L * 0.28, 0xffd6b0, 12, 12],
      [cx, 4.2, z0 + L * 0.72, 0xffd6b0, 12, 12],
    ]);

    const ink = 'hand';
    addPortal(room, { pos: V3(cx, 0, z0 + 0.06), dir: V3(0, 0, 1), dest: doors.back.dest, subtitle: doors.back.subtitle, w: 2.2, h: 2.9, signW: 2.2, entrance: true, style: ink });
    const slots = doors.links.length === 1
      ? [{ pos: V3(cx, 0, z1 - 0.06), dir: V3(0, 0, -1), w: 2.2, h: 2.9, signW: 2.0 }]
      : [
          { pos: V3(cx - 1.8, 0, z1 - 0.06), dir: V3(0, 0, -1), w: 2.0, h: 2.6, signW: 1.8 },
          { pos: V3(cx + 1.8, 0, z1 - 0.06), dir: V3(0, 0, -1), w: 2.0, h: 2.6, signW: 1.8 },
        ];
    hangDoors(room, slots, doors.links, ink);
    wingText(room, spec, V3(cx - 2.95, 1.55, z0 + 0.03), V3(0, 0, 1), ink, 1.9);

    const common = workStyle(t, accent);
    const plan = displayModes('attic', key, ids.length);
    ids.forEach((id, k) => {
      const west = k % 2 === 0;
      const i = Math.floor(k / 2);
      const z = z0 + 4 + i * 3.4;
      const slot = { pos: V3(west ? x0 + 0.05 : x1 - 0.05, 1.28, z), dir: V3(west ? 1 : -1, 0, 0), h: 1.05, maxW: 1.6, tilt: (TX.hash(id) - 0.5) * 0.14 };
      hang(room, id, slot, plan[k], common, { inset: 2.0, wireTo: 2.25, leanMax: 1.3 });
    });
    return room;
  }

  // The classic box: white void, screening room, or a plain salon/night/pastel room.
  function classic({ key, spec, t, kind, accent, ids, cx, z0, doors, form }) {
    const rows = Math.max(1, Math.ceil(Math.min(ids.length, 6) / 2));
    const W = 12;
    const L = 8 + rows * 5;
    const H = t.height;
    const x0 = cx - W / 2;
    const x1 = cx + W / 2;
    const z1 = z0 + L;
    const cinema = kind === 'screening';
    const dark = kind === 'night' || cinema;
    const white = form === 'void' || (kind === 'white' && form !== 'rect');
    const pastel = kind === 'pastel';
    const bg = cinema ? '#0b0507' : dark ? '#0d0c20' : pastel ? '#2a2340' : '#f3f0ea';
    const room = makeRoom(key, { type: 'rect', x0, x1, z0, z1 }, t.surface, {
      bg,
      fog: dark ? { type: 'exp2', color: bg, density: 0.022 } : { type: 'linear', color: bg, near: white ? 14 : 30, far: white ? 46 : 80 },
      envI: dark ? 0.22 : white ? 1.0 : 0.45,
    });
    if (white) {
      mesh(room, new THREE.PlaneGeometry(140, 140).rotateX(-Math.PI / 2), std(0xf7f5f1, 0.95), cx, 0, z0 + L / 2);
      box(room, 11, 4.8, 0.3, cx, 2.4, z0 - 0.17, M.slab);
    } else {
      const wallCanvas = cinema ? TX.plainWall(H, '#3a0e16', '#1a0609') : dark ? TX.eyesWall(H) : pastel ? TX.bedroomWall(H) : TX.galleryWall(H);
      const floorMat = cinema
        ? std(0x2a0c12, 1)
        : dark
          ? std(0x17152e, 0.6, { metalness: 0.1 })
          : pastel
            ? new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.carpet(), { repeat: [W / 1.5, L / 1.5] }), roughness: 1 })
            : new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.parquet(), { repeat: [W / 2, L / 2] }), roughness: 0.5 });
      rectRoom(room, { x0, x1, z0, z1, H, wallCanvas, floorMat, ceilingMat: std(cinema ? 0x070304 : dark ? 0x0b0a1a : pastel ? 0x3a3166 : 0xf4efe5, 1) });
    }
    const hemi = cinema ? [0x9a6a70, 0x080305, 0.5] : dark ? [0x6b5fd6, 0x0a0915, 0.6] : pastel ? [0xffe0f0, 0x5a4a7e, 0.85] : white ? [0xffffff, 0xe8e2d6, 1.6] : [0xfff1dc, 0x6e5a44, 0.9];
    addLights(room, hemi, [
      [cx, H - 1.2, z0 + L * 0.3, cinema ? 0xffb38a : dark ? accent.getHex() : 0xfff1d8, cinema ? 14 : dark ? 28 : 22, 20],
      [cx, H - 1.2, z0 + L * 0.75, cinema ? 0xffb38a : dark ? accent.getHex() : 0xfff1d8, cinema ? 12 : dark ? 22 : 26, 20],
    ]);
    const tall = H >= 5;
    const ink = dark ? 'light' : pastel ? 'hand' : 'dark';
    addPortal(room, { pos: V3(cx, 0, z0 + 0.06), dir: V3(0, 0, 1), dest: doors.back.dest, subtitle: doors.back.subtitle, w: tall ? 2.6 : 2.4, h: tall ? 3.4 : 3.0, signW: 3.0, style: ink, entrance: true });
    const farH = Math.min(3.2, H - 1.2);
    const xs = ids.length > 6 ? [3.8, -3.8] : [3.8, -3.8, 0];
    const slots = xs.map((dx) => ({ pos: V3(cx + dx, 0, z1 - 0.06), dir: V3(0, 0, -1), w: 2.4, h: farH, signW: 2.8 }));
    doors.links.forEach((d, i) => {
      if (white && slots[i]) box(room, 4.2, 4.6, 0.3, slots[i].pos.x, 2.3, z1 + 0.17, M.slab);
    });
    hangDoors(room, slots, doors.links, ink);
    wingText(room, spec, V3(cx - 3.9, 2.4, z0 + 0.03), V3(0, 0, 1), ink, 3.0);
    if (cinema) {
      // Velvet benches, and ducts along the ceiling: this one is in the basement.
      const velvet = std(0x4a0e17, 0.95);
      for (let r = 0; r < rows; r++) {
        const z = z0 + 6 + r * 5;
        box(room, 1.1, 0.42, 2.6, cx, 0.21, z, velvet);
        box(room, 1.0, 0.08, 2.5, cx, 0.04, z, M.black);
        room.obstacles.push({ type: 'rect', x0: cx - 0.55, x1: cx + 0.55, z0: z - 1.3, z1: z + 1.3 });
      }
      const duct = std(0x2b2426, 0.5, { metalness: 0.6 });
      for (const [dx, r] of [[-4.6, 0.22], [-3.9, 0.12], [4.4, 0.18]]) {
        mesh(room, new THREE.CylinderGeometry(r, r, L, 16).rotateX(Math.PI / 2), duct, cx + dx, H - 0.35, z0 + L / 2);
      }
    }
    const common = workStyle(t, accent);
    const plan = displayModes(cinema ? 'cinema' : white ? 'void' : 'rect', key, ids.length);
    const env = { dark, inset: white ? 1.8 : 1.7, wireTo: H - 0.15, leanMax: Math.min(2.1, H - 1.2) };
    ids.forEach((id, k) => {
      const y = pastel ? 2.1 : 2.2;
      const tilt = pastel ? (TX.hash(id) - 0.5) * 0.12 : 0;
      let slot;
      if (k < 6) {
        const z = z0 + 6 + Math.floor(k / 2) * 5;
        const west = k % 2 === 0;
        slot = { tilt, pos: V3(west ? x0 + 0.04 : x1 - 0.04, cinema ? 2.6 : y, z), dir: V3(west ? 1 : -1, 0, 0), h: cinema ? 2.6 : 1.9, maxW: cinema ? 3.9 : 3.0 };
      } else {
        slot = { tilt, pos: V3(cx, y + 0.2, z1 - 0.04), dir: V3(0, 0, -1), h: 2.3 };
      }
      const mode = plan[k];
      const placed = hang(room, id, slot, mode, common, env);
      if (kind === 'salon' && mode === 'wall') pictureLight(placed);
    });
    return room;
  }

  // Bronze double doors that swing open toward you as you come near; `dir` is
  // the side they open to. A frameless portal stands just behind them.
  function doubleDoors(room, { x, y = 0, z, dir, w = 2.6, h = 3.5, mat, parent = room.group }) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = facing(dir);
    parent.add(g);
    const leaves = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set((sx * w) / 2, 0, 0);
      g.add(pivot);
      const part = (geo, px, py, pz) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px, py, pz);
        pivot.add(m);
      };
      part(new THREE.BoxGeometry(w / 2 - 0.02, h, 0.08), (-sx * w) / 4, h / 2, 0);
      for (const py of [h * 0.27, h * 0.74]) part(new THREE.BoxGeometry(w / 2 - 0.34, h * 0.36, 0.03), (-sx * w) / 4, py, 0.05);
      const pull = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 1.1, 12), M.brass);
      pull.position.set(-sx * (w / 2 - 0.16), h * 0.43, 0.13);
      pivot.add(pull);
      leaves.push([pivot, sx]);
    }
    const here = new THREE.Vector3();
    let open = 0;
    animate(room, (t, dt, cam) => {
      g.getWorldPosition(here);
      const d = Math.hypot(cam.position.x - here.x, cam.position.z - here.z);
      const want = Math.max(0, Math.min(1, (6.5 - d) / 3.8));
      open += (want - open) * Math.min(1, (dt || 1 / 60) * 3.5);
      for (const [pivot, sx] of leaves) pivot.rotation.y = sx * open * 1.45;
    });
    return g;
  }

  // ------------------------------------------------------ Entrance Hall
  // The way in. You start inside the bronze front doors, in a low concrete
  // vestibule whose front wall is perforated like the building in "The
  // Museum, Exterior" (which hangs beside you), with a card on how to visit.
  // An arch opens into a tall colonnaded hall: a runner down the nave, a
  // banner for each wing (its colour and one of its works), the welcome and
  // the directory on two stelae, the hat in a shaft of light, the four wings'
  // doors in the aisles, new acquisitions on easels at the far end, and the
  // way upstairs between the collection's two bookends.
  function buildEntrance({ sides, stairs, doorBanners, moreBanners, acquisitions, works, hatVitrine, text }) {
    const HX = 10; // hall half-width
    const N = -22; // north wall
    const S = 13.8; // hall face of the south wall
    const H = 11;
    const VX = 3.6; // vestibule half-width
    const VS = 14.2; // vestibule face of the south wall
    const VN = 22; // front doors
    const VH = 5.2;
    const COLX = 6.2;
    const COLZ = [10.5, 4.5, -1.5, -7.5, -13.5];
    const DOORZ = [7.5, -4.5]; // the bays for the near and far doors
    const MIDZ = [1.5, -10.5];
    const room = makeRoom('lobby', { type: 'rect', x0: -HX, x1: HX, z0: N, z1: VN }, 'marble', {
      bg: '#f2ede4',
      fog: { type: 'linear', color: '#f2ede4', near: 30, far: 95 },
      envI: 0.5,
    });
    room.floors = [
      { type: 'rect', x0: -HX, x1: HX, z0: N, z1: S, h: 0 },
      { type: 'rect', x0: -1.6, x1: 1.6, z0: S - 0.1, z1: VS + 0.1, h: 0 },
      { type: 'rect', x0: -VX, x1: VX, z0: VS, z1: VN, h: 0 },
    ];
    room.start = { x: 0, z: 19.6, yaw: 0 };
    const stone = std(0xefe7da, 0.8);
    const warm = std(0xe2d6c1, 0.85);
    const concrete = std(0x8f897f, 0.95);
    const darkPanel = std(0x2d2721, 0.6);
    const frameMat = std(0x6b5a44, 0.6);

    // ---- the hall: floor, walls, coffered ceiling with a skylight
    floorPlane(room, -HX, HX, N, S, 0, new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.tileFloor(), { repeat: [(2 * HX) / 4, (S - N) / 4] }), roughness: 0.35 }));
    const wallTex = TX.toTexture(TX.plainWall(H, '#ebe0cc', '#c5b595'));
    wall(room, 2 * HX, H, wallTex, 0, N, V3(0, 0, 1));
    wall(room, S - N, H, wallTex, -HX, (S + N) / 2, V3(1, 0, 0));
    wall(room, S - N, H, wallTex, HX, (S + N) / 2, V3(-1, 0, 0));
    archWall(room, { x: 0, z: S + 0.1, w: 2 * HX, H, aw: 3.2, ah: 3.8, depth: 0.2, mat: stone });
    ceilingPlane(room, -HX, HX, N, S, H, new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.coffers(), { repeat: [5, 9] }), roughness: 1 }));
    const sky0 = -13.5;
    const sky1 = 12;
    const sky = mesh(room, new THREE.PlaneGeometry(4.4, sky1 - sky0), new THREE.MeshBasicMaterial({ color: 0xfffaf0, toneMapped: false }), 0, H - 0.03, (sky0 + sky1) / 2);
    sky.rotation.x = Math.PI / 2;
    for (let z = sky0; z <= sky1 + 0.01; z += 2.55) box(room, 4.5, 0.12, 0.12, 0, H - 0.09, z, warm);
    for (const sx of [-1, 1]) box(room, 0.16, 0.16, sky1 - sky0, sx * 2.25, H - 0.1, (sky0 + sky1) / 2, warm);

    // Colonnades carrying an entablature, and clerestory windows over the aisles.
    const colLen = COLZ[0] - COLZ[COLZ.length - 1];
    const colMid = (COLZ[0] + COLZ[COLZ.length - 1]) / 2;
    for (const sx of [-1, 1]) {
      for (const z of COLZ) column(room, sx * COLX, z, 0, 7.2, 0.42, stone);
      box(room, 1.1, 0.8, colLen + 1.4, sx * COLX, 7.6, colMid, warm);
      box(room, 1.4, 0.2, colLen + 1.8, sx * COLX, 8.1, colMid, stone);
      for (const z of [...DOORZ, ...MIDZ, -17.75]) archWindow(room, sx * (HX - 0.04), 8.2, z, V3(-sx, 0, 0), 1.8, 2.3, frameMat);
    }

    // A runner down the nave, from the arch to the far end.
    const r0 = S - 0.1;
    const r1 = COLZ[COLZ.length - 1] - 1;
    box(room, 2.4, 0.014, r0 - r1, 0, 0.007, (r0 + r1) / 2, std(0x7a1f2b, 1));
    for (const sx of [-1, 1]) box(room, 0.07, 0.016, r0 - r1, sx * 1.12, 0.008, (r0 + r1) / 2, std(0xc9a24c, 0.5, { metalness: 0.5 }));

    // ---- the vestibule: concrete, a perforated front wall, bronze doors
    const vestibuleFloor = std(0x5d5850, 0.4);
    floorPlane(room, -VX, VX, VS, VN, 0, vestibuleFloor);
    floorPlane(room, -1.6, 1.6, S, VS, 0.001, vestibuleFloor);
    const conTex = TX.toTexture(TX.concreteWall(VH));
    wall(room, VN - VS, VH, conTex, -VX, (VS + VN) / 2, V3(1, 0, 0));
    wall(room, VN - VS, VH, conTex, VX, (VS + VN) / 2, V3(-1, 0, 0));
    archWall(room, { x: 0, z: VS - 0.1, w: 2 * VX, H: VH, aw: 3.2, ah: 3.8, depth: 0.2, mat: concrete });
    ceilingPlane(room, -VX, VX, VS, VN, VH, std(0x6e6962, 0.95));
    const screen = TX.perforatedScreen(2 * VX, VH, { w: 2.9, h: 3.8 });
    const front = mesh(
      room,
      new THREE.PlaneGeometry(2 * VX, VH),
      new THREE.MeshStandardMaterial({ map: TX.toTexture(screen.map), emissiveMap: TX.toTexture(screen.glow), emissive: 0xfff1d8, roughness: 0.95 }),
      0,
      VH / 2,
      VN,
    );
    front.rotation.y = Math.PI;
    const bronze = std(0x4a3a27, 0.4, { metalness: 0.75 });
    box(room, 2.9, 0.16, 0.2, 0, 3.66, VN - 0.1, bronze);
    for (const sx of [-1, 1]) box(room, 0.14, 3.66, 0.2, sx * 1.38, 1.83, VN - 0.1, bronze);
    // The front doors open: walk out and see what's there.
    addPortal(room, { pos: V3(0, 0, VN - 0.03), dir: V3(0, 0, -1), dest: 'outside', w: 2.56, h: 3.52, frameless: true });
    doubleDoors(room, { x: 0, z: VN - 0.15, dir: V3(0, 0, -1), mat: bronze });
    const spill = mesh(room, new THREE.PlaneGeometry(6.8, 3.6), additive(0xfff1d8, 0.14), 0, 0.01, VN - 1.9);
    spill.rotation.x = -Math.PI / 2;
    const doormat = mesh(room, new THREE.PlaneGeometry(2.4, 1.2), std(0xffffff, 1, { map: TX.toTexture(TX.doormat()) }), 0, 0.014, VN - 1.15);
    doormat.rotation.x = -Math.PI / 2;
    glowPoints(room, [-1.8, VH - 0.06, 16.2, 1.8, VH - 0.06, 16.2, -1.8, VH - 0.06, 19.8, 1.8, VH - 0.06, 19.8], 0xfff0d6, 0.45);
    // "You are here", and how to visit.
    pictureLight(addWork(room, works.exterior, { pos: V3(-VX + 0.03, 2.05, 18.2), dir: V3(1, 0, 0), h: 1.5, frame: 'museum', plaqueSide: 'below' }));
    addText(room, { ...text.visit, width: 2.9 }, V3(VX - 0.03, 2.2, 18.2), V3(-1, 0, 0));
    const carve = (title, sub, y, z, dir, width, ink) => {
      const t = TX.inscription(title, sub, { width, ink });
      const m = mesh(room, new THREE.PlaneGeometry(t.width, t.height), new THREE.MeshBasicMaterial({ map: t.texture, transparent: true, depthWrite: false, toneMapped: false }), 0, y, z);
      m.rotation.y = facing(dir);
    };
    carve('COOLIMAGES', 'A MUSEUM OF THINGS THAT STARE BACK', 4.5, VS + 0.02, V3(0, 0, 1), 4.6, '#4f483f');
    carve('COOLIMAGES', 'FOUNDED MMXXVI · OPEN WHENEVER YOU ARE', 5.5, S - 0.02, V3(0, 0, -1), 6.4, '#7a6b55');

    // ---- the nave: two stelae, the hat in a shaft of light, benches
    for (const [spec, sx] of [[text.welcome, -1], [text.directory, 1]]) {
      const x = sx * 3.5;
      const z = 9.4;
      box(room, 2.5, 0.3, 0.6, x, 0.15, z, warm);
      box(room, 2.3, 3.3, 0.24, x, 1.95, z, darkPanel);
      addText(room, { ...spec, width: 2.0, style: 'light' }, V3(x, 2.3, z + 0.125), V3(0, 0, 1));
      room.obstacles.push({ type: 'rect', x0: x - 1.25, x1: x + 1.25, z0: z - 0.3, z1: z + 0.3 });
    }
    hatVitrine(room, 0, 1.5);
    sunbeam(room, 0, 1.5, H);
    for (const sx of [-1, 1]) {
      box(room, 0.55, 0.1, 2.4, sx * 2.9, 0.46, -7.5, M.leather);
      for (const dz of [-1.05, 1.05]) box(room, 0.5, 0.42, 0.06, sx * 2.9, 0.21, -7.5 + dz, M.brass);
      room.obstacles.push({ type: 'rect', x0: sx * 2.9 - 0.32, x1: sx * 2.9 + 0.32, z0: -8.75, z1: -6.25 });
    }

    // ---- banners: each wing's hangs by its door; the upstairs wings' between
    const wire = std(0x2a2622, 0.4, { metalness: 0.6 });
    const banner = (spec, x, z) => {
      if (!spec) return;
      const w = 1.3;
      const h = 4.1;
      const top = 10.3;
      const g = new THREE.Group();
      g.position.set(x, top, z);
      room.group.add(g);
      const draw = () => TX.bannerTexture({ ...spec, image: spec.image() });
      const mat = new THREE.MeshStandardMaterial({ map: draw(), alphaTest: 0.5, roughness: 0.95 });
      if (spec.workId) {
        whenArt(spec.workId, () => {
          mat.map.dispose();
          mat.map = draw();
          mat.needsUpdate = true;
        });
      }
      for (const flip of [0, Math.PI]) {
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        cloth.position.y = -h / 2 - 0.06;
        cloth.rotation.y = flip;
        g.add(cloth);
      }
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, w + 0.3, 12), M.brass);
      rod.rotation.z = Math.PI / 2;
      g.add(rod);
      for (const sx of [-1, 1]) beam(room, V3(x + sx * (w / 2 + 0.08), top, z), V3(x + sx * (w / 2 + 0.08), H, z), 0.012, wire);
      const phase = TX.hash(spec.title) * TAU;
      animate(room, (t) => {
        g.rotation.x = Math.sin(t * 0.45 + phase) * 0.018;
      });
    };

    // ---- doors: the four wings in the aisles, the Stair Hall at the far end
    const doorAt = (dest, sx, z, first) => {
      addPortal(room, { pos: V3(sx * (HX - 0.06), 0, z), dir: V3(-sx, 0, 0), dest, w: 2.6, h: 3.6, signW: 3.2, entrance: first });
      banner(doorBanners[dest], sx * 4.7, z);
    };
    sides.west.forEach((dest, i) => doorAt(dest, -1, DOORZ[i], i === 0));
    sides.east.forEach((dest, i) => doorAt(dest, 1, DOORZ[i], false));
    [[-1, MIDZ[0]], [1, MIDZ[0]], [-1, MIDZ[1]], [1, MIDZ[1]]].forEach(([sx, z], i) => banner(moreBanners[i], sx * 4.7, z));
    const bookend = (id, sx) => pictureLight(addWork(room, id, { pos: V3(sx * 6.4, 2.6, N + 0.03), dir: V3(0, 0, 1), h: 2.5, maxW: 3.4, frame: 'gilded', plaque: 'brass' }));
    bookend(works.bookends[0], -1);
    bookend(works.bookends[1], 1);
    const wallSlots = [[-1, MIDZ[0]], [1, MIDZ[0]], [-1, MIDZ[1]], [1, MIDZ[1]]];
    const onWall = (id, [sx, z], h = 1.9) => pictureLight(addWork(room, id, { pos: V3(sx * (HX - 0.03), 2.2, z), dir: V3(-sx, 0, 0), h, maxW: 3.2, frame: 'museum' }));
    if (stairs) {
      addPortal(room, { pos: V3(0, 0, N + 0.06), dir: V3(0, 0, 1), dest: 'stairhall', w: 3.0, h: 4.2, signW: 3.6, subtitle: 'Upstairs to the new wings' });
      for (const sx of [-1, 1]) box(room, 0.45, 5.9, 0.3, sx * 2.4, 2.95, N + 0.15, warm);
      box(room, 5.3, 0.45, 0.4, 0, 6.1, N + 0.2, warm);
      box(room, 5.7, 0.16, 0.5, 0, 6.4, N + 0.25, stone);
      onWall(works.plate, wallSlots.shift(), 2.2);
    } else pictureLight(addWork(room, works.plate, { pos: V3(0, 2.6, N + 0.03), dir: V3(0, 0, 1), h: 2.6, frame: 'gilded', plaque: 'brass' }));

    // ---- new acquisitions: easels at the far end, then the aisle walls
    const easels = [[-8.1, -15.8, 0.55], [8.1, -15.8, 0.55], [-8.4, -19.3, 0.2], [8.4, -19.3, 0.2]];
    acquisitions.forEach((id, i) => {
      if (i < easels.length) {
        const [x, z, k] = easels[i];
        easel(room, id, V3(x, 0, z), V3(-Math.sign(x), 0, k).normalize(), { h: 1.1, frame: 'museum' });
      } else if (wallSlots.length) onWall(id, wallSlots.shift());
    });
    if (acquisitions.length) addText(room, { ...text.acquisitions, width: 2.2 }, V3(-HX + 0.03, 3.9, -17.6), V3(1, 0, 0));

    addLights(room, [0xfff4e4, 0x8f806a, 0.85], [
      [0, 9.4, -2, 0xfff0d8, 80, 42],
      [0, 4.4, 18.2, 0xffecd2, 7, 10],
    ]);

    // Walking order for stepping between works: the vestibule, up the west
    // side, across the far wall, back down the east side.
    const at = new THREE.Vector3();
    const lap = (m) => {
      m.getWorldPosition(at);
      if (at.z > S) return -100;
      if (at.z < N + 1) return 50 + at.x / HX;
      return at.x < 0 ? S - at.z : 100 + (at.z - N);
    };
    room.order = room.artworks.map((m) => [lap(m), m]).sort((a, b) => a[0] - b[0]).map(([, m]) => m);
    return room;
  }

  // A shaft of daylight from a skylight down to (x, z), with dust in it.
  function sunbeam(room, x, z, top) {
    const shaft = mesh(
      room,
      new THREE.CylinderGeometry(1.1, 1.9, top - 0.1, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: beamTex, color: 0xfff1d4, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
      x,
      (top - 0.1) / 2,
      z,
    );
    shaft.renderOrder = 1;
    const r = TX.rng(8);
    const pts = [];
    for (let i = 0; i < 300; i++) {
      const a = r() * TAU;
      const rr = Math.sqrt(r()) * 1.7;
      pts.push(x + Math.cos(a) * rr, 0.3 + r() * (top - 1.5), z + Math.sin(a) * rr);
    }
    const dust = glowPoints(room, pts, 0xc9b58f, 0.06, 0.55);
    dust.material.blending = THREE.NormalBlending;
    animate(room, (t) => {
      dust.position.y = Math.sin(t * 0.2) * 0.15;
    });
  }


  // ------------------------------------------------------------ Outside
  // Past the front doors: an endless salt flat at dusk under a sky with an eye
  // in it. The plain wraps every L metres, so whichever way you walk, the
  // museum comes back out of the haze ahead of you. Things to find: a bench
  // facing the horizon, an easel that has painted the museum, a colossal
  // stone eye that turns to watch you, an invisible sculpture round the back,
  // a gilt door standing on its own (to a different room each visit), and
  // the edge of the grounds, signposted both ways.
  function buildOutside({ elsewhere }) {
    const OX = 0;
    const OZ = 3000;
    const L = 800;
    const X = (x) => OX + x;
    const Z = (z) => OZ + z;
    const HAZE = '#d9a98c';
    const room = makeRoom('outside', { type: 'rect', x0: X(-70), x1: X(70), z0: Z(-70), z1: Z(70) }, 'salt', {
      bg: HAZE,
      fog: { type: 'linear', color: HAZE, near: 55, far: 330 },
      envI: 0.3,
      far: 420,
    });
    room.floors = [{ type: 'rect', x0: X(-L), x1: X(L), z0: Z(-L), z1: Z(L), h: 0 }];
    room.wrap = { x: OX, z: OZ, L };
    room.secret = true;
    addLights(room, [0x9aa0d4, 0xd9a07a, 0.95], []);
    const concrete = std(0x9a948a, 0.95);
    const bronze = std(0x4a3a27, 0.4, { metalness: 0.75 });
    const wood = std(0x8a6a45, 0.7);
    // Everything out here is shown at its nearest copy across the wrap.
    const wrapped = [];
    const site = (x, z, rotY = 0) => {
      const g = new THREE.Group();
      g.position.set(X(x), 0, Z(z));
      g.rotation.y = rotY;
      room.group.add(g);
      wrapped.push(g);
      return { group: g, obstacles: [] };
    };

    // ---- the ground, the sky, the eye in it (all follow you)
    const salt = TX.toTexture(TX.saltFlat(), { repeat: [112, 112] });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(896, 896), new THREE.MeshStandardMaterial({ map: salt, roughness: 0.8 }));
    ground.rotation.x = -Math.PI / 2;
    room.group.add(ground);
    const R = 390;
    const skyGeo = new THREE.SphereGeometry(R, 48, 24);
    const top = new THREE.Color('#171a36');
    const mid = new THREE.Color('#57507c');
    const low = new THREE.Color(HAZE);
    const c = new THREE.Color();
    const cols = [];
    const sp = skyGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const y = sp.getY(i) / R;
      if (y > 0.3) c.lerpColors(mid, top, Math.min(1, (y - 0.3) / 0.6));
      else if (y > 0.02) c.lerpColors(low, mid, (y - 0.02) / 0.28);
      else c.copy(low);
      cols.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    sky.renderOrder = -2;
    room.group.add(sky);
    const r = TX.rng(77);
    const stars = [];
    for (let i = 0; i < 500; i++) {
      const a = r() * TAU;
      const y = 0.3 + r() * 0.7;
      const h = Math.sqrt(1 - y * y);
      stars.push(Math.cos(a) * h * (R - 5), y * (R - 5), Math.sin(a) * h * (R - 5));
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
    const starField = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xfff4e0, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75, depthWrite: false }));
    starField.renderOrder = -1;
    sky.add(starField);
    // It is low in the south-east, it is enormous, and it is looking at you.
    const eyeDir = V3(0.42, 0.3, 1).normalize();
    const skyEye = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 32),
      new THREE.MeshBasicMaterial({ map: TX.toTexture(TX.skyEye()), transparent: true, fog: false, depthWrite: false, toneMapped: false }),
    );
    skyEye.renderOrder = -1;
    room.group.add(skyEye);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffe9c4, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
    halo.renderOrder = -1;
    room.group.add(halo);
    let nextBlink = 6;

    // ---- the museum, from outside: the building in "The Museum, Exterior"
    const b = site(0, 0);
    const walls = TX.toTexture(TX.concreteWall(14, '#9a948a', 64));
    wall(b, 40, 14, walls, -24, -20, V3(-1, 0, 0));
    wall(b, 40, 14, walls, 24, -20, V3(1, 0, 0));
    wall(b, 48, 14, walls, 0, -40, V3(0, 0, -1));
    box(b, 48.8, 0.9, 40.8, 0, 14.3, -20, concrete);
    const screen = TX.perforatedScreen(48, 14, { w: 3.4, h: 4.3 }, 40);
    const facade = mesh(
      b,
      new THREE.PlaneGeometry(48, 14),
      new THREE.MeshStandardMaterial({ map: TX.toTexture(screen.map), emissiveMap: TX.toTexture(screen.glow), emissive: 0xffc27e, roughness: 0.95 }),
      0,
      7,
      0.02,
    );
    facade.rotation.y = 0;
    box(b, 11, 0.5, 4.6, 0, 4.95, 2.3, concrete);
    box(b, 2.9, 0.16, 0.2, 0, 3.66, 0.1, bronze);
    for (const sx of [-1, 1]) box(b, 0.14, 3.66, 0.2, sx * 1.38, 1.83, 0.1, bronze);
    doubleDoors(room, { x: 0, z: 0.16, dir: V3(0, 0, 1), mat: bronze, parent: b.group });
    const name = TX.inscription('COOLIMAGES', 'A MUSEUM OF THINGS THAT STARE BACK', { width: 9, ink: '#3f3931', light: 'rgba(255,230,200,0.35)' });
    mesh(b, new THREE.PlaneGeometry(name.width, name.height), new THREE.MeshBasicMaterial({ map: name.texture, transparent: true, depthWrite: false }), 0, 6.5, 0.05);
    addText(b, { kicker: 'Coolimages', body: ['A museum of things that stare back. Open whenever you are.', 'The building is larger on the inside. Please do not measure it.'], width: 1.5, style: 'light' }, V3(3.3, 1.7, 0.05), V3(0, 0, 1));
    const spill = mesh(b, new THREE.PlaneGeometry(7, 5), additive(0xffc58a, 0.22), 0, 0.02, 2.6);
    spill.rotation.x = -Math.PI / 2;
    const doorLight = new THREE.PointLight(0xffc68a, 16, 20, 1.3);
    doorLight.position.set(0, 3.4, 2.6);
    b.group.add(doorLight);
    room.obstacles.push({ type: 'rect', x0: X(-24.3), x1: X(24.3), z0: Z(-40.4), z1: Z(0.05) });
    const home = addPortal(room, { pos: V3(X(0), 0, Z(0.05)), dir: V3(0, 0, 1), dest: 'lobby', w: 2.56, h: 3.52, frameless: true, entrance: true });

    // ---- a bench facing the horizon
    const bench = site(0, 34);
    box(bench, 2.4, 0.1, 0.55, 0, 0.46, 0, M.leather);
    for (const lx of [-1.05, 1.05]) box(bench, 0.06, 0.42, 0.5, lx, 0.21, 0, M.brass);
    const benchNote = customPlaque({ title: 'Please do not feed the horizon.', artist: 'The Management', medium: '', saved: '' }, 'brass');
    benchNote.position.set(0, 0.36, 0.29);
    benchNote.scale.setScalar(0.6);
    bench.group.add(benchNote);
    room.obstacles.push({ type: 'rect', x0: X(-1.3), x1: X(1.3), z0: Z(33.6), z1: Z(34.4) });

    // ---- plein air: an easel that has painted the museum from where it stands
    const ex = 30;
    const ez = 66;
    const toMuseum = Math.atan2(0 - ex, 0 - ez);
    const easelSite = site(ex, ez, toMuseum + Math.PI);
    const tilt = 0.12;
    for (const sx of [-1, 1]) beam(easelSite, V3(sx * 0.45, 0, 0.12), V3(sx * 0.08, 2.05, -0.12), 0.05, wood);
    beam(easelSite, V3(0, 0, -0.8), V3(0, 1.95, -0.15), 0.05, wood);
    box(easelSite, 1.2, 0.045, 0.16, 0, 0.9, 0.05, wood);
    const canvasMat = new THREE.MeshBasicMaterial({ color: 0xf3eee4, toneMapped: false });
    const canvas = mesh(easelSite, new THREE.PlaneGeometry(1.2, 0.9), canvasMat, 0, 1.4, 0.02);
    canvas.rotation.x = -tilt;
    const stretcher = mesh(easelSite, new THREE.BoxGeometry(1.24, 0.94, 0.03), std(0xefe6d6, 0.9), 0, 1.4, -0.005);
    stretcher.rotation.x = -tilt;
    const easelNote = customPlaque({ title: 'Plein Air', artist: 'The easel', medium: 'Oil on canvas, finished just now', saved: 'Weather permitting' }, 'card');
    easelNote.position.set(0.85, 0.95, 0.1);
    easelNote.scale.setScalar(0.7);
    easelSite.group.add(easelNote);
    room.obstacles.push({ type: 'circle', x: X(ex), z: Z(ez), r: 0.8 });
    // main.js paints it once: the view from just behind the canvas.
    const behind = V3(X(ex) + Math.sin(toMuseum + Math.PI) * 1.4, 1.7, Z(ez) + Math.cos(toMuseum + Math.PI) * 1.4);
    room.pleinAir = { material: canvasMat, from: behind, to: V3(X(0), 5.5, Z(-8)), hide: easelSite.group };

    // ---- the watcher: a colossal stone eye, half sunk in the salt
    const wx = -130;
    const wz = 190;
    const watcher = site(wx, wz);
    const ball = new THREE.Group();
    ball.position.y = 1.2;
    watcher.group.add(ball);
    const irisTex = TX.iris();
    const eyeGeo = new THREE.SphereGeometry(6, 64, 32);
    eyeGeo.rotateY(-Math.PI / 2);
    ball.add(new THREE.Mesh(eyeGeo, new THREE.MeshStandardMaterial({ map: irisTex, emissiveMap: irisTex, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.45 })));
    const drift = new THREE.Mesh(new THREE.TorusGeometry(6.1, 1.1, 12, 48), std(0xe6ded3, 0.9));
    drift.rotation.x = Math.PI / 2;
    drift.scale.set(1, 1, 0.45);
    drift.position.y = 0.2;
    watcher.group.add(drift);
    const watchLight = new THREE.PointLight(0xb8c2ff, 30, 36, 1.3);
    watchLight.position.set(0, 9, 7);
    watcher.group.add(watchLight);
    box(watcher, 0.08, 1.0, 0.08, 7.6, 0.5, 5.2, M.black);
    const watcherNote = customPlaque({ title: 'Untitled (Watcher)', artist: 'Unknown sculptor', medium: 'Marble, salt, patience', saved: 'On permanent display' }, 'brass');
    watcherNote.position.set(7.6, 1.05, 5.2);
    watcherNote.rotation.x = -0.5;
    watcher.group.add(watcherNote);
    room.obstacles.push({ type: 'circle', x: X(wx), z: Z(wz), r: 6.6 });
    const seen = new THREE.Vector3();

    // ---- round the back: an invisible sculpture
    const plinth = site(-26, -62);
    box(plinth, 1.1, 1.1, 1.1, 0, 0.55, 0, M.slab);
    const airNote = customPlaque({ title: 'Invisible Sculpture', artist: 'Unknown artist', medium: 'Air, on plinth', saved: 'Please do not touch' }, 'card');
    airNote.position.set(0, 0.55, 0.56);
    airNote.scale.setScalar(0.8);
    plinth.group.add(airNote);
    room.obstacles.push({ type: 'rect', x0: X(-26.6), x1: X(-25.4), z0: Z(-62.6), z1: Z(-61.4) });

    // ---- a door on its own, to somewhere else
    const dx = 190;
    const dz = 118;
    const door = addPortal(room, { pos: V3(X(dx), 0, Z(dz)), dir: V3(-dx, 0, -dz).normalize(), dest: elsewhere, w: 2.4, h: 3.2, signW: 2.8, subtitle: 'Somewhere else' });

    // ---- the edge of the grounds, signposted both ways
    const edge = site(0, 372);
    for (const sx of [-1, 1]) box(edge, 0.12, 2.9, 0.12, sx * 1.5, 1.45, 0, wood);
    const board = (tex, rotY) => {
      const m = mesh(edge, new THREE.PlaneGeometry(3.4, 1.28), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), 0, 2.25, rotY ? 0.04 : -0.04);
      m.rotation.y = rotY;
    };
    board(TX.signBoard('You are now leaving the museum', 'Nothing to see for a while'), Math.PI);
    board(TX.signBoard('You are now entering the museum', 'Welcome back'), 0);
    room.obstacles.push({ type: 'rect', x0: X(-1.7), x1: X(1.7), z0: Z(371.8), z1: Z(372.2) });

    for (const p of [home, door]) wrapped.push(p.group);
    for (const g of wrapped) g.userData.base = g.position.clone();
    animate(room, (t, dt, cam) => {
      const p = cam.position;
      for (const g of wrapped) {
        const o = g.userData.base;
        g.position.x = o.x + L * Math.round((p.x - o.x) / L);
        g.position.z = o.z + L * Math.round((p.z - o.z) / L);
      }
      ground.position.set(Math.round(p.x / 8) * 8, 0, Math.round(p.z / 8) * 8);
      sky.position.set(p.x, 0, p.z);
      skyEye.position.set(p.x + eyeDir.x * 340, eyeDir.y * 340, p.z + eyeDir.z * 340);
      skyEye.lookAt(p.x, p.y, p.z);
      halo.position.copy(skyEye.position);
      halo.quaternion.copy(skyEye.quaternion);
      // Now and then, it blinks.
      const since = t - nextBlink;
      skyEye.scale.y = since > 0 && since < 0.22 ? Math.max(0.04, Math.abs(since - 0.11) / 0.11) : 1;
      if (since > 0.22) nextBlink = t + 6 + ((t * 7.3) % 8);
      // The stone eye turns, slowly, to keep you in view.
      ball.getWorldPosition(seen);
      const want = Math.atan2(p.x - seen.x, p.z - seen.z);
      let diff = want - ball.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      ball.rotation.y += diff * Math.min(1, (dt || 1 / 60) * 0.6);
    });
    return room;
  }

  return { buildStairHall, buildWing, buildEntrance, buildOutside };
}
