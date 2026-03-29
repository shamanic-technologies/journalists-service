-- Add run_id column to campaign_journalists to track which run created each entry
ALTER TABLE "campaign_journalists" ADD COLUMN "run_id" uuid;
CREATE INDEX "idx_cj_run_id" ON "campaign_journalists" ("run_id");
