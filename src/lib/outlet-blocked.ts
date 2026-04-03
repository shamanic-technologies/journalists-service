import { sql as pgClient } from "../db/index.js";

// ── Shared constants ─────────────────────────────────────────────────
export const SERVED_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour — treat recently-served as "contacted" to close the race window
export const MIN_RELEVANCE_SCORE = 30; // Don't serve "distant" journalists (0-30 tier)

// ── Result type ──────────────────────────────────────────────────────
export type OutletBlockedResult =
  | { blocked: false }
  | { blocked: true; reason: string };

/**
 * Check whether this outlet's buffer has any viable journalists.
 *
 * Only checks relevance threshold — outlet-level dedup (cross-campaign)
 * is handled by outlets-service, not here.
 */
export async function checkOutletBlocked(
  outletId: string,
  campaignId: string
): Promise<OutletBlockedResult> {
  // All buffered journalists below minimum relevance → blocked
  const bufferCheck = await pgClient`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE relevance_score < ${MIN_RELEVANCE_SCORE})::int AS below
    FROM campaign_journalists
    WHERE campaign_id = ${campaignId}
      AND outlet_id = ${outletId}
      AND status = 'buffered'
  `;
  const { total, below } = bufferCheck[0];
  if (total > 0 && total === below) {
    return {
      blocked: true,
      reason: `all journalists below relevance threshold (${MIN_RELEVANCE_SCORE})`,
    };
  }

  return { blocked: false };
}
