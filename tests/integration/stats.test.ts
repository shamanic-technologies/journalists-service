import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
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
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const BRAND_ID = "44444444-4444-4444-4444-444444444444";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";

// Mock fetch for dynasty resolution calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockDynastyResolution(slugs: string[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ slugs }),
  });
}

function mockDynasties(dynasties: { dynastySlug: string; slugs: string[] }[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ dynasties }),
  });
}

afterAll(async () => {
  await cleanTestData();
  await closeDb();
});

describe("GET /stats", () => {
  beforeEach(async () => {
    await cleanTestData();
    mockFetch.mockReset();
  });

  it("returns total counts and byStatus", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Stats Writer 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Stats Writer 2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Stats Writer 3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-b", status: "served",
    });

    const res = await request(app)
      .get("/stats")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(3);
    expect(res.body.byStatus.buffered).toBe(1);
    expect(res.body.byStatus.served).toBe(2);
  });

  it("filters by featureSlug", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Slug Filter 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Slug Filter 2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-b",
    });

    const res = await request(app)
      .get("/stats?featureSlug=feat-a")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(1);
  });

  it("filters by workflowSlug", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "WF Filter 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "WF Filter 2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-a",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-b",
    });

    const res = await request(app)
      .get("/stats?workflowSlug=wf-a")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(1);
  });

  it("filters by featureDynastySlug (resolves to versioned slugs)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty F1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty F2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty F3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-alpha",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-alpha-v2",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "other-feat",
    });

    mockDynastyResolution(["feat-alpha", "feat-alpha-v2"]);

    const res = await request(app)
      .get("/stats?featureDynastySlug=feat-alpha")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(2);
  });

  it("filters by workflowDynastySlug (resolves to versioned slugs)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty W1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty W2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "cold-email",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "cold-email-v2",
    });

    mockDynastyResolution(["cold-email", "cold-email-v2"]);

    const res = await request(app)
      .get("/stats?workflowDynastySlug=cold-email")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(2);
  });

  it("returns zero stats when dynasty resolves to empty list", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Empty Dynasty" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a",
    });

    mockDynastyResolution([]);

    const res = await request(app)
      .get("/stats?featureDynastySlug=nonexistent")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(0);
    expect(res.body.byStatus).toEqual({});
  });

  it("combines dynasty filter with other filters", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Combo 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Combo 2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-alpha", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: "66666666-6666-6666-6666-666666666666",
      outletId: OUTLET_ID, featureSlug: "feat-alpha-v2", status: "buffered",
    });

    mockDynastyResolution(["feat-alpha", "feat-alpha-v2"]);

    const res = await request(app)
      .get(`/stats?featureDynastySlug=feat-alpha&campaignId=${CAMPAIGN_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(1);
    expect(res.body.byStatus.served).toBe(1);
  });

  it("groupBy featureSlug", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Group F1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Group F2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Group F3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-b", status: "served",
    });

    const res = await request(app)
      .get("/stats?groupBy=featureSlug")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groupedBy["feat-a"].totalJournalists).toBe(2);
    expect(res.body.groupedBy["feat-a"].byStatus.buffered).toBe(1);
    expect(res.body.groupedBy["feat-a"].byStatus.served).toBe(1);
    expect(res.body.groupedBy["feat-b"].totalJournalists).toBe(1);
  });

  it("groupBy workflowSlug", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Group W1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Group W2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-a", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-b", status: "served",
    });

    const res = await request(app)
      .get("/stats?groupBy=workflowSlug")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groupedBy["wf-a"].totalJournalists).toBe(1);
    expect(res.body.groupedBy["wf-b"].totalJournalists).toBe(1);
  });

  it("groupBy featureDynastySlug (aggregates versioned slugs under dynasty)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "DG F1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "DG F2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "DG F3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-alpha", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-alpha-v2", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-beta", status: "served",
    });

    mockDynasties([
      { dynastySlug: "feat-alpha", slugs: ["feat-alpha", "feat-alpha-v2"] },
      { dynastySlug: "feat-beta", slugs: ["feat-beta"] },
    ]);

    const res = await request(app)
      .get("/stats?groupBy=featureDynastySlug")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groupedBy["feat-alpha"].totalJournalists).toBe(2);
    expect(res.body.groupedBy["feat-alpha"].byStatus.buffered).toBe(1);
    expect(res.body.groupedBy["feat-alpha"].byStatus.served).toBe(1);
    expect(res.body.groupedBy["feat-beta"].totalJournalists).toBe(1);
  });

  it("groupBy workflowDynastySlug (aggregates versioned slugs under dynasty)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "DG W1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "DG W2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "DG W3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "cold-email", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "cold-email-v2", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "warm-intro", status: "served",
    });

    mockDynasties([
      { dynastySlug: "cold-email", slugs: ["cold-email", "cold-email-v2"] },
      { dynastySlug: "warm-intro", slugs: ["warm-intro"] },
    ]);

    const res = await request(app)
      .get("/stats?groupBy=workflowDynastySlug")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groupedBy["cold-email"].totalJournalists).toBe(2);
    expect(res.body.groupedBy["warm-intro"].totalJournalists).toBe(1);
  });

  it("orphan slugs (not in any dynasty) fall back to raw slug value", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Orphan 1" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "orphan-slug", status: "served",
    });

    // Return dynasties that don't include "orphan-slug"
    mockDynasties([
      { dynastySlug: "feat-alpha", slugs: ["feat-alpha", "feat-alpha-v2"] },
    ]);

    const res = await request(app)
      .get("/stats?groupBy=featureDynastySlug")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groupedBy["orphan-slug"].totalJournalists).toBe(1);
  });
});

describe("GET /stats/public", () => {
  beforeEach(async () => {
    await cleanTestData();
    mockFetch.mockReset();
  });

  it("works with API key only (no identity headers)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Public Stats" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, status: "served",
    });

    const res = await request(app)
      .get("/stats/public")
      .set({ "x-api-key": "test-api-key" });

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(1);
  });

  it("supports filters same as private endpoint", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Public Filter 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Public Filter 2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-b",
    });

    const res = await request(app)
      .get("/stats/public?featureSlug=feat-a")
      .set({ "x-api-key": "test-api-key" });

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(1);
  });
});
