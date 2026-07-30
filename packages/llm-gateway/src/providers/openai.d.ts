import type { ProviderMessage, ProviderOptions, ProviderChatResult, ProviderStreamChunk, BaseProvider } from './types.js';
export declare class OpenAIProvider implements BaseProvider {
    private readonly apiKey;
    readonly model: string;
    private readonly baseUrl;
    readonly name = "openai";
    constructor(apiKey: string, model?: string, baseUrl?: string);
    chat(messages: ProviderMessage[], options?: ProviderOptions): Promise<ProviderChatResult>;
    chatStream(messages: ProviderMessage[], options?: ProviderOptions): AsyncIterable<ProviderStreamChunk>;
}
export declare const OPENAI_BASE_URL = "https://api.openai.com/v1";
export interface OpenAICompletionRequest {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
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
export declare function callOpenAI(apiKey: string, body: OpenAICompletionRequest, signal?: AbortSignal): Promise<OpenAICompletionResponse>;
export declare function streamOpenAI(apiKey: string, body: OpenAICompletionRequest, signal?: AbortSignal): AsyncIterable<string>;
//# sourceMappingURL=openai.d.ts.map