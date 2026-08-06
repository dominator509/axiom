import type {
  ProviderMessage,
  ProviderOptions,
  ProviderChatResult,
  ProviderStreamChunk,
  BaseProvider,
} from './types.js';
import { ProviderError } from './types.js';

// Known model pricing (USD per 1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-2024-08-06': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1-preview': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 1.1, output: 4.4 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'grok-2': { input: 2.0, output: 10.0 },
  'grok-2-latest': { input: 2.0, output: 10.0 },
  'grok-beta': { input: 5.0, output: 15.0 },
};

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English text
  return Math.ceil(text.length / 4);
}

function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = MODEL_PRICING[model];
  if (pricing) {
    return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
  }
  // Fallback: assume gpt-4o pricing
  return (promptTokens * 2.5 + completionTokens * 10.0) / 1_000_000;
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

export class OpenAIProvider implements BaseProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    readonly model: string = 'gpt-4o',
    private readonly baseUrl: string = 'https://api.openai.com/v1',
  ) {}

  async chat(
    messages: ProviderMessage[],
    options?: ProviderOptions,
  ): Promise<ProviderChatResult> {
    const doFetch = options?.fetchImpl ?? fetch;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ...(options ? toSnakeCase(options) : {}),
    };

    const res = await doFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(
        `OpenAI API error ${res.status}: ${text}`,
        res.status,
        this.name,
        text,
      );
    }

    const data = (await res.json()) as {
      model: string;
      choices: Array<{
        message: { role: string; content: string | null };
        finish_reason: string;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    const content = data.choices?.[0]?.message?.content ?? '';
    const usage = {
      promptTokens: data.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages)),
      completionTokens: data.usage?.completion_tokens ?? estimateTokens(content),
      totalTokens: data.usage?.total_tokens ?? 0,
    };
    usage.totalTokens = usage.promptTokens + usage.completionTokens;

    return {
      content,
      model: data.model ?? this.model,
      usage,
      cost: calculateCost(this.model, usage.promptTokens, usage.completionTokens),
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
      stream_options: { include_usage: true },
      ...(options ? toSnakeCase(options) : {}),
    };

    const res = await doFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(
        `OpenAI stream error ${res.status}: ${text}`,
        res.status,
        this.name,
        text,
      );
    }

    const reader = res.body?.getReader();
    if (!reader) throw new ProviderError('OpenAI stream body is null', 0, this.name);

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed === 'data: [DONE]') {
            yield {
              type: 'done',
              content: fullContent,
              usage: {
                promptTokens: estimateTokens(JSON.stringify(messages)),
                completionTokens: estimateTokens(fullContent),
                totalTokens: estimateTokens(JSON.stringify(messages)) + estimateTokens(fullContent),
              },
              cost: calculateCost(
                this.model,
                estimateTokens(JSON.stringify(messages)),
                estimateTokens(fullContent),
              ),
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

              // Final chunk with usage data
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
                  cost: calculateCost(this.model, pt, ct),
                };
                return;
              }

              const delta = parsed.choices?.[0]?.delta?.content;
              const finishReason = parsed.choices?.[0]?.finish_reason;

              if (delta) {
                fullContent += delta;
                yield { type: 'delta', content: delta };
              }

              if (finishReason && finishReason !== 'null') {
                const pt = estimateTokens(JSON.stringify(messages));
                const ct = estimateTokens(fullContent);
                yield {
                  type: 'done',
                  content: fullContent,
                  usage: { promptTokens: pt, completionTokens: ct, totalTokens: pt + ct },
                  cost: calculateCost(this.model, pt, ct),
                };
                return;
              }
            } catch {
              // skip malformed JSON lines
            }
          }
        }
      }

      // Stream ended without explicit done — emit final
      const pt = estimateTokens(JSON.stringify(messages));
      const ct = estimateTokens(fullContent);
      yield {
        type: 'done',
        content: fullContent,
        usage: { promptTokens: pt, completionTokens: ct, totalTokens: pt + ct },
        cost: calculateCost(this.model, pt, ct),
      };
    } finally {
      reader.releaseLock();
    }
  }
}

// ---------------------------------------------------------------------------
// Legacy function-level exports (used by gateway.ts)
// ---------------------------------------------------------------------------

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export interface OpenAICompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface OpenAICompletionResponse {
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
export async function callOpenAI(
  apiKey: string,
  body: OpenAICompletionRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenAICompletionResponse> {
  const baseUrl = process.env.OPENAI_BASE_URL ?? OPENAI_BASE_URL;
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`OpenAI API error ${res.status}: ${text}`, res.status, 'openai', text);
  }
  return res.json() as Promise<OpenAICompletionResponse>;
}

export async function* streamOpenAI(
  apiKey: string,
  body: OpenAICompletionRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): AsyncIterable<string> {
  const baseUrl = process.env.OPENAI_BASE_URL ?? OPENAI_BASE_URL;
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`OpenAI stream error ${res.status}: ${text}`, res.status, 'openai', text);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new ProviderError('OpenAI stream body is null', 0, 'openai');
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
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
  } finally {
    reader.releaseLock();
  }
}
