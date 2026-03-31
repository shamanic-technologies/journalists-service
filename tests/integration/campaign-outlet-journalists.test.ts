import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  insertTestCampaignJournalist,
  closeDb,
} from "../helpers/test-db.js";

const app = createTestApp();

const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const OUTLET_ID_2 = "11111111-1111-1111-1111-222222222222";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const BRAND_ID = "44444444-4444-4444-4444-444444444444";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";
const CAMPAIGN_ID_2 = "55555555-5555-5555-5555-666666666666";

describe("GET /campaign-outlet-journalists", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("returns journalists for a campaign", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Alice Reporter" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Bob Writer" });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "85.00",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "60.00",
    });

    const res = await request(app)
      .get(`/campaign-outlet-journalists?campaign_id=${CAMPAIGN_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toHaveLength(2);
    expect(res.body.campaignJournalists[0]).toHaveProperty("journalistName");
    expect(res.body.campaignJournalists[0]).toHaveProperty("relevanceScore");
    expect(res.body.campaignJournalists[0]).toHaveProperty("journalistId");
    // Should return brandIds as array
    expect(res.body.campaignJournalists[0]).toHaveProperty("brandIds");
    expect(Array.isArray(res.body.campaignJournalists[0].brandIds)).toBe(true);
  });

  it("filters by outlet_id when provided", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Outlet1 Writer" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID_2, journalistName: "Outlet2 Writer" });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID_2,
    });

    const res = await request(app)
      .get(`/campaign-outlet-journalists?campaign_id=${CAMPAIGN_ID}&outlet_id=${OUTLET_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toHaveLength(1);
    expect(res.body.campaignJournalists[0].outletId).toBe(OUTLET_ID);
  });

  it("returns empty array for campaign with no journalists", async () => {
    const res = await request(app)
      .get(`/campaign-outlet-journalists?campaign_id=${CAMPAIGN_ID_2}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toEqual([]);
  });

  it("returns journalists for a brand across all campaigns", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Brand Reporter 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Brand Reporter 2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "90.00",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID_2,
      outletId: OUTLET_ID,
      relevanceScore: "70.00",
    });

    const res = await request(app)
      .get(`/campaign-outlet-journalists?brand_id=${BRAND_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toHaveLength(2);
    const names = res.body.campaignJournalists.map((j: any) => j.journalistName);
    expect(names).toContain("Brand Reporter 1");
    expect(names).toContain("Brand Reporter 2");
  });

  it("filters by brand_id matches multi-brand rows", async () => {
    const BRAND_ID_2 = "44444444-4444-4444-4444-555555555555";
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Multi Brand Reporter" });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID, BRAND_ID_2],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });

    const res = await request(app)
      .get(`/campaign-outlet-journalists?brand_id=${BRAND_ID_2}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toHaveLength(1);
    expect(res.body.campaignJournalists[0].brandIds).toEqual([BRAND_ID, BRAND_ID_2]);
  });

  it("filters by brand_id and outlet_id", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Brand Outlet1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID_2, journalistName: "Brand Outlet2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID_2,
    });

    const res = await request(app)
      .get(`/campaign-outlet-journalists?brand_id=${BRAND_ID}&outlet_id=${OUTLET_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toHaveLength(1);
    expect(res.body.campaignJournalists[0].outletId).toBe(OUTLET_ID);
  });

  it("returns 400 without campaign_id or brand_id", async () => {
    const res = await request(app)
      .get("/campaign-outlet-journalists")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(400);
  });

  it("returns 400 with only outlet_id (no campaign_id or brand_id)", async () => {
    const res = await request(app)
      .get(`/campaign-outlet-journalists?outlet_id=${OUTLET_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(400);
  });

  it("returns 400 with invalid campaign_id", async () => {
    const res = await request(app)
      .get("/campaign-outlet-journalists?campaign_id=not-a-uuid")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(400);
  });

  it("returns 400 with invalid brand_id", async () => {
    const res = await request(app)
      .get("/campaign-outlet-journalists?brand_id=not-a-uuid")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(400);
  });

  it("filters by run_id", async () => {
    const RUN_ID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const RUN_ID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Run A Reporter" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Run B Reporter" });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      runId: RUN_ID_A,
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      runId: RUN_ID_B,
    });

    const res = await request(app)
      .get(`/campaign-outlet-journalists?campaign_id=${CAMPAIGN_ID}&run_id=${RUN_ID_A}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toHaveLength(1);
    expect(res.body.campaignJournalists[0].journalistName).toBe("Run A Reporter");
    expect(res.body.campaignJournalists[0].runId).toBe(RUN_ID_A);
  });

  it("returns runId field in response", async () => {
    const RUN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "RunId Reporter" });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      runId: RUN_ID,
    });

    const res = await request(app)
      .get(`/campaign-outlet-journalists?campaign_id=${CAMPAIGN_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists[0]).toHaveProperty("runId", RUN_ID);
  });
});
