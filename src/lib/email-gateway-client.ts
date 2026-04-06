import { type OrgContext, buildServiceHeaders } from "./service-context.js";

const EMAIL_GATEWAY_SERVICE_URL = process.env.EMAIL_GATEWAY_SERVICE_URL;
const EMAIL_GATEWAY_SERVICE_API_KEY = process.env.EMAIL_GATEWAY_SERVICE_API_KEY;

function getConfig() {
  if (!EMAIL_GATEWAY_SERVICE_URL) throw new Error("EMAIL_GATEWAY_SERVICE_URL is not set");
  if (!EMAIL_GATEWAY_SERVICE_API_KEY) throw new Error("EMAIL_GATEWAY_SERVICE_API_KEY is not set");
  return { url: EMAIL_GATEWAY_SERVICE_URL, apiKey: EMAIL_GATEWAY_SERVICE_API_KEY };
}

interface EmailStatusScope {
  contacted: boolean;
  delivered: boolean;
  replied: boolean;
  replyClassification: "positive" | "negative" | "neutral" | null;
  lastDeliveredAt: string | null;
}

interface EmailAddressScope {
  contacted: boolean;
  delivered: boolean;
  bounced: boolean;
  unsubscribed: boolean;
  lastDeliveredAt: string | null;
}

export interface EmailGatewayStatusResult {
  leadId: string;
  email: string;
  broadcast: {
    campaign: { lead: EmailStatusScope; email: EmailAddressScope } | null;
    brand: { lead: EmailStatusScope; email: EmailAddressScope } | null;
    global: { email: { bounced: boolean; unsubscribed: boolean } };
  };
  transactional: {
    campaign: { lead: EmailStatusScope; email: EmailAddressScope } | null;
    brand: { lead: EmailStatusScope; email: EmailAddressScope } | null;
    global: { email: { bounced: boolean; unsubscribed: boolean } };
  };
}

/**
 * Batch check email delivery status via email-gateway POST /status.
 * Brand scope comes from x-brand-id header (set by buildServiceHeaders).
 */
export async function checkEmailStatuses(
  items: Array<{ leadId: string; email: string }>,
  campaignId: string | undefined,
  ctx: OrgContext
): Promise<EmailGatewayStatusResult[]> {
  const { url, apiKey } = getConfig();
  const headers = buildServiceHeaders(apiKey, ctx);

  const body: Record<string, unknown> = { items };
  if (campaignId) body.campaignId = campaignId;

  const response = await fetch(`${url}/status`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `[journalists-service] email-gateway POST /status failed (${response.status}): ${text}`
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
  repliesWillingToMeet: number;
  repliesInterested: number;
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
 * Fetch aggregated broadcast stats from email-gateway GET /stats?type=broadcast.
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

    const res = await fetch(`${url}/stats?${qs.toString()}`, {
      headers: { "x-api-key": apiKey, ...passthroughHeaders },
    });

    if (!res.ok) {
      console.warn(`[journalists-service] email-gateway GET /stats failed (${res.status})`);
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
 * Fetch aggregated broadcast stats from email-gateway GET /stats with groupBy.
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

    const res = await fetch(`${url}/stats?${qs.toString()}`, {
      headers: { "x-api-key": apiKey, ...passthroughHeaders },
    });

    if (!res.ok) {
      console.warn(`[journalists-service] email-gateway GET /stats?groupBy=${groupBy} failed (${res.status})`);
      return null;
    }

    return (await res.json()) as EmailGatewayStatsGroupedResponse;
  } catch (err) {
    console.warn("[journalists-service] email-gateway unreachable for grouped stats:", err);
    return null;
  }
}

// ── Status consolidation ────────────────────────────────────────────

export type ConsolidatedStatusValue = "buffered" | "claimed" | "served" | "contacted" | "delivered" | "replied" | "bounced" | "skipped";

/**
 * Derive a single consolidated status from the local DB status and email-gateway data.
 * Email-gateway status takes priority over local "served" status.
 */
export function consolidateStatus(
  localStatus: string,
  emailGatewayResult: EmailGatewayStatusResult | null,
): { consolidatedStatus: ConsolidatedStatusValue; localStatus: string; emailGatewayStatus: ConsolidatedStatusValue | null } {
  let emailGatewayStatus: ConsolidatedStatusValue | null = null;

  if (emailGatewayResult) {
    const campaign = emailGatewayResult.broadcast.campaign;
    if (campaign) {
      if (campaign.lead.replied) emailGatewayStatus = "replied";
      else if (campaign.email.bounced) emailGatewayStatus = "bounced";
      else if (campaign.lead.delivered) emailGatewayStatus = "delivered";
      else if (campaign.lead.contacted) emailGatewayStatus = "contacted";
    }
  }

  // Consolidated: use email-gateway status when available and local is "served",
  // otherwise keep local status
  const consolidatedStatus: ConsolidatedStatusValue =
    emailGatewayStatus && localStatus === "served"
      ? emailGatewayStatus
      : localStatus as ConsolidatedStatusValue;

  return { consolidatedStatus, localStatus, emailGatewayStatus };
}
