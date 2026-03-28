import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ==================== Enums ====================

export const entityTypeEnum = pgEnum("entity_type", [
  "individual",
  "organization",
]);

export const bufferStatusEnum = pgEnum("buffer_status", [
  "buffered",
  "claimed",
  "served",
  "skipped",
]);

// ==================== Tables ====================

/** A journalist exists globally at an outlet — not scoped to any org/brand/campaign. */
export const journalists = pgTable(
  "journalists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    journalistName: text("journalist_name").notNull(),
    entityType: entityTypeEnum("entity_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_journalists_outlet_name_type").on(
      table.outletId,
      table.journalistName,
      table.entityType
    ),
  ]
);

/** Per-campaign relevance scoring + buffer status — fully scoped to org/brand/campaign. */
export const campaignJournalists = pgTable(
  "campaign_journalists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    journalistId: uuid("journalist_id")
      .notNull()
      .references(() => journalists.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    brandId: uuid("brand_id").notNull(),
    featureSlug: text("feature_slug"),
    workflowSlug: text("workflow_slug"),
    campaignId: uuid("campaign_id").notNull(),
    outletId: uuid("outlet_id").notNull(),
    relevanceScore: numeric("relevance_score", {
      precision: 5,
      scale: 2,
    }).notNull(),
    whyRelevant: text("why_relevant").notNull(),
    whyNotRelevant: text("why_not_relevant").notNull(),
    articleUrls: jsonb("article_urls").$type<string[]>(),
    status: bufferStatusEnum("status").notNull().default("buffered"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_cj_campaign_outlet_journalist").on(
      table.campaignId,
      table.outletId,
      table.journalistId
    ),
    index("idx_cj_campaign").on(table.campaignId),
    index("idx_cj_journalist").on(table.journalistId),
    index("idx_cj_org").on(table.orgId),
    index("idx_cj_buffer_claim").on(
      table.campaignId,
      table.outletId,
      table.status,
      table.relevanceScore
    ),
  ]
);

/** Tracks when discovery was last run for a given scope — used for 7-day caching. */
export const discoveryCache = pgTable(
  "discovery_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    brandId: uuid("brand_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    outletId: uuid("outlet_id").notNull(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull(),
    runId: uuid("run_id"),
  },
  (table) => [
    uniqueIndex("idx_dc_org_brand_campaign_outlet").on(
      table.orgId,
      table.brandId,
      table.campaignId,
      table.outletId
    ),
  ]
);

/** Idempotency cache for buffer/next — prevents double-serving on workflow retries. */
export const idempotencyCache = pgTable(
  "idempotency_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  }
);

// ==================== Type Exports ====================

export type Journalist = typeof journalists.$inferSelect;
export type NewJournalist = typeof journalists.$inferInsert;
export type CampaignJournalist = typeof campaignJournalists.$inferSelect;
export type NewCampaignJournalist = typeof campaignJournalists.$inferInsert;
export type DiscoveryCache = typeof discoveryCache.$inferSelect;
export type NewDiscoveryCache = typeof discoveryCache.$inferInsert;
export type IdempotencyCache = typeof idempotencyCache.$inferSelect;
