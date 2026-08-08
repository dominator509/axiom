// Pipeline — chain of transforms applied before/after LLM calls

import type { Message } from './gateway.js';

export interface PipelineTransform {
  name: string;
  before?: (messages: Message[], options: PipelineOptions) => Promise<[Message[], PipelineOptions]>;
  after?: (result: PipelineResult) => Promise<PipelineResult>;
}

export interface PipelineOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

export interface PipelineResult {
  content: string;
  model: string;
  provider: string;
  cost: number;
  tokens: { prompt: number; completion: number; total: number };
  latency: number;
}

export class Pipeline {
  private transforms: PipelineTransform[] = [];

  use(transform: PipelineTransform): this {
    this.transforms.push(transform);
    return this;
  }

  remove(name: string): boolean {
    const idx = this.transforms.findIndex((t) => t.name === name);
    if (idx === -1) return false;
    this.transforms.splice(idx, 1);
    return true;
  }

  async runBefore(
    messages: Message[],
    options: PipelineOptions,
  ): Promise<[Message[], PipelineOptions]> {
    let msgs = messages;
    let opts = options;
    for (const t of this.transforms) {
      if (t.before) {
        [msgs, opts] = await t.before(msgs, opts);
      }
    }
    return [msgs, opts];
  }

  async runAfter(result: PipelineResult): Promise<PipelineResult> {
    let res = result;
    for (const t of this.transforms) {
      if (t.after) {
        res = await t.after(res);
      }
    }
    return res;
  }

  list(): PipelineTransform[] {
    return [...this.transforms];
  }
}
