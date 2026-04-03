import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  insertTestCampaignJournalist,
  closeDb,
} from "../helpers/test-db.js";

vi.mock("../../src/lib/lead-client.js", () => ({
  fetchLeadStats: vi.fn(),
  fetchLeadStatsGrouped: vi.fn(),
  fetchLeadStatuses: vi.fn(),
}));

import { fetchLeadStatuses } from "../../src/lib/lead-client.js";

const mockedFetchLeadStatuses = vi.mocked(fetchLeadStatuses);

const app = createTestApp();

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const BRAND_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";

const BASE_QS = `org_id=${ORG_ID}&brand_ids=${BRAND_A}&outlet_id=${OUTLET_ID}&campaign_id=${CAMPAIGN_ID}`;

describe("GET /internal/outlets/blocked", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.resetAllMocks();
    mockedFetchLeadStatuses.mockResolvedValue([]);
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  // ── Validation ──────────────────────────────────────────────────────

  it("returns 400 with missing required params", async () => {
    const res = await request(app)
      .get("/internal/outlets/blocked")
      .set(AUTH_HEADERS);

    expect(res.status).toBe(400);
  });

  it("returns 400 without campaign_id", async () => {
    const res = await request(app)
      .get(`/internal/outlets/blocked?org_id=${ORG_ID}&brand_ids=${BRAND_A}&outlet_id=${OUTLET_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(400);
  });

  // ── Lead-service dedup (cross-campaign) ─────────────────────────────

  it("returns blocked=false when no prior contacts exist", async () => {
    const res = await request(app)
      .get(`/internal/outlets/blocked?${BASE_QS}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
    expect(res.body.reason).toBeUndefined();
  });

  it("returns blocked=true when journalist replied negatively < 12 months ago", async () => {
    mockedFetchLeadStatuses.mockResolvedValue([
      {
        leadId: "lead-1",
        email: "j@outlet.com",
        journalistId: "j-1",
        outletId: OUTLET_ID,
        contacted: true,
        delivered: true,
        bounced: false,
        replied: true,
        replyClassification: "negative",
        lastDeliveredAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);

    const res = await request(app)
      .get(`/internal/outlets/blocked?${BASE_QS}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("replied negatively");
  });

  it("returns blocked=true when journalist replied positively", async () => {
    mockedFetchLeadStatuses.mockResolvedValue([
      {
        leadId: "lead-1",
        email: "j@outlet.com",
        journalistId: "j-1",
        outletId: OUTLET_ID,
        contacted: true,
        delivered: true,
        bounced: false,
        replied: true,
        replyClassification: "positive",
        lastDeliveredAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);

    const res = await request(app)
      .get(`/internal/outlets/blocked?${BASE_QS}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("replied positively");
  });

  it("returns blocked=true when contacted < 30 days with no reply", async () => {
    mockedFetchLeadStatuses.mockResolvedValue([
      {
        leadId: "lead-1",
        email: "j@outlet.com",
        journalistId: "j-1",
        outletId: OUTLET_ID,
        contacted: true,
        delivered: true,
        bounced: false,
        replied: false,
        replyClassification: null,
        lastDeliveredAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);

    const res = await request(app)
      .get(`/internal/outlets/blocked?${BASE_QS}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("waiting for reply");
  });

  it("returns blocked=false when contacted >= 30 days with no reply", async () => {
    mockedFetchLeadStatuses.mockResolvedValue([
      {
        leadId: "lead-1",
        email: "j@outlet.com",
        journalistId: "j-1",
        outletId: OUTLET_ID,
        contacted: true,
        delivered: true,
        bounced: false,
        replied: false,
        replyClassification: null,
        lastDeliveredAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);

    const res = await request(app)
      .get(`/internal/outlets/blocked?${BASE_QS}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  it("returns blocked=false when negative reply is older than 12 months", async () => {
    mockedFetchLeadStatuses.mockResolvedValue([
      {
        leadId: "lead-1",
        email: "j@outlet.com",
        journalistId: "j-1",
        outletId: OUTLET_ID,
        contacted: true,
        delivered: true,
        bounced: false,
        replied: true,
        replyClassification: "negative",
        lastDeliveredAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);

    const res = await request(app)
      .get(`/internal/outlets/blocked?${BASE_QS}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  it("returns 502 when lead-service is unreachable", async () => {
    mockedFetchLeadStatuses.mockRejectedValue(
      new Error("lead-service GET /leads/status failed (503)")
    );

    const res = await request(app)
      .get(`/internal/outlets/blocked?${BASE_QS}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("lead-service");
  });

  it("supports multiple brand_ids in CSV — blocks if any brand is blocked", async () => {
    const BRAND_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    // First brand: no contacts. Second brand: negative reply.
    mockedFetchLeadStatuses.mockImplementation(async (params) => {
      if (params.brandId === BRAND_B) {
        return [
          {
            leadId: "lead-1",
            email: "j@outlet.com",
            journalistId: "j-1",
            outletId: OUTLET_ID,
            contacted: true,
            delivered: true,
            bounced: false,
            replied: true,
            replyClassification: "negative" as const,
            lastDeliveredAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ];
      }
      return [];
    });

    const res = await request(app)
      .get(`/internal/outlets/blocked?org_id=${ORG_ID}&brand_ids=${BRAND_A},${BRAND_B}&outlet_id=${OUTLET_ID}&campaign_id=${CAMPAIGN_ID}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
  });

  // ── Local dedup (same campaign) ─────────────────────────────────────

  it("returns blocked=true when journalist recently served in this campaign", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Already Served",
      firstName: "Already",
      lastName: "Served",
    });

    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "85.00",
      status: "served",
    });

    const res = await request(app)
      .get(`/internal/outlets/blocked?${BASE_QS}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("already has a served journalist");
  });

  it("returns blocked=true when journalist has contacted status", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Contacted Person",
      firstName: "Contacted",
      lastName: "Person",
    });

    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "85.00",
      status: "contacted",
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    });

    const res = await request(app)
      .get(`/internal/outlets/blocked?${BASE_QS}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("already has a served journalist");
  });

  it("returns blocked=false when served > 1 hour ago without contacted", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Stale Served",
      firstName: "Stale",
      lastName: "Served",
    });

    await insertTestCampaignJournalist({
      journalistId: journalist.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "85.00",
      status: "served",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    });

    const res = await request(app)
      .get(`/internal/outlets/blocked?${BASE_QS}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  // ── Relevance threshold ─────────────────────────────────────────────

  it("returns blocked=true when all buffered journalists are below relevance threshold", async () => {
    const low1 = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Low Score One",
      firstName: "Low",
      lastName: "One",
    });
    const low2 = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Low Score Two",
      firstName: "Low",
      lastName: "Two",
    });

    await insertTestCampaignJournalist({
      journalistId: low1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "15.00",
      status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: low2.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "20.00",
      status: "buffered",
    });

    const res = await request(app)
      .get(`/internal/outlets/blocked?${BASE_QS}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("below relevance threshold");
  });

  it("returns blocked=false when at least one buffered journalist is above threshold", async () => {
    const low = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Low Score",
      firstName: "Low",
      lastName: "Score",
    });
    const high = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "High Score",
      firstName: "High",
      lastName: "Score",
    });

    await insertTestCampaignJournalist({
      journalistId: low.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "15.00",
      status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: high.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "75.00",
      status: "buffered",
    });

    const res = await request(app)
      .get(`/internal/outlets/blocked?${BASE_QS}`)
      .set(AUTH_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });
});
