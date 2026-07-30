import type { ProviderMessage, ProviderOptions, ProviderChatResult, ProviderStreamChunk, BaseProvider } from './types.js';
/**
 * VLLMProvider — connects to a local vLLM instance serving an OpenAI-compatible API.
 * No API key needed. Zero cost. Privacy-preserving (all data stays local).
 */
export declare class VLLMProvider implements BaseProvider {
    readonly model: string;
    private readonly baseUrl;
    readonly name = "vllm";
    constructor(model?: string, baseUrl?: string);
    chat(messages: ProviderMessage[], options?: ProviderOptions): Promise<ProviderChatResult>;
    chatStream(messages: ProviderMessage[], options?: ProviderOptions): AsyncIterable<ProviderStreamChunk>;
}
export declare const VLLM_BASE_URL = "http://localhost:8000/v1";
export interface VLLMCompletionRequest {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
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
        message: {
            role: string;
            content: string | null;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
export declare function callVLLM(body: VLLMCompletionRequest, signal?: AbortSignal): Promise<VLLMCompletionResponse>;
export declare function streamVLLM(body: VLLMCompletionRequest, signal?: AbortSignal): AsyncIterable<string>;
//# sourceMappingURL=vllm.d.ts.map