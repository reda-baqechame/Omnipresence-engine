-- Opt-in daily rank tracking. Defaults OFF so existing projects keep the
-- weekly cadence (and weekly SERP spend); agencies/pro plans can flip this on
-- per project for volatile money keywords.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS daily_rank_tracking BOOLEAN NOT NULL DEFAULT false;
