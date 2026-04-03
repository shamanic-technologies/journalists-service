import { sql as pgClient } from "../db/index.js";
import { checkEmailStatuses } from "./email-gateway-client.js";
import type { ServiceContext } from "./service-context.js";

// Outlet dedup: don't serve a second journalist from the same outlet
// if a previous one was contacted for the same brand+org within these windows.
const OUTLET_NO_REPLY_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — wait for reply before trying another journalist
const OUTLET_BLOCK_WINDOW_MS = 12 * 30 * 24 * 60 * 60 * 1000; // ~12 months — block expires after this

export type OutletDedupResult =
  | { blocked: false }
  | { blocked: true; reason: string };

/**
 * Check whether this outlet is blocked for the given brand+org.
 *
 * Looks up previously contacted journalists from this outlet (cross-campaign)
 * in our own DB, then checks email-gateway for delivery/reply status.
 *
 * Rules:
 * 1. If a journalist from this outlet was contacted < 12 months ago:
 *    - Negative reply → blocked (outlet is "burned")
 *    - Positive reply → blocked (already in conversation)
 *    - No reply and contacted < 30 days → blocked (still waiting)
 *    - No reply and contacted >= 30 days → allowed (can try another journalist)
 * 2. If all contacts are >= 12 months old → allowed (even negative replies expire)
 */
export async function checkOutletDedup(
  outletId: string,
  brandId: string,
  ctx: ServiceContext
): Promise<OutletDedupResult> {
  // Find all journalists at this outlet that were contacted for this brand (cross-campaign)
  const contactedRows = await pgClient`
    SELECT DISTINCT cj.email, cj.journalist_id
    FROM campaign_journalists cj
    WHERE cj.outlet_id = ${outletId}
      AND ${brandId} = ANY(cj.brand_ids)
      AND cj.status IN ('contacted', 'served')
      AND cj.email IS NOT NULL
  `;

  if (contactedRows.length === 0) {
    return { blocked: false };
  }

  // Check email-gateway for delivery/reply status
  const items = contactedRows.map((row) => ({
    leadId: row.journalist_id as string,
    email: row.email as string,
  }));

  const results = await checkEmailStatuses(items, undefined, ctx);

  const now = Date.now();

  for (const result of results) {
    // Check both broadcast and transactional at brand scope
    const brandStatus =
      result.broadcast?.brand ?? result.transactional?.brand;

    if (!brandStatus) continue;

    const { lead } = brandStatus;
    if (!lead.contacted) continue;

    const deliveredAt = lead.lastDeliveredAt
      ? new Date(lead.lastDeliveredAt).getTime()
      : 0;
    const age = now - deliveredAt;

    // Contact older than 12 months — expired, skip it
    if (age >= OUTLET_BLOCK_WINDOW_MS) continue;

    // Within 12-month window
    if (lead.replyClassification === "negative") {
      return {
        blocked: true,
        reason: `outlet blocked: journalist replied negatively ${Math.round(age / (24 * 60 * 60 * 1000))}d ago (12-month cooldown)`,
      };
    }

    if (lead.replyClassification === "positive") {
      return {
        blocked: true,
        reason: `outlet blocked: journalist replied positively — already in conversation`,
      };
    }

    // No decisive reply (neutral or null) — check 30-day cooldown
    if (!lead.replied && age < OUTLET_NO_REPLY_COOLDOWN_MS) {
      return {
        blocked: true,
        reason: `outlet blocked: journalist contacted ${Math.round(age / (24 * 60 * 60 * 1000))}d ago, waiting for reply (30-day cooldown)`,
      };
    }

    // No reply after 30+ days — this contact doesn't block, check others
  }

  return { blocked: false };
}
