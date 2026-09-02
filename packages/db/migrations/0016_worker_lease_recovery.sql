-- 0016_worker_lease_recovery.sql
-- Reclaim jobs left in `running` after a worker process disappears. A stale
-- lease consumes one retry attempt so crash recovery cannot bypass the queue's
-- retry budget or strand work permanently.
BEGIN;

CREATE OR REPLACE FUNCTION claim_job(p_worker text)
RETURNS SETOF job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job job%ROWTYPE;
BEGIN
  UPDATE job
     SET state = CASE WHEN attempts + 1 >= max_attempts THEN 'dead' ELSE 'ready' END,
         attempts = attempts + 1,
         last_error = 'worker lease expired before completion',
         locked_by = NULL,
         locked_at = NULL
   WHERE state = 'running'
     AND locked_at IS NOT NULL
     AND locked_at < now() - INTERVAL '15 minutes';

  SELECT * INTO v_job
    FROM job
   WHERE state = 'ready' AND run_after <= now()
   ORDER BY run_after
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE job
     SET state = 'running',
         locked_by = p_worker,
         locked_at = now(),
         started_at = now()
   WHERE id = v_job.id
   RETURNING * INTO v_job;

  -- Scope the caller's transaction to the claimed job's org.
  PERFORM set_config('app.current_org_id', v_job.org_id::text, true);

  RETURN NEXT v_job;
END
$$;

COMMIT;
