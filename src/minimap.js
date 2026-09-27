// The minimap: the room you're in, from above. Its floors (the level you're
// on bright, others faint, flights of steps striped), walls and obstacles at
// your level, its works (in the room's accent), its doors (faint when they're
// on another level), and you.
import * as THREE from 'three';

const at = new THREE.Vector3();

export function drawMinimap(ctx, room, player, accent) {
  const S = ctx.canvas.width;
  const b = room.wrap ? { type: 'rect', x0: player.x - 60, x1: player.x + 60, z0: player.z - 60, z1: player.z + 60 } : room.bounds;
  const [minX, maxX, minZ, maxZ] = b.type === 'circle' ? [b.x - b.r, b.x + b.r, b.z - b.r, b.z + b.r] : [b.x0, b.x1, b.z0, b.z1];
  const pad = S * 0.1;
  const scale = (S - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  const ox = S / 2 - ((minX + maxX) / 2) * scale;
  const oz = S / 2 - ((minZ + maxZ) / 2) * scale;
  const X = (x) => ox + x * scale;
  const Z = (z) => oz + z * scale;
  ctx.clearRect(0, 0, S, S);
  const levelOf = (f) => (f.type === 'helix' ? player.y : f.ramp ? Math.max(f.ramp.h0, f.ramp.h1) : f.h ?? 0);
  const floors = [...room.floors].sort((a, c) => Math.abs(levelOf(c) - player.y) - Math.abs(levelOf(a) - player.y));
  for (const f of floors) {
    const near = Math.abs(levelOf(f) - player.y) < 1.5 || (f.ramp && player.y >= Math.min(f.ramp.h0, f.ramp.h1) - 0.5 && player.y <= Math.max(f.ramp.h0, f.ramp.h1) + 0.5);
    ctx.fillStyle = near ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    if (f.type === 'rect') ctx.rect(X(f.x0), Z(f.z0), (f.x1 - f.x0) * scale, (f.z1 - f.z0) * scale);
    else if (f.type === 'circle') ctx.arc(X(f.x), Z(f.z), f.r * scale, 0, Math.PI * 2);
    else {
      const a0 = f.type === 'sector' ? f.a0 : 0;
      const a1 = f.type === 'sector' ? f.a0 + f.span : Math.PI * 2;
      ctx.arc(X(f.x), Z(f.z), f.r1 * scale, a0, a1);
      ctx.arc(X(f.x), Z(f.z), f.r0 * scale, a1, a0, true);
      ctx.closePath();
    }
    ctx.fill();
    if (f.ramp) {
      ctx.strokeStyle = 'rgba(40,32,24,0.25)';
      ctx.lineWidth = S * 0.006;
      const steps = 8;
      for (let i = 1; i < steps; i++) {
        ctx.beginPath();
        if (f.ramp.axis === 'z') {
          const z = f.z0 + ((f.z1 - f.z0) * i) / steps;
          ctx.moveTo(X(f.x0), Z(z));
          ctx.lineTo(X(f.x1), Z(z));
        } else {
          const x = f.x0 + ((f.x1 - f.x0) * i) / steps;
          ctx.moveTo(X(x), Z(f.z0));
          ctx.lineTo(X(x), Z(f.z1));
        }
        ctx.stroke();
      }
    }
  }
  ctx.strokeStyle = 'rgba(40,32,24,0.55)';
  ctx.lineWidth = S * 0.012;
  ctx.beginPath();
  if (b.type === 'circle') ctx.arc(X(b.x), Z(b.z), b.r * scale, 0, Math.PI * 2);
  else ctx.rect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * scale, (b.z1 - b.z0) * scale);
  ctx.stroke();
  ctx.fillStyle = 'rgba(40,32,24,0.12)';
  for (const o of room.obstacles) {
    if (o.y0 !== undefined && (player.y < o.y0 || player.y > o.y1)) continue;
    ctx.beginPath();
    if (o.type === 'circle') ctx.arc(X(o.x), Z(o.z), o.r * scale, 0, Math.PI * 2);
    else if (o.type === 'rect') ctx.rect(X(o.x0), Z(o.z0), (o.x1 - o.x0) * scale, (o.z1 - o.z0) * scale);
    ctx.fill();
  }
  ctx.fillStyle = accent;
  for (const m of room.artworks) {
    m.getWorldPosition(at);
    ctx.fillRect(X(at.x) - S * 0.018, Z(at.z) - S * 0.018, S * 0.036, S * 0.036);
  }
  ctx.strokeStyle = '#c9a24c';
  ctx.lineWidth = S * 0.03;
  for (const p of room.portals) {
    ctx.globalAlpha = Math.abs(p.pos.y - player.y) < 1.5 ? 1 : 0.3;
    const tx = p.normal.z * (p.w / 2);
    const tz = -p.normal.x * (p.w / 2);
    ctx.beginPath();
    ctx.moveTo(X(p.pos.x - tx), Z(p.pos.z - tz));
    ctx.lineTo(X(p.pos.x + tx), Z(p.pos.z + tz));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const px = X(player.x);
  const pz = Z(player.z);
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(-player.yaw);
  ctx.fillStyle = '#1d1a16';
  ctx.beginPath();
  ctx.moveTo(0, -S * 0.05);
  ctx.lineTo(S * 0.032, S * 0.035);
  ctx.lineTo(-S * 0.032, S * 0.035);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
