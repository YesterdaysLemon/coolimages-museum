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
})();
