import { type OrgContext, buildServiceHeaders } from "./service-context.js";

const EMAIL_GATEWAY_SERVICE_URL = process.env.EMAIL_GATEWAY_SERVICE_URL;
const EMAIL_GATEWAY_SERVICE_API_KEY = process.env.EMAIL_GATEWAY_SERVICE_API_KEY;

function getConfig() {
  if (!EMAIL_GATEWAY_SERVICE_URL) throw new Error("EMAIL_GATEWAY_SERVICE_URL is not set");
  if (!EMAIL_GATEWAY_SERVICE_API_KEY) throw new Error("EMAIL_GATEWAY_SERVICE_API_KEY is not set");
  return { url: EMAIL_GATEWAY_SERVICE_URL, apiKey: EMAIL_GATEWAY_SERVICE_API_KEY };
}

export interface EmailScopeStatus {
  contacted: boolean;
  delivered: boolean;
  opened: boolean;
  replied: boolean;
  replyClassification: "positive" | "negative" | "neutral" | null;
  bounced: boolean;
  unsubscribed: boolean;
  lastDeliveredAt: string | null;
}

export interface EmailGatewayBroadcastScope {
  campaign: EmailScopeStatus | null;
  brand: EmailScopeStatus | null;
  byCampaign: Record<string, EmailScopeStatus> | null;
  global: { email: { bounced: boolean; unsubscribed: boolean } };
}

export interface EmailGatewayTransactionalScope {
  campaign: EmailScopeStatus | null;
  brand: EmailScopeStatus | null;
  byCampaign: Record<string, EmailScopeStatus> | null;
  global: { email: { bounced: boolean; unsubscribed: boolean } };
}

export interface EmailGatewayStatusResult {
  email: string;
  broadcast: EmailGatewayBroadcastScope;
  transactional: EmailGatewayTransactionalScope;
}

/**
 * Batch check email delivery status via email-gateway POST /orgs/status.
 * Scoping is determined by body fields (brandId/campaignId), not headers.
 * At least one of brandId or campaignId is required by email-gateway.
 */
export async function checkEmailStatuses(
  items: Array<{ email: string }>,
  scopeFilters: { brandId?: string; campaignId?: string },
  ctx: OrgContext
): Promise<EmailGatewayStatusResult[]> {
  const { url, apiKey } = getConfig();
  const headers = buildServiceHeaders(apiKey, ctx);

  const body: Record<string, unknown> = { items };
  if (scopeFilters.campaignId) body.campaignId = scopeFilters.campaignId;
  if (scopeFilters.brandId) body.brandId = scopeFilters.brandId;

  const response = await fetch(`${url}/orgs/status`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `[journalists-service] email-gateway POST /orgs/status failed (${response.status}): ${text}`
    );
  }

  const data = (await response.json()) as { results: EmailGatewayStatusResult[] };
  return data.results;
}

// ── Aggregated stats from email-gateway GET /stats ──────────────────

export interface EmailGatewayBroadcastStats {
  emailsContacted: number;
  emailsSent: number;
  emailsDelivered: number;
  emailsOpened: number;
  emailsClicked: number;
  emailsReplied: number;
  emailsBounced: number;
  repliesInterested: number;
  repliesMeetingBooked: number;
  repliesClosed: number;
  repliesNeutral: number;
  repliesNotInterested: number;
  repliesOutOfOffice: number;
  repliesUnsubscribe: number;
  recipients: number;
}

export interface EmailGatewayStatsParams {
  campaignId?: string;
  brandId?: string;
  featureSlug?: string;
  featureSlugs?: string[];
  workflowSlug?: string;
  workflowSlugs?: string[];
  featureDynastySlug?: string;
  workflowDynastySlug?: string;
}

/**
 * Fetch aggregated broadcast stats from email-gateway GET /orgs/stats or /public/stats.
 * Fail-open: returns null if email-gateway is unreachable.
 */
