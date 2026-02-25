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

// ==================== Journalist Schemas ====================

export const JournalistSchema = z
  .object({
    id: z.string().uuid(),
    entityType: z.enum(["individual", "organization"]),
    journalistName: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Journalist");

export const CreateJournalistSchema = z
  .object({
    entityType: z.enum(["individual", "organization"]),
    journalistName: z.string().min(1),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  })
  .openapi("CreateJournalistRequest");

export const UpdateJournalistSchema = z
  .object({
    journalistName: z.string().min(1).optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
  })
  .openapi("UpdateJournalistRequest");

export const JournalistListQuerySchema = z.object({
  entity_type: z.enum(["individual", "organization"]).optional(),
  outlet_id: z.string().uuid().optional(),
  campaign_id: z.string().uuid().optional(),
});

// ==================== Outlet-Journalist Schemas ====================

export const OutletJournalistSchema = z
  .object({
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
  })
  .openapi("OutletJournalist");

export const CreateOutletJournalistSchema = z
  .object({
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
  })
  .openapi("CreateOutletJournalistRequest");

export const OutletJournalistWithDetailsSchema = z
  .object({
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
    journalistName: z.string().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    entityType: z.enum(["individual", "organization"]).optional(),
  })
  .openapi("OutletJournalistWithDetails");

// ==================== Campaign-Outlet-Journalist Schemas ====================

export const CampaignOutletJournalistSchema = z
  .object({
    campaignId: z.string().uuid(),
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
    whyRelevant: z.string(),
    whyNotRelevant: z.string(),
    relevanceScore: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("CampaignOutletJournalist");

export const CreateCampaignOutletJournalistSchema = z
  .object({
    campaignId: z.string().uuid(),
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
    whyRelevant: z.string().min(1),
    whyNotRelevant: z.string().min(1),
    relevanceScore: z.number().min(0).max(100),
  })
  .openapi("CreateCampaignOutletJournalistRequest");

export const UpdateCampaignOutletJournalistSchema = z
  .object({
    whyRelevant: z.string().min(1).optional(),
    whyNotRelevant: z.string().min(1).optional(),
    relevanceScore: z.number().min(0).max(100).optional(),
  })
  .openapi("UpdateCampaignOutletJournalistRequest");

// ==================== Hunted Individual Schemas ====================

export const CreateHuntedIndividualSchema = z
  .object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    domain: z.string().min(1),
    huntedAt: z.string(),
    position: z.string().optional(),
    twitter: z.string().optional(),
    linkedinUrl: z.string().optional(),
    phoneNumber: z.string().optional(),
    company: z.string().optional(),
    sources: z.any().optional(),
    verificationDate: z.string().optional(),
    verificationStatus: z
      .enum(["valid", "accept_all", "unknown", "invalid"])
      .optional(),
    score: z.number().int().optional(),
    acceptAll: z.boolean().optional(),
  })
  .openapi("CreateHuntedIndividualRequest");

export const BulkHuntedIndividualsSchema = z
  .object({
    items: z.array(CreateHuntedIndividualSchema).min(1).max(1000),
  })
  .openapi("BulkHuntedIndividualsRequest");

// ==================== Hunted Email Schemas ====================

export const CreateHuntedEmailSchema = z
  .object({
    email: z.string().email(),
    huntedAt: z.string(),
    score: z.number().int().default(0),
    acceptAll: z.boolean().default(false),
    status: z.enum(["valid", "invalid", "risky", "unknown"]),
    regexp: z.boolean().default(false),
    gibberish: z.boolean().default(false),
    disposable: z.boolean().default(false),
    webmail: z.boolean().default(false),
    mxRecords: z.boolean().default(false),
    smtpServer: z.boolean().default(false),
    smtpCheck: z.boolean().default(false),
    block: z.boolean().default(false),
    sources: z.any().default([]),
  })
  .openapi("CreateHuntedEmailRequest");

export const BulkHuntedEmailsSchema = z
  .object({
    items: z.array(CreateHuntedEmailSchema).min(1).max(1000),
  })
  .openapi("BulkHuntedEmailsRequest");

// ==================== Searched Email Schemas ====================

export const CreateSearchedEmailSchema = z
  .object({
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
    searchedAt: z.string(),
    journalistEmail: z.string().email(),
    sourceStatus: z
      .enum(["Found online", "Guessed from similar", "Pure guess"])
      .optional(),
    sourceQuote: z.string().optional(),
  })
  .openapi("CreateSearchedEmailRequest");

// ==================== Email Pipeline View Schemas ====================

export const ValidJournalistEmailSchema = z
  .object({
    journalistId: z.string().uuid(),
    outletId: z.string().uuid(),
    email: z.string(),
    isValid: z.boolean(),
    type: z.string(),
    source: z.string(),
    confidence: z.number(),
  })
  .openapi("ValidJournalistEmail");

export const HuntedEmailEventSchema = z
  .object({
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
    email: z.string(),
    huntedAt: z.string(),
    status: z.string(),
    score: z.number().nullable(),
    acceptAll: z.boolean().nullable(),
  })
  .openapi("HuntedEmailEvent");

export const HuntedIndividualEventSchema = z
  .object({
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
    firstName: z.string(),
    lastName: z.string(),
    domain: z.string(),
    huntedAt: z.string(),
    position: z.string().nullable(),
    verificationStatus: z.string().nullable(),
    score: z.number().nullable(),
  })
  .openapi("HuntedIndividualEvent");

export const SearchedEmailEventSchema = z
  .object({
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
    journalistEmail: z.string(),
    searchedAt: z.string(),
    sourceStatus: z.string().nullable(),
    sourceQuote: z.string().nullable(),
  })
  .openapi("SearchedEmailEvent");

export const NeedEmailUpdateSchema = z
  .object({
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
    journalistName: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    lastSearchedAt: z.string().nullable(),
    lastHuntedAt: z.string().nullable(),
  })
  .openapi("NeedEmailUpdate");

export const NeedHunterSchema = z
  .object({
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
    journalistName: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
  })
  .openapi("NeedHunter");

export const NeedAgentSearchSchema = z
  .object({
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
    journalistName: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
  })
  .openapi("NeedAgentSearch");

export const NeedHunterVerificationSchema = z
  .object({
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
    email: z.string(),
  })
  .openapi("NeedHunterVerification");

// ==================== Engagement Schemas ====================

export const JournalistEngagementSchema = z
  .object({
    journalistId: z.string().uuid(),
    journalistName: z.string(),
    pitchBounces: z.number(),
    deliveries: z.number(),
    lastEngagementAt: z.string().nullable(),
    totalPitches: z.number(),
    totalOpens: z.number(),
    totalReplies: z.number(),
  })
  .openapi("JournalistEngagement");

export const JournalistStatusSchema = z
  .object({
    campaignId: z.string().uuid(),
    outletId: z.string().uuid(),
    journalistId: z.string().uuid(),
    journalistName: z.string(),
    status: z.string(),
    relevanceScore: z.string(),
  })
  .openapi("JournalistStatus");

// ==================== Discover Emails Schemas ====================

export const DiscoverEmailsSchema = z
  .object({
    outletId: z.string().uuid(),
    organizationDomain: z.string().min(1),
    journalistIds: z.array(z.string().uuid()).optional(),
    runId: z.string().uuid(),
    appId: z.string().uuid(),
    brandId: z.string().uuid(),
    campaignId: z.string().uuid(),
    clerkOrgId: z.string().min(1),
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

// ==================== Internal Schemas ====================

export const JournalistWithEmailsSchema = z
  .object({
    id: z.string().uuid(),
    journalistName: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    entityType: z.enum(["individual", "organization"]),
    emails: z.array(
      z.object({
        email: z.string(),
        isValid: z.boolean(),
        confidence: z.number(),
      })
    ),
  })
  .openapi("JournalistWithEmails");

// ==================== Path Registrations ====================

// Health
registry.registerPath({
  method: "get",
  path: "/health",
  summary: "Health check",
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            timestamp: z.string(),
            service: z.string(),
          }),
        },
      },
    },
  },
});

