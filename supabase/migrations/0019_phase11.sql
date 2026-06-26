-- Phase 11: Free Data Moat
-- Extend community mention platforms to include Hacker News and GitHub so the
-- keyless community engine can persist those real mentions.

ALTER TABLE community_mentions DROP CONSTRAINT IF EXISTS community_mentions_platform_check;
ALTER TABLE community_mentions
  ADD CONSTRAINT community_mentions_platform_check
  CHECK (platform IN ('reddit', 'quora', 'hacker_news', 'github', 'other'));
