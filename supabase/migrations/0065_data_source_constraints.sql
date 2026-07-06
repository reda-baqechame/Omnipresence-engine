-- Platform-wide data_source CHECK constraints (trust spine enforcement at DB layer).

-- Full 5-value provenance enum (nullable columns allow NULL).
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'visibility_results',
    'technical_findings',
    'coverage_items',
    'authority_opportunities',
    'scores',
    'keyword_opportunities',
    'attribution_metrics',
    'cwv_history',
    'deep_crawl_pages',
    'deep_crawl_issues',
    'gsc_snapshots',
    'ga4_snapshots',
    'bing_snapshots',
    'rank_snapshots',
    'product_visibility_snapshots',
    'source_graph_nodes',
    'source_graph_edges',
    'source_influence_scores',
    'citation_authority_scores',
    'merchant_listings',
    'ai_probe_traces',
    'rank_keywords',
    'rank_history',
    'measurement_evidence',
    'backlink_graph_edges',
    'traffic_panel_observations'
  ];
  full_check TEXT := $$data_source IS NULL OR data_source IN (
    'measured', 'estimated', 'model_knowledge', 'simulated', 'unavailable'
  )$$;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_data_source_check');
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'data_source'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', t, t || '_data_source_check', full_check);
    END IF;
  END LOOP;
END $$;

-- NOT NULL tables with full enum (no NULL).
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'behavior_metrics',
    'backlink_graph_edges'
  ];
  full_check_nn TEXT := $$data_source IN (
    'measured', 'estimated', 'model_knowledge', 'simulated', 'unavailable'
  )$$;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_data_source_check');
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'data_source'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', t, t || '_data_source_check', full_check_nn);
    END IF;
  END LOOP;
END $$;

-- Legacy citation_sources: measured | simulated only.
ALTER TABLE citation_sources DROP CONSTRAINT IF EXISTS citation_sources_data_source_check;
ALTER TABLE citation_sources
  ADD CONSTRAINT citation_sources_data_source_check
  CHECK (data_source IN ('measured', 'simulated'));
