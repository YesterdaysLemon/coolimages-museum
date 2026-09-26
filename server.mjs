// Static server for the museum app. In production Caddy serves /content/ from
// the VPS content directory; locally this server also serves ./content.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.');
const buildSha = (await readFile('build-sha.txt', 'utf8').catch(() => 'local')).trim();
const indexHtml = await readFile(path.join(root, 'index.html'), 'utf8');

// Allow exactly the inline import map by hash; everything else must be a file.
// Browsers hash inline scripts after normalizing CRLF to LF, so do the same.
const importMap = (indexHtml.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] ?? '').replace(/\r\n?/g, '\n');
const importMapHash = createHash('sha256').update(importMap).digest('base64');
const csp = [
  "default-src 'self'",
  `script-src 'self' https://cdn.jsdelivr.net 'sha256-${importMapHash}'`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' https://coolimages-media.alirezaafshan.com",
  "connect-src 'self' https://cdn.jsdelivr.net",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
};
const allowed = [/^\/src\/[\w-]+\.js$/, /^\/data\/[\w-]+\.json$/, /^\/content\/[\w-]+\.json$/, /^\/content\/art\/[\w-]+(\.sheet|\.sm)?\.(jpg|png|webp|mp4)$/, /^\/robots\.txt$/];

http
  .createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, app: 'coolimages', sha: buildSha }));
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '/index.html') rel = '/index.html';
    else if (!allowed.some((re) => re.test(rel))) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not on display. Return to /');
      return;
    }
    try {
      const file = path.join(root, rel);
      const info = await stat(file);
      const body = rel === '/index.html' ? Buffer.from(indexHtml) : await readFile(file);
      const ext = path.extname(file);
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      res.setHeader('Content-Length', body.length);
      res.setHeader('Last-Modified', info.mtime.toUTCString());
      res.setHeader('Cache-Control', rel.startsWith('/content/art/') ? 'public, max-age=604800' : 'no-cache');
      res.setHeader('Accept-Ranges', 'bytes');
      if (ext === '.html') res.setHeader('Content-Security-Policy', csp);
      // Video elements fetch in byte ranges (Caddy does this in production).
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        if (start > end || start >= body.length) {
          res.writeHead(416, { 'Content-Range': `bytes */${body.length}` });
          res.end();
          return;
        }
        res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`);
        res.setHeader('Content-Length', end - start + 1);
        res.writeHead(206);
        res.end(req.method === 'HEAD' ? undefined : body.subarray(start, end + 1));
        return;
      }
      res.writeHead(200);
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not on display. Return to /');
    }
  })
  .listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0', () => {
    console.log(`coolimages museum listening (sha ${buildSha})`);
  });
