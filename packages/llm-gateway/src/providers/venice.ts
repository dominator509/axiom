import type {
  ProviderMessage,
  ProviderOptions,
  ProviderChatResult,
  ProviderStreamChunk,
  BaseProvider,
} from './types.js';
import { ProviderError } from './types.js';
import {
  normalizeVeniceBilling,
  observeProviderBilling,
  type ProviderBillingObserver,
} from '../provider-billing.js';
import {
  readBoundedProviderSseLines,
  readProviderErrorText,
  readProviderJson,
} from '../bounded-provider-response.js';

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

export class VeniceProvider implements BaseProvider {
  readonly name = 'venice';

  constructor(
    private readonly apiKey: string,
    readonly model: string = 'venice-uncensored-1-2',
    private readonly baseUrl: string = 'https://api.venice.ai/api/v1',
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!res.ok) {
      const text = await readProviderErrorText(res);
      throw new ProviderError(
        `Venice API error ${res.status}: ${text}`,
        res.status,
        this.name,
        text,
      );
    }

    const data = await readProviderJson<{
      model: string;
      choices: Array<{
        message: { role: string; content: string | null };
        finish_reason: string;
      }>;
      cost?: unknown;
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
      cost: normalizeVeniceBilling(data.cost).usd,
      providerBilling: normalizeVeniceBilling(data.cost),
    };
  }

  async *chatStream(
    messages: ProviderMessage[],
    options?: ProviderOptions,
  ): AsyncIterable<ProviderStreamChunk> {
    const body = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ...(options ? toSnakeCase(options) : {}),
    };
    const res = await requestVeniceStream(
      this.apiKey,
      body,
      options?.signal,
      options?.fetchImpl ?? fetch,
      this.baseUrl,
    );
    let content = '';
    let usage: ProviderChatResult['usage'] | undefined;
    let billing = normalizeVeniceBilling(undefined);
    for await (const event of veniceStreamEvents(res)) {
      if (event.usage) usage = event.usage;
      if (event.billing) billing = event.billing;
      if (event.delta) {
        content += event.delta;
        yield { type: 'delta', content: event.delta };
      }
    }
    const pt = estimateTokens(JSON.stringify(messages));
    const ct = estimateTokens(content);
    yield {
      type: 'done',
      content,
      usage: usage ?? { promptTokens: pt, completionTokens: ct, totalTokens: pt + ct },
      cost: billing.usd,
      providerBilling: billing,
    };
  }
}

// ---------------------------------------------------------------------------
// Legacy function-level exports (used by gateway.ts)
// ---------------------------------------------------------------------------

export const VENICE_BASE_URL = 'https://api.venice.ai/api/v1';

export interface VeniceCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  venice_parameters?: Record<string, unknown>;
}

export interface VeniceCompletionResponse {
  cost?: unknown;
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
export async function callVenice(
  apiKey: string,
  body: VeniceCompletionRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<VeniceCompletionResponse> {
  const baseUrl = process.env.VENICE_BASE_URL ?? VENICE_BASE_URL;
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
    const text = await readProviderErrorText(res);
    throw new ProviderError(`Venice API error ${res.status}: ${text}`, res.status, 'venice', text);
  }
  return readProviderJson<VeniceCompletionResponse>(res);
}

async function requestVeniceStream(
  apiKey: string,
  body: VeniceCompletionRequest,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
  baseUrl = process.env.VENICE_BASE_URL ?? VENICE_BASE_URL,
): Promise<Response> {
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
    signal,
  });
  if (!res.ok) {
    const text = await readProviderErrorText(res);
    throw new ProviderError(
      `Venice stream error ${res.status}: ${text}`,
      res.status,
      'venice',
      text,
    );
  }
  return res;
}

async function* veniceStreamEvents(res: Response) {
  if (!res.body) throw new ProviderError('Venice stream body is null', 0, 'venice');
  for await (const line of readBoundedProviderSseLines(res.body, 'Venice SSE stream')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') return;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const delta = parsed.choices?.[0]?.delta?.content;
    const rawUsage = parsed.usage;
    const validTokens = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
    const usage =
      rawUsage &&
      [rawUsage.prompt_tokens, rawUsage.completion_tokens, rawUsage.total_tokens].every(validTokens)
        ? {
            promptTokens: rawUsage.prompt_tokens as number,
            completionTokens: rawUsage.completion_tokens as number,
            totalTokens: rawUsage.total_tokens as number,
          }
        : undefined;
    yield {
      delta: typeof delta === 'string' ? delta : undefined,
      usage,
      billing: Object.hasOwn(parsed, 'cost') ? normalizeVeniceBilling(parsed.cost) : undefined,
    };
    // finish_reason is not end-of-stream: usage/cost may follow it.
  }
}

export async function* streamVenice(
  apiKey: string,
  body: VeniceCompletionRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  observer?: ProviderBillingObserver,
): AsyncIterable<string> {
  const res = await requestVeniceStream(apiKey, body, signal, fetchImpl);
  let billing = normalizeVeniceBilling(undefined);
  for await (const event of veniceStreamEvents(res)) {
    if (event.billing) billing = event.billing;
    if (event.delta) yield event.delta;
  }
  await observeProviderBilling(observer, 'venice', body.model, billing);
}
