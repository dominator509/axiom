import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Table } from 'drizzle-orm';
import * as schema from './schema/index.js';

/** Resolve a table's SQL name via the runtime symbol map. */
function tableName(table: any): string {
  return (table as any)[T.Name];
}

const migrationPath = new URL('../migrations/0000_initial.sql', import.meta.url);
let sql = '';

// TS export name -> SQL table name
const TS_TO_SQL: Record<string, string> = {
  org: 'org',
  appUser: 'app_user',
  modelProfile: 'model_profile',
  consentRecord: 'consent_record',
  platformConnection: 'platform_connection',
  asset: 'asset',
  contentBundle: 'content_bundle',
  postTarget: 'post_target',
  relayCard: 'relay_card',
  relayCommand: 'relay_command',
  viralExemplar: 'viral_exemplar',
  postMetric: 'post_metric',
  job: 'job',
  idempotencyLedger: 'idempotency_ledger',
  auditLog: 'audit_log',
};

/** Runtime symbol map (Table.Symbol is not in drizzle's public typings). */
const T = (Table as unknown as { Symbol: Record<string, symbol> }).Symbol;

function tsTables() {
  return Object.keys(TS_TO_SQL);
}

function sqlTableName(tsName: string) {
  return TS_TO_SQL[tsName];
}

/** Collapse all whitespace runs to single spaces (the .sql pads columns). */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

beforeAll(() => {
  sql = readFileSync(migrationPath, 'utf8');
});

