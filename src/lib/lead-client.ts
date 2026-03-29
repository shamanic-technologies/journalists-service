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
  workflowSlug?: string;
  featureDynastySlug?: string;
  workflowDynastySlug?: string;
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
    if (params.workflowSlug) qs.set("workflowSlug", params.workflowSlug);
    if (params.featureDynastySlug) qs.set("featureDynastySlug", params.featureDynastySlug);
    if (params.workflowDynastySlug) qs.set("workflowDynastySlug", params.workflowDynastySlug);

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
    if (params.workflowSlug) qs.set("workflowSlug", params.workflowSlug);
    if (params.featureDynastySlug) qs.set("featureDynastySlug", params.featureDynastySlug);
    if (params.workflowDynastySlug) qs.set("workflowDynastySlug", params.workflowDynastySlug);
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
