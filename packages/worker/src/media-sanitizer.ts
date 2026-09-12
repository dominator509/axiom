import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type SanitizableMime = 'image/jpeg' | 'image/png' | 'video/mp4';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Only use on a freshly encoded PNG, never as a substitute for decoding input.
 * Allowlisting pixel chunks also excludes unknown ancillary metadata and caBX.
 */
export function cleanEncodedPng(bytes: Buffer): Buffer {
  if (!bytes.subarray(0, 8).equals(PNG)) throw new Error('Invalid sanitized PNG');
  const chunks: Buffer[] = [PNG];
  let offset = 8, header = false, pixels = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > bytes.length) throw new Error('Truncated sanitized PNG');
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (!header && kind !== 'IHDR') throw new Error('Missing PNG header');
    if (kind === 'IHDR') {
      if (header || length !== 13 || ![2, 6].includes(bytes[offset + 17]!)) throw new Error('Unsupported PNG pixels');
      header = true;
    } else if (kind === 'IDAT') pixels = true;
    else if (kind === 'IEND') {
      if (length !== 0 || !pixels) throw new Error('Invalid PNG end');
      chunks.push(bytes.subarray(offset, end));
      return Buffer.concat(chunks); // Never retain a trailer.
    } else if (kind[0] === kind[0]?.toUpperCase()) throw new Error('Unknown critical PNG chunk');
    if (kind === 'IHDR' || kind === 'IDAT') chunks.push(bytes.subarray(offset, end));
    offset = end;
  }
  throw new Error('Missing PNG end');
}

/** Freshly encoded, nonfragmented MP4 only. Erase metadata payloads in place
 * so absolute media offsets remain valid. No input boxes are copied here.
 */
export function cleanEncodedMp4(bytes: Buffer): Buffer {
  const out = Buffer.from(bytes);
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf']);
  const structural = new Set(['ftyp', 'mdat', 'mvhd', 'tkhd', 'mdhd', 'hdlr', 'vmhd', 'smhd',
    'elst', 'stts', 'stsc', 'stsz', 'stco', 'co64', 'ctts', 'stss', 'sdtp', 'sgpd', 'sbgp',
    'avcC', 'esds', 'pasp', 'colr']);
  let media = false, movie = false;
  function walk(start: number, end: number, depth: number) {
    if (depth > 10) throw new Error('Invalid MP4 nesting');
    let offset = start;
    while (offset < end) {
      if (offset + 8 > end) throw new Error('Truncated MP4 box');
      let size = out.readUInt32BE(offset), header = 8;
      if (size === 1) {
        if (offset + 16 > end) throw new Error('Truncated MP4 extended size');
        const large = out.readBigUInt64BE(offset + 8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Oversized MP4 box');
        size = Number(large); header = 16;
      } else if (size === 0) size = end - offset;
      if (size < header || offset + size > end) throw new Error('Invalid MP4 size');
      const kind = out.toString('ascii', offset + 4, offset + 8);
      if (depth === 0 && kind === 'mdat') media = true;
      if (depth === 0 && kind === 'moov') movie = true;
      if (['uuid', 'meta', 'udta', 'free', 'skip', 'btrt'].includes(kind)) {
        out.write('free', offset + 4, 4, 'ascii');
        out.fill(0, offset + header, offset + size);
      } else if (containers.has(kind)) walk(offset + header, offset + size, depth + 1);
      else if (kind === 'stsd' || kind === 'dref') {
        if (size < header + 8) throw new Error('Truncated MP4 entries');
        walk(offset + header + 8, offset + size, depth + 1);
      } else if (kind === 'avc1') {
        if (header !== 8 || size < 86) throw new Error('Invalid AVC sample entry');
        out.fill(0, offset + 50, offset + 82); // Compressor name, not pixels.
        walk(offset + 86, offset + size, depth + 1);
      } else if (kind === 'mp4a') {
        if (header !== 8 || size < 36 || out.readUInt16BE(offset + 16) !== 0) throw new Error('Unsupported audio entry');
        walk(offset + 36, offset + size, depth + 1);
      } else if (kind === 'url ') {
        if (size !== 12 || out.readUInt32BE(offset + 8) !== 1) throw new Error('External media reference');
      } else if (!structural.has(kind)) throw new Error('Unverified MP4 output box');
      if (kind === 'hdlr') {
        if (size < header + 24) throw new Error('Invalid MP4 handler');
        out.fill(0, offset + header + 24, offset + size);
      }
      if (['mvhd', 'tkhd', 'mdhd'].includes(kind)) {
        const times = out[offset + header] === 1 ? 16 : 8;
        if (size < header + 4 + times) throw new Error('Invalid MP4 timestamps');
        out.fill(0, offset + header + 4, offset + header + 4 + times);
      }
      offset += size;
    }
  }
  walk(0, out.length, 0);
  if (!movie || !media || out.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Invalid sanitized MP4');
  return out;
}

function run(command: string, args: string[], cwd: string, timeout = 300_000): Promise<string> {
  // Do not pass provider credentials or application environment to decoders.
  const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].flatMap(key =>
    process.env[key] ? [[key, process.env[key]!]] : []));
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, env, windowsHide: true, timeout, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 },
      (error, stdout) => error ? reject(new Error('Media sanitization failed; no sanitized file released')) : resolve(stdout));
  });
}

