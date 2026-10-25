import { afterEach, describe, expect, it, vi } from 'vitest';
import { VeniceProvider, streamVenice } from './venice.js';
import { LLMGateway } from '../gateway.js';
import { normalizeVeniceBilling } from '../provider-billing.js';

const messages = [{ role: 'user' as const, content: 'hello' }];
const completion = {
  model: 'fixture-model',
  choices: [{ message: { content: 'answer' } }],
  usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
};
const billing = { usd: 0.00042, diem: 0.15 };
const request = { model: 'fixture-model', messages };
const events = [
  'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}',
  'data: malformed',
  `data: ${JSON.stringify({ usage: completion.usage, cost: billing })}`,
  'data: [DONE]',
  'data: {"choices":[{"delta":{"content":"ignored"}}]}',
].join('\r\n');

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of stream) result.push(value);
  return result;
}

function fragmentedStream(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + 7));
        offset = Math.min(bytes.length, offset + 7);
      },
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Venice reported billing', () => {
  it.each([
    [undefined, { usd: null, diem: null }],
    [null, { usd: null, diem: null }],
    [{}, { usd: null, diem: null }],
    [
      { usd: 0, diem: 0 },
      { usd: 0, diem: 0 },
    ],
    [
      { usd: '0.1', diem: -1 },
      { usd: null, diem: null },
    ],
    [
      { usd: Infinity, diem: NaN },
      { usd: null, diem: null },
    ],
    [
      { usd: -0.1, diem: 0.2 },
      { usd: null, diem: 0.2 },
    ],
    [{ usd: 0.1 }, { usd: 0.1, diem: null }],
    [billing, billing],
  ])('normalizes %j without inventing a charge', (raw, expected) => {
    expect(normalizeVeniceBilling(raw)).toEqual(expected);
  });

  it('preserves both currencies in the class response', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ...completion, cost: billing }));
    const result = await new VeniceProvider('fixture-key').chat(messages, { fetchImpl });
    expect(result).toMatchObject({ cost: billing.usd, providerBilling: billing });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads trailing stream usage and billing after finish_reason and emits one done', async () => {
    const fetchImpl = vi.fn(async () => fragmentedStream(events));
    const chunks = await collect(
      new VeniceProvider('fixture-key').chatStream(messages, { fetchImpl }),
    );
    expect(chunks).toEqual([
      { type: 'delta', content: 'answer' },
      {
        type: 'done',
        content: 'answer',
        cost: billing.usd,
        providerBilling: billing,
        usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
      },
    ]);
    const init = (fetchImpl.mock.calls as unknown as [string, RequestInit][])[0][1];
    expect(JSON.parse(init.body as string).stream_options).toEqual({ include_usage: true });
  });

  it('reads an unterminated final billing line and does not sum repeated cumulative charges', async () => {
    const fetchImpl = vi.fn(async () =>
      fragmentedStream(
        `data: ${JSON.stringify({ cost: billing })}\ndata: ${JSON.stringify({ cost: billing })}`,
      ),
    );
    const observer = vi.fn();
    expect(
      await collect(streamVenice('fixture-key', request, undefined, fetchImpl, observer)),
    ).toEqual([]);
    expect(observer).toHaveBeenCalledExactlyOnceWith({
      provider: 'venice',
      model: request.model,
      billing,
    });
  });

  it('reports missing stream billing as unknown', async () => {
    const observer = vi.fn();
    await collect(
      streamVenice(
        'fixture-key',
        request,
        undefined,
        async () => fragmentedStream('data: [DONE]'),
        observer,
      ),
    );
    expect(observer).toHaveBeenCalledExactlyOnceWith({
      provider: 'venice',
      model: request.model,
      billing: { usd: null, diem: null },
    });
  });

  it('does not publish a completed observation after an interrupted stream', async () => {
    let reads = 0;
    const observer = vi.fn();
    const fetchImpl = async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            if (reads++ === 0)
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify({ cost: billing })}\n`),
              );
            else controller.error(new Error('interrupted'));
          },
        }),
      );
    await expect(
      collect(streamVenice('fixture-key', request, undefined, fetchImpl, observer)),
    ).rejects.toThrow('interrupted');
    expect(observer).not.toHaveBeenCalled();
  });

  it('cancels the upstream reader when a consumer abandons the stream', async () => {
    const cancel = vi.fn();
    const observer = vi.fn();
    const fetchImpl = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"choices":[{"delta":{"content":"partial"}}]}\n',
        ));
      },
      cancel,
    }));
    for await (const chunk of streamVenice('fixture-key', request, undefined, fetchImpl, observer)) {
      expect(chunk).toBe('partial');
      break;
    }
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(observer).not.toHaveBeenCalled();
  });

  it.each([false, true])('gateway isolates observer failure (stream=%s)', async (stream) => {
    const fetchImpl = vi.fn(async () =>
      stream ? fragmentedStream(events) : Response.json({ ...completion, cost: billing }),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const observer = vi.fn(async () => {
      throw new Error('private-observer-secret');
    });
    const gateway = new LLMGateway([
      { name: 'venice', apiKey: 'fixture-key', defaultModel: request.model },
    ]);
    const options = { provider: 'venice', model: request.model, providerBillingObserver: observer };
    if (stream) {
      expect((await collect(await gateway.chatStream(messages, options))).join('')).toBe('answer');
    } else {
      expect(await gateway.chat(messages, options)).toMatchObject({
        cost: billing.usd,
        providerBilling: billing,
      });
      expect(await gateway.chat(messages, options)).toMatchObject({ cost: 0, cached: true });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledExactlyOnceWith({
      provider: 'venice',
      model: request.model,
      billing,
    });
  });

  it('gateway returns unknown rather than static-price cost when billing is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(completion)),
    );
    const gateway = new LLMGateway([
      { name: 'venice', apiKey: 'fixture-key', defaultModel: request.model },
    ]);
    expect(await gateway.chat(messages, { provider: 'venice' })).toMatchObject({
      cost: null,
      providerBilling: { usd: null, diem: null },
    });
  });
});
