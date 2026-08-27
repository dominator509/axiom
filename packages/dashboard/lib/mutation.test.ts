import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mutationFetch } from './mutation';

describe('mutationFetch', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reuses one idempotency key across a network retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await mutationFetch('/api/v1/mutate', { method: 'POST', body: '{}' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers;
    const secondHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Headers;
    expect(firstHeaders.get('Idempotency-Key')).toBeTruthy();
    expect(secondHeaders.get('Idempotency-Key')).toBe(firstHeaders.get('Idempotency-Key'));
  });

  it('preserves an explicit intent key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await mutationFetch('/api/v1/mutate', { method: 'POST' }, { idempotencyKey: 'intent-1' });

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers;
    expect(headers.get('Idempotency-Key')).toBe('intent-1');
  });
});
