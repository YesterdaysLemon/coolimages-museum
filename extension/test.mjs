// node extension/test.mjs — checks the pure helpers, then real posts from the
// collection against X's embed endpoint (needs the network).
import assert from 'node:assert/strict';
import { parseMedia, statusFromUrl, syndicationUrl, findMedia, mediaOf, describePost, candidates, cleanText } from './lib.js';

assert.deepEqual(parseMedia('https://pbs.twimg.com/media/HRsJtzQWIAA24vx?format=jpg&name=large'), { kind: 'image', key: 'HRsJtzQWIAA24vx', format: 'jpg' });
assert.deepEqual(parseMedia('https://pbs.twimg.com/media/HS9Y32UWMAAWBb6.png'), { kind: 'image', key: 'HS9Y32UWMAAWBb6', format: 'png' });
assert.deepEqual(parseMedia('https://video.twimg.com/amplify_video/2011896804359786496/vid/avc1/1080x1080/4AzNhblWcUyL7tsq.mp4?tag=21'), { kind: 'video', key: '4AzNhblWcUyL7tsq', videoId: '2011896804359786496' });
assert.equal(parseMedia('https://video.twimg.com/tweet_video/GabcDEF.mp4').key, 'GabcDEF');
assert.equal(parseMedia('https://x.com/home'), null);
assert.equal(parseMedia('data:application/json,{}'), null);
assert.deepEqual(statusFromUrl('https://x.com/pleometric/status/2011896976959553814/photo/1'), { handle: 'pleometric', id: '2011896976959553814' });
assert.equal(cleanText('hello https://t.co/abc123'), 'hello');
const seen = [
  { statusId: '1', mediaKey: 'AAA' },
  { statusId: '2', mediaKey: 'BBB' },
];
assert.deepEqual(candidates(seen, { kind: 'image', key: 'BBB' }, 'https://x.com/a/status/3/photo/1'), ['2', '3', '1']);

const token = (id) => fetch(syndicationUrl(id)).then((r) => r.json());
const cases = [
  ['2011896976959553814', { kind: 'video', key: '4AzNhblWcUyL7tsq', videoId: null }, 'pleometric'],
  ['2101466993526439944', { kind: 'image', key: 'HSnottDbYAAsfeg' }, 'iniemohk'],
  ['2102761422950113344', { kind: 'image', key: 'HS56-LzXQAATNaF' }, 'PsychoMechanics'],
];
for (const [id, media, handle] of cases) {
  const tweet = await token(id);
  const hit = findMedia(tweet, media);
  assert.ok(hit, `media ${media.key} found in post ${id}`);
  const post = describePost(hit.tweet, hit.detail);
  assert.equal(post.author.handle.toLowerCase(), handle.toLowerCase());
  const saves = mediaOf(tweet);
  assert.ok(saves.some((m) => m.key === media.key), `mediaOf lists ${media.key}`);
  console.log(`ok  ${media.key} <- @${post.author.handle} ${post.postedAt} "${post.text.slice(0, 60)}"`);
}
console.log('all extension checks passed');
