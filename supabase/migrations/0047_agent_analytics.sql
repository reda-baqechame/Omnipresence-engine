-- Agent Analytics: log of AI crawler/agent hits on the customer's site.
-- This is the leading indicator of citation — AI engines must fetch your pages
-- (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, OAI-SearchBot, …) before
-- they can cite you. Ingested keyless via a tracking beacon or a server/CDN log
-- paste, then aggregated into bot-by-bot crawl frequency, purpose mix, and the
-- most-crawled paths. Profound gates this behind enterprise CDN integrations;
-- we offer it open.

CREATE TABLE IF NOT EXISTS ai_crawler_hits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bot TEXT NOT NULL,
  vendor TEXT NOT NULL,
  purpose TEXT NOT NULL,
  path TEXT,
  status_code INT,
  user_agent TEXT,
  hit_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_crawler_hits_project ON ai_crawler_hits(project_id, hit_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_crawler_hits_bot ON ai_crawler_hits(project_id, bot);
CREATE INDEX IF NOT EXISTS idx_ai_crawler_hits_vendor ON ai_crawler_hits(project_id, vendor);

ALTER TABLE ai_crawler_hits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_crawler_hits_all ON ai_crawler_hits;
CREATE POLICY ai_crawler_hits_all ON ai_crawler_hits FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
