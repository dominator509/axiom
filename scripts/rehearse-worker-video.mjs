// Real worker evaluation + media extraction + pinned vision inference.
// No queue loop, provider generation, application database or approval writes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, copyFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

if (process.argv[2] === '--evaluate-isolated') {
  assert.equal(process.env.DATABASE_URL, 'postgres://fixture:fixture@127.0.0.1:9/unavailable');
  for (const name of ['MEDIA_PLANE_URL', 'VISION_ENGINE_URL']) {
    const url = new URL(process.env[name]);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.protocol, 'http:');
  }
  const hash = process.argv[3];
  assert.match(hash ?? '', /^[0-9a-f]{64}$/);
  const { evaluateMediaToS } = await import('../packages/worker/dist/executors/tos.js');
  const { pool } = await import('../packages/db/dist/index.js');
  try {
    const asset = { kind: 'video', storageKey: 'source.mp4', sha256: Buffer.from(hash, 'hex') };
    const result = await evaluateMediaToS(asset, 'A scenic landscape', [], ['telegram']);
    assert.equal(result.verdict, 'review', 'Sampled video must still require human review');
    assert.equal(result.videoCoverage?.assetSha256, hash);
    assert.equal(result.videoCoverage.policy, 'sampled-2fps-v1');
    assert.ok(result.videoCoverage.frameCount > 0);
    assert.equal(result.scores.length, 1);
    assert.equal(result.scores[0].verdict, 'review');
    assert.equal(result.videoCoverage.automatedScores[0].verdict, 'pass', 'Real benign clip inference must succeed, not a fallback error');
    await assert.rejects(() => evaluateMediaToS({ ...asset, sha256: Buffer.alloc(32) }, '', [], ['telegram']),
      /invalid video frame coverage or content identity/);
    process.env.MEDIA_PLANE_AUTH_TOKEN = 'invalid-fixture-credential';
    await assert.rejects(() => evaluateMediaToS(asset, '', [], ['telegram']), /video extraction failed \(401\)/);
    assert.equal(pool.totalCount, 0, 'Evaluation must not open a database connection');
    console.log(JSON.stringify({ workerVideoEvaluation: 'passed', frameCount: result.videoCoverage.frameCount,
      verdict: result.verdict, databaseWrites: 0, providerRequests: 0 }));
  } finally { await pool.end(); }
} else {
  assert.equal(process.argv[2], '--existing-probe');
  const hash = process.argv[3];
  assert.match(hash ?? '', /^[0-9a-f]{64}$/);
  const source = fileURLToPath(new URL(`../var/live-grok-probe/${hash}.mp4`, import.meta.url));
  assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'), hash);
  const model = fileURLToPath(new URL('../var/models/nsfw-vit.onnx', import.meta.url));
  assert.equal(createHash('sha256').update(readFileSync(model)).digest('hex'),
    '2605f68c77b9262e51afa0ff022971c7a8dabcfa51f55c78321b711b889b0e93');
  const suffix = randomBytes(8).toString('hex');
  const network = `axiom-video-check-${suffix}`;
  const root = mkdtempSync(join(tmpdir(), 'axiom-worker-video-'));
  const media = join(root, 'media');
  chmodSync(root, 0o755); mkdirSync(media, { mode: 0o777 }); chmodSync(media, 0o777);
  copyFileSync(source, join(media, 'source.mp4'));
  const token = randomBytes(32).toString('hex');
  const cleanEnv = Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'DOCKER_HOST', 'DOCKER_CONTEXT']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  const created = [];
  let networkCreated = false;
  const docker = args => {
    const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 30_000,
      maxBuffer: 1024 * 1024, env: { ...cleanEnv, AXIOM_MEDIA_AUTH_TOKEN: token, AXIOM_VISION_AUTH_TOKEN: token } });
    assert.equal(result.status, 0, 'Isolated Docker operation must succeed (diagnostics suppressed)');
    return result.stdout.trim();
  };
  try {
    // Host-side worker evaluation needs loopback-published ports. This private
    // fixture network is not a production egress-isolation attestation.
    docker(['network', 'create', network]); networkCreated = true;
    const urls = {};
    for (const [kind, port, image] of [
      ['media', 8100, 'axiom-media-plane:rehearsal-027bba5'],
      ['vision', 8101, 'axiom-vision-engine:rehearsal-45f96d5'],
    ]) {
      const name = `${network}-${kind}`;
      docker(['create', '--name', name, '--network', network, '--read-only', '--cap-drop=ALL',
        '--security-opt=no-new-privileges', '--tmpfs', '/tmp:rw,nosuid,nodev',
        '--publish', `127.0.0.1::${port}`, '--env', 'NODE_ENV=production',
        '--env', kind === 'media' ? 'AXIOM_MEDIA_AUTH_TOKEN' : 'AXIOM_VISION_AUTH_TOKEN',
        '--mount', `type=bind,source=${media},target=/app/var/media${kind === 'vision' ? ',readonly' : ''}`,
        ...(kind === 'vision' ? ['--mount', `type=bind,source=${model},target=/opt/axiom/models/nsfw-vit.onnx,readonly`] : []), image]);
      created.push(name); docker(['start', name]);
      const mapped = docker(['port', name, `${port}/tcp`]);
      assert.match(mapped, /^127\.0\.0\.1:\d+$/);
      urls[kind] = `http://${mapped}`;
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const response = await fetch(`${urls[kind]}/health`, { signal: AbortSignal.timeout(1000) });
          if (response.ok && (kind !== 'vision' || (await response.json()).model_loaded === true)) { ready = true; break; }
        } catch { /* bounded startup wait */ }
        await delay(1000);
      }
      assert.ok(ready, 'Isolated service must become ready');
    }
    const evaluated = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--evaluate-isolated', hash], {
      encoding: 'utf8', windowsHide: true, timeout: 180_000, maxBuffer: 1024 * 1024,
      env: { ...cleanEnv, NODE_ENV: 'production', DATABASE_URL: 'postgres://fixture:fixture@127.0.0.1:9/unavailable',
        MEDIA_PLANE_URL: urls.media, VISION_ENGINE_URL: urls.vision,
        MEDIA_PLANE_AUTH_TOKEN: token, AXIOM_VISION_AUTH_TOKEN: token },
    });
    assert.equal(evaluated.status, 0, 'Real worker video evaluation must pass (diagnostics suppressed)');
    console.log(evaluated.stdout.trim());
  } finally {
    for (const name of created.reverse()) docker(['rm', '--force', name]);
    if (networkCreated) docker(['network', 'rm', network]);
    assert.ok(basename(root).startsWith('axiom-worker-video-')); assert.equal(dirname(root), tmpdir());
    rmSync(root, { recursive: true, force: true });
  }
}
