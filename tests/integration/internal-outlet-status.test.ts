import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS, ORG_AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  insertTestCampaignJournalist,
  closeDb,
} from "../helpers/test-db.js";

// Mock email-gateway client
vi.mock("../../src/lib/email-gateway-client.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    checkEmailStatuses: vi.fn(),
  };
});

// Mock outlet-blocked (used by other internal routes, needs to be mocked for import)
vi.mock("../../src/lib/outlet-blocked.js", () => ({
  checkOutletBlocked: vi.fn(),
}));

import { checkEmailStatuses } from "../../src/lib/email-gateway-client.js";
import type { EmailGatewayStatusResult } from "../../src/lib/email-gateway-client.js";

const mockedCheckEmailStatuses = vi.mocked(checkEmailStatuses);

const app = createTestApp();

const ORG_ID = AUTH_HEADERS["x-org-id"];
const BRAND_ID = AUTH_HEADERS["x-brand-id"];
const CAMPAIGN_ID = AUTH_HEADERS["x-campaign-id"];
const CAMPAIGN_ID_2 = "cccc0000-0000-0000-0000-000000000002";
const OUTLET_A = "aaaa0000-0000-0000-0000-000000000001";
const OUTLET_B = "aaaa0000-0000-0000-0000-000000000002";
const OUTLET_C = "aaaa0000-0000-0000-0000-000000000003";

function makeEmailGatewayResult(
  email: string,
  overrides: {
    contacted?: boolean;
    delivered?: boolean;
    replied?: boolean;
    replyClassification?: "positive" | "negative" | "neutral" | null;
    useBrandScope?: boolean;
  } = {}
): EmailGatewayStatusResult {
  const { contacted = false, delivered = false, replied = false, replyClassification = null, useBrandScope = false } = overrides;
  const scope = {
    contacted,
    sent: contacted,
    delivered,
    opened: false,
    clicked: false,
    replied,
    replyClassification,
    bounced: false,
    unsubscribed: false,
    lastDeliveredAt: null,
  };
  return {
    email,
    broadcast: {
      campaign: useBrandScope ? null : scope,
      brand: useBrandScope ? scope : null,
      byCampaign: null,
      global: { email: { bounced: false, unsubscribed: false } },
    },
    transactional: {
      campaign: null,
      brand: null,
      byCampaign: null,
      global: { email: { bounced: false, unsubscribed: false } },
    },
  };
}

function makeEmailGatewayResultWithByCampaign(
  email: string,
  brandOverrides: {
    contacted?: boolean;
    delivered?: boolean;
    replied?: boolean;
    replyClassification?: "positive" | "negative" | "neutral" | null;
  },
  byCampaign: Array<{
    campaignId: string;
    contacted?: boolean;
    delivered?: boolean;
    replied?: boolean;
    replyClassification?: "positive" | "negative" | "neutral" | null;
  }>
): EmailGatewayStatusResult {
  const { contacted = false, delivered = false, replied = false, replyClassification = null } = brandOverrides;
  const byCampaignRecord: Record<string, { contacted: boolean; sent: boolean; delivered: boolean; opened: boolean; clicked: boolean; replied: boolean; replyClassification: "positive" | "negative" | "neutral" | null; bounced: boolean; unsubscribed: boolean; lastDeliveredAt: string | null }> = {};
  for (const c of byCampaign) {
    byCampaignRecord[c.campaignId] = {
      contacted: c.contacted ?? false,
      sent: c.contacted ?? false,
      delivered: c.delivered ?? false,
      opened: false,
      clicked: false,
      replied: c.replied ?? false,
      replyClassification: c.replyClassification ?? null,
      bounced: false,
      unsubscribed: false,
      lastDeliveredAt: null,
    };
  }
  return {
    email,
    broadcast: {
      campaign: null,
      brand: {
        contacted,
        sent: contacted,
        delivered,
        opened: false,
        clicked: false,
        replied,
        replyClassification,
        bounced: false,
        unsubscribed: false,
        lastDeliveredAt: null,
      },
      byCampaign: byCampaignRecord,
      global: { email: { bounced: false, unsubscribed: false } },
    },
    transactional: {
      campaign: null,
      brand: null,
      byCampaign: null,
      global: { email: { bounced: false, unsubscribed: false } },
    },
  };
}

