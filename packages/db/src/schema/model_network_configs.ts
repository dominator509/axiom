import { pgTable, uuid, text, timestamp, boolean, integer, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { bytea } from './types.js';

/**
 * Per-model egress isolation config (L2.6 / L2.2).
 * egress_mode is one of: direct | socks5 | http | https | wireguard | vpn.
 * Sensitive credentials (proxy user/pass, WG private key + preshared, VPN
 * config) live envelope-encrypted in encCreds/encNonce (dekId references the
 * vault DEK) — decrypted only in the Rust egress worker, zeroized after use.
 */
export const modelNetworkConfigs = pgTable(
  'model_network_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => org.id),
    modelId: uuid('model_id').notNull().unique().references(() => modelProfile.id),
    egressMode: text('egress_mode').notNull().default('direct'),
    proxyType: text('proxy_type'),
    proxyAddr: text('proxy_addr'),
    wgPublicKey: text('wg_public_key'),
    wgEndpoint: text('wg_endpoint'),
    wgAllowedIps: text('wg_allowed_ips'),
    wgPersistentKeepalive: integer('wg_persistent_keepalive'),
    expectedEgressIp: text('expected_egress_ip'),
    failoverProxyAddrs: text('failover_proxy_addrs').array(),
    encCreds: bytea('enc_creds'),
    encNonce: bytea('enc_nonce'),
    dekId: text('dek_id'),
    healthy: boolean('healthy').notNull().default(false),
    lastCheck: timestamp('last_check', { withTimezone: true }),
    latencyMs: integer('latency_ms'),
    lastEgressIp: text('last_egress_ip'),
    failCount: integer('fail_count').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('idx_model_network_configs_org_id').on(t.orgId),
  }),
);

export const modelNetworkConfigsRelations = relations(modelNetworkConfigs, ({ one }) => ({
  org: one(org, {
    fields: [modelNetworkConfigs.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [modelNetworkConfigs.modelId],
    references: [modelProfile.id],
  }),
}));
