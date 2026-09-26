// Write collector notes for works saved before the extension existed, where
// src/credits.js already links the X post. Each post is checked against X's
// embed endpoint: a note is only written if the post really contains the
// saved file (match "exact"). Existing notes are left alone.
//
// Usage: node tools/backfill_notes.mjs [--dry-run]
// Environment: COOLIMAGES_DIR (default ~/OneDrive/Pictures/coolimages).
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CREDITS } from '../src/credits.js';
import { statusFromUrl, syndicationUrl, findMedia, describePost, sidecar } from '../extension/lib.js';

const folder = process.env.COOLIMAGES_DIR || join(homedir(), 'OneDrive', 'Pictures', 'coolimages');
const dry = process.argv.includes('--dry-run');
const files = readdirSync(folder);
let written = 0;
for (const [id, credit] of Object.entries(CREDITS)) {
  const status = statusFromUrl(credit.sourceUrl);
  const file = files.find((f) => f.replace(/\.[^.]+$/, '') === id && !f.endsWith('.json'));
  if (!status || !file) continue;
  const notePath = join(folder, `${id}.json`);
  if (existsSync(notePath)) continue;
  const media = file.endsWith('.mp4') ? { kind: 'video', key: id, videoId: null } : { kind: 'image', key: id };
  const tweet = await fetch(syndicationUrl(status.id)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const hit = tweet?.__typename === 'Tweet' ? findMedia(tweet, media) : null;
  if (!hit) {
    console.log(`skip ${id}: post ${status.id} doesn't carry this file`);
    continue;
  }
  const post = describePost(hit.tweet, hit.detail);
  const note = sidecar({ id, file, media, mediaUrl: media.kind === 'image' ? `https://pbs.twimg.com/media/${id}?format=jpg&name=orig` : null, post, match: 'exact', savedAt: null });
  console.log(`${dry ? 'would write' : 'wrote'} ${id}.json <- @${post.author.handle}`);
  if (!dry) writeFileSync(notePath, `${JSON.stringify(note, null, 2)}\n`);
  written++;
}
console.log(`${written} notes ${dry ? 'to write' : 'written'}`);
