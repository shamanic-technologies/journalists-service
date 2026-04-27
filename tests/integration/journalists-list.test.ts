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

function mockEmailGatewayCampaignStatus(results: Array<{ email: string; contacted: boolean; delivered: boolean; replied: boolean; replyClassification: string | null }>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      results: results.map((r) => ({
        email: r.email,
        broadcast: {
          campaign: {
            contacted: r.contacted, sent: r.contacted, delivered: r.delivered, opened: false, clicked: false, replied: r.replied, replyClassification: r.replyClassification, bounced: false, unsubscribed: false, lastDeliveredAt: r.delivered ? "2026-04-01T00:00:00Z" : null,
          },
          brand: null,
          byCampaign: null,
          global: { email: { bounced: false, unsubscribed: false } },
        },
        transactional: {
          campaign: null,
          brand: null,
          byCampaign: null,
          global: { email: { bounced: false, unsubscribed: false } },
        },
      })),
    }),
  });
}

function mockEmailGatewayBrandStatus(results: Array<{
  email: string;
  contacted: boolean;
  delivered: boolean;
  replied: boolean;
  replyClassification: string | null;
  byCampaign?: Record<string, { contacted: boolean; delivered: boolean; replied: boolean; replyClassification: string | null }>;
}>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      results: results.map((r) => ({
        email: r.email,
        broadcast: {
          campaign: null,
          brand: {
            contacted: r.contacted, sent: r.contacted, delivered: r.delivered, opened: false, clicked: false, replied: r.replied, replyClassification: r.replyClassification, bounced: false, unsubscribed: false, lastDeliveredAt: r.delivered ? "2026-04-01T00:00:00Z" : null,
          },
          byCampaign: r.byCampaign ? Object.fromEntries(Object.entries(r.byCampaign).map(([k, v]) => [k, {
            contacted: v.contacted, sent: v.contacted, delivered: v.delivered, opened: false, clicked: false, replied: v.replied, replyClassification: v.replyClassification, bounced: false, unsubscribed: false, lastDeliveredAt: v.delivered ? "2026-04-01T00:00:00Z" : null,
          }])) : null,
          global: { email: { bounced: false, unsubscribed: false } },
        },
        transactional: {
          campaign: null,
          brand: null,
          byCampaign: null,
          global: { email: { bounced: false, unsubscribed: false } },
        },
      })),
    }),
  });
}