describe('migration asset 0000_initial.sql', () => {
  it('exists and is non-empty', () => {
    expect(sql.length).toBeGreaterThan(1000);
  });

  it('is wrapped in a transaction', () => {
    expect(sql).toContain('BEGIN;');
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('enables the required extensions', () => {
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS "vector";');
  });

  it('defines the application roles', () => {
    expect(sql).toContain("rolname = 'axiom_app'");
    expect(sql).toContain("rolname = 'axiom_migrator'");
    expect(sql).toContain('CREATE ROLE axiom_app');
    expect(sql).toContain('CREATE ROLE axiom_migrator');
  });

  it('creates every table that the drizzle schema defines', () => {
    for (const tsName of tsTables()) {
      const table = (schema as unknown as Record<string, any>)[tsName];
      expect(tableName(table)).toBe(sqlTableName(tsName));
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${sqlTableName(tsName)} (`);
    }
  });

  it('covers exactly the schema tables (no extra CREATE TABLE statements)', () => {
    const createTableMatches = sql.match(/CREATE TABLE IF NOT EXISTS (\w+) \(/g) ?? [];
    expect(createTableMatches).toHaveLength(tsTables().length);
  });

  it('matches key columns per table', () => {
    const expectations: Array<[string, string[]]> = [
      ['org', ['id UUID PRIMARY KEY DEFAULT gen_random_uuid()', 'slug TEXT NOT NULL UNIQUE', "settings JSONB DEFAULT '{}'::jsonb", 'is_active BOOLEAN NOT NULL DEFAULT true']],
      ['app_user', ['org_id UUID NOT NULL REFERENCES org(id)', 'email TEXT NOT NULL UNIQUE', "role TEXT NOT NULL DEFAULT 'operator'"]],
      ['model_profile', ['handle TEXT NOT NULL', 'bio TEXT']],
      ['consent_record', ['model_id UUID NOT NULL REFERENCES model_profile(id)', 'granted BOOLEAN NOT NULL', 'expires_at TIMESTAMPTZ']],
      ['platform_connection', ['enc_token BYTEA NOT NULL', 'enc_nonce BYTEA NOT NULL', 'dek_id TEXT NOT NULL', "status TEXT NOT NULL DEFAULT 'active'"]],
      ['asset', ['file_size INTEGER NOT NULL', 'storage_key TEXT NOT NULL', 'width INTEGER']],
      ['content_bundle', ['asset_id UUID REFERENCES asset(id)', 'tos_report JSONB', "state TEXT NOT NULL DEFAULT 'generated'"]],
      ['post_target', ['bundle_id UUID NOT NULL REFERENCES content_bundle(id)', 'connection_id UUID REFERENCES platform_connection(id)', "state TEXT NOT NULL DEFAULT 'pending'", 'idem_key BYTEA']],
      ['relay_card', ['title TEXT NOT NULL', 'priority INTEGER NOT NULL DEFAULT 0']],
      ['relay_command', ['card_id UUID NOT NULL REFERENCES relay_card(id)', 'trigger TEXT NOT NULL']],
      ['viral_exemplar', ['url TEXT NOT NULL', 'viral_label TEXT NOT NULL', 'embedding vector(1536) DEFAULT NULL']],
      ['post_metric', ['post_target_id UUID NOT NULL REFERENCES post_target(id)', 'engagement_rate DOUBLE PRECISION NOT NULL DEFAULT 0']],
      ['job', ['queue TEXT NOT NULL', 'attempts INTEGER NOT NULL DEFAULT 0', 'max_attempts INTEGER NOT NULL DEFAULT 3']],
      ['idempotency_ledger', ['idem_key TEXT NOT NULL UNIQUE', 'locked BOOLEAN NOT NULL DEFAULT false']],
      ['audit_log', ['actor_ref TEXT NOT NULL', 'prev_hash BYTEA NOT NULL', 'row_hash BYTEA NOT NULL']],
    ];
    for (const [tsName, fragments] of expectations) {
      const tableSql = sqlTableName(tsName);
      for (const fragment of fragments) {
        // The .sql uses padded column alignment; normalize whitespace so
        // single-spaced fragments match verbatim content.
        expect(norm(sql), `expected ${tableSql} to contain: ${fragment}`).toContain(norm(fragment));
      }
    }
  });

  it('defines one org_isolation RLS policy per table (ENABLE + FORCE + POLICY)', () => {
    for (const tsName of tsTables()) {
      const tableSql = sqlTableName(tsName);
      expect(sql).toContain(`ALTER TABLE ${tableSql} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE ${tableSql} FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`CREATE POLICY org_isolation ON ${tableSql}`);
    }
  });

  it('applies tenant isolation to consent_record via model_profile', () => {
    expect(sql).toContain('USING (model_id IN (');
    expect(sql).toContain('WHERE org_id = current_setting(\'app.current_org_id\')::uuid');
  });

  it('applies tenant isolation to post_metric via post_target -> content_bundle', () => {
    expect(sql).toContain('USING (post_target_id IN (');
    expect(sql).toContain('JOIN content_bundle cb ON pt.bundle_id = cb.id');
  });

  it('creates indexes for the hot query paths', () => {
    const indexStatements = sql.match(/CREATE INDEX IF NOT EXISTS /g) ?? [];
    // 15 tables * (org_id + key lookup) — exact count from the migration.
    expect(indexStatements).toHaveLength(26);
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_org_slug ON org(slug);');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_job_queue_state ON job(queue, state);');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_viral_exemplar_embedding ON viral_exemplar');
    expect(sql).toContain('USING hnsw (embedding vector_cosine_ops)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts DESC);');
  });

  it('grants least-privilege privileges to axiom_app and full rights to axiom_migrator', () => {
    expect(sql).toContain('GRANT USAGE ON SCHEMA public TO axiom_app;');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO axiom_app;');
    expect(sql).toContain('GRANT ALL ON SCHEMA public TO axiom_migrator;');
    expect(sql).toContain('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO axiom_migrator;');
    expect(sql).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE axiom_migrator IN SCHEMA public');
  });

  it('seeds the genesis org and audit-log chain head', () => {
    expect(sql).toContain("'Placeholder Org'");
    expect(sql).toContain("'placeholder'");
    expect(sql).toContain("'00000000-0000-0000-0000-000000000000'");
    expect(sql).toContain("action = 'genesis'");
    expect(sql).toContain("sha256('genesis'::bytea)");
    expect(sql).toContain("decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex')");
  });

  it('documented drift: job attempts columns are INTEGER in SQL but TEXT in the drizzle schema', () => {
    // The drizzle schema (job.ts) declares attempts/max_attempts as text with
    // string defaults; the shipped migration declares them INTEGER. This test
    // pins the *current* migration truth so the drift stays visible.
    expect(sql).toContain('attempts       INTEGER     NOT NULL DEFAULT 0');
    expect(sql).toContain('max_attempts   INTEGER     NOT NULL DEFAULT 3');
  });
});
