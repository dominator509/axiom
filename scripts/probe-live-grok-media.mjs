// Explicit one-shot local provider probe. No .env, DB writes, publication or retries.
import assert from 'node:assert/strict';
import { constants, existsSync, readFileSync, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, fstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { OfficialSubscriptionTransport } from '../packages/llm-gateway/dist/providers/subscription.js';

const [authorization, userId, runId, kind, scannedImageHash] = process.argv.slice(2);
assert.equal(authorization, '--authorized-live-once');
assert.equal(process.platform, 'linux');
assert(/^[A-Za-z0-9]{16,80}$/.test(userId ?? ''));
assert(/^[a-z0-9-]{8,80}$/.test(runId ?? ''));
assert(['image', 'video'].includes(kind));
const runtime = parseEnv(readFileSync(new URL('../var/grok-runtime.env', import.meta.url), 'utf8'));
for (const key of ['AXIOM_GROK_CLI', 'AXIOM_GROK_VIDEO_CLI', 'AXIOM_GROK_IMAGE_LAUNCHER']) {
  assert(runtime[key]?.startsWith('/'), `${key} is required`);
  process.env[key] = runtime[key];
}
process.env.AXIOM_SUBSCRIPTION_HOME = '/home/doministic/.local/share/axiom-subscriptions';
process.env.AXIOM_LLM_TRANSPORT_TIMEOUT_MS = '300000';
const root = join('/home/doministic/.local/share/axiom-media-probes', runId);
mkdirSync(root, { recursive: true, mode: 0o700 });
const marker = join(root, `${kind}.dispatch.json`);
assert(!existsSync(marker), 'This attempt already dispatched; do not retry it');
const request = { userId, kind, aspectRatio: '1:1',
  prompt: kind === 'image'
    ? 'A small orange ceramic cube on a white pedestal in a softly lit studio. Minimal still life, no people, no text, no logos.'
    : 'The orange cube slowly rotates on its white pedestal. Static camera, soft studio lighting. No people, text or logos.' };
if (kind === 'video') {
  assert.match(scannedImageHash ?? '', /^[0-9a-f]{64}$/, 'Supply the independently scanned source image hash');
  const image = JSON.parse(readFileSync(join(root, 'image.result.json'), 'utf8'));
  assert(image.mimeType === 'image/png' || image.mimeType === 'image/jpeg');
  // The preceding probe records only a transport-validated generated artifact.
  assert(typeof image.path === 'string' && image.path.startsWith(process.env.AXIOM_SUBSCRIPTION_HOME + '/'));
  const file = openSync(image.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(file);
    assert(stat.isFile() && stat.nlink === 1 && stat.size >= 12 && stat.size <= 20 * 1024 * 1024);
    request.image = readFileSync(file);
    assert.equal(request.image.length, stat.size);
    assert.equal(createHash('sha256').update(request.image).digest('hex'), scannedImageHash);
  } finally { closeSync(file); }
  request.duration = 6;
}
let dispatched = false;
try {
  const artifact = await new OfficialSubscriptionTransport().generateMedia(request, async () => {
    const file = openSync(marker, 'wx', 0o600);
    try { writeFileSync(file, JSON.stringify({ kind, startedAt: new Date().toISOString() })); fsyncSync(file); }
    finally { closeSync(file); }
    const directory = openSync(root, constants.O_RDONLY);
    try { fsyncSync(directory); } finally { closeSync(directory); }
    dispatched = true;
    console.log(JSON.stringify({ kind, state: 'dispatched', automaticRetry: false }));
  });
  const file = openSync(join(root, `${kind}.result.json`), 'wx', 0o600);
  try { writeFileSync(file, JSON.stringify(artifact)); fsyncSync(file); } finally { closeSync(file); }
  console.log(JSON.stringify({ kind, state: 'artifact_received', mimeType: artifact.mimeType, bytes: artifact.byteLength,
    tosScanned: false, dashboardIngested: false, published: false }));
} catch (error) {
  // Never emit raw provider diagnostics, auth material or tool output.
  console.error(JSON.stringify({ kind, state: dispatched ? 'dispatched_result_unconfirmed' : 'preparation_failed',
    status: Number.isInteger(error?.status) ? error.status : null, automaticRetry: false }));
  process.exitCode = 1;
}
