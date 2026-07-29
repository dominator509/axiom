// Shared types for LLM Gateway providers

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string[];
}

export interface ProviderChatResult {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  cost: number;
}

export interface ProviderStreamChunk {
  type: 'text' | 'delta' | 'done';
  content?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  cost?: number;
}

export interface BaseProvider {
  readonly name: string;
  readonly model: string;
  chat(messages: ProviderMessage[], options?: ProviderOptions): Promise<ProviderChatResult>;
  chatStream(messages: ProviderMessage[], options?: ProviderOptions): AsyncIterable<ProviderStreamChunk>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly provider: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
