-- F-17/F-18: persist truthful mixed scraper outcomes.
-- The API already distinguishes partial evidence from completed research. Keep
-- the durable state contract aligned so a mixed competitor response cannot be
-- stored as completed or coerced to failed at the authenticated boundary.

ALTER TABLE scrape_run
  DROP CONSTRAINT IF EXISTS scrape_run_state_check;

ALTER TABLE scrape_run
  ADD CONSTRAINT scrape_run_state_check
  CHECK (state IN ('queued', 'running', 'completed', 'partial', 'failed'));
