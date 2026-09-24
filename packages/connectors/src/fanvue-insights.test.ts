import { describe, expect, it } from 'vitest';
import {
  parseFanvueEarningsPage,
  parseFanvueFanInsights,
  parseFanvueSmartLists,
  parseFanvueSubscriberEvents,
  parseFanvueTopSpenders,
  parseFanvueUnreadCounts,
} from './fanvue-insights.js';

const user = {
  uuid: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  handle: 'sarah-jones',
  displayName: 'Sarah Jones',
  nickname: null,
  isTopSpender: true,
  registeredAt: '2024-01-10T12:00:00.000Z',
};

describe('Fanvue analytics projections', () => {
  it('accepts the documented top-spender page and strips unneeded provider fields', () => {
    const result = parseFanvueTopSpenders({
      data: [{ gross: 15000, net: 12750, messages: 342, user: { ...user, avatarUrl: 'https://provider.invalid/avatar' } }],
      pagination: { page: 1, size: 1, hasMore: false },
      privatePayload: 'must not escape',
    });
    expect(result.data[0].user).not.toHaveProperty('avatarUrl');
    expect(result).not.toHaveProperty('privatePayload');
  });

  it('keeps subscriber events separate from the current subscriber snapshot', () => {
    const result = parseFanvueSubscriberEvents({
      data: [{ date: '2026-09-01T00:00:00.000Z', total: 8, newSubscribersCount: 10, cancelledSubscribersCount: 2 }],
      nextCursor: null,
    });
    expect(result.data[0].total).toBe(8);
  });

  it('accepts earnings transaction facts, including a reversal', () => {
    const result = parseFanvueEarningsPage({
      data: [{
        date: '2026-09-01T00:00:00.000Z', gross: -500, net: -425, currency: 'USD',
        source: 'refund', transactionOrderId: 'FV-ORDER-1', transactionOrderStatus: 'availableForPayout', user,
      }],
      nextCursor: null,
    });
    expect(result.data[0].net).toBe(-425);
  });

  it('projects the smart-list subscriber count and unread observations', () => {
    expect(parseFanvueSmartLists([
      { name: 'Subscribers', uuid: 'subscribers', count: 1250 },
      { name: 'Expired subscribers', uuid: 'expired_subscribers', count: 178 },
    ])).toHaveLength(2);
    expect(parseFanvueUnreadCounts({
      unreadChatsCount: 5,
      unreadMessagesCount: 12,
      unreadNotifications: {
        newFollower: 3, newPostComment: 2, newPostLike: 8,
        newPurchase: 1, newSubscriber: 4, newTip: 2, newPromotion: 0,
      },
    }).unreadMessagesCount).toBe(12);
  });

  it('rejects incomplete or invented provider contracts', () => {
    expect(() => parseFanvueTopSpenders({ data: [], pagination: { page: 1, size: 0, hasMore: false } })).not.toThrow();
    expect(() => parseFanvueTopSpenders({ data: [{ gross: 1 }], pagination: { page: 1, size: 1, hasMore: false } })).toThrow('invalid response contract');
    expect(() => parseFanvueFanInsights({ results: { [user.uuid]: { status: 'subscriber' } } })).toThrow('invalid response contract');
  });
});

