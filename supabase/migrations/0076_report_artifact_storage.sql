-- Report artifacts must be served from the storage object that was actually
-- generated, not re-derived from a public URL against a bucket that
-- migration 0073 made private (getPublicUrl() on a private bucket is a dead
-- link). Store the storage object PATH instead, and record when a report's
-- PDF render degraded to an HTML download so the UI/API can say so honestly
-- instead of silently swapping content types.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS html_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS pdf_degraded BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN reports.pdf_storage_path IS 'Object path within the private "reports" storage bucket, resolved via service-role download() — not a fetchable URL.';
COMMENT ON COLUMN reports.html_storage_path IS 'Object path within the private "reports" storage bucket for the HTML artifact.';
COMMENT ON COLUMN reports.pdf_degraded IS 'True when PDF rendering failed at generation time and only an HTML artifact is available for download.';
COMMENT ON COLUMN reports.pdf_url IS 'Deprecated: historically a getPublicUrl() result against the reports bucket, which has been private since 0073_reports_bucket_private.sql. Do not treat as a fetchable link — use pdf_storage_path via the service role client instead.';
COMMENT ON COLUMN reports.html_url IS 'Deprecated: see pdf_url. Use html_storage_path.';
