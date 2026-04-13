import { z } from "zod";
import {
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ==================== Security ====================

const apiKeyAuth = registry.registerComponent("securitySchemes", "ApiKeyAuth", {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
});

// ==================== Shared Schemas ====================

export const ErrorResponseSchema = z
  .object({
    error: z.string(),
  })
  .openapi("ErrorResponse");

// ==================== Journalist Schema ====================

export const JournalistSchema = z
  .object({
    id: z.string().uuid(),
    outletId: z.string().uuid(),
    entityType: z.enum(["individual", "organization"]),
    journalistName: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Journalist");

// ==================== Buffer/Next Schemas ====================

export const BufferNextSchema = z
  .object({
    outletId: z.string().uuid().optional(),
    maxArticles: z.number().int().min(1).max(30).default(15),
    idempotencyKey: z.string().optional(),
  })
  .openapi("BufferNextRequest");

export const BufferNextJournalistSchema = z
  .object({
    id: z.string().uuid(),
    journalistName: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    entityType: z.enum(["individual", "organization"]),
    relevanceScore: z.number().min(0).max(100),
    whyRelevant: z.string(),
    whyNotRelevant: z.string(),
    articleUrls: z.array(z.string()),
    email: z.string().email().optional(),
    apolloPersonId: z.string().optional(),
    outletId: z.string().uuid().optional(),
    outletName: z.string().optional(),
    outletDomain: z.string().optional(),
  })
  .openapi("BufferNextJournalist");

export const BufferNextResponseSchema = z
  .object({
    found: z.boolean(),
    runId: z.string().uuid().optional(),
    journalist: BufferNextJournalistSchema.optional(),
  })
  .openapi("BufferNextResponse");

// ==================== Discover Schemas ====================

export const DiscoverRequestSchema = z
  .object({
    outletId: z.string().uuid(),
    maxArticles: z.number().int().min(1).max(30).default(15),
  })
  .openapi("DiscoverRequest");

export const DiscoverResponseSchema = z
  .object({
    runId: z.string().uuid(),
    discovered: z.number().int(),
  })
  .openapi("DiscoverResponse");

// ==================== Status Schemas ====================
//
// Statuses are cumulative: a journalist who is "served" is also "claimed" and "buffered".
// DB statuses (buffered, claimed, served, skipped) are merged with email-gateway statuses
// (contacted, sent, delivered, opened, clicked, replied, bounced, unsubscribed).

const StatusBooleansSchema = z.object({
  buffered: z.boolean(),
  claimed: z.boolean(),
  served: z.boolean(),
  skipped: z.boolean(),
  contacted: z.boolean(),
  sent: z.boolean(),
  delivered: z.boolean(),
  opened: z.boolean(),
  clicked: z.boolean(),
  replied: z.boolean(),
  replyClassification: z.enum(["positive", "negative", "neutral"]).nullable(),
  bounced: z.boolean(),
  unsubscribed: z.boolean(),
  lastDeliveredAt: z.string().nullable(),
}).openapi("StatusBooleans", {
  description: "Cumulative status booleans merging DB statuses and email-gateway data. Per-journalist granularity.",
});

const StatusCountsSchema = z.object({
  buffered: z.number(),
  claimed: z.number(),
  served: z.number(),
  skipped: z.number(),
  contacted: z.number(),
  sent: z.number(),
  delivered: z.number(),
  opened: z.number(),
  clicked: z.number(),
  replied: z.number(),
  repliesPositive: z.number(),
  repliesNegative: z.number(),
  repliesNeutral: z.number(),
  bounced: z.number(),
  unsubscribed: z.number(),
}).openapi("StatusCounts", {
  description: "Cumulative status counts merging DB statuses and email-gateway data. Used for per-outlet and response-level aggregation.",
});

const GlobalStatusSchema = z.object({
  bounced: z.boolean().openapi({ description: "Whether this email has bounced anywhere" }),
  unsubscribed: z.boolean().openapi({ description: "Whether this email has unsubscribed anywhere" }),
}).openapi("GlobalStatus");

const GlobalStatusCountsSchema = z.object({
  bounced: z.number(),
  unsubscribed: z.number(),
}).openapi("GlobalStatusCounts");

// ==================== Campaign Outlet Journalists Schemas ====================

export const CampaignOutletJournalistSchema = z
  .object({
    id: z.string().uuid(),
    journalistId: z.string().uuid(),
    campaignId: z.string().uuid(),
    outletId: z.string().uuid(),
    orgId: z.string().uuid(),
    brandIds: z.array(z.string().uuid()).openapi({
      description: "Brand UUIDs associated with this campaign journalist",
      example: ["550e8400-e29b-41d4-a716-446655440000"],
    }),
    featureSlug: z.string().nullable(),
    relevanceScore: z.string(),
    whyRelevant: z.string(),
    whyNotRelevant: z.string(),
    articleUrls: z.array(z.string()).nullable(),
    status: StatusBooleansSchema,
    runId: z.string().uuid().nullable(),
    createdAt: z.string(),
    journalistName: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    entityType: z.enum(["individual", "organization"]),
  })
  .openapi("CampaignOutletJournalist");

export const CampaignOutletJournalistsResponseSchema = z
  .object({
    campaignJournalists: z.array(CampaignOutletJournalistSchema),
  })
  .openapi("CampaignOutletJournalistsResponse");

// ==================== Stats Schemas ====================

export const StatsGroupByEnum = z
  .enum([
    "featureSlug",
    "workflowSlug",
    "featureDynastySlug",
    "workflowDynastySlug",
  ])
  .openapi("StatsGroupBy", {
    description: "Dimension to group results by. Dynasty variants aggregate all versioned slugs under the dynasty slug.",
  });

export const StatsQuerySchema = z
  .object({
    orgId: z.string().uuid().optional().openapi({ description: "Filter by organization ID" }),
    campaignId: z.string().uuid().optional().openapi({ description: "Filter by campaign ID" }),
    outletId: z.string().uuid().optional().openapi({ description: "Filter by outlet ID" }),
    brandId: z.string().uuid().optional().openapi({ description: "Filter by brand ID (matches rows where this brand is in the brand_ids array)" }),
    featureSlug: z.string().optional().openapi({ description: "Filter by exact feature slug" }),
    featureSlugs: z
      .string()
      .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
      .optional()
      .openapi({ description: "Comma-separated list of feature slugs to filter by. Use with groupBy=featureSlug for per-feature stats.", example: "pr-journalist-outreach,pr-journalist-outreach-v2" }),
    workflowSlug: z.string().optional().openapi({ description: "Filter by exact workflow slug" }),
    workflowSlugs: z
      .string()
      .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
      .optional()
      .openapi({ description: "Comma-separated list of workflow slugs to filter by. Use with groupBy=workflowSlug for per-workflow stats.", example: "pr-pitch,cold-email,warm-intro" }),
    featureDynastySlug: z.string().optional().openapi({ description: "Filter by feature dynasty slug — resolves to all versioned slugs in the dynasty" }),
    workflowDynastySlug: z.string().optional().openapi({ description: "Filter by workflow dynasty slug — resolves to all versioned slugs in the dynasty" }),
    groupBy: StatsGroupByEnum.optional().openapi({ description: "Dimension to group results by. When set, the response includes a groupedBy map keyed by slug." }),
  })
  .openapi("StatsQuery");

const OutreachStatusCountSchema = z.record(z.string(), z.number()).openapi("OutreachStatusCount", {
  description: "Cumulative status counts. DB statuses (buffered, claimed, served, skipped) are cumulative. Email-gateway fields (contacted, sent, delivered, opened, clicked, bounced, repliesPositive, repliesNegative, repliesNeutral, repliesAutoReply, recipients) are passed through.",
  example: { buffered: 200, claimed: 150, served: 120, skipped: 30, contacted: 115, sent: 110, delivered: 105, opened: 45, clicked: 12, bounced: 5, repliesPositive: 3, repliesNegative: 2 },
});

const RepliesDetailSchema = z.object({
  interested: z.number(),
  meetingBooked: z.number(),
  closed: z.number(),
  notInterested: z.number(),
  wrongPerson: z.number(),
  unsubscribe: z.number(),
  neutral: z.number(),
  autoReply: z.number(),
  outOfOffice: z.number(),
}).openapi("RepliesDetail", {
  description: "Granular breakdown of reply types from email-gateway.",
});

const GroupedEntrySchema = z.object({
  totalJournalists: z.number().openapi({ description: "Total journalists found for this group" }),
  byOutreachStatus: OutreachStatusCountSchema,
  repliesDetail: RepliesDetailSchema.optional().openapi({ description: "Granular reply breakdown from email-gateway. Present when reply data exists." }),
}).openapi("GroupedEntry");

export const StatsResponseSchema = z
  .object({
    totalJournalists: z.number().openapi({ description: "Total journalists found matching the filters" }),
    byOutreachStatus: OutreachStatusCountSchema,
    repliesDetail: RepliesDetailSchema.optional().openapi({ description: "Granular reply breakdown from email-gateway. Present when reply data exists." }),
    groupedBy: z.record(z.string(), GroupedEntrySchema).optional().openapi({ description: "Per-slug breakdown when groupBy is specified. Keys are slug values (or dynasty slugs for dynasty grouping)." }),
  })
  .openapi("StatsResponse");

// ==================== Journalists List Schemas ====================

export const JournalistsListQuerySchema = z
  .object({
    brandId: z.string().uuid().openapi({ description: "Brand ID (required). Returns journalists whose brand_ids array contains this brand." }),
    campaignId: z.string().uuid().optional().openapi({ description: "Optionally narrow to a single campaign" }),
    featureSlugs: z.string().optional().openapi({ description: "Comma-separated feature slugs to filter campaign rows" }).transform((val) => val ? val.split(",").map((s) => s.trim()).filter(Boolean) : undefined),
    featureDynastySlug: z.string().optional().openapi({ description: "Filter by feature dynasty slug — resolves to all versioned slugs in the dynasty via features-service. Takes priority over featureSlugs." }),
    workflowSlug: z.string().optional().openapi({ description: "Optionally filter campaign rows by workflow slug" }),
  })
  .openapi("JournalistsListQuery");


const JournalistCostSchema = z.object({
  totalCostInUsdCents: z.number().openapi({ description: "Total cost in USD cents (actual + provisioned)" }),
  actualCostInUsdCents: z.number().openapi({ description: "Actual metered cost in USD cents" }),
  provisionedCostInUsdCents: z.number().openapi({ description: "Provisioned (reserved) cost in USD cents" }),
  runCount: z.number().openapi({ description: "Number of distinct runs contributing to this cost" }),
}).openapi("JournalistCost");

const JournalistCampaignEntrySchema = z.object({
  id: z.string().uuid().openapi({ description: "campaign_journalist row ID" }),
  campaignId: z.string().uuid(),
  featureSlug: z.string().nullable(),
  workflowSlug: z.string().nullable(),
  relevanceScore: z.string(),
  whyRelevant: z.string(),
  whyNotRelevant: z.string(),
  articleUrls: z.array(z.string()).nullable(),
  email: z.string().nullable().openapi({ description: "Per-campaign email (from campaign_journalists table)" }),
  apolloPersonId: z.string().nullable(),
  runId: z.string().uuid().nullable(),
  createdAt: z.string(),
}).openapi("JournalistCampaignEntry");

const JournalistListItemSchema = z.object({
  journalistId: z.string().uuid(),
  journalistName: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  entityType: z.enum(["individual", "organization"]),
  outletId: z.string().uuid(),
  outletName: z.string().nullable().openapi({ description: "Outlet display name from outlets-service. Null if outlets-service is unreachable." }),
  outletDomain: z.string().nullable().openapi({ description: "Outlet domain from outlets-service — used for logo resolution. Null if outlets-service is unreachable." }),
  email: z.string().nullable().openapi({ description: "Global email (from journalists table apollo_email, fallback to best campaign email)" }),
  apolloPersonId: z.string().nullable(),
  brand: StatusBooleansSchema.nullable().openapi({ description: "Cumulative status at brand scope (aggregate across campaigns). Present in brand mode, null in campaign mode." }),
  byCampaign: z.record(z.string().uuid(), StatusBooleansSchema).nullable().openapi({ description: "Per-campaign status breakdown. Present in brand mode, null in campaign mode." }),
  campaign: StatusBooleansSchema.nullable().openapi({ description: "Cumulative status at campaign scope. Present in campaign mode, null in brand mode." }),
  global: GlobalStatusSchema.nullable().openapi({ description: "Global email signals (bounced/unsubscribed). Null if no email-gateway data." }),
  cost: JournalistCostSchema.nullable().openapi({ description: "Per-journalist cost aggregated across all campaigns. Null if no runs or runs-service is unreachable." }),
  campaigns: z.array(JournalistCampaignEntrySchema).openapi({ description: "Per-campaign entries for this journalist" }),
}).openapi("JournalistListItem", {
  description: "A journalist with scoped status booleans (brand/byCampaign/campaign/global) and per-campaign entries.",
});

export const JournalistsListResponseSchema = z.object({
  journalists: z.array(JournalistListItemSchema),
  total: z.number().int().openapi({ description: "Total journalists matching filters (not affected by pagination)" }),
  byOutreachStatus: StatusCountsSchema.openapi({ description: "Cumulative status counts across ALL journalists matching filters." }),
}).openapi("JournalistsListResponse");

// ==================== Cost Stats Schemas ====================

export const CostStatsQuerySchema = z
  .object({
    brandId: z.string().uuid().openapi({ description: "Brand ID to scope costs to (matches rows where this brand is in the brand_ids array)" }),
    campaignId: z.string().uuid().optional().openapi({ description: "Optionally narrow costs to a single campaign" }),
    groupBy: z.enum(["journalistId"]).optional().openapi({ description: "Group costs by journalist. Each journalist's share is the run cost divided evenly across journalists in that run." }),
  })
  .openapi("CostStatsQuery");

const CostGroupSchema = z
  .object({
    dimensions: z.record(z.string(), z.string().nullable()).openapi({ description: "Dimension values for this group (e.g. { journalistId: '...' }). Empty when no groupBy." }),
    totalCostInUsdCents: z.number().openapi({ description: "Total cost in USD cents (actual + provisioned)" }),
    actualCostInUsdCents: z.number().openapi({ description: "Actual metered cost in USD cents" }),
    provisionedCostInUsdCents: z.number().openapi({ description: "Provisioned (reserved) cost in USD cents" }),
    runCount: z.number().openapi({ description: "Number of distinct runs contributing to this cost" }),
  })
  .openapi("CostGroup");

export const CostStatsResponseSchema = z
  .object({
    groups: z.array(CostGroupSchema).openapi({ description: "Cost groups. One entry per journalist when groupBy=journalistId, otherwise a single entry with totals." }),
  })
  .openapi("CostStatsResponse");

// ==================== Outlet Status Schemas ====================

const ScopeFiltersSchema = z
  .object({
    brandId: z.string().uuid().optional().openapi({ description: "Brand UUID to scope results to", example: "550e8400-e29b-41d4-a716-446655440000" }),
    campaignId: z.string().uuid().optional().openapi({ description: "Campaign UUID to scope results to", example: "7c9e6679-7425-40de-944b-e07fc1f90ae7" }),
  })
  .openapi("ScopeFilters", {
    description: "Scoping filters. At least one of brandId or campaignId is required. If both are provided, campaignId takes priority (brand mode is disabled). Omitting both returns 400.",
    example: { brandId: "550e8400-e29b-41d4-a716-446655440000" },
  });

export const OutletStatusRequestSchema = z
  .object({
    outletIds: z.array(z.string().uuid()).min(1).openapi({
      description: "List of outlet UUIDs to get status for",
      example: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
    }),
    scopeFilters: ScopeFiltersSchema.openapi({
      description: "Scoping filters for the query. Headers are used for tracing only, not for scoping.",
    }),
  })
  .openapi("OutletStatusRequest", {
    example: {
      outletIds: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
      scopeFilters: { brandId: "550e8400-e29b-41d4-a716-446655440000" },
    },
  });

const OutletStatusEntrySchema = z
  .object({
    totalJournalists: z.number().openapi({ description: "Total journalists for this outlet" }),
    brand: StatusCountsSchema.nullable().openapi({ description: "Cumulative counts at brand scope. Present in brand mode, null in campaign mode." }),
    byCampaign: z.record(z.string().uuid(), StatusCountsSchema).nullable().openapi({ description: "Per-campaign counts. Present in brand mode, null in campaign mode." }),
    campaign: StatusCountsSchema.nullable().openapi({ description: "Cumulative counts at campaign scope. Present in campaign mode, null in brand mode." }),
    global: GlobalStatusCountsSchema.openapi({ description: "Global email signals (bounced/unsubscribed counts)." }),
  })
  .openapi("OutletStatusEntry", {
    description: "Status counts for a single outlet, aggregated across journalists.",
  });

export const OutletStatusResponseSchema = z
  .object({
    results: z.record(z.string().uuid(), OutletStatusEntrySchema).openapi({
      description: "Map of outletId → status counts",
    }),
    total: z.number().openapi({ description: "Total journalists across all requested outlets" }),
    byOutreachStatus: StatusCountsSchema.openapi({ description: "Cumulative status counts across all requested outlets." }),
  })
  .openapi("OutletStatusResponse");

// ==================== Path Registrations ====================

// Health
registry.registerPath({ method: "get", path: "/health", summary: "Health check", responses: { 200: { description: "Service is healthy", content: { "application/json": { schema: z.object({ status: z.string(), timestamp: z.string(), service: z.string() }) } } } } });

// Buffer/Next
registry.registerPath({ method: "post", path: "/orgs/buffer/next", summary: "Pull next best journalist with verified email. When outletId is provided, searches that outlet only. When omitted, pulls outlets from outlets-service and loops until finding a journalist with a valid email. Resolves email via Apollo, checks dedup via email-gateway.", security: [{ [apiKeyAuth.name]: [] }], request: { body: { content: { "application/json": { schema: BufferNextSchema } } } }, responses: { 200: { description: "Next journalist with email, or { found: false } if exhausted", content: { "application/json": { schema: BufferNextResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } }, 502: { description: "Upstream service error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Discover
registry.registerPath({ method: "post", path: "/orgs/discover", summary: "Discover new journalists for a campaign+outlet. Creates a run, scrapes articles, scores journalists via LLM, and stores them as buffered. The x-brand-id header supports CSV format (e.g. uuid1,uuid2).", security: [{ [apiKeyAuth.name]: [] }], request: { body: { content: { "application/json": { schema: DiscoverRequestSchema } } } }, responses: { 200: { description: "Discovery results with run ID and count of journalists found", content: { "application/json": { schema: DiscoverResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } }, 502: { description: "Upstream service error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Campaign Outlet Journalists
registry.registerPath({ method: "get", path: "/orgs/campaign-outlet-journalists", summary: "Get journalists associated with a campaign or brand, optionally filtered by outlet, run, and/or feature dynasty slug. Provide campaign_id, brand_id, or both.", security: [{ [apiKeyAuth.name]: [] }], request: { query: z.object({ campaign_id: z.string().uuid().optional().openapi({ description: "Filter by campaign. At least one of campaign_id or brand_id is required." }), brand_id: z.string().uuid().optional().openapi({ description: "Filter by brand (returns journalists whose brand_ids array contains this brand). At least one of campaign_id or brand_id is required." }), outlet_id: z.string().uuid().optional(), run_id: z.string().uuid().optional().openapi({ description: "Filter by the run that created the journalist entries." }), feature_dynasty_slug: z.string().optional().openapi({ description: "Filter by feature dynasty slug — resolves to all versioned slugs in the dynasty via features-service." }) }) }, responses: { 200: { description: "Campaign journalists with journalist details. The brandIds field is a UUID array.", content: { "application/json": { schema: CampaignOutletJournalistsResponseSchema } } }, 400: { description: "Validation error — at least one of campaign_id or brand_id is required", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Stats (org-scoped — requires x-org-id)
registry.registerPath({ method: "get", path: "/orgs/stats", summary: "Get journalist stats with optional dynasty-aware filtering and grouping", security: [{ [apiKeyAuth.name]: [] }], request: { query: StatsQuerySchema }, responses: { 200: { description: "Journalist stats", content: { "application/json": { schema: StatsResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Stats (protected public — API key only)
registry.registerPath({ method: "get", path: "/public/stats", summary: "Get journalist stats (public). Same filters as /stats but does not require identity headers.", security: [{ [apiKeyAuth.name]: [] }], request: { query: StatsQuerySchema }, responses: { 200: { description: "Journalist stats", content: { "application/json": { schema: StatsResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Cost Stats
registry.registerPath({ method: "get", path: "/orgs/journalists/stats/costs", summary: "Get cost stats for journalist discovery runs. Returns aggregated costs from runs-service, distributed per journalist. Requires x-org-id to scope costs to the requesting org.", security: [{ [apiKeyAuth.name]: [] }], request: { query: CostStatsQuerySchema }, responses: { 200: { description: "Cost stats (flat or grouped by journalistId)", content: { "application/json": { schema: CostStatsResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Journalists List
registry.registerPath({ method: "get", path: "/orgs/journalists/list", summary: "List journalists grouped by identity with per-campaign details. Each journalist has global data (email, cost, emailStatus) and a campaigns[] array with per-campaign entries. Filter by featureSlugs (CSV), featureDynastySlug (resolves to versioned slugs), and/or workflowSlug.", security: [{ [apiKeyAuth.name]: [] }], request: { query: JournalistsListQuerySchema }, responses: { 200: { description: "Grouped journalist list with per-campaign entries", content: { "application/json": { schema: JournalistsListResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Org-scoped — Outlet blocked check
registry.registerPath({ method: "get", path: "/orgs/outlets/blocked", summary: "Check if an outlet is blocked for a brand+org. Uses full dedup logic: checks lead-service for prior contacts, reply classification, 30-day no-reply cooldown, and 12-month expiry.", security: [{ [apiKeyAuth.name]: [] }], request: { query: z.object({ org_id: z.string().uuid().openapi({ description: "Organization ID" }), brand_ids: z.string().openapi({ description: "Comma-separated brand UUIDs", example: "uuid1,uuid2" }), outlet_id: z.string().uuid().openapi({ description: "Outlet ID to check" }) }) }, responses: { 200: { description: "Outlet blocked status", content: { "application/json": { schema: z.object({ blocked: z.boolean().openapi({ description: "Whether this outlet is blocked for the given brand+org" }), reason: z.string().optional().openapi({ description: "Human-readable reason when blocked" }) }).openapi("OutletBlockedResponse") } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } }, 502: { description: "Upstream service error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Org-scoped — Outlet outreach status (enriched from email-gateway)
registry.registerPath({ method: "post", path: "/orgs/outlets/status", summary: "Batch outlet outreach status enriched from email-gateway. Scoping is determined by scopeFilters in the body (not headers). Returns the high watermark outreach status across all journalists for each outlet. When scoped by brand, includes per-campaign breakdown.", security: [{ [apiKeyAuth.name]: [] }], request: { body: { content: { "application/json": { schema: OutletStatusRequestSchema } } } }, responses: { 200: { description: "Per-outlet outreach status", content: { "application/json": { schema: OutletStatusResponseSchema } } }, 400: { description: "Validation error or missing scope filters", content: { "application/json": { schema: ErrorResponseSchema } } }, 502: { description: "Upstream service error (email-gateway)", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Internal — Batch journalist lookup (api-key only)
registry.registerPath({ method: "get", path: "/internal/journalists/by-ids", summary: "Batch lookup journalists by IDs", security: [{ [apiKeyAuth.name]: [] }], request: { query: z.object({ ids: z.string() }) }, responses: { 200: { description: "Journalists", content: { "application/json": { schema: z.object({ journalists: z.array(JournalistSchema) }) } } } } });
