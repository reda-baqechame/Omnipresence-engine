-- Phase 14 (100X): Social & community mention firehose.
-- Extend allowed platforms to include the broader free/keyless sources.

ALTER TABLE community_mentions DROP CONSTRAINT IF EXISTS community_mentions_platform_check;
ALTER TABLE community_mentions
  ADD CONSTRAINT community_mentions_platform_check
  CHECK (platform IN (
    'reddit', 'quora', 'hacker_news', 'github',
    'stackexchange', 'producthunt', 'mastodon', 'bluesky', 'wikipedia',
    'other'
  ));
