import type { ProviderMessage, ProviderOptions, ProviderChatResult, ProviderStreamChunk, BaseProvider } from './types.js';
export declare class VeniceProvider implements BaseProvider {
    private readonly apiKey;
    readonly model: string;
    private readonly baseUrl;
    readonly name = "venice";
    constructor(apiKey: string, model?: string, baseUrl?: string);
    chat(messages: ProviderMessage[], options?: ProviderOptions): Promise<ProviderChatResult>;
    chatStream(messages: ProviderMessage[], options?: ProviderOptions): AsyncIterable<ProviderStreamChunk>;
}
export declare const VENICE_BASE_URL = "https://api.venice.ai/api/v1";
export interface VeniceCompletionRequest {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    venice_parameters?: Record<string, unknown>;
}
export interface VeniceCompletionResponse {
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
export declare function callVenice(apiKey: string, body: VeniceCompletionRequest, signal?: AbortSignal): Promise<VeniceCompletionResponse>;
export declare function streamVenice(apiKey: string, body: VeniceCompletionRequest, signal?: AbortSignal): AsyncIterable<string>;
//# sourceMappingURL=venice.d.ts.map