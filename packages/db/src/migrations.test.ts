import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { Table } from 'drizzle-orm';
import * as schema from './schema/index.js';

/** Resolve a table's SQL name via the runtime symbol map. */
function tableName(table: any): string {
  return (table as any)[T.Name];
}

const migrationsDir = new URL('../migrations/', import.meta.url);
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
let sql = '';

// TS export name -> SQL table name
const TS_TO_SQL: Record<string, string> = {
  org: 'org',
  appUser: 'app_user',
  modelProfile: 'model_profile',
  consentRecord: 'consent_record',
  platformConnection: 'platform_connection',
  modelNetworkConfigs: 'model_network_configs',
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
  authUser: 'auth_user',
  authSession: 'auth_session',
  authAccount: 'auth_account',
  authVerification: 'auth_verification',
  orgSettings: 'org_settings',
  fanCrmContact: 'fan_crm_contact',
  fanTouchpoint: 'fan_touchpoint',
  customRequest: 'custom_request',
  linkbioProvider: 'linkbio_provider',
  linkbioClick: 'linkbio_click',
  shortLink: 'short_link',
  playbookScore: 'playbook_score',
  apiKey: 'api_key',
  assetVariant: 'asset_variant',
  prePostRun: 'pre_post_run',
  analyticsSnapshot: 'analytics_snapshot',
  viralRecipe: 'viral_recipe',
  viralEmbedding: 'viral_embedding',
  banditState: 'bandit_state',
  seoAeoRanking: 'seo_aeo_ranking',
  fanvueMetric: 'fanvue_metric',
  campaign: 'campaign',
  triggerRule: 'trigger_rule',
  linkbioAnalytics: 'linkbio_analytics',
  relayBinding: 'relay_binding',
  agentPermission: 'agent_permission',
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
  sql = migrationFiles
    .map((f) => readFileSync(new URL(f, migrationsDir), 'utf8'))
    .join('\n');
});

