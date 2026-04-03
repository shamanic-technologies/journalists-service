-- Replace outlet+email index with email-only index (dedup is now by email, not outlet)
DROP INDEX IF EXISTS "idx_cj_outlet_email";
CREATE INDEX IF NOT EXISTS "idx_cj_email" ON "campaign_journalists" ("email");
-- Add index for apollo_person_id dedup
CREATE INDEX IF NOT EXISTS "idx_cj_apollo_person_id" ON "campaign_journalists" ("apollo_person_id");