// POST /journalists
registry.registerPath({
  method: "post",
  path: "/journalists",
  summary: "Create a journalist",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: CreateJournalistSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created",
      content: {
        "application/json": {
          schema: z.object({ journalist: JournalistSchema }),
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
    409: {
      description: "Duplicate journalist",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
  },
});

// GET /journalists
registry.registerPath({
  method: "get",
  path: "/journalists",
  summary: "List journalists with optional filters",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    query: JournalistListQuerySchema,
  },
  responses: {
    200: {
      description: "List of journalists",
      content: {
        "application/json": {
          schema: z.object({ journalists: z.array(JournalistSchema) }),
        },
      },
    },
  },
});

// GET /journalists/:id
registry.registerPath({
  method: "get",
  path: "/journalists/{id}",
  summary: "Get journalist by ID",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Journalist details",
      content: {
        "application/json": {
          schema: z.object({ journalist: JournalistSchema }),
        },
      },
    },
    404: {
      description: "Not found",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
  },
});

// PATCH /journalists/:id
registry.registerPath({
  method: "patch",
  path: "/journalists/{id}",
  summary: "Update journalist",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        "application/json": { schema: UpdateJournalistSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Updated",
      content: {
        "application/json": {
          schema: z.object({ journalist: JournalistSchema }),
        },
      },
    },
    404: {
      description: "Not found",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
  },
});

