-- First-party trusted-source routing for rank tracking. When Search Console is
-- connected, the tracked position comes from the user's own measured ranking
-- (first_party) instead of a public SERP scrape (public_serp). Persist the
-- source, confidence, and the public SERP position alongside it so the UI can
-- label each keyword honestly and pros can cross-check against Search Console.

ALTER TABLE rank_keywords
  ADD COLUMN IF NOT EXISTS last_rank_source TEXT,
  ADD COLUMN IF NOT EXISTS last_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_public_position INTEGER;
