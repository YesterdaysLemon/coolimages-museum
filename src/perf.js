// Frame timing, for finding what makes a frame late: how long each part of
// the frame took, what happened in it (a door's preview drawn, a texture
// uploaded, shaders compiled, a room's grid built), and the recent slow
// frames with their causes. `?perf` shows a readout; `museum.perf` has the
// numbers (and `bench()`, which runs frames back to back, waiting for the GPU
// after each, for checks in a hidden browser pane).
const SLOW_MS = 25;

export function makePerf(renderer, { show = false } = {}) {
  const parts = new Map(); // name -> { total, max, n }
  const times = new Float32Array(600); // recent frame times, ms
  let count = 0;
  let frame = null; // { t0, parts: {}, events: [] }
  let pending = []; // what happened between frames, for the next one
  const slow = []; // the latest slow frames
  const info = renderer.info;
  let programs = 0;
  let textures = 0;
  let last = 0; // the previous frame's time, ms
  let hud = null;
  let hudAt = 0;

  function note(event) {
    (frame ? frame.events : pending).push(event);
  }

  const perf = {
    begin() {
      frame = { t0: performance.now(), parts: {}, events: pending };
      pending = [];
      // (Anything compiled or uploaded between frames isn't this frame's.)
      programs = info.programs?.length || 0;
      textures = info.memory.textures;
    },
    // Time `fn` as part `name` of this frame.
    time(name, fn) {
      const t = performance.now();
      try {
        return fn();
      } finally {
        const ms = performance.now() - t;
        const p = parts.get(name) || { total: 0, max: 0, n: 0 };
        p.total += ms;
        p.max = Math.max(p.max, ms);
        p.n++;
        parts.set(name, p);
        if (frame) frame.parts[name] = (frame.parts[name] || 0) + ms;
      }
    },
    note,
    get last() {
      return last;
    },
    end() {
      if (!frame) return;
      const ms = performance.now() - frame.t0;
      // Shaders compiled and textures uploaded this frame.
      const nowPrograms = info.programs?.length || 0;
      if (nowPrograms > programs) note(`compiled ${nowPrograms - programs}`);
      programs = nowPrograms;
      if (info.memory.textures > textures) note(`textures +${info.memory.textures - textures}`);
      textures = info.memory.textures;
      times[count++ % times.length] = ms;
      last = ms;
      if (ms > SLOW_MS) {
        const top = Object.entries(frame.parts)
          .filter(([, v]) => v > 1)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} ${v.toFixed(1)}`);
        slow.push({ ms: +ms.toFixed(1), parts: top, events: frame.events });
        if (slow.length > 40) slow.shift();
      }
      frame = null;
      if (hud && performance.now() - hudAt > 500) {
        hudAt = performance.now();
        hud.textContent = perf.summary();
      }
    },
    // Frame time percentiles over the recent frames, per-part averages and
    // worsts, the slow frames, and what the renderer holds.
    stats() {
      const n = Math.min(count, times.length);
      const sorted = Array.from(times.subarray(0, n)).sort((a, b) => a - b);
      const at = (q) => +(sorted[Math.min(n - 1, Math.floor(q * n))] || 0).toFixed(1);
      const byPart = {};
      for (const [k, p] of parts) byPart[k] = { avg: +(p.total / p.n).toFixed(2), max: +p.max.toFixed(1), n: p.n };
      return {
        frames: n,
        p50: at(0.5),
        p95: at(0.95),
        p99: at(0.99),
        max: at(1),
        slow: slow.length,
        parts: byPart,
        recentSlow: slow.slice(-12),
        renderer: { calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length, textures: info.memory.textures, geometries: info.memory.geometries },
      };
    },
    summary() {
      const s = perf.stats();
      const last = s.recentSlow[s.recentSlow.length - 1];
      return [
        `frame p50 ${s.p50}  p95 ${s.p95}  p99 ${s.p99}  max ${s.max} ms`,
        `draw calls ${s.renderer.calls}  tris ${(s.renderer.triangles / 1000).toFixed(0)}k  tex ${s.renderer.textures}  progs ${s.renderer.programs}`,
        ...Object.entries(s.parts).map(([k, p]) => `${k.padEnd(10)} ${String(p.avg).padStart(6)} avg ${String(p.max).padStart(6)} max`),
        last ? `slow: ${last.ms} ms  ${last.parts.join(', ')}  ${last.events.join(', ')}` : '',
      ].join('\n');
    },
    reset() {
      parts.clear();
      count = 0;
      slow.length = 0;
    },
  };
  if (show) {
    hud = document.createElement('pre');
    hud.id = 'perf';
    Object.assign(hud.style, { position: 'fixed', left: '8px', bottom: '8px', zIndex: 50, margin: 0, padding: '6px 8px', font: '11px/1.35 ui-monospace, monospace', color: '#fff', background: 'rgba(0,0,0,0.6)', pointerEvents: 'none', whiteSpace: 'pre' });
    document.body.appendChild(hud);
  }
  return perf;
}
