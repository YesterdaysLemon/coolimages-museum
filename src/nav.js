// A navigation grid for a room: where the alligator can stand, and how to
// get from one place to another, stairs and ramps included.
//
// Cells are 0.5 m. A cell can hold several nodes at different heights (a
// balcony over a hall, the spiral ramp passing over itself); each is a place
// his body fits (walkable() with his clearance) and his head and tail have
// room to swing (nothing faceAhead() within BODY, all round). Neighbouring
// nodes connect when the step between them is walkable, so a balcony edge
// stays an edge while a flight of stairs joins two floors. Routes are A* over
// the nodes, then pulled straight wherever a straight line is walkable.
const CELL = 0.5;
const PAD = 0.75;
const STEP = 0.45;
const BODY = 1.0; // room all round a node
const ROOMY = 1.5; // room all round where he chooses to stop
const DIRS = Array.from({ length: 12 }, (_, i) => [Math.cos((i * Math.PI) / 6), Math.sin((i * Math.PI) / 6)]);

// A binary min-heap of (priority, value).
function heap() {
  const p = [];
  const v = [];
  const swap = (i, j) => {
    [p[i], p[j]] = [p[j], p[i]];
    [v[i], v[j]] = [v[j], v[i]];
  };
  return {
    get size() {
      return p.length;
    },
    push(pri, val) {
      p.push(pri);
      v.push(val);
      for (let i = p.length - 1; i > 0; ) {
        const up = (i - 1) >> 1;
        if (p[up] <= p[i]) break;
        swap(i, up);
        i = up;
      }
    },
    pop() {
      const top = v[0];
      const lp = p.pop();
      const lv = v.pop();
      if (p.length) {
        p[0] = lp;
        v[0] = lv;
        for (let i = 0; ; ) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < p.length && p[l] < p[m]) m = l;
          if (r < p.length && p[r] < p[m]) m = r;
          if (m === i) break;
          swap(i, m);
          i = m;
        }
      }
      return top;
    },
  };
}

