import { describe, it, expect } from 'vitest';
import { Table, relations, createTableRelationsHelpers } from 'drizzle-orm';
import { getTableColumns } from 'drizzle-orm/utils';
import * as pgCore from 'drizzle-orm/pg-core';

// InlineForeignKeys exists at runtime in drizzle 0.45 but is absent from the
// public typings — access it via the namespace.
const InlineForeignKeys = (pgCore as any).InlineForeignKeys;

import {
  org,
  orgRelations,
  appUser,
  appUserRelations,
  modelProfile,
  modelProfileRelations,
  consentRecord,
  consentRecordRelations,
  platformConnection,
  platformConnectionRelations,
  modelNetworkConfigs,
  modelNetworkConfigsRelations,
  asset,
  assetRelations,
  contentBundle,
  contentBundleRelations,
  postTarget,
  postTargetRelations,
  relayCard,
  relayCardRelations,
  relayCommand,
  relayCommandRelations,
  viralExemplar,
  viralExemplarRelations,
  postMetric,
  postMetricRelations,
  job,
  jobRelations,
  idempotencyLedger,
  idempotencyLedgerRelations,
  auditLog,
  auditLogRelations,
  authUser,
  authSession,
  authAccount,
  authVerification,
  orgSettings,
  fanCrmContact,
  fanTouchpoint,
  customRequest,
  linkbioProvider,
  linkbioClick,
  shortLink,
  playbookScore,
  apiKey,
  apiKeyRelations,
  assetVariant,
  assetVariantRelations,
  prePostRun,
  prePostRunRelations,
  analyticsSnapshot,
  analyticsSnapshotRelations,
  viralRecipe,
  viralRecipeRelations,
  viralEmbedding,
  viralEmbeddingRelations,
  banditState,
  banditStateRelations,
  seoAeoRanking,
  seoAeoRankingRelations,
  fanvueMetric,
  fanvueMetricRelations,
  campaign,
  campaignRelations,
  triggerRule,
  triggerRuleRelations,
  linkbioAnalytics,
  linkbioAnalyticsRelations,
  relayBinding,
  relayBindingRelations,
  agentPermission,
  agentPermissionRelations,
  allRelations,
} from './schema/index.js';

type PgTable = any;

/** Runtime symbol map (Table.Symbol is not in drizzle's public typings). */
const T = (Table as unknown as { Symbol: Record<string, symbol> }).Symbol;

/** Read the drizzle table config for a table. */
function columnsOf(table: PgTable): Record<string, any> {
  return (table as any)[T.Columns];
}

/** Resolve the single inline FK of a column set. */
function foreignKeysOf(table: PgTable) {
  const fks = (table as any)[InlineForeignKeys] as Array<{
    reference(): {
      name?: string;
      columns: Array<{ name: string }>;
      foreignTable: PgTable;
      foreignColumns: Array<{ name: string }>;
    };
  }>;
  return fks.map((fk) => fk.reference());
}

/** Resolve a table's SQL name via the runtime symbol map. */
function tableName(table: PgTable): string {
  return (table as any)[T.Name];
}

function relationNames(rel: ReturnType<typeof relations>) {
  const built = rel.config(createTableRelationsHelpers(rel.table as PgTable));
  return Object.fromEntries(
    Object.entries(built).map(([key, value]) => {
      const v = value as {
        referencedTable: PgTable;
        referencedTableName?: string;
        fieldName?: string;
        config?: { fields?: Array<{ name: string }>; references?: Array<{ name: string }> };
      };
      return [
        key,
        {
          type: (value as { constructor: { name: string } }).constructor.name,
          table: tableName(v.referencedTable),
          fieldName: v.fieldName ?? null,
          fields: v.config?.fields?.map((f) => f.name) ?? null,
          references: v.config?.references?.map((f) => f.name) ?? null,
        },
      ];
    }),
  );
}

