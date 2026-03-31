-- Migration: brand_id UUID → brand_ids UUID[] for multi-brand campaign support

-- 1. campaign_journalists: add brand_ids, migrate data, drop brand_id
ALTER TABLE "campaign_journalists" ADD COLUMN "brand_ids" uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];
UPDATE "campaign_journalists" SET "brand_ids" = ARRAY["brand_id"];
ALTER TABLE "campaign_journalists" DROP COLUMN "brand_id";
CREATE INDEX "idx_cj_brand_ids" ON "campaign_journalists" USING gin ("brand_ids");

-- 2. discovery_cache: add brand_ids, migrate data, drop old constraint + column
DROP INDEX IF EXISTS "idx_dc_org_brand_campaign_outlet";
ALTER TABLE "discovery_cache" ADD COLUMN "brand_ids" uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];
UPDATE "discovery_cache" SET "brand_ids" = ARRAY["brand_id"];
ALTER TABLE "discovery_cache" DROP COLUMN "brand_id";
CREATE UNIQUE INDEX "idx_dc_org_campaign_outlet" ON "discovery_cache" ("org_id", "campaign_id", "outlet_id");
