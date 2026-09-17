-- Human review is separate evidence, never a rewrite/reset of a dispatch attempt.
ALTER TABLE inbox_reply_intent ADD CONSTRAINT inbox_reply_scope_identity UNIQUE (org_id, model_id, id);
CREATE TABLE IF NOT EXISTS inbox_reply_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id UUID NOT NULL,
  reply_id UUID NOT NULL,
  actor_user_id TEXT NOT NULL,
  intent_key UUID NOT NULL,
  conclusion TEXT NOT NULL CHECK (conclusion IN ('observed_sent','unresolved')),
  observed_message_uuid UUID,
  note TEXT NOT NULL CHECK (length(btrim(note)) > 0 AND length(note) <= 2000),
  evidence_source TEXT NOT NULL DEFAULT 'operator_review' CHECK (evidence_source = 'operator_review'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inbox_reply_review_key UNIQUE (org_id,actor_user_id,intent_key),
  CONSTRAINT inbox_reply_review_parent FOREIGN KEY (org_id,model_id,reply_id) REFERENCES inbox_reply_intent(org_id,model_id,id) ON DELETE CASCADE,
  CONSTRAINT inbox_reply_review_actor FOREIGN KEY (org_id,actor_user_id) REFERENCES auth_user(org_id,id),
  CONSTRAINT inbox_reply_review_receipt CHECK ((conclusion = 'observed_sent') = (observed_message_uuid IS NOT NULL))
);
CREATE INDEX inbox_reply_review_history ON inbox_reply_review(org_id,model_id,reply_id,created_at,id);
ALTER TABLE inbox_reply_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_reply_review FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON inbox_reply_review
  USING (org_id = current_setting('app.current_org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

CREATE FUNCTION enforce_inbox_reply_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM inbox_reply_intent WHERE org_id=NEW.org_id AND model_id=NEW.model_id AND id=NEW.reply_id AND state IN ('dispatching','uncertain')) THEN
    RAISE EXCEPTION 'review requires an unresolved dispatch attempt';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inbox_reply_review_insert BEFORE INSERT ON inbox_reply_review
  FOR EACH ROW EXECUTE FUNCTION enforce_inbox_reply_review();
REVOKE ALL ON FUNCTION enforce_inbox_reply_review() FROM PUBLIC;
REVOKE ALL ON inbox_reply_review FROM PUBLIC;
GRANT SELECT, INSERT ON inbox_reply_review TO axiom_app;
GRANT ALL ON inbox_reply_review TO axiom_migrator;
