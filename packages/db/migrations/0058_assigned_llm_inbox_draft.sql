-- Assigned-LLM private inbox drafts reuse the existing reply-intent and
-- dispatch-fence tables. Generation creates a pending reviewable intent only;
-- publication still requires a separate human approval and the existing send
-- confirmation/consent/safety gates.
ALTER TABLE inbox_reply_intent
  ADD COLUMN draft_source TEXT NOT NULL DEFAULT 'human',
  ADD COLUMN draft_actor_ref TEXT,
  ADD COLUMN roleplay_turn_id UUID UNIQUE REFERENCES roleplay_turn(id),
  ADD COLUMN approved_by_user_id TEXT,
  ADD COLUMN approved_at TIMESTAMPTZ;

ALTER TABLE inbox_reply_intent
  ADD CONSTRAINT inbox_reply_draft_source_check
    CHECK (draft_source IN ('human', 'llm')),
  ADD CONSTRAINT inbox_reply_draft_identity_check
    CHECK ((draft_source = 'human' AND draft_actor_ref IS NULL AND roleplay_turn_id IS NULL)
      OR (draft_source = 'llm' AND char_length(btrim(draft_actor_ref)) BETWEEN 1 AND 128 AND roleplay_turn_id IS NOT NULL)),
  ADD CONSTRAINT inbox_reply_approval_check
    CHECK ((approved_by_user_id IS NULL) = (approved_at IS NULL)
      AND (draft_source = 'llm' OR approved_by_user_id IS NULL));

ALTER TABLE inbox_reply_intent
  ADD CONSTRAINT inbox_reply_approver
    FOREIGN KEY (org_id, approved_by_user_id) REFERENCES auth_user(org_id, id);

CREATE INDEX inbox_reply_pending_draft
  ON inbox_reply_intent(org_id, model_id, connection_id, counterpart_uuid, created_at, id)
  WHERE state = 'pending' AND draft_source = 'llm';

CREATE OR REPLACE FUNCTION enforce_inbox_reply_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.provider_status IS NOT NULL
       OR NEW.approved_by_user_id IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'reply intent must start pending and unapproved';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.id,NEW.org_id,NEW.model_id,NEW.connection_id,NEW.actor_user_id,
         NEW.counterpart_uuid,NEW.intent_key,NEW.body,NEW.draft_source,
         NEW.draft_actor_ref,NEW.roleplay_turn_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.org_id,OLD.model_id,OLD.connection_id,OLD.actor_user_id,
         OLD.counterpart_uuid,OLD.intent_key,OLD.body,OLD.draft_source,
         OLD.draft_actor_ref,OLD.roleplay_turn_id,OLD.created_at) THEN
    RAISE EXCEPTION 'reply intent identity, source and text are immutable';
  END IF;

  IF OLD.approved_by_user_id IS NOT NULL
     AND (NEW.approved_by_user_id, NEW.approved_at)
         IS DISTINCT FROM (OLD.approved_by_user_id, OLD.approved_at) THEN
    RAISE EXCEPTION 'reply approval is immutable';
  END IF;

  IF OLD.approved_by_user_id IS NULL
     AND (NEW.approved_by_user_id IS NULL OR NEW.approved_at IS NULL
          OR OLD.state <> 'pending' OR NEW.state <> 'pending') THEN
    IF (NEW.approved_by_user_id, NEW.approved_at)
       IS DISTINCT FROM (OLD.approved_by_user_id, OLD.approved_at) THEN
      RAISE EXCEPTION 'only a pending reply can receive one human approval';
    END IF;
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
