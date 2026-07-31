// ─── MCP auth: Tier / tierAtLeast / capability tokens / authenticateAgent — Vitest Suite ───
import { describe, it, expect } from 'vitest';
import {
  Tier,
  tierAtLeast,
  createCapabilityToken,
  validateToken,
  revokeToken,
  authenticateAgent,
  resolveHighestTier,
  TierResolution,
} from './auth.js';

const MODEL = '11111111-1111-4111-8111-111111111111';

describe('Tier', () => {
  it('has the four expected tiers in ascending privilege', () => {
    expect(Tier.Viewer).toBe('viewer');
    expect(Tier.Operator).toBe('operator');
    expect(Tier.Manager).toBe('manager');
    expect(Tier.Autonomous).toBe('autonomous');
  });
});

describe('tierAtLeast', () => {
  it('allows a tier to satisfy itself', () => {
    expect(tierAtLeast(Tier.Viewer, Tier.Viewer)).toBe(true);
    expect(tierAtLeast(Tier.Autonomous, Tier.Autonomous)).toBe(true);
  });

  it('denies lower tiers access to higher-tier tools', () => {
    expect(tierAtLeast(Tier.Viewer, Tier.Operator)).toBe(false);
    expect(tierAtLeast(Tier.Viewer, Tier.Manager)).toBe(false);
    expect(tierAtLeast(Tier.Viewer, Tier.Autonomous)).toBe(false);
    expect(tierAtLeast(Tier.Operator, Tier.Manager)).toBe(false);
    expect(tierAtLeast(Tier.Operator, Tier.Autonomous)).toBe(false);
    expect(tierAtLeast(Tier.Manager, Tier.Autonomous)).toBe(false);
  });

  it('allows higher tiers access to lower-tier tools', () => {
    expect(tierAtLeast(Tier.Operator, Tier.Viewer)).toBe(true);
    expect(tierAtLeast(Tier.Manager, Tier.Viewer)).toBe(true);
    expect(tierAtLeast(Tier.Manager, Tier.Operator)).toBe(true);
    expect(tierAtLeast(Tier.Autonomous, Tier.Viewer)).toBe(true);
    expect(tierAtLeast(Tier.Autonomous, Tier.Operator)).toBe(true);
    expect(tierAtLeast(Tier.Autonomous, Tier.Manager)).toBe(true);
  });
});

describe('createCapabilityToken / validateToken', () => {
  it('creates a 64-char hex token with a future expiry (default 1h)', () => {
    const token = createCapabilityToken(MODEL, Tier.Manager, 'agent-1');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const perm = validateToken(token);
    expect(perm).not.toBeNull();
    expect(perm!.modelId).toBe(MODEL);
    expect(perm!.tier).toBe(Tier.Manager);
    expect(perm!.agentId).toBe('agent-1');
    expect(perm!.token).toBe(token);
    expect(perm!.scopes).toEqual([]);
    expect(Date.parse(perm!.expiresAt!)).toBeGreaterThan(Date.now());
  });

  it('produces unique tokens on each call', () => {
    const a = createCapabilityToken(MODEL, Tier.Viewer, 'agent-1');
    const b = createCapabilityToken(MODEL, Tier.Viewer, 'agent-1');
    expect(a).not.toBe(b);
  });

  it('respects a custom ttl', () => {
    const token = createCapabilityToken(MODEL, Tier.Operator, 'agent-2', 60_000);
    const perm = validateToken(token)!;
    const remaining = Date.parse(perm.expiresAt!) - Date.now();
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(60_000);
  });

  it('returns null for unknown tokens', () => {
    expect(validateToken('deadbeef'.repeat(8))).toBeNull();
  });

  it('returns null and deletes expired tokens', () => {
    const token = createCapabilityToken(MODEL, Tier.Viewer, 'agent-3', -1000);
    expect(validateToken(token)).toBeNull();
    // second validation still null (token was deleted)
    expect(validateToken(token)).toBeNull();
  });

  it('revokeToken invalidates a previously valid token', () => {
    const token = createCapabilityToken(MODEL, Tier.Manager, 'agent-4');
    expect(validateToken(token)).not.toBeNull();
    revokeToken(token);
    expect(validateToken(token)).toBeNull();
  });
});

