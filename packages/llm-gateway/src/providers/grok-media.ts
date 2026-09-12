import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { ProviderError } from './types.js';

export type GrokMediaKind = 'image' | 'video';
export interface GrokMediaArtifact {
  path: string;
  mimeType: 'image/jpeg' | 'image/png' | 'video/mp4';
  byteLength: number;
}

function invalid(): never {
  throw new ProviderError('Grok did not return a valid generated media artifact', 502, 'grok');
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

// Official headless Messages wire: assistant tool_use -> user tool_result,
// with the typed ToolOutput serialized as JSON in tool_result.content.
// Source: xai-org/grok-build 37949780, headless/reducer/messages + acp_conversion.
export class GrokMediaResult {
  private callId: string | undefined;
  private artifactPath: string | undefined;
  constructor(private readonly kind: GrokMediaKind) {}

  accept(line: string): void {
    let value: Record<string, unknown> | undefined;
    try { value = object(JSON.parse(line)); } catch { return; }
    const message = object(value?.message);
    if (!Array.isArray(message?.content)) return;
    for (const raw of message.content) {
      const block = object(raw);
      if (value?.type === 'assistant' && block?.type === 'tool_use') {
        if (this.callId || typeof block.id !== 'string' || !block.id
          || block.name !== (this.kind === 'image' ? 'image_gen' : 'image_to_video')) invalid();
        this.callId = block.id;
      }
      if (value?.type === 'user' && block?.type === 'tool_result') {
        if (!this.callId || block.tool_use_id !== this.callId || block.is_error !== false
          || this.artifactPath || typeof block.content !== 'string') invalid();
        let result: Record<string, unknown> | undefined;
        try { result = object(JSON.parse(block.content)); } catch { invalid(); }
        if (result?.type !== (this.kind === 'image' ? 'ImageGen' : 'ImageToVideo')
          || typeof result.path !== 'string') invalid();
        this.artifactPath = result.path;
      }
    }
  }

  async artifact(profile: string, sessionId: string): Promise<GrokMediaArtifact> {
    if (!this.artifactPath || !isAbsolute(this.artifactPath)) invalid();
    const root = await realpath(profile);
    const candidate = resolve(this.artifactPath);
    const local = relative(root, candidate);
    const parts = local.split(sep);
    // Only the current fresh UUID session's numbered media files can be read.
    // Do not open arbitrary profile files (including auth material).
    const folder = this.kind === 'image' ? 'images' : 'videos';
    const namePattern = this.kind === 'image' ? /^[1-9]\d*\.(jpg|png)$/ : /^[1-9]\d*\.mp4$/;
    if (isAbsolute(local) || parts.includes('..') || !parts.includes(sessionId)
      || basename(dirname(candidate)) !== folder || !namePattern.test(basename(candidate))) invalid();
    // Reject symbolic links/junctions, including intermediate directories.
    if (await realpath(candidate) !== candidate) invalid();
    const handle = await open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      const limit = this.kind === 'image' ? 20 * 1024 * 1024 : 256 * 1024 * 1024;
      if (!stat.isFile() || stat.nlink !== 1 || stat.size < 12 || stat.size > limit) invalid();
      const header = Buffer.alloc(12);
      await handle.read(header, 0, header.length, 0);
      let mimeType: GrokMediaArtifact['mimeType'];
      if (this.kind === 'video' && header.toString('ascii', 4, 8) === 'ftyp') mimeType = 'video/mp4';
      else if (this.kind === 'image' && header.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) mimeType = 'image/jpeg';
      else if (this.kind === 'image' && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mimeType = 'image/png';
      else invalid();
      return { path: candidate, mimeType, byteLength: stat.size };
    } finally { await handle.close(); }
  }
}