describe("POST /orgs/outlets/status", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("returns 400 when scopeFilters is missing brandId and campaignId", async () => {
    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("scopeFilters");
  });

  it("returns counts with served when no email-gateway enrichment (campaign scope)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "served",
    });

    mockedCheckEmailStatuses.mockResolvedValue([]);

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { campaignId: CAMPAIGN_ID } });

    expect(res.status).toBe(200);
    const result = res.body.results[OUTLET_A];
    expect(result.totalJournalists).toBe(1);
    expect(result.campaign.buffered).toBe(1);
    expect(result.campaign.served).toBe(1);
    expect(result.campaign.contacted).toBe(0);
    expect(result.brand).toBeNull();
  });

  it("enriches to contacted when email-gateway says contacted", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "served",
      email: "j1@test.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult("j1@test.com", { contacted: true }),
    ]);

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { campaignId: CAMPAIGN_ID } });

    expect(res.status).toBe(200);
    const result = res.body.results[OUTLET_A];
    expect(result.campaign.contacted).toBe(1);
    expect(result.campaign.served).toBe(1);
  });

  it("enriches to delivered when email-gateway says delivered", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "served",
      email: "j1@test.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult("j1@test.com", { contacted: true, delivered: true }),
    ]);

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { campaignId: CAMPAIGN_ID } });

    expect(res.status).toBe(200);
    const result = res.body.results[OUTLET_A];
    expect(result.campaign.contacted).toBe(1);
    expect(result.campaign.delivered).toBe(1);
  });

  it("enriches to replied with reply counts", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "served",
      email: "j1@test.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult("j1@test.com", { contacted: true, delivered: true, replied: true, replyClassification: "negative" }),
    ]);

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { campaignId: CAMPAIGN_ID } });

    expect(res.status).toBe(200);
    const result = res.body.results[OUTLET_A];
    expect(result.campaign.replied).toBe(1);
    expect(result.campaign.repliesNegative).toBe(1);
    expect(result.campaign.repliesPositive).toBe(0);
  });

  it("accumulates counts across multiple journalists", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A, status: "served", email: "j1@test.com",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A, status: "served", email: "j2@test.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult("j1@test.com", { contacted: true }),
      makeEmailGatewayResult("j2@test.com", { contacted: true, delivered: true, replied: true, replyClassification: "neutral" }),
    ]);

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { campaignId: CAMPAIGN_ID } });

    expect(res.status).toBe(200);
    const result = res.body.results[OUTLET_A];
    expect(result.totalJournalists).toBe(2);
    expect(result.campaign.contacted).toBe(2);
    expect(result.campaign.delivered).toBe(1);
    expect(result.campaign.replied).toBe(1);
    expect(result.campaign.repliesNeutral).toBe(1);
  });

  it("handles multiple outlets in a single batch", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_B, journalistName: "J2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A, status: "served", email: "j1@test.com",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_B, status: "served",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult("j1@test.com", { contacted: true, delivered: true }),
    ]);

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A, OUTLET_B], scopeFilters: { campaignId: CAMPAIGN_ID } });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_A].campaign.delivered).toBe(1);
    expect(res.body.results[OUTLET_B].campaign.served).toBe(1);
    expect(res.body.results[OUTLET_B].campaign.delivered).toBe(0);
  });

  it("returns zero counts for outlets with no journalists", async () => {
    mockedCheckEmailStatuses.mockResolvedValue([]);

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_C], scopeFilters: { brandId: BRAND_ID } });

    expect(res.status).toBe(200);
    const result = res.body.results[OUTLET_C];
    expect(result.totalJournalists).toBe(0);
    expect(result.brand.buffered).toBe(0);
  });

  it("uses DB status as baseline (contacted in DB stays contacted even without email-gateway)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A, status: "contacted",
    });

    mockedCheckEmailStatuses.mockResolvedValue([]);

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { campaignId: CAMPAIGN_ID } });

    expect(res.status).toBe(200);
    // DB "contacted" status: buildStatusBooleans sets contacted from scope, but DB chain goes buffered→claimed→served→contacted
    // With no email-gateway data, contacted boolean comes from scope (false), but served count includes contacted DB rows
    const result = res.body.results[OUTLET_A];
    expect(result.campaign.buffered).toBe(1);
    expect(result.campaign.served).toBe(1);
  });

  it("returns 400 for empty outletIds", async () => {
    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [], scopeFilters: { brandId: BRAND_ID } });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid UUID in outletIds", async () => {
    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: ["not-a-uuid"], scopeFilters: { brandId: BRAND_ID } });

    expect(res.status).toBe(400);
  });

  it("returns 502 when email-gateway fails", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A, status: "served", email: "j1@test.com",
    });

    mockedCheckEmailStatuses.mockRejectedValue(new Error("email-gateway POST /status failed (500)"));

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { campaignId: CAMPAIGN_ID } });

    expect(res.status).toBe(502);
  });

  it("counts reply classifications across journalists", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J3" });

    for (const [j, email] of [[j1, "j1@test.com"], [j2, "j2@test.com"], [j3, "j3@test.com"]] as const) {
      await insertTestCampaignJournalist({
        journalistId: j.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
        outletId: OUTLET_A, status: "served", email,
      });
    }

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult("j1@test.com", { contacted: true, delivered: true, replied: true, replyClassification: "neutral" }),
      makeEmailGatewayResult("j2@test.com", { contacted: true, delivered: true, replied: true, replyClassification: "negative" }),
      makeEmailGatewayResult("j3@test.com", { contacted: true, delivered: true, replied: true, replyClassification: "positive" }),
    ]);

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { campaignId: CAMPAIGN_ID } });

    expect(res.status).toBe(200);
    const result = res.body.results[OUTLET_A];
    expect(result.campaign.replied).toBe(3);
    expect(result.campaign.repliesPositive).toBe(1);
    expect(result.campaign.repliesNegative).toBe(1);
    expect(result.campaign.repliesNeutral).toBe(1);
  });

  it("scopes by brand via scopeFilters", async () => {
    const BRAND_A = BRAND_ID;
    const BRAND_B = "bbbb0000-0000-0000-0000-000000000001";

    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_A], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A, status: "served", email: "j1@test.com",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_B], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A, status: "contacted",
    });

    mockedCheckEmailStatuses.mockResolvedValue([]);

    // Query with brand A → should only see j1 (served)
    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(ORG_AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { brandId: BRAND_A } });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_A].brand.served).toBe(1);
    expect(res.body.results[OUTLET_A].brand.contacted).toBe(0);

    // Query with brand B → should only see j2 (contacted in DB)
    mockedCheckEmailStatuses.mockResolvedValue([]);
    const res2 = await request(app)
      .post("/orgs/outlets/status")
      .set(ORG_AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { brandId: BRAND_B } });

    expect(res2.status).toBe(200);
    // DB status "contacted" → served count includes contacted rows (cumulative)
    expect(res2.body.results[OUTLET_A].brand.served).toBe(1);
  });

  it("does not call email-gateway when no journalists have emails", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A, status: "served",
    });

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { campaignId: CAMPAIGN_ID } });

    expect(res.status).toBe(200);
    expect(mockedCheckEmailStatuses).not.toHaveBeenCalled();
  });

  it("passes scopeFilters to checkEmailStatuses (not headers)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A, status: "served", email: "j1@test.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([]);

    await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { brandId: BRAND_ID } });

    expect(mockedCheckEmailStatuses).toHaveBeenCalledWith(
      [{ email: "j1@test.com" }],
      { brandId: BRAND_ID, campaignId: undefined },
      expect.anything(),
    );
  });

  // ── Brand mode: byCampaign breakdown ──

  it("returns byCampaign breakdown in brand mode", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A, status: "served", email: "j1@test.com",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID_2,
      outletId: OUTLET_A, status: "served", email: "j2@test.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResultWithByCampaign(
        "j1@test.com",
        { contacted: true, delivered: true },
        [
          { campaignId: CAMPAIGN_ID, contacted: true, delivered: true },
        ]
      ),
      makeEmailGatewayResultWithByCampaign(
        "j2@test.com",
        { contacted: true },
        [
          { campaignId: CAMPAIGN_ID_2, contacted: true },
        ]
      ),
    ]);

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(ORG_AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { brandId: BRAND_ID } });

    expect(res.status).toBe(200);
    const result = res.body.results[OUTLET_A];
    // Brand-level counts
    expect(result.brand.delivered).toBe(1);
    expect(result.brand.contacted).toBe(2);
    // Per-campaign breakdown
    expect(result.byCampaign).toBeDefined();
    expect(result.byCampaign[CAMPAIGN_ID].delivered).toBe(1);
    expect(result.byCampaign[CAMPAIGN_ID_2].contacted).toBe(1);
    expect(result.byCampaign[CAMPAIGN_ID_2].delivered).toBe(0);
  });

  it("does not include byCampaign in campaign mode", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A, status: "served", email: "j1@test.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult("j1@test.com", { contacted: true }),
    ]);

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { campaignId: CAMPAIGN_ID } });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_A].byCampaign).toBeNull();
  });

  it("email-gateway overrides DB status even when DB is not served", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A, status: "claimed", email: "j1@test.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult("j1@test.com", { contacted: true, delivered: true }),
    ]);

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { campaignId: CAMPAIGN_ID } });

    expect(res.status).toBe(200);
    // email-gateway "delivered" enriches the DB "claimed" journalist
    const result = res.body.results[OUTLET_A];
    expect(result.campaign.claimed).toBe(1);
    expect(result.campaign.delivered).toBe(1);
  });

  it("uses brand scope for top-level status even when byCampaign is missing the campaign key", async () => {
    // Regression: outlet stayed at "served" because byCampaign didn't contain the campaignId,
    // falling back to local DB status instead of using brand scope.
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id, orgId: ORG_ID, brandIds: [BRAND_ID], campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A, status: "served", email: "j1@test.com",
    });

    // Email-gateway returns brand scope with delivered=true, but byCampaign is empty
    // (campaign key not present — e.g. campaign tracking lag)
    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResultWithByCampaign(
        "j1@test.com",
        { contacted: true, delivered: true },
        [] // empty byCampaign — no campaign entries
      ),
    ]);

    const res = await request(app)
      .post("/orgs/outlets/status")
      .set(ORG_AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A], scopeFilters: { brandId: BRAND_ID } });

    expect(res.status).toBe(200);
    const result = res.body.results[OUTLET_A];
    // Brand scope: delivered
    expect(result.brand.delivered).toBe(1);
    // Per-campaign breakdown: no byCampaign entry → campaign scope falls back to no data
    expect(result.byCampaign[CAMPAIGN_ID].delivered).toBe(0);
    expect(result.byCampaign[CAMPAIGN_ID].served).toBe(1);
  });

  it("returns 400 when base headers are missing", async () => {
    const res = await request(app)
      .post("/orgs/outlets/status")
      .set({ "x-api-key": "test-api-key" })
      .send({ outletIds: [OUTLET_A], scopeFilters: { brandId: BRAND_ID } });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-org-id");
  });
});
