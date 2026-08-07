import { ProviderError } from './types.js';
// vLLM is a local model server — zero marginal cost
const COST_PER_CHAT = 0;
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
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
/**
 * VLLMProvider — connects to a local vLLM instance serving an OpenAI-compatible API.
 * No API key needed. Zero cost. Privacy-preserving (all data stays local).
 */
export class VLLMProvider {
    model;
    baseUrl;
    name = 'vllm';
    constructor(model = 'local-model', baseUrl = 'http://localhost:8000/v1') {
        this.model = model;
        this.baseUrl = baseUrl;
    }
    async chat(messages, options) {
        const doFetch = options?.fetchImpl ?? fetch;
        const body = {
            model: this.model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            ...(options ? toSnakeCase(options) : {}),
        };
        const res = await doFetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new ProviderError(`vLLM API error ${res.status}: ${text}`, res.status, this.name, text);
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
            cost: COST_PER_CHAT,
        };
    }
    async *chatStream(messages, options) {
        const doFetch = options?.fetchImpl ?? fetch;
        const body = {
            model: this.model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            stream: true,
            ...(options ? toSnakeCase(options) : {}),
        };
        const res = await doFetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new ProviderError(`vLLM stream error ${res.status}: ${text}`, res.status, this.name, text);
        }
        const reader = res.body?.getReader();
        if (!reader)
            throw new ProviderError('vLLM stream body is null', 0, this.name);
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
                            cost: COST_PER_CHAT,
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
                                    cost: COST_PER_CHAT,
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
                                    cost: COST_PER_CHAT,
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
                cost: COST_PER_CHAT,
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
export const VLLM_BASE_URL = 'http://localhost:8000/v1';
export async function callVLLM(body, signal, fetchImpl = fetch) {
    const baseUrl = process.env.VLLM_BASE_URL ?? VLLM_BASE_URL;
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ProviderError(`vLLM API error ${res.status}: ${text}`, res.status, 'vllm', text);
    }
    return res.json();
}
export async function* streamVLLM(body, signal, fetchImpl = fetch) {
    const baseUrl = process.env.VLLM_BASE_URL ?? VLLM_BASE_URL;
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, stream: true }),
        signal,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ProviderError(`vLLM stream error ${res.status}: ${text}`, res.status, 'vllm', text);
    }
    const reader = res.body?.getReader();
    if (!reader)
        throw new ProviderError('vLLM stream body is null', 0, 'vllm');
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
//# sourceMappingURL=vllm.js.map