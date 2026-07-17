-- Master Plan v4 Phase 3 — new plan slugs (Solo $29 / Growth $79 / Agency $199).
-- Step 1 of 2: add the enum values. Rows are remapped in 0089 (a new enum value
-- cannot be used in the same transaction that adds it).

ALTER TYPE subscription_plan ADD VALUE IF NOT EXISTS 'solo';
ALTER TYPE subscription_plan ADD VALUE IF NOT EXISTS 'growth';
