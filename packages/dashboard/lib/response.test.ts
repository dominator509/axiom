import { expect, it, vi } from 'vitest';
import { readDashboardError, readDashboardJson } from './response';

it('ends stalled dashboard JSON reads after 30 seconds', async () => {
  vi.useFakeTimers();
  try {
    const response = new Response(new ReadableStream());
    const outcome = readDashboardJson(response).catch(error => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await outcome).toMatchObject({ message: 'service JSON response body timed out after 30000ms' });
    expect(response.body?.locked).toBe(false);
  } finally { vi.useRealTimers(); }
});

it('returns the safe error fallback when an error body stalls', async () => {
  vi.useFakeTimers();
  try {
    const outcome = readDashboardError(new Response(new ReadableStream(), { status: 500 }));
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(outcome).resolves.toEqual({});
  } finally { vi.useRealTimers(); }
});
