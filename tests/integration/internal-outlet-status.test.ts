import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  insertTestCampaignJournalist,
  closeDb,
} from "../helpers/test-db.js";

// Mock email-gateway client
vi.mock("../../src/lib/email-gateway-client.js", () => ({
  checkEmailStatuses: vi.fn(),
}));

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
const OUTLET_A = "aaaa0000-0000-0000-0000-000000000001";
const OUTLET_B = "aaaa0000-0000-0000-0000-000000000002";
const OUTLET_C = "aaaa0000-0000-0000-0000-000000000003";

function makeEmailGatewayResult(
  leadId: string,
  email: string,
  overrides: {
    contacted?: boolean;
    delivered?: boolean;
    replied?: boolean;
    replyClassification?: "positive" | "negative" | "neutral" | null;
  } = {}
): EmailGatewayStatusResult {
  const { contacted = false, delivered = false, replied = false, replyClassification = null } = overrides;
  return {
    leadId,
    email,
    broadcast: {
      campaign: {
        lead: {
          contacted,
          delivered,
          replied,
          replyClassification,
          lastDeliveredAt: null,
        },
        email: {
          contacted,
          delivered,
          bounced: false,
          unsubscribed: false,
          lastDeliveredAt: null,
        },
      },
      brand: null,
      global: { email: { bounced: false, unsubscribed: false } },
    },
    transactional: {
      campaign: null,
      brand: null,
      global: { email: { bounced: false, unsubscribed: false } },
    },
  };
}

describe("POST /internal/outlets/status", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("returns served status when no email-gateway enrichment", async () => {
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
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A] });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_A]).toEqual({
      status: "served",
      replyClassification: null,
      journalistCount: 1,
      contactedCount: 0,
    });
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
      makeEmailGatewayResult(j1.id, "j1@test.com", { contacted: true }),
    ]);

    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A] });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_A]).toEqual({
      status: "contacted",
      replyClassification: null,
      journalistCount: 1,
      contactedCount: 1,
    });
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
      makeEmailGatewayResult(j1.id, "j1@test.com", { contacted: true, delivered: true }),
    ]);

    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A] });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_A]).toEqual({
      status: "delivered",
      replyClassification: null,
      journalistCount: 1,
      contactedCount: 1,
    });
  });

  it("enriches to replied when email-gateway says replied", async () => {
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
      makeEmailGatewayResult(j1.id, "j1@test.com", { contacted: true, delivered: true, replied: true, replyClassification: "negative" }),
    ]);

    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A] });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_A]).toEqual({
      status: "replied",
      replyClassification: "negative",
      journalistCount: 1,
      contactedCount: 1,
    });
  });

  it("takes high watermark across multiple journalists", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "served",
      email: "j1@test.com",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "served",
      email: "j2@test.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult(j1.id, "j1@test.com", { contacted: true }),
      makeEmailGatewayResult(j2.id, "j2@test.com", { contacted: true, delivered: true, replied: true, replyClassification: "neutral" }),
    ]);

    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A] });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_A]).toEqual({
      status: "replied",
      replyClassification: "neutral",
      journalistCount: 2,
      contactedCount: 2,
    });
  });

  it("handles multiple outlets in a single batch", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_B, journalistName: "J2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "served",
      email: "j1@test.com",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_B,
      status: "served",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult(j1.id, "j1@test.com", { contacted: true, delivered: true }),
    ]);

    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A, OUTLET_B] });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_A]).toEqual({
      status: "delivered",
      replyClassification: null,
      journalistCount: 1,
      contactedCount: 1,
    });
    expect(res.body.results[OUTLET_B]).toEqual({
      status: "served",
      replyClassification: null,
      journalistCount: 1,
      contactedCount: 0,
    });
  });

  it("returns served for outlets with no journalists", async () => {
    mockedCheckEmailStatuses.mockResolvedValue([]);

    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_C] });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_C]).toEqual({
      status: "served",
      replyClassification: null,
      journalistCount: 0,
      contactedCount: 0,
    });
  });

  it("uses DB status as baseline (contacted in DB stays contacted even without email-gateway)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "contacted",
    });

    mockedCheckEmailStatuses.mockResolvedValue([]);

    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A] });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_A].status).toBe("contacted");
  });

  it("returns 400 for empty outletIds", async () => {
    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [] });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid UUID in outletIds", async () => {
    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: ["not-a-uuid"] });

    expect(res.status).toBe(400);
  });

  it("returns 502 when email-gateway fails", async () => {
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

    mockedCheckEmailStatuses.mockRejectedValue(new Error("email-gateway POST /status failed (500)"));

    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A] });

    expect(res.status).toBe(502);
  });

  it("returns best replyClassification across journalists (positive > negative > neutral)", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J2" });
    const j3 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J3" });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "served",
      email: "j1@test.com",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "served",
      email: "j2@test.com",
    });
    await insertTestCampaignJournalist({
      journalistId: j3.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "served",
      email: "j3@test.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult(j1.id, "j1@test.com", { contacted: true, delivered: true, replied: true, replyClassification: "neutral" }),
      makeEmailGatewayResult(j2.id, "j2@test.com", { contacted: true, delivered: true, replied: true, replyClassification: "negative" }),
      makeEmailGatewayResult(j3.id, "j3@test.com", { contacted: true, delivered: true, replied: true, replyClassification: "positive" }),
    ]);

    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A] });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_A]).toEqual({
      status: "replied",
      replyClassification: "positive",
      journalistCount: 3,
      contactedCount: 3,
    });
  });

  it("returns negative over neutral for replyClassification", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    const j2 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J2" });

    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "served",
      email: "j1@test.com",
    });
    await insertTestCampaignJournalist({
      journalistId: j2.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "served",
      email: "j2@test.com",
    });

    mockedCheckEmailStatuses.mockResolvedValue([
      makeEmailGatewayResult(j1.id, "j1@test.com", { contacted: true, delivered: true, replied: true, replyClassification: "neutral" }),
      makeEmailGatewayResult(j2.id, "j2@test.com", { contacted: true, delivered: true, replied: true, replyClassification: "negative" }),
    ]);

    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A] });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_A].replyClassification).toBe("negative");
  });

  it("replyClassification is null when replied but no classification available", async () => {
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
      makeEmailGatewayResult(j1.id, "j1@test.com", { contacted: true, delivered: true, replied: true }),
    ]);

    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A] });

    expect(res.status).toBe(200);
    expect(res.body.results[OUTLET_A].status).toBe("replied");
    expect(res.body.results[OUTLET_A].replyClassification).toBeNull();
  });

  it("does not call email-gateway when no journalists have emails", async () => {
    const j1 = await insertTestJournalist({ outletId: OUTLET_A, journalistName: "J1" });
    await insertTestCampaignJournalist({
      journalistId: j1.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_A,
      status: "served",
    });

    const res = await request(app)
      .post("/internal/outlets/status")
      .set(AUTH_HEADERS)
      .send({ outletIds: [OUTLET_A] });

    expect(res.status).toBe(200);
    expect(mockedCheckEmailStatuses).not.toHaveBeenCalled();
  });
});
