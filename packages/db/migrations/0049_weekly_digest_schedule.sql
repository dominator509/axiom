-- Opt-in schedule identity; NULL disables recurring digest generation.
ALTER TABLE org_settings ADD COLUMN weekly_digest_schedule_id uuid;
