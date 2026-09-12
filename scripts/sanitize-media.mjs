#!/usr/bin/env node
// Standalone entry point for the same sanitizer used by upload/generation.
// Never overwrite the input or an existing output. Does not load .env.
import { constants } from 'node:fs';
import { open, realpath, unlink } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { sanitizeMedia } from '../packages/worker/dist/media-sanitizer.js';

const [sourceArgument, outputArgument, ...extra] = process.argv.slice(2);
if (!sourceArgument || !outputArgument || extra.length) {
  console.error('Usage: node scripts/sanitize-media.mjs <input.jpg|png|mp4> <new-output.png|mp4>');
  process.exitCode = 2;
} else {
  try {
    const source = resolve(sourceArgument), output = resolve(outputArgument);
    const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4' };
    const mime = types[extname(source).toLowerCase()];
    if (!mime || source === output || extname(output).toLowerCase() !== (mime === 'video/mp4' ? '.mp4' : '.png')
      || await realpath(source) !== source) throw new Error('Invalid paths or formats');
    const reader = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes;
    try {
      const before = await reader.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size > (mime === 'video/mp4' ? 256 : 20) * 1024 * 1024)
        throw new Error('Invalid source');
      bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        const read = await reader.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) throw new Error('Source changed');
        offset += read.bytesRead;
      }
      const after = await reader.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
        throw new Error('Source changed');
    } finally { await reader.close(); }
    const clean = await sanitizeMedia(bytes, mime);
    const writer = await open(output, 'wx', 0o600);
    let completed = false;
    try { await writer.writeFile(clean.bytes); await writer.sync(); completed = true; }
    finally { await writer.close(); if (!completed) await unlink(output); }
    console.log(JSON.stringify({ sanitized: true, mimeType: clean.mimeType, bytes: clean.bytes.length,
      externalProvenanceErased: false, sourceUnchanged: true }));
  } catch {
    console.error('Sanitization failed. No original fallback; existing files are not overwritten.');
    process.exitCode = 1;
  }
}
