import { describe, expect, it, vi } from 'vitest';
import { FanvueConnector } from './fanvue.js';
import { parseFanvueEarningsSummary } from './fanvue-earnings.js';

// Contract fixture follows the official OpenAPI example's field structure.
// No provider call, credential, or assertion of live account access.
function summary() {
  const pair = { gross: 1000, net: 800 };
  return {
    totals: {
      allTime: pair,
      thisMonth: { ...pair, previousMonthGross: 0, previousMonthNet: 0,
        grossChangePercentage: null, netChangePercentage: null },
    },
    breakdownBySource: Object.fromEntries(
      ['subs', 'messages', 'posts', 'tips', 'referrals', 'renewals', 'other']
        .map(key => [key, { gross: 0, net: 0 }]),
    ),
    overTime: [{ ...pair, periodStart: '2026-09-01T00:00:00Z' }],
    period: { startDate: null, endDate: null, granularity: 'day', timezone: 'UTC' },
  };
}

describe('Fanvue earnings contract', () => {
  it('uses the bound transport and versioned authenticated self endpoint', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify(summary())));
    const connector = new FanvueConnector({ accessToken: 'contract-test-token' }, transport);
    const result = await connector.fetchEarningsSummary();
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = (transport.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe('https://api.fanvue.com/insights/earnings/summary?timezone=UTC&granularity=day');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer contract-test-token', 'X-Fanvue-API-Version': '2025-06-26' });
    expect(result.totals.allTime.net).toBe(800); // cents preserved, no implicit conversion
    expect(result.totals.thisMonth.netChangePercentage).toBeNull();
  });

  it('projects only known fields and preserves genuine zero', () => {
    const result = parseFanvueEarningsSummary({ ...summary(), privateData: 'omit me' });
    expect(result).not.toHaveProperty('privateData');
    expect(result.breakdownBySource.tips.net).toBe(0);
  });

  it.each([undefined, null, {}, { totals: { gross: 1000 } }])('rejects missing or invented shapes', value => {
    expect(() => parseFanvueEarningsSummary(value)).toThrow('invalid response contract');
  });

  it.each(['1000', -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid money %s', value => {
    const response = summary();
    Object.assign(response.totals.allTime, { gross: value });
    expect(() => parseFanvueEarningsSummary(response)).toThrow('invalid response contract');
  });

  it('does not turn an upstream failure into zero earnings', async () => {
    const transport = vi.fn(async () => new Response('', { status: 403 }));
    await expect(new FanvueConnector({ accessToken: 'contract-test-token' }, transport)
      .fetchEarningsSummary()).rejects.toThrow('403');
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
