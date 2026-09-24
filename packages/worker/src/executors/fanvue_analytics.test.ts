import { describe, expect, it, vi } from 'vitest';

vi.mock('@axiom/db', () => ({ schema: {} }));
vi.mock('@axiom/connectors', () => ({ FanvueConnector: class {} }));
vi.mock('../connection.js', () => ({ connectorForTarget: vi.fn() }));
vi.mock('../enqueue.js', () => ({ enqueueJob: vi.fn() }));

import { classifyFanvueContact } from './fanvue_analytics.js';

describe('Fanvue CRM tier mapping', () => {
  it('uses the provider status and top-spender signal without inventing thresholds', () => {
    expect(classifyFanvueContact(true, 'subscriber')).toBe('whale');
    expect(classifyFanvueContact(false, 'subscriber')).toBe('loyal');
    expect(classifyFanvueContact(true, 'expired')).toBe('expired');
    expect(classifyFanvueContact(false, 'follower')).toBe('new');
    expect(classifyFanvueContact(false, undefined)).toBe('new');
  });
});

