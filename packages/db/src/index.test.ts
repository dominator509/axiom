import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// Set a fake DATABASE_URL before the module under test is imported.
const env = vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test-user@localhost:5432/axiom_test';
  return { url: process.env.DATABASE_URL };
});

// Mock the pg module: Pool construction must not require a live database.
const pgMock = vi.hoisted(() => {
  class FakePool {
    static instances: FakePool[] = [];
    config: { connectionString?: string } | undefined;
    query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    connect = vi.fn();
    end = vi.fn(async () => {});
    on = vi.fn();
    constructor(config?: { connectionString?: string }) {
      this.config = config;
      FakePool.instances.push(this);
    }
  }
  return { FakePool };
});

vi.mock('pg', () => ({
  default: { Pool: pgMock.FakePool },
  Pool: pgMock.FakePool,
}));

import { db, schema } from './index.js';

describe('@axiom/db index', () => {
  it('constructs a pg.Pool from DATABASE_URL', () => {
    expect(pgMock.FakePool.instances).toHaveLength(1);
    expect(pgMock.FakePool.instances[0].config?.connectionString).toBe(env.url);
  });

  it('re-exports the full schema object', () => {
    expect(schema.org).toBeDefined();
    expect(schema.appUser).toBeDefined();
    expect(schema.modelProfile).toBeDefined();
    expect(schema.consentRecord).toBeDefined();
    expect(schema.platformConnection).toBeDefined();
    expect(schema.modelNetworkConfigs).toBeDefined();
    expect(schema.asset).toBeDefined();
    expect(schema.contentBundle).toBeDefined();
    expect(schema.postTarget).toBeDefined();
    expect(schema.relayCard).toBeDefined();
    expect(schema.relayCommand).toBeDefined();
    expect(schema.viralExemplar).toBeDefined();
    expect(schema.postMetric).toBeDefined();
    expect(schema.job).toBeDefined();
    expect(schema.idempotencyLedger).toBeDefined();
    expect(schema.auditLog).toBeDefined();
    expect(schema.authUser).toBeDefined();
    expect(schema.authSession).toBeDefined();
    expect(schema.authAccount).toBeDefined();
    expect(schema.authVerification).toBeDefined();
    expect(schema.orgSettings).toBeDefined();
    expect(schema.fanCrmContact).toBeDefined();
    expect(schema.fanTouchpoint).toBeDefined();
    expect(schema.customRequest).toBeDefined();
    expect(schema.linkbioProvider).toBeDefined();
    expect(schema.linkbioClick).toBeDefined();
    expect(schema.shortLink).toBeDefined();
    expect(schema.playbookScore).toBeDefined();
    expect(schema.allRelations).toHaveLength(27);
  });

  it('exposes a usable drizzle query builder without a live database', () => {
    // select().toSQL() never touches the client, so it works offline.
    const sql = db.select().from(schema.org).toSQL();
    expect(sql.sql).toBe(
      'select "id", "name", "slug", "logo_url", "settings", "features", "is_active", "created_at", "updated_at" from "org"',
    );
  });

  it('builds insert statements with mapped columns and bound params', () => {
    const sql = db
      .insert(schema.org)
      .values({ name: 'acme-corp', slug: 'acme' })
      .toSQL();
    expect(sql.sql).toContain('insert into "org"');
    expect(sql.sql).toContain('"name"');
    expect(sql.sql).toContain('"slug"');
    expect(sql.params).toEqual(['acme-corp', 'acme']);
  });

  it('builds update statements with column mapping', () => {
    const sql = db
      .update(schema.org)
      .set({ name: 'renamed-corp' })
      .where(eq(schema.org.id, '00000000-0000-0000-0000-000000000000'))
      .toSQL();
    expect(sql.sql).toContain('update "org" set "name"');
    expect(sql.params).toContain('renamed-corp');
    expect(sql.params).toContain('00000000-0000-0000-0000-000000000000');
  });

  it('builds delete statements', () => {
    const sql = db
      .delete(schema.auditLog)
      .where(eq(schema.auditLog.orgId, '00000000-0000-0000-0000-000000000000'))
      .toSQL();
    expect(sql.sql).toBe('delete from "audit_log" where "audit_log"."org_id" = $1');
    expect(sql.params).toEqual(['00000000-0000-0000-0000-000000000000']);
  });

  it('query builders expose execute() wired to the fake client', async () => {
    const result = await db.select().from(schema.org).execute();
    expect(result).toEqual([]);
    expect(pgMock.FakePool.instances[0].query).toHaveBeenCalled();
  });
});
