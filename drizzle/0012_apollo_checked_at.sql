-- Store Apollo lookup results on the global journalists table
-- so we don't re-call Apollo for the same person across campaigns
ALTER TABLE "journalists" ADD COLUMN "apollo_email" text;
ALTER TABLE "journalists" ADD COLUMN "apollo_email_status" text;
ALTER TABLE "journalists" ADD COLUMN "apollo_person_id" text;
ALTER TABLE "journalists" ADD COLUMN "apollo_checked_at" timestamp with time zone;
-- Index for outlet-blocked query: find journalists with no Apollo email
CREATE INDEX IF NOT EXISTS "idx_journalists_apollo_checked" ON "journalists" ("outlet_id", "apollo_checked_at");
