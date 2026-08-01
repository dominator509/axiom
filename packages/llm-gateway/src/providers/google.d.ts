import type { ProviderMessage, ProviderOptions, ProviderChatResult, ProviderStreamChunk, BaseProvider } from './types.js';
export declare const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export declare class GoogleProvider implements BaseProvider {
    private readonly apiKey;
    readonly model: string;
    readonly name = "google";
    constructor(apiKey: string, model?: string);
    chat(messages: ProviderMessage[], options?: ProviderOptions): Promise<ProviderChatResult>;
    chatStream(messages: ProviderMessage[], options?: ProviderOptions): AsyncIterable<ProviderStreamChunk>;
}
export interface GoogleGenerateRequest {
    model: string;
    contents: Array<{
        role: 'user' | 'model';
        parts: Array<{
            text: string;
        }>;
    }>;
    systemInstruction?: {
        parts: Array<{
            text: string;
        }>;
    };
    generationConfig?: {
        temperature?: number;
        maxOutputTokens?: number;
        topP?: number;
        stopSequences?: string[];
    };
}
export interface GoogleGenerateResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                text?: string;
            }>;
        };
        finishReason?: string;
    }>;
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
    error?: {
        code: number;
        message: string;
        status: string;
    };
}
export interface OpenAICompatCompletionResponse {
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
export declare function callGoogle(apiKey: string, body: {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    stop?: string[];
}, signal?: AbortSignal): Promise<OpenAICompatCompletionResponse>;
export declare function streamGoogle(apiKey: string, body: {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    stop?: string[];
}, signal?: AbortSignal): AsyncIterable<string>;
//# sourceMappingURL=google.d.ts.map