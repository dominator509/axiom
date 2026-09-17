-- Persist MCP publishing intent until the human approval path creates targets.
-- This keeps schedule/publish semantics and the requested destination attached
-- to the review unit without bypassing the ToS and consent gates.
BEGIN;

ALTER TABLE content_bundle
    ADD COLUMN IF NOT EXISTS publish_intent JSONB;

COMMIT;
