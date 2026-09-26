// Coolimages Collector: when a picture or video from X is saved into the
// coolimages folder (or through "Save to coolimages"), write a note <id>.json
// with the post it came from. With the native helper installed
// (host/install.ps1) notes and saves go straight into the coolimages folder;
// without it they go through downloads into Downloads/coolimages-inbox, and
// tools/ingest_inbox.py moves them into the folder.
import { INBOX, parseMedia, syndicationUrl, findMedia, mediaOf, describePost, describeFromPage, sidecar, candidates, statusFromUrl } from './lib.js';

const RECENT_MS = 15 * 60 * 1000;
const HOST = 'com.coolimages.collector';

// The native helper, if installed; null when it isn't.
async function native(msg) {
  try {
    return await chrome.runtime.sendNativeMessage(HOST, msg);
  } catch {
    return null;
  }
}
const X_PAGES = ['https://x.com/*', 'https://twitter.com/*', 'https://mobile.x.com/*'];

// ------------------------------------------------------------ memory
// Posts you recently right-clicked or clicked into, from content.js.
async function recentSeen() {
  const { seen = [] } = await chrome.storage.session.get('seen');
  return seen.filter((s) => Date.now() - s.at < RECENT_MS);
}
async function remember(entry) {
  const list = (await recentSeen()).filter((s) => !(s.statusId === entry.statusId && s.mediaKey === entry.mediaKey && s.videoId === entry.videoId));
  list.unshift(entry);
  await chrome.storage.session.set({ seen: list.slice(0, 40) });
}

const posts = new Map();
async function fetchPost(id) {
  if (posts.has(id)) return posts.get(id);
  let tweet = null;
  try {
    const r = await fetch(syndicationUrl(id));
    if (r.ok) {
      const j = await r.json();
      if (j?.__typename === 'Tweet') tweet = j;
    }
  } catch {}
  posts.set(id, tweet);
  return tweet;
}

// Which post a download came from, and how sure we are:
// exact = the post's own media list contains this file; page = what the
// page showed where you right-clicked this media; nearby = a post you were
// just looking at; none = nothing to go on.
async function resolve(media, referrer) {
  const seen = await recentSeen();
  for (const id of candidates(seen, media, referrer)) {
    const tweet = await fetchPost(id);
    const hit = tweet && findMedia(tweet, media);
    if (hit) return { post: describePost(hit.tweet, hit.detail), match: 'exact' };
  }
  const direct = seen.find((s) => (media.kind === 'image' && s.mediaKey === media.key) || (media.videoId && s.videoId === media.videoId));
  if (direct) return { post: describeFromPage(direct), match: 'page' };
  const fromReferrer = statusFromUrl(referrer);
  const near = seen.find((s) => s.statusId === fromReferrer?.id) || seen[0];
  if (near) return { post: describeFromPage(near), match: 'nearby' };
  return { post: null, match: 'none' };
}

async function writeSidecar(id, data) {
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(`${JSON.stringify(data, null, 2)}\n`)}`;
  await chrome.downloads.download({ url, filename: `${INBOX}/${id}.json`, conflictAction: 'overwrite', saveAs: false });
}

// A small note on the X page itself, so you know what a save did.
async function toast(tabId, t) {
  if (tabId == null) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tabId = tab?.id;
  }
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, { type: 'toast', ...t }).catch(() => {});
}

function fromLine(post, match) {
  if (!post) return 'Couldn\u2019t find the post it came from';
  if (match === 'exact' || match === 'page') return `From @${post.author.handle}\u2019s post`;
  return `Probably from @${post.author.handle}\u2019s post (not confirmed)`;
}

async function logSave(entry) {
  const { log = [] } = await chrome.storage.local.get('log');
  log.unshift(entry);
  await chrome.storage.local.set({ log: log.slice(0, 30) });
  chrome.action.setBadgeBackgroundColor({ color: entry.dup ? '#a8661c' : '#1f7a52' });
  chrome.action.setBadgeText({ text: entry.dup ? '=' : entry.match === 'exact' ? '✓' : '?' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
}

// --------------------------------------------------------- downloads
chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.error?.current === 'USER_CANCELED') {
    const [gone] = await chrome.downloads.search({ id: delta.id });
    if (gone?.url.startsWith('data:')) chrome.storage.local.set({ promptTrouble: true });
    return;
  }
  if (delta.state?.current !== 'complete') return;
  const [item] = await chrome.downloads.search({ id: delta.id });
  if (!item) return;
  if (item.url.startsWith('data:')) {
    // Our own notes: keep the file, drop the line from the downloads list. A
    // note saved anywhere but the inbox means the browser asked where to save.
    if (/coolimages-inbox/i.test(item.filename || '')) chrome.downloads.erase({ id: item.id });
    else chrome.storage.local.set({ promptTrouble: true });
    return;
  }
  const media = parseMedia(item.finalUrl || item.url) || parseMedia(item.url);
  if (!media) return;
  const { folder = 'coolimages' } = await chrome.storage.local.get('folder');
  const path = item.filename || '';
  const watched = path.toLowerCase().includes(folder.toLowerCase()) || /[\\/]coolimages-inbox[\\/]/i.test(path);
  if (!watched) return;
  const file = path.split(/[\\/]/).pop();
  const id = file.replace(/\.[^.]+$/, '');
  const { post, match } = await resolve(media, item.referrer);
  const data = sidecar({ id, file, media, mediaUrl: item.finalUrl || item.url, post, match, savedAt: new Date().toISOString() });
  // Straight beside the file when the helper can; otherwise via the inbox.
  const wrote = await native({ type: 'note', savedPath: path, note: data });
  if (!wrote?.ok) await writeSidecar(id, data);
  await logSave({ ...logEntry(id, media, post, match), dup: wrote?.duplicate || null });
  const tabId = (await recentSeen()).find((s) => s.tabId != null)?.tabId;
  if (wrote?.duplicate) toast(tabId, { tone: 'dupe', title: 'Already in coolimages', detail: `Same picture as ${wrote.duplicate}. This copy was set aside in _duplicates.` });
  else if (wrote?.ok) toast(tabId, { tone: 'ok', title: 'Saved to coolimages', detail: fromLine(post, match) });
  else toast(tabId, { tone: 'ok', title: 'Saved to coolimages', detail: `${fromLine(post, match)} \u00b7 note waiting in the inbox` });
});

function logEntry(id, media, post, match) {
  return { id, kind: media.kind, thumb: media.kind === 'image' ? `https://pbs.twimg.com/media/${media.key}?format=jpg&name=thumb` : '', handle: post?.author.handle || '', url: post?.url || '', match, at: Date.now() };
}

