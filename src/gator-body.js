// The alligator's body (gator.js is his behaviour): the WildMesh 3D model
// "ALLIGATOR - Realistic 3D Model (DEMO FREE)" (CC BY-NC 4.0, credited in the
// museum), loaded when the manifest has it (`gator`, built from models/ by
// tools/build_assets.py): its idle and trot clips blended by his speed, the
// trot slowed to match his walk, his body bent through turns bone by bone,
// and kept out of the floor. Without it, a procedural stand-in: a body tube
// deformed every frame along a swaying spine and four jointed legs in the
// diagonal "high walk".
//
// Either is { root, pose(t, dt, g, floorAt?), clearance?() }: posed each
// frame from his state `g` (gator.js).
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

// ------------------------------------------------------------ the real one
const SCALE = 0.9; // the model is 3.9 m long
// Its trot moves a planted foot about 0.73 m in 0.41 s: the speed the clip
// was made for, so feet don't slide at whatever speed he walks.
const TROT_SPEED = (0.73 / 0.41) * SCALE;

export async function loadModel(url) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  model.scale.setScalar(SCALE);
  model.rotation.y = Math.PI / 2; // it faces +z; he walks along +x
  model.position.x = 0.1 * SCALE; // his position is mid-body
  model.traverse((o) => {
    if (o.isSkinnedMesh) o.frustumCulled = false;
  });
  const root = new THREE.Group();
  root.add(model);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.9, 1.3),
    new THREE.MeshBasicMaterial({ map: TX.toTexture(glowCanvas()), color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(-0.1, 0.012, 0);
  root.add(shadow);
  root.traverse((o) => (o.userData.gator = true));
  const mixer = new THREE.AnimationMixer(model);
  const clip = (re) => gltf.animations.find((c) => re.test(c.name));
  // The "Idle" clip is a hiss: he raises his head and gapes from 1.5 s to
  // 5.3 s. Its calm last stretch, rocked back and forth slowly, is his rest.
  const idleClip = clip(/Idle/);
  const rest = mixer.clipAction(THREE.AnimationUtils.subclip(idleClip, 'rest', 162, 182, 30));
  rest.setLoop(THREE.LoopPingPong);
  rest.timeScale = 0.35;
  const hiss = mixer.clipAction(idleClip);
  hiss.setLoop(THREE.LoopOnce, 1);
  hiss.clampWhenFinished = true;
  const walk = mixer.clipAction(clip(/Trot/));
  rest.play();
  walk.play();
  let mw = 0; // walking weight
  let hw = 0; // hissing weight
  let hissing = false;
  // Turning, bone by bone. His front leads: the spine bends toward his
  // heading from the hips forward and the neck and head lead into the turn
  // (and look at you). Behind, the hips and each tail bone follow the bone
  // ahead with the delay of walking one segment's length, so the body follows
  // the path the head took and the tail trails it; standing still, they drag
  // round slowly. Each joint bends a limited amount.
  const B = (n) => model.getObjectByName(n);
  const hips = B('Hips');
  const front = [['Spine', 0.1, 0], ['Spine1', 0.22, 0], ['Spine2', 0.38, 0], ['Spine3', 0.56, 0], ['Spine4', 0.74, 0], ['Neck01', 0.88, 0.15], ['Neck02', 0.96, 0.4], ['Neck03', 1, 0.7], ['Head', 1, 1]]
    .map(([n, k, lookK]) => ({ bone: B(n), k, lookK }))
    .filter((j) => j.bone);
  const tail = ['Tail01', 'Tail02', 'Tail03', 'Tail04', 'Tail05'].map(B).filter(Boolean);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  let hipYaw = 0;
  const tailYaw = tail.map(() => 0);
  let primed = false;
  const follow = (yaw, lead, step, seg, dt, maxBend) => {
    yaw += wrap(lead - yaw) * Math.min(1, step / seg + dt * 0.7);
    const d = wrap(lead - yaw);
    return Math.abs(d) > maxBend ? lead - Math.sign(d) * maxBend : yaw;
  };
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const targets = new Map();
  let look = 0;
  // Keeping out of the floor: the tail chain (to its tip) and the chin.
  const chain = [hips && B('Tail01') ? B('Tail01') : null, B('Tail02'), B('Tail03'), B('Tail04'), B('Tail05')].filter(Boolean);
  const tailEnd = B('Tail05')?.children.find((c) => c.isBone) || null;
  // How far each tail joint's centre must stay above the floor, from Tail01
  // to the tip: half the tail's thickness there at this scale, plus a little.
  const JOINT_CLEAR = [0.18, 0.16, 0.13, 0.1, 0.075, 0.05];
  const neck = B('Neck02');
  const chin = B('fJaw_end') || B('fJaw') || B('Head');
  const at = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const seg = new THREE.Vector3();
  const liftAxis = new THREE.Vector3();
  const UPV = new THREE.Vector3(0, 1, 0);
  // The joint after chain[i] (the tail tip after the last), in world space.
  const tipOf = (i, out) => {
    if (i + 1 < chain.length) return chain[i + 1].getWorldPosition(out);
    if (tailEnd) return tailEnd.getWorldPosition(out);
    chain[i].getWorldPosition(out);
    const prevPos = chain[i - 1].getWorldPosition(new THREE.Vector3());
    return out.add(out.clone().sub(prevPos).multiplyScalar(0.9));
  };
  // Rotate `bone` (at `from`) about the horizontal axis across its segment so
  // the point `to` rises by `need` metres (or sinks, if negative).
  const lift = (bone, from, to, need) => {
    seg.subVectors(to, from);
    const len = seg.length();
    if (len < 1e-3) return;
    const now = Math.asin(Math.max(-1, Math.min(1, seg.y / len)));
    const want = Math.asin(Math.max(-0.98, Math.min(0.98, (seg.y + need) / len)));
    liftAxis.crossVectors(seg, UPV);
    if (liftAxis.lengthSq() < 1e-8) return;
    liftAxis.normalize();
    bone.parent.getWorldQuaternion(q);
    liftAxis.applyQuaternion(q.invert());
    bone.quaternion.premultiply(turn.setFromAxisAngle(liftAxis, want - now));
    bone.updateMatrixWorld(true);
  };
  let top = null;
  const mid = new THREE.Vector3();
  const along = new THREE.Vector3();
  // The highest built surface under a point and a little either side of it
  // along the tail (so a step's edge between samples can't poke through):
  // `back` metres toward the joint, `on` past it.
  const floorUnder = (point, dir, back, on) => {
    let best = null;
    for (const o of [0, -back, on]) {
      const f = top(point.x + dir.x * o, point.z + dir.z * o, point.y + 0.2);
      if (f !== null && (best === null || f > best)) best = f;
    }
    return best;
  };
  // How much segment i (joint i to the next) must rise at its far end to keep
  // both its end and its middle clear (negative: that much room to spare).
  const shortfall = (i) => {
    chain[i].getWorldPosition(at);
    tipOf(i, tip);
    along.subVectors(tip, at).setY(0).normalize();
    mid.addVectors(at, tip).multiplyScalar(0.5);
    const half = Math.hypot(tip.x - at.x, tip.z - at.z) / 2;
    const fEnd = floorUnder(tip, along, Math.min(0.12, half), JOINT_CLEAR[i + 1]);
    const fMid = floorUnder(mid, along, half, half);
    let need = -Infinity;
    if (fEnd !== null) need = Math.max(need, fEnd + JOINT_CLEAR[i + 1] - tip.y);
    // Turning about its joint, the middle rises half as much as the end.
    if (fMid !== null) need = Math.max(need, 2 * (fMid + (JOINT_CLEAR[i] + JOINT_CLEAR[i + 1]) / 2 - mid.y));
    return need;
  };
  const chinShortfall = () => {
    chin.getWorldPosition(tip);
    const f = top(tip.x, tip.z, tip.y + 0.2);
    return f === null ? -Infinity : f + 0.05 - tip.y;
  };
  // For checks: how far each tail segment (end and middle) and the chin sit
  // above what they must clear; negative would be in the floor.
  const clearance = () => {
    if (!top) return null;
    root.updateMatrixWorld(true);
    const out = chain.map((b, i) => -shortfall(i)).filter(Number.isFinite);
    if (chin) {
      const c = chinShortfall();
      if (Number.isFinite(c)) out.push(-c);
    }
    return out.map((v) => +v.toFixed(3));
  };
  return {
    root,
    clearance,
    pose(t, dt, g, floorAt) {
      top = floorAt || null;
      // His legs step whenever he moves or turns, even on the spot.
      const turning = Math.abs(g.omega);
      mw += (Math.min(1, Math.max(g.speed / 0.3, turning / 0.45)) - mw) * Math.min(1, dt * 4);
      if (g.hissing && !hissing) {
        hissing = true;
        hiss.reset().play();
      }
      if (hissing && (!hiss.isRunning() || hiss.time >= idleClip.duration - 0.05)) {
        hissing = false;
        g.hissing = false;
      }
      hw += ((hissing ? 1 : 0) - hw) * Math.min(1, dt * (hissing ? 3 : 1.5));
      walk.setEffectiveWeight(mw * (1 - hw));
      rest.setEffectiveWeight((1 - mw) * (1 - hw));
      hiss.setEffectiveWeight(hw);
      walk.setEffectiveTimeScale(Math.max(0.25, Math.max(g.speed, turning * 0.9) / TROT_SPEED));
      mixer.update(dt);
      // The bend: an absolute yaw for each bone, then each bone turned by the
      // difference from its parent's (about the world's up, after the clips).
      const heading = g.heading;
      if (!primed || g.placed) {
        hipYaw = heading;
        tailYaw.fill(heading);
        primed = true;
        g.placed = false;
      }
      const step = g.speed * dt;
      hipYaw = follow(hipYaw, heading, step, 0.9, dt, 0.5);
      let prev = hipYaw;
      tail.forEach((b, i) => {
        tailYaw[i] = follow(tailYaw[i], prev, step, 0.3, dt, 0.28);
        prev = tailYaw[i];
      });
      look += (g.look - look) * Math.min(1, dt * 3);
      const lead = Math.max(-0.45, Math.min(0.45, g.omega * 0.55));
      const bend = wrap(heading - hipYaw);
      targets.clear();
      if (hips) targets.set(hips, hipYaw);
      for (const j of front) targets.set(j.bone, hipYaw + bend * j.k + lead * Math.max(0, (j.k - 0.7) / 0.3) + look * j.lookK);
      tail.forEach((b, i) => targets.set(b, tailYaw[i]));
      root.updateMatrixWorld(true);
      for (const [bone, yaw] of targets) {
        const delta = wrap(yaw - (targets.has(bone.parent) ? targets.get(bone.parent) : heading));
        if (Math.abs(delta) < 1e-4) continue;
        bone.parent.getWorldQuaternion(q);
        axis.set(0, 1, 0).applyQuaternion(q.invert());
        bone.quaternion.premultiply(turn.setFromAxisAngle(axis, delta));
      }
      // Nothing of him goes into the floor. His tail carries on the line of
      // his spine as the clips hold it (high off the floor as he walks);
      // only where a segment's end or middle would come nearer what's built
      // under it than the tail's thickness there is it lifted, just enough.
      // Then the chin.
      if (!top) return;
      root.updateMatrixWorld(true);
      for (let i = 0; i < chain.length; i++) {
        let need = shortfall(i);
        if (!Number.isFinite(need)) continue;
        if (need > 0) {
          lift(chain[i], at, tip, need);
          need = shortfall(i);
          // Too short to get clear by itself (its joint is down against a
          // step): raise the joint, from the segment before, and try again.
          if (need > 0.005 && i > 0) {
            shortfall(i - 1);
            lift(chain[i - 1], at, tip, need);
            need = shortfall(i);
            if (need > 0) lift(chain[i], at, tip, need);
          }
        }
      }
      if (neck && chin) {
        const need = chinShortfall();
        if (need > 0) {
          neck.getWorldPosition(at);
          lift(neck, at, tip, need);
        }
      }
    },
  };
}

// The stand-in, posed from his state `g` (walked, speed, look) each frame.
export function standIn() {
  const m = build();
  const tmp = new THREE.Vector3();
  const spine = new Array(SEGS + 1);
  for (let i = 0; i <= SEGS; i++) spine[i] = { p: new THREE.Vector3(), t: new THREE.Vector3(), side: new THREE.Vector3(), up: new THREE.Vector3() };
  const UP = new THREE.Vector3(0, 1, 0);

  // Place every ring of the body along a swaying spine, then the head, nose and legs.
  function pose(t, g) {
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
  return {
    root: m.root,
    pose(t, dt, g) {
      g.hissing = false;
      pose(t, g);
    },
  };
}
