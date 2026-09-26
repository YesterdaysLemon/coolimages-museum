import { statusFromUrl } from './lib.js';

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k != null));
  return n;
};
const MATCH = { exact: 'traced', page: 'likely', nearby: 'guessed', none: 'unknown' };

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

async function showPost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const status = statusFromUrl(tab?.url);
  if (!status) return;
  const data = await chrome.runtime.sendMessage({ type: 'post', id: status.id });
  if (!data) {
    $('#post-empty').textContent = 'X won’t share this post’s details (it may be age-restricted). Right-click its pictures and use Save to coolimages instead.';
    return;
  }
  $('#post-empty').hidden = true;
  const head = $('#post-head');
  head.hidden = false;
  head.replaceChildren(el('b', { textContent: data.post.author.name || `@${data.post.author.handle}` }), ` @${data.post.author.handle}`);
  const grid = $('#media');
  if (!data.media.length) {
    grid.replaceChildren(el('p', { className: 'muted', textContent: 'No pictures or videos in this post.' }));
    return;
  }
  grid.replaceChildren(
    ...data.media.map((m) => {
      const btn = el('button', { type: 'button', textContent: 'Save to coolimages' });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Saving…';
        await chrome.runtime.sendMessage({ type: 'save', item: m });
        btn.textContent = 'Saved';
      });
      return el('figure', {}, el('img', { src: m.thumb, alt: m.alt || '' }), m.kind === 'video' ? el('span', { className: 'kind', textContent: 'video' }) : null, btn);
    }),
  );
}

async function showLog() {
  const { log = [] } = await chrome.storage.local.get('log');
  $('#log-empty').hidden = log.length > 0;
  $('#log').replaceChildren(
    ...log.slice(0, 8).map((e) => {
      const who = e.url ? el('a', { href: e.url, target: '_blank', textContent: e.handle ? `@${e.handle}` : 'post' }) : el('span', { textContent: 'post not found' });
      return el(
        'li',
        {},
        e.thumb ? el('img', { className: 'thumb', src: e.thumb, alt: '' }) : el('span', { className: 'thumb' }),
        el('div', { className: 'who' }, who, el('small', { textContent: `${e.id} · ${ago(e.at)}` })),
        el('span', { className: `badge ${e.match}`, textContent: MATCH[e.match] || e.match }),
      );
    }),
  );
}

async function setupFolder() {
  const input = $('#folder');
  const { folder = 'coolimages' } = await chrome.storage.local.get('folder');
  input.value = folder;
  input.addEventListener('change', () => chrome.storage.local.set({ folder: input.value.trim() || 'coolimages' }));
}

async function showMode() {
  const host = await chrome.runtime.sendMessage({ type: 'host' });
  $('#mode').textContent = host?.ok
    ? `Helper installed: saves and notes go straight into ${host.folder}.`
    : 'No helper: notes and "Save to coolimages" go to Downloads\\coolimages-inbox, and the pipeline moves them into the folder.';
  const { promptTrouble } = await chrome.storage.local.get('promptTrouble');
  $('#tip').hidden = !promptTrouble || !!host?.ok;
}

showPost();
showLog();
showMode();
setupFolder();
