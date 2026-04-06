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

const mockFetch = vi.fn();
global.fetch = mockFetch;

const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const OUTLET_ID_2 = "11111111-1111-1111-1111-222222222222";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const BRAND_ID = "44444444-4444-4444-4444-444444444444";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";
const CAMPAIGN_ID_2 = "55555555-5555-5555-5555-666666666666";

function mockEmailGatewayStatusEmpty() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ results: [] }),
  });
}

function mockEmailGatewayStatusForJournalists(statuses: Array<{ leadId: string; email: string; contacted: boolean; delivered: boolean; replied: boolean; replyClassification: string | null }>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      results: statuses.map((r) => ({
        leadId: r.leadId,
        email: r.email,
        broadcast: {
          campaign: {
            contacted: r.contacted, delivered: r.delivered, opened: false, replied: r.replied, replyClassification: r.replyClassification, bounced: false, unsubscribed: false, lastDeliveredAt: r.delivered ? "2026-04-01T00:00:00Z" : null,
          },
          brand: null,
          global: { email: { bounced: false, unsubscribed: false } },
        },
        transactional: {
          campaign: null,
          brand: null,
          global: { email: { bounced: false, unsubscribed: false } },
        },
      })),
    }),
  });
}

describe("GET /campaign-outlet-journalists", () => {
  beforeEach(async () => {
    await cleanTestData();
    mockFetch.mockReset();
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
      .get(`/orgs/campaign-outlet-journalists?campaign_id=${CAMPAIGN_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toHaveLength(2);
    expect(res.body.campaignJournalists[0]).toHaveProperty("journalistName");
    expect(res.body.campaignJournalists[0]).toHaveProperty("relevanceScore");
    expect(res.body.campaignJournalists[0]).toHaveProperty("journalistId");
    // Should return brandIds as array
    expect(res.body.campaignJournalists[0]).toHaveProperty("brandIds");
    expect(Array.isArray(res.body.campaignJournalists[0].brandIds)).toBe(true);
    // Status triplet
    expect(res.body.campaignJournalists[0]).toHaveProperty("consolidatedStatus");
    expect(res.body.campaignJournalists[0]).toHaveProperty("localStatus");
    expect(res.body.campaignJournalists[0]).toHaveProperty("emailGatewayStatus");
    expect(res.body.campaignJournalists[0].emailGatewayStatus).toBeNull();
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
      .get(`/orgs/campaign-outlet-journalists?campaign_id=${CAMPAIGN_ID}&outlet_id=${OUTLET_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toHaveLength(1);
    expect(res.body.campaignJournalists[0].outletId).toBe(OUTLET_ID);
  });

  it("returns empty array for campaign with no journalists", async () => {
    const res = await request(app)
      .get(`/orgs/campaign-outlet-journalists?campaign_id=${CAMPAIGN_ID_2}`)
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
      .get(`/orgs/campaign-outlet-journalists?brand_id=${BRAND_ID}`)
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
      .get(`/orgs/campaign-outlet-journalists?brand_id=${BRAND_ID_2}`)
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
      .get(`/orgs/campaign-outlet-journalists?brand_id=${BRAND_ID}&outlet_id=${OUTLET_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toHaveLength(1);
    expect(res.body.campaignJournalists[0].outletId).toBe(OUTLET_ID);
  });

  it("returns 400 without campaign_id or brand_id", async () => {
    const res = await request(app)
      .get("/orgs/campaign-outlet-journalists")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(400);
  });

  it("returns 400 with only outlet_id (no campaign_id or brand_id)", async () => {
    const res = await request(app)
      .get(`/orgs/campaign-outlet-journalists?outlet_id=${OUTLET_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(400);
  });

  it("returns 400 with invalid campaign_id", async () => {
    const res = await request(app)
      .get("/orgs/campaign-outlet-journalists?campaign_id=not-a-uuid")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(400);
  });

  it("returns 400 with invalid brand_id", async () => {
    const res = await request(app)
      .get("/orgs/campaign-outlet-journalists?brand_id=not-a-uuid")
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
      .get(`/orgs/campaign-outlet-journalists?campaign_id=${CAMPAIGN_ID}&run_id=${RUN_ID_A}`)
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
      .get(`/orgs/campaign-outlet-journalists?campaign_id=${CAMPAIGN_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists[0]).toHaveProperty("runId", RUN_ID);
  });

  it("filters by feature_dynasty_slug — resolves dynasty to versioned slugs", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty Hit" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty Miss" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, featureSlug: "pr-outreach-v2",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, featureSlug: "cold-email-v1",
    });

    // Mock features-service dynasty resolution
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ slugs: ["pr-outreach-v1", "pr-outreach-v2"] }),
    });

    const res = await request(app)
      .get(`/orgs/campaign-outlet-journalists?brand_id=${BRAND_ID}&feature_dynasty_slug=pr-outreach`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toHaveLength(1);
    expect(res.body.campaignJournalists[0].journalistName).toBe("Dynasty Hit");
  });

  it("returns status triplet with email-gateway enrichment", async () => {
    const j1 = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Triplet Reporter",
      apolloEmail: "triplet@example.com",
    });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "served",
      email: "triplet@example.com",
    });

    mockEmailGatewayStatusForJournalists([
      { leadId: j1.id, email: "triplet@example.com", contacted: true, delivered: true, replied: false, replyClassification: null },
    ]);

    const res = await request(app)
      .get(`/orgs/campaign-outlet-journalists?campaign_id=${CAMPAIGN_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toHaveLength(1);
    const cj = res.body.campaignJournalists[0];
    expect(cj.localStatus).toBe("served");
    expect(cj.emailGatewayStatus).toBe("delivered");
    expect(cj.consolidatedStatus).toBe("delivered");
  });

  it("falls back gracefully when email-gateway fails", async () => {
    const j1 = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Fallback Reporter",
      apolloEmail: "fallback@example.com",
    });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "served",
      email: "fallback@example.com",
    });

    mockFetch.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app)
      .get(`/orgs/campaign-outlet-journalists?campaign_id=${CAMPAIGN_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toHaveLength(1);
    const cj = res.body.campaignJournalists[0];
    expect(cj.localStatus).toBe("served");
    expect(cj.emailGatewayStatus).toBeNull();
    expect(cj.consolidatedStatus).toBe("served");
  });

  it("returns empty array when dynasty slug resolves to no slugs", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "No Match" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, featureSlug: "some-feature",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ slugs: [] }),
    });

    const res = await request(app)
      .get(`/orgs/campaign-outlet-journalists?brand_id=${BRAND_ID}&feature_dynasty_slug=nonexistent`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.campaignJournalists).toHaveLength(0);
  });
});
