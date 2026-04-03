ALTER TABLE "campaign_journalists" ADD COLUMN "email" text;
ALTER TABLE "campaign_journalists" ADD COLUMN "apollo_person_id" text;
CREATE INDEX IF NOT EXISTS "idx_cj_outlet_email" ON "campaign_journalists" ("outlet_id", "email");
