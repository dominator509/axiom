import { z } from 'zod';

// These schemas intentionally project only fields needed by the CRM/metrics
// pipeline.  Provider payloads are never returned to callers or persisted.
const nonNegativeAmount = z.number().finite().max(Number.MAX_SAFE_INTEGER);
const nonNegativeCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.string().datetime({ offset: true });

const fanUser = z.object({
  uuid: z.string().uuid(),
  handle: z.string().min(1).max(200),
  displayName: z.string().min(1).max(300),
  nickname: z.string().max(300).nullable(),
  isTopSpender: z.boolean(),
  registeredAt: instant.optional(),
});

const topSpendersPageSchema = z.object({
  data: z.array(z.object({
    gross: nonNegativeAmount,
    net: nonNegativeAmount,
    messages: nonNegativeCount,
    user: fanUser,
  })).max(50),
  pagination: z.object({
    page: z.number().int().positive(),
    size: z.number().int().nonnegative().max(50),
    hasMore: z.boolean(),
  }),
});

const subscriberEventsPageSchema = z.object({
  data: z.array(z.object({
    date: instant,
    total: z.number().int().max(Number.MAX_SAFE_INTEGER),
    newSubscribersCount: nonNegativeCount,
    cancelledSubscribersCount: nonNegativeCount,
  })).max(50),
  nextCursor: z.string().min(1).max(2048).nullable(),
});

const earningsPageSchema = z.object({
  data: z.array(z.object({
    date: instant,
    gross: z.number().finite().max(Number.MAX_SAFE_INTEGER).min(-Number.MAX_SAFE_INTEGER),
    net: z.number().finite().max(Number.MAX_SAFE_INTEGER).min(-Number.MAX_SAFE_INTEGER),
    currency: z.string().length(3),
    source: z.enum(['subscription', 'tip', 'message', 'post', 'refund', 'referral', 'affiliate', 'other']),
    transactionOrderId: z.string().min(1).max(200),
    transactionOrderStatus: z.string().min(1).max(100),
    user: fanUser.nullable(),
  })).max(50),
  nextCursor: z.string().min(1).max(2048).nullable(),
});

const smartListsSchema = z.array(z.object({
  name: z.string().min(1).max(200),
  uuid: z.enum([
    'subscribers', 'auto_renewing', 'non_renewing', 'followers',
    'free_trial_subscribers', 'expired_subscribers', 'spent_more_than_50',
    'muted', 'creators',
  ]),
  count: nonNegativeCount,
})).max(100);

const fanInsightSchema = z.object({
  status: z.enum(['subscriber', 'expired', 'follower', 'not_contactable']),
  spending: z.object({
    lastValidPurchaseAt: instant.nullable(),
    total: z.object({
      total: z.number().finite().max(Number.MAX_SAFE_INTEGER).min(-Number.MAX_SAFE_INTEGER),
      netTotal: z.number().finite().max(Number.MAX_SAFE_INTEGER).min(-Number.MAX_SAFE_INTEGER),
    }),
  }),
});

const fanInsightsSchema = z.object({
  results: z.record(z.string().uuid(), fanInsightSchema.nullable()),
});

const unreadCountsSchema = z.object({
  unreadChatsCount: nonNegativeCount,
  unreadMessagesCount: nonNegativeCount,
  unreadNotifications: z.object({
    newFollower: nonNegativeCount,
    newPostComment: nonNegativeCount,
    newPostLike: nonNegativeCount,
    newPurchase: nonNegativeCount,
    newSubscriber: nonNegativeCount,
    newTip: nonNegativeCount,
    newPromotion: nonNegativeCount,
  }),
});

export type FanvueTopSpender = z.infer<typeof topSpendersPageSchema>['data'][number];
export type FanvueTopSpendersPage = z.infer<typeof topSpendersPageSchema>;
export type FanvueSubscriberEventsPage = z.infer<typeof subscriberEventsPageSchema>;
export type FanvueEarningsPage = z.infer<typeof earningsPageSchema>;
export type FanvueSmartList = z.infer<typeof smartListsSchema>[number];
export type FanvueFanInsight = z.infer<typeof fanInsightSchema>;
export type FanvueUnreadCounts = z.infer<typeof unreadCountsSchema>;

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`Fanvue ${label} has an invalid response contract`);
  return result.data;
}

export function parseFanvueTopSpenders(value: unknown): FanvueTopSpendersPage {
  return parse(topSpendersPageSchema, value, 'top-spenders response');
}

export function parseFanvueSubscriberEvents(value: unknown): FanvueSubscriberEventsPage {
  return parse(subscriberEventsPageSchema, value, 'subscriber-events response');
}

export function parseFanvueEarningsPage(value: unknown): FanvueEarningsPage {
  return parse(earningsPageSchema, value, 'earnings response');
}

export function parseFanvueSmartLists(value: unknown): FanvueSmartList[] {
  return parse(smartListsSchema, value, 'smart-lists response');
}

export function parseFanvueFanInsights(value: unknown): Record<string, FanvueFanInsight | null> {
  return parse(fanInsightsSchema, value, 'fan-insights response').results;
}

export function parseFanvueUnreadCounts(value: unknown): FanvueUnreadCounts {
  return parse(unreadCountsSchema, value, 'unread-counts response');
}