function mockOutletsService(outlets: Array<{ id: string; outletName: string; outletDomain: string }>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ outlets }),
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
    expect(res.body.total).toBe(0);
    expect(res.body.byOutreachStatus).toEqual({});
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

    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    const j = res.body.journalists[0];
    expect(j.journalistId).toBe(journalist.id);
    expect(j.journalistName).toBe("Alice Reporter");
    expect(j.global).toBeNull();
    expect(j.cost).toBeNull();
    // Brand mode: brand status present
    expect(j.brand).toBeDefined();
    expect(j.brand.buffered).toBe(true);
    expect(j.brand.claimed).toBe(false);
    expect(j.campaigns).toHaveLength(1);
    expect(j.campaigns[0].campaignId).toBe(CAMPAIGN_ID);
  });

  it("groups multiple campaigns under one journalist with per-campaign outreach status", async () => {
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

    // Brand mode: email-gateway returns brand scope + byCampaign breakdown
    // Only CAMPAIGN_ID_2 has email-gateway data (it was the one that sent email)
    mockEmailGatewayBrandStatus([{
      email: "samantha@example.com",
      contacted: true, delivered: true, replied: false, replyClassification: null,
      byCampaign: {
        [CAMPAIGN_ID_2]: { contacted: true, delivered: true, replied: false, replyClassification: null },
      },
    }]);
    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    const j = res.body.journalists[0];
    expect(j.journalistName).toBe("Samantha McLean");
    // Brand mode: brand-level status from best DB status + brand scope
    expect(j.brand.delivered).toBe(true);
    expect(j.brand.contacted).toBe(true);
    expect(j.campaigns).toHaveLength(2);
    // Per-campaign breakdown via byCampaign
    expect(j.byCampaign).toBeDefined();
    expect(j.byCampaign[CAMPAIGN_ID_2].delivered).toBe(true);
    expect(j.byCampaign[CAMPAIGN_ID_2].contacted).toBe(true);
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

    mockEmailGatewayBrandStatus([
      { email: "bob@global.com", contacted: true, delivered: true, replied: false, replyClassification: null },
    ]);
    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);

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

    mockEmailGatewayBrandStatus([
      { email: "status@example.com", contacted: true, delivered: true, replied: true, replyClassification: "positive" },
    ]);
    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    const j = res.body.journalists[0];
    expect(j.brand.replied).toBe(true);
    expect(j.brand.replyClassification).toBe("positive");
  });

  it("falls back to brand scope when campaign scope is null (no campaignId filter)", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Brand Scope Fallback",
      apolloEmail: "brand-fallback@example.com",
    });
    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "served",
    });

    // email-gateway returns campaign: null, brand: { contacted: true }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{
          email: "brand-fallback@example.com",
          broadcast: {
            campaign: null,
            brand: { contacted: true, sent: true, delivered: true, opened: false, clicked: false, replied: false, replyClassification: null, bounced: false, unsubscribed: false, lastDeliveredAt: "2026-04-01T00:00:00Z" },
            byCampaign: null,
            global: { email: { bounced: false, unsubscribed: false } },
          },
          transactional: { campaign: null, brand: null, byCampaign: null, global: { email: { bounced: false, unsubscribed: false } } },
        }],
      }),
    });

    // outlets-service
    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);

    // runs-service
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ costs: [] }) });

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    const j = res.body.journalists[0];
    expect(j.brand.delivered).toBe(true);
    expect(j.brand.contacted).toBe(true);
  });

  it("falls back to DB status when no email-gateway data", async () => {
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

    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    const j = res.body.journalists[0];
    expect(j.brand.buffered).toBe(true);
    expect(j.brand.claimed).toBe(false);
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

    mockEmailGatewayBrandStatus([
      { email: "bob@example.com", contacted: true, delivered: true, replied: false, replyClassification: null },
    ]);
    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    const j = res.body.journalists[0];
    expect(j.global).not.toBeNull();
    expect(j.global.bounced).toBe(false);
    expect(j.brand.contacted).toBe(true);
    expect(j.brand.delivered).toBe(true);
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

    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);
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

    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);

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

    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);

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

    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);

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
    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(1);
    expect(res.body.journalists[0].global).toBeNull();
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

    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);
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

  it("enriches with outletName and outletDomain from outlets-service", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Outlet Enrichment Test",
    });
    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "buffered",
    });

    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    const j = res.body.journalists[0];
    expect(j.outletName).toBe("TechCrunch");
    expect(j.outletDomain).toBe("techcrunch.com");
  });

  it("returns null outletName/outletDomain when outlets-service fails", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Outlet Fail Test",
    });
    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      status: "buffered",
    });

    mockFetch.mockRejectedValueOnce(new Error("outlets-service down"));

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    const j = res.body.journalists[0];
    expect(j.outletId).toBe(OUTLET_ID);
    expect(j.outletName).toBeNull();
    expect(j.outletDomain).toBeNull();
  });

  it("returns total and byOutreachStatus counts from enriched statuses", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Buffered J" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Delivered J", apolloEmail: "delivered@example.com" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Served J", apolloEmail: "served@example.com" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, status: "served",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id, orgId: ORG_ID, brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID, outletId: OUTLET_ID, status: "served",
    });

    // email-gateway: j2 is delivered, j3 has no delivery data (brand.delivered = false)
    mockEmailGatewayBrandStatus([
      { email: "delivered@example.com", contacted: true, delivered: true, replied: false, replyClassification: null },
      { email: "served@example.com", contacted: false, delivered: false, replied: false, replyClassification: null },
    ]);
    mockOutletsService([{ id: OUTLET_ID, outletName: "TechCrunch", outletDomain: "techcrunch.com" }]);

    const res = await request(app)
      .get(`/orgs/journalists/list?brandId=${BRAND_ID}`)
      .set(ORG_AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    // Cumulative counts: j1=buffered (brand: buffered only), j2=served+delivered, j3=served
    expect(res.body.byOutreachStatus.buffered).toBe(3); // all are buffered (cumulative)
    expect(res.body.byOutreachStatus.served).toBe(2); // j2 and j3 are served
    expect(res.body.byOutreachStatus.contacted).toBe(1); // j2 only
    expect(res.body.byOutreachStatus.delivered).toBe(1); // j2 only
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
