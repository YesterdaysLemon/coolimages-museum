// Builds the five rooms of the museum. Rooms sit far apart in one scene and
// are connected only by portal paintings; only the current room is visible.
import * as THREE from 'three';
import * as TX from './textures.js';
import { WINGS, WORKS } from './catalog.js';

export const EYE_HEIGHT = 1.65;

// Tree of Life, laid out with Keter toward the east wall. col +1 is the
// right-hand pillar for someone walking east.
const SEPHIROT = [
  { name: 'Keter', sector: 'Actualization', glyph: 'I', col: 0, row: 0 },
  { name: 'Chokhmah', sector: 'Spiritual', glyph: 'II', col: 1, row: 1 },
  { name: 'Binah', sector: 'Structural', glyph: 'III', col: -1, row: 1 },
  { name: 'Da’at', sector: 'Metacognition', glyph: '·', col: 0, row: 1.75, hidden: true },
  { name: 'Chesed', sector: 'Emotional', glyph: 'IV', col: 1, row: 2.5 },
  { name: 'Gevurah', sector: 'Logical', glyph: 'V', col: -1, row: 2.5 },
  { name: 'Tiferet', sector: '“I”', glyph: 'VI', col: 0, row: 3.25 },
  { name: 'Netzach', sector: 'Relational', glyph: 'VII', col: 1, row: 4.5 },
  { name: 'Hod', sector: 'Behavioral', glyph: 'VIII', col: -1, row: 4.5 },
  { name: 'Yesod', sector: 'Identity', glyph: 'IX', col: 0, row: 5.25 },
  { name: 'Malkuth', sector: 'Body & Subconscious', glyph: 'X', col: 0, row: 6.5 },
];
const PATHS = [
  ['Keter', 'Chokhmah'], ['Keter', 'Binah'], ['Keter', 'Tiferet'], ['Chokhmah', 'Binah'],
  ['Chokhmah', 'Tiferet'], ['Chokhmah', 'Chesed'], ['Binah', 'Tiferet'], ['Binah', 'Gevurah'],
  ['Chesed', 'Gevurah'], ['Chesed', 'Tiferet'], ['Chesed', 'Netzach'], ['Gevurah', 'Tiferet'],
  ['Gevurah', 'Hod'], ['Tiferet', 'Netzach'], ['Tiferet', 'Yesod'], ['Tiferet', 'Hod'],
  ['Netzach', 'Hod'], ['Netzach', 'Yesod'], ['Netzach', 'Malkuth'], ['Hod', 'Yesod'],
  ['Hod', 'Malkuth'], ['Yesod', 'Malkuth'],
];

const NOTE_COLORS = ['#fff1a8', '#ffd3e6', '#c9f2dc', '#e0d4ff', '#ffe0bf'];

export function formatSaved(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleString('en-US', { month: 'short' });
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `Saved ${month} ${d.getDate()}, ${d.getFullYear()}, ${hours % 12 || 12}:${minutes} ${hours >= 12 ? 'pm' : 'am'}`;
}