export async function fetchEmailGatewayStats(
  params: EmailGatewayStatsParams,
  passthroughHeaders: Record<string, string>
): Promise<EmailGatewayBroadcastStats | null> {
  try {
    const { url, apiKey } = getConfig();
    const qs = new URLSearchParams();
    qs.set("type", "broadcast");
    if (params.campaignId) qs.set("campaignId", params.campaignId);
    if (params.brandId) qs.set("brandIds", params.brandId);
    if (params.featureSlugs && params.featureSlugs.length > 0) qs.set("featureSlugs", params.featureSlugs.join(","));
    else if (params.featureSlug) qs.set("featureSlugs", params.featureSlug);
    if (params.workflowSlugs && params.workflowSlugs.length > 0) qs.set("workflowSlugs", params.workflowSlugs.join(","));
    else if (params.workflowSlug) qs.set("workflowSlugs", params.workflowSlug);
    if (params.featureDynastySlug) qs.set("featureDynastySlug", params.featureDynastySlug);
    if (params.workflowDynastySlug) qs.set("workflowDynastySlug", params.workflowDynastySlug);

    const statsPath = passthroughHeaders["x-org-id"] ? "/orgs/stats" : "/public/stats";
    const res = await fetch(`${url}${statsPath}?${qs.toString()}`, {
      headers: { "x-api-key": apiKey, ...passthroughHeaders },
    });

    if (!res.ok) {
      console.warn(`[journalists-service] email-gateway GET ${statsPath} failed (${res.status})`);
      return null;
    }

    const data = (await res.json()) as { broadcast?: EmailGatewayBroadcastStats };
    return data.broadcast ?? null;
  } catch (err) {
    console.warn("[journalists-service] email-gateway unreachable for stats:", err);
    return null;
  }
}

export interface EmailGatewayStatsGroupedResponse {
  groups: Array<{
    key: string;
    broadcast?: EmailGatewayBroadcastStats;
  }>;
}

/**
 * Fetch aggregated broadcast stats from email-gateway GET /orgs/stats or /public/stats with groupBy.
 * Fail-open: returns null if email-gateway is unreachable.
 */
export async function fetchEmailGatewayStatsGrouped(
  params: EmailGatewayStatsParams,
  groupBy: string,
  passthroughHeaders: Record<string, string>
): Promise<EmailGatewayStatsGroupedResponse | null> {
  try {
    const { url, apiKey } = getConfig();
    const qs = new URLSearchParams();
    qs.set("type", "broadcast");
    if (params.campaignId) qs.set("campaignId", params.campaignId);
    if (params.brandId) qs.set("brandIds", params.brandId);
    if (params.featureSlugs && params.featureSlugs.length > 0) qs.set("featureSlugs", params.featureSlugs.join(","));
    else if (params.featureSlug) qs.set("featureSlugs", params.featureSlug);
    if (params.workflowSlugs && params.workflowSlugs.length > 0) qs.set("workflowSlugs", params.workflowSlugs.join(","));
    else if (params.workflowSlug) qs.set("workflowSlugs", params.workflowSlug);
    if (params.featureDynastySlug) qs.set("featureDynastySlug", params.featureDynastySlug);
    if (params.workflowDynastySlug) qs.set("workflowDynastySlug", params.workflowDynastySlug);
    qs.set("groupBy", groupBy);

    const statsPath = passthroughHeaders["x-org-id"] ? "/orgs/stats" : "/public/stats";
    const res = await fetch(`${url}${statsPath}?${qs.toString()}`, {
      headers: { "x-api-key": apiKey, ...passthroughHeaders },
    });

    if (!res.ok) {
      console.warn(`[journalists-service] email-gateway GET ${statsPath}?groupBy=${groupBy} failed (${res.status})`);
      return null;
    }

    return (await res.json()) as EmailGatewayStatsGroupedResponse;
  } catch (err) {
    console.warn("[journalists-service] email-gateway unreachable for grouped stats:", err);
    return null;
  }
}

// ── Status consolidation ────────────────────────────────────────────

export type OutreachStatusValue = "buffered" | "claimed" | "served" | "contacted" | "delivered" | "replied" | "bounced" | "skipped";

/**
 * Derive outreachStatus from the local DB status and email-gateway data.
 * Email-gateway status takes priority when available; local DB status is the fallback.
 */
export function deriveOutreachStatus(
  localStatus: string,
  emailGatewayResult: EmailGatewayStatusResult | null,
): OutreachStatusValue {
  if (emailGatewayResult) {
    const scope = emailGatewayResult.broadcast.campaign ?? emailGatewayResult.broadcast.brand;
    if (scope) {
      if (scope.replied) return "replied";
      if (scope.bounced) return "bounced";
      if (scope.delivered) return "delivered";
      if (scope.contacted) return "contacted";
    }
  }
  return localStatus as OutreachStatusValue;
}

/**
 * Derive outreachStatus from an email-gateway scope (campaign entry or brand scope).
 * Falls back to localStatus when the scope has no outreach data.
 */
export function deriveOutreachStatusFromScope(
  localStatus: string,
  scope: EmailScopeStatus | null,
): OutreachStatusValue {
  if (scope) {
    if (scope.replied) return "replied";
    if (scope.bounced) return "bounced";
    if (scope.delivered) return "delivered";
    if (scope.contacted) return "contacted";
  }
  return localStatus as OutreachStatusValue;
}
