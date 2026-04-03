import { sql as pgClient } from "../db/index.js";
import { checkOutletDedup } from "./outlet-dedup.js";
import type { ServiceContext } from "./service-context.js";

// ── Shared constants ─────────────────────────────────────────────────
export const SERVED_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour — treat recently-served as "contacted" to close the race window
export const MIN_RELEVANCE_SCORE = 30; // Don't serve "distant" journalists (0-30 tier)

// ── Result type ──────────────────────────────────────────────────────
export type OutletBlockedResult =
  | { blocked: false }
  | { blocked: true; reason: string };

/**
 * Full outlet-blocked check combining all three layers:
 *
 * 1. Local dedup — journalist already claimed/served/contacted for this campaign+outlet
 * 2. Lead-service dedup — cross-campaign contact history (reply status, cooldowns)
 * 3. Relevance threshold — all buffered journalists are below MIN_RELEVANCE_SCORE
 *
 * Used by both `POST /buffer/next` and `GET /internal/outlets/blocked`.
 */
export async function checkOutletBlocked(
  outletId: string,
  campaignId: string | null,
  brandIds: string[],
  ctx: ServiceContext
): Promise<OutletBlockedResult> {
  // ── 1. Local dedup: recently served/claimed or confirmed contacted ──
  // Requires campaignId — skipped when not provided (caller doesn't have it)
  if (campaignId) {
    const servedCutoff = new Date(Date.now() - SERVED_COOLDOWN_MS).toISOString();
    const alreadyServed = await pgClient`
      SELECT id FROM campaign_journalists
      WHERE campaign_id = ${campaignId}
        AND outlet_id = ${outletId}
        AND (
          status = 'contacted'
          OR (status IN ('claimed', 'served') AND created_at >= ${servedCutoff}::timestamptz)
        )
      LIMIT 1
    `;
    if (alreadyServed.length > 0) {
      return {
        blocked: true,
        reason: "outlet already has a served journalist in this campaign",
      };
    }
  }

  // ── 2. Lead-service dedup: cross-campaign contact history per brand ──
  for (const brandId of brandIds) {
    const result = await checkOutletDedup(outletId, brandId, ctx);
    if (result.blocked) {
      return result;
    }
  }

  // ── 3. Relevance threshold: all buffered journalists below minimum ──
  // Requires campaignId — skipped when not provided
  if (campaignId) {
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
  }

  return { blocked: false };
}
