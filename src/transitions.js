// Ways through a painting-door. Each has an `out` half (walking into the
// painting, t 0..1) and an `in` half (stepping out in the next room), which
// shape the camera (roll, a field-of-view kick), a screen effect and the fade
// through paper-white. main.js picks one at random for every door, never the
// same one twice running; some turn either way.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => t * t * (3 - 2 * t);
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const ss = (a, b, t) => smooth(clamp01((t - a) / (b - a)));
const outCubic = (t) => 1 - (1 - t) ** 3;

export const TRANSITIONS = {
  // The classic: a quarter roll into white.
  roll: {
    turns: true,
    dur: [1.0, 1.1],
    out: (t, s) => ({ roll: s * (Math.PI / 2) * smoother(t), fov: 24 * t ** 3, fade: ss(0.55, 0.97, t) }),
    in: (t, s) => ({ roll: -s * (Math.PI / 2) * (1 - smoother(t)), fov: 24 * (1 - outCubic(t)), fade: 1 - ss(0, 0.55, t) }),
  },
  // A whole barrel roll, then the last quarter settles on the other side.
  spin: {
    turns: true,
    dur: [1.35, 1.1],
    out: (t, s) => ({ roll: s * TAU * smoother(t), fov: 30 * t ** 3, fade: ss(0.72, 0.99, t) }),
    in: (t, s) => ({ roll: s * (Math.PI / 2) * (1 - smoother(t)), fov: 30 * (1 - outCubic(t)), fade: 1 - ss(0, 0.5, t) }),
  },
  // Sucked in: the room whirls down a drain at the painting's centre, and
  // unwinds, still turning the same way, in the next room.
  swirl: {
    turns: true,
    dur: [1.25, 1.25],
    out: (t, s) => ({ fx: 1, amount: smooth(t) ** 1.4, dir: s, fov: -14 * t * t, fade: ss(0.85, 1, t) * 0.55 }),
    in: (t, s) => ({ fx: 1, amount: (1 - smooth(t)) ** 1.4, dir: -s, fov: 10 * (1 - outCubic(t)), fade: (1 - ss(0, 0.25, t)) * 0.55 }),
  },
  // Dolly zoom: the room stretches away around the painting.
  vertigo: {
    dur: [1.2, 1.05],
    out: (t) => ({ fov: 58 * t ** 2.2, roll: 0.05 * Math.sin(t * 11) * t, fade: ss(0.78, 1, t) }),
    in: (t) => ({ fov: -26 * (1 - outCubic(t)), fade: 1 - ss(0, 0.4, t) }),
  },
  // The view breaks up into squares, like the museum's perforated front wall.
  dither: {
    dur: [1.1, 1.15],
    out: (t) => ({ fx: 2, amount: smooth(t) }),
    in: (t) => ({ fx: 2, amount: 1 - smooth(t) }),
  },
  // Dropping into the painting as if it were water.
  ripple: {
    dur: [1.15, 1.15],
    out: (t) => ({ fx: 3, amount: t, fade: ss(0.6, 0.98, t) }),
    in: (t) => ({ fx: 3, amount: 1 - t, fade: 1 - ss(0, 0.45, t) }),
  },
  // An old film's iris, closing to black on a gold ring and opening again.
  iris: {
    dur: [1.0, 1.0],
    out: (t) => ({ fx: 4, amount: smooth(t) }),
    in: (t) => ({ fx: 4, amount: 1 - outCubic(t) }),
  },
  // Warp: everything streaks toward the middle, colours coming apart.
  warp: {
    dur: [1.1, 1.0],
    out: (t) => ({ fx: 5, amount: t * t, fov: 42 * t * t, fade: ss(0.78, 1, t) }),
    in: (t) => ({ fx: 5, amount: (1 - t) ** 2, fov: 22 * (1 - outCubic(t)), fade: 1 - ss(0, 0.4, t) }),
  },
};

// A different way through every time; the ones that turn pick a direction.
let last = null;
export function pickTransition(force) {
  const names = Object.keys(TRANSITIONS).filter((n) => n !== last);
  const name = force && TRANSITIONS[force] ? force : names[Math.floor(Math.random() * names.length)];
  last = name;
  return { name, ...TRANSITIONS[name], dir: Math.random() < 0.5 ? 1 : -1 };
}

// ------------------------------------------------------------ screen effects
// While a door's effect runs, the scene renders into a target and a full-
// screen pass bends it; the rest of the time the scene renders straight out.
const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D tScene;
uniform int uMode;
uniform float uAmount;
uniform float uDir;
uniform float uTime;
uniform float uAspect;
uniform vec2 uRes;
varying vec2 vUv;

const vec3 PAPER = vec3(0.964, 0.955, 0.921); // #fbfaf6, linear
const vec3 GOLD = vec3(0.60, 0.40, 0.10);

