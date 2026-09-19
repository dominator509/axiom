import { describe, expect, it, vi } from 'vitest';

const dotenvConfig = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('A library import must not load repository credentials');
  }),
);
vi.mock('dotenv', () => ({ default: { config: dotenvConfig }, config: dotenvConfig }));

describe('gateway environment boundary', () => {
  it('imports the public gateway without reading dotenv configuration or changing process.env', async () => {
    const before = { ...process.env };
    const { LLMGateway } = await import('./index.js');
    expect(typeof LLMGateway).toBe('function');
    expect(dotenvConfig).not.toHaveBeenCalled();
    expect(process.env).toEqual(before);
  });
});
