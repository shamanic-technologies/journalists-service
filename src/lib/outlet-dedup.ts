import { fetchLeadStatuses } from "./lead-client.js";
import { buildServiceHeaders } from "./service-context.js";
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
  const headers = buildServiceHeaders(ctx, "");
  // Remove empty x-api-key — lead-service uses its own key via fetchLeadStatuses
  delete headers["x-api-key"];

  const statuses = await fetchLeadStatuses(
    { brandId, outletId },
    headers
  );

  if (statuses.length === 0) {
    return { blocked: false };
  }

  const now = Date.now();

  for (const status of statuses) {
    if (!status.contacted) continue;

    const deliveredAt = status.lastDeliveredAt
      ? new Date(status.lastDeliveredAt).getTime()
      : 0;
    const age = now - deliveredAt;

    // Contact older than 12 months — expired, skip it
    if (age >= OUTLET_BLOCK_WINDOW_MS) continue;

    // Within 12-month window
    if (status.replyClassification === "negative") {
      return {
        blocked: true,
        reason: `outlet blocked: journalist replied negatively ${Math.round(age / (24 * 60 * 60 * 1000))}d ago (12-month cooldown)`,
      };
    }

    if (status.replyClassification === "positive") {
      return {
        blocked: true,
        reason: `outlet blocked: journalist replied positively — already in conversation`,
      };
    }

    // No decisive reply (neutral or null) — check 30-day cooldown
    if (!status.replied && age < OUTLET_NO_REPLY_COOLDOWN_MS) {
      return {
        blocked: true,
        reason: `outlet blocked: journalist contacted ${Math.round(age / (24 * 60 * 60 * 1000))}d ago, waiting for reply (30-day cooldown)`,
      };
    }

    // No reply after 30+ days — this contact doesn't block, check others
  }

  return { blocked: false };
}
