-- Buffer status enum
CREATE TYPE "public"."buffer_status" AS ENUM('buffered', 'claimed', 'served', 'skipped');

-- Add status column to campaign_journalists (existing rows become 'served' since they were already returned)
ALTER TABLE "campaign_journalists" ADD COLUMN "status" "buffer_status" NOT NULL DEFAULT 'served';

-- New rows should default to 'buffered'
ALTER TABLE "campaign_journalists" ALTER COLUMN "status" SET DEFAULT 'buffered';

-- Index for efficient buffer claiming: (campaign, outlet, status, relevance_score DESC)
CREATE INDEX "idx_cj_buffer_claim" ON "campaign_journalists" ("campaign_id", "outlet_id", "status", "relevance_score");

-- Idempotency cache table
CREATE TABLE IF NOT EXISTS "idempotency_cache" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE,
  "response_body" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
