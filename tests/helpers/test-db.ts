import { db, sql } from "../../src/db/index.js";
import {
  journalists,
  campaignJournalists,
  discoveryCache,
  idempotencyCache,
} from "../../src/db/schema.js";

export async function cleanTestData() {
  await db.delete(idempotencyCache);
  await db.delete(discoveryCache);
  await db.delete(campaignJournalists);
  await db.delete(journalists);
}

export async function insertTestJournalist(
  data: {
    outletId: string;
    entityType?: "individual" | "organization";
    journalistName?: string;
    firstName?: string;
    lastName?: string;
  }
) {
  const [journalist] = await db
    .insert(journalists)
    .values({
      outletId: data.outletId,
      entityType: data.entityType || "individual",
      journalistName:
        data.journalistName || `Test Journalist ${Date.now()}-${Math.random()}`,
      firstName: data.firstName || "Test",
      lastName: data.lastName || "Journalist",
    })
    .returning();
  return journalist;
}

export async function insertTestCampaignJournalist(data: {
  journalistId: string;
  orgId: string;
  brandId: string;
  campaignId: string;
  outletId: string;
  relevanceScore?: string;
  whyRelevant?: string;
  whyNotRelevant?: string;
  articleUrls?: string[];
  featureSlug?: string;
  workflowSlug?: string;
  status?: "buffered" | "claimed" | "served" | "contacted" | "skipped";
}) {
  const [row] = await db
    .insert(campaignJournalists)
    .values({
      journalistId: data.journalistId,
      orgId: data.orgId,
      brandId: data.brandId,
      campaignId: data.campaignId,
      outletId: data.outletId,
      relevanceScore: data.relevanceScore ?? "75.00",
      whyRelevant: data.whyRelevant ?? "Test relevance",
      whyNotRelevant: data.whyNotRelevant ?? "Test not relevant",
      articleUrls: data.articleUrls ?? [],
      featureSlug: data.featureSlug ?? null,
      workflowSlug: data.workflowSlug ?? null,
      status: data.status ?? "buffered",
    })
    .returning();
  return row;
}

export async function closeDb() {
  await sql.end();
}
