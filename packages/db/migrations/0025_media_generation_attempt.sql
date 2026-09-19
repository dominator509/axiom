-- Commit before Grok provider I/O using the worker's independent marker txn.
-- Job/bundle IDs deliberately have no FK: their rows are locked by the outer
-- executor transaction, and an independent FK check would deadlock against it.
CREATE TABLE media_generation_attempt (
  job_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES org(id),
  bundle_id uuid NOT NULL,
  model_id uuid NOT NULL,
  user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'video')),
  state text NOT NULL DEFAULT 'dispatched' CHECK (state IN ('dispatched', 'completed')),
  asset_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((state = 'dispatched' AND asset_id IS NULL AND completed_at IS NULL)
    OR (state = 'completed' AND asset_id IS NOT NULL AND completed_at IS NOT NULL))
);
ALTER TABLE media_generation_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_generation_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON media_generation_attempt
  USING (org_id = current_setting('app.current_org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);
-- App code cannot erase a dispatch marker to make an uncertain job retryable.
REVOKE UPDATE, DELETE, TRUNCATE ON media_generation_attempt FROM axiom_app;
GRANT SELECT, INSERT ON media_generation_attempt TO axiom_app;
GRANT UPDATE (state, asset_id, completed_at) ON media_generation_attempt TO axiom_app;
GRANT ALL ON media_generation_attempt TO axiom_migrator;
