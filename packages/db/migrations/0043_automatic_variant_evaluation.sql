ALTER TABLE post_target ADD COLUMN published_at TIMESTAMPTZ;
ALTER TABLE variant_experiment ADD COLUMN evaluation_policy TEXT NOT NULL DEFAULT 'manual'
  CHECK (evaluation_policy IN ('manual','fixed-post-engagement-v1'));
ALTER TABLE variant_experiment ADD COLUMN evaluation JSONB;
CREATE FUNCTION preserve_variant_evaluation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.evaluation_policy IS DISTINCT FROM OLD.evaluation_policy THEN
    RAISE EXCEPTION 'experiment evaluation policy is fixed at creation';
  END IF;
  IF OLD.evaluation IS NOT NULL AND NEW.evaluation IS DISTINCT FROM OLD.evaluation THEN
    RAISE EXCEPTION 'experiment evaluation is frozen';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER variant_evaluation_immutable BEFORE UPDATE ON variant_experiment
FOR EACH ROW EXECUTE FUNCTION preserve_variant_evaluation();
