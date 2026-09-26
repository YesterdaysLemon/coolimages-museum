// Pure helpers for the Coolimages Collector (no browser APIs, so they can be
// tested in Node: `node extension/test.mjs`).

export const INBOX = 'coolimages-inbox';

// What a twimg URL points at. Photos are pbs.twimg.com/media/<key>; videos
// are video.twimg.com/(amplify_video|ext_tw_video)/<media id>/…/<stem>.mp4,
// and GIFs are video.twimg.com/tweet_video/<key>.mp4.
export function parseMedia(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname === 'pbs.twimg.com') {
    const m = u.pathname.match(/^\/media\/([A-Za-z0-9_-]+)(?:\.(\w+))?$/);
    if (!m) return null;
    return { kind: 'image', key: m[1], format: u.searchParams.get('format') || m[2] || 'jpg' };
  }
  if (u.hostname === 'video.twimg.com') {
    const file = u.pathname.split('/').pop() || '';
    if (!/\.mp4$/i.test(file)) return null;
    const videoId = u.pathname.match(/\/(?:amplify_video|ext_tw_video)\/(\d+)\//)?.[1] || null;
    return { kind: 'video', key: file.replace(/\.mp4$/i, ''), videoId };
  }
  return null;
}

// The numeric id of a post from any x.com/twitter.com status URL.
export function statusFromUrl(url) {
  const m = String(url || '').match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
  return m ? { handle: m[1], id: m[2] } : null;
}

// Token for the public embed endpoint (the same one embedded posts use).
export function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

export function syndicationUrl(id) {
  return `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${syndicationToken(id)}`;
}

// The post (or the post it quotes) that carries this media, and its entry.
export function findMedia(tweet, media) {
  for (const t of [tweet, tweet?.quoted_tweet].filter(Boolean)) {
    for (const d of t.mediaDetails || []) {
      if (media.kind === 'image' && d.media_url_https && d.media_url_https.includes(`/media/${media.key}.`)) return { tweet: t, detail: d };
      if (media.kind === 'video') {
        const variants = d.video_info?.variants || [];
        if ((media.videoId && d.id_str === media.videoId) || variants.some((v) => v.url.includes(`/${media.key}.mp4`))) return { tweet: t, detail: d };
      }
    }
  }
  return null;
}

// Every photo and video in a post, with the best file to download.
export function mediaOf(tweet) {
  const out = [];
  for (const t of [tweet, tweet?.quoted_tweet].filter(Boolean)) {
    for (const d of t.mediaDetails || []) {
      if (d.type === 'photo') {
        const m = d.media_url_https.match(/\/media\/([A-Za-z0-9_-]+)\.(\w+)$/);
        if (!m) continue;
        const format = m[2] === 'png' ? 'png' : 'jpg';
        out.push({ kind: 'image', key: m[1], thumb: `https://pbs.twimg.com/media/${m[1]}?format=${format}&name=small`, url: `https://pbs.twimg.com/media/${m[1]}?format=${format}&name=orig`, ext: format, alt: d.ext_alt_text || '', postId: t.id_str });
      } else {
        const best = bestVariant(d);
        if (!best) continue;
        const key = best.split('?')[0].split('/').pop().replace(/\.mp4$/i, '');
        out.push({ kind: 'video', key, thumb: d.media_url_https, url: best, ext: 'mp4', alt: d.ext_alt_text || '', postId: t.id_str });
      }
    }
  }
  return out;
}

export function bestVariant(detail) {
  const mp4 = (detail.video_info?.variants || []).filter((v) => v.content_type === 'video/mp4');
  mp4.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return mp4[0]?.url || null;
}

// The text of a post without the t.co link X appends for its media.
export function cleanText(text) {
  return String(text || '').replace(/(\s*https:\/\/t\.co\/\w+)+\s*$/, '').trim();
}

export function describePost(tweet, detail) {
  const handle = tweet.user?.screen_name || '';
  return {
    url: handle ? `https://x.com/${handle}/status/${tweet.id_str}` : `https://x.com/i/status/${tweet.id_str}`,
    id: tweet.id_str,
    postedAt: tweet.created_at || null,
    text: cleanText(tweet.text),
    lang: tweet.lang || null,
    sensitive: !!tweet.possibly_sensitive,
    author: { name: tweet.user?.name || '', handle, url: handle ? `https://x.com/${handle}` : '' },
    alt: detail?.ext_alt_text || '',
  };
}

// What the page itself showed, for posts the embed endpoint won't return.
export function describeFromPage(seen) {
  return {
    url: seen.handle ? `https://x.com/${seen.handle}/status/${seen.statusId}` : `https://x.com/i/status/${seen.statusId}`,
    id: seen.statusId,
    postedAt: seen.postedAt || null,
    text: cleanText(seen.text),
    lang: null,
    sensitive: false,
    author: { name: seen.name || '', handle: seen.handle || '', url: seen.handle ? `https://x.com/${seen.handle}` : '' },
    alt: seen.alt && seen.alt !== 'Image' ? seen.alt : '',
  };
}

// The sidecar written next to a save: plain JSON, one per file.
export function sidecar({ id, file, media, mediaUrl, post, match, savedAt }) {
  return {
    version: 1,
    id,
    file,
    kind: media.kind,
    mediaUrl,
    savedAt,
    match,
    post: post || null,
  };
}

// Candidate posts for a download, best first: ones where this exact media
// was right-clicked, the page it was saved from, then recent posts.
export function candidates(seen, media, referrer) {
  const ids = [];
  const add = (id) => id && !ids.includes(id) && ids.push(id);
  for (const s of seen) if ((media.kind === 'image' && s.mediaKey === media.key) || (media.kind === 'video' && media.videoId && s.videoId === media.videoId)) add(s.statusId);
  add(statusFromUrl(referrer)?.id);
  for (const s of seen.slice(0, 8)) add(s.statusId);
  return ids;
}
