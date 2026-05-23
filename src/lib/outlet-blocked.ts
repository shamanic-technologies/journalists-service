import { sql as pgClient } from "../db/index.js";
import { checkEmailStatuses } from "./email-gateway-client.js";
import type { OrgContext } from "./service-context.js";

// ── Shared constants ─────────────────────────────────────────────────
export const SERVED_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour — treat recently-served as "contacted" to close the race window

// Two distinct relevance grandeurs — do not confuse:
//
// 1. MIN_RELEVANCE_SCORE (LLM qualification cutoff) — documents the LLM-side
//    tier boundary used by the scoring prompt in journalist-discovery.ts:
//    "70-100 Direct fit, 30-70 Adjacent, 0-30 Distant". Anything below 30 is
//    a "Distant" journalist according to the LLM. This is a documentation /
//    reporting constant, NOT an acceptance gate.
//
// 2. MIN_ACCEPTANCE_SCORE (acceptance gate) — the runtime threshold used to
//    decide whether a buffered journalist can be claimed and emailed. We
//    intentionally accept some "Distant"-tier journalists (score >= 20)
//    because the LLM under-scores niche brands; the gate sits BELOW the LLM
//    tier boundary on purpose.
export const MIN_RELEVANCE_SCORE = 30; // LLM tier cutoff (Adjacent vs Distant) — documents the prompt buckets
export const MIN_ACCEPTANCE_SCORE = 20; // Runtime acceptance gate — buffered journalists below this are skipped

export const APOLLO_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — journalist with no email within this window is non-viable
export const CONTACTED_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — outlet blocked if someone contacted within this window
export const JOURNALIST_RECONTACT_COOLDOWN_MS = 3 * 30 * 24 * 60 * 60 * 1000; // ~3 months — same journalist can be contacted again for same brand after this window
export const REPLY_COOLDOWN_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months — outlet blocked if someone replied within this window

// ── Result type ──────────────────────────────────────────────────────
export type OutletBlockedResult =
  | { blocked: false }
  | { blocked: true; reason: string };

/**
 * Check whether this outlet is blocked for the given brand+org.
 *
 * Two independent conditions — if EITHER is true, the outlet is blocked:
 *
 * Condition A — Someone already reached at this outlet for this brand:
 *   - status 'claimed'/'served' AND created_at < 1h ago (race window)
 *   - OR contacted via email-gateway (broadcast.brand.contacted) within 14 days
 *   - OR replied (positive or negative) via email-gateway within 6 months
 *
 * Condition B — Discovery done but no viable journalists:
 *   - All buffered journalists are below the acceptance gate (MIN_ACCEPTANCE_SCORE)
 *   - OR all have no email (Apollo checked within 30 days)
 *   - OR all already contacted for this brand+org
 */
export async function checkOutletBlocked(
  outletId: string,
  campaignId: string,
  orgId: string,
  brandIds: string[],
  ctx: OrgContext,
): Promise<OutletBlockedResult> {
  const servedCutoff = new Date(Date.now() - SERVED_COOLDOWN_MS).toISOString();
  const apolloCutoff = new Date(Date.now() - APOLLO_CACHE_MAX_AGE_MS).toISOString();

  // ── Condition A: Has someone already been reached at this outlet for this brand? ──

  // A.1 Race window: claimed/served < 1h (before email-gateway knows)
  const recentLocal = await pgClient`
    SELECT 1 FROM campaign_journalists
    WHERE outlet_id = ${outletId}
      AND org_id = ${orgId}
      AND brand_ids && ${brandIds}::uuid[]
      AND status IN ('claimed', 'served')
      AND created_at >= ${servedCutoff}::timestamptz
    LIMIT 1
  `;
  if (recentLocal.length > 0) {
    return { blocked: true, reason: "journalist recently served at this outlet (race window)" };
  }

  // A.2 Email-gateway: contacted < 14d or replied < 6mo
  const servedOrContacted = await pgClient`
    SELECT DISTINCT ON (COALESCE(j.apollo_email, cj.email))
      cj.journalist_id,
      COALESCE(j.apollo_email, cj.email) AS email
    FROM campaign_journalists cj
    JOIN journalists j ON j.id = cj.journalist_id
    WHERE cj.outlet_id = ${outletId}
      AND cj.org_id = ${orgId}
      AND cj.brand_ids && ${brandIds}::uuid[]
      AND cj.status IN ('served', 'contacted')
      AND COALESCE(j.apollo_email, cj.email) IS NOT NULL
  `;

  if (servedOrContacted.length > 0) {
    const emailsToCheck = servedOrContacted.map((row) => ({
      email: row.email as string,
    }));

    const contactedCutoff = new Date(Date.now() - CONTACTED_COOLDOWN_MS);
    const replyCutoff = new Date(Date.now() - REPLY_COOLDOWN_MS);

    for (const brandId of brandIds) {
      const gatewayResults = await checkEmailStatuses(emailsToCheck, { brandId }, ctx);

      for (const result of gatewayResults) {
        const brandScope = result.broadcast?.brand;
        if (!brandScope) continue;

        // Contacted within 14 days?
        if (brandScope.contacted && brandScope.lastDeliveredAt) {
          const deliveredAt = new Date(brandScope.lastDeliveredAt);
          if (deliveredAt >= contactedCutoff) {
            return {
              blocked: true,
              reason: `journalist already contacted at this outlet for brand ${brandId} within 14 days`,
            };
          }
        }

        // Replied (positive or negative) within 6 months?
        if (brandScope.replied && brandScope.replyClassification && brandScope.lastDeliveredAt) {
          const deliveredAt = new Date(brandScope.lastDeliveredAt);
          if (deliveredAt >= replyCutoff) {
            return {
              blocked: true,
              reason: `journalist replied (${brandScope.replyClassification}) at this outlet for brand ${brandId} within 6 months`,
            };
          }
        }
      }
    }
  }

  // ── Condition B: No viable journalists in the buffer? ──

  // Is there at least one buffered journalist with sufficient relevance
  // who hasn't already been contacted for this brand+org
  // and hasn't already been checked by Apollo with no email?
  const viable = await pgClient`
    SELECT 1 FROM campaign_journalists cj
    JOIN journalists j ON j.id = cj.journalist_id
    WHERE cj.campaign_id = ${campaignId}
      AND cj.outlet_id = ${outletId}
      AND cj.status = 'buffered'
      AND cj.relevance_score >= ${MIN_ACCEPTANCE_SCORE}
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
      COUNT(*) FILTER (WHERE cj.relevance_score < ${MIN_ACCEPTANCE_SCORE})::int AS below_relevance,
      COUNT(*) FILTER (
        WHERE cj.relevance_score >= ${MIN_ACCEPTANCE_SCORE}
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
      reason: `all journalists below relevance threshold (${MIN_ACCEPTANCE_SCORE})`,
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
