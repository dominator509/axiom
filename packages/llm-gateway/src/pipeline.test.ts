// ─── Pipeline (before/after transforms) — Vitest Suite ───
import { describe, it, expect, vi } from 'vitest';
import { Pipeline, type PipelineOptions, type PipelineResult } from './pipeline.js';
import type { Message } from './gateway.js';

const messages: Message[] = [
  { role: 'system', content: 'be helpful' },
  { role: 'user', content: 'hi' },
];

const baseResult: PipelineResult = {
  content: 'original',
  model: 'model-1',
  provider: 'openai',
  cost: 0.1,
  tokens: { prompt: 10, completion: 5, total: 15 },
  latency: 42,
};

describe('Pipeline', () => {
  it('use() registers a transform and returns this (chainable)', () => {
    const p = new Pipeline();
    const t = { name: 't1' };
    expect(p.use(t)).toBe(p);
    expect(p.list()).toHaveLength(1);
  });

  it('remove() deletes a transform by name and reports success', () => {
    const p = new Pipeline();
    p.use({ name: 'a' });
    p.use({ name: 'b' });
    expect(p.remove('a')).toBe(true);
    expect(p.list().map(t => t.name)).toEqual(['b']);
    expect(p.remove('missing')).toBe(false);
  });

  it('runBefore applies before-hooks in registration order', async () => {
    const p = new Pipeline();
    const order: string[] = [];
    p.use({
      name: 'first',
      before: async (msgs, opts) => {
        order.push('first');
        return [[{ ...msgs[0], content: 'modified-1' }], { ...opts, model: 'model-a' }];
      },
    });
    p.use({
      name: 'second',
      before: async (msgs, opts) => {
        order.push('second');
        return [msgs, { ...opts, temperature: 0.1 }];
      },
    });

    const [outMsgs, outOpts] = await p.runBefore(messages, { model: 'original' });
    expect(order).toEqual(['first', 'second']);
    expect(outMsgs[0].content).toBe('modified-1');
    expect(outOpts.model).toBe('model-a');
    expect(outOpts.temperature).toBe(0.1);
  });

  it('runBefore passes through unchanged when no before hooks exist', async () => {
    const p = new Pipeline();
    const opts: PipelineOptions = { model: 'm1' };
    const [msgs, outOpts] = await p.runBefore(messages, opts);
    expect(msgs).toBe(messages);
    expect(outOpts).toBe(opts);
  });

  it('runBefore skips transforms without a before hook', async () => {
    const p = new Pipeline();
    const afterOnly = vi.fn();
    p.use({ name: 'after-only', after: afterOnly });
    const [msgs] = await p.runBefore(messages, {});
    expect(msgs).toBe(messages);
    expect(afterOnly).not.toHaveBeenCalled();
  });

  it('runAfter applies after-hooks in registration order', async () => {
    const p = new Pipeline();
    const order: string[] = [];
    p.use({
      name: 'a',
      after: async (r) => {
        order.push('a');
        return { ...r, content: r.content + '-x' };
      },
    });
    p.use({
      name: 'b',
      after: async (r) => {
        order.push('b');
        return { ...r, cost: r.cost * 2 };
      },
    });
    const out = await p.runAfter(baseResult);
    expect(order).toEqual(['a', 'b']);
    expect(out.content).toBe('original-x');
    expect(out.cost).toBe(0.2);
  });

  it('runAfter returns result unchanged when no after hooks exist', async () => {
    const p = new Pipeline();
    const out = await p.runAfter(baseResult);
    expect(out).toBe(baseResult);
  });

  it('runAfter skips transforms without an after hook', async () => {
    const p = new Pipeline();
    const before = vi.fn();
    p.use({ name: 'before-only', before });
    const out = await p.runAfter(baseResult);
    expect(out).toBe(baseResult);
    expect(before).not.toHaveBeenCalled();
  });

  it('chains before then after in a single transform', async () => {
    const p = new Pipeline();
    p.use({
      name: 'both',
      before: async (msgs) => [[...msgs, { role: 'user', content: 'extra' }], {}],
      after: async (r) => ({ ...r, content: r.content.toUpperCase() }),
    });
    const [msgs] = await p.runBefore(messages, {});
    expect(msgs).toHaveLength(3);
    const out = await p.runAfter(baseResult);
    expect(out.content).toBe('ORIGINAL');
  });

  it('list() returns a copy — mutating it does not affect the pipeline', async () => {
    const p = new Pipeline();
    const t = { name: 't1', before: async () => [messages, {}] as [Message[], PipelineOptions] };
    p.use(t);
    const listed = p.list();
    listed.length = 0;
    expect(p.list()).toHaveLength(1);
    // transform still runs
    const [msgs] = await p.runBefore(messages, {});
    expect(msgs).toBe(messages);
  });

  it('propagates errors thrown by before hooks', async () => {
    const p = new Pipeline();
    p.use({
      name: 'boom',
      before: async () => {
        throw new Error('before exploded');
      },
    });
    await expect(p.runBefore(messages, {})).rejects.toThrow('before exploded');
  });

  it('propagates errors thrown by after hooks', async () => {
    const p = new Pipeline();
    p.use({
      name: 'boom',
      after: async () => {
        throw new Error('after exploded');
      },
    });
    await expect(p.runAfter(baseResult)).rejects.toThrow('after exploded');
  });
});
