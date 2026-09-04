import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: mocks.getAll }),
}));

import { api } from './api';

describe('dashboard server API client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getAll.mockReturnValue([]);
  });

  it('adds an idempotency key to server-side API mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.models.create({ displayName: 'Test model', handle: 'test-model' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Idempotency-Key')).toMatch(/^\S+$/);
    expect(headers.get('content-type')).toBe('application/json');
  });
});
