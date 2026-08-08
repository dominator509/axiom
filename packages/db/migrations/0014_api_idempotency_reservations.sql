-- 0014_api_idempotency_reservations.sql
-- Reserve an idempotency key before executing an outside-world mutation.
-- A pending reservation is intentionally not auto-expired: after a process
-- crash its outcome is unknown, and automatic replay could duplicate a
-- platform post, payment-like action, or queue side effect.
BEGIN;

ALTER TABLE api_idempotency
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS request_hash text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS owner_token uuid,
  ALTER COLUMN status DROP NOT NULL,
  ALTER COLUMN response_body DROP NOT NULL;

ALTER TABLE api_idempotency
  DROP CONSTRAINT IF EXISTS api_idempotency_state_check;
ALTER TABLE api_idempotency
  ADD CONSTRAINT api_idempotency_state_check
  CHECK (
    (state = 'pending' AND owner_token IS NOT NULL AND status IS NULL AND response_body IS NULL)
    OR
    (state = 'completed' AND status IS NOT NULL AND response_body IS NOT NULL)
  );

COMMIT;