// ------------------------------------------------------ saving from X
// With the helper, the file and its note go straight into the folder;
// without it, the file downloads into the inbox and the listener above
// writes its note when it finishes.
// Returns what happened: saved, duplicate (already in the folder, by name
// or by picture), inbox (no helper; the download listener notes it), or error.
async function saveToInbox(item, referrer, tabId) {
  const media = { kind: item.kind, key: item.key, videoId: null };
  const { post, match } = item.post ? { post: item.post, match: 'exact' } : await resolve(media, referrer);
  const note = sidecar({ id: item.key, file: `${item.key}.${item.ext}`, media, mediaUrl: item.url, post, match, savedAt: new Date().toISOString() });
  const done = await native({ type: 'save', url: item.url, name: `${item.key}.${item.ext}`, note });
  if (done?.ok) {
    await logSave({ ...logEntry(item.key, media, post, match), dup: done.duplicate || null });
    if (done.duplicate) {
      toast(tabId, { tone: 'dupe', title: 'Already in coolimages', detail: `Same picture as ${done.duplicate}; not saved again.` });
      return { status: 'duplicate', name: done.duplicate };
    }
    toast(tabId, { tone: 'ok', title: 'Saved to coolimages', detail: fromLine(post, match) });
    return { status: 'saved' };
  }
  if (done && !done.ok) {
    toast(tabId, { tone: 'warn', title: 'Couldn\u2019t save that', detail: done.reason || 'The helper refused it.' });
    return { status: 'error', reason: done.reason };
  }
  await chrome.downloads.download({ url: item.url, filename: `${INBOX}/${item.key}.${item.ext}`, conflictAction: 'uniquify', saveAs: false });
  return { status: 'inbox' };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'save-image', title: 'Save to coolimages', contexts: ['image'], documentUrlPatterns: X_PAGES, targetUrlPatterns: ['https://pbs.twimg.com/media/*'] });
    chrome.contextMenus.create({ id: 'save-post', title: 'Save this post’s media to coolimages', contexts: ['page', 'link', 'video'], documentUrlPatterns: X_PAGES });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-image') {
    const media = parseMedia(info.srcUrl);
    if (!media) return;
    const ext = media.format === 'png' ? 'png' : 'jpg';
    await saveToInbox({ kind: 'image', url: `https://pbs.twimg.com/media/${media.key}?format=${ext}&name=orig`, key: media.key, ext }, info.pageUrl, tab?.id);
    return;
  }
  if (info.menuItemId === 'save-post') {
    // The post under the pointer (content.js reports it just before the menu
    // opens), else the post in the address bar.
    const seen = await recentSeen();
    const id = (Date.now() - (seen[0]?.at || 0) < 5000 && seen[0]?.statusId) || statusFromUrl(info.linkUrl)?.id || statusFromUrl(info.pageUrl)?.id;
    if (!id) return;
    const tweet = await fetchPost(id);
    if (!tweet) return;
    const wanted = seen[0]?.statusId === id && (seen[0].videoId || seen[0].mediaKey);
    const all = mediaOf(tweet);
    const pick = wanted ? all.filter((m) => m.kind === 'video' || m.key === seen[0].mediaKey) : all;
    for (const m of pick.length ? pick : all) {
      const hit = findMedia(tweet, m);
      await saveToInbox({ ...m, post: hit ? describePost(hit.tweet, hit.detail) : null }, info.pageUrl, tab?.id);
    }
  }
});

// ------------------------------------------------------------ messages
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'seen') {
    remember({ ...msg, at: Date.now(), tabId: sender.tab?.id ?? null });
    return false;
  }
  if (msg?.type === 'post') {
    fetchPost(msg.id).then((tweet) => reply(tweet ? { post: describePost(tweet), media: mediaOf(tweet) } : null));
    return true;
  }
  if (msg?.type === 'save') {
    const m = msg.item;
    fetchPost(m.postId).then((tweet) => {
      const hit = tweet && findMedia(tweet, m);
      return saveToInbox({ ...m, post: hit ? describePost(hit.tweet, hit.detail) : null });
    }).then((result) => reply(result));
    return true;
  }
  if (msg?.type === 'check') {
    native({ type: 'check', url: msg.item.url, name: `${msg.item.key}.${msg.item.ext}` }).then((res) => reply(res));
    return true;
  }
  if (msg?.type === 'host') {
    native({ type: 'ping' }).then((res) => reply(res));
    return true;
  }
  return false;
});
