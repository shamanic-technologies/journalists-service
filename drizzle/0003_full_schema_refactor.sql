-- Full schema refactor: replace 6 legacy tables with 3 scoped tables
-- Drop all legacy views
DROP VIEW IF EXISTS v_journalists_status;
DROP VIEW IF EXISTS v_journalists_engagement;
DROP VIEW IF EXISTS v_journalists_user_engagement;
DROP VIEW IF EXISTS v_outlet_journalists_emails_need_verification_status;
DROP VIEW IF EXISTS v_outlet_journalists_need_agent_search_status;
DROP VIEW IF EXISTS v_outlet_journalists_need_enrichment_status;
DROP VIEW IF EXISTS v_outlet_journalists_need_email_update_status;
DROP VIEW IF EXISTS v_outlet_journalist_searched_emails_events;
DROP VIEW IF EXISTS v_outlet_journalist_enriched_events;
DROP VIEW IF EXISTS v_outlet_journalist_enriched_emails_events;
DROP VIEW IF EXISTS v_valid_journalist_emails;

-- Drop legacy tables in dependency order
DROP TABLE IF EXISTS searched_emails;
DROP TABLE IF EXISTS enriched_emails;
DROP TABLE IF EXISTS enriched_individuals;
DROP TABLE IF EXISTS campaign_outlet_journalists;
DROP TABLE IF EXISTS outlet_journalists;
DROP TABLE IF EXISTS press_journalists;

-- Drop unused enums
DROP TYPE IF EXISTS verification_status;
DROP TYPE IF EXISTS email_status;
DROP TYPE IF EXISTS source_status;

-- Create new tables
CREATE TABLE journalists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL,
  first_name text,
  last_name text,
  journalist_name text NOT NULL,
  entity_type entity_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_journalists_outlet_name_type ON journalists (outlet_id, journalist_name, entity_type);

CREATE TABLE campaign_journalists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journalist_id uuid NOT NULL REFERENCES journalists(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  feature_slug text,
  campaign_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  relevance_score numeric(5, 2) NOT NULL,
  why_relevant text NOT NULL,
  why_not_relevant text NOT NULL,
  article_urls jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_cj_campaign_outlet_journalist ON campaign_journalists (campaign_id, outlet_id, journalist_id);
CREATE INDEX idx_cj_campaign ON campaign_journalists (campaign_id);
CREATE INDEX idx_cj_journalist ON campaign_journalists (journalist_id);
CREATE INDEX idx_cj_org ON campaign_journalists (org_id);

CREATE TABLE discovery_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  discovered_at timestamptz NOT NULL,
  run_id uuid
);

CREATE UNIQUE INDEX idx_dc_org_brand_campaign_outlet ON discovery_cache (org_id, brand_id, campaign_id, outlet_id);
