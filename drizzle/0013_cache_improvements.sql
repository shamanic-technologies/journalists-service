-- Cache improvements:
-- 1. New outlet_scrape_cache table (global scrape tracking by outlet, 3-month TTL)
-- 2. Change discovery_cache from (org, campaign, outlet) to (org, outlet) scoring cache

-- 1. Outlet scrape cache
CREATE TABLE "outlet_scrape_cache" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "outlet_id" uuid NOT NULL,
  "scraped_at" timestamp with time zone NOT NULL
);
CREATE UNIQUE INDEX "idx_osc_outlet" ON "outlet_scrape_cache" ("outlet_id");

-- 2. Modify discovery_cache: change unique key from (org, campaign, outlet) to (org, outlet)
-- Deduplicate: keep only the most recent row per (org_id, outlet_id)
DELETE FROM discovery_cache
WHERE id NOT IN (
  SELECT DISTINCT ON (org_id, outlet_id) id
  FROM discovery_cache
  ORDER BY org_id, outlet_id, discovered_at DESC
);

-- Drop old unique constraint
DROP INDEX "idx_dc_org_campaign_outlet";

-- Make campaign_id nullable (no longer part of cache key)
ALTER TABLE "discovery_cache" ALTER COLUMN "campaign_id" DROP NOT NULL;

-- Add new unique constraint
CREATE UNIQUE INDEX "idx_dc_org_outlet" ON "discovery_cache" ("org_id", "outlet_id");
