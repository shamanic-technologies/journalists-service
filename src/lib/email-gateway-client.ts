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
  sent: boolean;
  delivered: boolean;
  opened: boolean;
  clicked: boolean;
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

export interface EmailGatewayRepliesDetail {
  interested: number;
  meetingBooked: number;
  closed: number;
  notInterested: number;
  wrongPerson: number;
  unsubscribe: number;
  neutral: number;
  autoReply: number;
  outOfOffice: number;
}

export interface EmailGatewayRecipientStats {
  contacted: number;
  sent: number;
  delivered: number;
  opened: number;
  bounced: number;
  clicked: number;
  unsubscribed: number;
  repliesPositive: number;
  repliesNegative: number;
  repliesNeutral: number;
  repliesAutoReply: number;
  repliesDetail: EmailGatewayRepliesDetail;
}

export interface EmailGatewayEmailStats {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
}

export interface EmailGatewayBroadcastStats {
  recipientStats: EmailGatewayRecipientStats;
  emailStats: EmailGatewayEmailStats;
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

// ── Status helpers ──────────────────────────────────────────────────

/**
 * Build cumulative boolean status from DB status + email-gateway scope.
 * DB statuses are cumulative: if a journalist is "served", they are also "claimed" and "buffered".
 * Email-gateway booleans are passed through as-is (they are already cumulative).
 */
const DB_STATUS_CHAIN = ["buffered", "claimed", "served", "contacted"] as const;

export interface StatusBooleans {
  buffered: boolean;
  claimed: boolean;
  served: boolean;
  skipped: boolean;
  contacted: boolean;
  sent: boolean;
  delivered: boolean;
  opened: boolean;
  clicked: boolean;
  replied: boolean;
  replyClassification: "positive" | "negative" | "neutral" | null;
  bounced: boolean;
  unsubscribed: boolean;
  lastDeliveredAt: string | null;
}

export function buildStatusBooleans(
  dbStatus: string,
  scope: EmailScopeStatus | null,
): StatusBooleans {
  const isSkipped = dbStatus === "skipped";
  const dbIndex = DB_STATUS_CHAIN.indexOf(dbStatus as typeof DB_STATUS_CHAIN[number]);

  return {
    buffered: true,
    claimed: isSkipped || dbIndex >= 1,
    served: !isSkipped && dbIndex >= 2,
    skipped: isSkipped,
    contacted: scope?.contacted ?? false,
    sent: scope?.sent ?? false,
    delivered: scope?.delivered ?? false,
    opened: scope?.opened ?? false,
    clicked: scope?.clicked ?? false,
    replied: scope?.replied ?? false,
    replyClassification: scope?.replyClassification ?? null,
    bounced: scope?.bounced ?? false,
    unsubscribed: scope?.unsubscribed ?? false,
    lastDeliveredAt: scope?.lastDeliveredAt ?? null,
  };
}

/**
 * Accumulate status booleans into counts. Used for per-outlet and response-level aggregation.
 */
export interface StatusCounts {
  buffered: number;
  claimed: number;
  served: number;
  skipped: number;
  contacted: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  repliesPositive: number;
  repliesNegative: number;
  repliesNeutral: number;
  bounced: number;
  unsubscribed: number;
}

export function emptyStatusCounts(): StatusCounts {
  return {
    buffered: 0, claimed: 0, served: 0, skipped: 0,
    contacted: 0, sent: 0, delivered: 0, opened: 0, clicked: 0,
    replied: 0, repliesPositive: 0, repliesNegative: 0, repliesNeutral: 0,
    bounced: 0, unsubscribed: 0,
  };
}

export function accumulateStatus(counts: StatusCounts, status: StatusBooleans): void {
  if (status.buffered) counts.buffered++;
  if (status.claimed) counts.claimed++;
  if (status.served) counts.served++;
  if (status.skipped) counts.skipped++;
  if (status.contacted) counts.contacted++;
  if (status.sent) counts.sent++;
  if (status.delivered) counts.delivered++;
  if (status.opened) counts.opened++;
  if (status.clicked) counts.clicked++;
  if (status.replied) counts.replied++;
  if (status.bounced) counts.bounced++;
  if (status.unsubscribed) counts.unsubscribed++;
  if (status.replyClassification === "positive") counts.repliesPositive++;
  if (status.replyClassification === "negative") counts.repliesNegative++;
  if (status.replyClassification === "neutral") counts.repliesNeutral++;
}

/**
 * Convert exclusive DB status counts (from GROUP BY) into cumulative counts.
 * The chain is: buffered → claimed → served → contacted (skipped branches off claimed).
 */
export function makeCumulativeDbCounts(exclusive: Record<string, number>): Record<string, number> {
  const b = exclusive["buffered"] ?? 0;
  const c = exclusive["claimed"] ?? 0;
  const sv = exclusive["served"] ?? 0;
  const sk = exclusive["skipped"] ?? 0;
  const ct = exclusive["contacted"] ?? 0;

  return {
    buffered: b + c + sv + sk + ct,
    claimed: c + sv + sk + ct,
    served: sv + ct,
    skipped: sk,
  };
}
