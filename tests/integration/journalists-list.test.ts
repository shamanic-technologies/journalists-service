import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, ORG_AUTH_HEADERS } from "../helpers/test-app.js";
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
const CAMPAIGN_ID_2 = "55555555-5555-5555-5555-555555555556";
const RUN_ID = "99999999-9999-9999-9999-999999999999";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockEmailGatewayStatus(results: Array<{ leadId: string; email: string; contacted: boolean; delivered: boolean; replied: boolean; replyClassification: string | null }>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      results: results.map((r) => ({
        leadId: r.leadId,
        email: r.email,
        broadcast: {
          campaign: {
            lead: { contacted: r.contacted, delivered: r.delivered, replied: r.replied, replyClassification: r.replyClassification, lastDeliveredAt: r.delivered ? "2026-04-01T00:00:00Z" : null },
            email: { contacted: r.contacted, delivered: r.delivered, bounced: false, unsubscribed: false, lastDeliveredAt: r.delivered ? "2026-04-01T00:00:00Z" : null },
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

function mockRunCosts(costs: Array<{ runId: string; totalCostInUsdCents: string; actualCostInUsdCents: string; provisionedCostInUsdCents: string }>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ costs }),
  });
}

afterAll(async () => {
  await cleanTestData();
  await closeDb();
});

describe("GET /journalists/list", () => {
  beforeEach(async () => {
    await cleanTestData();
    mockFetch.mockReset();
  });

  it("returns 400 when brandId is missing", async () => {
    const res = await request(app)
      .get("/orgs/journalists/list")
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(400);
  });

  it("returns empty list when no journalists match", async () => {
    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toEqual([]);
  });

  it("returns grouped journalist with campaigns array", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Alice Reporter",
      firstName: "Alice",
      lastName: "Reporter",
    });
    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "buffered",
    });

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    const j = res.body.journalists[0];
    expect(j.journalistId).toBe(journalist.id);
    expect(j.journalistName).toBe("Alice Reporter");
    expect(j.emailStatus).toBeNull();
    expect(j.cost).toBeNull();
    expect(j.campaigns).toHaveLength(1);
    expect(j.campaigns[0].campaignId).toBe(CAMPAIGN_ID);
    expect(j.campaigns[0].consolidatedStatus).toBe("buffered");
    expect(j.campaigns[0].localStatus).toBe("buffered");
    expect(j.campaigns[0].emailGatewayStatus).toBeNull();
  });

  it("groups multiple campaigns under one journalist", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Samantha McLean",
      firstName: "Samantha",
      lastName: "McLean",
    });

    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID_2,
      outletId: OUTLET_ID,
      status: "served",
      email: "samantha@example.com",
    });

    // email-gateway for the campaign email
    mockEmailGatewayStatus([
      { leadId: journalist.id, email: "samantha@example.com", contacted: true, delivered: true, replied: false, replyClassification: null },
    ]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    // ONE journalist entry with TWO campaigns
    expect(res.body.journalists).toHaveLength(1);
    const j = res.body.journalists[0];
    expect(j.journalistName).toBe("Samantha McLean");
    expect(j.campaigns).toHaveLength(2);
    const localStatuses = j.campaigns.map((c: { localStatus: string }) => c.localStatus).sort();
    expect(localStatuses).toEqual(["buffered", "served"]);
    // The "served" campaign should be consolidated to "delivered" (email-gateway says contacted+delivered)
    const servedCampaign = j.campaigns.find((c: { localStatus: string }) => c.localStatus === "served");
    expect(servedCampaign.consolidatedStatus).toBe("delivered");
    expect(servedCampaign.emailGatewayStatus).toBe("delivered");
  });

  it("uses apollo_email from journalists table as global email", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Bob Writer",
      firstName: "Bob",
      lastName: "Writer",
      apolloEmail: "bob@global.com",
    });
    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "served",
      email: "bob@campaign.com",
    });

    mockEmailGatewayStatus([
      { leadId: journalist.id, email: "bob@global.com", contacted: true, delivered: true, replied: false, replyClassification: null },
    ]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    const j = res.body.journalists[0];
    // Global email from journalists table takes priority
    expect(j.email).toBe("bob@global.com");
    // Campaign-level email is still in the campaigns array
    expect(j.campaigns[0].email).toBe("bob@campaign.com");
  });

  it("consolidates status from email-gateway: served → contacted/delivered/replied", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Status Triplet Test",
      firstName: "Status",
      lastName: "Triplet",
    });
    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "served",
      email: "status@example.com",
    });

    mockEmailGatewayStatus([
      { leadId: journalist.id, email: "status@example.com", contacted: true, delivered: true, replied: true, replyClassification: "positive" },
    ]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    const j = res.body.journalists[0];
    const c = j.campaigns[0];
    expect(c.localStatus).toBe("served");
    expect(c.emailGatewayStatus).toBe("replied");
    expect(c.consolidatedStatus).toBe("replied");
  });

  it("keeps localStatus as consolidatedStatus when no email-gateway data", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "No Gateway",
    });
    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "buffered",
    });

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    const c = res.body.journalists[0].campaigns[0];
    expect(c.consolidatedStatus).toBe("buffered");
    expect(c.localStatus).toBe("buffered");
    expect(c.emailGatewayStatus).toBeNull();
  });

  it("enriches with email statuses from email-gateway", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Bob Writer",
      firstName: "Bob",
      lastName: "Writer",
    });
    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "served",
      email: "bob@example.com",
    });

    mockEmailGatewayStatus([
      { leadId: journalist.id, email: "bob@example.com", contacted: true, delivered: true, replied: false, replyClassification: null },
    ]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    const j = res.body.journalists[0];
    expect(j.emailStatus).not.toBeNull();
    expect(j.emailStatus.broadcast.campaign.lead.contacted).toBe(true);
  });

  it("enriches with costs from runs-service", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Carol Editor",
      firstName: "Carol",
      lastName: "Editor",
    });
    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "buffered",
      runId: RUN_ID,
    });

    mockRunCosts([
      { runId: RUN_ID, totalCostInUsdCents: "100", actualCostInUsdCents: "80", provisionedCostInUsdCents: "20" },
    ]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    const j = res.body.journalists[0];
    expect(j.cost).toEqual({
      totalCostInUsdCents: 100,
      actualCostInUsdCents: 80,
      provisionedCostInUsdCents: 20,
      runCount: 1,
    });
  });

  it("filters by campaignId when provided", async () => {
    const journalist1 = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Dan Alpha",
    });
    const journalist2 = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Eve Beta",
    });
    await insertTestCampaignJournalist({
      journalistId: journalist1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });
    await insertTestCampaignJournalist({
      journalistId: journalist2.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID_2,
      outletId: OUTLET_ID,
    });

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}&campaignId=${CAMPAIGN_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    expect(res.body.journalists[0].journalistName).toBe("Dan Alpha");
  });

  it("filters by featureSlugs (CSV)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Feat A" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Feat B" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Feat C" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, featureSlug: "pr-outreach",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, featureSlug: "cold-email",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, featureSlug: "warm-intro",
    });

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}&featureSlugs=pr-outreach,cold-email`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(2);
    const names = res.body.journalists.map((j: { journalistName: string }) => j.journalistName).sort();
    expect(names).toEqual(["Feat A", "Feat B"]);
  });

  it("filters by workflowSlug", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "WF A" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "WF B" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, workflowSlug: "pitch-v1",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, workflowSlug: "pitch-v2",
    });

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}&workflowSlug=pitch-v1`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    expect(res.body.journalists[0].journalistName).toBe("WF A");
  });

  it("continues without email statuses when email-gateway fails", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Frank Fail",
      firstName: "Frank",
      lastName: "Fail",
    });
    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "served",
      email: "frank@example.com",
    });

    mockFetch.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    expect(res.body.journalists[0].emailStatus).toBeNull();
  });

  it("distributes run costs across journalists sharing a run", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "J2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, runId: RUN_ID,
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, runId: RUN_ID,
    });

    mockRunCosts([
      { runId: RUN_ID, totalCostInUsdCents: "200", actualCostInUsdCents: "160", provisionedCostInUsdCents: "40" },
    ]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(2);
    for (const j of res.body.journalists) {
      expect(j.cost.totalCostInUsdCents).toBe(100);
      expect(j.cost.actualCostInUsdCents).toBe(80);
      expect(j.cost.provisionedCostInUsdCents).toBe(20);
      expect(j.cost.runCount).toBe(1);
    }
  });

  it("filters by featureDynastySlug — resolves dynasty to versioned slugs", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty A" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Dynasty B" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, featureSlug: "pr-outreach-v1",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, featureSlug: "cold-email-v1",
    });

    // Mock features-service dynasty resolution: "pr-outreach" -> ["pr-outreach-v1", "pr-outreach-v2"]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ slugs: ["pr-outreach-v1", "pr-outreach-v2"] }),
    });

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}&featureDynastySlug=pr-outreach`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    expect(res.body.journalists[0].journalistName).toBe("Dynasty A");
  });

  it("returns empty list when dynasty slug resolves to no versioned slugs", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Orphan" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, featureSlug: "some-feature",
    });

    // Mock features-service returning empty slugs for unknown dynasty
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ slugs: [] }),
    });

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}&featureDynastySlug=nonexistent-dynasty`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(0);
  });

  it("featureDynastySlug takes priority over featureSlugs", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Priority A" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Priority B" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, featureSlug: "pr-outreach-v1",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, featureSlug: "cold-email-v1",
    });

    // Dynasty resolves to pr-outreach-v1 only
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ slugs: ["pr-outreach-v1"] }),
    });

    // Both featureSlugs and featureDynastySlug provided — dynasty wins
    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}&featureDynastySlug=pr-outreach&featureSlugs=cold-email-v1`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    expect(res.body.journalists[0].journalistName).toBe("Priority A");
  });

  it("scopes by orgId from headers — does not return other org's journalists", async () => {
    const journalist = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Other Org" });
    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // different org
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
    });

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(0);
  });
});
