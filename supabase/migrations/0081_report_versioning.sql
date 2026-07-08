-- Basic report versioning: regenerating a report for a project today just
-- creates another unrelated `reports` row with no link to the one it's
-- meant to replace, so the Reports list fills up with an unordered pile of
-- "OmniPresence Report" entries and there is no way to tell which one is
-- current. Add a supersede pointer + a per-lineage version counter, scoped
-- per (project_id, report_type) so a project's standard and deep report
-- lineages stay independent of each other.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS previous_report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS reports_previous_report_idx
  ON reports(previous_report_id)
  WHERE previous_report_id IS NOT NULL;
