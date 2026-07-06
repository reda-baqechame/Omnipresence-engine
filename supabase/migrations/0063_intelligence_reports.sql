-- Deep Intelligence Report: type, section config, async generation status
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS report_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (report_type IN ('standard', 'deep')),
  ADD COLUMN IF NOT EXISTS sections JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS html_url TEXT;

CREATE INDEX IF NOT EXISTS idx_reports_project_status ON reports(project_id, status, created_at DESC);
