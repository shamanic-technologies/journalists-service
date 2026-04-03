import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  insertTestCampaignJournalist,
  closeDb,
} from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import { campaignJournalists } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";

// Mock all external service clients
vi.mock("../../src/lib/runs-client.js", () => ({
  createChildRun: vi.fn(),
}));

vi.mock("../../src/lib/brand-client.js", () => ({
  extractBrandFields: vi.fn(),
  getFieldValue: vi.fn(),
}));

vi.mock("../../src/lib/campaign-client.js", () => ({
  fetchCampaign: vi.fn(),
}));

vi.mock("../../src/lib/outlets-client.js", () => ({
  fetchOutlet: vi.fn(),
}));

vi.mock("../../src/lib/articles-client.js", () => ({
  discoverOutletArticles: vi.fn(),
}));

vi.mock("../../src/lib/chat-client.js", () => ({
  chatComplete: vi.fn(),
}));

vi.mock("../../src/lib/lead-client.js", () => ({
  fetchLeadStats: vi.fn(),
  fetchLeadStatsGrouped: vi.fn(),
  fetchLeadStatuses: vi.fn(),
}));

import { createChildRun } from "../../src/lib/runs-client.js";
import { extractBrandFields, getFieldValue } from "../../src/lib/brand-client.js";
import { fetchCampaign } from "../../src/lib/campaign-client.js";
import { fetchOutlet } from "../../src/lib/outlets-client.js";
import { discoverOutletArticles } from "../../src/lib/articles-client.js";
import { chatComplete } from "../../src/lib/chat-client.js";
import { fetchLeadStatuses } from "../../src/lib/lead-client.js";

const mockedCreateChildRun = vi.mocked(createChildRun);
const mockedFetchLeadStatuses = vi.mocked(fetchLeadStatuses);
const mockedExtractBrandFields = vi.mocked(extractBrandFields);
const mockedGetFieldValue = vi.mocked(getFieldValue);
const mockedFetchCampaign = vi.mocked(fetchCampaign);
const mockedFetchOutlet = vi.mocked(fetchOutlet);
const mockedDiscoverOutletArticles = vi.mocked(discoverOutletArticles);
const mockedChatComplete = vi.mocked(chatComplete);

const app = createTestApp();

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const BRAND_ID = "44444444-4444-4444-4444-444444444444";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";
const CHILD_RUN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const BUFFER_HEADERS = {
  ...AUTH_HEADERS,
  "x-campaign-id": CAMPAIGN_ID,
  "x-brand-id": BRAND_ID,
};

