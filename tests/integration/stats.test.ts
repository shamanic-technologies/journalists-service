import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS, ORG_AUTH_HEADERS } from "../helpers/test-app.js";
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

function mockEmailGatewayStats(contacted = 0, delivered = 0, replied = 0, bounced = 0) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      broadcast: {
        emailsContacted: contacted,
        emailsSent: contacted,
        emailsDelivered: delivered,
        emailsOpened: 0,
        emailsClicked: 0,
        emailsReplied: replied,
        emailsBounced: bounced,
        repliesWillingToMeet: 0,
        repliesInterested: 0,
        repliesNotInterested: 0,
        repliesOutOfOffice: 0,
        repliesUnsubscribe: 0,
        recipients: contacted,
      },
    }),
  });
}

function mockEmailGatewayStatsGrouped(groups: Array<{ key: string; contacted: number; delivered?: number; replied?: number; bounced?: number }>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      groups: groups.map((g) => ({
        key: g.key,
        broadcast: {
          emailsContacted: g.contacted,
          emailsSent: g.contacted,
          emailsDelivered: g.delivered ?? 0,
          emailsOpened: 0,
          emailsClicked: 0,
          emailsReplied: g.replied ?? 0,
          emailsBounced: g.bounced ?? 0,
          repliesWillingToMeet: 0,
          repliesInterested: 0,
          repliesNotInterested: 0,
          repliesOutOfOffice: 0,
          repliesUnsubscribe: 0,
          recipients: g.contacted,
        },
      })),
    }),
  });
}

