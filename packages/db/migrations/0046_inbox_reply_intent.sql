-- The runner owns the transaction. Dispatch is committed before network I/O.
ALTER TABLE platform_connection ADD CONSTRAINT platform_connection_scope_identity UNIQUE (org_id, model_id, id);
CREATE TABLE IF NOT EXISTS inbox_reply_intent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id UUID NOT NULL,
  connection_id UUID NOT NULL,
  actor_user_id TEXT NOT NULL,
  counterpart_uuid UUID NOT NULL,
  intent_key UUID NOT NULL,
  body TEXT NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 5000),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','dispatching','sent','rejected','uncertain','cancelled')),
  remote_message_uuid UUID,
  provider_status INTEGER CHECK (provider_status BETWEEN 100 AND 599),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  CONSTRAINT inbox_reply_intent_key UNIQUE (org_id, actor_user_id, intent_key),
  CONSTRAINT inbox_reply_model FOREIGN KEY (org_id, model_id) REFERENCES model_profile(org_id,id) ON DELETE CASCADE,
  CONSTRAINT inbox_reply_connection FOREIGN KEY (org_id,model_id,connection_id) REFERENCES platform_connection(org_id,model_id,id),
  CONSTRAINT inbox_reply_actor FOREIGN KEY (org_id,actor_user_id) REFERENCES auth_user(org_id,id),
  CONSTRAINT inbox_reply_receipt CHECK ((state = 'sent') = (remote_message_uuid IS NOT NULL)),
  CONSTRAINT inbox_reply_dispatch CHECK ((state IN ('dispatching','sent','rejected','uncertain')) = (dispatched_at IS NOT NULL)),
  CONSTRAINT inbox_reply_final CHECK ((state IN ('sent','rejected','uncertain','cancelled')) = (finalized_at IS NOT NULL))
);
CREATE INDEX inbox_reply_conversation ON inbox_reply_intent(org_id,model_id,connection_id,counterpart_uuid,created_at,id);
CREATE UNIQUE INDEX inbox_reply_provider_receipt ON inbox_reply_intent(connection_id,remote_message_uuid) WHERE remote_message_uuid IS NOT NULL;
ALTER TABLE inbox_reply_intent ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_reply_intent FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON inbox_reply_intent
  USING (org_id = current_setting('app.current_org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

CREATE FUNCTION enforce_inbox_reply_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.provider_status IS NOT NULL THEN
      RAISE EXCEPTION 'reply intent must start pending';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.org_id,NEW.model_id,NEW.connection_id,NEW.actor_user_id,NEW.counterpart_uuid,NEW.intent_key,NEW.body,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.org_id,OLD.model_id,OLD.connection_id,OLD.actor_user_id,OLD.counterpart_uuid,OLD.intent_key,OLD.body,OLD.created_at) THEN
    RAISE EXCEPTION 'reply intent identity and text are immutable';
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF OLD.state = 'pending' AND NEW.state IN ('dispatching','cancelled') THEN
    IF NEW.provider_status IS NOT NULL THEN RAISE EXCEPTION 'no provider outcome before dispatch'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'dispatching' AND NEW.state IN ('sent','rejected','uncertain') AND NEW.dispatched_at = OLD.dispatched_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid reply transition';
END;
$$;
CREATE TRIGGER inbox_reply_transition BEFORE INSERT OR UPDATE ON inbox_reply_intent
  FOR EACH ROW EXECUTE FUNCTION enforce_inbox_reply_transition();
REVOKE ALL ON FUNCTION enforce_inbox_reply_transition() FROM PUBLIC;
REVOKE ALL ON inbox_reply_intent FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON inbox_reply_intent TO axiom_app;
GRANT ALL ON inbox_reply_intent TO axiom_migrator;
