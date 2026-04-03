import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  insertTestCampaignJournalist,
  closeDb,
} from "../helpers/test-db.js";

const app = createTestApp();

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const BRAND_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";

const BLOCKED_HEADERS = {
  ...AUTH_HEADERS,
  "x-org-id": ORG_ID,
  "x-brand-id": BRAND_A,
  "x-campaign-id": CAMPAIGN_ID,
};

describe("GET /internal/outlets/blocked", () => {
  beforeEach(async () => {
    await cleanTestData();
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

  // ── Relevance threshold ─────────────────────────────────────────────

  it("returns blocked=false when no buffered journalists exist", async () => {
    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

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

  it("returns blocked=false when at least one journalist is above relevance threshold", async () => {
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
      relevanceScore: "85.00",
      status: "buffered",
    });

    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });
});