// POST /outlet-journalists
registry.registerPath({
  method: "post",
  path: "/outlet-journalists",
  summary: "Link journalist to outlet",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: CreateOutletJournalistSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Linked",
      content: {
        "application/json": {
          schema: z.object({ outletJournalist: OutletJournalistSchema }),
        },
      },
    },
  },
});

// GET /outlet-journalists
registry.registerPath({
  method: "get",
  path: "/outlet-journalists",
  summary: "List outlet-journalist links",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    query: z.object({
      outlet_id: z.string().uuid().optional(),
      journalist_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: "List of links",
      content: {
        "application/json": {
          schema: z.object({
            outletJournalists: z.array(OutletJournalistWithDetailsSchema),
          }),
        },
      },
    },
  },
});

// DELETE /outlet-journalists/:outletId/:journalistId
registry.registerPath({
  method: "delete",
  path: "/outlet-journalists/{outletId}/{journalistId}",
  summary: "Remove outlet-journalist link",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    params: z.object({
      outletId: z.string().uuid(),
      journalistId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "Deleted",
      content: {
        "application/json": {
          schema: z.object({ deleted: z.boolean() }),
        },
      },
    },
    404: {
      description: "Not found",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
  },
});

// POST /campaign-outlet-journalists
registry.registerPath({
  method: "post",
  path: "/campaign-outlet-journalists",
  summary: "Link journalist to campaign+outlet with relevance",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateCampaignOutletJournalistSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Created",
      content: {
        "application/json": {
          schema: z.object({
            campaignOutletJournalist: CampaignOutletJournalistSchema,
          }),
        },
      },
    },
  },
});

// GET /campaign-outlet-journalists
registry.registerPath({
  method: "get",
  path: "/campaign-outlet-journalists",
  summary: "List campaign-outlet-journalist links",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    query: z.object({
      campaign_id: z.string().uuid(),
      outlet_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: "List",
      content: {
        "application/json": {
          schema: z.object({
            campaignOutletJournalists: z.array(
              CampaignOutletJournalistSchema
            ),
          }),
        },
      },
    },
  },
});

// PATCH /campaign-outlet-journalists/:campaignId/:outletId/:journalistId
registry.registerPath({
  method: "patch",
  path: "/campaign-outlet-journalists/{campaignId}/{outletId}/{journalistId}",
  summary: "Update campaign-outlet-journalist relevance",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    params: z.object({
      campaignId: z.string().uuid(),
      outletId: z.string().uuid(),
      journalistId: z.string().uuid(),
    }),
    body: {
      content: {
        "application/json": {
          schema: UpdateCampaignOutletJournalistSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated",
      content: {
        "application/json": {
          schema: z.object({
            campaignOutletJournalist: CampaignOutletJournalistSchema,
          }),
        },
      },
    },
    404: {
      description: "Not found",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
  },
});

// POST /hunted-individuals
registry.registerPath({
  method: "post",
  path: "/hunted-individuals",
  summary: "Record a hunted individual",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: CreateHuntedIndividualSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created",
      content: {
        "application/json": {
          schema: z.object({ created: z.boolean() }),
        },
      },
    },
  },
});

// POST /hunted-individuals/bulk
registry.registerPath({
  method: "post",
  path: "/hunted-individuals/bulk",
  summary: "Bulk insert hunted individuals",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: BulkHuntedIndividualsSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Bulk inserted",
      content: {
        "application/json": {
          schema: z.object({
            inserted: z.number(),
            total: z.number(),
          }),
        },
      },
    },
  },
});

// POST /hunted-emails
registry.registerPath({
  method: "post",
  path: "/hunted-emails",
  summary: "Record a hunted email",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: CreateHuntedEmailSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created",
      content: {
        "application/json": {
          schema: z.object({ created: z.boolean() }),
        },
      },
    },
  },
});

// POST /hunted-emails/bulk
registry.registerPath({
  method: "post",
  path: "/hunted-emails/bulk",
  summary: "Bulk insert hunted emails",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: BulkHuntedEmailsSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Bulk inserted",
      content: {
        "application/json": {
          schema: z.object({
            inserted: z.number(),
            total: z.number(),
          }),
        },
      },
    },
  },
});

