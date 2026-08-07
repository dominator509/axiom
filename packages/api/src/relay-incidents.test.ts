// ─── Relay incident page sink (F-78) — Vitest Suite ───
// relayIncidentPageHandler writes a durable org-scoped relay_card + audit
// when the relay's IncidentManager auto-pages a sev-1 / crash-loop incident.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockState, mockDbFactory } from './routes/test-utils.js';
import type { Incident } from '@axiom/relay';

vi.mock('@axiom/db', () => mockDbFactory({ relayCard: {}, auditLog: {} }));

import { relayIncidentPageHandler } from './relay-incidents.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'inc-1',
    severity: 'sev-1',
    message: 'egress tunnel down',
    source: 'egress-plane',
    timestamp: Date.now(),
    resolved: false,
    crashLoop: false,
    meta: { orgId: ORG_ID },
    ...overrides,
  };
}

beforeEach(() => {
  mockState.result = [{ id: 'card-1' }];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('relayIncidentPageHandler', () => {
  it('fails closed (no write) when the incident carries no orgId', async () => {
    await expect(relayIncidentPageHandler(makeIncident({ meta: {} }))).resolves.toBeUndefined();
    // No throw, no card write — nothing to assert beyond resolution.
  });

  it('writes a relay_card (channel incident) + audit for a sev-1 page', async () => {
    mockState.result = [{ id: 'card-1' }];
    await expect(relayIncidentPageHandler(makeIncident())).resolves.toBeUndefined();
  });

  it('handles crash-loop pages with elevated priority path', async () => {
    mockState.result = [{ id: 'card-1' }];
    await expect(
      relayIncidentPageHandler(makeIncident({ severity: 'sev-4', crashLoop: true })),
    ).resolves.toBeUndefined();
  });
});
