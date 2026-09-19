-- The runner owns the transaction. Existing profiles have no character lock.
ALTER TABLE model_profile
  ADD COLUMN character_lock_prompt text NOT NULL DEFAULT '',
  ADD COLUMN character_lock_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT model_character_lock_length CHECK (char_length(character_lock_prompt) <= 2000),
  ADD CONSTRAINT model_character_lock_version_nonnegative CHECK (character_lock_version >= 0);
