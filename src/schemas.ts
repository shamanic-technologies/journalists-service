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
    outletId: z.string().uuid(),
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

// ==================== Campaign Outlet Journalists Schemas ====================

export const CampaignOutletJournalistSchema = z
  .object({
    id: z.string().uuid(),
    journalistId: z.string().uuid(),
    campaignId: z.string().uuid(),
    outletId: z.string().uuid(),
    orgId: z.string().uuid(),
    brandId: z.string().uuid(),
    featureSlug: z.string().nullable(),
    relevanceScore: z.string(),
    whyRelevant: z.string(),
    whyNotRelevant: z.string(),
    articleUrls: z.array(z.string()).nullable(),
    status: z.enum(["buffered", "claimed", "served", "contacted", "skipped"]),
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
  .openapi("StatsGroupBy");

export const StatsQuerySchema = z
  .object({
    orgId: z.string().uuid().optional(),
    campaignId: z.string().uuid().optional(),
    outletId: z.string().uuid().optional(),
    brandId: z.string().uuid().optional(),
    featureSlug: z.string().optional(),
    workflowSlug: z.string().optional(),
    featureDynastySlug: z.string().optional(),
    workflowDynastySlug: z.string().optional(),
    groupBy: StatsGroupByEnum.optional(),
  })
  .openapi("StatsQuery");

const StatusCountSchema = z.record(z.string(), z.number());

const GroupedEntrySchema = z.object({
  totalJournalists: z.number(),
  byStatus: StatusCountSchema,
});

export const StatsResponseSchema = z
  .object({
    totalJournalists: z.number(),
    byStatus: StatusCountSchema,
    groupedBy: z.record(z.string(), GroupedEntrySchema).optional(),
  })
  .openapi("StatsResponse");

// ==================== Cost Stats Schemas ====================

export const CostStatsQuerySchema = z
  .object({
    brandId: z.string().uuid(),
    campaignId: z.string().uuid().optional(),
    groupBy: z.enum(["journalistId"]).optional(),
  })
  .openapi("CostStatsQuery");

const CostGroupSchema = z
  .object({
    dimensions: z.record(z.string(), z.string().nullable()),
    totalCostInUsdCents: z.number(),
    actualCostInUsdCents: z.number(),
    provisionedCostInUsdCents: z.number(),
    runCount: z.number(),
  })
  .openapi("CostGroup");

export const CostStatsResponseSchema = z
  .object({
    groups: z.array(CostGroupSchema),
  })
  .openapi("CostStatsResponse");

// ==================== Path Registrations ====================

// Health
registry.registerPath({ method: "get", path: "/health", summary: "Health check", responses: { 200: { description: "Service is healthy", content: { "application/json": { schema: z.object({ status: z.string(), timestamp: z.string(), service: z.string() }) } } } } });

// Buffer/Next
registry.registerPath({ method: "post", path: "/buffer/next", summary: "Pull next best journalist from buffer for a campaign+outlet. Refills buffer automatically on first call.", security: [{ [apiKeyAuth.name]: [] }], request: { body: { content: { "application/json": { schema: BufferNextSchema } } } }, responses: { 200: { description: "Next journalist or { found: false } if buffer exhausted", content: { "application/json": { schema: BufferNextResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } }, 502: { description: "Upstream service error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Discover
registry.registerPath({ method: "post", path: "/discover", summary: "Discover new journalists for a campaign+outlet. Creates a run, scrapes articles, scores journalists via LLM, and stores them as buffered.", security: [{ [apiKeyAuth.name]: [] }], request: { body: { content: { "application/json": { schema: DiscoverRequestSchema } } } }, responses: { 200: { description: "Discovery results with run ID and count of journalists found", content: { "application/json": { schema: DiscoverResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } }, 502: { description: "Upstream service error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Campaign Outlet Journalists
registry.registerPath({ method: "get", path: "/campaign-outlet-journalists", summary: "Get journalists associated with a campaign or brand, optionally filtered by outlet and/or run. Provide campaign_id, brand_id, or both.", security: [{ [apiKeyAuth.name]: [] }], request: { query: z.object({ campaign_id: z.string().uuid().optional().openapi({ description: "Filter by campaign. At least one of campaign_id or brand_id is required." }), brand_id: z.string().uuid().optional().openapi({ description: "Filter by brand (returns journalists across all campaigns for that brand). At least one of campaign_id or brand_id is required." }), outlet_id: z.string().uuid().optional(), run_id: z.string().uuid().optional().openapi({ description: "Filter by the run that created the journalist entries." }) }) }, responses: { 200: { description: "Campaign journalists with journalist details", content: { "application/json": { schema: CampaignOutletJournalistsResponseSchema } } }, 400: { description: "Validation error — at least one of campaign_id or brand_id is required", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Stats (private — requires identity headers)
registry.registerPath({ method: "get", path: "/stats", summary: "Get journalist stats with optional dynasty-aware filtering and grouping", security: [{ [apiKeyAuth.name]: [] }], request: { query: StatsQuerySchema }, responses: { 200: { description: "Journalist stats", content: { "application/json": { schema: StatsResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Stats (public — API key only)
registry.registerPath({ method: "get", path: "/stats/public", summary: "Get journalist stats (public). Same filters as /stats but does not require identity headers.", security: [{ [apiKeyAuth.name]: [] }], request: { query: StatsQuerySchema }, responses: { 200: { description: "Journalist stats", content: { "application/json": { schema: StatsResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Cost Stats
registry.registerPath({ method: "get", path: "/journalists/stats/costs", summary: "Get cost stats for journalist discovery runs. Returns aggregated costs from runs-service, distributed per journalist. Requires x-org-id to scope costs to the requesting org.", security: [{ [apiKeyAuth.name]: [] }], request: { query: CostStatsQuerySchema }, responses: { 200: { description: "Cost stats (flat or grouped by journalistId)", content: { "application/json": { schema: CostStatsResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Internal
registry.registerPath({ method: "get", path: "/internal/journalists/by-ids", summary: "Batch lookup journalists by IDs", security: [{ [apiKeyAuth.name]: [] }], request: { query: z.object({ ids: z.string() }) }, responses: { 200: { description: "Journalists", content: { "application/json": { schema: z.object({ journalists: z.array(JournalistSchema) }) } } } } });
