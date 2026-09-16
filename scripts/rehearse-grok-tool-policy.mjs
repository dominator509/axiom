import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { OfficialSubscriptionTransport } from '../packages/llm-gateway/dist/providers/subscription.js';

// Real installed CLI, synthetic localhost model only. This does not establish
// OAuth entitlement, provider generation, or production sandbox enforcement.
assert.equal(process.argv[2], '--isolated-fixture', 'Pass --isolated-fixture explicitly');
const temporaryParent = await realpath(tmpdir());
const fixture = await mkdtemp(join(temporaryParent, 'axiom-grok-policy-'));
const userId = 'isolated-cli-policy-fixture';
const profile = join(fixture, createHash('sha256').update(userId).digest('hex'), 'grok');
const requests = [];
const endpoints = new Set();
let fixtureFailure;
let phase = 'startup';
const server = createServer(async (request, response) => {
  try {
    const pathname = request.url.split('?')[0];
    if (/^[a-zA-Z0-9/_.-]+$/.test(pathname)) endpoints.add(`${request.method} ${pathname}`);
    assert.equal(request.socket.remoteAddress, '127.0.0.1');
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'axiom-fixture', object: 'model' }] }));
      return;
    }
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      assert.ok(Buffer.byteLength(body) < 2 * 1024 * 1024, 'Fixture request exceeded limit');
    }
    const data = JSON.parse(body);
    assert.equal(typeof data.model, 'string');
    requests.push({ tools: data.tools ?? [], primary: data.model === 'axiom-fixture' });
    response.setHeader('Content-Type', 'text/event-stream');
    const event = (delta, finish_reason) => `data: ${JSON.stringify({
      id: 'fixture-response', object: 'chat.completion.chunk', created: 0,
      model: data.model, choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    response.end(event({ role: 'assistant', content: 'CLI policy fixture complete.' }, null)
      + event({}, 'stop') + 'data: [DONE]\n\n');
  } catch (error) {
    fixtureFailure = error;
    response.writeHead(400).end();
  }
});
const previousHome = process.env.AXIOM_SUBSCRIPTION_HOME;
const previousTimeout = process.env.AXIOM_LLM_TRANSPORT_TIMEOUT_MS;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await mkdir(profile, { recursive: true, mode: 0o700 });
  // Deliberately synthetic key, accepted only by the local fixture. It is not
  // an API-key fallback added to AXIOM or a credential for any external service.
  await writeFile(join(profile, 'config.toml'), `[model.axiom-fixture]\nmodel = "axiom-fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\napi_key = "local-fixture-not-a-provider-key"\napi_backend = "chat_completions"\n\n[models]\ndefault = "axiom-fixture"\n`, { mode: 0o600 });
  process.env.AXIOM_SUBSCRIPTION_HOME = fixture;
  process.env.AXIOM_LLM_TRANSPORT_TIMEOUT_MS = '30000';
  const transport = new OfficialSubscriptionTransport();
  const input = {
    provider: 'grok', userId, model: 'axiom-fixture',
    messages: [{ role: 'user', content: 'Return the fixture response. Do not invoke tools.' }],
  };
  const result = await transport.chat(input);
  let streamed = '';
  for await (const chunk of transport.stream(input)) streamed += chunk;
  phase = 'assertions';
  if (fixtureFailure) throw fixtureFailure;
  assert.ok(requests.length > 0, 'CLI never reached the localhost model fixture');
  assert.ok(requests.some(request => request.primary), 'Primary model never reached the fixture');
  assert.ok(requests.filter(request => request.primary).every(request => request.tools.length === 0), 'CLI advertised tools for a text-only request');
  // Grok's auxiliary title model uses a structured-output schema named
  // session_title. It is not a tool available to the primary prompt.
  assert.ok(requests.filter(request => !request.primary).every(request =>
    request.tools.every(tool => tool.function?.name === 'session_title')), 'Unexpected auxiliary tool');
  phase = `text-length-${result.content.length}`;
  assert.equal(result.content, 'CLI policy fixture complete.');
  assert.equal(streamed, 'CLI policy fixture complete.');
  console.log(`grok tool policy: ${requests.filter(request => request.primary).length} primary CLI request(s), zero advertised tools, chat/stream text returned; auxiliary schema restricted to session_title`);
} catch {
  // Provider errors can contain CLI diagnostics. Never print those verbatim.
  console.error(`grok tool policy: failed at ${phase}; model requests=${requests.length}; advertised tool counts=${requests.map(request => request.tools.length).join(',')}`);
  const toolNames = [...new Set(requests.flatMap(request => request.tools.map(tool => tool.function?.name)))];
  console.error(`grok tool policy: tool IDs=${toolNames.filter(name => typeof name === 'string' && /^[a-z_]+$/.test(name)).join(',')}`);
  console.error(`grok tool policy: fixture endpoints=${[...endpoints].join(',')}`);
  process.exitCode = 1;
} finally {
  if (previousHome === undefined) delete process.env.AXIOM_SUBSCRIPTION_HOME;
  else process.env.AXIOM_SUBSCRIPTION_HOME = previousHome;
  if (previousTimeout === undefined) delete process.env.AXIOM_LLM_TRANSPORT_TIMEOUT_MS;
  else process.env.AXIOM_LLM_TRANSPORT_TIMEOUT_MS = previousTimeout;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  const resolved = await realpath(fixture);
  const withinTemporaryParent = relative(temporaryParent, resolved);
  assert.ok(withinTemporaryParent.startsWith('axiom-grok-policy-') && !isAbsolute(withinTemporaryParent)
    && !withinTemporaryParent.includes('..'), 'Refusing cleanup outside the newly created fixture');
  await rm(resolved, { recursive: true, force: true });
}
