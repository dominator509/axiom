import type {
  ProviderMessage,
  ProviderOptions,
  ProviderChatResult,
  ProviderStreamChunk,
  BaseProvider,
} from './types.js';
import { ProviderError } from './types.js';

// Anthropic Claude pricing (USD per 1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-opus-4-5': { input: 15.0, output: 75.0 },
  'claude-opus-4-5-20251101': { input: 15.0, output: 75.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-sonnet-4': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-latest': { input: 3.0, output: 15.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'claude-3-opus-latest': { input: 15.0, output: 75.0 },
  'claude-3-sonnet-20240229': { input: 3.0, output: 15.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  'claude-3-5-haiku-latest': { input: 0.8, output: 4.0 },
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[model];
  if (pricing) {
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  }
  // Fallback: assume claude-sonnet-4 pricing
  return (inputTokens * 3.0 + outputTokens * 15.0) / 1_000_000;
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { text?: string; stop_reason?: string };
  content_block?: { type: string; text: string };
  message?: {
    usage?: { input_tokens: number; output_tokens: number };
  };
}

/**
 * Convert OpenAI-format messages to Anthropic format.
 * Extracts the system message and uses Anthropic's top-level `system` field.
 * Maps user/assistant roles directly.
 */
function toAnthropicBody(
  model: string,
  messages: ProviderMessage[],
  options?: ProviderOptions,
  stream?: boolean,
): Record<string, unknown> {
  let system: string | undefined;
  const msgs: Array<{ role: string; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = system ? `${system}\n${msg.content}` : msg.content;
    } else {
      msgs.push({ role: msg.role, content: msg.content });
    }
  }

  // Anthropic requires at least one message
  if (msgs.length === 0) {
    msgs.push({ role: 'user', content: 'Hello.' });
  }

  const body: Record<string, unknown> = {
    model,
    messages: msgs,
    max_tokens: options?.maxTokens ?? 4096,
  };

  if (system) body.system = system;
  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (options?.topP !== undefined) body.top_p = options.topP;
  if (options?.stop !== undefined) body.stop_sequences = options.stop;
  if (stream) body.stream = true;

  return body;
}

export class AnthropicProvider implements BaseProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    readonly model: string = 'claude-sonnet-4-5',
    private readonly apiVersion: string = '2023-06-01',
    private readonly baseUrl: string = 'https://api.anthropic.com/v1',
  ) {}

  async chat(
    messages: ProviderMessage[],
    options?: ProviderOptions,
  ): Promise<ProviderChatResult> {
    const body = toAnthropicBody(this.model, messages, options, false);

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(
        `Anthropic API error ${res.status}: ${text}`,
        res.status,
        this.name,
        text,
      );
    }

    const data = (await res.json()) as AnthropicMessageResponse;

    const content = data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const usage = {
      promptTokens: data.usage?.input_tokens ?? estimateTokens(JSON.stringify(messages)),
      completionTokens: data.usage?.output_tokens ?? estimateTokens(content),
      totalTokens: 0,
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
    const body = toAnthropicBody(this.model, messages, options, true);

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(
        `Anthropic stream error ${res.status}: ${text}`,
        res.status,
        this.name,
        text,
      );
    }

    const reader = res.body?.getReader();
    if (!reader) throw new ProviderError('Anthropic stream body is null', 0, this.name);

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let inputTokens = estimateTokens(JSON.stringify(messages));

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

          // Anthropic SSE events look like: event: type\ndata: {...json...}
          if (trimmed.startsWith('event: ')) {
            // Events are followed by a data line — process on the data line
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(trimmed.slice(6)) as AnthropicStreamEvent;

              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                fullContent += parsed.delta.text;
                yield { type: 'delta', content: parsed.delta.text };
              }

              if (parsed.type === 'content_block_start' && parsed.content_block?.text) {
                fullContent += parsed.content_block.text;
                yield { type: 'delta', content: parsed.content_block.text };
              }

              if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
                // Stream ending
                const ct = estimateTokens(fullContent);
                yield {
                  type: 'done',
                  content: fullContent,
                  usage: { promptTokens: inputTokens, completionTokens: ct, totalTokens: inputTokens + ct },
                  cost: calculateCost(this.model, inputTokens, ct),
                };
                return;
              }

              if (parsed.type === 'message_start' && parsed.message?.usage) {
                inputTokens = parsed.message.usage.input_tokens;
              }

              if (parsed.type === 'message_stop') {
                const ct = estimateTokens(fullContent);
                yield {
                  type: 'done',
                  content: fullContent,
                  usage: { promptTokens: inputTokens, completionTokens: ct, totalTokens: inputTokens + ct },
                  cost: calculateCost(this.model, inputTokens, ct),
                };
                return;
              }
            } catch {
              // skip malformed JSON
            }
          }
        }
      }

      // Stream ended without explicit stop event
      const ct = estimateTokens(fullContent);
      yield {
        type: 'done',
        content: fullContent,
        usage: { promptTokens: inputTokens, completionTokens: ct, totalTokens: inputTokens + ct },
        cost: calculateCost(this.model, inputTokens, ct),
      };
    } finally {
      reader.releaseLock();
    }
  }
}

// ---------------------------------------------------------------------------
// Legacy function-level exports (used by gateway.ts)
// ---------------------------------------------------------------------------

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

export interface AnthropicMessageRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
  temperature?: number;
  stream?: boolean;
  system?: string;
}

export interface AnthropicMessageResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export async function callAnthropic(
  apiKey: string,
  body: AnthropicMessageRequest,
  signal?: AbortSignal,
): Promise<AnthropicMessageResponse> {
  const res = await fetch(`${ANTHROPIC_BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`Anthropic API error ${res.status}: ${text}`, res.status, 'anthropic', text);
  }
  return res.json() as Promise<AnthropicMessageResponse>;
}

export async function* streamAnthropic(
  apiKey: string,
  body: AnthropicMessageRequest,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const res = await fetch(`${ANTHROPIC_BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`Anthropic stream error ${res.status}: ${text}`, res.status, 'anthropic', text);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new ProviderError('Anthropic stream body is null', 0, 'anthropic');
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
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            yield parsed.delta.text;
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
