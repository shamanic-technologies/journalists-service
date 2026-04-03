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
const OTHER_CAMPAIGN = "66666666-6666-6666-6666-666666666666";

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

  // ── No buffer ─────────────────────────────────────────────────────

  it("returns blocked=false when no buffered journalists exist (may need discovery)", async () => {
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

  // ── Journalist-ID dedup (brand+org level) ────────────────────────────

  it("returns blocked=true when all viable journalists already contacted for same brand+org", async () => {
    const sarah = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Sarah Johnson",
      firstName: "Sarah",
      lastName: "Johnson",
    });

    // Contacted in another campaign for same brand+org
    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: OTHER_CAMPAIGN,
      outletId: OUTLET_ID,
      relevanceScore: "90.00",
      status: "contacted",
      email: "sarah@techcrunch.com",
    });

    // Buffered in current campaign
    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "92.00",
      status: "buffered",
    });

    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("already contacted");
  });

  it("returns blocked=false when journalist contacted for a DIFFERENT brand", async () => {
    const OTHER_BRAND = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    const sarah = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Sarah Johnson",
      firstName: "Sarah",
      lastName: "Johnson",
    });

    // Contacted for a different brand
    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [OTHER_BRAND],
      campaignId: OTHER_CAMPAIGN,
      outletId: OUTLET_ID,
      relevanceScore: "90.00",
      status: "contacted",
      email: "sarah@techcrunch.com",
    });

    // Buffered for our brand
    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "92.00",
      status: "buffered",
    });

    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  it("returns blocked=true when journalist recently served (< 1h) for same brand+org", async () => {
    const sarah = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Sarah Johnson",
      firstName: "Sarah",
      lastName: "Johnson",
    });

    // Recently served in another campaign
    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: OTHER_CAMPAIGN,
      outletId: OUTLET_ID,
      relevanceScore: "90.00",
      status: "served",
      email: "sarah@techcrunch.com",
    });

    // Buffered in current campaign
    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "92.00",
      status: "buffered",
    });

    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("already contacted");
  });

  it("returns blocked=false when journalist served > 1h ago without contacted status", async () => {
    const sarah = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Sarah Johnson",
      firstName: "Sarah",
      lastName: "Johnson",
    });

    // Served > 1h ago (race window expired)
    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: OTHER_CAMPAIGN,
      outletId: OUTLET_ID,
      relevanceScore: "90.00",
      status: "served",
      email: "sarah@techcrunch.com",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    // Buffered in current campaign
    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "92.00",
      status: "buffered",
    });

    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  // ── Apollo no-email blocking ───────────────────────────────────────

  it("returns blocked=true when all viable journalists have no email (Apollo checked < 30d)", async () => {
    const noEmail = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "No Email Person",
      firstName: "No",
      lastName: "Email",
      apolloCheckedAt: new Date(), // just checked
      apolloEmail: null,
    });

    await insertTestCampaignJournalist({
      journalistId: noEmail.id,
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
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("no email");
  });

  it("returns blocked=false when journalist has no email but Apollo check is stale (> 30d)", async () => {
    const stale = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Stale Check Person",
      firstName: "Stale",
      lastName: "Check",
      apolloCheckedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), // 31 days ago
      apolloEmail: null,
    });

    await insertTestCampaignJournalist({
      journalistId: stale.id,
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

  it("returns blocked=false when journalist has Apollo email cached", async () => {
    const withEmail = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Has Email Person",
      firstName: "Has",
      lastName: "Email",
      apolloCheckedAt: new Date(),
      apolloEmail: "has@example.com",
      apolloEmailStatus: "verified",
    });

    await insertTestCampaignJournalist({
      journalistId: withEmail.id,
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

  // ── Mixed scenarios ────────────────────────────────────────────────

  it("returns blocked=false when one journalist is contacted but another is still viable", async () => {
    const sarah = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Sarah Johnson",
      firstName: "Sarah",
      lastName: "Johnson",
    });
    const mike = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Mike Chen",
      firstName: "Mike",
      lastName: "Chen",
    });

    // Sarah contacted
    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: OTHER_CAMPAIGN,
      outletId: OUTLET_ID,
      relevanceScore: "90.00",
      status: "contacted",
      email: "sarah@techcrunch.com",
    });
    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "92.00",
      status: "buffered",
    });

    // Mike still viable
    await insertTestCampaignJournalist({
      journalistId: mike.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "78.00",
      status: "buffered",
    });

    const res = await request(app)
      .get(`/internal/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });
});
