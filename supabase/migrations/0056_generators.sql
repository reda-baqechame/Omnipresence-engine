-- Wave Q5 — new content asset types for the alternative-page generator and the
-- server-side llms.txt pipeline.

ALTER TYPE content_asset_type ADD VALUE IF NOT EXISTS 'alternative_page';
ALTER TYPE content_asset_type ADD VALUE IF NOT EXISTS 'llms_txt';
