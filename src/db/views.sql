-- Stub views for email pipeline, engagement, and status
-- These return the correct column shapes but use simplified join logic
-- Refinement happens during cross-service integration

CREATE OR REPLACE VIEW v_valid_journalist_emails AS
SELECT
  se.journalist_id,
  se.outlet_id,
  se.journalist_email AS email,
  CASE WHEN ee.status = 'valid' THEN true ELSE false END AS is_valid,
  COALESCE(se.source_status::text, 'Pure guess') AS type,
  'searched' AS source,
  COALESCE(ee.score, 0) AS confidence
FROM searched_emails se
LEFT JOIN enriched_emails ee ON ee.email = se.journalist_email
WHERE se.searched_at = (
  SELECT MAX(se2.searched_at) FROM searched_emails se2
  WHERE se2.outlet_id = se.outlet_id AND se2.journalist_id = se.journalist_id
);

CREATE OR REPLACE VIEW v_outlet_journalist_enriched_emails_events AS
SELECT
  oj.outlet_id,
  oj.journalist_id,
  ee.email,
  ee.enriched_at,
  ee.status::text,
  ee.score,
  ee.accept_all
FROM outlet_journalists oj
JOIN press_journalists pj ON pj.id = oj.journalist_id
JOIN enriched_individuals ei ON ei.first_name = pj.first_name AND ei.last_name = pj.last_name
JOIN enriched_emails ee ON ee.email LIKE '%@' || ei.domain;

CREATE OR REPLACE VIEW v_outlet_journalist_enriched_events AS
SELECT
  oj.outlet_id,
  oj.journalist_id,
  ei.first_name,
  ei.last_name,
  ei.domain,
  ei.enriched_at,
  ei.position,
  ei.verification_status::text,
  ei.score
FROM outlet_journalists oj
JOIN press_journalists pj ON pj.id = oj.journalist_id
LEFT JOIN enriched_individuals ei ON ei.first_name = pj.first_name AND ei.last_name = pj.last_name;

CREATE OR REPLACE VIEW v_outlet_journalist_searched_emails_events AS
SELECT
  se.outlet_id,
  se.journalist_id,
  se.journalist_email,
  se.searched_at,
  se.source_status::text,
  se.source_quote
FROM searched_emails se;

CREATE OR REPLACE VIEW v_outlet_journalists_need_email_update_status AS
SELECT
  oj.outlet_id,
  oj.journalist_id,
  pj.journalist_name,
  pj.first_name,
  pj.last_name,
  MAX(se.searched_at) AS last_searched_at,
  MAX(ee.enriched_at) AS last_enriched_at
FROM outlet_journalists oj
JOIN press_journalists pj ON pj.id = oj.journalist_id
LEFT JOIN searched_emails se ON se.outlet_id = oj.outlet_id AND se.journalist_id = oj.journalist_id
LEFT JOIN enriched_emails ee ON ee.email IN (SELECT se2.journalist_email FROM searched_emails se2 WHERE se2.journalist_id = oj.journalist_id)
GROUP BY oj.outlet_id, oj.journalist_id, pj.journalist_name, pj.first_name, pj.last_name;

CREATE OR REPLACE VIEW v_outlet_journalists_need_enrichment_status AS
SELECT
  oj.outlet_id,
  oj.journalist_id,
  pj.journalist_name,
  pj.first_name,
  pj.last_name
FROM outlet_journalists oj
JOIN press_journalists pj ON pj.id = oj.journalist_id
LEFT JOIN enriched_individuals ei ON ei.first_name = pj.first_name AND ei.last_name = pj.last_name
WHERE ei.first_name IS NULL;

CREATE OR REPLACE VIEW v_outlet_journalists_need_agent_search_status AS
SELECT
  oj.outlet_id,
  oj.journalist_id,
  pj.journalist_name,
  pj.first_name,
  pj.last_name
FROM outlet_journalists oj
JOIN press_journalists pj ON pj.id = oj.journalist_id
LEFT JOIN searched_emails se ON se.outlet_id = oj.outlet_id AND se.journalist_id = oj.journalist_id
WHERE se.journalist_email IS NULL;

CREATE OR REPLACE VIEW v_outlet_journalists_emails_need_verification_status AS
SELECT
  se.outlet_id,
  se.journalist_id,
  se.journalist_email AS email
FROM searched_emails se
LEFT JOIN enriched_emails ee ON ee.email = se.journalist_email
WHERE ee.email IS NULL;

CREATE OR REPLACE VIEW v_journalists_user_engagement AS
SELECT
  pj.id AS journalist_id,
  pj.journalist_name,
  0 AS total_pitches,
  0 AS total_opens,
  0 AS total_replies,
  NULL::timestamptz AS last_engagement_at
FROM press_journalists pj;

CREATE OR REPLACE VIEW v_journalists_engagement AS
SELECT
  pj.id AS journalist_id,
  pj.journalist_name,
  0 AS pitch_bounces,
  0 AS deliveries,
  NULL::timestamptz AS last_engagement_at
FROM press_journalists pj;

CREATE OR REPLACE VIEW v_journalists_status AS
SELECT
  coj.campaign_id,
  coj.outlet_id,
  coj.journalist_id,
  pj.journalist_name,
  'open' AS status,
  coj.relevance_score::text AS relevance_score
FROM campaign_outlet_journalists coj
JOIN press_journalists pj ON pj.id = coj.journalist_id;
