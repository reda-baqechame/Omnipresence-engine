-- Keyword CPC cache: gatherReportData() previously re-fetched real Keyword
-- Planner CPC (via OmniData's /keywords/metrics/live) on every single report
-- generation, with no reuse across reports/projects that share overlapping
-- keywords. That's both an avoidable cost (real, billable Google Ads API
-- calls) and an avoidable cancellation-latency risk (Patch C.1): a cancelled
-- report still has to wait out an in-flight network call it didn't need.
--
-- This table caches ONLY real Keyword Planner measurements (never estimates —
-- see the CHECK constraint) keyed by (keyword, geo), so a cache hit can
-- always be labeled `cpcSource: "real"` honestly. Global/shared, not
-- org-scoped: CPC for a given keyword+geo is a market fact, not
-- tenant-specific data, matching the existing api_spend_daily precedent for
-- shared, service-role-only reference data.

CREATE TABLE IF NOT EXISTS keyword_cpc_cache (
  keyword TEXT NOT NULL,
  geo TEXT NOT NULL DEFAULT 'US',
  cpc NUMERIC(10, 2) NOT NULL CHECK (cpc > 0),
  -- Fixed to 'keyword_planner': this cache must never store an
  -- industry-estimate or otherwise fabricated value (Patch C.1 requirement:
  -- "no fake metrics" applies to cached data too).
  data_source TEXT NOT NULL DEFAULT 'keyword_planner' CHECK (data_source = 'keyword_planner'),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (keyword, geo)
);

CREATE INDEX IF NOT EXISTS keyword_cpc_cache_fetched_at_idx ON keyword_cpc_cache (fetched_at);

-- Only the service role reads/writes this cache (same posture as
-- api_spend_daily / provider_telemetry); RLS on with no public policies.
ALTER TABLE keyword_cpc_cache ENABLE ROW LEVEL SECURITY;