/** Rebuild only decoded pixels/audio, removing source container metadata,
 * credentials, attachments and chapters. Visible watermarks are not edited.
 * This does not erase external provenance or promise fingerprint anonymity.
 */
export async function sanitizeMedia(bytes: Buffer, mimeType: SanitizableMime): Promise<{ bytes: Buffer; mimeType: 'image/png' | 'video/mp4' }> {
  const video = mimeType === 'video/mp4';
  const limit = (video ? 256 : 20) * 1024 * 1024;
  if (!['image/jpeg', 'image/png', 'video/mp4'].includes(mimeType) || bytes.length < 12 || bytes.length > limit)
    throw new Error('Unsupported sanitizer input');
  const directory = await mkdtemp(join(tmpdir(), 'axiom-sanitize-'));
  try {
    const input = join(directory, video ? 'input.mp4' : mimeType === 'image/jpeg' ? 'input.jpg' : 'input.png');
    const output = join(directory, video ? 'output.mp4' : 'output.png');
    // A PNG may carry arbitrary bytes after IEND. Do not let an image-pipe
    // demuxer interpret that trailer as another frame.
    if (mimeType === 'image/png' && bytes.subarray(0, 8).equals(PNG)) {
      let offset = 8;
      while (offset + 12 <= bytes.length) {
        const end = offset + bytes.readUInt32BE(offset) + 12;
        if (end > bytes.length) throw new Error('Truncated input PNG');
        if (bytes.toString('ascii', offset + 4, offset + 8) === 'IEND') { bytes = bytes.subarray(0, end); break; }
        offset = end;
      }
    }
    await writeFile(input, bytes, { flag: 'wx', mode: 0o600 });
    const format = video ? 'mov' : mimeType === 'image/jpeg' ? 'jpeg_pipe' : 'png_pipe';
    const decoder: string[] = [];
    const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-f', format,
      ...decoder, '-show_streams', '-show_format', '-of', 'json', input], directory, 15_000)) as {
        streams?: Array<{ codec_type: string; width?: number; height?: number; channels?: number; disposition?: { attached_pic?: number } }>;
        format?: { duration?: string };
      };
    const streams = probe.streams ?? [], pictures = streams.filter(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
    const picture = pictures[0];
    if (pictures.length !== 1 || !picture?.width || !picture.height || picture.width > 8192 || picture.height > 8192
      || picture.width * picture.height > 40_000_000 || streams.filter(s => s.codec_type === 'audio').length > 8
      || streams.some(s => (s.channels ?? 0) > 8)
      || (video && (!Number.isFinite(Number(probe.format?.duration)) || Number(probe.format?.duration) <= 0 || Number(probe.format?.duration) > 600)))
      throw new Error('Media exceeds sanitizer decoding limits');
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-n', '-max_alloc', '268435456', '-threads', '2',
      '-protocol_whitelist', 'file', '-f', format, ...decoder, '-i', input,
      '-map', '0:V:0', ...(video ? ['-map', '0:a?'] : []), '-sn', '-dn',
      '-map_metadata', '-1', '-map_metadata:s', '-1', '-map_chapters', '-1',
      '-fflags', '+bitexact', '-flags:v', '+bitexact', '-threads', '2',
      ...(video ? ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-bsf:v', 'filter_units=remove_types=6', '-c:a', 'aac', '-flags:a', '+bitexact', '-f', 'mp4']
        : ['-frames:v', '1', '-c:v', 'png', '-pix_fmt', 'rgba', '-f', 'image2']),
      '-fs', String(limit + 1), output], directory);
    const info = await stat(output);
    if (!info.isFile() || info.size < 12 || info.size > limit) throw new Error('Sanitized output exceeds limit');
    const encoded = await readFile(output);
    const cleaned = video ? cleanEncodedMp4(encoded) : cleanEncodedPng(encoded);
    // Verify the actual cleaned bytes still decode, not merely FFmpeg's input.
    await writeFile(output, cleaned, { mode: 0o600 });
    if (video) {
      const checked = JSON.parse(await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file',
        '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', output], directory, 15_000)) as {
        format?: { duration?: string }; streams?: Array<{ codec_type: string }>;
      };
      const duration = Number(checked.format?.duration);
      if (!Number.isFinite(duration) || Math.abs(duration - Number(probe.format?.duration)) > 0.2
        || checked.streams?.filter(s => s.codec_type === 'audio').length !== streams.filter(s => s.codec_type === 'audio').length)
        throw new Error('Sanitization changed media duration or lost audio');
    }
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file', '-i', output,
      '-map', '0:v:0', ...(video ? ['-map', '0:a?'] : []), '-f', 'null', '-'], directory, 60_000);
    return { bytes: cleaned, mimeType: video ? 'video/mp4' : 'image/png' };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
