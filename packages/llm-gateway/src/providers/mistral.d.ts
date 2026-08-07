import type { ProviderMessage, ProviderOptions, ProviderChatResult, ProviderStreamChunk, BaseProvider } from './types.js';
export declare const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
export declare class MistralProvider implements BaseProvider {
    private readonly apiKey;
    readonly model: string;
    readonly name = "mistral";
    constructor(apiKey: string, model?: string);
    chat(messages: ProviderMessage[], options?: ProviderOptions): Promise<ProviderChatResult>;
    chatStream(messages: ProviderMessage[], options?: ProviderOptions): AsyncIterable<ProviderStreamChunk>;
}
export interface MistralCompletionRequest {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
}
export interface MistralCompletionResponse {
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
export declare function callMistral(apiKey: string, body: MistralCompletionRequest, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<MistralCompletionResponse>;
export declare function streamMistral(apiKey: string, body: MistralCompletionRequest, signal?: AbortSignal, fetchImpl?: typeof fetch): AsyncIterable<string>;
//# sourceMappingURL=mistral.d.ts.map