export function buildNav(room, { walkable, heightsAt, faceAhead = null }) {
  const open = (x, z, y, r) => !faceAhead || DIRS.every(([ux, uz]) => !faceAhead(room, x, z, y, ux, uz, r));
  const b = room.bounds;
  const [x0, x1, z0, z1] = b.type === 'circle' ? [b.x - b.r, b.x + b.r, b.z - b.r, b.z + b.r] : [b.x0, b.x1, b.z0, b.z1];
  const ni = Math.ceil((x1 - x0) / CELL);
  const nj = Math.ceil((z1 - z0) / CELL);
  const key = (i, j) => i * 100000 + j;
  // Every place his body fits...
  const fits = [];
  const fitCells = new Map();
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      const x = x0 + (i + 0.5) * CELL;
      const z = z0 + (j + 0.5) * CELL;
      const here = [];
      for (const h of heightsAt(room, x, z)) {
        const y = walkable(room, x, z, PAD, h);
        if (y === null || here.some((n) => Math.abs(n.y - y) < 0.2)) continue;
        const n = { x, z, y, i, j, nbrs: [], comp: -1, roomy: undefined };
        here.push(n);
        fits.push(n);
      }
      if (here.length) fitCells.set(key(i, j), here);
    }
  }
  // ...that also has room for his head and tail. Anything he'd put his head
  // into is within BODY of a place he doesn't fit; so where every cell out to
  // BODY holds a fit at about the same height, there's nothing to look for.
  const R = Math.ceil(BODY / CELL);
  const surrounded = (n) => {
    for (let di = -R; di <= R; di++) {
      for (let dj = -R; dj <= R; dj++) {
        const list = fitCells.get(key(n.i + di, n.j + dj));
        const reach = 0.2 + 0.35 * Math.max(Math.abs(di), Math.abs(dj));
        if (!list || !list.some((m) => Math.abs(m.y - n.y) < reach)) return false;
      }
    }
    return true;
  };
  const nodes = [];
  const cells = new Map(); // i,j -> node indices
  for (const n of fits) {
    if (!surrounded(n) && !open(n.x, n.z, n.y, BODY)) continue;
    const k = key(n.i, n.j);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(nodes.length);
    nodes.push(n);
  }
  // Links: to the 8 neighbours, if the step (and the ground halfway) holds.
  for (const n of nodes) {
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        for (const k of cells.get(key(n.i + di, n.j + dj)) || []) {
          const m = nodes[k];
          if (Math.abs(m.y - n.y) > STEP) continue;
          const mid = walkable(room, (n.x + m.x) / 2, (n.z + m.z) / 2, PAD, (n.y + m.y) / 2);
          if (mid === null || Math.abs(mid - n.y) > STEP || Math.abs(mid - m.y) > STEP) continue;
          n.nbrs.push(k);
        }
      }
    }
  }
  // Connected parts, so he only ever picks somewhere he can get to.
  let comps = 0;
  for (let s = 0; s < nodes.length; s++) {
    if (nodes[s].comp >= 0) continue;
    const queue = [s];
    nodes[s].comp = comps;
    for (let q = 0; q < queue.length; q++) {
      for (const k of nodes[queue[q]].nbrs) {
        if (nodes[k].comp >= 0) continue;
        nodes[k].comp = comps;
        queue.push(k);
      }
    }
    comps++;
  }

  // The node nearest (x, z) at about height y.
  function nearest(x, z, y) {
    const ci = Math.floor((x - x0) / CELL);
    const cj = Math.floor((z - z0) / CELL);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= 4 && best < 0; r++) {
      for (let di = -r; di <= r; di++) {
        for (let dj = -r; dj <= r; dj++) {
          for (const k of cells.get(key(ci + di, cj + dj)) || []) {
            const n = nodes[k];
            const d = Math.hypot(n.x - x, n.z - z) + Math.abs(n.y - y) * 3;
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
        }
      }
    }
    return best;
  }

  // Can he walk straight from a to b? (Checked every 0.25 m, heights continuous.)
  function clear(a, b) {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / 0.25));
    let prev = a.y;
    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      const h = walkable(room, a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u, PAD, prev + (b.y - a.y) / steps);
      if (h === null || Math.abs(h - prev) > STEP) return false;
      prev = h;
    }
    return Math.abs(prev - b.y) < STEP;
  }

  // A* from node a to node b; the waypoints, pulled straight where possible.
  function route(a, b) {
    if (a < 0 || b < 0 || nodes[a].comp !== nodes[b].comp) return null;
    const g = new Map([[a, 0]]);
    const from = new Map();
    const open = heap();
    open.push(0, a);
    const h = (k) => Math.hypot(nodes[k].x - nodes[b].x, nodes[k].z - nodes[b].z, nodes[k].y - nodes[b].y);
    const closed = new Set();
    while (open.size) {
      const cur = open.pop();
      if (cur === b) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      const n = nodes[cur];
      for (const k of n.nbrs) {
        const m = nodes[k];
        const cost = g.get(cur) + Math.hypot(m.x - n.x, m.z - n.z, m.y - n.y);
        if (cost < (g.get(k) ?? Infinity)) {
          g.set(k, cost);
          from.set(k, cur);
          open.push(cost + h(k), k);
        }
      }
    }
    if (!from.has(b) && a !== b) return null;
    const chain = [b];
    while (chain[chain.length - 1] !== a) chain.push(from.get(chain[chain.length - 1]));
    chain.reverse();
    const pts = chain.map((k) => ({ x: nodes[k].x, z: nodes[k].z, y: nodes[k].y }));
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !clear(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  // Room all round node k for him to stop, turn and look about (worked out
  // when first asked).
  function roomy(k) {
    const n = nodes[k];
    if (n.roomy === undefined) n.roomy = open(n.x, n.z, n.y, ROOMY);
    return n.roomy;
  }

  // A random place he can reach from node a, at least minDist away, with room
  // to stop in if there is one; with `climb`, somewhere on another level if
  // there is one.
  function pick(a, { minDist = 3, climb = false } = {}) {
    if (a < 0) return -1;
    const here = nodes[a];
    const reachable = [];
    for (let k = 0; k < nodes.length; k++) if (nodes[k].comp === here.comp && Math.hypot(nodes[k].x - here.x, nodes[k].z - here.z) >= minDist) reachable.push(k);
    if (!reachable.length) return -1;
    const up = climb ? reachable.filter((k) => Math.abs(nodes[k].y - here.y) > 1) : [];
    const list = up.length ? up : reachable;
    for (let tries = 0; tries < 24; tries++) {
      const k = list[Math.floor(Math.random() * list.length)];
      if (roomy(k)) return k;
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  return { nodes, nearest, route, pick, clear, roomy, levels: new Set(nodes.map((n) => Math.round(n.y))).size };
}
