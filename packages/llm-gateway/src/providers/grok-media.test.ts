import { mkdtemp, mkdir, rm, writeFile, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GrokMediaResult } from './grok-media.js';

describe('official Grok media result contract', () => {
  let root: string;
  const session = 'session-fixture';
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'axiom-media-result-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const use = (name = 'image_gen', id = 'call-1') => JSON.stringify({ type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input: {} }] } });
  const result = (path: string, type = 'ImageGen', id = 'call-1') => JSON.stringify({ type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: false,
      content: JSON.stringify({ type, path }) }] } });
  async function file(folder = 'images', name = '1.jpg', bytes = Buffer.from([255, 216, 255, ...Array(13).fill(0)])) {
    const directory = join(root, session, folder);
    await mkdir(directory, { recursive: true });
    const path = join(directory, name);
    await writeFile(path, bytes);
    return path;
  }
  it('accepts a correlated typed image result and validates its session file', async () => {
    const path = await file();
    const collector = new GrokMediaResult('image');
    collector.accept(use());
    collector.accept(result(path));
    await expect(collector.artifact(root, session)).resolves.toEqual({ path, mimeType: 'image/jpeg', byteLength: 16 });
  });
  it('accepts typed video results separately', async () => {
    const path = await file('videos', '1.mp4', Buffer.from([0, 0, 0, 16, ...Buffer.from('ftypisom'), 0, 0, 0, 0]));
    const collector = new GrokMediaResult('video');
    collector.accept(use('image_to_video'));
    collector.accept(result(path, 'ImageToVideo'));
    await expect(collector.artifact(root, session)).resolves.toMatchObject({ mimeType: 'video/mp4' });
  });
  it('never treats assistant prose as a successful artifact', async () => {
    const collector = new GrokMediaResult('image');
    collector.accept(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Image generated at /tmp/a.jpg' }] } }));
    await expect(collector.artifact(root, session)).rejects.toMatchObject({ status: 502 });
  });
  it('rejects an orphan result', () => {
    expect(() => new GrokMediaResult('image').accept(result('/tmp/a.jpg'))).toThrow();
  });
  it.each(['wrong-id', 'wrong-type', 'quota', 'duplicate'])('rejects %s tool results', (caseName) => {
    const collector = new GrokMediaResult('image');
    collector.accept(use());
    const line = caseName === 'wrong-id' ? result('/tmp/a.jpg', 'ImageGen', 'other-call')
      : caseName === 'wrong-type' || caseName === 'quota' ? result('/tmp/a.jpg', 'Text') : result('/tmp/a.jpg');
    if (caseName === 'duplicate') collector.accept(line);
    expect(() => collector.accept(line)).toThrow();
  });
  it('rejects additional or unexpected tool calls', () => {
    expect(() => new GrokMediaResult('image').accept(use('use_tool'))).toThrow();
    const collector = new GrokMediaResult('image');
    collector.accept(use());
    expect(() => collector.accept(use('image_gen', 'call-2'))).toThrow();
  });
  it.each(['other-session', 'profile-file', 'outside', 'invalid-header', 'hardlink'])('rejects %s artifacts', async (caseName) => {
    let path = await file();
    if (caseName === 'profile-file') path = join(root, 'auth.json');
    if (caseName === 'outside') path = join(root, '..', session, 'images', '1.jpg');
    if (caseName === 'invalid-header') await writeFile(path, 'not an image file');
    if (caseName === 'hardlink') await link(path, join(root, 'linked.jpg'));
    const collector = new GrokMediaResult('image');
    collector.accept(use()); collector.accept(result(path));
    await expect(collector.artifact(root, caseName === 'other-session' ? 'other' : session)).rejects.toBeDefined();
  });
});
