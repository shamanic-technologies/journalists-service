import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, BASE_AUTH_HEADERS } from "../helpers/test-app.js";
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
      .get("/journalists/list")
      .set(BASE_AUTH_HEADERS);

    expect(res.status).toBe(400);
  });

  it("returns empty list when no journalists match", async () => {
    // Mock email-gateway (won't be called but be safe)
    const res = await request(app)
      .get(`/journalists/list?brandId=${BRAND_ID}`)
      .set(BASE_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toEqual([]);
  });

  it("returns journalists for org+brand without enrichment when no emails or runs", async () => {
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
      .get(`/journalists/list?brandId=${BRAND_ID}`)
      .set(BASE_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    expect(res.body.journalists[0].journalistName).toBe("Alice Reporter");
    expect(res.body.journalists[0].emailStatus).toBeNull();
    expect(res.body.journalists[0].cost).toBeNull();
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
      .get(`/journalists/list?brandId=${BRAND_ID}`)
      .set(BASE_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    const j = res.body.journalists[0];
    expect(j.emailStatus).not.toBeNull();
    expect(j.emailStatus.broadcast.campaign.lead.contacted).toBe(true);
    expect(j.emailStatus.broadcast.campaign.lead.delivered).toBe(true);
    expect(j.emailStatus.broadcast.campaign.lead.replied).toBe(false);
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

    // No emails → no email-gateway call; costs call
    mockRunCosts([
      { runId: RUN_ID, totalCostInUsdCents: "100", actualCostInUsdCents: "80", provisionedCostInUsdCents: "20" },
    ]);

    const res = await request(app)
      .get(`/journalists/list?brandId=${BRAND_ID}`)
      .set(BASE_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
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
      .get(`/journalists/list?brandId=${BRAND_ID}&campaignId=${CAMPAIGN_ID}`)
      .set(BASE_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    expect(res.body.journalists[0].journalistName).toBe("Dan Alpha");
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

    // email-gateway fails
    mockFetch.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app)
      .get(`/journalists/list?brandId=${BRAND_ID}`)
      .set(BASE_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    expect(res.body.journalists[0].emailStatus).toBeNull();
  });

  it("distributes run costs across journalists sharing a run", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "J2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      runId: RUN_ID,
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      runId: RUN_ID,
    });

    mockRunCosts([
      { runId: RUN_ID, totalCostInUsdCents: "200", actualCostInUsdCents: "160", provisionedCostInUsdCents: "40" },
    ]);

    const res = await request(app)
      .get(`/journalists/list?brandId=${BRAND_ID}`)
      .set(BASE_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(2);
    for (const j of res.body.journalists) {
      expect(j.cost.totalCostInUsdCents).toBe(100);
      expect(j.cost.actualCostInUsdCents).toBe(80);
      expect(j.cost.provisionedCostInUsdCents).toBe(20);
      expect(j.cost.runCount).toBe(1);
    }
  });

  it("enriches both email status and costs together", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Full Enrichment",
      firstName: "Full",
      lastName: "Enrichment",
    });
    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "served",
      email: "full@example.com",
      runId: RUN_ID,
    });

    // email-gateway mock first, then runs-service mock
    mockEmailGatewayStatus([
      { leadId: journalist.id, email: "full@example.com", contacted: true, delivered: true, replied: true, replyClassification: "positive" },
    ]);
    mockRunCosts([
      { runId: RUN_ID, totalCostInUsdCents: "50", actualCostInUsdCents: "40", provisionedCostInUsdCents: "10" },
    ]);

    const res = await request(app)
      .get(`/journalists/list?brandId=${BRAND_ID}`)
      .set(BASE_AUTH_HEADERS);

    expect(res.status).toBe(200);
    const j = res.body.journalists[0];
    expect(j.emailStatus.broadcast.campaign.lead.replied).toBe(true);
    expect(j.emailStatus.broadcast.campaign.lead.replyClassification).toBe("positive");
    expect(j.cost.totalCostInUsdCents).toBe(50);
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
      .get(`/journalists/list?brandId=${BRAND_ID}`)
      .set(BASE_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(0);
  });
});
