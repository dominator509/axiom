import { describe, expect, it } from 'vitest';
import { LLMGateway, type Message } from './gateway.js';
import type { SubscriptionRequest, SubscriptionResult, SubscriptionTransport } from './providers/subscription.js';
import { CACHE_CONTROL_UNSUPPORTED_CODE } from './cache-controls.js';

const messages: Message[] = [{ role: 'user', content: 'hello' }];

class FakeTransport implements SubscriptionTransport {
  readonly providers = new Set(['openai', 'anthropic', 'grok'] as const);
  readonly calls: SubscriptionRequest[] = [];
  async chat(request: SubscriptionRequest): Promise<SubscriptionResult> {
    this.calls.push(request);
    return { content: 'ok', model: request.model, usage: { promptTokens: 1, completionTokens: 1 } };
  }
  async *stream(request: SubscriptionRequest): AsyncIterable<string> {
    this.calls.push(request);
    yield 'ok';
  }
  async status(provider: 'openai' | 'anthropic' | 'grok') { return { provider, connected: true }; }
  async *connect() { yield 'connected'; }
  async disconnect() { return undefined; }
}

const enabledOpenAI = [{ provider: 'openai', enabled: true, prefixAlignment: false, promptCacheKey: 'model:v1' }];

describe('gateway cache-control transport boundary', () => {
  it('fails closed before an enabled subscription request is dispatched', async () => {
    const transport = new FakeTransport();
    const gateway = new LLMGateway(undefined, transport);
    await expect(gateway.chat(messages, { provider: 'openai', userId: 'user-1', cacheControls: enabledOpenAI }))
      .rejects.toMatchObject({ status: 422, code: CACHE_CONTROL_UNSUPPORTED_CODE });
    expect(transport.calls).toHaveLength(0);
  });

  it('preserves the existing subscription path when the setting is disabled', async () => {
    const transport = new FakeTransport();
    const gateway = new LLMGateway(undefined, transport);
    const result = await gateway.chat(messages, {
      provider: 'openai',
      userId: 'user-1',
      cacheControls: [{ provider: 'openai', enabled: false, prefixAlignment: true, promptCacheKey: 'model:v1' }],
    });
    expect(result.content).toBe('ok');
    expect(transport.calls).toHaveLength(1);
  });

  it('fails closed before an enabled streaming subscription request is dispatched', async () => {
    const transport = new FakeTransport();
    const gateway = new LLMGateway(undefined, transport);
    const stream = await gateway.chatStream(messages, { provider: 'anthropic', userId: 'user-1', cacheControls: [
      { provider: 'anthropic', enabled: true, prefixAlignment: true },
    ] });
    await expect((async () => { for await (const _chunk of stream) void _chunk; })())
      .rejects.toMatchObject({ status: 422, code: CACHE_CONTROL_UNSUPPORTED_CODE });
    expect(transport.calls).toHaveLength(0);
  });
});
