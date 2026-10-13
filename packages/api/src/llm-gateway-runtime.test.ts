import { afterEach, expect, it, vi } from 'vitest';
import { createRuntimeLlmGateway } from './llm-gateway-runtime.js';

afterEach(() => vi.unstubAllEnvs());

it('requires both server-side Venice values and never exposes the key in status', () => {
  vi.stubEnv('VENICE_API_KEY', 'test-only-venice-key');
  vi.stubEnv('VENICE_MODEL', '');
  let gateway = createRuntimeLlmGateway();
  let capability = gateway.getProviderCapabilities().find((entry) => entry.provider === 'venice');
  expect(capability).toMatchObject({ available: false, transport: 'unsupported' });

  vi.stubEnv('VENICE_MODEL', 'test-model');
  gateway = createRuntimeLlmGateway();
  capability = gateway.getProviderCapabilities().find((entry) => entry.provider === 'venice');
  expect(capability).toMatchObject({
    available: true,
    transport: 'server-api',
    auth: 'api-key',
    operatorApiCost: true,
  });
  expect(JSON.stringify(capability)).not.toContain('test-only-venice-key');
});
