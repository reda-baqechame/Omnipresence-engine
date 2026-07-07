-- Superseded by 0068_fix_data_source_constraints.sql.
-- Original 0065 referenced renamed/phantom tables (deep_crawl_pages, source_graph_nodes, …)
-- and had nested dollar-quote syntax errors. Keep this migration as a no-op so version
-- ordering stays intact on databases that have not yet applied 0065.

SELECT 1;