function mockEmailGatewayStatsFailure() {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 502 });
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

  it("returns total counts and byOutreachStatus", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Stats Writer 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Stats Writer 2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Stats Writer 3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-b", status: "served",
    });

    mockEmailGatewayStats(0);

    const res = await request(app)
      .get("/orgs/stats")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(3);
    expect(res.body.byOutreachStatus.buffered).toBe(1);
    expect(res.body.byOutreachStatus.served).toBe(2);
  });

  it("includes contacted from email-gateway in byOutreachStatus", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Contacted Writer 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Contacted Writer 2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Contacted Writer 3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, status: "buffered",
    });

    // Email-gateway reports 2 of the served journalists have been contacted
    mockEmailGatewayStats(2);

    const res = await request(app)
      .get("/orgs/stats")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(3);
    expect(res.body.byOutreachStatus.served).toBe(2);
    expect(res.body.byOutreachStatus.buffered).toBe(1);
    expect(res.body.byOutreachStatus.contacted).toBe(2);
  });

  it("omits contacted when email-gateway returns 0", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "No Contact" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, status: "served",
    });

    mockEmailGatewayStats(0);

    const res = await request(app)
      .get("/orgs/stats")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.byOutreachStatus.contacted).toBeUndefined();
  });

  it("fails open when email-gateway is unavailable", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Fail Open" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, status: "served",
    });

    mockEmailGatewayStatsFailure();

    const res = await request(app)
      .get("/orgs/stats")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(1);
    expect(res.body.byOutreachStatus.served).toBe(1);
    expect(res.body.byOutreachStatus.contacted).toBeUndefined();
  });

  it("filters by brandId (matches rows containing that brand in brand_ids array)", async () => {
    const BRAND_ID_2 = "44444444-4444-4444-4444-555555555555";
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Brand Filter 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Brand Filter 2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID_2], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });

    mockEmailGatewayStats(0);

    const res = await request(app)
      .get(`/orgs/stats?brandId=${BRAND_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(1);
  });

  it("filters by brandId matches multi-brand rows", async () => {
    const BRAND_ID_2 = "44444444-4444-4444-4444-555555555555";
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Multi Brand" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID, BRAND_ID_2], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });

    mockEmailGatewayStats(0);

    // Filter by first brand
    const res1 = await request(app)
      .get(`/orgs/stats?brandId=${BRAND_ID}`)
      .set(AUTH_HEADERS);
    expect(res1.body.totalJournalists).toBe(1);

    mockEmailGatewayStats(0);

    // Filter by second brand
    const res2 = await request(app)
      .get(`/orgs/stats?brandId=${BRAND_ID_2}`)
      .set(AUTH_HEADERS);
    expect(res2.body.totalJournalists).toBe(1);
  });

  it("filters by featureSlug", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Slug Filter 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Slug Filter 2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-b",
    });

    mockEmailGatewayStats(0);

    const res = await request(app)
      .get("/orgs/stats?featureSlug=feat-a")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(1);
  });

  it("filters by workflowSlug", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "WF Filter 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "WF Filter 2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-a",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-b",
    });

    mockEmailGatewayStats(0);

    const res = await request(app)
      .get("/orgs/stats?workflowSlug=wf-a")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(1);
  });

  it("filters by featureDynastySlug (resolves to versioned slugs)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty F1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty F2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty F3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-alpha",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-alpha-v2",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "other-feat",
    });

    mockDynastyResolution(["feat-alpha", "feat-alpha-v2"]);
    mockEmailGatewayStats(0);

    const res = await request(app)
      .get("/orgs/stats?featureDynastySlug=feat-alpha")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(2);
  });

  it("filters by workflowDynastySlug (resolves to versioned slugs)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty W1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty W2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "cold-email",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "cold-email-v2",
    });

    mockDynastyResolution(["cold-email", "cold-email-v2"]);
    mockEmailGatewayStats(0);

    const res = await request(app)
      .get("/orgs/stats?workflowDynastySlug=cold-email")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(2);
  });

  it("returns zero stats when dynasty resolves to empty list", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Empty Dynasty" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a",
    });

    mockDynastyResolution([]);
    // No email-gateway call expected: emptyStats() is returned early

    const res = await request(app)
      .get("/orgs/stats?featureDynastySlug=nonexistent")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(0);
    expect(res.body.byOutreachStatus).toEqual({});
  });

  it("combines dynasty filter with other filters", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Combo 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Combo 2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-alpha", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: "66666666-6666-6666-6666-666666666666",
      outletId: OUTLET_ID, featureSlug: "feat-alpha-v2", status: "buffered",
    });

    mockDynastyResolution(["feat-alpha", "feat-alpha-v2"]);
    mockEmailGatewayStats(0);

    const res = await request(app)
      .get(`/orgs/stats?featureDynastySlug=feat-alpha&campaignId=${CAMPAIGN_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(1);
    expect(res.body.byOutreachStatus.served).toBe(1);
  });

  it("groupBy featureSlug", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Group F1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Group F2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Group F3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-b", status: "served",
    });

    mockEmailGatewayStats(0);
    mockEmailGatewayStatsGrouped([]);

    const res = await request(app)
      .get("/orgs/stats?groupBy=featureSlug")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groupedBy["feat-a"].totalJournalists).toBe(2);
    expect(res.body.groupedBy["feat-a"].byOutreachStatus.buffered).toBe(1);
    expect(res.body.groupedBy["feat-a"].byOutreachStatus.served).toBe(1);
    expect(res.body.groupedBy["feat-b"].totalJournalists).toBe(1);
  });

  it("groupBy workflowSlug", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Group W1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Group W2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-a", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-b", status: "served",
    });

    mockEmailGatewayStats(0);
    mockEmailGatewayStatsGrouped([]);

    const res = await request(app)
      .get("/orgs/stats?groupBy=workflowSlug")
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
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-alpha", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-alpha-v2", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-beta", status: "served",
    });

    mockEmailGatewayStats(0);
    mockDynasties([
      { dynastySlug: "feat-alpha", slugs: ["feat-alpha", "feat-alpha-v2"] },
      { dynastySlug: "feat-beta", slugs: ["feat-beta"] },
    ]);
    mockEmailGatewayStatsGrouped([]);

    const res = await request(app)
      .get("/orgs/stats?groupBy=featureDynastySlug")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groupedBy["feat-alpha"].totalJournalists).toBe(2);
    expect(res.body.groupedBy["feat-alpha"].byOutreachStatus.buffered).toBe(1);
    expect(res.body.groupedBy["feat-alpha"].byOutreachStatus.served).toBe(1);
    expect(res.body.groupedBy["feat-beta"].totalJournalists).toBe(1);
  });

  it("groupBy workflowDynastySlug (aggregates versioned slugs under dynasty)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "DG W1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "DG W2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "DG W3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "cold-email", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "cold-email-v2", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "warm-intro", status: "served",
    });

    mockEmailGatewayStats(0);
    mockDynasties([
      { dynastySlug: "cold-email", slugs: ["cold-email", "cold-email-v2"] },
      { dynastySlug: "warm-intro", slugs: ["warm-intro"] },
    ]);
    mockEmailGatewayStatsGrouped([]);

    const res = await request(app)
      .get("/orgs/stats?groupBy=workflowDynastySlug")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groupedBy["cold-email"].totalJournalists).toBe(2);
    expect(res.body.groupedBy["warm-intro"].totalJournalists).toBe(1);
  });

  it("filters by workflowSlugs (comma-separated list)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "WfSlugs 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "WfSlugs 2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "WfSlugs 3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-a", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-b", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-c", status: "served",
    });

    mockEmailGatewayStats(1);

    const res = await request(app)
      .get("/orgs/stats?workflowSlugs=wf-a,wf-b")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(2);
    expect(res.body.byOutreachStatus.buffered).toBe(1);
    expect(res.body.byOutreachStatus.served).toBe(1);
    expect(res.body.byOutreachStatus.contacted).toBe(1);
  });

  it("filters by workflowSlugs with groupBy=workflowSlug", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "WfSlugsG 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "WfSlugsG 2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "WfSlugsG 3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-a", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-b", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, workflowSlug: "wf-c", status: "served",
    });

    mockEmailGatewayStats(0);
    mockEmailGatewayStatsGrouped([
      { key: "wf-a", contacted: 0 },
      { key: "wf-b", contacted: 3 },
    ]);

    const res = await request(app)
      .get("/orgs/stats?workflowSlugs=wf-a,wf-b&groupBy=workflowSlug")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(2);
    expect(res.body.groupedBy["wf-a"].totalJournalists).toBe(1);
    expect(res.body.groupedBy["wf-a"].byOutreachStatus.buffered).toBe(1);
    expect(res.body.groupedBy["wf-b"].totalJournalists).toBe(1);
    expect(res.body.groupedBy["wf-b"].byOutreachStatus.served).toBe(1);
    expect(res.body.groupedBy["wf-b"].byOutreachStatus.contacted).toBe(3);
    expect(res.body.groupedBy["wf-c"]).toBeUndefined();
  });

  it("filters by featureSlugs (comma-separated list)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "FeatSlugs 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "FeatSlugs 2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "FeatSlugs 3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "pr-journalist-outreach", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "pr-journalist-outreach-v2", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "unrelated-feature", status: "served",
    });

    mockEmailGatewayStats(1);

    const res = await request(app)
      .get("/orgs/stats?featureSlugs=pr-journalist-outreach,pr-journalist-outreach-v2")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(2);
    expect(res.body.byOutreachStatus.buffered).toBe(1);
    expect(res.body.byOutreachStatus.served).toBe(1);
    expect(res.body.byOutreachStatus.contacted).toBe(1);
  });

  it("filters by featureSlugs with groupBy=featureSlug", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "FeatSlugsG 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "FeatSlugsG 2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "FeatSlugsG 3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "pr-journalist-outreach", status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "pr-journalist-outreach-v2", status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "unrelated-feature", status: "served",
    });

    mockEmailGatewayStats(0);
    mockEmailGatewayStatsGrouped([
      { key: "pr-journalist-outreach", contacted: 0 },
      { key: "pr-journalist-outreach-v2", contacted: 2 },
    ]);

    const res = await request(app)
      .get("/orgs/stats?featureSlugs=pr-journalist-outreach,pr-journalist-outreach-v2&groupBy=featureSlug")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(2);
    expect(res.body.groupedBy["pr-journalist-outreach"].totalJournalists).toBe(1);
    expect(res.body.groupedBy["pr-journalist-outreach"].byOutreachStatus.buffered).toBe(1);
    expect(res.body.groupedBy["pr-journalist-outreach-v2"].totalJournalists).toBe(1);
    expect(res.body.groupedBy["pr-journalist-outreach-v2"].byOutreachStatus.served).toBe(1);
    expect(res.body.groupedBy["pr-journalist-outreach-v2"].byOutreachStatus.contacted).toBe(2);
    expect(res.body.groupedBy["unrelated-feature"]).toBeUndefined();
  });

  it("orphan slugs (not in any dynasty) fall back to raw slug value", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Orphan 1" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "orphan-slug", status: "served",
    });

    mockEmailGatewayStats(0);
    // Return dynasties that don't include "orphan-slug"
    mockDynasties([
      { dynastySlug: "feat-alpha", slugs: ["feat-alpha", "feat-alpha-v2"] },
    ]);
    mockEmailGatewayStatsGrouped([]);

    const res = await request(app)
      .get("/orgs/stats?groupBy=featureDynastySlug")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.groupedBy["orphan-slug"].totalJournalists).toBe(1);
  });
});

