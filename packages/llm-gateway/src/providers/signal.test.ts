import { describe, expect, it, vi } from 'vitest';
import type { BaseProvider } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { GoogleProvider } from './google.js';
import { LightningProvider } from './lightning.js';
import { MistralProvider } from './mistral.js';
import { OpenAIProvider } from './openai.js';
import { VeniceProvider } from './venice.js';
import { VLLMProvider } from './vllm.js';

const completionBody = {
  model: 'test-model',
  choices: [{ message: { role: 'assistant', content: 'ok' } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

const anthropicBody = {
  id: 'msg-test',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'ok' }],
  model: 'test-model',
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

const googleBody = {
  candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
};

const providers: Array<[string, () => BaseProvider, unknown]> = [
  ['openai', () => new OpenAIProvider('test-key'), completionBody],
  ['anthropic', () => new AnthropicProvider('test-key'), anthropicBody],
  ['venice', () => new VeniceProvider('test-key'), completionBody],
  ['mistral', () => new MistralProvider('test-key'), completionBody],
  ['google', () => new GoogleProvider('test-key'), googleBody],
  ['lightning', () => new LightningProvider('test-key'), anthropicBody],
  ['vllm', () => new VLLMProvider(), completionBody],
];

describe('provider cancellation', () => {
  it.each(providers)('forwards ProviderOptions.signal to %s transport', async (_name, create, body) => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
        new Response(JSON.stringify(body)),
    );
    const provider = create();

    await provider.chat([{ role: 'user', content: 'hello' }], {
      signal: controller.signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
