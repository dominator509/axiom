#!/usr/bin/env node
// Credential-free runtime rehearsal. Only generated temporary media is used.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { sanitizeMedia } from '../packages/worker/dist/media-sanitizer.js';

if (process.argv.length !== 3 || process.argv[2] !== '--isolated-fixture') {
  console.error('Usage: node scripts/rehearse-media-sanitizer.mjs --isolated-fixture');
  process.exit(2);
}
const root = await mkdtemp(join(tmpdir(), 'axiom-sanitizer-rehearsal-'));
try {
  const results = [];
  for (const kind of ['png', 'jpeg', 'mp4']) {
    const input = join(root, `input.${kind}`);
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10',
      ...(kind === 'mp4'
        ? ['-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '0.5', '-c:v', 'libx264', '-c:a', 'aac', '-metadata', 'comment=fixture-private-marker']
        : ['-frames:v', '1', '-c:v', kind === 'jpeg' ? 'mjpeg' : 'png', '-threads', '1']), input], { stdio: 'pipe' });
    const original = await readFile(input);
    const source = Buffer.concat([original, ...(kind === 'png' ? [Buffer.from('fixture-private-marker')] : [])]);
    const clean = await sanitizeMedia(source, kind === 'mp4' ? 'video/mp4' : kind === 'jpeg' ? 'image/jpeg' : 'image/png');
    assert.equal(clean.bytes.includes(Buffer.from('fixture-private-marker')), false);
    assert.equal(clean.exactFileHashChanged, !createHash('sha256').update(source).digest()
      .equals(createHash('sha256').update(clean.bytes).digest()));
    assert.deepEqual(await readFile(input), original);
    if (kind === 'png') {
      const second = await sanitizeMedia(clean.bytes, 'image/png');
      assert.deepEqual(second.bytes, clean.bytes);
      assert.equal(second.exactFileHashChanged, false);
    }
    results.push({ kind, sanitized: true, exactFileHashChanged: clean.exactFileHashChanged });
  }
  console.log(JSON.stringify({ platform: process.platform, node: process.version, results, providerRequests: 0 }));
} finally {
  await rm(root, { recursive: true, force: true });
}
