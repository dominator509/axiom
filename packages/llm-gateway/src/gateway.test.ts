import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMGateway, type Message } from './gateway.js';
import type {
  SubscriptionRequest,
  SubscriptionResult,
  SubscriptionTransport,
} from './providers/subscription.js';

const messages: Message[] = [
  { role: 'system', content: 'be helpful' },
  { role: 'user', content: 'hello there' },
];

const vllmCompletion = {
  id: 'vllm-1',
  object: 'chat.completion',
  created: 1,
  model: 'local-model',
  choices: [
    { index: 0, message: { role: 'assistant', content: 'hello from vllm' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
};

class FakeSubscriptionTransport implements SubscriptionTransport {
  readonly providers = new Set(['openai', 'anthropic', 'grok'] as const);
  readonly calls: SubscriptionRequest[] = [];
  failures = new Map<string, Error>();

  async chat(request: SubscriptionRequest): Promise<SubscriptionResult> {
    this.calls.push(request);
    const failure = this.failures.get(request.provider);
    if (failure) throw failure;
    return {
      content: `hello from ${request.provider}`,
      model: request.model,
      usage: { promptTokens: 100, completionTokens: 25 },
    };
  }

  async *stream(request: SubscriptionRequest): AsyncIterable<string> {
    this.calls.push(request);
    const failure = this.failures.get(request.provider);
    if (failure) throw failure;
    yield `hello from `;
    yield request.provider;
  }

  async status(provider: 'openai' | 'anthropic' | 'grok') {
    return { provider, connected: true };
  }

  async *connect(): AsyncIterable<string> {
    yield 'Open the provider login page';
  }

  async disconnect(): Promise<void> {}
}

let transport: FakeSubscriptionTransport;
let fetchMock: ReturnType<typeof vi.fn>;

function gateway(overrides?: ConstructorParameters<typeof LLMGateway>[0]): LLMGateway {
  return new LLMGateway(overrides, transport);
}

beforeEach(() => {
  transport = new FakeSubscriptionTransport();
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(vllmCompletion), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('LLMGateway subscription-only availability', () => {
  it('exposes only official subscription transports and local vLLM', () => {
    expect(gateway().getAvailableProviders().sort()).toEqual([
      'anthropic',
      'grok',
      'openai',
      'vllm',
    ]);
  });

  it.each(['deepseek', 'mistral', 'lightning', 'google', 'venice'])(
    'fails closed for API-only provider %s even when an API key exists',
    async (provider) => {
      process.env[`${provider.toUpperCase()}_API_KEY`] = 'must-not-be-used';
      await expect(gateway().chat(messages, { provider })).rejects.toMatchObject({ status: 503 });
      expect(fetchMock).not.toHaveBeenCalled();
      delete process.env[`${provider.toUpperCase()}_API_KEY`];
    },
  );

  it('rejects unknown providers', async () => {
    await expect(gateway().chat(messages, { provider: 'nope' })).rejects.toThrow(
      'Unknown provider: nope',
    );
  });
});

describe('LLMGateway user-funded chat', () => {
  it.each(['openai', 'anthropic', 'grok'] as const)(
    'routes %s through the authenticated user subscription at zero operator cost',
    async (provider) => {
      const result = await gateway().chat(messages, { provider, userId: 'user-1' });
      expect(result).toMatchObject({ provider, content: `hello from ${provider}`, cost: 0 });
      expect(transport.calls[0]).toMatchObject({ provider, userId: 'user-1' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('requires an authenticated user for subscription calls', async () => {
    await expect(gateway().chat(messages, { provider: 'openai' })).rejects.toThrow(
      'Authenticated user is required',
    );
  });

  it('does not retry a subscription generation', async () => {
    transport.failures.set('openai', new Error('subscription transport failed'));
    await expect(
      gateway().chat(messages, { provider: 'openai', userId: 'user-1' }),
    ).rejects.toThrow('subscription transport failed');
    expect(transport.calls).toHaveLength(1);
  });

  it('does not silently fall back after an explicit provider failure', async () => {
    transport.failures.set('grok', new Error('weekly allowance exhausted'));
    await expect(gateway().chat(messages, { provider: 'grok', userId: 'user-1' })).rejects.toThrow(
      'weekly allowance exhausted',
    );
    expect(transport.calls.map((call) => call.provider)).toEqual(['grok']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never shares cached subscription responses across AXIOM users', async () => {
    const gw = gateway();
    const first = await gw.chat(messages, {
      provider: 'openai',
      userId: 'user-1',
      model: 'shared-model-name',
    });
    const second = await gw.chat(messages, {
      provider: 'openai',
      userId: 'user-2',
      model: 'shared-model-name',
    });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(false);
    expect(transport.calls.map((call) => call.userId)).toEqual(['user-1', 'user-2']);
  });

  it('reuses a response only within the same AXIOM user scope', async () => {
    const gw = gateway();
    await gw.chat(messages, { provider: 'grok', userId: 'user-1', model: 'grok-test' });
    const cached = await gw.chat(messages, {
      provider: 'grok',
      userId: 'user-1',
      model: 'grok-test',
    });
    expect(cached.cached).toBe(true);
    expect(transport.calls).toHaveLength(1);
  });

  it('uses local vLLM first for the zero-cost policy', async () => {
    const result = await gateway().chat(messages, { policy: 'cost', userId: 'user-1' });
    expect(result).toMatchObject({ provider: 'vllm', cost: 0 });
    expect(transport.calls).toHaveLength(0);
  });

  it('uses an official subscription for the quality policy', async () => {
    const result = await gateway().chat(messages, { policy: 'quality', userId: 'user-1' });
    expect(result.provider).toBe('openai');
  });

  it('rejects egress proxying for subscription CLIs', async () => {
    await expect(
      gateway().chat(messages, { provider: 'openai', userId: 'user-1', egress: true }),
    ).rejects.toThrow('cannot use model egress bindings');
    expect(transport.calls).toHaveLength(0);
  });

  it('keeps local vLLM available without a user subscription', async () => {
    const result = await gateway().chat(messages, { provider: 'vllm' });
    expect(result).toMatchObject({ provider: 'vllm', content: 'hello from vllm', cost: 0 });
  });
});

describe('LLMGateway subscription streaming', () => {
  it('streams through the selected user subscription', async () => {
    const stream = await gateway().chatStream(messages, {
      provider: 'anthropic',
      userId: 'user-2',
    });
    let result = '';
    for await (const chunk of stream) result += chunk;
    expect(result).toBe('hello from anthropic');
    expect(transport.calls[0]).toMatchObject({ provider: 'anthropic', userId: 'user-2' });
  });

  it('requires an authenticated user for subscription streaming', async () => {
    const stream = await gateway().chatStream(messages, { provider: 'grok' });
    const consume = async () => {
      for await (const chunk of stream) void chunk;
    };
    await expect(consume()).rejects.toThrow('Authenticated user is required');
  });
});

describe('LLMGateway observability', () => {
  it('tracks successful and failed subscription attempts', async () => {
    const gw = gateway();
    await gw.chat(messages, { provider: 'openai', userId: 'user-1' });
    transport.failures.set('grok', new Error('offline'));
    await expect(gw.chat(messages, { provider: 'grok', userId: 'user-1' })).rejects.toThrow();
    expect(gw.getStats()).toMatchObject({ requests: 1, failures: 1 });
  });
});
