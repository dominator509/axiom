import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EGRESS_PLANE_URL,
  isProductionEnvironment,
  requireProductionDatabaseUrl,
  resolveRelaySecret,
} from './runtime-config.js';

describe('production runtime configuration', () => {
  it('uses the Rust egress control-plane listener by default', () => {
    expect(DEFAULT_EGRESS_PLANE_URL).toBe('http://127.0.0.1:9090');
  });

  it('does not require a database URL outside production', () => {
    expect(() => requireProductionDatabaseUrl({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => requireProductionDatabaseUrl({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('treats AXIOM_ENV as the authoritative production selector', () => {
    expect(isProductionEnvironment({ AXIOM_ENV: 'development', NODE_ENV: 'production' })).toBe(
      false,
    );
    expect(isProductionEnvironment({ AXIOM_ENV: 'production', NODE_ENV: 'development' })).toBe(
      true,
    );
    expect(() => requireProductionDatabaseUrl({ AXIOM_ENV: 'production' })).toThrow(
      'DATABASE_URL is required in production',
    );
    expect(() => resolveRelaySecret({ AXIOM_ENV: 'production' })).toThrow(
      'RELAY_SECRET must be at least 32 characters in production',
    );
  });

  it('fails closed when a production database URL is missing or blank', () => {
    expect(() => requireProductionDatabaseUrl({ NODE_ENV: 'production' })).toThrow(
      'DATABASE_URL is required in production',
    );
    expect(() =>
      requireProductionDatabaseUrl({ NODE_ENV: 'production', DATABASE_URL: '   ' }),
    ).toThrow('DATABASE_URL is required in production');
  });

  it('accepts a configured production database URL', () => {
    expect(() =>
      requireProductionDatabaseUrl({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://axiom_app@db.example/axiom',
      }),
    ).not.toThrow();
  });

  it('keeps the existing production relay secret guard', () => {
    expect(() => resolveRelaySecret({ NODE_ENV: 'production' })).toThrow(
      'RELAY_SECRET must be at least 32 characters in production',
    );
  });
});
