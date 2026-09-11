import assert from 'node:assert/strict';
import { localGrokOrigin } from './local-grok-origin.mjs';

assert.equal(localGrokOrigin([]), 'http://127.0.0.1:3002');
const origin = 'https://example-3003.usw3.devtunnels.ms';
assert.equal(localGrokOrigin([origin]), origin);
assert.equal(localGrokOrigin([`${origin}/`]), origin);
for (const value of [
  '', undefined, 'http://example.devtunnels.ms', 'https://devtunnels.ms',
  'https://*.devtunnels.ms', 'https://example.devtunnels.ms.evil.test',
  'https://user:password@example.devtunnels.ms', `${origin}:443`, `${origin}:8080`,
  `${origin}/login`, `${origin}/a/..`, `${origin}?query=1`, `${origin}#fragment`,
  ` ${origin}`, `${origin}\n`, 'https://%65xample.devtunnels.ms',
  'https://-example.devtunnels.ms', 'https://example-.devtunnels.ms',
  'https://example..devtunnels.ms', 'https://example.devtunnels.ms./',
]) assert.throws(() => localGrokOrigin([value]), /exact HTTPS dev tunnel origin/);
assert.throws(() => localGrokOrigin([origin, origin]), /at most one/);
console.log('local-grok-origin: 24 checks passed');
