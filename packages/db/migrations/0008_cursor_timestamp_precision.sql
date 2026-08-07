-- 0008_cursor_timestamp_precision.sql
-- Keyset cursor pagination (L3.0) round-trips sort values through JS Date,
-- which is millisecond-exact. The previous columns stored microseconds
-- (timestamptz(6)), so the encoded cursor '...357Z' was < the stored
-- '...357238+02' — the boundary row was re-included on the next page,
-- producing duplicates. Align the keyset-sort timestamp columns to
-- millisecond precision so cursor values compare exactly.
BEGIN;

ALTER TABLE model_profile  ALTER COLUMN created_at TYPE timestamp(3) with time zone;
ALTER TABLE content_bundle ALTER COLUMN created_at TYPE timestamp(3) with time zone;
ALTER TABLE job            ALTER COLUMN created_at TYPE timestamp(3) with time zone;
ALTER TABLE audit_log      ALTER COLUMN ts         TYPE timestamp(3) with time zone;

COMMIT;
