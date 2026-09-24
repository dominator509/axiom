import { describe, expect, it, beforeEach, vi } from 'vitest';
import { makeChain, mockState, mockDbFactory } from './routes/test-utils.js';

vi.mock('@axiom/db', () => mockDbFactory({ relayCommand: {} }));

import { relayCommandAlreadyRecorded } from './relay-command-guard.js';

describe('relayCommandAlreadyRecorded', () => {
  beforeEach(() => {
    mockState.result = [];
    mockState.results = [];
  });

  it('allows an action that has no durable command row', async () => {
    await expect(
      relayCommandAlreadyRecorded(
        makeChain(),
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'approve',
      ),
    ).resolves.toBe(false);
  });

  it('recognizes an action already recorded in the durable ledger', async () => {
    mockState.result = [{ id: 'command-1' }];
    await expect(
      relayCommandAlreadyRecorded(
        makeChain(),
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'approve',
      ),
    ).resolves.toBe(true);
  });
});
