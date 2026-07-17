-- Persistent cross-tenant grounded-probe cache (Master Plan v4 economics
-- guardrail: "cache shared prompt results across tenants; dedupe identical
-- prompt/engine cells"). Grounded web-search probes are the most expensive
-- calls the platform makes; identical prompt+engine+persona cells asked by
-- different tenants (or the public grader) within the TTL reuse one answer.
--
-- Deliberately GLOBAL (no organization_id): rows contain only engine answers
-- to generic buyer prompts — no tenant data. RLS is enabled with NO user
-- policies, so only the service role (server-side scanner) can touch it.
-- Panel runs bypass this cache entirely (probeCacheMode='record') so repeated-
-- run volatility stays a real measurement.
CREATE TABLE IF NOT EXISTS probe_cache (
  cache_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  answer TEXT NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_probe_cache_created ON probe_cache (created_at);

ALTER TABLE probe_cache ENABLE ROW LEVEL SECURITY;
