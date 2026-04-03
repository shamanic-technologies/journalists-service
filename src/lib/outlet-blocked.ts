import { sql as pgClient } from "../db/index.js";

// ── Shared constants ─────────────────────────────────────────────────
export const SERVED_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour — treat recently-served as "contacted" to close the race window
export const MIN_RELEVANCE_SCORE = 30; // Don't serve "distant" journalists (0-30 tier)
export const APOLLO_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — journalist with no email within this window is non-viable

// ── Result type ──────────────────────────────────────────────────────
export type OutletBlockedResult =
  | { blocked: false }
  | { blocked: true; reason: string };

/**
 * Check whether this outlet has any viable journalists left.
 *
 * A journalist is "viable" if:
 * 1. status = 'buffered'
 * 2. relevance_score >= 30
 * 3. NOT already contacted for this brand+org (by journalist_id)
 * 4. NOT already checked by Apollo within 30 days with no email found
 *
 * "contacted" = status='contacted' OR (status IN ('claimed','served') AND < 1h ago).
 *
 * Note: email and apollo_person_id dedup cannot be checked here because
 * we don't know the journalist's email until Apollo resolves it.
 * Those checks happen later in buffer-next's resolveAndCheckEmail.
 */
export async function checkOutletBlocked(
  outletId: string,
  campaignId: string,
  orgId: string,
  brandIds: string[]
): Promise<OutletBlockedResult> {
  const servedCutoff = new Date(Date.now() - SERVED_COOLDOWN_MS).toISOString();
  const apolloCutoff = new Date(Date.now() - APOLLO_CACHE_MAX_AGE_MS).toISOString();

  // Single query: is there at least one buffered journalist with sufficient
  // relevance who hasn't already been contacted for this brand+org
  // and hasn't already been checked by Apollo with no email?
  const viable = await pgClient`
    SELECT 1 FROM campaign_journalists cj
    JOIN journalists j ON j.id = cj.journalist_id
    WHERE cj.campaign_id = ${campaignId}
      AND cj.outlet_id = ${outletId}
      AND cj.status = 'buffered'
      AND cj.relevance_score >= ${MIN_RELEVANCE_SCORE}
      AND (
        j.apollo_checked_at IS NULL
        OR j.apollo_checked_at < ${apolloCutoff}::timestamptz
        OR j.apollo_email IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM campaign_journalists other
        WHERE other.journalist_id = cj.journalist_id
          AND other.id != cj.id
          AND other.org_id = ${orgId}
          AND other.brand_ids && ${brandIds}::uuid[]
          AND (
            other.status = 'contacted'
            OR (other.status IN ('claimed', 'served')
                AND other.created_at >= ${servedCutoff}::timestamptz)
          )
      )
    LIMIT 1
  `;

  if (viable.length > 0) {
    return { blocked: false };
  }

  // No viable journalist found — determine if truly blocked or just empty
  const bufferCheck = await pgClient`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE cj.relevance_score < ${MIN_RELEVANCE_SCORE})::int AS below_relevance,
      COUNT(*) FILTER (
        WHERE cj.relevance_score >= ${MIN_RELEVANCE_SCORE}
          AND j.apollo_checked_at IS NOT NULL
          AND j.apollo_checked_at >= ${apolloCutoff}::timestamptz
          AND j.apollo_email IS NULL
      )::int AS no_email
    FROM campaign_journalists cj
    JOIN journalists j ON j.id = cj.journalist_id
    WHERE cj.campaign_id = ${campaignId}
      AND cj.outlet_id = ${outletId}
      AND cj.status = 'buffered'
  `;

  const { total, below_relevance, no_email } = bufferCheck[0];

  // Empty buffer = not blocked (caller may need to discover/refill)
  if (total === 0) {
    return { blocked: false };
  }

  if (total === below_relevance) {
    return {
      blocked: true,
      reason: `all journalists below relevance threshold (${MIN_RELEVANCE_SCORE})`,
    };
  }

  if (no_email > 0 && below_relevance + no_email === total) {
    return {
      blocked: true,
      reason: "all viable journalists have no email (Apollo checked within 30 days)",
    };
  }

  return {
    blocked: true,
    reason: "all viable journalists already contacted for this brand+org",
  };
}
