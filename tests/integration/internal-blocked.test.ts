import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  insertTestCampaignJournalist,
  closeDb,
} from "../helpers/test-db.js";

// Mock email-gateway client (checkOutletBlocked now calls it for Condition A)
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

function makeGatewayResult(email: string, overrides: {
  contacted?: boolean;
  delivered?: boolean;
  replied?: boolean;
  replyClassification?: "positive" | "negative" | "neutral" | null;
  bounced?: boolean;
  unsubscribed?: boolean;
  lastDeliveredAt?: string | null;
} = {}) {
  const scope = {
    contacted: overrides.contacted ?? false,
    sent: overrides.contacted ?? false,
    delivered: overrides.delivered ?? false,
    opened: false,
    clicked: false,
    replied: overrides.replied ?? false,
    replyClassification: overrides.replyClassification ?? null,
    bounced: overrides.bounced ?? false,
    unsubscribed: overrides.unsubscribed ?? false,
    lastDeliveredAt: overrides.lastDeliveredAt ?? null,
  };
  return {
    leadId: null,
    email,
    broadcast: {
      campaign: null,
      brand: scope,
      global: { email: { bounced: false, unsubscribed: false } },
    },
    transactional: {
      campaign: null,
      brand: scope,
      global: { email: { bounced: false, unsubscribed: false } },
    },
  };
}

describe("GET /orgs/outlets/blocked", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.resetAllMocks();
    // Default: email-gateway returns no data
    mockedCheckEmailStatuses.mockResolvedValue([]);
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  // ── Validation ──────────────────────────────────────────────────────

  it("returns 400 with missing required headers", async () => {
    const res = await request(app)
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set({ "x-api-key": "test-api-key" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Missing required header: x-org-id");
  });

  it("returns 400 with missing outlet_id query param", async () => {
    const res = await request(app)
      .get("/orgs/outlets/blocked")
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(400);
  });

  // ── No buffer ─────────────────────────────────────────────────────

  it("returns blocked=false when no buffered journalists exist (may need discovery)", async () => {
    const res = await request(app)
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  // ── Condition B: Relevance threshold ──────────────────────────────

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
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
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
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  // ── Condition B: Journalist-ID dedup (brand+org level) ────────────

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

    // email-gateway confirms contact at brand scope (within 30 days)
    mockedCheckEmailStatuses.mockResolvedValue([
      makeGatewayResult("sarah@techcrunch.com", {
        contacted: true,
        delivered: true,
        lastDeliveredAt: new Date().toISOString(),
      }),
    ]);

    const res = await request(app)
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("already contacted at this outlet");
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
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  // ── Condition A: Race window ──────────────────────────────────────

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
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("recently served");
  });

  it("returns blocked=false when journalist served > 1h ago and email-gateway shows no contact", async () => {
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

    // email-gateway says not contacted (workflow failed before sending)
    mockedCheckEmailStatuses.mockResolvedValue([
      makeGatewayResult("sarah@techcrunch.com", { contacted: false }),
    ]);

    const res = await request(app)
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  // ── Condition A: Email-gateway contacted within 30 days ───────────

  it("returns blocked=true when email-gateway confirms contact within 30 days", async () => {
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

    // Sarah contacted (locally) — email-gateway will confirm
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

    // Mike is still viable in the buffer
    await insertTestCampaignJournalist({
      journalistId: mike.id,
      orgId: ORG_ID,
      brandIds: [BRAND_A],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "78.00",
      status: "buffered",
    });

    // email-gateway confirms Sarah was contacted for this brand within 30 days
    mockedCheckEmailStatuses.mockResolvedValue([
      makeGatewayResult("sarah@techcrunch.com", {
        contacted: true,
        delivered: true,
        lastDeliveredAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
      }),
    ]);

    const res = await request(app)
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("already contacted at this outlet");
  });

  it("returns blocked=false when email-gateway contact is older than 30 days", async () => {
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

    // Sarah contacted long ago
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

    // email-gateway: contact was > 30 days ago
    mockedCheckEmailStatuses.mockResolvedValue([
      makeGatewayResult("sarah@techcrunch.com", {
        contacted: true,
        delivered: true,
        lastDeliveredAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(), // 45 days ago
      }),
    ]);

    const res = await request(app)
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  // ── Condition A: Email-gateway replied within 6 months ────────────

  it("returns blocked=true when email-gateway shows reply within 6 months", async () => {
    const sarah = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Sarah Johnson",
      firstName: "Sarah",
      lastName: "Johnson",
    });

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

    // email-gateway: replied negative 2 months ago (within 6mo window)
    mockedCheckEmailStatuses.mockResolvedValue([
      makeGatewayResult("sarah@techcrunch.com", {
        contacted: true,
        delivered: true,
        replied: true,
        replyClassification: "negative",
        lastDeliveredAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
      }),
    ]);

    const res = await request(app)
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("replied");
  });

  it("returns blocked=true when email-gateway shows positive reply within 6 months", async () => {
    const sarah = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Sarah Johnson",
      firstName: "Sarah",
      lastName: "Johnson",
    });

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

    // email-gateway: replied positive 3 months ago
    mockedCheckEmailStatuses.mockResolvedValue([
      makeGatewayResult("sarah@techcrunch.com", {
        contacted: true,
        delivered: true,
        replied: true,
        replyClassification: "positive",
        lastDeliveredAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ]);

    const res = await request(app)
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toContain("replied (positive)");
  });

  // ── Condition B: Apollo no-email blocking ─────────────────────────

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
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
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
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
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
      .get(`/orgs/outlets/blocked?outlet_id=${OUTLET_ID}`)
      .set(BLOCKED_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });
});