describe('authenticateAgent', () => {
  it('authenticates a Bearer token from the authorization header', () => {
    const token = createCapabilityToken(MODEL, Tier.Viewer, 'agent-5');
    const perm = authenticateAgent({ headers: { authorization: `Bearer ${token}` } });
    expect(perm.agentId).toBe('agent-5');
    expect(perm.tier).toBe(Tier.Viewer);
  });

  it('trims whitespace around the bearer token', () => {
    const token = createCapabilityToken(MODEL, Tier.Viewer, 'agent-6');
    const perm = authenticateAgent({ headers: { authorization: `Bearer   ${token}  ` } });
    expect(perm.agentId).toBe('agent-6');
  });

  it('falls back to params.token when no header is present', () => {
    const token = createCapabilityToken(MODEL, Tier.Operator, 'agent-7');
    const perm = authenticateAgent({ params: { token } });
    expect(perm.agentId).toBe('agent-7');
  });

  it('prefers the header token over params.token', () => {
    const headerToken = createCapabilityToken(MODEL, Tier.Manager, 'agent-header');
    const paramToken = createCapabilityToken(MODEL, Tier.Viewer, 'agent-param');
    const perm = authenticateAgent({
      headers: { authorization: `Bearer ${headerToken}` },
      params: { token: paramToken },
    });
    expect(perm.agentId).toBe('agent-header');
  });

  it('does not accept an authorization header without the Bearer prefix', () => {
    const token = createCapabilityToken(MODEL, Tier.Viewer, 'agent-8');
    expect(() =>
      authenticateAgent({ headers: { authorization: `Basic ${token}` } }),
    ).toThrow('Authentication required: no token provided');
  });

  it('throws when no token is provided at all', () => {
    expect(() => authenticateAgent({})).toThrow('Authentication required: no token provided');
    expect(() => authenticateAgent({ headers: {} })).toThrow('Authentication required: no token provided');
  });

  it('throws for an invalid or expired token', () => {
    expect(() => authenticateAgent({ headers: { authorization: 'Bearer not-a-real-token' } }))
      .toThrow('Authentication failed: invalid or expired token');
    const expired = createCapabilityToken(MODEL, Tier.Viewer, 'agent-9', -1);
    expect(() => authenticateAgent({ params: { token: expired } }))
      .toThrow('Authentication failed: invalid or expired token');
  });
});

describe('resolveHighestTier', () => {
  it('returns null when no tokens exist for the model', () => {
    expect(resolveHighestTier('99999999-9999-4999-8999-999999999999')).toBeNull();
  });

  it('returns the highest tier issued across tokens for the model', () => {
    const m = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    createCapabilityToken(m, Tier.Viewer, 'agent-a');
    createCapabilityToken(m, Tier.Manager, 'agent-b');
    createCapabilityToken(m, Tier.Operator, 'agent-c');
    expect(resolveHighestTier(m)).toBe(Tier.Manager);
  });

  it('ignores tokens for other models', () => {
    const m1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const m2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    createCapabilityToken(m1, Tier.Autonomous, 'agent-d');
    expect(resolveHighestTier(m2)).toBeNull();
  });

  it('drops expired tokens from consideration', () => {
    const m = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    createCapabilityToken(m, Tier.Autonomous, 'agent-e', -1);
    createCapabilityToken(m, Tier.Viewer, 'agent-f');
    expect(resolveHighestTier(m)).toBe(Tier.Viewer);
  });
});

describe('TierResolution', () => {
  it('wraps create/validate/authenticate/revoke/highest', () => {
    const tr = new TierResolution();
    const m = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const token = tr.createToken(m, Tier.Operator, 'agent-x');

    const perm = tr.validate(token);
    expect(perm).not.toBeNull();
    expect(perm!.tier).toBe(Tier.Operator);

    const authed = tr.authenticate({ headers: { authorization: `Bearer ${token}` } });
    expect(authed.agentId).toBe('agent-x');

    expect(tr.highestForModel(m)).toBe(Tier.Operator);

    tr.revoke(token);
    expect(tr.validate(token)).toBeNull();
    expect(tr.highestForModel(m)).toBeNull();
  });

  it('validate returns null for unknown tokens', () => {
    expect(new TierResolution().validate('nope')).toBeNull();
  });
});