describe("GET /stats (base headers only — no workflow context)", () => {
  beforeEach(async () => {
    await cleanTestData();
    mockFetch.mockReset();
  });

  it("returns stats with only base auth headers (no workflow headers)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Base Stats 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Base Stats 2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, status: "served",
    });

    mockEmailGatewayStats(0);

    const res = await request(app)
      .get(`/orgs/stats?campaignId=${CAMPAIGN_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(2);
    expect(res.body.byOutreachStatus.buffered).toBe(1);
    expect(res.body.byOutreachStatus.served).toBe(1);
  });

  it("rejects when base headers are missing", async () => {
    const res = await request(app)
      .get("/orgs/stats")
      .set({ "x-api-key": "test-api-key" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-org-id");
  });
});

describe("GET /public/stats", () => {
  beforeEach(async () => {
    await cleanTestData();
    mockFetch.mockReset();
  });

  it("works with API key only (no identity headers)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Public Stats" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, status: "served",
    });

    mockEmailGatewayStats(0);

    const res = await request(app)
      .get("/public/stats")
      .set({ "x-api-key": "test-api-key" });

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(1);
  });

  it("supports filters same as private endpoint", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Public Filter 1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Public Filter 2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-a",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID, featureSlug: "feat-b",
    });

    mockEmailGatewayStats(0);

    const res = await request(app)
      .get("/public/stats?featureSlug=feat-a")
      .set({ "x-api-key": "test-api-key" });

    expect(res.status).toBe(200);
    expect(res.body.totalJournalists).toBe(1);
  });
});
