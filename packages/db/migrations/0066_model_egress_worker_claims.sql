-- 0066_model_egress_worker_claims.sql
--
-- A global worker must never be able to claim provider-bound model work once
-- egress confinement is required.  Derive the model from owned relational
-- records instead of trusting job.payload.modelId, then expose only narrow
-- SECURITY DEFINER claim functions to the runtime role.
BEGIN;

CREATE OR REPLACE FUNCTION axiom_egress_job_model_id(p_job job)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_job.kind
    WHEN 'publish.target' THEN (
      SELECT b.model_id
      FROM post_target t
      JOIN content_bundle b ON b.id = t.bundle_id AND b.org_id = t.org_id
      WHERE t.id::text = p_job.payload->>'targetId' AND t.org_id = p_job.org_id
      LIMIT 1
    )
    WHEN 'metrics.poll' THEN (
      SELECT b.model_id
      FROM post_target t
      JOIN content_bundle b ON b.id = t.bundle_id AND b.org_id = t.org_id
      WHERE t.id::text = p_job.payload->>'targetId' AND t.org_id = p_job.org_id
      LIMIT 1
    )
    WHEN 'scrape.run' THEN (
      SELECT r.model_id
      FROM scrape_run r
      WHERE r.id::text = p_job.payload->>'runId' AND r.org_id = p_job.org_id
      LIMIT 1
    )
    WHEN 'fanvue.analytics.sync' THEN (
      SELECT m.id
      FROM model_profile m
      WHERE m.id::text = p_job.payload->>'modelId' AND m.org_id = p_job.org_id
      LIMIT 1
    )
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION claim_model_egress_job(p_worker text, p_model uuid)
RETURNS SETOF job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job job%ROWTYPE;
BEGIN
  IF length(btrim(p_worker)) = 0 OR length(p_worker) > 200 THEN
    RAISE EXCEPTION 'worker identity is required';
  END IF;

  -- Recover only this model's stale provider jobs.  The external-side-effect
  -- outcome for publish remains unknown and is therefore dead-lettered.
  UPDATE job j
     SET state = CASE
                   WHEN j.kind = 'publish.target' THEN 'dead'
                   WHEN j.attempts + 1 >= j.max_attempts THEN 'dead'
                   ELSE 'ready'
                 END,
         attempts = j.attempts + 1,
         last_error = CASE
                        WHEN j.kind = 'publish.target'
                          THEN 'external-side-effect-unknown: worker lease expired before completion'
                        ELSE 'worker lease expired before completion'
                      END,
         locked_by = NULL,
         locked_at = NULL
   WHERE j.state = 'running'
     AND j.locked_at IS NOT NULL
     AND j.locked_at < now() - INTERVAL '15 minutes'
     AND j.kind IN ('publish.target', 'metrics.poll', 'scrape.run', 'fanvue.analytics.sync')
     AND axiom_egress_job_model_id(j) = p_model;

  SELECT * INTO v_job
    FROM job j
   WHERE j.state = 'ready'
     AND j.run_after <= now()
     AND j.kind IN ('publish.target', 'metrics.poll', 'scrape.run', 'fanvue.analytics.sync')
     AND axiom_egress_job_model_id(j) = p_model
   ORDER BY j.run_after, j.created_at, j.id
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE job
     SET state = 'running', locked_by = p_worker, locked_at = now(), started_at = now()
   WHERE id = v_job.id
   RETURNING * INTO v_job;

  PERFORM set_config('app.current_org_id', v_job.org_id::text, true);
  RETURN NEXT v_job;
END
$$;

CREATE OR REPLACE FUNCTION claim_non_egress_job(p_worker text)
RETURNS SETOF job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job job%ROWTYPE;
BEGIN
  IF length(btrim(p_worker)) = 0 OR length(p_worker) > 200 THEN
    RAISE EXCEPTION 'worker identity is required';
  END IF;

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
   WHERE state = 'ready'
     AND run_after <= now()
     AND kind NOT IN ('publish.target', 'metrics.poll', 'scrape.run', 'fanvue.analytics.sync')
   ORDER BY run_after, created_at, id
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE job
     SET state = 'running', locked_by = p_worker, locked_at = now(), started_at = now()
   WHERE id = v_job.id
   RETURNING * INTO v_job;

  PERFORM set_config('app.current_org_id', v_job.org_id::text, true);
  RETURN NEXT v_job;
END
$$;

REVOKE ALL ON FUNCTION axiom_egress_job_model_id(job) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_model_egress_job(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_non_egress_job(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_model_egress_job(text, uuid) TO axiom_app;
GRANT EXECUTE ON FUNCTION claim_model_egress_job(text, uuid) TO axiom_migrator;
GRANT EXECUTE ON FUNCTION claim_non_egress_job(text) TO axiom_app;
GRANT EXECUTE ON FUNCTION claim_non_egress_job(text) TO axiom_migrator;

COMMIT;