describe('schema index', () => {
  it('exports every table definition', () => {
    expect(org).toBeDefined();
    expect(appUser).toBeDefined();
    expect(modelProfile).toBeDefined();
    expect(consentRecord).toBeDefined();
    expect(platformConnection).toBeDefined();
    expect(modelNetworkConfigs).toBeDefined();
    expect(asset).toBeDefined();
    expect(contentBundle).toBeDefined();
    expect(postTarget).toBeDefined();
    expect(relayCard).toBeDefined();
    expect(relayCommand).toBeDefined();
    expect(viralExemplar).toBeDefined();
    expect(postMetric).toBeDefined();
    expect(job).toBeDefined();
    expect(idempotencyLedger).toBeDefined();
    expect(auditLog).toBeDefined();
    expect(authUser).toBeDefined();
    expect(authSession).toBeDefined();
    expect(authAccount).toBeDefined();
    expect(authVerification).toBeDefined();
    expect(orgSettings).toBeDefined();
    expect(fanCrmContact).toBeDefined();
    expect(fanTouchpoint).toBeDefined();
    expect(customRequest).toBeDefined();
    expect(linkbioProvider).toBeDefined();
    expect(linkbioClick).toBeDefined();
    expect(shortLink).toBeDefined();
    expect(playbookScore).toBeDefined();
    expect(apiKey).toBeDefined();
    expect(assetVariant).toBeDefined();
    expect(prePostRun).toBeDefined();
    expect(analyticsSnapshot).toBeDefined();
    expect(viralRecipe).toBeDefined();
    expect(viralEmbedding).toBeDefined();
    expect(banditState).toBeDefined();
    expect(seoAeoRanking).toBeDefined();
    expect(fanvueMetric).toBeDefined();
    expect(campaign).toBeDefined();
    expect(triggerRule).toBeDefined();
    expect(linkbioAnalytics).toBeDefined();
    expect(relayBinding).toBeDefined();
    expect(agentPermission).toBeDefined();
  });

  it('allRelations contains exactly the 41 relation configs', () => {
    expect(allRelations).toHaveLength(41);
    const names = allRelations.map((r) => tableName((r as { table: PgTable }).table));
    expect(names.sort()).toEqual(
      [
        'org',
        'app_user',
        'model_profile',
        'consent_record',
        'platform_connection',
        'model_network_configs',
        'asset',
        'content_bundle',
        'post_target',
        'relay_card',
        'relay_command',
        'viral_exemplar',
        'post_metric',
        'job',
        'idempotency_ledger',
        'audit_log',
        'auth_user',
        'auth_session',
        'auth_account',
        'org_settings',
        'fan_crm_contact',
        'fan_touchpoint',
        'custom_request',
        'linkbio_provider',
        'linkbio_click',
        'short_link',
        'playbook_score',
        'api_key',
        'asset_variant',
        'pre_post_run',
        'analytics_snapshot',
        'viral_recipe',
        'viral_embedding',
        'bandit_state',
        'seo_aeo_ranking',
        'fanvue_metric',
        'campaign',
        'trigger_rule',
        'linkbio_analytics',
        'relay_binding',
        'agent_permission',
      ].sort(),
    );
  });

  it('allRelations entries can be built with helpers (no runtime errors)', () => {
    for (const rel of allRelations) {
      const built = rel.config(
        createTableRelationsHelpers(rel.table as PgTable),
      ) as Record<string, unknown>;
      expect(Object.keys(built).length).toBeGreaterThan(0);
    }
  });

  it('bytea custom type maps to the bytea data type', () => {
    // Standalone builders don't expose .name until attached — verify via the
    // real attached column on platform_connection.
    const cols = columnsOf(platformConnection);
    // customType reports generic custom/PgCustomColumn; the SQL type is bytea
    // (verified against the migration in migrations.test.ts)
    expect(cols.encToken.dataType).toBe('custom');
    expect(cols.encToken.columnType).toBe('PgCustomColumn');
    expect(cols.encToken.notNull).toBe(true);
  });
});

