const LEAD_SERVICE_URL = process.env.LEAD_SERVICE_URL;
const LEAD_SERVICE_API_KEY = process.env.LEAD_SERVICE_API_KEY;

function getConfig() {
  if (!LEAD_SERVICE_URL) throw new Error("LEAD_SERVICE_URL is not set");
  if (!LEAD_SERVICE_API_KEY) throw new Error("LEAD_SERVICE_API_KEY is not set");
  return { url: LEAD_SERVICE_URL, apiKey: LEAD_SERVICE_API_KEY };
}

export interface LeadStatsParams {
  campaignId?: string;
  brandId?: string;
  orgId?: string;
  featureSlug?: string;
  featureSlugs?: string[];
  workflowSlug?: string;
}

export interface LeadStatsResponse {
  served: number;
  contacted: number;
  buffered: number;
  skipped: number;
}

export interface LeadStatsGroupedResponse {
  groups: Array<{
    key: string;
    served: number;
    contacted: number;
    buffered: number;
    skipped: number;
  }>;
}

/**
 * Fetch contacted count from lead-service GET /stats.
 * Fail-open: returns null if lead-service is unreachable.
 */
export async function fetchLeadStats(
  params: LeadStatsParams,
  passthroughHeaders: Record<string, string>
): Promise<LeadStatsResponse | null> {
  try {
    const { url, apiKey } = getConfig();
    const qs = new URLSearchParams();
    if (params.campaignId) qs.set("campaignId", params.campaignId);
    if (params.brandId) qs.set("brandId", params.brandId);
    if (params.orgId) qs.set("orgId", params.orgId);
    if (params.featureSlug) qs.set("featureSlug", params.featureSlug);
    if (params.featureSlugs && params.featureSlugs.length > 0) qs.set("featureSlugs", params.featureSlugs.join(","));
    if (params.workflowSlug) qs.set("workflowSlug", params.workflowSlug);

    const res = await fetch(`${url}/stats?${qs.toString()}`, {
      headers: { "x-api-key": apiKey, ...passthroughHeaders },
    });

    if (!res.ok) {
      console.warn(`[journalists-service] lead-service GET /stats failed (${res.status})`);
      return null;
    }

    return (await res.json()) as LeadStatsResponse;
  } catch (err) {
    console.warn("[journalists-service] lead-service unreachable for contacted stats:", err);
    return null;
  }
}

/**
 * Fetch contacted count from lead-service GET /stats with groupBy.
 * Fail-open: returns null if lead-service is unreachable.
 */
// ── Outlet dedup: lead statuses scoped by brand + outlet ──────────────

export interface LeadStatus {
  leadId: string;
  email: string;
  journalistId: string | null;
  outletId: string | null;
  contacted: boolean;
  delivered: boolean;
  bounced: boolean;
  replied: boolean;
  replyClassification: "positive" | "negative" | "neutral" | null;
  lastDeliveredAt: string | null;
}

/**
 * Fetch per-lead delivery statuses from lead-service GET /leads/status.
 * Used for outlet-level dedup: checks if any journalist from this outlet
 * was already contacted for the given brand+org (cross-campaign).
 *
 * Requires x-org-id in passthroughHeaders (scopes by org automatically).
 */
export async function fetchLeadStatuses(
  params: { brandId: string; outletId: string },
  passthroughHeaders: Record<string, string>
): Promise<LeadStatus[]> {
  const { url, apiKey } = getConfig();
  const qs = new URLSearchParams();
  qs.set("brandId", params.brandId);
  qs.set("outletId", params.outletId);

  const res = await fetch(`${url}/leads/status?${qs.toString()}`, {
    headers: { "x-api-key": apiKey, ...passthroughHeaders },
  });

  if (!res.ok) {
    throw new Error(
      `[journalists-service] lead-service GET /leads/status failed (${res.status})`
    );
  }

  const body = (await res.json()) as { statuses: LeadStatus[] };
  return body.statuses;
}

export async function fetchLeadStatsGrouped(
  params: LeadStatsParams,
  groupBy: string,
  passthroughHeaders: Record<string, string>
): Promise<LeadStatsGroupedResponse | null> {
  try {
    const { url, apiKey } = getConfig();
    const qs = new URLSearchParams();
    if (params.campaignId) qs.set("campaignId", params.campaignId);
    if (params.brandId) qs.set("brandId", params.brandId);
    if (params.orgId) qs.set("orgId", params.orgId);
    if (params.featureSlug) qs.set("featureSlug", params.featureSlug);
    if (params.featureSlugs && params.featureSlugs.length > 0) qs.set("featureSlugs", params.featureSlugs.join(","));
    if (params.workflowSlug) qs.set("workflowSlug", params.workflowSlug);
    qs.set("groupBy", groupBy);

    const res = await fetch(`${url}/stats?${qs.toString()}`, {
      headers: { "x-api-key": apiKey, ...passthroughHeaders },
    });

    if (!res.ok) {
      console.warn(`[journalists-service] lead-service GET /stats?groupBy=${groupBy} failed (${res.status})`);
      return null;
    }

    return (await res.json()) as LeadStatsGroupedResponse;
  } catch (err) {
    console.warn("[journalists-service] lead-service unreachable for grouped contacted stats:", err);
    return null;
  }
}
