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

// ==================== Discover Emails Schemas ====================

export const DiscoverEmailsSchema = z
  .object({
    outletId: z.string().uuid(),
    organizationDomain: z.string().min(1),
    journalistIds: z.array(z.string().uuid()).optional(),
    brandId: z.string().uuid(),
    campaignId: z.string().uuid(),
  })
  .openapi("DiscoverEmailsRequest");

export const DiscoverEmailsResultSchema = z
  .object({
    journalistId: z.string().uuid(),
    email: z.string().nullable(),
    emailStatus: z.string().nullable(),
    cached: z.boolean(),
    enrichmentId: z.string(),
  })
  .openapi("DiscoverEmailsResult");

export const DiscoverEmailsResponseSchema = z
  .object({
    discovered: z.number(),
    total: z.number(),
    skipped: z.number(),
    results: z.array(DiscoverEmailsResultSchema),
  })
  .openapi("DiscoverEmailsResponse");

// ==================== Discover Journalists Schemas ====================

export const DiscoverJournalistsSchema = z
  .object({
    outletId: z.string().uuid(),
    brandId: z.string().uuid(),
    campaignId: z.string().uuid(),
    featureInputs: z.record(z.string()).default({}),
    maxArticles: z.number().int().min(1).max(30).default(15),
  })
  .openapi("DiscoverJournalistsRequest");

export const DiscoveredJournalistSchema = z
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
    isNew: z.boolean(),
  })
  .openapi("DiscoveredJournalist");

export const DiscoverJournalistsResponseSchema = z
  .object({
    journalists: z.array(DiscoveredJournalistSchema),
    totalArticlesSearched: z.number(),
    totalNamesExtracted: z.number(),
    totalJournalistsStored: z.number(),
  })
  .openapi("DiscoverJournalistsResponse");

// ==================== Resolve Journalists Schemas ====================

export const ResolveJournalistsSchema = z
  .object({
    outletId: z.string().uuid(),
    featureInputs: z.record(z.string()).default({}),
    maxArticles: z.number().int().min(1).max(30).default(15),
  })
  .openapi("ResolveJournalistsRequest");

export const ResolvedJournalistSchema = z
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
  .openapi("ResolvedJournalist");

export const ResolveJournalistsResponseSchema = z
  .object({
    journalists: z.array(ResolvedJournalistSchema),
    cached: z.boolean(),
  })
  .openapi("ResolveJournalistsResponse");

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

// ==================== Path Registrations ====================

// Health
registry.registerPath({ method: "get", path: "/health", summary: "Health check", responses: { 200: { description: "Service is healthy", content: { "application/json": { schema: z.object({ status: z.string(), timestamp: z.string(), service: z.string() }) } } } } });

// Discover Journalists
registry.registerPath({ method: "post", path: "/journalists/discover", summary: "Discover relevant journalists for a brand on an outlet via article search + LLM scoring", security: [{ [apiKeyAuth.name]: [] }], request: { body: { content: { "application/json": { schema: DiscoverJournalistsSchema } } } }, responses: { 200: { description: "Discovered journalists with relevance scores", content: { "application/json": { schema: DiscoverJournalistsResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } }, 502: { description: "Upstream service error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Discover Emails (Apollo)
registry.registerPath({ method: "post", path: "/journalists/discover-emails", summary: "Discover journalist emails via Apollo person match", security: [{ [apiKeyAuth.name]: [] }], request: { body: { content: { "application/json": { schema: DiscoverEmailsSchema } } } }, responses: { 200: { description: "Discovery results", content: { "application/json": { schema: DiscoverEmailsResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Resolve Journalists
registry.registerPath({ method: "post", path: "/journalists/resolve", summary: "Resolve journalists for a campaign+outlet: discover if needed, score, and return", security: [{ [apiKeyAuth.name]: [] }], request: { body: { content: { "application/json": { schema: ResolveJournalistsSchema } } } }, responses: { 200: { description: "Resolved journalists sorted by relevance score", content: { "application/json": { schema: ResolveJournalistsResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } }, 502: { description: "Upstream service error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Campaign Outlet Journalists
registry.registerPath({ method: "get", path: "/campaign-outlet-journalists", summary: "Get journalists associated with a campaign, optionally filtered by outlet", security: [{ [apiKeyAuth.name]: [] }], request: { query: z.object({ campaign_id: z.string().uuid(), outlet_id: z.string().uuid().optional() }) }, responses: { 200: { description: "Campaign journalists with journalist details", content: { "application/json": { schema: CampaignOutletJournalistsResponseSchema } } }, 400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } } } });

// Internal
registry.registerPath({ method: "get", path: "/internal/journalists/by-ids", summary: "Batch lookup journalists by IDs", security: [{ [apiKeyAuth.name]: [] }], request: { query: z.object({ ids: z.string() }) }, responses: { 200: { description: "Journalists", content: { "application/json": { schema: z.object({ journalists: z.array(JournalistSchema) }) } } } } });
