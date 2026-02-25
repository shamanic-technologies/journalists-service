import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
  integer,
  jsonb,
  date,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// ==================== Enums ====================

export const entityTypeEnum = pgEnum("entity_type", [
  "individual",
  "organization",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "valid",
  "accept_all",
  "unknown",
  "invalid",
]);

export const emailStatusEnum = pgEnum("email_status", [
  "valid",
  "invalid",
  "risky",
  "unknown",
]);

export const sourceStatusEnum = pgEnum("source_status", [
  "Found online",
  "Guessed from similar",
  "Pure guess",
]);

// ==================== Tables ====================

export const pressJournalists = pgTable(
  "press_journalists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: entityTypeEnum("entity_type").notNull(),
    journalistName: text("journalist_name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_journalists_name_type").on(
      table.journalistName,
      table.entityType
    ),
  ]
);

export const outletJournalists = pgTable(
  "outlet_journalists",
  {
    outletId: uuid("outlet_id").notNull(),
    journalistId: uuid("journalist_id")
      .notNull()
      .references(() => pressJournalists.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.outletId, table.journalistId] }),
    index("idx_oj_journalist").on(table.journalistId),
    index("idx_oj_outlet").on(table.outletId),
  ]
);

export const campaignOutletJournalists = pgTable(
  "campaign_outlet_journalists",
  {
    campaignId: uuid("campaign_id").notNull(),
    outletId: uuid("outlet_id").notNull(),
    journalistId: uuid("journalist_id")
      .notNull()
      .references(() => pressJournalists.id, { onDelete: "cascade" }),
    whyRelevant: text("why_relevant").notNull(),
    whyNotRelevant: text("why_not_relevant").notNull(),
    relevanceScore: numeric("relevance_score", {
      precision: 5,
      scale: 2,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.campaignId, table.outletId, table.journalistId],
    }),
    index("idx_coj_campaign").on(table.campaignId),
    index("idx_coj_outlet").on(table.outletId),
  ]
);

export const huntedIndividuals = pgTable(
  "hunted_individuals",
  {
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    domain: text("domain").notNull(),
    huntedAt: timestamp("hunted_at", { withTimezone: true }).notNull(),
    position: text("position"),
    twitter: text("twitter"),
    linkedinUrl: text("linkedin_url"),
    phoneNumber: text("phone_number"),
    company: text("company"),
    sources: jsonb("sources"),
    verificationDate: date("verification_date"),
    verificationStatus: verificationStatusEnum("verification_status"),
    score: integer("score"),
    acceptAll: boolean("accept_all"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.firstName, table.lastName, table.domain, table.huntedAt],
    }),
    index("idx_hi_domain").on(table.domain),
  ]
);

export const huntedEmails = pgTable(
  "hunted_emails",
  {
    email: text("email").notNull(),
    huntedAt: timestamp("hunted_at", { withTimezone: true }).notNull(),
    score: integer("score").notNull().default(0),
    acceptAll: boolean("accept_all").notNull().default(false),
    status: emailStatusEnum("status").notNull(),
    regexp: boolean("regexp").notNull().default(false),
    gibberish: boolean("gibberish").notNull().default(false),
    disposable: boolean("disposable").notNull().default(false),
    webmail: boolean("webmail").notNull().default(false),
    mxRecords: boolean("mx_records").notNull().default(false),
    smtpServer: boolean("smtp_server").notNull().default(false),
    smtpCheck: boolean("smtp_check").notNull().default(false),
    block: boolean("block").notNull().default(false),
    sources: jsonb("sources").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.email, table.huntedAt] }),
    index("idx_he_email").on(table.email),
  ]
);

export const searchedEmails = pgTable(
  "searched_emails",
  {
    outletId: uuid("outlet_id").notNull(),
    journalistId: uuid("journalist_id")
      .notNull()
      .references(() => pressJournalists.id, { onDelete: "cascade" }),
    searchedAt: timestamp("searched_at", { withTimezone: true }).notNull(),
    journalistEmail: text("journalist_email").notNull(),
    sourceStatus: sourceStatusEnum("source_status"),
    sourceQuote: text("source_quote"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.outletId, table.journalistId, table.searchedAt],
    }),
    index("idx_se_journalist").on(table.journalistId),
    index("idx_se_outlet").on(table.outletId),
  ]
);

// ==================== Type Exports ====================

export type PressJournalist = typeof pressJournalists.$inferSelect;
export type NewPressJournalist = typeof pressJournalists.$inferInsert;
export type OutletJournalist = typeof outletJournalists.$inferSelect;
export type NewOutletJournalist = typeof outletJournalists.$inferInsert;
export type CampaignOutletJournalist =
  typeof campaignOutletJournalists.$inferSelect;
export type NewCampaignOutletJournalist =
  typeof campaignOutletJournalists.$inferInsert;
export type HuntedIndividual = typeof huntedIndividuals.$inferSelect;
export type NewHuntedIndividual = typeof huntedIndividuals.$inferInsert;
export type HuntedEmail = typeof huntedEmails.$inferSelect;
export type NewHuntedEmail = typeof huntedEmails.$inferInsert;
export type SearchedEmail = typeof searchedEmails.$inferSelect;
export type NewSearchedEmail = typeof searchedEmails.$inferInsert;
