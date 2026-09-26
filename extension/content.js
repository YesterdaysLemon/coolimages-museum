// Runs on x.com. When you right-click or click inside a post, tell the
// background which post it was and which picture or video you touched, so a
// download that follows can be traced back to it.
(() => {
  const STATUS = /\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/;
  const mediaKey = (src) => String(src || '').match(/pbs\.twimg\.com\/media\/([A-Za-z0-9_-]+)/)?.[1] || null;
  const videoId = (poster) => String(poster || '').match(/(?:amplify_video_thumb|ext_tw_video_thumb)\/(\d+)\//)?.[1] || null;
  let last = { key: '', at: 0 };

  function postFor(target) {
    const article = target.closest('article');
    let status = null;
    if (article) {
      // The post's permalink is the link around its timestamp. A quoted post
      // inside has no such link, so this is the outer post; the background
      // checks the quoted one too.
      const link = article.querySelector('a[href*="/status/"] time')?.closest('a');
      const m = link?.getAttribute('href')?.match(STATUS);
      if (m) status = { handle: m[1], id: m[2] };
    }
    if (!status) {
      const m = location.pathname.match(STATUS);
      if (m) status = { handle: m[1], id: m[2] };
    }
    if (!status) return null;
    const scope = article || document;
    const names = scope.querySelector('[data-testid="User-Name"]')?.innerText?.split('\n') || [];
    return {
      statusId: status.id,
      handle: status.handle,
      name: names[0] || '',
      text: scope.querySelector('[data-testid="tweetText"]')?.innerText || '',
      postedAt: scope.querySelector('time')?.getAttribute('datetime') || null,
    };
  }

  function report(e) {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const post = postFor(t);
    if (!post) return;
    const img = t.closest('img') || t.closest('[data-testid="tweetPhoto"]')?.querySelector('img');
    const video = t.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]')?.querySelector('video') || (t.tagName === 'VIDEO' ? t : null);
    const msg = {
      type: 'seen',
      ...post,
      mediaKey: mediaKey(img?.src),
      videoId: videoId(video?.poster),
      alt: img?.alt || '',
      page: location.href,
    };
    const key = `${msg.statusId}|${msg.mediaKey}|${msg.videoId}`;
    if (key === last.key && Date.now() - last.at < 1500) return;
    last = { key, at: Date.now() };
    try {
      chrome.runtime.sendMessage(msg);
    } catch {
      // The extension was reloaded; this page's script is stale until refresh.
    }
  }

  document.addEventListener('contextmenu', report, true);
  document.addEventListener('click', report, true);

  // Toasts from the background: what a save just did. Drawn in a shadow root
  // so X's styles can't reach them.
  let shelf = null;
  function ensureShelf() {
    if (shelf?.isConnected) return shelf;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:24px;bottom:24px;z-index:2147483647;pointer-events:none';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .t{display:flex;gap:10px;align-items:center;min-width:min(240px,calc(100vw - 48px));max-width:min(360px,calc(100vw - 48px));box-sizing:border-box;margin-top:8px;padding:10px 14px 10px 12px;
        border-radius:12px;background:#1d1a16;color:#fbfaf6;box-shadow:0 10px 30px rgba(0,0,0,.35);border-left:4px solid var(--c);
        font:14px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;opacity:0;transform:translateY(8px);transition:opacity .25s,transform .25s}
      .t.in{opacity:1;transform:none}
      .t b{display:block;font:500 15px/1.3 Georgia,'Times New Roman',serif;letter-spacing:.01em}
      .t span{display:block;color:#d9d2c4;font-size:13px}
      svg{flex:none;width:30px;height:18px}
      @media (prefers-reduced-motion: reduce){.t{transition:none}}
    </style><div class="stack"></div>`;
    document.documentElement.append(host);
    shelf = root.querySelector('.stack');
    return shelf;
  }
  const TONES = { ok: '#7bc79f', dupe: '#e3a75d', warn: '#f08a80' };
  function showToast({ title, detail, tone = 'ok' }) {
    const stack = ensureShelf();
    const t = document.createElement('div');
    t.className = 't';
    t.style.setProperty('--c', TONES[tone] || TONES.ok);
    t.innerHTML = '<svg viewBox="0 0 60 36" aria-hidden="true"><path d="M3 18Q30-6 57 18Q30 42 3 18Z" fill="#fbfaf6"/><circle cx="30" cy="18" r="9" fill="#2f8a7c"/><circle cx="30" cy="18" r="4" fill="#08090b"/></svg><div><b></b><span></span></div>';
    t.querySelector('b').textContent = title;
    t.querySelector('span').textContent = detail || '';
    stack.append(t);
    while (stack.children.length > 3) stack.firstElementChild.remove();
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 300);
    }, 4200);
  }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'toast') showToast(msg);
  });
})();
