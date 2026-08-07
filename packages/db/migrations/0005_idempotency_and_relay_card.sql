-- Migration 0005 — L3.1 §11 idempotency hardening + relay_card dispatch log
-- Reconciliation audit 2026-08-08 (H-5/H-6/H-7):
--   * post_target.idem_key NOT NULL + UNIQUE(org_id, idem_key) — makes
--     double-publish structurally impossible (LBI-05).
--   * asset.sha256 NOT NULL + UNIQUE(org_id, sha256) — content-addressed
--     dedupe (LBI-05). kind/nsfw_rating added to match L3.1 asset DDL.
--   * relay_card gains the L3.1 §5 dispatch-log columns (bundle_id, channel,
--     external_ref, state) alongside the existing template-config columns.
--
-- Lossless: at audit time post_target had 4 rows (all idem_key set), asset and
-- relay_card were empty. No data migration required.

BEGIN;

-- ── post_target: enforce idempotency key uniqueness ──────────────────────
ALTER TABLE post_target ALTER COLUMN idem_key SET NOT NULL;
ALTER TABLE post_target
  ADD CONSTRAINT post_target_org_idem_key_unique UNIQUE (org_id, idem_key);

-- ── asset: content hash + kind/rating columns ────────────────────────────
ALTER TABLE asset ADD COLUMN kind text NOT NULL DEFAULT 'image';
ALTER TABLE asset ADD COLUMN sha256 bytea;
ALTER TABLE asset ADD COLUMN nsfw_rating text;

-- Existing rows (0 at audit time) would have a NULL sha256; the NOT NULL
-- constraint applies going forward. In a fresh install both columns are
-- populated at ingest. Backfill-safe: if any rows exist, hash storage_key.
UPDATE asset SET sha256 = sha256(convert_to(storage_key, 'UTF8')) WHERE sha256 IS NULL;

ALTER TABLE asset ALTER COLUMN sha256 SET NOT NULL;
ALTER TABLE asset
  ADD CONSTRAINT asset_org_sha256_unique UNIQUE (org_id, sha256);

-- ── relay_card: L3.1 §5 dispatch-log columns ─────────────────────────────
ALTER TABLE relay_card ADD COLUMN bundle_id uuid REFERENCES content_bundle(id);
ALTER TABLE relay_card ADD COLUMN channel text;
ALTER TABLE relay_card ADD COLUMN external_ref text;
ALTER TABLE relay_card ADD COLUMN state text NOT NULL DEFAULT 'sent';
ALTER TABLE relay_card ALTER COLUMN title SET DEFAULT '';

-- RLS policies for the new columns are covered by the existing org_isolation
-- policy (row-level, column-agnostic). Grants are table-level.

COMMIT;
