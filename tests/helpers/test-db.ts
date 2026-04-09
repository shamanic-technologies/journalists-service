import { db, sql } from "../../src/db/index.js";
import {
  journalists,
  campaignJournalists,
  discoveryCache,
  idempotencyCache,
  outletScrapeCache,
} from "../../src/db/schema.js";

export async function cleanTestData() {
  await db.delete(idempotencyCache);
  await db.delete(outletScrapeCache);
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
    apolloEmail?: string | null;
    apolloEmailStatus?: string | null;
    apolloPersonId?: string | null;
    apolloCheckedAt?: Date | null;
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
      apolloEmail: data.apolloEmail ?? null,
      apolloEmailStatus: data.apolloEmailStatus ?? null,
      apolloPersonId: data.apolloPersonId ?? null,
      apolloCheckedAt: data.apolloCheckedAt ?? null,
    })
    .returning();
  return journalist;
}

export async function insertTestCampaignJournalist(data: {
  journalistId: string;
  orgId: string;
  brandIds: string[];
  campaignId: string;
  outletId: string;
  relevanceScore?: string;
  whyRelevant?: string;
  whyNotRelevant?: string;
  articleUrls?: string[];
  featureSlug?: string;
  workflowSlug?: string;
  runId?: string;
  email?: string;
  apolloPersonId?: string;
  status?: "buffered" | "claimed" | "served" | "contacted" | "skipped";
  createdAt?: Date;
}) {
  const [row] = await db
    .insert(campaignJournalists)
    .values({
      journalistId: data.journalistId,
      orgId: data.orgId,
      brandIds: data.brandIds,
      campaignId: data.campaignId,
      outletId: data.outletId,
      relevanceScore: data.relevanceScore ?? "75.00",
      whyRelevant: data.whyRelevant ?? "Test relevance",
      whyNotRelevant: data.whyNotRelevant ?? "Test not relevant",
      articleUrls: data.articleUrls ?? [],
      featureSlug: data.featureSlug ?? null,
      workflowSlug: data.workflowSlug ?? null,
      runId: data.runId ?? null,
      email: data.email ?? null,
      apolloPersonId: data.apolloPersonId ?? null,
      status: data.status ?? "buffered",
      createdAt: data.createdAt ?? new Date(),
    })
    .returning();
  return row;
}

export async function closeDb() {
  await sql.end();
}
