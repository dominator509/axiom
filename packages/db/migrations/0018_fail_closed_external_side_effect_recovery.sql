-- Migration 0018 — fail closed when a worker lease expires during provider I/O
--
-- A stale publish.target or relay.card job has an unknown external outcome.
-- Re-claiming it automatically can double-post or duplicate an operator card,
-- so those jobs go to the DLQ for reconciliation. Purely internal jobs retain
-- the existing retry-on-lease-expiry behavior.
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
     SET state = CASE
                   WHEN kind IN ('publish.target', 'relay.card') THEN 'dead'
                   WHEN attempts + 1 >= max_attempts THEN 'dead'
                   ELSE 'ready'
                 END,
         attempts = attempts + 1,
         last_error = CASE
                        WHEN kind IN ('publish.target', 'relay.card')
                          THEN 'external-side-effect-unknown: worker lease expired before completion'
                        ELSE 'worker lease expired before completion'
                      END,
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
