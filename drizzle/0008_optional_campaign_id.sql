ALTER TABLE "campaign_journalists" ALTER COLUMN "campaign_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "discovery_cache" ALTER COLUMN "campaign_id" DROP NOT NULL;