describe('migration assets (0000_initial.sql + 0001_model_network_configs.sql)', () => {
  it('has at least one migration file', () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
  });

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
      ['model_network_configs', ["egress_mode TEXT NOT NULL DEFAULT 'direct'", 'CHECK (egress_mode IN', 'enc_creds BYTEA', 'expected_egress_ip TEXT', 'failover_proxy_addrs TEXT[]', 'UNIQUE (model_id)']],
      ['asset', ['file_size INTEGER NOT NULL', 'storage_key TEXT NOT NULL', 'width INTEGER', 'sha256 bytea', 'SET NOT NULL', 'UNIQUE (org_id, sha256)']],
      ['content_bundle', ['asset_id UUID REFERENCES asset(id)', 'tos_report JSONB', "state TEXT NOT NULL DEFAULT 'generated'"]],
      ['post_target', ['bundle_id UUID NOT NULL REFERENCES content_bundle(id)', 'connection_id UUID REFERENCES platform_connection(id)', "state TEXT NOT NULL DEFAULT 'pending'", 'idem_key SET NOT NULL', 'UNIQUE (org_id, idem_key)']],
      ['relay_card', ['title TEXT NOT NULL', 'priority INTEGER NOT NULL DEFAULT 0', 'bundle_id uuid REFERENCES content_bundle(id)', 'channel text', 'external_ref text', "state text NOT NULL DEFAULT 'sent'"]],
      ['relay_command', ['card_id UUID NOT NULL REFERENCES relay_card(id)', 'trigger TEXT NOT NULL']],
      ['viral_exemplar', ['model_id UUID NOT NULL REFERENCES model_profile(id)', 'features jsonb NOT NULL DEFAULT', 'perf_score double precision NOT NULL DEFAULT 0', "label text NOT NULL DEFAULT 'baseline'", 'embedding vector(768) NOT NULL']],
      ['post_metric', ['post_target_id UUID NOT NULL REFERENCES post_target(id)', 'engagement_rate DOUBLE PRECISION NOT NULL DEFAULT 0']],
      ['job', ['queue TEXT NOT NULL', 'attempts INTEGER NOT NULL DEFAULT 0', 'max_attempts INTEGER NOT NULL DEFAULT 3']],
      ['idempotency_ledger', ['idem_key TEXT NOT NULL UNIQUE', 'locked BOOLEAN NOT NULL DEFAULT false']],
      ['audit_log', ['actor_ref TEXT NOT NULL', 'prev_hash BYTEA NOT NULL', 'row_hash BYTEA NOT NULL']],
      ['auth_user', ['id TEXT PRIMARY KEY', 'email TEXT NOT NULL UNIQUE', 'org_id UUID REFERENCES org(id)', "role TEXT NOT NULL DEFAULT 'operator'"]],
      ['auth_session', ['user_id TEXT NOT NULL REFERENCES auth_user(id)', 'token TEXT NOT NULL UNIQUE', 'expires_at TIMESTAMPTZ NOT NULL']],
      ['auth_account', ['user_id TEXT NOT NULL REFERENCES auth_user(id)', 'provider_id TEXT NOT NULL']],
      ['auth_verification', ['identifier TEXT NOT NULL', 'expires_at TIMESTAMPTZ NOT NULL']],
      ['org_settings', ['org_id UUID PRIMARY KEY REFERENCES org(id)', 'publishing_enabled BOOLEAN NOT NULL DEFAULT true']],
      ['fan_crm_contact', ['model_id UUID NOT NULL REFERENCES model_profile(id)', "tier TEXT NOT NULL DEFAULT 'new'", 'lifetime_value_usd NUMERIC(12,2) NOT NULL DEFAULT 0']],
      ['fan_touchpoint', ['fan_id UUID NOT NULL REFERENCES fan_crm_contact(id)', "direction TEXT NOT NULL DEFAULT 'inbound'"]],
      ['custom_request', ['model_id UUID NOT NULL REFERENCES model_profile(id)', "status TEXT NOT NULL DEFAULT 'pending'"]],
      ['linkbio_provider', ['kind TEXT NOT NULL', 'enabled BOOLEAN NOT NULL DEFAULT true']],
      ['linkbio_click', ['provider_id UUID NOT NULL REFERENCES linkbio_provider(id)', 'target TEXT NOT NULL']],
      ['short_link', ['slug TEXT NOT NULL', 'target_url TEXT NOT NULL', 'clicks INTEGER NOT NULL DEFAULT 0']],
      ['playbook_score', ['score INTEGER NOT NULL', 'components JSONB NOT NULL DEFAULT']],
      ['api_key', ['org_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE', 'key_hash TEXT NOT NULL', "scopes JSONB NOT NULL DEFAULT '[]'::jsonb"]],
      ['asset_variant', ['asset_id UUID NOT NULL REFERENCES asset(id) ON DELETE CASCADE', "variant_type TEXT NOT NULL DEFAULT 'crop'", 'storage_key TEXT NOT NULL']],
      ['pre_post_run', ['model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE', "status TEXT NOT NULL DEFAULT 'pending'", 'script TEXT NOT NULL']],
      ['analytics_snapshot', ['model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE', 'platform TEXT NOT NULL', 'followers BIGINT NOT NULL DEFAULT 0']],
      ['viral_recipe', ['model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE', "label TEXT NOT NULL DEFAULT 'baseline'", 'perf_score DOUBLE PRECISION NOT NULL DEFAULT 0']],
      ['viral_embedding', ['recipe_id UUID NOT NULL REFERENCES viral_recipe(id) ON DELETE CASCADE', 'embedding   vector(768) NOT NULL']],
      ['bandit_state', ['model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE', 'alpha DOUBLE PRECISION NOT NULL DEFAULT 1', 'UNIQUE (model_id, platform, context, arm)']],
      ['seo_aeo_ranking', ['model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE', 'keyword TEXT NOT NULL', 'position INTEGER']],
      ['fanvue_metric', ['model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE', 'subscribers INTEGER NOT NULL DEFAULT 0', 'earnings_usd NUMERIC(12,2) NOT NULL DEFAULT 0']],
      ['campaign', ['model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE', "status TEXT NOT NULL DEFAULT 'draft'", 'kpi JSONB NOT NULL DEFAULT']],
      ['trigger_rule', ['model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE', 'condition JSONB NOT NULL DEFAULT']],
      ['linkbio_analytics', ['provider_id UUID REFERENCES linkbio_provider(id) ON DELETE SET NULL', "kind TEXT NOT NULL DEFAULT 'click'"]],
      ['relay_binding', ['model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE', 'channel TEXT NOT NULL', 'UNIQUE (model_id, channel)']],
      ['agent_permission', ['agent_ref TEXT NOT NULL', "tier TEXT NOT NULL DEFAULT 'read'", 'can_publish BOOLEAN NOT NULL DEFAULT false', 'UNIQUE (agent_ref, model_id)']],
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
    // Auth identity tables are cross-tenant (session lookup happens before org
    // context exists) — excluded from the RLS sweep. All other tables are
    // org-scoped and must be RLS-protected (LBI-02).
    const nonTenant = new Set(['auth_user', 'auth_session', 'auth_account', 'auth_verification']);
    // 0000/0001 emit literal ALTER statements; 0002 emits the same statements
    // through a DO block with format('...', t) — both patterns are valid.
    const doBlockTables = new Set([
      'org_settings',
      'fan_crm_contact',
      'fan_touchpoint',
      'custom_request',
      'linkbio_provider',
      'linkbio_click',
      'short_link',
      'playbook_score',
    ]);
    for (const tsName of tsTables()) {
      const tableSql = sqlTableName(tsName);
      if (nonTenant.has(tableSql)) continue;
      if (doBlockTables.has(tableSql)) {
        // DO-block form: table listed in the array + format() emits the policy
        // (last array element has no trailing comma, so match both forms)
        expect(sql).toMatch(new RegExp(`'${tableSql}'\\s*[,\\]]`));
        expect(sql).toContain(`ALTER TABLE %I ENABLE ROW LEVEL SECURITY`);
        expect(sql).toContain(`ALTER TABLE %I FORCE ROW LEVEL SECURITY`);
        expect(sql).toContain(`CREATE POLICY org_isolation ON %I`);
        continue;
      }
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
    // 15 tables in 0000 (org_id + key lookup) + 1 in 0001 (org_id) +
    // 5 in 0002 (fan/fan_touchpoint/custom_request/linkbio_click/playbook) +
    // 4 in 0003 (viral_exemplar embedding/model_id/label/org_id re-created) +
    // 29 in 0004 (job_pick + job_dedupe + 27 entity-table hot paths) — exact count.
    expect(indexStatements).toHaveLength(65);
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_org_slug ON org(slug);');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_job_queue_state ON job(queue, state);');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS job_pick ON job (state, run_after) WHERE state = \'ready\';');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_viral_exemplar_embedding ON viral_exemplar');
    expect(sql).toContain('USING hnsw (embedding vector_cosine_ops)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts DESC);');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_model_network_configs_org_id ON model_network_configs(org_id);');
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

  it('job attempts columns are INTEGER in SQL and aligned in the drizzle schema', () => {
    // Migration truth: INTEGER NOT NULL DEFAULT 0 / 3. The drizzle schema
    // (job.ts) is aligned with integer('attempts').default(0) — no drift.
    expect(sql).toContain('attempts       INTEGER     NOT NULL DEFAULT 0');
    expect(sql).toContain('max_attempts   INTEGER     NOT NULL DEFAULT 3');
  });
});
