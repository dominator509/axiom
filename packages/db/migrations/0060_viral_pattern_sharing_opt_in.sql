-- F-86: cross-model learning is disabled until an owner or manager opts this
-- model into both contributing and receiving abstract organization patterns.
ALTER TABLE model_profile
  ADD COLUMN viral_pattern_sharing_enabled BOOLEAN NOT NULL DEFAULT FALSE;