function setupRefillMocks() {
  mockedCreateChildRun.mockResolvedValue({
    id: CHILD_RUN_ID,
    parentRunId: "99999999-9999-9999-9999-999999999999",
    serviceName: "journalists-service",
    taskName: "buffer-next",
  });

  mockedExtractBrandFields.mockResolvedValue({
    brands: [{ brandId: BRAND_ID, domain: "techcorp.com", name: "TechCorp" }],
    fields: {
      brand_name: { value: "TechCorp", byBrand: { "techcorp.com": { value: "TechCorp", cached: false, extractedAt: "2026-03-01T00:00:00Z", expiresAt: null, sourceUrls: [] } } },
      brand_description: { value: "Enterprise SaaS platform", byBrand: { "techcorp.com": { value: "Enterprise SaaS platform", cached: false, extractedAt: "2026-03-01T00:00:00Z", expiresAt: null, sourceUrls: [] } } },
    },
  });

  mockedGetFieldValue.mockImplementation((_fields, key) => {
    if (key === "brand_name") return "TechCorp";
    if (key === "brand_description") return "Enterprise SaaS platform";
    return "";
  });

  mockedFetchCampaign.mockResolvedValue({
    id: CAMPAIGN_ID,
    featureInputs: { angle: "developer tools" },
    brandId: BRAND_ID,
  });

  mockedFetchOutlet.mockResolvedValue({
    id: OUTLET_ID,
    outletName: "TechCrunch",
    outletUrl: "https://techcrunch.com",
  });

  mockedDiscoverOutletArticles.mockResolvedValue({
    articles: [
      {
        url: "https://techcrunch.com/2026/01/15/top-saas-tools",
        title: "Top SaaS Tools for Developers in 2026",
        snippet: "The best developer tools...",
        publishedAt: "2026-01-15",
        authors: [{ firstName: "Sarah", lastName: "Johnson" }],
      },
      {
        url: "https://techcrunch.com/2026/02/10/ai-dev-tools-funding",
        title: "AI-Powered Dev Tools Raise $50M",
        snippet: "AI developer tools are booming...",
        publishedAt: "2026-02-10",
        authors: [{ firstName: "Mike", lastName: "Chen" }],
      },
      {
        url: "https://techcrunch.com/2026/03/01/enterprise-saas-trends",
        title: "Enterprise SaaS Funding Trends",
        snippet: "Enterprise SaaS continues...",
        publishedAt: "2026-03-01",
        authors: [{ firstName: "Sarah", lastName: "Johnson" }],
      },
    ],
  });

  mockedChatComplete.mockResolvedValue({
    content: "",
    json: {
      journalists: [
        {
          firstName: "Sarah",
          lastName: "Johnson",
          relevanceScore: 92,
          whyRelevant: "Sarah Johnson covers SaaS and developer tools.",
          whyNotRelevant: "Some consumer tech coverage.",
          articleUrls: [
            "https://techcrunch.com/2026/01/15/top-saas-tools",
            "https://techcrunch.com/2026/03/01/enterprise-saas-trends",
          ],
        },
        {
          firstName: "Mike",
          lastName: "Chen",
          relevanceScore: 78,
          whyRelevant: "Mike Chen covers AI funding rounds.",
          whyNotRelevant: "Focuses more on funding than products.",
          articleUrls: ["https://techcrunch.com/2026/02/10/ai-dev-tools-funding"],
        },
      ],
    },
    tokensInput: 1500,
    tokensOutput: 500,
    model: "claude-sonnet-4-6",
  });
}

