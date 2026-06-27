-- Phase 2: Honest AI Measurement.
-- Distinguish grounded (live search UI / retrieval with citations) from
-- model_knowledge (an LLM's parametric answer with no browsing), and capture the
-- richer signals experts need: sentiment, recommendation strength, whether the
-- brand's OWN site was cited vs third-party, answer position, and the sampling
-- stability (sample_count + variance) behind each yes/no.

ALTER TABLE visibility_results
  ADD COLUMN IF NOT EXISTS measurement_mode TEXT,          -- grounded | model_knowledge
  ADD COLUMN IF NOT EXISTS sentiment TEXT,                 -- positive | neutral | negative | unknown
  ADD COLUMN IF NOT EXISTS recommendation_strength NUMERIC, -- 0-1 (how strongly recommended)
  ADD COLUMN IF NOT EXISTS owned_cited BOOLEAN,            -- brand's own domain was cited
  ADD COLUMN IF NOT EXISTS third_party_cited BOOLEAN,      -- a third-party source cited the brand
  ADD COLUMN IF NOT EXISTS answer_position INT,            -- ordinal position of the brand in the answer
  ADD COLUMN IF NOT EXISTS sample_count INT,               -- number of samples behind this result
  ADD COLUMN IF NOT EXISTS variance NUMERIC;               -- 0-1 variance of brand mention across samples