// POST /searched-emails
registry.registerPath({
  method: "post",
  path: "/searched-emails",
  summary: "Record an agent search email result",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: CreateSearchedEmailSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created",
      content: {
        "application/json": {
          schema: z.object({ created: z.boolean() }),
        },
      },
    },
  },
});

// Email Pipeline GET endpoints
registry.registerPath({
  method: "get",
  path: "/journalists/emails/valid",
  summary: "Valid journalist emails",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    query: z.object({
      outlet_id: z.string().uuid().optional(),
      journalist_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: "Valid emails",
      content: {
        "application/json": {
          schema: z.object({
            emails: z.array(ValidJournalistEmailSchema),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/journalists/emails/hunted-events",
  summary: "Hunted email events",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    query: z.object({
      outlet_id: z.string().uuid().optional(),
      journalist_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: "Events",
      content: {
        "application/json": {
          schema: z.object({
            events: z.array(HuntedEmailEventSchema),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/journalists/emails/hunted-individual-events",
  summary: "Hunted individual events",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    query: z.object({
      outlet_id: z.string().uuid().optional(),
      journalist_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: "Events",
      content: {
        "application/json": {
          schema: z.object({
            events: z.array(HuntedIndividualEventSchema),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/journalists/emails/searched-events",
  summary: "Searched email events",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    query: z.object({
      outlet_id: z.string().uuid().optional(),
      journalist_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: "Events",
      content: {
        "application/json": {
          schema: z.object({
            events: z.array(SearchedEmailEventSchema),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/journalists/need-email-update",
  summary: "Journalists needing email update",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    query: z.object({
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Journalists needing update",
      content: {
        "application/json": {
          schema: z.object({
            journalists: z.array(NeedEmailUpdateSchema),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/journalists/need-hunter",
  summary: "Journalists needing Hunter search",
  security: [{ [apiKeyAuth.name]: [] }],
  responses: {
    200: {
      description: "Journalists needing Hunter",
      content: {
        "application/json": {
          schema: z.object({
            journalists: z.array(NeedHunterSchema),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/journalists/need-agent-search",
  summary: "Journalists needing agent search",
  security: [{ [apiKeyAuth.name]: [] }],
  responses: {
    200: {
      description: "Journalists needing agent search",
      content: {
        "application/json": {
          schema: z.object({
            journalists: z.array(NeedAgentSearchSchema),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/journalists/emails/need-hunter-verification",
  summary: "Emails needing Hunter verification",
  security: [{ [apiKeyAuth.name]: [] }],
  responses: {
    200: {
      description: "Emails needing verification",
      content: {
        "application/json": {
          schema: z.object({
            emails: z.array(NeedHunterVerificationSchema),
          }),
        },
      },
    },
  },
});

// Discover Emails (Apollo)
registry.registerPath({
  method: "post",
  path: "/journalists/discover-emails",
  summary: "Discover journalist emails via Apollo person match",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: DiscoverEmailsSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Discovery results",
      content: {
        "application/json": { schema: DiscoverEmailsResponseSchema },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
  },
});

// Engagement
registry.registerPath({
  method: "get",
  path: "/journalists/engagement/{journalistId}",
  summary: "Journalist engagement metrics",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    params: z.object({ journalistId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Engagement data",
      content: {
        "application/json": {
          schema: z.object({ engagement: JournalistEngagementSchema }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/journalists/status",
  summary: "Journalist status by campaign",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    query: z.object({
      campaign_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: "Statuses",
      content: {
        "application/json": {
          schema: z.object({
            statuses: z.array(JournalistStatusSchema),
          }),
        },
      },
    },
  },
});

// Internal
registry.registerPath({
  method: "get",
  path: "/internal/journalists/by-outlet-with-emails/{outletId}",
  summary: "Journalists with valid emails for an outlet",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    params: z.object({ outletId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Journalists with emails",
      content: {
        "application/json": {
          schema: z.object({
            journalists: z.array(JournalistWithEmailsSchema),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/journalists/by-ids",
  summary: "Batch lookup journalists by IDs",
  security: [{ [apiKeyAuth.name]: [] }],
  request: {
    query: z.object({ ids: z.string() }),
  },
  responses: {
    200: {
      description: "Journalists",
      content: {
        "application/json": {
          schema: z.object({ journalists: z.array(JournalistSchema) }),
        },
      },
    },
  },
});
