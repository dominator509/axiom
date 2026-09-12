import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanEncodedMp4, cleanEncodedPng, sanitizeMedia } from './media-sanitizer.js';

function box(kind: string, value: Buffer) {
  const header = Buffer.alloc(8); header.writeUInt32BE(value.length + 8); header.write(kind, 4);
  return Buffer.concat([header, value]);
}
function pngChunk(kind: string, value: Buffer) {
  const payload = Buffer.concat([Buffer.from(kind), value]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4), footer = Buffer.alloc(4);
  header.writeUInt32BE(value.length); footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, payload, footer]);
}
it('erases C2PA uuid, nested metadata and unused box payloads without shifting video offsets', () => {
  const original = Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('uuid', Buffer.from('c2pa credentials')),
    box('moov', box('udta', Buffer.from('private location'))), box('mdat', Buffer.from('pixel data'))]);
  const clean = cleanEncodedMp4(original);
  expect(clean.length).toBe(original.length);
  expect(clean.includes(Buffer.from('c2pa'))).toBe(false);
  expect(clean.includes(Buffer.from('private'))).toBe(false);
  expect(clean.indexOf('pixel data')).toBe(original.indexOf('pixel data'));
  expect(original.includes(Buffer.from('c2pa'))).toBe(true);
});
it('rejects truncated and malformed containers', () => {
  expect(() => cleanEncodedMp4(Buffer.from('malformed'))).toThrow();
  expect(() => cleanEncodedPng(Buffer.from('malformed'))).toThrow();
});
it.each(['image', 'jpeg', 'video'] as const)('rebuilds real %s media and removes injected provenance', async kind => {
  const root = await mkdtemp(join(tmpdir(), 'axiom-sanitizer-test-'));
  try {
    const path = join(root, kind === 'video' ? 'original.mp4' : kind === 'jpeg' ? 'original.jpg' : 'original.png');
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:r=10',
      ...(kind !== 'video' ? ['-frames:v', '1', '-c:v', kind === 'jpeg' ? 'mjpeg' : 'png', '-threads', '1']
        : ['-f', 'lavfi', '-i', 'sine=frequency=400:sample_rate=44100', '-t', '0.5', '-c:v', 'libx264', '-c:a', 'aac', '-metadata', 'comment=private-location']), path], { windowsHide: true });
    let bytes = await readFile(path);
    if (kind === 'video') bytes = Buffer.concat([bytes, box('uuid', Buffer.from('c2pa-private-credentials'))]);
    else if (kind === 'image') bytes = Buffer.concat([bytes.subarray(0, 33),
      pngChunk('caBX', Buffer.from('c2pa-private-credentials')), pngChunk('tEXt', Buffer.from('Author\0private-name')),
      bytes.subarray(33), Buffer.from('private-trailer-c2pa')]);
    else bytes = Buffer.concat([bytes.subarray(0, 2), Buffer.from([255, 235, 0, 14]), Buffer.from('c2pa-private'), bytes.subarray(2)]);
    const result = await sanitizeMedia(bytes, kind === 'video' ? 'video/mp4' : kind === 'jpeg' ? 'image/jpeg' : 'image/png');
    expect(result.bytes.includes(Buffer.from('private'))).toBe(false);
    expect(result.bytes.includes(Buffer.from('c2pa'))).toBe(false);
    expect(result.mimeType).toBe(kind === 'video' ? 'video/mp4' : 'image/png');
    if (kind !== 'video') {
      expect(cleanEncodedPng(result.bytes)).toEqual(result.bytes);
      const output = join(root, 'clean.png'); await writeFile(output, result.bytes);
      const pixels = (file: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { windowsHide: true });
      expect(pixels(output)).toEqual(pixels(path));
      if (kind === 'image') {
        const dirty = join(root, 'dirty.png'), cliOutput = join(root, 'cli.png');
        await writeFile(dirty, bytes);
        const cli = fileURLToPath(new URL('../../../scripts/sanitize-media.mjs', import.meta.url));
        const run = () => execFileSync(process.execPath, [cli, dirty, cliOutput], { windowsHide: true, stdio: 'pipe' });
        expect(JSON.parse(run().toString())).toMatchObject({ sanitized: true, sourceUnchanged: true });
        expect(await readFile(cliOutput)).toEqual(result.bytes);
        expect(() => run()).toThrow();
        expect(await readFile(dirty)).toEqual(bytes);
        expect(await readFile(cliOutput)).toEqual(result.bytes);
      }
    } else expect(cleanEncodedMp4(result.bytes)).toEqual(result.bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
it('fails closed on malformed media rather than returning the original', async () => {
  await expect(sanitizeMedia(Buffer.alloc(24), 'image/png')).rejects.toThrow();
});
