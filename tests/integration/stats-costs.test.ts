import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS, BASE_AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  insertTestCampaignJournalist,
  closeDb,
} from "../helpers/test-db.js";

const app = createTestApp();

const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const BRAND_ID = "44444444-4444-4444-4444-444444444444";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";
const RUN_ID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const RUN_ID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockBatchRunCosts(costs: Array<{
  runId: string;
  totalCostInUsdCents: string;
  actualCostInUsdCents: string;
  provisionedCostInUsdCents: string;
}>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ costs }),
  });
}

function mockBatchRunCostsFailure() {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 502,
    text: async () => "Service unavailable",
  });
}

afterAll(async () => {
  await cleanTestData();
  await closeDb();
});

describe("GET /journalists/stats/costs", () => {
  beforeEach(async () => {
    await cleanTestData();
    mockFetch.mockReset();
  });

  it("requires brandId query param", async () => {
    const res = await request(app)
      .get("/journalists/stats/costs")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(400);
  });

  it("returns empty groups when no journalists exist", async () => {
    const res = await request(app)
      .get(`/journalists/stats/costs?brandId=${BRAND_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual([]);
  });

  it("returns flat totals without groupBy", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Cost J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Cost J2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_A,
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_A,
    });

    mockBatchRunCosts([
      { runId: RUN_ID_A, totalCostInUsdCents: "1000", actualCostInUsdCents: "800", provisionedCostInUsdCents: "200" },
    ]);

    const res = await request(app)
      .get(`/journalists/stats/costs?brandId=${BRAND_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].totalCostInUsdCents).toBe(1000);
    expect(res.body.groups[0].actualCostInUsdCents).toBe(800);
    expect(res.body.groups[0].provisionedCostInUsdCents).toBe(200);
    expect(res.body.groups[0].runCount).toBe(1);
  });

  it("matches multi-brand rows when filtering by brandId", async () => {
    const BRAND_ID_2 = "44444444-4444-4444-4444-555555555555";
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Multi Brand Cost" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID, BRAND_ID_2], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_A,
    });

    mockBatchRunCosts([
      { runId: RUN_ID_A, totalCostInUsdCents: "500", actualCostInUsdCents: "500", provisionedCostInUsdCents: "0" },
    ]);

    const res = await request(app)
      .get(`/journalists/stats/costs?brandId=${BRAND_ID_2}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].totalCostInUsdCents).toBe(500);
  });

  it("aggregates costs across multiple runs without groupBy", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Multi Run J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Multi Run J2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_A,
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_B,
    });

    mockBatchRunCosts([
      { runId: RUN_ID_A, totalCostInUsdCents: "1000", actualCostInUsdCents: "600", provisionedCostInUsdCents: "400" },
      { runId: RUN_ID_B, totalCostInUsdCents: "500", actualCostInUsdCents: "500", provisionedCostInUsdCents: "0" },
    ]);

    const res = await request(app)
      .get(`/journalists/stats/costs?brandId=${BRAND_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groups[0].totalCostInUsdCents).toBe(1500);
    expect(res.body.groups[0].runCount).toBe(2);
  });

  it("distributes cost per journalist with groupBy=journalistId", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Grouped J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Grouped J2" });

    // Both created by the same run — cost should be split 50/50
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_A,
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_A,
    });

    mockBatchRunCosts([
      { runId: RUN_ID_A, totalCostInUsdCents: "1000", actualCostInUsdCents: "800", provisionedCostInUsdCents: "200" },
    ]);

    const res = await request(app)
      .get(`/journalists/stats/costs?brandId=${BRAND_ID}&groupBy=journalistId`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(2);

    const g1 = res.body.groups.find((g: any) => g.dimensions.journalistId === j1.id);
    const g2 = res.body.groups.find((g: any) => g.dimensions.journalistId === j2.id);

    expect(g1.totalCostInUsdCents).toBe(500);
    expect(g1.actualCostInUsdCents).toBe(400);
    expect(g1.provisionedCostInUsdCents).toBe(100);
    expect(g1.runCount).toBe(1);

    expect(g2.totalCostInUsdCents).toBe(500);
    expect(g2.runCount).toBe(1);
  });

  it("filters by campaignId", async () => {
    const OTHER_CAMPAIGN = "66666666-6666-6666-6666-666666666666";
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Campaign Filter J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Campaign Filter J2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_A,
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: OTHER_CAMPAIGN,
      outletId: OUTLET_ID, runId: RUN_ID_B,
    });

    mockBatchRunCosts([
      { runId: RUN_ID_A, totalCostInUsdCents: "1000", actualCostInUsdCents: "1000", provisionedCostInUsdCents: "0" },
    ]);

    const res = await request(app)
      .get(`/journalists/stats/costs?brandId=${BRAND_ID}&campaignId=${CAMPAIGN_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].totalCostInUsdCents).toBe(1000);
    expect(res.body.groups[0].runCount).toBe(1);
  });

  it("scopes to requesting org (ignores other orgs' journalists)", async () => {
    const OTHER_ORG = "77777777-7777-7777-7777-777777777777";
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Org Scope J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Org Scope J2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_A,
    });
    // Different org — same brand, same journalist entity but different campaign_journalist row
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: OTHER_ORG, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_B,
    });

    mockBatchRunCosts([
      { runId: RUN_ID_A, totalCostInUsdCents: "500", actualCostInUsdCents: "500", provisionedCostInUsdCents: "0" },
    ]);

    const res = await request(app)
      .get(`/journalists/stats/costs?brandId=${BRAND_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    // Should only see RUN_ID_A (our org), not RUN_ID_B (other org)
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].totalCostInUsdCents).toBe(500);
    expect(res.body.groups[0].runCount).toBe(1);
  });

  it("skips journalists without runId", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Has Run" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "No Run" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_A,
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      // no runId
    });

    mockBatchRunCosts([
      { runId: RUN_ID_A, totalCostInUsdCents: "300", actualCostInUsdCents: "300", provisionedCostInUsdCents: "0" },
    ]);

    const res = await request(app)
      .get(`/journalists/stats/costs?brandId=${BRAND_ID}&groupBy=journalistId`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    // Only j1 should appear (j2 has no runId)
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].dimensions.journalistId).toBe(j1.id);
  });

  it("returns 500 when runs-service fails", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Fail J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_A,
    });

    mockBatchRunCostsFailure();

    const res = await request(app)
      .get(`/journalists/stats/costs?brandId=${BRAND_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(500);
  });

  it("works with base auth headers only (no workflow context)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Base Cost J1" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_A,
    });

    mockBatchRunCosts([
      { runId: RUN_ID_A, totalCostInUsdCents: "500", actualCostInUsdCents: "500", provisionedCostInUsdCents: "0" },
    ]);

    const res = await request(app)
      .get(`/journalists/stats/costs?brandId=${BRAND_ID}`)
      .set(BASE_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].totalCostInUsdCents).toBe(500);
  });

  it("handles run not returned by batch endpoint (omitted)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Missing Run J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, runId: RUN_ID_A,
    });

    // runs-service returns empty costs (run not found)
    mockBatchRunCosts([]);

    const res = await request(app)
      .get(`/journalists/stats/costs?brandId=${BRAND_ID}&groupBy=journalistId`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    // No costs to distribute, so no groups
    expect(res.body.groups).toEqual([]);
  });
});