float bayer4(vec2 cell) {
  vec2 m = mod(cell, 4.0);
  int i = int(m.x) + int(m.y) * 4;
  float v[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return v[i] / 16.0;
}

vec3 look(vec2 uv) {
  return texture2D(tScene, clamp(uv, 0.001, 0.999)).rgb;
}

void main() {
  vec2 uv = vUv;
  vec2 p = uv - 0.5;
  p.x *= uAspect;
  float r = length(p);
  vec3 col;
  bool display = false; // colour already tone-mapped
  if (uMode == 1) {
    // Swirl: twist more toward the centre, and pull in.
    float a = uDir * uAmount * 11.0 * pow(max(0.0, 1.0 - r * 1.1), 2.2);
    float s = sin(a);
    float c = cos(a);
    vec2 q = mat2(c, s, -s, c) * p * (1.0 - 0.62 * uAmount);
    q.x /= uAspect;
    col = look(q + 0.5);
    col *= 1.0 - 0.55 * uAmount * smoothstep(0.15, 0.85, r);
  } else if (uMode == 2) {
    // Dither: bigger squares, and more of them turning to paper.
    float bs = mix(2.0, 60.0, pow(uAmount, 1.3));
    vec2 cell = floor(gl_FragCoord.xy / bs);
    vec2 cuv = (cell + 0.5) * bs / uRes;
    col = look(mix(uv, cuv, smoothstep(0.0, 0.35, uAmount)));
    #ifdef TONE_MAPPING
      col = toneMapping(col);
    #endif
    display = true;
    if (uAmount * 1.18 - 0.1 > bayer4(cell)) col = PAPER;
  } else if (uMode == 3) {
    // Ripple, with a little colour fringe.
    vec2 dir = r > 0.0 ? p / r : vec2(0.0);
    vec2 off = dir * sin(r * 42.0 - uTime * 9.0) * 0.022 * uAmount * (1.2 - r);
    off.x /= uAspect;
    col = vec3(look(uv + off * 1.25).r, look(uv + off).g, look(uv + off * 0.75).b);
  } else if (uMode == 4) {
    // Iris: a closing circle with a thin gold edge.
    float rad = mix(1.05, -0.03, uAmount);
    col = look(uv);
    #ifdef TONE_MAPPING
      col = toneMapping(col);
    #endif
    display = true;
    col += GOLD * smoothstep(0.012, 0.0, abs(r - rad)) * step(0.0, rad);
    col = mix(col, vec3(0.012, 0.011, 0.01), smoothstep(rad, rad + 0.01, r));
  } else if (uMode == 5) {
    // Warp: a radial streak toward the middle, channels drifting apart.
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 14; i++) {
      float k = 1.0 - float(i) * 0.03 * uAmount;
      vec2 q = p * k;
      q.x /= uAspect;
      acc.r += look(q * 1.012 + 0.5).r;
      acc.g += look(q + 0.5).g;
      acc.b += look(q * 0.988 + 0.5).b;
    }
    col = acc / 14.0 * (1.0 + 0.4 * uAmount * (1.0 - r));
  } else {
    col = look(uv);
  }
  #ifdef TONE_MAPPING
    if (!display) col = toneMapping(col);
  #endif
  gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
}`;

export function makeFx(renderer) {
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  const float = renderer.extensions.has('EXT_color_buffer_float');
  const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: float ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: 4 });
  const uniforms = {
    tScene: { value: rt.texture },
    uMode: { value: 0 },
    uAmount: { value: 0 },
    uDir: { value: 1 },
    uTime: { value: 0 },
    uAspect: { value: size.x / size.y },
    uRes: { value: size.clone() },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false });
  const quad = new THREE.Scene();
  quad.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // The target follows the drawing buffer's size.
  const fit = () => {
    renderer.getDrawingBufferSize(size);
    if (!size.x || !size.y || (size.x === rt.width && size.y === rt.height)) return;
    rt.setSize(size.x, size.y);
    uniforms.uRes.value.copy(size);
    uniforms.uAspect.value = size.x / size.y;
  };
  return {
    get on() {
      return uniforms.uMode.value !== 0;
    },
    set(mode = 0, amount = 0, dir = 1) {
      uniforms.uMode.value = mode;
      uniforms.uAmount.value = amount;
      uniforms.uDir.value = dir;
    },
    // The effect's shader compiled and its target allocated up front, so the
    // first door doesn't do it. (The scene's shaders for drawing into a
    // target are warmed with `target`: see prepareGpu in main.js.)
    target: rt,
    warm() {
      fit();
      renderer.compile(quad, cam);
      renderer.initRenderTarget?.(rt);
    },
    render(scene, camera) {
      fit();
      uniforms.uTime.value = performance.now() / 1000;
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(quad, cam);
    },
  };
}
