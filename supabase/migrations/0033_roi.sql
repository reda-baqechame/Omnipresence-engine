-- Phase 21: ROI command center — project settings (UX layer config, etc.)

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';
