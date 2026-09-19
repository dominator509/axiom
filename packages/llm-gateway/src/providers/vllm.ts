import type {
  ProviderMessage,
  ProviderOptions,
  ProviderChatResult,
  ProviderStreamChunk,
  BaseProvider,
} from './types.js';
import { ProviderError } from './types.js';
import {
  appendBoundedProviderContent,
  readBoundedProviderSseLines,
  readProviderErrorText,
  readProviderJson,
} from '../bounded-provider-response.js';

// vLLM is a local model server — zero marginal cost
const COST_PER_CHAT = 0;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function toSnakeCase(options: ProviderOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  if (options.topP !== undefined) body.top_p = options.topP;
  if (options.presencePenalty !== undefined) body.presence_penalty = options.presencePenalty;
  if (options.frequencyPenalty !== undefined) body.frequency_penalty = options.frequencyPenalty;
  if (options.stop !== undefined) body.stop = options.stop;
  return body;
}

/**
 * VLLMProvider — connects to a local vLLM instance serving an OpenAI-compatible API.
 * No API key needed. Zero cost. Privacy-preserving (all data stays local).
 */
export class VLLMProvider implements BaseProvider {
  readonly name = 'vllm';

  constructor(
    readonly model: string = 'local-model',
    private readonly baseUrl: string = 'http://localhost:8000/v1',
  ) {}

  async chat(messages: ProviderMessage[], options?: ProviderOptions): Promise<ProviderChatResult> {
    const doFetch = options?.fetchImpl ?? fetch;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ...(options ? toSnakeCase(options) : {}),
    };

    const res = await doFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!res.ok) {
      const text = await readProviderErrorText(res);
      throw new ProviderError(`vLLM API error ${res.status}: ${text}`, res.status, this.name, text);
    }

    const data = await readProviderJson<{
      model: string;
      choices: Array<{
        message: { role: string; content: string | null };
        finish_reason: string;
      }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    }>(res);

    const content = data.choices?.[0]?.message?.content ?? '';
    const usage = {
      promptTokens: data.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages)),
      completionTokens: data.usage?.completion_tokens ?? estimateTokens(content),
      totalTokens: 0,
    };
    usage.totalTokens = usage.promptTokens + usage.completionTokens;

    return {
      content,
      model: data.model ?? this.model,
      usage,
      cost: COST_PER_CHAT,
    };
  }

  async *chatStream(
    messages: ProviderMessage[],
    options?: ProviderOptions,
  ): AsyncIterable<ProviderStreamChunk> {
    const doFetch = options?.fetchImpl ?? fetch;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      ...(options ? toSnakeCase(options) : {}),
    };

    const res = await doFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!res.ok) {
      const text = await readProviderErrorText(res);
      throw new ProviderError(
        `vLLM stream error ${res.status}: ${text}`,
        res.status,
        this.name,
        text,
      );
    }

    const streamBody = res.body;
    if (!streamBody) throw new ProviderError('vLLM stream body is null', 0, this.name);

    let fullContent = '';

    for await (const line of readBoundedProviderSseLines(streamBody, 'vLLM stream')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed === 'data: [DONE]') {
        const pt = estimateTokens(JSON.stringify(messages));
        const ct = estimateTokens(fullContent);
        yield {
          type: 'done',
          content: fullContent,
          usage: { promptTokens: pt, completionTokens: ct, totalTokens: pt + ct },
          cost: COST_PER_CHAT,
        };
        return;
      }

      if (trimmed.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(trimmed.slice(6)) as {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string;
            }>;
            usage?: {
              prompt_tokens: number;
              completion_tokens: number;
              total_tokens: number;
            };
          };

          if (parsed.usage) {
            const pt = parsed.usage.prompt_tokens;
            const ct = parsed.usage.completion_tokens;
            yield {
              type: 'done',
              content: fullContent,
              usage: {
                promptTokens: pt,
                completionTokens: ct,
                totalTokens: parsed.usage.total_tokens,
              },
              cost: COST_PER_CHAT,
            };
            return;
          }

          const delta = parsed.choices?.[0]?.delta?.content;
          const finishReason = parsed.choices?.[0]?.finish_reason;

          if (delta) {
            fullContent = appendBoundedProviderContent(fullContent, delta);
            yield { type: 'delta', content: delta };
          }

          if (finishReason && finishReason !== 'null') {
            const pt = estimateTokens(JSON.stringify(messages));
            const ct = estimateTokens(fullContent);
            yield {
              type: 'done',
              content: fullContent,
              usage: { promptTokens: pt, completionTokens: ct, totalTokens: pt + ct },
              cost: COST_PER_CHAT,
            };
            return;
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes('maximum supported size')) {
            throw error;
          }
          // skip malformed JSON
        }
      }
    }

    // Stream ended without done signal
    const pt = estimateTokens(JSON.stringify(messages));
    const ct = estimateTokens(fullContent);
    yield {
      type: 'done',
      content: fullContent,
      usage: { promptTokens: pt, completionTokens: ct, totalTokens: pt + ct },
      cost: COST_PER_CHAT,
    };
  }
}

// ---------------------------------------------------------------------------
// Legacy function-level exports (used by gateway.ts)
// ---------------------------------------------------------------------------

export const VLLM_BASE_URL = 'http://localhost:8000/v1';

export interface VLLMCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface VLLMCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
export async function callVLLM(
  body: VLLMCompletionRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<VLLMCompletionResponse> {
  const baseUrl = process.env.VLLM_BASE_URL ?? VLLM_BASE_URL;
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await readProviderErrorText(res);
    throw new ProviderError(`vLLM API error ${res.status}: ${text}`, res.status, 'vllm', text);
  }
  return readProviderJson<VLLMCompletionResponse>(res);
}

export async function* streamVLLM(
  body: VLLMCompletionRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): AsyncIterable<string> {
  const baseUrl = process.env.VLLM_BASE_URL ?? VLLM_BASE_URL;
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) {
    const text = await readProviderErrorText(res);
    throw new ProviderError(`vLLM stream error ${res.status}: ${text}`, res.status, 'vllm', text);
  }
  const streamBody = res.body;
  if (!streamBody) throw new ProviderError('vLLM stream body is null', 0, 'vllm');
  for await (const line of readBoundedProviderSseLines(streamBody, 'vLLM stream')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'data: [DONE]') continue;
    if (trimmed.startsWith('data: ')) {
      try {
        const parsed = JSON.parse(trimmed.slice(6));
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // skip malformed lines
      }
    }
  }
}
