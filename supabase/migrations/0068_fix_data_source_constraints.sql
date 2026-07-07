-- Correct 0065 table-name drift: apply 5-value data_source CHECK to actual schema tables.

DO $$
DECLARE
  t TEXT;
  nullable_tables TEXT[] := ARRAY[
    'visibility_results',
    'technical_findings',
    'coverage_items',
    'authority_opportunities',
    'scores',
    'keyword_opportunities',
    'attribution_metrics',
    'cwv_history',
    'crawl_pages',
    'crawl_issues',
    'rank_snapshots',
    'brand_mentions',
    'product_visibility_snapshots',
    'source_domains',
    'source_mentions',
    'source_opportunities',
    'source_edges',
    'merchant_products',
    'ai_probe_traces',
    'rank_keywords',
    'gsc_snapshots',
    'gbp_snapshots',
    'ai_visibility_snapshots',
    'data_quality_scores'
  ];
  not_null_tables TEXT[] := ARRAY[
    'behavior_metrics',
    'backlink_graph_snapshots',
    'measurement_evidence'
  ];
  full_check TEXT := $check$data_source IS NULL OR data_source IN (
    'measured', 'estimated', 'model_knowledge', 'simulated', 'unavailable'
  )$check$;
  full_check_nn TEXT := $check$data_source IN (
    'measured', 'estimated', 'model_knowledge', 'simulated', 'unavailable'
  )$check$;
BEGIN
  FOREACH t IN ARRAY nullable_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_data_source_check');
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'data_source'
      ) THEN
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', t, t || '_data_source_check', full_check);
      END IF;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY not_null_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_data_source_check');
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'data_source'
      ) THEN
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', t, t || '_data_source_check', full_check_nn);
      END IF;
    END IF;
  END LOOP;
END $$;

-- citation_sources intentionally keeps legacy 2-value enum (measured | simulated).
ALTER TABLE citation_sources DROP CONSTRAINT IF EXISTS citation_sources_data_source_check;
ALTER TABLE citation_sources
  ADD CONSTRAINT citation_sources_data_source_check
  CHECK (data_source IN ('measured', 'simulated'));
