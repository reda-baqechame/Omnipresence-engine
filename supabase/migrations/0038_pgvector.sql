-- Phase 3 (100X): local semantic engine — pgvector storage for keyless
-- all-MiniLM-L6-v2 (384-dim) embeddings computed by OmniData.
-- The extension is optional; if a managed Postgres lacks it the app still works
-- (semantic features report `available:false`). Guarded so a missing extension
-- does not abort the whole migration batch.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension unavailable; semantic storage disabled';
END$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS content_embeddings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'page',          -- page | keyword | title
      ref TEXT NOT NULL,                           -- url / keyword / id
      content_hash TEXT,
      embedding vector(384),
      model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (project_id, kind, ref)
    );

    CREATE INDEX IF NOT EXISTS idx_content_embeddings_project ON content_embeddings(project_id, kind);

    ALTER TABLE content_embeddings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS content_embeddings_all ON content_embeddings;
    CREATE POLICY content_embeddings_all ON content_embeddings FOR ALL
      USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
  END IF;
END$$;
