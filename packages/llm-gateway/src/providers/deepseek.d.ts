export declare const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
export interface DeepSeekCompletionRequest {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
}
export interface DeepSeekCompletionResponse {
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
export declare function callDeepSeek(apiKey: string, body: DeepSeekCompletionRequest, signal?: AbortSignal): Promise<DeepSeekCompletionResponse>;
export declare function streamDeepSeek(apiKey: string, body: DeepSeekCompletionRequest, signal?: AbortSignal): AsyncIterable<string>;
//# sourceMappingURL=deepseek.d.ts.map