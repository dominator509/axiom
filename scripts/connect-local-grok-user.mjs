// Operator diagnostic for the user-authorized account only. Do not run
// concurrently with its dashboard login. Never reads or prints credential files.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import assert from 'node:assert/strict';
assert.equal(process.platform, 'linux');
const userId = process.argv[2];
assert.match(userId ?? '', /^[a-zA-Z0-9_-]{1,128}$/);
const runtime = parseEnv(readFileSync(new URL('../var/grok-runtime.env', import.meta.url), 'utf8'));
process.env.AXIOM_GROK_CLI = runtime.AXIOM_GROK_CLI;
process.env.AXIOM_SUBSCRIPTION_HOME = '/home/doministic/.local/share/axiom-subscriptions';
process.env.AXIOM_LLM_TRANSPORT_TIMEOUT_MS = '300000';
const { OfficialSubscriptionTransport } = await import('../packages/llm-gateway/dist/providers/subscription.js');
const transport = new OfficialSubscriptionTransport();
console.log('Starting one device-code login; no media generation requested.');
try {
  for await (const line of transport.connect('grok', userId)) console.log(line);
  console.log('Device-login command completed successfully.');
} catch (error) {
  console.error(`Device login did not complete (status ${Number.isInteger(error?.status) ? error.status : 'unavailable'}).`);
  process.exitCode = 1;
}
