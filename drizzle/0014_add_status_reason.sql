-- Add status_reason and status_detail columns to campaign_journalists
-- status_reason: machine-readable slug (e.g. "no-email", "already-contacted")
-- status_detail: human-readable debug info with IDs, names, etc.

ALTER TABLE "campaign_journalists" ADD COLUMN "status_reason" text;
ALTER TABLE "campaign_journalists" ADD COLUMN "status_detail" text;
