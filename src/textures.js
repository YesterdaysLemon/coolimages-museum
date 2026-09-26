// Procedural canvas textures: floors, walls, plaques, signs and callout decals.
import * as THREE from 'three';

export const FONT = {
  serif: '"EB Garamond", Garamond, "Times New Roman", serif',
  hand: '"Patrick Hand", "Comic Sans MS", cursive',
  mono: '"VT323", Consolas, monospace',
};

let anisotropy = 8;
export function setAnisotropy(value) {
  anisotropy = value;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function toTexture(canvas, { srgb = true, repeat = null, nearest = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  if (nearest) t.magFilter = THREE.NearestFilter;
  return t;
}

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

export function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxW) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function grain(ctx, w, h, amount, r) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function spaced(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

// ------------------------------------------------------------------ floors

export function lobbyFloor(R, inscription) {
  const S = 2048;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const r = rng(7);
  const ppm = S / (2 * R);
  const cx = S / 2;
  ctx.fillStyle = '#efece5';
  ctx.fillRect(0, 0, S, S);
  ctx.lineCap = 'round';
  for (let i = 0; i < 50; i++) {
    let x = r() * S;
    let y = r() * S;
    let a = r() * Math.PI * 2;
    ctx.strokeStyle = `rgba(150,140,125,${0.05 + r() * 0.1})`;
    ctx.lineWidth = 0.6 + r() * 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 40; k++) {
      a += (r() - 0.5) * 0.7;
      x += Math.cos(a) * 18;
      y += Math.sin(a) * 18;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  grain(ctx, S, S, 9, r);
  const annulus = (r0, r1, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cx, r1 * ppm, 0, Math.PI * 2);
    ctx.arc(cx, cx, r0 * ppm, 0, Math.PI * 2, true);
    ctx.fill();
  };
  annulus(2.4, 4.1, 'rgba(120,108,90,0.10)');
  annulus(R - 0.45, R, 'rgba(120,108,90,0.14)');
  ctx.strokeStyle = 'rgba(140,126,106,0.55)';
  for (const [rad, w] of [[1.6, 3], [2.4, 4], [4.1, 4], [6.3, 3], [R - 0.45, 4]]) {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(cx, cx, rad * ppm, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(140,126,106,0.32)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 4.1 * ppm, cx + Math.sin(a) * 4.1 * ppm);
    ctx.lineTo(cx + Math.cos(a) * (R - 0.45) * ppm, cx + Math.sin(a) * (R - 0.45) * ppm);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(88,72,50,0.82)';
  ctx.font = `500 ${Math.round(0.42 * ppm)}px ${FONT.serif}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Letters lean inward and run counter-clockwise, so the band reads upright
  // from outside it; the first word is centred on the entrance side.
  const chars = [...inscription];
  const step = (Math.PI * 2) / chars.length;
  const firstWord = inscription.indexOf(' ');
  const a0 = Math.PI / 2 + ((firstWord - 1) / 2) * step;
  chars.forEach((ch, i) => {
    const a = a0 - i * step;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * 3.25 * ppm, cx + Math.sin(a) * 3.25 * ppm);
    ctx.rotate(a - Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  return toTexture(c);
}

export function parquet() {
  const S = 1024;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const cw = 128;
  const ph = 32;
  const tones = ['#9a6a3e', '#a8764a', '#8f5f36', '#b07d4f', '#96663b', '#a06f43'];
  for (let col = 0; col < S / cw; col++) {
    const x0 = col * cw;
    const dir = col % 2 ? 1 : -1;
    for (let k = -8; k < S / ph + 8; k++) {
      const y0 = k * ph;
      const kk = ((k % 32) + 32) % 32;
      ctx.fillStyle = tones[(col * 5 + kk * 7) % tones.length];
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + cw, y0 + dir * cw);
      ctx.lineTo(x0 + cw, y0 + dir * cw + ph);
      ctx.lineTo(x0, y0 + ph);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,22,10,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(60,35,15,0.10)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 3; g++) {
        const o = 6 + g * 9;
        ctx.beginPath();
        ctx.moveTo(x0, y0 + o);
        ctx.lineTo(x0 + cw, y0 + dir * cw + o);
        ctx.stroke();
      }
    }
  }
  grain(ctx, S, S, 10, rng(3));
  return c;
}

export function carpet() {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const r = rng(21);
  ctx.fillStyle = '#eeb4c9';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 14000; i++) {
    const light = r() > 0.5;
    ctx.fillStyle = light ? `rgba(255,235,245,${0.15 + r() * 0.25})` : `rgba(170,90,130,${0.08 + r() * 0.16})`;
    ctx.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  return c;
}

export function checkerRug() {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const n = 8;
  const cell = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#fdf7fb' : '#7f9cf0';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  ctx.strokeStyle = '#f7a8c8';
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 16, 0, Math.PI * 2);
  ctx.stroke();
  grain(ctx, S, S, 26, rng(4));
  return c;
}

export function treeOfLifeFloor(sephirot, paths, { size, rowScale, colScale, rowCenter }) {
  const S = 2048;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const r = rng(33);
  const ppm = S / size;
  ctx.fillStyle = '#15142b';
  ctx.fillRect(0, 0, S, S);
  grain(ctx, S, S, 14, r);
  ctx.strokeStyle = 'rgba(120,110,200,0.10)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= size; i += 1.1) {
    ctx.beginPath();
    ctx.moveTo(i * ppm, 0);
    ctx.lineTo(i * ppm, S);
    ctx.moveTo(0, i * ppm);
    ctx.lineTo(S, i * ppm);
    ctx.stroke();
  }
  // Tree axis runs along world +x (top of the tree toward the east wall).
  const toPx = (col, row) => [S / 2 + (rowCenter - row) * rowScale * ppm, S / 2 + col * colScale * ppm];
  const byName = Object.fromEntries(sephirot.map((s) => [s.name, s]));
  ctx.strokeStyle = 'rgba(214,176,92,0.9)';
  ctx.lineWidth = 0.07 * ppm;
  ctx.lineCap = 'round';
  for (const [a, b] of paths) {
    const [x1, y1] = toPx(byName[a].col, byName[a].row);
    const [x2, y2] = toPx(byName[b].col, byName[b].row);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  const rad = 0.58 * ppm;
  for (const s of sephirot) {
    const [x, y] = toPx(s.col, s.row);
    const glow = ctx.createRadialGradient(x, y, rad * 0.4, x, y, rad * 2.2);
    glow.addColorStop(0, 'rgba(214,176,92,0.25)');
    glow.addColorStop(1, 'rgba(214,176,92,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, rad * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1d1b3d';
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226,190,106,0.95)';
    ctx.lineWidth = 0.06 * ppm;
    ctx.setLineDash(s.hidden ? [0.12 * ppm, 0.1 * ppm] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(236,206,130,1)';
    ctx.font = `500 ${Math.round(0.3 * ppm)}px ${FONT.serif}`;
    ctx.fillText(s.glyph, 0, 0);
    ctx.font = `600 ${Math.round(0.26 * ppm)}px ${FONT.serif}`;
    ctx.fillText(s.name, 0, rad + 0.28 * ppm);
    ctx.fillStyle = 'rgba(190,182,240,0.95)';
    ctx.font = `italic ${Math.round(0.21 * ppm)}px ${FONT.serif}`;
    ctx.fillText(s.sector, 0, rad + 0.56 * ppm);
    ctx.restore();
  }
  return toTexture(c);
}

// ------------------------------------------------------------------- walls

export function galleryWall(H) {
  const W = 1024;
  const ppm = 256;
  const Hp = Math.round(H * ppm);
  const c = makeCanvas(W, Hp);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ebe1cd';
  ctx.fillRect(0, 0, W, Hp);
  ctx.strokeStyle = 'rgba(160,138,96,0.16)';
  ctx.lineWidth = 3;
  for (let y = 0, row = 0; y < Hp; y += 160, row++) {
    for (let x = -128; x < W + 128; x += 128) {
      const px = x + (row % 2) * 64;
      ctx.beginPath();
      ctx.ellipse(px, y + 80, 34, 56, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px, y + 50);
      ctx.quadraticCurveTo(px + 16, y + 80, px, y + 110);
      ctx.quadraticCurveTo(px - 16, y + 80, px, y + 50);
      ctx.stroke();
    }
  }
  const rail = Hp - 1.0 * ppm;
  ctx.fillStyle = '#e0d3ba';
  ctx.fillRect(0, rail, W, Hp - rail);
  ctx.strokeStyle = 'rgba(120,98,62,0.35)';
  ctx.lineWidth = 3;
  for (let x = 0; x < W; x += 256) ctx.strokeRect(x + 22, rail + 36, 212, Hp - rail - 0.18 * ppm - 60);
  ctx.fillStyle = '#cdbd9c';
  ctx.fillRect(0, rail - 6, W, 16);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, rail - 6, W, 3);
  ctx.fillStyle = '#c3b18c';
  ctx.fillRect(0, Hp - 0.18 * ppm, W, 0.18 * ppm);
  ctx.fillStyle = '#f2eadb';
  ctx.fillRect(0, 0, W, 0.16 * ppm);
  ctx.fillStyle = 'rgba(120,98,62,0.3)';
  ctx.fillRect(0, 0.16 * ppm, W, 4);
  grain(ctx, W, Hp, 6, rng(9));
  return c;
}

export function eyesWall(H) {
  const W = 1024;
  const ppm = 256;
  const Hp = Math.round(H * ppm);
  const c = makeCanvas(W, Hp);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, Hp);
  g.addColorStop(0, '#12112a');
  g.addColorStop(1, '#23204a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, Hp);
  ctx.strokeStyle = 'rgba(160,150,240,0.08)';
  ctx.fillStyle = 'rgba(160,150,240,0.07)';
  ctx.lineWidth = 3;
  for (let y = 160, row = 0; y < Hp - 200; y += 256, row++) {
    for (let x = -256; x < W + 256; x += 256) {
      const px = x + (row % 2) * 128;
      ctx.beginPath();
      ctx.moveTo(px - 48, y);
      ctx.quadraticCurveTo(px, y - 30, px + 48, y);
      ctx.quadraticCurveTo(px, y + 30, px - 48, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, y, 11, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(214,176,92,0.45)';
  ctx.fillRect(0, Hp - 0.9 * ppm, W, 3);
  ctx.fillRect(0, 0.35 * ppm, W, 3);
  ctx.fillStyle = '#0c0b1d';
  ctx.fillRect(0, Hp - 0.14 * ppm, W, 0.14 * ppm);
  grain(ctx, W, Hp, 8, rng(12));
  return c;
}

export function bedroomWall(H) {
  const W = 1024;
  const ppm = 256;
  const Hp = Math.round(H * ppm);
  const c = makeCanvas(W, Hp);
  const ctx = c.getContext('2d');
  const r = rng(5);
  ctx.fillStyle = '#d9c6ee';
  ctx.fillRect(0, 0, W, Hp);
  for (let y = 0; y < Hp - 128; y += 128) {
    for (let x = 0; x < W; x += 128) {
      const px = x + 34 + r() * 60;
      const py = y + 34 + r() * 60;
      if (r() > 0.5) star(ctx, px, py, 9, 'rgba(255,255,255,0.55)');
      else heart(ctx, px, py, 8, 'rgba(240,150,200,0.45)');
    }
  }
  ctx.fillStyle = '#fbf6ff';
  ctx.fillRect(0, Hp - 0.14 * ppm, W, 0.14 * ppm);
  grain(ctx, W, Hp, 6, r);
  return c;
}

function star(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? s * 0.45 : s;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function heart(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.6, y - s * 1.2, x, y - s * 0.3);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 1.2, x + s * 1.6, y - s * 0.2, x, y + s * 0.9);
  ctx.fill();
}

// Plain painted wall with a skirting board, for generated rooms.
export function plainWall(H, base = '#f1ede5', trim = '#d8d0c2') {
  const W = 1024;
  const ppm = 256;
  const Hp = Math.round(H * ppm);
  const c = makeCanvas(W, Hp);
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, Hp);
  ctx.fillStyle = trim;
  ctx.fillRect(0, Hp - 0.18 * ppm, W, 0.18 * ppm);
  ctx.fillRect(0, 0, W, 0.08 * ppm);
  grain(ctx, W, Hp, 6, rng(Math.round(H * 100)));
  return c;
}

// Pale marble tiles with grout lines; one canvas covers 4 x 4 m.
export function tileFloor() {
  const S = 1024;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const r = rng(29);
  const tile = S / 4;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = 232 + Math.floor(r() * 12);
      ctx.fillStyle = `rgb(${v},${v - 3},${v - 9})`;
      ctx.fillRect(x * tile, y * tile, tile, tile);
    }
  }
  ctx.strokeStyle = 'rgba(150,138,120,0.45)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * tile, 0);
    ctx.lineTo(i * tile, S);
    ctx.moveTo(0, i * tile);
    ctx.lineTo(S, i * tile);
    ctx.stroke();
  }
  grain(ctx, S, S, 8, r);
  return c;
}

export function coffers() {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4efe5';
  ctx.fillRect(0, 0, S, S);
  const inset = 60;
  const g = ctx.createLinearGradient(inset, inset, S - inset, S - inset);
  g.addColorStop(0, '#e2d9c8');
  g.addColorStop(1, '#efe8da');
  ctx.fillStyle = g;
  ctx.fillRect(inset, inset, S - inset * 2, S - inset * 2);
  ctx.strokeStyle = 'rgba(150,130,95,0.35)';
  ctx.lineWidth = 4;
  ctx.strokeRect(inset, inset, S - inset * 2, S - inset * 2);
  ctx.strokeRect(inset + 28, inset + 28, S - inset * 2 - 56, S - inset * 2 - 56);
  return c;
}

export function nightWindow() {
  const W = 512;
  const H = 640;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const r = rng(77);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0c1033');
  g.addColorStop(1, '#3a2a63');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`;
    const s = r() * 2.2 + 0.4;
    ctx.fillRect(r() * W, r() * H * 0.85, s, s);
  }
  ctx.fillStyle = '#fff6d8';
  ctx.beginPath();
  ctx.arc(360, 150, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#131640';
  ctx.beginPath();
  ctx.arc(384, 136, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1438';
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 32) ctx.lineTo(x, H - 60 - (r() * 70 + (x % 96 === 0 ? 50 : 0)));
  ctx.lineTo(W, H);
  ctx.fill();
  return toTexture(c);
}

export function wizardHat() {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const r = rng(41);
  ctx.fillStyle = '#1c2458';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const x = r() * S;
    const y = r() * S;
    if (r() > 0.4) star(ctx, x, y, 10 + r() * 12, '#e9c15a');
    else {
      ctx.fillStyle = '#e9c15a';
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1c2458';
      ctx.beginPath();
      ctx.arc(x + 7, y - 4, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return toTexture(c);
}

export function iris() {
  const W = 1024;
  const H = 512;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const r = rng(99);
  ctx.fillStyle = '#f4eee8';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(190,60,70,0.35)';
  for (let i = 0; i < 60; i++) {
    let x = r() < 0.5 ? r() * 280 : W - r() * 280;
    let y = r() * H;
    ctx.lineWidth = 0.6 + r() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (W / 2 - x) * 0.06 + (r() - 0.5) * 30;
      y += (r() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const cx = W / 2;
  const cy = H / 2;
  const ir = 84;
  const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, ir);
  g.addColorStop(0, '#d7a64a');
  g.addColorStop(0.35, '#3fa38f');
  g.addColorStop(0.8, '#1e5f6b');
  g.addColorStop(1, '#0f2a33');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, ir, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(230,240,220,0.25)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30);
    ctx.lineTo(cx + Math.cos(a) * (ir - 6 - r() * 16), cy + Math.sin(a) * (ir - 6 - r() * 16));
    ctx.stroke();
  }
  ctx.fillStyle = '#050608';
  ctx.beginPath();
  ctx.arc(cx, cy, 32, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(cx - 14, cy - 14, 8, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(c);
}

// --------------------------------------------------------------- effects

export function glowTexture() {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c, { srgb: false });
}

export function beamTexture() {
  const c = makeCanvas(8, 256);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  return toTexture(c, { srgb: false });
}

export function starGlow() {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  star(ctx, S / 2, S / 2, S * 0.3, 'rgba(255,255,255,1)');
  return toTexture(c, { srgb: false });
}

export function scanlines() {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  for (let y = 0; y < S; y += 4) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, y, S, 2);
  }
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c, { srgb: false });
}

// ------------------------------------------------------------ typography

const PLAQUE = {
  card: { bg: '#fbfaf6', ink: '#1d1a16', ink2: '#3b352c', ink3: '#8a8274', border: 'rgba(0,0,0,0.12)', font: FONT.serif },
  brass: { bg: null, ink: '#2e1f0c', ink2: '#3d2a12', ink3: '#5c4520', border: null, font: FONT.serif },
  glass: { bg: 'rgba(14,12,36,0.92)', ink: '#f1ecff', ink2: '#cfc6f5', ink3: '#9990c8', border: 'rgba(214,176,92,0.6)', font: FONT.serif },
  note: { bg: '#fff1a8', ink: '#3d2f63', ink2: '#4a3b73', ink3: '#7a6aa0', border: null, font: FONT.hand },
  mono: { bg: '#f7f5f0', ink: '#16181c', ink2: '#2c3036', ink3: '#7a7f88', border: 'rgba(0,0,0,0.14)', font: FONT.serif },
};

export const PLAQUE_ASPECT = 800 / 460;

export function plaqueTexture({ title, artist, medium, saved, style = 'card', noteColor }) {
  const W = 800;
  const H = 460;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const st = PLAQUE[style] || PLAQUE.card;
  if (style === 'brass') {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#caa65c');
    g.addColorStop(0.5, '#ecd494');
    g.addColorStop(1, '#b38c45');
    ctx.fillStyle = g;
    roundRect(ctx, 0, 0, W, H, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,60,20,0.55)';
    ctx.lineWidth = 5;
    roundRect(ctx, 14, 14, W - 28, H - 28, 10);
    ctx.stroke();
  } else if (style === 'note') {
    ctx.fillStyle = noteColor || st.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(0, 0, W, 54);
  } else {
    ctx.fillStyle = st.bg;
    roundRect(ctx, 0, 0, W, H, 10);
    ctx.fill();
    if (st.border) {
      ctx.strokeStyle = st.border;
      ctx.lineWidth = 4;
      roundRect(ctx, 6, 6, W - 12, H - 12, 8);
      ctx.stroke();
    }
  }
  const hand = style === 'note';
  const pad = 54;
  let y = pad + (hand ? 18 : 6);
  ctx.textBaseline = 'top';
  ctx.fillStyle = st.ink;
  ctx.font = hand ? `58px ${st.font}` : `italic 500 50px ${st.font}`;
  for (const line of wrapLines(ctx, title, W - pad * 2).slice(0, 3)) {
    ctx.fillText(line, pad, y);
    y += hand ? 60 : 56;
  }
  y += 12;
  ctx.fillStyle = st.ink2;
  ctx.font = hand ? `38px ${st.font}` : `500 32px ${st.font}`;
  for (const line of wrapLines(ctx, artist, W - pad * 2).slice(0, 2)) {
    ctx.fillText(line, pad, y);
    y += 40;
  }
  ctx.font = hand ? `36px ${st.font}` : `italic 30px ${st.font}`;
  for (const line of wrapLines(ctx, medium, W - pad * 2).slice(0, 2)) {
    ctx.fillText(line, pad, y);
    y += 38;
  }
  if (saved) {
    ctx.fillStyle = st.ink3;
    ctx.font = hand ? `32px ${st.font}` : `26px ${st.font}`;
    ctx.fillText(saved, pad, H - pad - 26);
  }
  return toTexture(c);
}

// A blank card that stands in for a work withheld from the public site.
export function noticeTexture({ title, body, hand = false }) {
  const W = 800;
  const H = 1000;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const font = hand ? FONT.hand : FONT.serif;
  ctx.fillStyle = '#f6f2ea';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(60,50,40,0.18)';
  ctx.setLineDash([18, 14]);
  ctx.lineWidth = 6;
  ctx.strokeRect(40, 40, W - 80, H - 80);
  ctx.setLineDash([]);
  ctx.fillStyle = '#3d3326';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = hand ? `76px ${font}` : `italic 500 66px ${font}`;
  let y = 330;
  for (const line of wrapLines(ctx, title, W - 180)) {
    ctx.fillText(line, W / 2, y);
    y += 80;
  }
  y += 30;
  ctx.fillStyle = '#6b5f50';
  ctx.font = hand ? `44px ${font}` : `38px ${font}`;
  for (const line of wrapLines(ctx, body, W - 200)) {
    ctx.fillText(line, W / 2, y);
    y += 54;
  }
  return toTexture(c);
}

const INK = {
  dark: { ink: '#211b13', soft: '#4a4034', accent: '#8a6d3b' },
  light: { ink: '#efeaff', soft: '#c9c1ee', accent: '#d9b25e' },
  hand: { ink: '#3f2f68', soft: '#5d4b8a', accent: '#d4679a' },
};

export function wallText({ kicker, title, subtitle, body, width = 3.4, style = 'dark' }) {
  const W = 1700;
  const ppm = W / width;
  const ink = INK[style] || INK.dark;
  const hand = style === 'hand';
  const font = hand ? FONT.hand : FONT.serif;
  const pad = hand ? 90 : 20;
  const measure = makeCanvas(10, 10).getContext('2d');
  const paragraphs = Array.isArray(body) ? body : [body];
  measure.font = hand ? `58px ${font}` : `56px ${font}`;
  const bodyLines = [];
  for (const p of paragraphs) {
    bodyLines.push(...wrapLines(measure, p, W - pad * 2));
    bodyLines.push('');
  }
  bodyLines.pop();
  const lineH = hand ? 78 : 80;
  const H = pad * 2 + (kicker ? 76 : 0) + (title ? 160 : 0) + (subtitle ? 96 : 0) + 44 + bodyLines.length * lineH;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  if (hand) {
    ctx.fillStyle = '#fff8fc';
    roundRect(ctx, 8, 8, W - 16, H - 16, 18);
    ctx.fill();
    ctx.fillStyle = 'rgba(243,227,195,0.85)';
    ctx.save();
    ctx.translate(W / 2, 20);
    ctx.rotate(-0.03);
    ctx.fillRect(-150, -18, 300, 58);
    ctx.restore();
  }
  let y = pad;
  ctx.textBaseline = 'top';
  if (kicker) {
    ctx.fillStyle = ink.accent;
    ctx.font = `600 38px ${font}`;
    spaced(ctx, 8);
    ctx.fillText(kicker.toUpperCase(), pad, y);
    spaced(ctx, 0);
    y += 76;
  }
  if (title) {
    ctx.fillStyle = ink.ink;
    ctx.font = hand ? `128px ${font}` : `500 132px ${font}`;
    ctx.fillText(title, pad, y);
    y += 160;
  }
  if (subtitle) {
    ctx.fillStyle = ink.soft;
    ctx.font = hand ? `66px ${font}` : `italic 70px ${font}`;
    ctx.fillText(subtitle, pad, y);
    y += 96;
  }
  ctx.fillStyle = ink.accent;
  ctx.fillRect(pad, y + 6, 160, 4);
  y += 44;
  ctx.fillStyle = ink.ink;
  ctx.font = hand ? `58px ${font}` : `56px ${font}`;
  for (const line of bodyLines) {
    ctx.fillText(line, pad, y);
    y += lineH;
  }
  return { texture: toTexture(c), width, height: H / ppm };
}

export function signTexture(title, subtitle, style = 'dark') {
  const W = 1600;
  const H = 400;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const ink = INK[style] || INK.dark;
  const font = style === 'hand' ? FONT.hand : FONT.serif;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink.ink;
  ctx.font = style === 'hand' ? `130px ${font}` : `500 116px ${font}`;
  spaced(ctx, style === 'hand' ? 2 : 22);
  ctx.fillText(style === 'hand' ? title : title.toUpperCase(), W / 2, 140);
  spaced(ctx, 0);
  ctx.fillStyle = ink.soft;
  ctx.font = style === 'hand' ? `64px ${font}` : `italic 66px ${font}`;
  ctx.fillText(subtitle, W / 2, 290);
  return { texture: toTexture(c), aspect: W / H };
}

const CALLOUT = {
  dark: { ink: '#1f1a14', line: '#1f1a14', halo: 'rgba(255,255,255,0.9)' },
  light: { ink: '#f0ebff', line: '#f5f0ff', halo: 'rgba(10,8,30,0.85)' },
};

// DK/Eyewitness-style annotation layer: labels in the margins, leader lines
// running into the picture. Everything is measured first: the margins fit
// the labels, a label that wraps is split into even lines, labels stack
// without overlapping, and the canvas grows (symmetrically, so the decal
// stays centred on the work) until nothing is cut off.
export function calloutDecal(callouts, artW, artH, { style = 'dark', reserve = 0, gap: frameGap = 0.12 } = {}) {
  const st = CALLOUT[style] || CALLOUT.dark;
  const fontM = Math.min(0.2, Math.max(0.11, 0.06 + 0.028 * Math.max(artW, artH)));
  const maxLine = Math.max(0.85, Math.min(1.4, fontM * 8.5));
  const probe = makeCanvas(8, 8).getContext('2d');
  const PPM = 200;
  const fontFor = (ppm) => `italic 500 ${Math.round(fontM * ppm)}px ${FONT.serif}`;
  probe.font = fontFor(PPM);
  const width = (t) => probe.measureText(t).width / PPM;
  const wrap = (text) => {
    const words = String(text).trim().split(/\s+/);
    if (width(words.join(' ')) <= maxLine || words.length < 2) return [words.join(' ')];
    // Two even lines if they fit, else greedy lines.
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ');
      const b = words.slice(i).join(' ');
      const w = Math.max(width(a), width(b));
      if (!best || w < best.w) best = { w, lines: [a, b] };
    }
    if (best.w <= maxLine) return best.lines;
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > maxLine) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };

  const lineH = fontM * 1.16;
  const gap = fontM * 0.5;
  const left = [];
  const right = [];
  for (const co of [...callouts].sort((a, b) => a.u - b.u)) {
    if (co.u < 0.42) left.push(co);
    else if (co.u > 0.58) right.push(co);
    else (left.length <= right.length ? left : right).push(co);
  }
  // Stack one side: each label centred on its point where possible, pushed
  // down past the one above, and the whole stack lifted if it runs too low.
  const stack = (list, isLeft) => {
    const items = list
      .sort((a, b) => a.v - b.v)
      .map((co) => {
        const lines = wrap(co.t);
        return { co, lines, h: lines.length * lineH, w: Math.max(...lines.map(width)) };
      });
    let prev = -Infinity;
    for (const it of items) {
      it.y = Math.max(it.co.v * artH - it.h / 2, prev + gap);
      prev = it.y + it.h;
    }
    const floor = artH - (isLeft ? 0 : reserve);
    const over = prev - floor;
    if (items.length && over > 0) for (const it of items) it.y -= over;
    return items;
  };
  const L = stack(left, true);
  const R = stack(right, false);
  const all = [...L, ...R];
  const lead = 0.34;
  // Labels start clear of the frame, which sits in front of this layer.
  const margin = Math.max(0.3, ...all.map((it) => it.w + lead + frameGap));
  const top = Math.max(0, ...all.map((it) => -it.y));
  const bottom = Math.max(0, ...all.map((it) => it.y + it.h - artH));
  const padY = 0.12 + Math.max(top, bottom);
  const W = artW + margin * 2;
  const H = artH + padY * 2;
  const scale = Math.min(PPM, 4096 / W, 4096 / H);
  const c = makeCanvas(Math.ceil(W * scale), Math.ceil(H * scale));
  const ctx = c.getContext('2d');
  ctx.font = fontFor(scale);
  ctx.textBaseline = 'middle';
  const X = (m) => m * scale;
  const Y = (m) => (padY + m) * scale;
  const lw = Math.max(2, 0.011 * scale);
  for (const [items, isLeft] of [[L, true], [R, false]]) {
    const edge = isLeft ? margin - frameGap : margin + artW + frameGap;
    for (const { co, lines, h, y } of items) {
      const tx = X(margin + co.u * artW);
      const ty = Y(co.v * artH);
      const ay = Y(y + h / 2);
      const ax = X(isLeft ? edge + 0.05 : edge - 0.05);
      const elbow = X(isLeft ? edge + 0.15 : edge - 0.15);
      for (const [color, w] of [[st.halo, lw * 3.2], [st.line, lw]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(elbow, ay);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
      ctx.fillStyle = st.halo;
      ctx.beginPath();
      ctx.arc(tx, ty, 0.03 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = st.line;
      ctx.beginPath();
      ctx.arc(tx, ty, 0.018 * scale, 0, Math.PI * 2);
      ctx.fill();
      // Labels sit flush against their leader line; a soft halo keeps them
      // legible over busy walls.
      ctx.textAlign = isLeft ? 'right' : 'left';
      lines.forEach((line, i) => {
        const ly = Y(y + (i + 0.5) * lineH);
        ctx.lineWidth = lw * 2.4;
        ctx.strokeStyle = st.halo;
        ctx.strokeText(line, X(edge), ly);
        ctx.fillStyle = st.ink;
        ctx.fillText(line, X(edge), ly);
      });
    }
  }
  return { texture: toTexture(c), width: W, height: H };
}