export function buildWorld({ scene, art, acquisitions, withheld = new Set(), summary }) {
  const world = { rooms: {}, portals: [], artworks: [], animators: [] };
  const glowTex = TX.glowTexture();
  const beamTex = TX.beamTexture();
  const M = {
    gold: new THREE.MeshStandardMaterial({ color: 0xc9a24c, metalness: 1, roughness: 0.3 }),
    lip: new THREE.MeshStandardMaterial({ color: 0x3b2a14, metalness: 0.4, roughness: 0.6 }),
    black: new THREE.MeshStandardMaterial({ color: 0x141316, roughness: 0.5 }),
    mat: new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.9 }),
    slab: new THREE.MeshStandardMaterial({ color: 0xf8f6f1, roughness: 0.92 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb58a3c, metalness: 1, roughness: 0.35 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x3a2620, roughness: 0.6 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xfdfcf8, roughness: 0.95 }),
  };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const facing = (dir) => Math.atan2(dir.x, dir.z);
  const additive = (color, opacity, map = glowTex) =>
    new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const shadowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false });

  function animate(room, fn) {
    world.animators.push({ room: room.id, fn });
  }

  function makeRoom(id, bounds, surface, env) {
    const group = new THREE.Group();
    group.name = id;
    scene.add(group);
    const room = { id, group, bounds, surface, env, obstacles: [], portals: [], artworks: [], wing: WINGS[id] };
    world.rooms[id] = room;
    return room;
  }

  function addLights(room, [sky, ground, hemiIntensity], points) {
    room.group.add(new THREE.HemisphereLight(sky, ground, hemiIntensity));
    for (const [x, y, z, color, intensity, distance] of points) {
      const light = new THREE.PointLight(color, intensity, distance, 1.3);
      light.position.set(x, y, z);
      room.group.add(light);
    }
  }

  function rectRoom(room, { x0, x1, z0, z1, H, wallCanvas, floorMat, ceilingMat }) {
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    room.group.add(floor);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(cx, H, cz);
    room.group.add(ceiling);
    const base = TX.toTexture(wallCanvas);
    const wall = (len, pos, rotY) => {
      const t = base.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(len / 4, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
      m.position.copy(pos);
      m.rotation.y = rotY;
      room.group.add(m);
    };
    wall(w, V3(cx, H / 2, z0), 0);
    wall(w, V3(cx, H / 2, z1), Math.PI);
    wall(d, V3(x0, H / 2, cz), Math.PI / 2);
    wall(d, V3(x1, H / 2, cz), -Math.PI / 2);
  }

  function bars(g, w, h, b, d, mat) {
    const mk = (bw, bh, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), mat);
      m.position.set(x, y, d / 2);
      g.add(m);
    };
    mk(w + 2 * b, b, 0, h / 2 + b / 2);
    mk(w + 2 * b, b, 0, -h / 2 - b / 2);
    mk(b, h, -w / 2 - b / 2, 0);
    mk(b, h, w / 2 + b / 2, 0);
  }

  function buildFrame(g, style, w, h, id, opts) {
    if (style === 'gilded') {
      const b = THREE.MathUtils.clamp(0.07 + 0.03 * Math.max(w, h), 0.1, 0.22);
      bars(g, w, h, 0.025, 0.035, M.lip);
      bars(g, w + 0.05, h + 0.05, b, 0.09, M.gold);
      return { w: w + 0.05 + 2 * b, h: h + 0.05 + 2 * b, cy: 0 };
    }
    if (style === 'museum') {
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.16, h + 0.16), M.mat);
      mat.position.z = 0.008;
      g.add(mat);
      bars(g, w + 0.16, h + 0.16, 0.035, 0.045, M.black);
      return { w: w + 0.23, h: h + 0.23, cy: 0 };
    }
    if (style === 'lightbox') {
      bars(g, w, h, 0.03, 0.04, M.black);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.5 + 1, h * 1.5 + 1), additive(opts.glow ?? 0x8f7bff, 0.5));
      glow.position.z = -0.03;
      g.add(glow);
      return { w: w + 0.06, h: h + 0.06, cy: 0 };
    }
    if (style === 'polaroid') {
      const card = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.14, h + 0.36), M.paper);
      card.position.set(0, -0.11, 0.006);
      g.add(card);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.5, h + 0.75), shadowMat);
      shadow.position.set(0.04, -0.17, 0.001);
      g.add(shadow);
      const tape = new THREE.MeshBasicMaterial({ color: 0xf3e3c3, transparent: true, opacity: 0.78, toneMapped: false });
      const t = TX.hash(id);
      for (const side of [-1, 1]) {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.08), tape);
        strip.position.set(side * (w / 2 + 0.02), h / 2 + 0.05, 0.022);
        strip.rotation.z = -side * (0.5 + t * 0.4);
        g.add(strip);
      }
      return { w: w + 0.14, h: h + 0.36, cy: -0.11 };
    }
    if (style === 'oval') {
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.25, h * 1.2), shadowMat.clone());
      shadow.material.opacity = 0.35;
      shadow.position.set(0.04, -0.06, 0.002);
      g.add(shadow);
      return { w, h, cy: 0 };
    }
    return { w, h, cy: 0 };
  }

  function customPlaque(fields, style = 'card') {
    const texture = TX.plaqueTexture({ ...fields, style });
    const w = 0.5;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, w / TX.PLAQUE_ASPECT), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  }

  // Hangs one work. pos is the artwork centre; dir is the direction it faces.
  // A card in the work's place when the public site withholds it.
  function addWithheld(room, id, o) {
    const work = WORKS[id];
    const h = o.h;
    const w = h * (work?.aspect || 1.25);
    const g = new THREE.Group();
    g.position.copy(o.pos);
    g.rotation.y = facing(o.dir);
    if (o.tilt) g.rotateZ(o.tilt);
    room.group.add(g);
    const tex = TX.noticeTexture({
      title: 'Not shown online',
      body: `“${work?.title || 'Untitled'}” hangs only in the collector’s local copy. ${work?.withheldReason || 'The artist asks that it not be reposted.'}`,
      hand: o.plaque === 'note',
    });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    card.position.z = 0.014;
    g.add(card);
    buildFrame(g, o.frame || 'museum', w, h, id, o);
    return null;
  }

  function addWork(room, id, o) {
    const entry = art.get(id);
    if (!entry) return withheld.has(id) ? addWithheld(room, id, o) : null;
    const work = entry.work;
    let h = o.h;
    let w = h * entry.aspect;
    if (o.maxW && w > o.maxW) {
      w = o.maxW;
      h = w / entry.aspect;
    }
    const g = new THREE.Group();
    g.position.copy(o.pos);
    if (o.floor) g.rotation.set(-Math.PI / 2, 0, Math.PI);
    else g.rotation.y = facing(o.dir);
    if (o.tilt) g.rotateZ(o.tilt);
    room.group.add(g);

    const material = new THREE.MeshBasicMaterial({
      map: entry.texture,
      toneMapped: false,
      transparent: entry.oval,
      alphaTest: entry.oval ? 0.4 : 0,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.z = 0.014;
    g.add(mesh);
    const frame = buildFrame(g, o.frame || 'museum', w, h, id, o);
    let viewW = frame.w;
    let viewH = frame.h;

    const plaqueStyle = o.plaque === undefined ? 'card' : o.plaque;
    const plaqueW = 0.5;
    const plaqueH = plaqueW / TX.PLAQUE_ASPECT;
    const callouts = o.callouts !== false && work?.callouts?.length ? work.callouts : null;
    if (callouts) {
      const decal = TX.calloutDecal(callouts, w, h, {
        margin: o.margin ?? 1.3,
        style: o.ink || 'dark',
        reserve: plaqueStyle && o.plaqueSide !== 'below' ? plaqueH + 0.12 : 0,
      });
      const dm = new THREE.Mesh(
        new THREE.PlaneGeometry(decal.width, decal.height),
        new THREE.MeshBasicMaterial({ map: decal.texture, transparent: true, depthWrite: false, toneMapped: false }),
      );
      dm.position.z = 0.022;
      dm.renderOrder = 2;
      g.add(dm);
      viewW = Math.max(viewW, decal.width - 0.3);
      viewH = Math.max(viewH, decal.height - 0.3);
    }
    if (plaqueStyle) {
      const plaque = customPlaque(
        {
          title: work?.title || 'Untitled acquisition',
          artist: work?.artist || 'Curatorial notes pending',
          medium: work?.medium || 'New acquisition',
          saved: formatSaved(entry.saved),
          noteColor: NOTE_COLORS[Math.floor(TX.hash(id) * NOTE_COLORS.length)],
        },
        plaqueStyle,
      );
      if (o.plaqueSide === 'below') plaque.position.set(0, frame.cy - frame.h / 2 - 0.1 - plaqueH / 2, 0.012);
      else plaque.position.set(frame.w / 2 + 0.14 + plaqueW / 2, -h / 2 + plaqueH / 2, 0.012);
      if (plaqueStyle === 'note') plaque.rotation.z = (TX.hash(`${id}n`) - 0.5) * 0.14;
      g.add(plaque);
    }
    mesh.userData = { id, entry, work, room: room.id, viewW, viewH, group: g };
    world.artworks.push(mesh);
    room.artworks.push(mesh);

    if (o.float) {
      const baseY = g.position.y;
      const phase = TX.hash(id) * Math.PI * 2;
      animate(room, (t) => {
        g.position.y = baseY + Math.sin(t * 0.7 + phase) * 0.06;
      });
    }
    if (o.shadow || o.floorGlow) {
      const size = Math.max(w, 1.2);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.2, 1.1), o.floorGlow ? additive(o.floorGlow, 0.35) : shadowMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -facing(o.dir);
      m.position.set(o.pos.x, 0.012, o.pos.z);
      room.group.add(m);
    }
    if (o.obstacle) room.obstacles.push({ type: 'circle', x: o.pos.x, z: o.pos.z, r: Math.min(1.1, Math.max(0.5, frame.w / 2)) });
    return { group: g, mesh, w, h, frame };
  }

  function pictureLight(res, color = 0xffe2b0, strength = 0.22) {
    if (!res) return;
    const { group: g, frame } = res;
    const barLen = Math.min(frame.w * 0.55, 1.4);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, barLen, 16), M.brass);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, frame.h / 2 + 0.16, 0.24);
    g.add(bar);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.24), M.brass);
    arm.position.set(0, frame.h / 2 + 0.16, 0.12);
    g.add(arm);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(frame.w * 1.6, frame.h * 1.3), additive(color, strength));
    pool.position.set(0, 0.15, 0.002);
    g.add(pool);
  }

  function addText(room, spec, pos, dir) {
    const t = TX.wallText(spec);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(t.width, t.height),
      new THREE.MeshBasicMaterial({ map: t.texture, transparent: true, depthWrite: false, toneMapped: false }),
    );
    m.position.copy(pos);
    m.rotation.y = facing(dir);
    room.group.add(m);
    return m;
  }

  function addPortal(room, { pos, dir, dest, w = 2.8, h = 3.6, signW = 3.6, style = 'dark' }) {
    const g = new THREE.Group();
    g.position.set(pos.x, 0.12 + h / 2, pos.z);
    g.rotation.y = facing(dir);
    room.group.add(g);
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    surface.position.z = 0.02;
    g.add(surface);
    bars(g, w, h, 0.05, 0.05, M.lip);
    bars(g, w + 0.1, h + 0.1, 0.2, 0.16, M.gold);
    const shimmer = new THREE.Mesh(new THREE.PlaneGeometry(w, h), additive(0xfff1d0, 0.1));
    shimmer.position.z = 0.03;
    g.add(shimmer);
    const phase = pos.x + pos.z;
    animate(room, (t) => {
      shimmer.material.opacity = 0.08 + 0.06 * Math.sin(t * 1.3 + phase);
    });
    const wing = WINGS[dest];
    const sign = TX.signTexture(wing.name, dest === 'lobby' ? 'Return to the entrance hall' : wing.subtitle, style);
    const sm = new THREE.Mesh(
      new THREE.PlaneGeometry(signW, signW / sign.aspect),
      new THREE.MeshBasicMaterial({ map: sign.texture, transparent: true, depthWrite: false, toneMapped: false }),
    );
    sm.position.set(0, h / 2 + 0.2 + signW / sign.aspect / 2, 0.02);
    g.add(sm);
    const normal = dir.clone().normalize();
    const portal = { room: room.id, dest, pos: V3(pos.x, 0, pos.z), normal, w, h, surface, group: g };
    room.portals.push(portal);
    world.portals.push(portal);
    return portal;
  }

  // ------------------------------------------------------------ Rotunda
  function buildLobby() {
    const R = 9;
    const H = 7;
    const room = makeRoom('lobby', { type: 'circle', x: 0, z: 0, r: R }, 'marble', {
      bg: '#f2efe9',
      fog: { type: 'linear', color: '#f2efe9', near: 24, far: 90 },
      envI: 0.5,
    });
    const g = room.group;
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(R, 96),
      new THREE.MeshStandardMaterial({ map: TX.lobbyFloor(R, 'COOLIMAGES · A MUSEUM OF THINGS THAT STARE BACK · '), roughness: 0.32 }),
    );
    floor.rotation.x = -Math.PI / 2;
    g.add(floor);
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, H, 128, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xe9e3d7, roughness: 0.95, side: THREE.BackSide }),
    );
    wall.position.y = H / 2;
    g.add(wall);
    const pilasterMat = new THREE.MeshStandardMaterial({ color: 0xf3efe7, roughness: 0.85 });
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      const pilaster = new THREE.Mesh(new THREE.BoxGeometry(0.55, H, 0.28), pilasterMat);
      pilaster.position.set(Math.sin(a) * (R - 0.1), H / 2, -Math.cos(a) * (R - 0.1));
      pilaster.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
      g.add(pilaster);
    }
    const skirting = new THREE.Mesh(
      new THREE.CylinderGeometry(R - 0.02, R - 0.02, 0.22, 128, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xd8d0c2, roughness: 0.8, side: THREE.BackSide }),
    );
    skirting.position.y = 0.11;
    g.add(skirting);
    for (const [y, tube] of [[H, 0.14], [H - 0.6, 0.04]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R - 0.05, tube, 12, 128), M.slab);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      g.add(ring);
    }
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(R, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xf7f4ee, roughness: 1, side: THREE.BackSide }),
    );
    dome.scale.y = 0.55;
    dome.position.y = H;
    g.add(dome);
    const top = H + R * 0.55;
    const oculus = new THREE.Mesh(new THREE.CircleGeometry(1.45, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    oculus.rotation.x = Math.PI / 2;
    oculus.position.y = top - 0.08;
    g.add(oculus);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 2.3, top - 0.1, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: beamTex, color: 0xfff1d4, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    shaft.position.y = (top - 0.1) / 2;
    g.add(shaft);
    const r = TX.rng(8);
    const pts = [];
    for (let i = 0; i < 380; i++) {
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * 2.1;
      pts.push(Math.cos(a) * rr, 0.3 + r() * 10.5, Math.sin(a) * rr);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: glowTex, size: 0.06, color: 0xc9b58f, transparent: true, opacity: 0.55, depthWrite: false }));
    g.add(dust);
    animate(room, (t) => {
      dust.rotation.y = t * 0.02;
      dust.position.y = Math.sin(t * 0.2) * 0.15;
    });
    addLights(room, [0xfffaf2, 0xb9ad99, 1.05], [
      [0, 9, 0, 0xfff1d8, 45, 30],
      [0, 3.2, 3.5, 0xffffff, 12, 16],
    ]);

    const P = R - 0.2;
    addPortal(room, { pos: V3(0, 0, -P), dir: V3(0, 0, 1), dest: 'gallery' });
    addPortal(room, { pos: V3(P, 0, 0), dir: V3(-1, 0, 0), dest: 'eyes' });
    addPortal(room, { pos: V3(0, 0, P), dir: V3(0, 0, -1), dest: 'familiars' });
    addPortal(room, { pos: V3(-P, 0, 0), dir: V3(1, 0, 0), dest: 'bedroom' });

    const slab = (a) => {
      const w = 6.4;
      const h = 4.6;
      const rr = 7.95;
      const d = V3(Math.sin(a), 0, -Math.cos(a));
      const n = d.clone().negate();
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), M.slab);
      m.position.set(d.x * rr, h / 2, d.z * rr);
      m.rotation.y = facing(n);
      g.add(m);
      room.obstacles.push({ type: 'sector', x: 0, z: 0, r0: rr - 0.3, r1: 50, a, half: Math.atan((w / 2 + 0.25) / rr) });
      const front = V3(d.x * (rr - 0.11), 0, d.z * (rr - 0.11));
      const right = V3(n.z, 0, -n.x);
      return { n, at: (dx, y) => V3(front.x + right.x * dx, y, front.z + right.z * dx) };
    };
    const nw = slab(-Math.PI / 4);
    addWork(room, 'HRsJtzQWIAA24vx', { pos: nw.at(0, 2.2), dir: nw.n, h: 2.6, frame: 'museum', margin: 1.25 });
    const ne = slab(Math.PI / 4);
    addWork(room, 'HS-AHa8a0AAuBEe', { pos: ne.at(0, 2.2), dir: ne.n, h: 2.0, frame: 'museum', margin: 1.25 });
    const sw = slab((-3 * Math.PI) / 4);
    addWork(room, 'HRutGhBbUAAc6Zl', { pos: sw.at(0, 2.2), dir: sw.n, h: 2.3, frame: 'museum', margin: 1.35 });
    const se = slab((3 * Math.PI) / 4);
    addText(
      room,
      {
        kicker: 'Welcome',
        title: 'coolimages',
        subtitle: 'A museum of things that stare back',
        body: [
          `${summary.count} images saved from X between ${summary.range}, and one afternoon of conversation about why they resonated.`,
          'The thesis: something sweet on the surface, something enormous and watchful underneath, taken completely seriously and as a joke at the same time.',
          'Walk into a painting to travel. Press E to look closer.',
        ],
        width: 3.2,
      },
      se.at(-1.45, 2.35),
      se.n,
    );
    addWork(room, 'HSGdkqHWUAI8V2_', { pos: se.at(1.75, 2.55), dir: se.n, h: 2.0, frame: 'museum', plaqueSide: 'below' });

    // Vitrine with the reconstructed hat from Fig. 4.1.
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 1.3), M.slab);
    plinth.position.y = 0.5;
    g.add(plinth);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.15, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xdfeff0, transparent: true, opacity: 0.14, roughness: 0.05, depthWrite: false }),
    );
    glass.position.y = 1.575;
    g.add(glass);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: 0xb9b2a4 }));
    edges.position.copy(glass.position);
    g.add(edges);
    const hat = new THREE.Group();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.8, 48, 1, true),
      new THREE.MeshStandardMaterial({ map: TX.wizardHat(), roughness: 0.8, side: THREE.DoubleSide }),
    );
    cone.position.y = 0.42;
    hat.add(cone);
    hat.add(new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.025, 48), new THREE.MeshStandardMaterial({ color: 0x1c2458, roughness: 0.8 })));
    hat.rotation.z = 0.12;
    g.add(hat);
    animate(room, (t) => {
      hat.rotation.y = t * 0.35;
      hat.position.y = 1.26 + Math.sin(t * 0.9) * 0.04;
    });
    const hatPlaque = customPlaque({
      title: 'The Hat (reconstruction)',
      artist: 'After Fig. 4.1, Designer as Magician',
      medium: 'Felt, stars, one crescent moon',
      saved: 'On permanent display',
    });
    hatPlaque.position.set(0, 0.62, 0.652);
    g.add(hatPlaque);
    room.obstacles.push({ type: 'circle', x: 0, z: 0, r: 0.95 });

    // New acquisitions: anything in the folder that isn't catalogued yet.
    const slots = [[-3.0, 2.4], [3.0, 2.4], [-3.0, -2.4], [3.0, -2.4]];
    acquisitions.slice(0, slots.length).forEach((id, i) => {
      const [x, z] = slots[i];
      const legMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.7 });
      for (const [lx, lz, rz, rx] of [[-0.45, 0.12, 0.12, 0.1], [0.45, 0.12, -0.12, 0.1], [0, -0.35, 0, -0.35]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.1, 0.05), legMat);
        leg.position.set(x + lx, 1.02, z + lz);
        leg.rotation.set(rx, 0, rz);
        g.add(leg);
      }
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.14), legMat);
      ledge.position.set(x, 0.86, z + 0.2);
      g.add(ledge);
      addWork(room, id, { pos: V3(x, 1.5, z + 0.24), dir: V3(0, 0, 1), h: 1.1, frame: 'museum', plaqueSide: 'below' });
      room.obstacles.push({ type: 'circle', x, z, r: 0.65 });
    });
    return room;
  }

  // ------------------------------------------------------- Grand Gallery
  function buildGallery() {
    const x0 = -6;
    const x1 = 6;
    const z0 = -214;
    const z1 = -186;
    const H = 5.2;
    const room = makeRoom('gallery', { type: 'rect', x0, x1, z0, z1 }, 'wood', {
      bg: '#f3efe6',
      fog: { type: 'linear', color: '#f3efe6', near: 30, far: 80 },
      envI: 0.45,
    });
    rectRoom(room, {
      x0, x1, z0, z1, H,
      wallCanvas: TX.galleryWall(H),
      floorMat: new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.parquet(), { repeat: [6, 14] }), roughness: 0.5 }),
      ceilingMat: new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.coffers(), { repeat: [6, 14] }), roughness: 1 }),
    });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 24), new THREE.MeshBasicMaterial({ color: 0xfff8ea, toneMapped: false }));
    sky.rotation.x = Math.PI / 2;
    sky.position.set(0, H - 0.02, -200);
    room.group.add(sky);
    addLights(room, [0xfff1dc, 0x6e5a44, 0.9], [
      [0, 4.6, -193, 0xffe2b8, 32, 22],
      [0, 4.6, -207, 0xffe2b8, 32, 22],
    ]);
    addPortal(room, { pos: V3(0, 0, -186.06), dir: V3(0, 0, -1), dest: 'lobby' });
    addText(
      room,
      { kicker: 'Wing I', title: WINGS.gallery.name, subtitle: WINGS.gallery.subtitle, body: WINGS.gallery.statement, width: 3.3 },
      V3(-3.95, 2.5, -186.02),
      V3(0, 0, -1),
    );
    const notice = customPlaque({ title: 'Please do not feed the shark.', artist: 'The Management', medium: '', saved: '' }, 'brass');
    notice.position.set(3.9, 1.5, -186.02);
    notice.rotation.y = Math.PI;
    room.group.add(notice);

    const west = V3(1, 0, 0);
    const east = V3(-1, 0, 0);
    pictureLight(addWork(room, 'HS-U0fHWgAESaIL', { pos: V3(-5.97, 1.9, -192), dir: west, h: 1.8, frame: 'gilded', plaque: 'brass' }));
    pictureLight(addWork(room, 'HRsoxy1XwAArjtI', { pos: V3(-5.97, 1.95, -200), dir: west, h: 2.4, frame: 'oval', plaque: 'brass' }));
    pictureLight(addWork(room, 'HSCmkFiasAAH6W3', { pos: V3(-5.97, 1.9, -208), dir: west, h: 1.75, frame: 'gilded', plaque: 'brass' }));
    pictureLight(addWork(room, 'HS894oZbQAAA0O0', { pos: V3(5.97, 1.85, -192), dir: east, h: 1.55, frame: 'gilded', plaque: 'brass' }));
    pictureLight(addWork(room, 'HS3yTUjWgAA1l0l', { pos: V3(5.97, 1.9, -200), dir: east, h: 1.75, frame: 'gilded', plaque: 'brass' }));
    pictureLight(addWork(room, 'HTAiirQWYAA7g5J', { pos: V3(5.97, 1.9, -208), dir: east, h: 2.0, frame: 'gilded', plaque: 'brass' }));
    pictureLight(addWork(room, 'HSnottDbYAAsfeg', { pos: V3(0, 2.45, -213.97), dir: V3(0, 0, 1), h: 3.0, maxW: 6.2, frame: 'gilded', plaque: 'brass' }), 0xffe2b0, 0.18);

    for (const bz of [-196, -204]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.55), M.leather);
      seat.position.set(0, 0.46, bz);
      room.group.add(seat);
      for (const lx of [-1.05, 1.05]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.5), M.brass);
        leg.position.set(lx, 0.21, bz);
        room.group.add(leg);
      }
      room.obstacles.push({ type: 'rect', x0: -1.25, x1: 1.25, z0: bz - 0.32, z1: bz + 0.32 });
    }
    return room;
  }

  // -------------------------------------------------------- Hall of Eyes
  function buildEyes() {
    const cx = 200;
    const x0 = 189;
    const x1 = 211;
    const z0 = -11;
    const z1 = 11;
    const H = 6;
    const room = makeRoom('eyes', { type: 'rect', x0, x1, z0, z1 }, 'stone', {
      bg: '#0d0c20',
      fog: { type: 'exp2', color: '#0d0c20', density: 0.022 },
      envI: 0.22,
    });
    rectRoom(room, {
      x0, x1, z0, z1, H,
      wallCanvas: TX.eyesWall(H),
      floorMat: new THREE.MeshStandardMaterial({
        map: TX.treeOfLifeFloor(SEPHIROT, PATHS, { size: 22, rowScale: 2.0, colScale: 2.6, rowCenter: 3.25 }),
        roughness: 0.55,
        metalness: 0.15,
      }),
      ceilingMat: new THREE.MeshStandardMaterial({ color: 0x0b0a1a, roughness: 1 }),
    });
    const r = TX.rng(61);
    const starPts = [];
    for (let i = 0; i < 650; i++) starPts.push(x0 + r() * 22, H - 0.05 - r() * 0.1, z0 + r() * 22);
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPts, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ map: glowTex, size: 0.09, color: 0xd6dcff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    room.group.add(stars);
    animate(room, (t) => {
      stars.material.opacity = 0.65 + 0.2 * Math.sin(t * 0.8);
    });
    addLights(room, [0x6b5fd6, 0x0a0915, 0.6], [
      [cx, 4.2, 0, 0x8f7bff, 30, 18],
      [cx + 8, 3.5, 0, 0xffcf8a, 18, 14],
    ]);

    // The eye above Tiferet ("I") follows you around the room.
    const irisTex = TX.iris();
    const eyeY = 4.45;
    const eyeGeo = new THREE.SphereGeometry(0.85, 64, 32);
    eyeGeo.rotateY(-Math.PI / 2);
    const eye = new THREE.Mesh(
      eyeGeo,
      new THREE.MeshStandardMaterial({ map: irisTex, emissiveMap: irisTex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.15 }),
    );
    eye.position.set(cx, eyeY, 0);
    room.group.add(eye);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, color: 0x8f7bff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    halo.scale.set(4.2, 4.2, 1);
    halo.position.copy(eye.position);
    room.group.add(halo);
    const dais = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.05, 12, 96), new THREE.MeshBasicMaterial({ color: 0xd6b05c, toneMapped: false }));
    dais.rotation.x = Math.PI / 2;
    dais.position.set(cx, 0.03, 0);
    room.group.add(dais);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5), additive(0x8f7bff, 0.35));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(cx, 0.02, 0);
    room.group.add(pool);
    room.obstacles.push({ type: 'circle', x: cx, z: 0, r: 1.5 });
    const aim = new THREE.Object3D();
    aim.position.copy(eye.position);
    const drift = new THREE.Vector3();
    animate(room, (t, dt, cam) => {
      drift.set(Math.sin(t * 0.37) * 0.35, Math.sin(t * 0.53) * 0.2, 0);
      aim.lookAt(cam.position.x + drift.x, cam.position.y + drift.y, cam.position.z);
      eye.quaternion.slerp(aim.quaternion, 1 - Math.exp(-dt * 2.2));
      eye.position.y = eyeY + Math.sin(t * 0.6) * 0.08;
      halo.position.y = eye.position.y;
    });

    addPortal(room, { pos: V3(x0 + 0.06, 0, 0), dir: V3(1, 0, 0), dest: 'lobby', style: 'light' });
    addText(
      room,
      { kicker: 'Wing II', title: WINGS.eyes.name, subtitle: WINGS.eyes.subtitle, body: WINGS.eyes.statement, width: 3.4, style: 'light' },
      V3(x0 + 0.03, 2.7, -6.3),
      V3(1, 0, 0),
    );
    addText(
      room,
      {
        kicker: 'The floor',
        title: 'Tree of Life',
        subtitle: 'Labelled twice',
        body: 'Keter points east, toward the mind map. Each sephirah carries its Psychomechanics twin. Da’at, the hidden one, is drawn dashed. The eye floats over Tiferet, which the mind map calls “I”.',
        width: 2.8,
        style: 'light',
      },
      V3(193.4, 2.5, z1 - 0.03),
      V3(0, 0, -1),
    );

    const lit = { frame: 'lightbox', plaque: 'glass', ink: 'light' };
    addWork(room, 'HS56-LzXQAATNaF', { ...lit, pos: V3(x1 - 0.04, 3.05, 0), dir: V3(-1, 0, 0), h: 4.6, glow: 0x6c5ce7, margin: 1.3 });
    pictureLight(
      addWork(room, 'HS8eseTbYAA_fkk', { pos: V3(cx, 2.75, z0 + 0.04), dir: V3(0, 0, 1), h: 3.7, frame: 'gilded', plaque: 'glass', ink: 'light', margin: 1.3 }),
      0xffd9a0,
      0.3,
    );
    addWork(room, 'HS8x_iKXAAEexAs', { ...lit, pos: V3(193.4, 2.4, z0 + 0.04), dir: V3(0, 0, 1), h: 2.2, glow: 0xb28cff, margin: 1.15 });
    addWork(room, 'HS9rkoyWwAAdx6-', { ...lit, pos: V3(206.6, 2.4, z0 + 0.04), dir: V3(0, 0, 1), h: 2.5, glow: 0xff5a5a });
    addWork(room, 'HS-9mn0XkAAhjzw', { ...lit, pos: V3(cx, 2.55, z1 - 0.04), dir: V3(0, 0, -1), h: 3.0, glow: 0xff6b4a, margin: 1.25 });
    addWork(room, 'HS_wJCAWIAAlDAn', { ...lit, pos: V3(206.6, 2.35, z1 - 0.04), dir: V3(0, 0, -1), h: 1.9, glow: 0xffb86b });

    const ring = [
      ['HS9Y32UWMAAWBb6', -Math.PI / 4, 1.8, 0xff4f6d],
      ['HTAGvK9WwAAU7SV', Math.PI / 4, 1.9, 0xff9ab0],
      ['HS-JlvKbkAA9wwR', (3 * Math.PI) / 4, 1.6, 0x7dffb0],
      ['HS_m5FmawAEmcgp', (-3 * Math.PI) / 4, 2.0, 0x8fb4ff],
    ];
    for (const [id, a, h, glow] of ring) {
      const pos = V3(cx + Math.sin(a) * 6.4, 2.35, -Math.cos(a) * 6.4);
      const dir = V3(cx - pos.x, 0, -pos.z).normalize();
      addWork(room, id, { ...lit, pos, dir, h, glow, float: true, floorGlow: glow, obstacle: true, margin: 1.0 });
    }
    return room;
  }

  // -------------------------------------------------------- The Familiars
  function buildFamiliars() {
    const room = makeRoom('familiars', { type: 'rect', x0: -13, x1: 13, z0: 186.0, z1: 213.4 }, 'void', {
      bg: '#f5f3ef',
      fog: { type: 'linear', color: '#f5f3ef', near: 14, far: 46 },
      envI: 1.0,
    });
    const g = room.group;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ color: 0xf7f5f1, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 200);
    g.add(floor);
    const edge = TX.makeCanvas(1040, 1100);
    const ectx = edge.getContext('2d');
    ectx.strokeStyle = 'rgba(120,110,95,0.28)';
    ectx.lineWidth = 5;
    ectx.setLineDash([26, 18]);
    ectx.strokeRect(12, 12, 1016, 1076);
    const edgeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(26.4, 27.9),
      new THREE.MeshBasicMaterial({ map: TX.toTexture(edge), transparent: true, depthWrite: false, toneMapped: false }),
    );
    edgeMesh.rotation.x = -Math.PI / 2;
    edgeMesh.position.set(0, 0.006, 199.7);
    g.add(edgeMesh);
    addLights(room, [0xffffff, 0xe8e2d6, 1.7], [
      [0, 6, 194, 0xffffff, 22, 30],
      [0, 6, 207, 0xffffff, 22, 30],
    ]);

    // The entrance slab carries the portal home, the wing statement and a
    // reading guide. Walking in faces +z, so +x is on the visitor's left.
    const portalWall = new THREE.Mesh(new THREE.BoxGeometry(11, 4.8, 0.3), M.slab);
    portalWall.position.set(0, 2.4, 185.83);
    g.add(portalWall);
    addPortal(room, { pos: V3(0, 0, 186.0), dir: V3(0, 0, 1), dest: 'lobby' });
    addText(
      room,
      { kicker: 'Wing III', title: WINGS.familiars.name, subtitle: WINGS.familiars.subtitle, body: WINGS.familiars.statement, width: 3.3 },
      V3(-3.75, 2.45, 186.0),
      V3(0, 0, 1),
    );
    addText(
      room,
      {
        kicker: 'Reading order',
        title: 'Four acts',
        body: [
          'Walking in, Act I (the servant) and Act III (the person) hang on your left. Act II (the product) and Act IV (the artist) hang on your right.',
          'Beyond them: a maze solved by cheating, a game nobody played, a train that became a grasshopper, and a sword in a laptop.',
        ],
        width: 3.0,
      },
      V3(3.75, 2.35, 186.0),
      V3(0, 0, 1),
    );

    const floating = { frame: 'bare', float: true, shadow: true, obstacle: true };
    addWork(room, 'HS66G83WoAAKSxQ', { ...floating, pos: V3(6.5, 2.3, 194), dir: V3(-1, 0, 0), h: 2.3 });
    addWork(room, 'HSxE-R2WUAAqhnn', { ...floating, pos: V3(-6.5, 2.3, 194), dir: V3(1, 0, 0), h: 2.4 });
    const voxel = addWork(room, 'HS-prGBboAAvr4b', { ...floating, pos: V3(6.5, 2.4, 203.5), dir: V3(-1, 0, 0), h: 2.6 });
    if (voxel) voxelCloud(room, voxel.group, voxel.w, voxel.h);
    addWork(room, 'HS-3JcyW4AA0crZ', { ...floating, pos: V3(-6.5, 2.3, 203.5), dir: V3(1, 0, 0), h: 2.3 });
    addWork(room, 'HSGdtLCWAAAvYcH', { ...floating, pos: V3(0, 2.45, 212.2), dir: V3(0, 0, -1), h: 2.2 });
    addWork(room, 'HS_k9vJaYAEmIKe', { ...floating, pos: V3(-6.3, 2.3, 211.2), dir: V3(0, 0, -1), h: 2.0, margin: 1.2 });

    // Floor projection, with a lectern plaque at its near edge.
    const maze = addWork(room, 'HS8U3qJXoAAan7s', { pos: V3(0, 0.025, 199.4), floor: true, h: 4.4, frame: 'bare', plaque: null, margin: 1.4 });
    if (maze) lectern(room, 'HS8U3qJXoAAan7s', V3(3.9, 0, 196.4), V3(0, 0, -1));

    // A game that never existed, on a CRT.
    const crtX = 6;
    const crtZ = 210.8;
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.85, 1.3), M.slab);
    plinth.position.set(crtX, 0.425, crtZ);
    g.add(plinth);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.2, 1.15), new THREE.MeshStandardMaterial({ color: 0xd9d1bd, roughness: 0.6 }));
    body.position.set(crtX, 1.45, crtZ);
    g.add(body);
    const screen = addWork(room, 'HS-0K-qWUAEnxD2', { pos: V3(crtX, 1.47, crtZ - 0.585), dir: V3(0, 0, -1), h: 0.98, frame: 'bare' });
    if (screen) {
      const lines = new THREE.Mesh(
        new THREE.PlaneGeometry(0.98, 0.98),
        new THREE.MeshBasicMaterial({ map: TX.scanlines(), transparent: true, depthWrite: false, toneMapped: false }),
      );
      lines.position.z = 0.02;
      screen.group.add(lines);
    }
    room.obstacles.push({ type: 'rect', x0: crtX - 0.75, x1: crtX + 0.75, z0: crtZ - 0.7, z1: crtZ + 0.7 });
    swordSculpture(room, -3.4, 208.4);
    return room;
  }

  function lectern(room, id, pos, dir) {
    const entry = art.get(id);
    const work = entry?.work;
    const g = new THREE.Group();
    g.position.copy(pos);
    g.rotation.y = facing(dir);
    room.group.add(g);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), M.black);
    post.position.y = 0.5;
    g.add(post);
    const plaque = customPlaque({
      title: work?.title || '',
      artist: work?.artist || '',
      medium: work?.medium || '',
      saved: entry ? formatSaved(entry.saved) : '',
    });
    plaque.position.set(0, 1.08, 0.02);
    plaque.rotation.x = -0.5;
    g.add(plaque);
    room.obstacles.push({ type: 'circle', x: pos.x, z: pos.z, r: 0.35 });
  }

  function voxelCloud(room, group, w, h) {
    const N = 150;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.08),
      new THREE.MeshStandardMaterial({ roughness: 0.25, transparent: true, opacity: 0.82, emissive: 0x333333 }),
      N,
    );
    const palette = [0xff3d7f, 0x3dd6ff, 0xffe23d, 0x7dff5a, 0xb05cff, 0xff8a3d];
    const color = new THREE.Color();
    const r = TX.rng(55);
    const parts = [];
    for (let i = 0; i < N; i++) {
      mesh.setColorAt(i, color.setHex(palette[i % palette.length]));
      parts.push({ x: (r() - 0.5) * w, y: (r() - 0.5) * h, life: r(), speed: 0.08 + r() * 0.12, dx: (r() - 0.5) * 0.5, dy: (r() - 0.3) * 0.4, spin: r() * 6 });
    }
    group.add(mesh);
    const dummy = new THREE.Object3D();
    animate(room, (t, dt) => {
      for (let i = 0; i < N; i++) {
        const p = parts[i];
        p.life += dt * p.speed;
        if (p.life > 1) {
          p.life -= 1;
          p.x = (r() - 0.5) * w;
          p.y = (r() - 0.5) * h;
        }
        const L = p.life;
        dummy.position.set(p.x + p.dx * L, p.y + p.dy * L, 0.06 + L * 1.4);
        dummy.scale.setScalar(Math.max(0.001, (1 - L) * (0.7 + 0.3 * Math.sin(t * 3 + p.spin))));
        dummy.rotation.set(t * 0.7 + p.spin, t * 0.5, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  function swordSculpture(room, x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    room.group.add(g);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.9), M.slab);
    plinth.position.y = 0.5;
    g.add(plinth);
    const shell = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.35 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.15 });
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, 1.13, 0.18);
      pivot.rotation.y = side * 0.75;
      const half = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.24, 0.015), shell);
      half.position.x = side * 0.175;
      pivot.add(half);
      if (side > 0) {
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.2), glassMat);
        glass.position.set(0.175, 0, -0.009);
        glass.rotation.y = Math.PI;
        pivot.add(glass);
      }
      g.add(pivot);
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.18 });
    const sword = new THREE.Group();
    sword.position.set(0.05, 1.13, 0.05);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.012), steel);
    blade.position.x = 0.2;
    sword.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.12, 4), steel);
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = 0.81;
    sword.add(tip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.26, 0.04), steel);
    guard.position.x = -0.37;
    sword.add(guard);
    for (const s of [-1, 1]) {
      const hook = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.035), steel);
      hook.position.set(-0.34, s * 0.13, 0);
      hook.rotation.z = s * 0.6;
      sword.add(hook);
    }
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 12), M.leather);
    grip.rotation.z = Math.PI / 2;
    grip.position.x = -0.5;
    sword.add(grip);
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), steel);
    pommel.position.x = -0.63;
    sword.add(pommel);
    g.add(sword);
    const plaque = customPlaque({
      title: 'Sword in the Laptop (reconstruction)',
      artist: 'After the photograph nearby',
      medium: 'Polygons',
      saved: 'Rendered live',
    });
    plaque.position.set(0, 0.62, -0.452);
    plaque.rotation.y = Math.PI;
    g.add(plaque);
    room.obstacles.push({ type: 'rect', x0: x - 0.55, x1: x + 0.55, z0: z - 0.55, z1: z + 0.55 });
  }

  // ------------------------------------------------------ Bedroom Wall
  function buildBedroom() {
    const x0 = -211;
    const x1 = -189;
    const z0 = -8;
    const z1 = 8;
    const H = 4.2;
    const room = makeRoom('bedroom', { type: 'rect', x0, x1, z0, z1 }, 'carpet', {
      bg: '#2a2340',
      fog: { type: 'linear', color: '#2a2340', near: 30, far: 80 },
      envI: 0.45,
    });
    const g = room.group;
    rectRoom(room, {
      x0, x1, z0, z1, H,
      wallCanvas: TX.bedroomWall(H),
      floorMat: new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.carpet(), { repeat: [14, 11] }), roughness: 1 }),
      ceilingMat: new THREE.MeshStandardMaterial({ color: 0x3a3166, roughness: 1 }),
    });
    const rug = new THREE.Mesh(new THREE.CircleGeometry(2.4, 64), new THREE.MeshStandardMaterial({ map: TX.toTexture(TX.checkerRug()), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-201, 0.01, 0);
    g.add(rug);
    addLights(room, [0xffe0f0, 0x5a4a7e, 0.85], [
      [-194, 2.4, 0, 0xffb6dc, 18, 16],
      [-206, 2.4, 0, 0xffd29a, 18, 16],
    ]);

    const starTex = TX.starGlow();
    const r = TX.rng(17);
    for (let i = 0; i < 46; i++) {
      const s = 0.14 + r() * 0.16;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), additive(0xe8ffb8, 0.75, starTex));
      m.rotation.x = Math.PI / 2;
      m.rotation.z = r() * Math.PI;
      m.position.set(x0 + 0.5 + r() * 21, H - 0.01, z0 + 0.5 + r() * 15);
      g.add(m);
    }

    // Fairy lights strung along the long walls.
    const bulbColors = [0xfff2c4, 0xffb8dc, 0xd7c2ff, 0xbff5dc];
    const positions = [];
    const colors = [];
    const c = new THREE.Color();
    for (const wz of [z0 + 0.12, z1 - 0.12]) {
      const wire = [];
      for (let x = x0 + 0.4, i = 0; x <= x1 - 0.4; x += 0.35, i++) {
        const u = ((x - x0) % 3) / 1.5 - 1;
        const y = 3.8 - 0.24 * (1 - u * u);
        positions.push(x, y, wz);
        c.setHex(bulbColors[i % bulbColors.length]);
        colors.push(c.r, c.g, c.b);
        wire.push(new THREE.Vector3(x, y + 0.03, wz));
      }
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(wire), new THREE.LineBasicMaterial({ color: 0x4a3d5e })));
    }
    const bulbGeo = new THREE.BufferGeometry();
    bulbGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    bulbGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const bulbs = new THREE.Points(
      bulbGeo,
      new THREE.PointsMaterial({ map: glowTex, size: 0.28, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    g.add(bulbs);
    animate(room, (t) => {
      bulbs.material.opacity = 0.85 + 0.15 * Math.sin(t * 2.1);
    });

    const beanbag = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 16), new THREE.MeshStandardMaterial({ color: 0xb9a3e8, roughness: 1 }));
    beanbag.scale.set(1, 0.55, 1);
    beanbag.position.set(-204.5, 0.42, 3.2);
    g.add(beanbag);
    room.obstacles.push({ type: 'circle', x: -204.5, z: 3.2, r: 0.9 });

    const windowFrame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 1.7), M.mat);
    windowFrame.position.set(x1 - 0.04, 2.1, -4.8);
    g.add(windowFrame);
    const night = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), new THREE.MeshBasicMaterial({ map: TX.nightWindow(), toneMapped: false }));
    night.position.set(x1 - 0.09, 2.1, -4.8);
    night.rotation.y = -Math.PI / 2;
    g.add(night);
    for (const side of [-1, 1]) {
      const curtain = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 2.5), new THREE.MeshStandardMaterial({ color: 0xf4a7c9, roughness: 1, side: THREE.DoubleSide }));
      curtain.position.set(x1 - 0.14, 2.15, -4.8 + side * 0.95);
      curtain.rotation.y = -Math.PI / 2;
      g.add(curtain);
    }

    addPortal(room, { pos: V3(x1 - 0.06, 0, 0), dir: V3(-1, 0, 0), dest: 'lobby', w: 2.4, h: 3.0, signW: 3.0, style: 'hand' });
    addText(
      room,
      { kicker: 'Wing IV', title: WINGS.bedroom.name, subtitle: WINGS.bedroom.subtitle, body: WINGS.bedroom.statement, width: 2.9, style: 'hand' },
      V3(x1 - 0.03, 2.25, 4.8),
      V3(-1, 0, 0),
    );

    const pin = (id, pos, dir, h) =>
      addWork(room, id, { pos, dir, h, frame: 'polaroid', plaque: 'note', tilt: (TX.hash(id) - 0.5) * 0.12 });
    const north = V3(0, 0, 1);
    const south = V3(0, 0, -1);
    const west = V3(1, 0, 0);
    pin('HS-zGlbbEAAgsIJ', V3(-195, 2.15, z0 + 0.03), north, 1.8);
    pin('HS_hSswasAAIOeB', V3(-201, 2.1, z0 + 0.03), north, 1.45);
    pin('HS90sLhaUAA3Y8Z', V3(-206.6, 2.1, z0 + 0.03), north, 1.5);
    pin('HS_b3eSbkAA5aOC', V3(-195, 2.1, z1 - 0.03), south, 1.75);
    pin('HS8lijvbkAA7lp-', V3(-201, 2.1, z1 - 0.03), south, 1.75);
    pin('HS73G0uaMAAOA52', V3(-206.6, 2.1, z1 - 0.03), south, 1.8);
    pin('HTAWnXLWsAAmpX_', V3(x0 + 0.03, 2.1, -5.2), west, 1.5);
    pin('HS86lAyb0AA-3bC', V3(x0 + 0.03, 2.15, 0), west, 2.3);
    pin('HTAmU4-WYAAAI_g', V3(x0 + 0.03, 2.1, 5.2), west, 1.35);
    return room;
  }

  buildLobby();
  buildGallery();
  buildEyes();
  buildFamiliars();
  buildBedroom();
  return world;
}

// Movement collision: a room's walkable area minus its obstacles.
export function walkable(room, x, z, pad = 0.38) {
  const b = room.bounds;
  if (b.type === 'circle') {
    if (Math.hypot(x - b.x, z - b.z) > b.r - pad) return false;
  } else if (x < b.x0 + pad || x > b.x1 - pad || z < b.z0 + pad || z > b.z1 - pad) return false;
  for (const o of room.obstacles) {
    if (o.type === 'circle') {
      if (Math.hypot(x - o.x, z - o.z) < o.r + pad) return false;
    } else if (o.type === 'rect') {
      if (x > o.x0 - pad && x < o.x1 + pad && z > o.z0 - pad && z < o.z1 + pad) return false;
    } else if (o.type === 'sector') {
      const dx = x - o.x;
      const dz = z - o.z;
      const dist = Math.hypot(dx, dz);
      if (dist > o.r0 - pad && dist < o.r1) {
        let diff = Math.atan2(dx, -dz) - o.a;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) < o.half + pad / Math.max(dist, 1)) return false;
      }
    }
  }
  return true;
}
