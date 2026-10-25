import { afterEach, describe, expect, it, vi } from 'vitest';
import { VeniceProvider, streamVenice, normalizeVeniceCacheUsage } from './venice.js';
import { LLMGateway } from '../gateway.js';

const model = 'fixture-model';
const messages = [{ role: 'user' as const, content: 'synthetic check' }];
// Sanitized counters observed in the live adapter probe at c3aedb9d; no response
// content, account identity, credential or uncontrolled cache-rate assertion.
const usage = {
  prompt_tokens: 1761,
  completion_tokens: 3,
  total_tokens: 1764,
  prompt_tokens_details: { cached_tokens: 1728 },
};
const expected = { promptTokens: 1761, cachedPromptTokens: 1728, cacheCreationPromptTokens: 0 };
const completion = { model, choices: [{ message: { content: 'answer' } }], usage };
const streamBody = [
  'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}],"usage":null}',
  `data: ${JSON.stringify({ choices: [], usage })}`,
  'data: [DONE]',
].join('\n');

async function collect<T>(stream: AsyncIterable<T>) {
  const chunks: T[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

afterEach(() => vi.unstubAllGlobals());

describe('Venice provider cache counters', () => {
  it.each([false, true])('emits enabled routing hints in both provider paths (stream=%s)', async stream => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init!.body as string));
      return stream ? new Response(streamBody) : Response.json(completion);
    });
    vi.stubGlobal('fetch', fetchImpl);
    const control = { provider: 'venice', enabled: true, prefixAlignment: false, promptCacheKey: 'scoped-key' };
    const provider = new VeniceProvider('fixture-key', model);
    if (stream) await collect(provider.chatStream(messages, { fetchImpl, cacheControl: control }));
    else await provider.chat(messages, { fetchImpl, cacheControl: control });
    const gateway = new LLMGateway([{ name: 'venice', apiKey: 'fixture-key', defaultModel: model }]);
    const options = { provider: 'venice', model, cacheControls: [control] };
    if (stream) await collect(await gateway.chatStream(messages, options));
    else await gateway.chat(messages, options);
    expect(bodies).toHaveLength(2);
    expect(bodies.every(body => body.prompt_cache_key === 'scoped-key')).toBe(true);
    const disabled = { ...control, enabled: false };
    if (stream) await collect(await gateway.chatStream(messages, { ...options, cacheControls: [disabled] }));
    else await gateway.chat(messages, { ...options, cacheControls: [disabled] });
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).not.toHaveProperty('prompt_cache_key');
  });

  it.each([
    [{ cache_creation_input_tokens: 100 }, { promptTokens: 200, cachedPromptTokens: 0, cacheCreationPromptTokens: 100 }],
    [{ cached_tokens: 100, cache_creation_input_tokens: 50 }, { promptTokens: 200, cachedPromptTokens: 100, cacheCreationPromptTokens: 50 }],
    [{ cached_tokens: 100, cache_creation_input_tokens: 101 }, undefined],
    [{ cached_tokens: 100, cache_creation_input_tokens: null }, undefined],
    [{ cached_tokens: 100, cache_creation_input_tokens: '50' }, undefined],
    [{ cached_tokens: 100, cache_creation_input_tokens: -1 }, undefined],
    [{ cached_tokens: 100, cache_creation_input_tokens: 50, created_cache_tokens: 51 }, undefined],
    [{ cache_creation_input_tokens: 50, created_cache_tokens: 50 }, { promptTokens: 200, cachedPromptTokens: 0, cacheCreationPromptTokens: 50 }],
  ])('normalizes documented cache writes without hiding invalid counters: %j', (details, expectedUsage) => {
    expect(normalizeVeniceCacheUsage({ prompt_tokens: 200, prompt_tokens_details: details })).toEqual(expectedUsage);
  });

  it('preserves reported counters in class chat results', async () => {
    const fetchImpl = vi.fn(async () => Response.json(completion));
    const result = await new VeniceProvider('fixture-key', model).chat(messages, { fetchImpl });
    expect(result.providerCacheUsage).toEqual(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves final counters after the streaming finish marker', async () => {
    const fetchImpl = vi.fn(async () => new Response(streamBody));
    const chunks = await collect(
      new VeniceProvider('fixture-key', model).chatStream(messages, { fetchImpl }),
    );
    expect(chunks.at(-1)).toMatchObject({ type: 'done', providerCacheUsage: expected });
    expect(chunks.filter((chunk) => chunk.type === 'done')).toHaveLength(1);
  });

  it.each([false, true])('feeds the existing gateway observer once (stream=%s)', async (stream) => {
    const fetchImpl = vi.fn(async () =>
      stream ? new Response(streamBody) : Response.json(completion),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const observer = vi.fn();
    const gateway = new LLMGateway([
      { name: 'venice', apiKey: 'fixture-key', defaultModel: model },
    ]);
    const options = { provider: 'venice', model, providerCacheObserver: observer };
    if (stream)
      expect((await collect(await gateway.chatStream(messages, options))).join('')).toBe('answer');
    else {
      expect((await gateway.chat(messages, options)).providerCacheUsage).toEqual(expected);
      expect(await gateway.chat(messages, options)).toMatchObject({ cached: true });
    }
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith({
      provider: 'venice',
      usage: expected,
      observedAt: expect.any(Date),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'does not retry inference when the cache observer rejects (stream=%s)',
    async (stream) => {
      const fetchImpl = vi.fn(async () =>
        stream ? new Response(streamBody) : Response.json(completion),
      );
      vi.stubGlobal('fetch', fetchImpl);
      const observer = vi.fn(async () => {
        throw new Error('private-observer-error');
      });
      const gateway = new LLMGateway([
        { name: 'venice', apiKey: 'fixture-key', defaultModel: model },
      ]);
      const options = { provider: 'venice', model, providerCacheObserver: observer };
      if (stream) await collect(await gateway.chatStream(messages, options));
      else await gateway.chat(messages, options);
      expect(observer).toHaveBeenCalledWith({
        provider: 'venice',
        usage: expected,
        observedAt: expect.any(Date),
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    undefined,
    null,
    { cached_tokens: '1728' },
    { cached_tokens: -1 },
    { cached_tokens: 1762 },
  ])('keeps missing or invalid details unknown: %j', async (details) => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ...completion, usage: { ...usage, prompt_tokens_details: details } }),
    );
    const result = await new VeniceProvider('fixture-key', model).chat(messages, { fetchImpl });
    expect(result.providerCacheUsage).toBeUndefined();
  });

  it('preserves an explicit zero cache hit counter', async () => {
    const result = await new VeniceProvider('fixture-key', model).chat(messages, {
      fetchImpl: async () =>
        Response.json({
          ...completion,
          usage: { ...usage, prompt_tokens_details: { cached_tokens: 0 } },
        }),
    });
    expect(result.providerCacheUsage).toEqual({ ...expected, cachedPromptTokens: 0 });
  });

  it('uses the final cumulative snapshot once rather than summing stream events', async () => {
    const observer = vi.fn();
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          [
            `data: ${JSON.stringify({ usage: { ...usage, prompt_tokens_details: { cached_tokens: 128 } } })}`,
            `data: ${JSON.stringify({ usage })}`,
            'data: [DONE]',
          ].join('\n'),
        ),
    );
    await collect(
      streamVenice('fixture-key', { model, messages }, undefined, fetchImpl, undefined, observer),
    );
    expect(observer).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it('does not reuse stale counters after a malformed final usage snapshot', async () => {
    const fetchImpl = async () =>
      new Response(
        [
          `data: ${JSON.stringify({ usage })}`,
          'data: {"usage":{"prompt_tokens":1,"prompt_tokens_details":{"cached_tokens":2}}}',
          'data: [DONE]',
        ].join('\n'),
      );
    const chunks = await collect(
      new VeniceProvider('fixture-key', model).chatStream(messages, { fetchImpl }),
    );
    expect(chunks.at(-1)?.providerCacheUsage).toBeUndefined();
  });

  it('isolates rejection from a legacy stream observer', async () => {
    const observer = vi.fn(async () => {
      throw new Error('private-observer-error');
    });
    const fetchImpl = vi.fn(async () => new Response(streamBody));
    expect(
      (
        await collect(
          streamVenice(
            'fixture-key',
            { model, messages },
            undefined,
            fetchImpl,
            undefined,
            observer,
          ),
        )
      ).join(''),
    ).toBe('answer');
    expect(observer).toHaveBeenCalledExactlyOnceWith(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not report a completed snapshot for an interrupted stream', async () => {
    const observer = vi.fn();
    let reads = 0;
    const fetchImpl = async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            if (reads++ === 0)
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ usage })}\n`));
            else controller.error(new Error('interrupted'));
          },
        }),
      );
    await expect(
      collect(
        streamVenice('fixture-key', { model, messages }, undefined, fetchImpl, undefined, observer),
      ),
    ).rejects.toThrow('interrupted');
    expect(observer).not.toHaveBeenCalled();
  });

  it('keeps successful responses with unknown counters in the gateway cohort', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json(completion))
      .mockResolvedValueOnce(
        Response.json({ ...completion, usage: { ...usage, prompt_tokens_details: null } }),
      );
    vi.stubGlobal('fetch', fetchImpl);
    const gateway = new LLMGateway([
      { name: 'venice', apiKey: 'fixture-key', defaultModel: model },
    ]);
    await gateway.chat(messages, { provider: 'venice', model });
    await gateway.chat([{ role: 'user', content: 'another synthetic check' }], {
      provider: 'venice',
      model,
    });
    expect(gateway.getStats().providerCache).toMatchObject({
      observedResponses: 1,
      unobservedResponses: 1,
      promptTokens: 1761,
      cachedPromptTokens: 1728,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
