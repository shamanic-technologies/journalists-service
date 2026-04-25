import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  insertTestCampaignJournalist,
  closeDb,
} from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import { discoveryCache, campaignJournalists } from "../../src/db/schema.js";
import { eq, sql } from "drizzle-orm";

const app = createTestApp();

const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const OUTLET_ID_2 = "11111111-1111-1111-1111-222222222222";
const SOURCE_ORG_ID = "22222222-2222-2222-2222-222222222222";
const TARGET_ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THIRD_ORG_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const BRAND_ID = "44444444-4444-4444-4444-444444444444";
const TARGET_BRAND_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const OTHER_BRAND_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";
const CAMPAIGN_ID_2 = "55555555-5555-5555-5555-666666666666";

describe("POST /internal/transfer-brand", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("transfers solo-brand rows (no targetBrandId — org move only)", async () => {
    const j = await insertTestJournalist({ outletId: OUTLET_ID });
    await insertTestCampaignJournalist({
      journalistId: j.id,
      orgId: SOURCE_ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });
    await db.insert(discoveryCache).values({
      orgId: SOURCE_ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      discoveredAt: new Date(),
    });

    const res = await request(app)
      .post("/internal/transfer-brand")
      .set({ "x-api-key": AUTH_HEADERS["x-api-key"] })
      .send({ sourceBrandId: BRAND_ID, sourceOrgId: SOURCE_ORG_ID, targetOrgId: TARGET_ORG_ID });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([
      { tableName: "campaign_journalists", count: 1 },
      { tableName: "discovery_cache", count: 1 },
    ]);

    // brand_ids unchanged when no targetBrandId
    const cjRows = await db.select().from(campaignJournalists).where(eq(campaignJournalists.orgId, TARGET_ORG_ID));
    expect(cjRows).toHaveLength(1);
    expect(cjRows[0].brandIds).toEqual([BRAND_ID]);

    const dcRows = await db.select().from(discoveryCache).where(eq(discoveryCache.orgId, TARGET_ORG_ID));
    expect(dcRows).toHaveLength(1);
    expect(dcRows[0].brandIds).toEqual([BRAND_ID]);
  });

  it("rewrites brand_ids when targetBrandId is provided (conflict)", async () => {
    const j = await insertTestJournalist({ outletId: OUTLET_ID });
    await insertTestCampaignJournalist({
      journalistId: j.id,
      orgId: SOURCE_ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });
    await db.insert(discoveryCache).values({
      orgId: SOURCE_ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      discoveredAt: new Date(),
    });

    const res = await request(app)
      .post("/internal/transfer-brand")
      .set({ "x-api-key": AUTH_HEADERS["x-api-key"] })
      .send({
        sourceBrandId: BRAND_ID,
        sourceOrgId: SOURCE_ORG_ID,
        targetOrgId: TARGET_ORG_ID,
        targetBrandId: TARGET_BRAND_ID,
      });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([
      { tableName: "campaign_journalists", count: 1 },
      { tableName: "discovery_cache", count: 1 },
    ]);

    const cjRows = await db.select().from(campaignJournalists).where(eq(campaignJournalists.orgId, TARGET_ORG_ID));
    expect(cjRows).toHaveLength(1);
    expect(cjRows[0].brandIds).toEqual([TARGET_BRAND_ID]);

    const dcRows = await db.select().from(discoveryCache).where(eq(discoveryCache.orgId, TARGET_ORG_ID));
    expect(dcRows).toHaveLength(1);
    expect(dcRows[0].brandIds).toEqual([TARGET_BRAND_ID]);
  });

  it("step 2 rewrites brand_ids in OTHER orgs too (no org filter)", async () => {
    // Row in sourceOrg (will be moved + rewritten)
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: SOURCE_ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });

    // Row in a third org referencing the same sourceBrandId (should get brand rewritten but NOT moved)
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID_2, journalistName: "J2" });
    await insertTestCampaignJournalist({
      journalistId: j2.id,
      orgId: THIRD_ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID_2,
      outletId: OUTLET_ID_2,
    });

    const res = await request(app)
      .post("/internal/transfer-brand")
      .set({ "x-api-key": AUTH_HEADERS["x-api-key"] })
      .send({
        sourceBrandId: BRAND_ID,
        sourceOrgId: SOURCE_ORG_ID,
        targetOrgId: TARGET_ORG_ID,
        targetBrandId: TARGET_BRAND_ID,
      });

    expect(res.status).toBe(200);
    // Step 1 count only reflects sourceOrg rows
    expect(res.body.updatedTables[0].count).toBe(1);

    // sourceOrg row: moved to targetOrg + brand rewritten
    const cjTarget = await db.select().from(campaignJournalists).where(eq(campaignJournalists.orgId, TARGET_ORG_ID));
    expect(cjTarget).toHaveLength(1);
    expect(cjTarget[0].brandIds).toEqual([TARGET_BRAND_ID]);

    // thirdOrg row: stayed in thirdOrg but brand rewritten
    const cjThird = await db.select().from(campaignJournalists).where(eq(campaignJournalists.orgId, THIRD_ORG_ID));
    expect(cjThird).toHaveLength(1);
    expect(cjThird[0].brandIds).toEqual([TARGET_BRAND_ID]);
  });

  it("skips co-branding rows (multiple brand IDs)", async () => {
    const j = await insertTestJournalist({ outletId: OUTLET_ID });
    await insertTestCampaignJournalist({
      journalistId: j.id,
      orgId: SOURCE_ORG_ID,
      brandIds: [BRAND_ID, OTHER_BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });

    const res = await request(app)
      .post("/internal/transfer-brand")
      .set({ "x-api-key": AUTH_HEADERS["x-api-key"] })
      .send({ sourceBrandId: BRAND_ID, sourceOrgId: SOURCE_ORG_ID, targetOrgId: TARGET_ORG_ID });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([
      { tableName: "campaign_journalists", count: 0 },
      { tableName: "discovery_cache", count: 0 },
    ]);

    const cjRows = await db.select().from(campaignJournalists).where(eq(campaignJournalists.orgId, SOURCE_ORG_ID));
    expect(cjRows).toHaveLength(1);
  });

  it("skips rows with a different brand ID", async () => {
    const j = await insertTestJournalist({ outletId: OUTLET_ID });
    await insertTestCampaignJournalist({
      journalistId: j.id,
      orgId: SOURCE_ORG_ID,
      brandIds: [OTHER_BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });

    const res = await request(app)
      .post("/internal/transfer-brand")
      .set({ "x-api-key": AUTH_HEADERS["x-api-key"] })
      .send({ sourceBrandId: BRAND_ID, sourceOrgId: SOURCE_ORG_ID, targetOrgId: TARGET_ORG_ID });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([
      { tableName: "campaign_journalists", count: 0 },
      { tableName: "discovery_cache", count: 0 },
    ]);
  });

  it("is idempotent — second call is a no-op", async () => {
    const j = await insertTestJournalist({ outletId: OUTLET_ID });
    await insertTestCampaignJournalist({
      journalistId: j.id,
      orgId: SOURCE_ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });

    const payload = { sourceBrandId: BRAND_ID, sourceOrgId: SOURCE_ORG_ID, targetOrgId: TARGET_ORG_ID };

    const res1 = await request(app)
      .post("/internal/transfer-brand")
      .set({ "x-api-key": AUTH_HEADERS["x-api-key"] })
      .send(payload);
    expect(res1.body.updatedTables[0].count).toBe(1);

    const res2 = await request(app)
      .post("/internal/transfer-brand")
      .set({ "x-api-key": AUTH_HEADERS["x-api-key"] })
      .send(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.updatedTables).toEqual([
      { tableName: "campaign_journalists", count: 0 },
      { tableName: "discovery_cache", count: 0 },
    ]);
  });

  it("returns 400 for invalid body", async () => {
    const res = await request(app)
      .post("/internal/transfer-brand")
      .set({ "x-api-key": AUTH_HEADERS["x-api-key"] })
      .send({ sourceBrandId: "not-a-uuid" });

    expect(res.status).toBe(400);
  });

  it("returns 401 without API key", async () => {
    const res = await request(app)
      .post("/internal/transfer-brand")
      .send({ sourceBrandId: BRAND_ID, sourceOrgId: SOURCE_ORG_ID, targetOrgId: TARGET_ORG_ID });

    expect(res.status).toBe(401);
  });
});
