-- 0011_post_metric_hypertable.sql
-- TimescaleDB (L3.1 §metrics): convert post_metric to a hypertable partitioned
-- on collected_at so metrics aggregates stay fast at scale and retention /
-- compression policies can target chunks. Requires the extension (installed
-- on the box: timescaledb 2.29.1, shared_preload_libraries).
--
-- TimescaleDB rule: every unique index on a hypertable must include the
-- partitioning column. The table is empty (0 rows), so swapping the
-- single-column PK for the composite (id, collected_at) is lossless.
BEGIN;

CREATE EXTENSION IF NOT EXISTS timescaledb;

ALTER TABLE post_metric DROP CONSTRAINT post_metric_pkey;
ALTER TABLE post_metric ADD CONSTRAINT post_metric_pkey PRIMARY KEY (id, collected_at);

-- 7-day chunks; keep the existing DESC index on collected_at (latest-first
-- reads) instead of letting TimescaleDB create a second default index.
SELECT create_hypertable(
  'post_metric',
  'collected_at',
  chunk_time_interval => INTERVAL '7 days',
  create_default_indexes => FALSE,
  if_not_exists => TRUE
);

COMMIT;
