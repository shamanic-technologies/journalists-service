import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  insertTestCampaignJournalist,
  closeDb,
} from "../helpers/test-db.js";

vi.mock("../../src/lib/email-gateway-client.js", () => ({
  checkEmailStatuses: vi.fn(),
}));

import { checkEmailStatuses } from "../../src/lib/email-gateway-client.js";

const mockedCheckEmailStatuses = vi.mocked(checkEmailStatuses);

const app = createTestApp();

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const BRAND_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";
const OTHER_CAMPAIGN = "66666666-6666-6666-6666-666666666666";

const BLOCKED_HEADERS = {
  ...AUTH_HEADERS,
  "x-org-id": ORG_ID,
  "x-brand-id": BRAND_A,
  "x-campaign-id": CAMPAIGN_ID,
};

function makeEmailGatewayResult(
  email: string,
  journalistId: string,
  brandLead: {
    contacted: boolean;
    delivered: boolean;
    replied: boolean;
    replyClassification: "positive" | "negative" | "neutral" | null;
    lastDeliveredAt: string | null;
  }
) {
  return {
    leadId: journalistId,
    email,
    broadcast: {
      campaign: null,
      brand: {
        lead: brandLead,
        email: { contacted: brandLead.contacted, delivered: brandLead.delivered, bounced: false, unsubscribed: false, lastDeliveredAt: brandLead.lastDeliveredAt },
      },
      global: { email: { bounced: false, unsubscribed: false } },
    },
    transactional: {
      campaign: null,
      brand: null,
      global: { email: { bounced: false, unsubscribed: false } },
    },
  };
}

describe("GET /internal/outlets/blocked", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.resetAllMocks();
    mockedCheckEmailStatuses.mockResolvedValue([]);
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  // ── Validation ──────────────────────────────────────────────────────

  it("returns 400 with missing required headers", async () => {
    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set({ "x-api-key": "test-api-key" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Missing required headers");
  });

  it("returns 400 with missing outlet_id query param", async () => {
    const res = await request(app)
      .get("/internal/outlets/blocked")
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(400);
  });

  // ── Cross-campaign dedup via email-gateway ────────────────────────

  it("returns blocked=false when no prior contacts exist", async () => {
    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
    expect(res.body.reason).toBeUndefined();
  });

  it("returns blocked=true when journalist replied negatively < 12 months ago", async () => {
    // Create a journalist that was contacted in another campaign with email stored
    const prev = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Previous Writer",
      firstName: "Previous",
      lastName: "Writer",
    });
    await insertTestCampaignJournalist({
      journalistId: prev.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: OTHER_CAMPAIGN,
      outletId: OUTLET_ID,
      relevanceScore: "80.00",
      status: "contacted",
      email: "prev@outlet.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult("prev@outlet.com", prev.id, {
        contacted: true,
        delivered: true,
        replied: true,
        replyClassification: "negative",
        lastDeliveredAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ]);

    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("replied negatively");
  });

  it("returns blocked=true when journalist replied positively", async () => {
    const prev = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Positive Writer",
      firstName: "Positive",
      lastName: "Writer",
    });
    await insertTestCampaignJournalist({
      journalistId: prev.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: OTHER_CAMPAIGN,
      outletId: OUTLET_ID,
      relevanceScore: "80.00",
      status: "contacted",
      email: "pos@outlet.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult("pos@outlet.com", prev.id, {
        contacted: true,
        delivered: true,
        replied: true,
        replyClassification: "positive",
        lastDeliveredAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ]);

    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("replied positively");
  });

  it("returns blocked=true when contacted < 30 days with no reply", async () => {
    const prev = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "No Reply Writer",
      firstName: "No",
      lastName: "Reply",
    });
    await insertTestCampaignJournalist({
      journalistId: prev.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: OTHER_CAMPAIGN,
      outletId: OUTLET_ID,
      relevanceScore: "80.00",
      status: "contacted",
      email: "noreply@outlet.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult("noreply@outlet.com", prev.id, {
        contacted: true,
        delivered: true,
        replied: false,
        replyClassification: null,
        lastDeliveredAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ]);

    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("waiting for reply");
  });

  it("returns blocked=false when contacted >= 30 days with no reply", async () => {
    const prev = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Old No Reply",
      firstName: "Old",
      lastName: "NoReply",
    });
    await insertTestCampaignJournalist({
      journalistId: prev.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: OTHER_CAMPAIGN,
      outletId: OUTLET_ID,
      relevanceScore: "80.00",
      status: "contacted",
      email: "oldnoreply@outlet.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult("oldnoreply@outlet.com", prev.id, {
        contacted: true,
        delivered: true,
        replied: false,
        replyClassification: null,
        lastDeliveredAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ]);

    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  it("returns blocked=false when negative reply is older than 12 months", async () => {
    const prev = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Old Negative",
      firstName: "Old",
      lastName: "Negative",
    });
    await insertTestCampaignJournalist({
      journalistId: prev.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: OTHER_CAMPAIGN,
      outletId: OUTLET_ID,
      relevanceScore: "80.00",
      status: "contacted",
      email: "oldneg@outlet.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult("oldneg@outlet.com", prev.id, {
        contacted: true,
        delivered: true,
        replied: true,
        replyClassification: "negative",
        lastDeliveredAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ]);

    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  it("returns 502 when email-gateway is unreachable", async () => {
    const prev = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Has Email",
      firstName: "Has",
      lastName: "Email",
    });
    await insertTestCampaignJournalist({
      journalistId: prev.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: OTHER_CAMPAIGN,
      outletId: OUTLET_ID,
      relevanceScore: "80.00",
      status: "contacted",
      email: "email@outlet.com",
    });

    mockedCheckEmailStatuses.mockRejectedValue(
      new Error("email-gateway POST /status failed (503)")
    );

    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("email-gateway");
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
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

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
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

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
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("below relevance threshold");
  });
});
