import { z } from 'zod';

// Official /insights/earnings/summary OpenAPI, retrieved 2026-09-17:
// https://api.fanvue.com/docs/openapi.json (API version 2025-06-26).
// Amounts are USD cents. Net means after platform fees, NOT after reversals
// and NOT withdrawable balance. Never substitute missing observations with 0.
const amount = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const pair = z.object({ gross: amount, net: amount });
const percentage = z.number().finite().nullable();
const instant = z.string().datetime({ offset: true });
const schema = z.object({
  totals: z.object({
    allTime: pair,
    thisMonth: pair.extend({
      previousMonthGross: amount,
      previousMonthNet: amount,
      grossChangePercentage: percentage,
      netChangePercentage: percentage,
    }),
  }),
  breakdownBySource: z.object({
    subs: pair, messages: pair, posts: pair, tips: pair,
    referrals: pair, renewals: pair, other: pair,
  }),
  overTime: z.array(pair.extend({ periodStart: instant })).max(10_000),
  period: z.object({
    startDate: instant.nullable(), endDate: instant.nullable(),
    granularity: z.enum(['day', 'week']), timezone: z.string().min(1).max(100),
  }),
});

/** Deliberate projection: only validated financial fields leave the adapter. */
export type FanvueEarningsSummary = z.infer<typeof schema>;

export function parseFanvueEarningsSummary(value: unknown): FanvueEarningsSummary {
  const result = schema.safeParse(value);
  // Do not expose the response (which may contain personal data) in errors.
  if (!result.success) throw new Error('Fanvue earnings summary has an invalid response contract');
  return result.data;
}
