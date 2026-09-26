// coolimages-media: the museum's videos, served from R2 (binding MEDIA) at
// https://coolimages-media.alirezaafshan.com/<name>.mp4 with edge caching,
// byte ranges and CORS for the museum.
//
// It also keeps the bucket in step with the public site: every 6 hours (cron)
// and on POST /sync (tools/publish_content.py calls it after publishing) it
// reads the public manifest, copies in any video the site lists that the
// bucket lacks (from the site's own /content/art/), and deletes anything the
// site no longer lists, so takedowns and withheld works leave R2 too.
//
// On the Workers free plan this Worker stops at 100,000 requests a day; the
// museum then shows its "the server is super poor" notice instead of videos.
const SITE = 'https://coolimages.alirezaafshan.com';
const ORIGINS = new Set([SITE, 'http://localhost:8173', 'http://127.0.0.1:8173', 'http://localhost:8080']);
const NAME = /^\/([\w-]+(?:\.[0-9a-f]{8})?\.mp4)$/;
const CACHE = 'public, max-age=86400';

function withCors(req, headers) {
  const origin = req.headers.get('Origin');
  if (origin && ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  }
  headers.append('Vary', 'Origin');
  return headers;
}

// Straight from R2, honouring a Range header.
async function fromBucket(req, env, name) {
  const obj = await env.MEDIA.get(name, { range: req.headers, onlyIf: req.headers });
  if (!obj) return new Response('Not in the collection', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Content-Type', 'video/mp4');
  headers.set('Cache-Control', CACHE);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('ETag', obj.httpEtag);
  if (!('body' in obj)) return new Response(null, { status: 304, headers });
  const r = obj.range;
  if (r && req.headers.has('Range')) {
    const start = 'suffix' in r ? obj.size - r.suffix : r.offset;
    const length = 'suffix' in r ? r.suffix : (r.length ?? obj.size - start);
    headers.set('Content-Range', `bytes ${start}-${start + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

async function serve(req, env, ctx, name) {
  const cache = caches.default;
  const key = `https://coolimages-media.alirezaafshan.com/${name}`;
  const ranged = (r) => new Request(key, { headers: r.headers.has('Range') ? { Range: r.headers.get('Range') } : {} });
  let res = await cache.match(ranged(req));
  if (!res) {
    // First viewer at this edge: cache the whole file, then answer the range
    // from the cache; if the cache can't help, answer from R2 directly.
    const whole = await fromBucket(new Request(key), env, name);
    if (whole.status !== 200) return whole;
    await cache.put(key, whole);
    res = (await cache.match(ranged(req))) || (await fromBucket(req, env, name));
  }
  return res;
}

async function sync(env) {
  const res = await fetch(`${SITE}/content/manifest.json`, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) return { ok: false, reason: `manifest ${res.status}` };
  const manifest = await res.json();
  const wanted = new Set();
  for (const item of manifest.items || []) {
    const name = item.video?.split('/').pop();
    if (name && NAME.test(`/${name}`)) wanted.add(name);
  }
  const have = new Set();
  let cursor;
  do {
    const page = await env.MEDIA.list({ cursor });
    for (const o of page.objects) have.add(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const added = [];
  const failed = [];
  for (const name of wanted) {
    if (have.has(name)) continue;
    const src = await fetch(`${SITE}/content/art/${name}`);
    if (!src.ok) {
      failed.push(`${name} (${src.status})`);
      continue;
    }
    await env.MEDIA.put(name, src.body, { httpMetadata: { contentType: 'video/mp4', cacheControl: CACHE } });
    added.push(name);
  }
  const removed = [...have].filter((k) => !wanted.has(k));
  if (removed.length) await env.MEDIA.delete(removed);
  return { ok: failed.length === 0, videos: wanted.size, added, removed, failed };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') {
      const headers = withCors(req, new Headers({ 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Max-Age': '86400' }));
      return new Response(null, { status: 204, headers });
    }
    if (url.pathname === '/sync' && req.method === 'POST') return Response.json(await sync(env));
    const m = NAME.exec(url.pathname);
    if (!m || !['GET', 'HEAD'].includes(req.method)) return new Response('Not on display. The museum is at ' + SITE, { status: 404 });
    const res = await serve(req, env, ctx, m[1]);
    const out = new Response(req.method === 'HEAD' ? null : res.body, res);
    withCors(req, out.headers);
    return out;
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sync(env));
  },
};
