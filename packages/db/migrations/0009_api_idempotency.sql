-- 0009_api_idempotency.sql
-- Durable HTTP idempotency store (M-2 / L3.0): the API idempotency middleware
-- previously cached responses in a per-process Map, so a restart lost the
-- replay guarantee for mutations that touch platforms/queues (generate,
-- approve/revise/reject, schedule, connect). This table persists the replayed
-- response keyed by (org_id, method, route, idem_key) with a 24h TTL, RLS
-- scoped to the owning org like every tenant table (LBI-02).
BEGIN;

CREATE TABLE IF NOT EXISTS api_idempotency (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  method        text NOT NULL,
  route         text NOT NULL,
  idem_key      text NOT NULL,
  status        integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at    timestamp(3) with time zone NOT NULL DEFAULT now(),
  expires_at    timestamp(3) with time zone NOT NULL,
  CONSTRAINT api_idempotency_unique UNIQUE (org_id, method, route, idem_key)
);

ALTER TABLE api_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_idempotency FORCE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON api_idempotency
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_api_idempotency_expires ON api_idempotency (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON api_idempotency TO axiom_app;
GRANT ALL ON api_idempotency TO axiom_migrator;

COMMIT;