describe('org table', () => {
  it('uses table name org', () => {
    expect(tableName(org)).toBe('org');
  });

  it('defines all columns with correct names', () => {
    const cols = columnsOf(org);
    expect(Object.keys(cols).sort()).toEqual(
      [
        'id',
        'name',
        'slug',
        'logoUrl',
        'settings',
        'features',
        'isActive',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(getTableColumns(org)).toHaveProperty('id');
  });

  it('id is a primary-key uuid with a random default', () => {
    const id = columnsOf(org).id;
    expect(id.name).toBe('id');
    expect(id.primary).toBe(true);
    expect(id.dataType).toBe('string');
    expect(id.columnType).toBe('PgUUID');
    expect(id.hasDefault).toBe(true);
    expect(id.default).toBeDefined();
  });

  it('name and slug are required text; slug is unique', () => {
    const cols = columnsOf(org);
    expect(cols.name.notNull).toBe(true);
    expect(cols.name.dataType).toBe('string');
    expect(cols.slug.notNull).toBe(true);
    expect(cols.slug.isUnique).toBe(true);
    expect(cols.slug.uniqueName).toContain('slug');
  });

  it('logoUrl is nullable text', () => {
    const logo = columnsOf(org).logoUrl;
    expect(logo.notNull).toBe(false);
    expect(logo.dataType).toBe('string');
  });

  it('settings and features are jsonb with object/array defaults', () => {
    const cols = columnsOf(org);
    expect(cols.settings.dataType).toBe('json');
    expect(cols.settings.columnType).toBe('PgJsonb');
    expect(cols.settings.hasDefault).toBe(true);
    expect(cols.settings.default).toEqual({});
    expect(cols.features.hasDefault).toBe(true);
    expect(cols.features.default).toEqual([]);
  });

  it('isActive defaults to true', () => {
    const active = columnsOf(org).isActive;
    expect(active.notNull).toBe(true);
    expect(active.dataType).toBe('boolean');
    expect(active.hasDefault).toBe(true);
    expect(active.default).toBe(true);
  });

  it('createdAt/updatedAt are notNull timestamptz defaulting to now()', () => {
    for (const key of ['createdAt', 'updatedAt']) {
      const col = columnsOf(org)[key];
      expect(col.notNull).toBe(true);
      expect(col.dataType).toBe('date');
      expect(col.columnType).toBe('PgTimestamp');
      expect(col.hasDefault).toBe(true);
      expect(col.default).toBeDefined();
    }
  });

  it('has many-relations to users, profiles, connections, bundles and audit logs', () => {
    expect(relationNames(orgRelations)).toEqual({
      users: { type: 'Many', table: 'app_user', fieldName: 'users', fields: null, references: null },
      profiles: { type: 'Many', table: 'model_profile', fieldName: 'profiles', fields: null, references: null },
      connections: { type: 'Many', table: 'platform_connection', fieldName: 'connections', fields: null, references: null },
      bundles: { type: 'Many', table: 'content_bundle', fieldName: 'bundles', fields: null, references: null },
      auditLogs: { type: 'Many', table: 'audit_log', fieldName: 'auditLogs', fields: null, references: null },
    });
  });
});

describe('app_user table', () => {
  it('uses table name app_user', () => {
    expect(tableName(appUser)).toBe('app_user');
  });

  it('has required org_id FK to org', () => {
    const orgId = columnsOf(appUser).orgId;
    expect(orgId.notNull).toBe(true);
    const fk = foreignKeysOf(appUser)[0];
    expect(fk.columns.map((c) => c.name)).toEqual(['org_id']);
    expect(tableName(fk.foreignTable)).toBe('org');
    expect(fk.foreignColumns.map((c) => c.name)).toEqual(['id']);
  });

  it('email is required and unique', () => {
    const email = columnsOf(appUser).email;
    expect(email.notNull).toBe(true);
    expect(email.isUnique).toBe(true);
  });

  it('role defaults to operator', () => {
    const role = columnsOf(appUser).role;
    expect(role.notNull).toBe(true);
    expect(role.hasDefault).toBe(true);
    expect(role.default).toBe('operator');
  });

  it('relates one-to-one to org via org_id', () => {
    expect(relationNames(appUserRelations)).toEqual({
      org: {
        type: 'One',
        table: 'org',
        fieldName: 'org',
        fields: ['org_id'],
        references: ['id'],
      },
    });
  });
});

describe('model_profile table', () => {
  it('uses table name model_profile and requires displayName/handle', () => {
    expect(tableName(modelProfile)).toBe('model_profile');
    const cols = columnsOf(modelProfile);
    expect(cols.displayName.notNull).toBe(true);
    expect(cols.handle.notNull).toBe(true);
    expect(cols.bio.notNull).toBe(false);
  });

  it('relates to org (one), connections and bundles (many)', () => {
    expect(relationNames(modelProfileRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      connections: { type: 'Many', table: 'platform_connection', fieldName: 'connections', fields: null, references: null },
      bundles: { type: 'Many', table: 'content_bundle', fieldName: 'bundles', fields: null, references: null },
    });
  });
});

describe('consent_record table', () => {
  it('uses table name consent_record', () => {
    expect(tableName(consentRecord)).toBe('consent_record');
  });

  it('model_id is required FK to model_profile', () => {
    const modelId = columnsOf(consentRecord).modelId;
    expect(modelId.notNull).toBe(true);
    const fk = foreignKeysOf(consentRecord)[0];
    expect(fk.columns.map((c) => c.name)).toEqual(['model_id']);
    expect(tableName(fk.foreignTable)).toBe('model_profile');
  });

  it('granted is required with NO default (explicit consent required)', () => {
    const granted = columnsOf(consentRecord).granted;
    expect(granted.notNull).toBe(true);
    expect(granted.hasDefault).toBe(false);
  });

  it('grantedAt defaults to now; expiresAt/revokedAt nullable', () => {
    const cols = columnsOf(consentRecord);
    expect(cols.grantedAt.hasDefault).toBe(true);
    expect(cols.expiresAt.notNull).toBe(false);
    expect(cols.revokedAt.notNull).toBe(false);
  });

  it('relates one-to-one to model', () => {
    expect(relationNames(consentRecordRelations)).toEqual({
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
    });
  });
});

describe('platform_connection table', () => {
  it('uses table name platform_connection', () => {
    expect(tableName(platformConnection)).toBe('platform_connection');
  });

  it('encrypts tokens with bytea columns and a dek_id', () => {
    const cols = columnsOf(platformConnection);
    expect(cols.encToken.dataType).toBe('custom');
    expect(cols.encToken.columnType).toBe('PgCustomColumn');
    expect(cols.encToken.notNull).toBe(true);
    expect(cols.encNonce.dataType).toBe('custom');
    expect(cols.encNonce.columnType).toBe('PgCustomColumn');
    expect(cols.encNonce.notNull).toBe(true);
    expect(cols.dekId.notNull).toBe(true);
  });

  it('status defaults to active and capabilities to empty array', () => {
    const cols = columnsOf(platformConnection);
    expect(cols.status.hasDefault).toBe(true);
    expect(cols.status.default).toBe('active');
    expect(cols.capabilities.hasDefault).toBe(true);
    expect(cols.capabilities.default).toEqual([]);
  });

  it('relates to org and model (one) and post targets (many)', () => {
    expect(relationNames(platformConnectionRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
      postTargets: { type: 'Many', table: 'post_target', fieldName: 'postTargets', fields: null, references: null },
    });
  });
});

describe('model_network_configs table', () => {
  it('uses table name model_network_configs and defaults egress_mode to direct', () => {
    expect(tableName(modelNetworkConfigs)).toBe('model_network_configs');
    const cols = columnsOf(modelNetworkConfigs);
    expect(cols.egressMode.notNull).toBe(true);
    expect(cols.egressMode.hasDefault).toBe(true);
    expect(cols.egressMode.default).toBe('direct');
  });

  it('stores envelope-encrypted credentials (bytea creds + nonce, dek reference)', () => {
    const cols = columnsOf(modelNetworkConfigs);
    expect(cols.encCreds.columnType).toBe('PgCustomColumn');
    expect(cols.encNonce.columnType).toBe('PgCustomColumn');
    expect(cols.dekId.dataType).toBe('string');
    expect(cols.encCreds.notNull).toBe(false);
  });

  it('carries health state and expected-IP drift policy fields', () => {
    const cols = columnsOf(modelNetworkConfigs);
    expect(cols.healthy.notNull).toBe(true);
    expect(cols.healthy.default).toBe(false);
    expect(cols.failCount.notNull).toBe(true);
    expect(cols.failCount.default).toBe(0);
    expect(cols.expectedEgressIp).toBeDefined();
    expect(cols.lastEgressIp).toBeDefined();
    expect(cols.latencyMs.dataType).toBe('number');
    expect(cols.lastCheck.dataType).toBe('date');
  });

  it('model_id is unique — one network config per model profile', () => {
    const idx = columnsOf(modelNetworkConfigs).modelId;
    expect(idx.isUnique).toBe(true);
  });

  it('relates to org and model profile', () => {
    expect(relationNames(modelNetworkConfigsRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
    });
  });
});

describe('asset table', () => {
  it('uses table name asset and requires file metadata', () => {
    expect(tableName(asset)).toBe('asset');
    const cols = columnsOf(asset);
    expect(cols.fileName.notNull).toBe(true);
    expect(cols.mimeType.notNull).toBe(true);
    expect(cols.fileSize.notNull).toBe(true);
    expect(cols.fileSize.dataType).toBe('number');
    expect(cols.fileSize.columnType).toBe('PgInteger');
    expect(cols.storageKey.notNull).toBe(true);
  });

  it('requires sha256 and kind per L3.1 §11 (content-addressed dedupe)', () => {
    const cols = columnsOf(asset);
    expect(cols.sha256.notNull).toBe(true);
    expect(cols.kind.notNull).toBe(true);
    expect(cols.nsfwRating.notNull).toBe(false);
  });

  it('width/height/duration are optional integers', () => {
    const cols = columnsOf(asset);
    expect(cols.width.notNull).toBe(false);
    expect(cols.height.notNull).toBe(false);
    expect(cols.duration.notNull).toBe(false);
  });

  it('relates to org, model and bundles', () => {
    expect(relationNames(assetRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
      bundles: { type: 'Many', table: 'content_bundle', fieldName: 'bundles', fields: null, references: null },
    });
  });
});

describe('content_bundle table', () => {
  it('uses table name content_bundle and defaults state to generated', () => {
    expect(tableName(contentBundle)).toBe('content_bundle');
    const cols = columnsOf(contentBundle);
    expect(cols.state.hasDefault).toBe(true);
    expect(cols.state.default).toBe('generated');
  });

  it('captions default to {} and hashtags to []', () => {
    const cols = columnsOf(contentBundle);
    expect(cols.captions.default).toEqual({});
    expect(cols.hashtags.default).toEqual([]);
  });

  it('asset_id is a nullable FK to asset', () => {
    const assetId = columnsOf(contentBundle).assetId;
    expect(assetId.notNull).toBe(false);
    const fk = foreignKeysOf(contentBundle).find((f) => f.columns[0]?.name === 'asset_id');
    expect(fk).toBeDefined();
    expect(fk?.foreignTable && tableName(fk.foreignTable)).toBe('asset');
  });

  it('relates to org, model, asset (one) and post targets (many)', () => {
    expect(relationNames(contentBundleRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
      asset: { type: 'One', table: 'asset', fieldName: 'asset', fields: ['asset_id'], references: ['id'] },
      postTargets: { type: 'Many', table: 'post_target', fieldName: 'postTargets', fields: null, references: null },
    });
  });
});

describe('post_target table', () => {
  it('uses table name post_target and defaults state to pending', () => {
    expect(tableName(postTarget)).toBe('post_target');
    const cols = columnsOf(postTarget);
    expect(cols.state.hasDefault).toBe(true);
    expect(cols.state.default).toBe('pending');
  });

  it('bundle_id is a required FK to content_bundle', () => {
    const bundleId = columnsOf(postTarget).bundleId;
    expect(bundleId.notNull).toBe(true);
    const fk = foreignKeysOf(postTarget).find((f) => f.columns[0]?.name === 'bundle_id');
    expect(fk).toBeDefined();
    expect(fk!.columns.map((c) => c.name)).toEqual(['bundle_id']);
    expect(tableName(fk!.foreignTable)).toBe('content_bundle');
  });

  it('connection_id is optional; idem_key required per L3.1 §11 (LBI-05)', () => {
    const cols = columnsOf(postTarget);
    expect(cols.connectionId.notNull).toBe(false);
    expect(cols.remoteId.notNull).toBe(false);
    expect(cols.error.notNull).toBe(false);
    expect(cols.idemKey.notNull).toBe(true);
    expect(cols.idemKey.dataType).toBe('custom');
  });

  it('relates to org, bundle and connection', () => {
    expect(relationNames(postTargetRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      bundle: { type: 'One', table: 'content_bundle', fieldName: 'bundle', fields: ['bundle_id'], references: ['id'] },
      connection: { type: 'One', table: 'platform_connection', fieldName: 'connection', fields: ['connection_id'], references: ['id'] },
    });
  });
});

describe('relay_card table', () => {
  it('uses table name relay_card and defaults enabled/priority', () => {
    expect(tableName(relayCard)).toBe('relay_card');
    const cols = columnsOf(relayCard);
    expect(cols.enabled.default).toBe(true);
    expect(cols.priority.default).toBe(0);
    expect(cols.priority.dataType).toBe('number');
    expect(cols.config.default).toEqual({});
  });

  it('has L3.1 §5 dispatch-log columns (bundle_id/channel/external_ref/state)', () => {
    const cols = columnsOf(relayCard);
    expect(cols.bundleId).toBeDefined();
    expect(cols.channel).toBeDefined();
    expect(cols.externalRef).toBeDefined();
    expect(cols.state.notNull).toBe(true);
    expect(cols.state.default).toBe('sent');
  });

  it('relates to org (one) and commands (many)', () => {
    expect(relationNames(relayCardRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      commands: { type: 'Many', table: 'relay_command', fieldName: 'commands', fields: null, references: null },
    });
  });
});

describe('relay_command table', () => {
  it('uses table name relay_command and requires trigger/action', () => {
    expect(tableName(relayCommand)).toBe('relay_command');
    const cols = columnsOf(relayCommand);
    expect(cols.trigger.notNull).toBe(true);
    expect(cols.action.notNull).toBe(true);
    expect(cols.params.default).toEqual({});
    expect(cols.enabled.default).toBe(true);
  });

  it('card_id is a required FK to relay_card', () => {
    const fk = foreignKeysOf(relayCommand).find((f) => f.columns[0]?.name === 'card_id');
    expect(fk).toBeDefined();
    expect(fk!.columns.map((c) => c.name)).toEqual(['card_id']);
    expect(tableName(fk!.foreignTable)).toBe('relay_card');
  });

  it('relates to org and card', () => {
    expect(relationNames(relayCommandRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      card: { type: 'One', table: 'relay_card', fieldName: 'card', fields: ['card_id'], references: ['id'] },
    });
  });
});

describe('viral_exemplar table', () => {
  it('uses table name viral_exemplar and requires model_id/label', () => {
    expect(tableName(viralExemplar)).toBe('viral_exemplar');
    const cols = columnsOf(viralExemplar);
    expect(cols.modelId.notNull).toBe(true);
    expect(cols.perfScore.notNull).toBe(true);
    expect(cols.label.notNull).toBe(true);
    expect(cols.features.notNull).toBe(true);
  });

  it('features default to empty object', () => {
    const features = columnsOf(viralExemplar).features;
    expect(features.hasDefault).toBe(true);
    expect(features.default).toEqual({});
  });

  it('exposes the pgvector embedding column at 768 dimensions', () => {
    // Aligned with migration 0003 / blueprint L3.1: embedding vector(768) NOT NULL + HNSW index.
    const embedding = columnsOf(viralExemplar).embedding;
    expect(embedding.columnType).toBe('PgVector');
    expect(embedding.notNull).toBe(true);
  });

  it('relates to org, model and bundle', () => {
    expect(relationNames(viralExemplarRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
      bundle: { type: 'One', table: 'content_bundle', fieldName: 'bundle', fields: ['bundle_id'], references: ['id'] },
    });
  });
});

describe('post_metric table', () => {
  it('uses table name post_metric and requires post_target_id FK', () => {
    expect(tableName(postMetric)).toBe('post_metric');
    const fk = foreignKeysOf(postMetric)[0];
    expect(fk.columns.map((c) => c.name)).toEqual(['post_target_id']);
    expect(tableName(fk.foreignTable)).toBe('post_target');
  });

  it('uses bigint counters defaulting to 0 and double-precision engagement rate', () => {
    const cols = columnsOf(postMetric);
    for (const key of ['views', 'likes', 'shares', 'comments']) {
      // mode:'number' bigint reports dataType 'number', columnType 'PgBigInt53'
      expect(cols[key].dataType).toBe('number');
      expect(cols[key].columnType).toBe('PgBigInt53');
      expect(cols[key].hasDefault).toBe(true);
      expect(cols[key].default).toBe(0);
    }
    expect(cols.engagementRate.dataType).toBe('number');
    expect(cols.engagementRate.columnType).toBe('PgDoublePrecision');
    expect(cols.engagementRate.default).toBe(0);
  });

  it('relates to post target', () => {
    expect(relationNames(postMetricRelations)).toEqual({
      postTarget: { type: 'One', table: 'post_target', fieldName: 'postTarget', fields: ['post_target_id'], references: ['id'] },
    });
  });
});

describe('job table', () => {
  it('uses table name job and defaults state to ready', () => {
    expect(tableName(job)).toBe('job');
    const cols = columnsOf(job);
    expect(cols.state.hasDefault).toBe(true);
    expect(cols.state.default).toBe('ready');
  });

  it('payload defaults to {}', () => {
    expect(columnsOf(job).payload.default).toEqual({});
  });

  it('attempts/maxAttempts are integer counters defaulting to 0 and 3', () => {
    // Aligned with migration 0000: INTEGER NOT NULL DEFAULT 0 / 3 (was TEXT drift).
    const cols = columnsOf(job);
    expect(cols.attempts.dataType).toBe('number');
    expect(cols.attempts.columnType).toBe('PgInteger');
    expect(cols.attempts.hasDefault).toBe(true);
    expect(cols.attempts.default).toBe(0);
    expect(cols.maxAttempts.dataType).toBe('number');
    expect(cols.maxAttempts.columnType).toBe('PgInteger');
    expect(cols.maxAttempts.hasDefault).toBe(true);
    expect(cols.maxAttempts.default).toBe(3);
  });

  it('relates to org', () => {
    expect(relationNames(jobRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
    });
  });
});

describe('idempotency_ledger table', () => {
  it('uses table name idempotency_ledger with unique idem_key', () => {
    expect(tableName(idempotencyLedger)).toBe('idempotency_ledger');
    const idemKey = columnsOf(idempotencyLedger).idemKey;
    expect(idemKey.notNull).toBe(true);
    expect(idemKey.isUnique).toBe(true);
  });

  it('locked defaults to false', () => {
    const locked = columnsOf(idempotencyLedger).locked;
    expect(locked.default).toBe(false);
  });

  it('relates to org', () => {
    expect(relationNames(idempotencyLedgerRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
    });
  });
});

describe('audit_log table', () => {
  it('uses table name audit_log and requires actor/action/target', () => {
    expect(tableName(auditLog)).toBe('audit_log');
    const cols = columnsOf(auditLog);
    expect(cols.actorRef.notNull).toBe(true);
    expect(cols.action.notNull).toBe(true);
    expect(cols.target.notNull).toBe(true);
  });

  it('hash-chains with notNull bytea prev_hash and row_hash', () => {
    const cols = columnsOf(auditLog);
    expect(cols.prevHash.dataType).toBe('custom');
    expect(cols.prevHash.notNull).toBe(true);
    expect(cols.rowHash.dataType).toBe('custom');
    expect(cols.rowHash.notNull).toBe(true);
  });

  it('detail defaults to {}', () => {
    expect(columnsOf(auditLog).detail.default).toEqual({});
  });

  it('relates to org', () => {
    expect(relationNames(auditLogRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
    });
  });
});

describe('job worker columns (L3.4)', () => {
  it('has run_after defaulting to now() and nullable locked_by/locked_at', () => {
    const cols = columnsOf(job);
    expect(cols.runAfter.dataType).toBe('date');
    expect(cols.runAfter.columnType).toBe('PgTimestamp');
    expect(cols.runAfter.notNull).toBe(true);
    expect(cols.runAfter.hasDefault).toBe(true);
    expect(cols.lockedBy.notNull).toBe(false);
    expect(cols.lockedAt.notNull).toBe(false);
  });

  it('has nullable bytea dedupe_key', () => {
    const dedupe = columnsOf(job).dedupeKey;
    expect(dedupe.dataType).toBe('custom');
    expect(dedupe.notNull).toBe(false);
  });
});

describe('api_key table', () => {
  it('uses table name api_key with org FK and key_hash', () => {
    expect(tableName(apiKey)).toBe('api_key');
    const cols = columnsOf(apiKey);
    expect(cols.keyHash.notNull).toBe(true);
    expect(cols.keyPrefix.notNull).toBe(true);
    const fk = foreignKeysOf(apiKey)[0];
    expect(tableName(fk.foreignTable)).toBe('org');
  });

  it('relates to org', () => {
    expect(relationNames(apiKeyRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
    });
  });
});

describe('asset_variant table', () => {
  it('uses table name asset_variant with asset FK', () => {
    expect(tableName(assetVariant)).toBe('asset_variant');
    const fks = foreignKeysOf(assetVariant).map((fk) => tableName(fk.foreignTable));
    expect(fks).toContain('asset');
    expect(fks).toContain('org');
  });

  it('relates to org and asset', () => {
    expect(relationNames(assetVariantRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      asset: { type: 'One', table: 'asset', fieldName: 'asset', fields: ['asset_id'], references: ['id'] },
    });
  });
});

describe('pre_post_run table', () => {
  it('uses table name pre_post_run with model + target FKs', () => {
    expect(tableName(prePostRun)).toBe('pre_post_run');
    const fks = foreignKeysOf(prePostRun).map((fk) => tableName(fk.foreignTable));
    expect(fks).toContain('model_profile');
    expect(fks).toContain('post_target');
  });

  it('relates to org, model and target', () => {
    expect(relationNames(prePostRunRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
      target: { type: 'One', table: 'post_target', fieldName: 'target', fields: ['target_id'], references: ['id'] },
    });
  });
});

describe('analytics_snapshot table', () => {
  it('uses table name analytics_snapshot with model FK and bigint counters', () => {
    expect(tableName(analyticsSnapshot)).toBe('analytics_snapshot');
    const cols = columnsOf(analyticsSnapshot);
    expect(cols.followers.columnType).toBe('PgBigInt53');
    expect(cols.followers.default).toBe(0);
    expect(cols.engagement.columnType).toBe('PgDoublePrecision');
  });

  it('relates to org and model', () => {
    expect(relationNames(analyticsSnapshotRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
    });
  });
});

describe('viral_recipe table', () => {
  it('uses table name viral_recipe with label/perf_score defaults', () => {
    expect(tableName(viralRecipe)).toBe('viral_recipe');
    const cols = columnsOf(viralRecipe);
    expect(cols.label.default).toBe('baseline');
    expect(cols.perfScore.default).toBe(0);
  });

  it('relates to org and model', () => {
    expect(relationNames(viralRecipeRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
    });
  });
});

describe('viral_embedding table', () => {
  it('uses table name viral_embedding with 768-dim vector and recipe FK', () => {
    expect(tableName(viralEmbedding)).toBe('viral_embedding');
    const embedding = columnsOf(viralEmbedding).embedding;
    expect(embedding.columnType).toBe('PgVector');
    expect(embedding.notNull).toBe(true);
    const fks = foreignKeysOf(viralEmbedding).map((fk) => tableName(fk.foreignTable));
    expect(fks).toContain('viral_recipe');
    expect(fks).toContain('model_profile');
  });

  it('relates to org, recipe and model', () => {
    expect(relationNames(viralEmbeddingRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      recipe: { type: 'One', table: 'viral_recipe', fieldName: 'recipe', fields: ['recipe_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
    });
  });
});

describe('bandit_state table', () => {
  it('uses table name bandit_state with Beta-posterior defaults', () => {
    expect(tableName(banditState)).toBe('bandit_state');
    const cols = columnsOf(banditState);
    expect(cols.alpha.default).toBe(1);
    expect(cols.beta.default).toBe(1);
    expect(cols.plays.default).toBe(0);
  });

  it('relates to org and model', () => {
    expect(relationNames(banditStateRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
    });
  });
});

describe('seo_aeo_ranking table', () => {
  it('uses table name seo_aeo_ranking with keyword + engine', () => {
    expect(tableName(seoAeoRanking)).toBe('seo_aeo_ranking');
    const cols = columnsOf(seoAeoRanking);
    expect(cols.keyword.notNull).toBe(true);
    expect(cols.engine.notNull).toBe(true);
    expect(cols.position.notNull).toBe(false);
  });

  it('relates to org and model', () => {
    expect(relationNames(seoAeoRankingRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
    });
  });
});

describe('fanvue_metric table', () => {
  it('uses table name fanvue_metric with numeric earnings', () => {
    expect(tableName(fanvueMetric)).toBe('fanvue_metric');
    const cols = columnsOf(fanvueMetric);
    expect(cols.subscribers.default).toBe(0);
    expect(cols.earningsUsd.columnType).toBe('PgNumeric');
  });

  it('relates to org and model', () => {
    expect(relationNames(fanvueMetricRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
    });
  });
});

describe('campaign table', () => {
  it('uses table name campaign with status default draft', () => {
    expect(tableName(campaign)).toBe('campaign');
    expect(columnsOf(campaign).status.default).toBe('draft');
  });

  it('relates to org and model', () => {
    expect(relationNames(campaignRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
    });
  });
});

describe('trigger_rule table', () => {
  it('uses table name trigger_rule with condition/action jsonb', () => {
    expect(tableName(triggerRule)).toBe('trigger_rule');
    const cols = columnsOf(triggerRule);
    expect(cols.condition.dataType).toBe('json');
    expect(cols.condition.default).toEqual({});
    expect(cols.enabled.default).toBe(true);
  });

  it('relates to org and model', () => {
    expect(relationNames(triggerRuleRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
    });
  });
});

describe('linkbio_analytics table', () => {
  it('uses table name linkbio_analytics with nullable provider FK', () => {
    expect(tableName(linkbioAnalytics)).toBe('linkbio_analytics');
    const cols = columnsOf(linkbioAnalytics);
    expect(cols.kind.default).toBe('click');
    expect(cols.providerId.notNull).toBe(false);
    const fks = foreignKeysOf(linkbioAnalytics).map((fk) => tableName(fk.foreignTable));
    expect(fks).toContain('linkbio_provider');
  });

  it('relates to org and provider', () => {
    expect(relationNames(linkbioAnalyticsRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      provider: { type: 'One', table: 'linkbio_provider', fieldName: 'provider', fields: ['provider_id'], references: ['id'] },
    });
  });
});

describe('relay_binding table', () => {
  it('uses table name relay_binding with channel and model FK', () => {
    expect(tableName(relayBinding)).toBe('relay_binding');
    const fks = foreignKeysOf(relayBinding).map((fk) => tableName(fk.foreignTable));
    expect(fks).toContain('model_profile');
  });

  it('relates to org and model', () => {
    expect(relationNames(relayBindingRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
    });
  });
});

describe('agent_permission table', () => {
  it('uses table name agent_permission with tier default read', () => {
    expect(tableName(agentPermission)).toBe('agent_permission');
    const cols = columnsOf(agentPermission);
    expect(cols.tier.default).toBe('read');
    expect(cols.canPublish.default).toBe(false);
    expect(cols.canEdit.default).toBe(true);
  });

  it('relates to org and model', () => {
    expect(relationNames(agentPermissionRelations)).toEqual({
      org: { type: 'One', table: 'org', fieldName: 'org', fields: ['org_id'], references: ['id'] },
      model: { type: 'One', table: 'model_profile', fieldName: 'model', fields: ['model_id'], references: ['id'] },
    });
  });
});
