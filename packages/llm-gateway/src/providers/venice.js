import { ProviderError } from './types.js';
// Venice.ai pricing — generally free/uncensored models
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
function calculateCost(_promptTokens, _completionTokens) {
    return 0;
}
function toSnakeCase(options) {
    const body = {};
    if (options.temperature !== undefined)
        body.temperature = options.temperature;
    if (options.maxTokens !== undefined)
        body.max_tokens = options.maxTokens;
    if (options.topP !== undefined)
        body.top_p = options.topP;
    if (options.presencePenalty !== undefined)
        body.presence_penalty = options.presencePenalty;
    if (options.frequencyPenalty !== undefined)
        body.frequency_penalty = options.frequencyPenalty;
    if (options.stop !== undefined)
        body.stop = options.stop;
    return body;
}
export class VeniceProvider {
    apiKey;
    model;
    baseUrl;
    name = 'venice';
    constructor(apiKey, model = 'venice-xl', baseUrl = 'https://api.venice.ai/api/v1') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl;
    }
    async chat(messages, options) {
        const body = {
            model: this.model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            ...(options ? toSnakeCase(options) : {}),
        };
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new ProviderError(`Venice API error ${res.status}: ${text}`, res.status, this.name, text);
        }
        const data = (await res.json());
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
            cost: calculateCost(usage.promptTokens, usage.completionTokens),
        };
    }
    async *chatStream(messages, options) {
        const body = {
            model: this.model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            stream: true,
            ...(options ? toSnakeCase(options) : {}),
        };
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new ProviderError(`Venice stream error ${res.status}: ${text}`, res.status, this.name, text);
        }
        const reader = res.body?.getReader();
        if (!reader)
            throw new ProviderError('Venice stream body is null', 0, this.name);
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed)
                        continue;
                    if (trimmed === 'data: [DONE]') {
                        const pt = estimateTokens(JSON.stringify(messages));
                        const ct = estimateTokens(fullContent);
                        yield {
                            type: 'done',
                            content: fullContent,
                            usage: { promptTokens: pt, completionTokens: ct, totalTokens: pt + ct },
                            cost: calculateCost(pt, ct),
                        };
                        return;
                    }
                    if (trimmed.startsWith('data: ')) {
                        try {
                            const parsed = JSON.parse(trimmed.slice(6));
                            if (parsed.usage) {
                                const pt = parsed.usage.prompt_tokens;
                                const ct = parsed.usage.completion_tokens;
                                yield {
                                    type: 'done',
                                    content: fullContent,
                                    usage: { promptTokens: pt, completionTokens: ct, totalTokens: parsed.usage.total_tokens },
                                    cost: calculateCost(pt, ct),
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
                                    cost: calculateCost(pt, ct),
                                };
                                return;
                            }
                        }
                        catch {
                            // skip malformed JSON
                        }
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
                cost: calculateCost(pt, ct),
            };
        }
        finally {
            reader.releaseLock();
        }
    }
}
// ---------------------------------------------------------------------------
// Legacy function-level exports (used by gateway.ts)
// ---------------------------------------------------------------------------
export const VENICE_BASE_URL = 'https://api.venice.ai/api/v1';
export async function callVenice(apiKey, body, signal) {
    const baseUrl = process.env.VENICE_BASE_URL ?? VENICE_BASE_URL;
    const res = await fetch(`${baseUrl}/chat/completions`, {
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
        throw new ProviderError(`Venice API error ${res.status}: ${text}`, res.status, 'venice', text);
    }
    return res.json();
}
export async function* streamVenice(apiKey, body, signal) {
    const baseUrl = process.env.VENICE_BASE_URL ?? VENICE_BASE_URL;
    const res = await fetch(`${baseUrl}/chat/completions`, {
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
        throw new ProviderError(`Venice stream error ${res.status}: ${text}`, res.status, 'venice', text);
    }
    const reader = res.body?.getReader();
    if (!reader)
        throw new ProviderError('Venice stream body is null', 0, 'venice');
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]')
                    continue;
                if (trimmed.startsWith('data: ')) {
                    try {
                        const parsed = JSON.parse(trimmed.slice(6));
                        const delta = parsed.choices?.[0]?.delta?.content;
                        if (delta)
                            yield delta;
                    }
                    catch {
                        // skip malformed lines
                    }
                }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
//# sourceMappingURL=venice.js.map