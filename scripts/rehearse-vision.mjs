import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

assert.equal(process.argv[2], '--isolated-fixture', 'Pass --isolated-fixture explicitly');
const model = fileURLToPath(new URL('../var/models/nsfw-vit.onnx', import.meta.url));
const videoHash = process.argv[3];
if (videoHash) assert.match(videoHash, /^[0-9a-f]{64}$/);
const media = fileURLToPath(new URL(videoHash
  ? '../crates/media-plane/var/media' : '../crates/vision-engine/var/media', import.meta.url));
assert.equal(createHash('sha256').update(readFileSync(model)).digest('hex'),
  '2605f68c77b9262e51afa0ff022971c7a8dabcfa51f55c78321b711b889b0e93');
// This synthetic PNG is produced by the existing vision-engine unit tests.
const framePaths = videoHash
  ? JSON.parse(readFileSync(`${media}/tos-video-v1/${videoHash}/manifest.json`, 'utf8')).frames
  : ['no-override-test.png'];
assert.ok(Array.isArray(framePaths) && framePaths.length > 0 && framePaths.length <= 25);
for (const [index, frame] of framePaths.entries()) {
  if (videoHash) assert.equal(frame, `tos-video-v1/${videoHash}/frame-${String(index + 1).padStart(3, '0')}.png`);
  assert.ok(readFileSync(`${media}/${frame}`).length > 0);
}
const image = 'axiom-vision-engine:rehearsal-45f96d5';
const name = `axiom-vision-probe-${randomBytes(8).toString('hex')}`;
const token = randomBytes(32).toString('hex');
function docker(args, input) {
  return spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, AXIOM_VISION_AUTH_TOKEN: token }, maxBuffer: 1024 * 1024 });
}
function request(path, body, authorized = true) {
  // Pass the ephemeral credential through stdin, not command-line arguments.
  const config = [
    'silent', 'show-error', 'connect-timeout = 2', 'max-time = 30',
    `url = "http://127.0.0.1:8101${path}"`, 'write-out = "\\n%{http_code}"',
    ...(authorized ? [`header = "Authorization: Bearer ${token}"`] : []),
    ...(body ? ['header = "Content-Type: application/json"',
      `data = ${JSON.stringify(JSON.stringify(body))}`] : []),
  ].join('\n');
  const result = docker(['exec', '-i', name, 'curl', '--config', '-'], config);
  if (result.status !== 0) return { status: 0, body: '' };
  const split = result.stdout.lastIndexOf('\n');
  return { status: Number(result.stdout.slice(split + 1)), body: result.stdout.slice(0, split) };
}
let created = false;
try {
  const prepared = docker(['create', '--name', name, '--network', 'none',
    '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--env', 'NODE_ENV=production', '--env', 'AXIOM_VISION_AUTH_TOKEN',
    '--mount', `type=bind,source=${model},target=/opt/axiom/models/nsfw-vit.onnx,readonly`,
    '--mount', `type=bind,source=${media},target=/app/var/media,readonly`, image]);
  assert.equal(prepared.status, 0, 'Isolated vision container must be created (output suppressed)');
  created = true;
  assert.equal(docker(['start', name]).status, 0, 'Isolated vision container must start');
  let health;
  for (let attempt = 0; attempt < 30; attempt++) {
    health = request('/health', undefined, false);
    if (health.status === 200) break;
    await setTimeout(1000);
  }
  assert.equal(health.status, 200, 'Pinned model must become ready');
  assert.equal(JSON.parse(health.body).model_loaded, true);
  for (const imagePath of framePaths) {
  const body = { image_path: imagePath };
  for (const path of ['/vision/tos-classify', '/vision/nsfw-detect']) {
    assert.equal(request(path, body, false).status, 401);
    assert.equal(request(path, { image_path: '/etc/passwd' }).status, 400);
    const response = request(path, body);
    assert.equal(response.status, 200, `${path} must run real inference`);
    const result = JSON.parse(response.body);
    assert.equal(result.engine, 'onnx-vit');
    assert.equal(result.overridden, false);
    assert.deepEqual(result.labels, ['drawings', 'hentai', 'neutral', 'porn', 'sexy']);
    assert.equal(result.probabilities.length, 5);
    assert.ok(result.probabilities.every(p => Number.isFinite(p) && p >= 0 && p <= 1));
    assert.ok(Math.abs(result.probabilities.reduce((sum, p) => sum + p, 0) - 1) < 1e-6);
    assert.ok(Math.abs(result.nsfw_score - [1, 3, 4].reduce((sum, i) => sum + result.probabilities[i], 0)) < 1e-6);
  }
  }
  console.log(`vision rehearsal: classified ${framePaths.length} real image/frame files without overrides`);
  console.log('vision rehearsal: pinned ONNX model ready; both inference routes model-backed; auth and path boundaries passed (not accuracy validation)');
} finally {
  if (created) assert.equal(docker(['rm', '--force', name]).status, 0, 'Remove only the probe container');
}
