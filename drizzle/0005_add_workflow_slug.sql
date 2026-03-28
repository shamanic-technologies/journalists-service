-- Add workflow_slug column to campaign_journalists
ALTER TABLE "campaign_journalists" ADD COLUMN IF NOT EXISTS "workflow_slug" text;

-- Index for stats filtering by workflow_slug
CREATE INDEX IF NOT EXISTS "idx_cj_workflow_slug" ON "campaign_journalists" ("workflow_slug");

-- Index for stats filtering by feature_slug (if not already present)
CREATE INDEX IF NOT EXISTS "idx_cj_feature_slug" ON "campaign_journalists" ("feature_slug");