describe("POST /buffer/next", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.resetAllMocks();
    // Default: no prior contacts — outlet is not blocked
    mockedFetchLeadStatuses.mockResolvedValue([]);
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  // ── Validation ──────────────────────────────────────────────────────

  it("returns 400 for invalid request body", async () => {
    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 without x-campaign-id header", async () => {
    const res = await request(app)
      .post("/buffer/next")
      .set(AUTH_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-campaign-id");
  });

  it("returns 400 without x-brand-id header", async () => {
    const res = await request(app)
      .post("/buffer/next")
      .set({ ...AUTH_HEADERS, "x-campaign-id": CAMPAIGN_ID })
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-brand-id");
  });

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/buffer/next")
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(401);
  });

  // ── Claim from pre-filled buffer ────────────────────────────────────

  it("claims top journalist from existing buffer", async () => {
    // Pre-fill buffer: two journalists, Sarah (92) and Mike (78)
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

    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "92.00",
      whyRelevant: "Covers SaaS",
      whyNotRelevant: "Some consumer tech",
      status: "buffered",
    });
    await insertTestCampaignJournalist({
      journalistId: mike.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "78.00",
      whyRelevant: "Covers AI funding",
      whyNotRelevant: "Funding focus",
      status: "buffered",
    });

    // Need child run + outlet mocks for the route
    mockedCreateChildRun.mockResolvedValue({
      id: CHILD_RUN_ID,
      parentRunId: "99999999-9999-9999-9999-999999999999",
      serviceName: "journalists-service",
      taskName: "buffer-next",
    });
    mockedFetchOutlet.mockResolvedValue({
      id: OUTLET_ID,
      outletName: "TechCrunch",
      outletUrl: "https://techcrunch.com",
    });

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.journalist.firstName).toBe("Sarah");
    expect(res.body.journalist.relevanceScore).toBe(92);

    // Sarah should be marked as served
    const sarahCj = await db
      .select()
      .from(campaignJournalists)
      .where(eq(campaignJournalists.journalistId, sarah.id));
    expect(sarahCj[0].status).toBe("served");

    // Mike should still be buffered
    const mikeCj = await db
      .select()
      .from(campaignJournalists)
      .where(eq(campaignJournalists.journalistId, mike.id));
    expect(mikeCj[0].status).toBe("buffered");

    // No discovery calls — served from buffer
    expect(mockedDiscoverOutletArticles).not.toHaveBeenCalled();
    expect(mockedChatComplete).not.toHaveBeenCalled();
  });

  it("skips journalists with relevance score below 30 (distant tier)", async () => {
    const lowScore = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Low Score Writer",
      firstName: "Low",
      lastName: "Score",
    });

    await insertTestCampaignJournalist({
      journalistId: lowScore.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "15.00",
      status: "buffered",
    });

    mockedCreateChildRun.mockResolvedValue({
      id: CHILD_RUN_ID,
      parentRunId: "99999999-9999-9999-9999-999999999999",
      serviceName: "journalists-service",
      taskName: "buffer-next",
    });
    mockedFetchOutlet.mockResolvedValue({
      id: OUTLET_ID,
      outletName: "TechCrunch",
      outletUrl: "https://techcrunch.com",
    });
    mockedExtractBrandFields.mockResolvedValue({
      brands: [{ brandId: BRAND_ID, domain: "techcorp.com", name: "TechCorp" }],
      fields: {
        brand_name: { value: "TechCorp", byBrand: { "techcorp.com": { value: "TechCorp", cached: false, extractedAt: "2026-03-01T00:00:00Z", expiresAt: null, sourceUrls: [] } } },
        brand_description: { value: "SaaS platform", byBrand: { "techcorp.com": { value: "SaaS platform", cached: false, extractedAt: "2026-03-01T00:00:00Z", expiresAt: null, sourceUrls: [] } } },
      },
    });
    mockedGetFieldValue.mockReturnValue("TechCorp");
    mockedFetchCampaign.mockResolvedValue({
      id: CAMPAIGN_ID,
      featureInputs: null,
      brandId: BRAND_ID,
    });
    mockedDiscoverOutletArticles.mockResolvedValue({ articles: [] });

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  it("serves journalist at exactly 30 relevance score (adjacent tier threshold)", async () => {
    const threshold = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Threshold Writer",
      firstName: "Threshold",
      lastName: "Writer",
    });

    await insertTestCampaignJournalist({
      journalistId: threshold.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "30.00",
      status: "buffered",
    });

    mockedCreateChildRun.mockResolvedValue({
      id: CHILD_RUN_ID,
      parentRunId: "99999999-9999-9999-9999-999999999999",
      serviceName: "journalists-service",
      taskName: "buffer-next",
    });
    mockedFetchOutlet.mockResolvedValue({
      id: OUTLET_ID,
      outletName: "TechCrunch",
      outletUrl: "https://techcrunch.com",
    });

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.journalist.firstName).toBe("Threshold");
    expect(res.body.journalist.relevanceScore).toBe(30);
  });

  it("blocks second journalist from same outlet when first was recently served (< 1h)", async () => {
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

    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "92.00",
      status: "served", // Served recently (default createdAt = now)
    });
    await insertTestCampaignJournalist({
      journalistId: mike.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "78.00",
      status: "buffered",
    });

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
    expect(res.body.reason).toContain("already has a served journalist");
    // Should NOT create a child run — local dedup fires before run creation
    expect(mockedCreateChildRun).not.toHaveBeenCalled();
  });

  it("allows second journalist when first was served > 1h ago (send probably failed)", async () => {
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

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "92.00",
      status: "served",
      createdAt: twoHoursAgo, // Served 2 hours ago, never became "contacted"
    });
    await insertTestCampaignJournalist({
      journalistId: mike.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "78.00",
      status: "buffered",
    });

    mockedCreateChildRun.mockResolvedValue({
      id: CHILD_RUN_ID,
      parentRunId: "99999999-9999-9999-9999-999999999999",
      serviceName: "journalists-service",
      taskName: "buffer-next",
    });
    mockedFetchOutlet.mockResolvedValue({
      id: OUTLET_ID,
      outletName: "TechCrunch",
      outletUrl: "https://techcrunch.com",
    });

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.journalist.firstName).toBe("Mike");
  });

  it("always blocks when first journalist reached 'contacted' status regardless of age", async () => {
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

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "92.00",
      status: "contacted", // Confirmed contacted — always blocks
      createdAt: threeDaysAgo,
    });
    await insertTestCampaignJournalist({
      journalistId: mike.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "78.00",
      status: "buffered",
    });

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
    expect(res.body.reason).toContain("already has a served journalist");
    expect(mockedCreateChildRun).not.toHaveBeenCalled();
  });

  // ── Refill on empty buffer ──────────────────────────────────────────

  it("refills buffer and serves top-1 when buffer is empty (first call)", async () => {
    setupRefillMocks();

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.journalist.firstName).toBe("Sarah");
    expect(res.body.journalist.relevanceScore).toBe(92);

    // Discovery was triggered
    expect(mockedDiscoverOutletArticles).toHaveBeenCalledTimes(1);
    expect(mockedChatComplete).toHaveBeenCalledTimes(1);

    // Sarah is served, Mike is still buffered
    const allCjs = await db
      .select()
      .from(campaignJournalists)
      .where(eq(campaignJournalists.campaignId, CAMPAIGN_ID));
    expect(allCjs).toHaveLength(2);

    const served = allCjs.filter((c) => c.status === "served");
    const buffered = allCjs.filter((c) => c.status === "buffered");
    expect(served).toHaveLength(1);
    expect(buffered).toHaveLength(1);
  });

  it("returns { found: false } when refill finds no journalists", async () => {
    mockedCreateChildRun.mockResolvedValue({
      id: CHILD_RUN_ID,
      parentRunId: "99999999-9999-9999-9999-999999999999",
      serviceName: "journalists-service",
      taskName: "buffer-next",
    });

    mockedExtractBrandFields.mockResolvedValue({
      brands: [{ brandId: BRAND_ID, domain: "techcorp.com", name: "TechCorp" }],
      fields: {
        brand_name: { value: "TechCorp", byBrand: { "techcorp.com": { value: "TechCorp", cached: false, extractedAt: "2026-03-01T00:00:00Z", expiresAt: null, sourceUrls: [] } } },
        brand_description: { value: "SaaS platform", byBrand: { "techcorp.com": { value: "SaaS platform", cached: false, extractedAt: "2026-03-01T00:00:00Z", expiresAt: null, sourceUrls: [] } } },
      },
    });
    mockedGetFieldValue.mockImplementation((_fields, key) => {
      if (key === "brand_name") return "TechCorp";
      if (key === "brand_description") return "SaaS platform";
      return "";
    });
    mockedFetchCampaign.mockResolvedValue({
      id: CAMPAIGN_ID,
      featureInputs: null,
      brandId: BRAND_ID,
    });
    mockedFetchOutlet.mockResolvedValue({
      id: OUTLET_ID,
      outletName: "Tiny Blog",
      outletUrl: "https://tinyblog.com",
    });
    mockedDiscoverOutletArticles.mockResolvedValue({ articles: [] });

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
    expect(res.body.journalist).toBeUndefined();
  });

  // ── Idempotency ─────────────────────────────────────────────────────

  it("returns cached response for duplicate idempotencyKey", async () => {
    const sarah = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Sarah Johnson",
      firstName: "Sarah",
      lastName: "Johnson",
    });

    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "92.00",
      status: "buffered",
    });

    mockedCreateChildRun.mockResolvedValue({
      id: CHILD_RUN_ID,
      parentRunId: "99999999-9999-9999-9999-999999999999",
      serviceName: "journalists-service",
      taskName: "buffer-next",
    });
    mockedFetchOutlet.mockResolvedValue({
      id: OUTLET_ID,
      outletName: "TechCrunch",
      outletUrl: "https://techcrunch.com",
    });

    const idempotencyKey = "test-idem-key-123";

    // First call — consumes Sarah
    const res1 = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID, idempotencyKey });

    expect(res1.status).toBe(200);
    expect(res1.body.found).toBe(true);
    expect(res1.body.journalist.firstName).toBe("Sarah");

    // Second call with same key — should return cached response, NOT consume another
    vi.resetAllMocks();

    const res2 = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID, idempotencyKey });

    expect(res2.status).toBe(200);
    expect(res2.body.found).toBe(true);
    expect(res2.body.journalist.firstName).toBe("Sarah");

    // No external calls on second request
    expect(mockedCreateChildRun).not.toHaveBeenCalled();
  });

  // ── Error handling ──────────────────────────────────────────────────

  it("returns 502 when runs-service fails", async () => {
    mockedCreateChildRun.mockRejectedValue(
      new Error("Runs-service unavailable")
    );

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Runs-service unavailable");
  });

  it("returns 502 when articles-service fails during refill", async () => {
    setupRefillMocks();
    mockedDiscoverOutletArticles.mockRejectedValue(
      new Error("Articles service failed")
    );

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Articles service failed");
  });

  // ── Outlet dedup gate ──────────────────────────────────────────────

  describe("outlet dedup gate", () => {
    it("blocks when a journalist from this outlet replied negatively < 12 months ago", async () => {
      const sarah = await insertTestJournalist({
        outletId: OUTLET_ID,
        journalistName: "Sarah Johnson",
        firstName: "Sarah",
        lastName: "Johnson",
      });

      await insertTestCampaignJournalist({
        journalistId: sarah.id,
        orgId: ORG_ID,
        brandIds: [BRAND_ID],
        campaignId: CAMPAIGN_ID,
        outletId: OUTLET_ID,
        relevanceScore: "92.00",
        status: "buffered",
      });

      mockedFetchLeadStatuses.mockResolvedValue([
        {
          leadId: "lead-1",
          email: "prev@techcrunch.com",
          journalistId: "prev-journalist-id",
          outletId: OUTLET_ID,
          contacted: true,
          delivered: true,
          bounced: false,
          replied: true,
          replyClassification: "negative",
          lastDeliveredAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
        },
      ]);

      const res = await request(app)
        .post("/buffer/next")
        .set(BUFFER_HEADERS)
        .send({ outletId: OUTLET_ID });

      expect(res.status).toBe(200);
      expect(res.body.found).toBe(false);
      expect(res.body.reason).toContain("replied negatively");
      // Should NOT create a child run — gate fires before run creation
      expect(mockedCreateChildRun).not.toHaveBeenCalled();
    });

    it("blocks when a journalist from this outlet replied positively", async () => {
      mockedFetchLeadStatuses.mockResolvedValue([
        {
          leadId: "lead-1",
          email: "prev@techcrunch.com",
          journalistId: "prev-journalist-id",
          outletId: OUTLET_ID,
          contacted: true,
          delivered: true,
          bounced: false,
          replied: true,
          replyClassification: "positive",
          lastDeliveredAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
        },
      ]);

      const res = await request(app)
        .post("/buffer/next")
        .set(BUFFER_HEADERS)
        .send({ outletId: OUTLET_ID });

      expect(res.status).toBe(200);
      expect(res.body.found).toBe(false);
      expect(res.body.reason).toContain("replied positively");
    });

    it("blocks when journalist contacted < 30 days ago with no reply", async () => {
      mockedFetchLeadStatuses.mockResolvedValue([
        {
          leadId: "lead-1",
          email: "prev@techcrunch.com",
          journalistId: "prev-journalist-id",
          outletId: OUTLET_ID,
          contacted: true,
          delivered: true,
          bounced: false,
          replied: false,
          replyClassification: null,
          lastDeliveredAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days ago
        },
      ]);

      const res = await request(app)
        .post("/buffer/next")
        .set(BUFFER_HEADERS)
        .send({ outletId: OUTLET_ID });

      expect(res.status).toBe(200);
      expect(res.body.found).toBe(false);
      expect(res.body.reason).toContain("waiting for reply");
    });

    it("allows when journalist contacted >= 30 days ago with no reply", async () => {
      const sarah = await insertTestJournalist({
        outletId: OUTLET_ID,
        journalistName: "Sarah Johnson",
        firstName: "Sarah",
        lastName: "Johnson",
      });

      await insertTestCampaignJournalist({
        journalistId: sarah.id,
        orgId: ORG_ID,
        brandIds: [BRAND_ID],
        campaignId: CAMPAIGN_ID,
        outletId: OUTLET_ID,
        relevanceScore: "92.00",
        status: "buffered",
      });

      mockedCreateChildRun.mockResolvedValue({
        id: CHILD_RUN_ID,
        parentRunId: "99999999-9999-9999-9999-999999999999",
        serviceName: "journalists-service",
        taskName: "buffer-next",
      });
      mockedFetchOutlet.mockResolvedValue({
        id: OUTLET_ID,
        outletName: "TechCrunch",
        outletUrl: "https://techcrunch.com",
      });

      mockedFetchLeadStatuses.mockResolvedValue([
        {
          leadId: "lead-1",
          email: "prev@techcrunch.com",
          journalistId: "prev-journalist-id",
          outletId: OUTLET_ID,
          contacted: true,
          delivered: true,
          bounced: false,
          replied: false,
          replyClassification: null,
          lastDeliveredAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago
        },
      ]);

      const res = await request(app)
        .post("/buffer/next")
        .set(BUFFER_HEADERS)
        .send({ outletId: OUTLET_ID });

      expect(res.status).toBe(200);
      expect(res.body.found).toBe(true);
      expect(res.body.journalist.firstName).toBe("Sarah");
    });

    it("allows when negative reply is older than 12 months", async () => {
      const sarah = await insertTestJournalist({
        outletId: OUTLET_ID,
        journalistName: "Sarah Johnson",
        firstName: "Sarah",
        lastName: "Johnson",
      });

      await insertTestCampaignJournalist({
        journalistId: sarah.id,
        orgId: ORG_ID,
        brandIds: [BRAND_ID],
        campaignId: CAMPAIGN_ID,
        outletId: OUTLET_ID,
        relevanceScore: "92.00",
        status: "buffered",
      });

      mockedCreateChildRun.mockResolvedValue({
        id: CHILD_RUN_ID,
        parentRunId: "99999999-9999-9999-9999-999999999999",
        serviceName: "journalists-service",
        taskName: "buffer-next",
      });
      mockedFetchOutlet.mockResolvedValue({
        id: OUTLET_ID,
        outletName: "TechCrunch",
        outletUrl: "https://techcrunch.com",
      });

      mockedFetchLeadStatuses.mockResolvedValue([
        {
          leadId: "lead-1",
          email: "prev@techcrunch.com",
          journalistId: "prev-journalist-id",
          outletId: OUTLET_ID,
          contacted: true,
          delivered: true,
          bounced: false,
          replied: true,
          replyClassification: "negative",
          lastDeliveredAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(), // 400 days ago
        },
      ]);

      const res = await request(app)
        .post("/buffer/next")
        .set(BUFFER_HEADERS)
        .send({ outletId: OUTLET_ID });

      expect(res.status).toBe(200);
      expect(res.body.found).toBe(true);
      expect(res.body.journalist.firstName).toBe("Sarah");
    });

    it("returns 502 when lead-service is unreachable for dedup check", async () => {
      mockedFetchLeadStatuses.mockRejectedValue(
        new Error("lead-service GET /leads/status failed (503)")
      );

      const res = await request(app)
        .post("/buffer/next")
        .set(BUFFER_HEADERS)
        .send({ outletId: OUTLET_ID });

      expect(res.status).toBe(502);
      expect(res.body.error).toContain("lead-service");
    });
  });
});
