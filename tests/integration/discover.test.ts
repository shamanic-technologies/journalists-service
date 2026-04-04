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
  closeRun: vi.fn(),
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

import { createChildRun, closeRun } from "../../src/lib/runs-client.js";
import { extractBrandFields, getFieldValue } from "../../src/lib/brand-client.js";
import { fetchCampaign } from "../../src/lib/campaign-client.js";
import { fetchOutlet } from "../../src/lib/outlets-client.js";
import { discoverOutletArticles } from "../../src/lib/articles-client.js";
import { chatComplete } from "../../src/lib/chat-client.js";

const mockedCreateChildRun = vi.mocked(createChildRun);
const mockedCloseRun = vi.mocked(closeRun);
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

const DISCOVER_HEADERS = {
  ...AUTH_HEADERS,
  "x-campaign-id": CAMPAIGN_ID,
  "x-brand-id": BRAND_ID,
};

function setupDiscoverMocks() {
  mockedCreateChildRun.mockResolvedValue({
    id: CHILD_RUN_ID,
    parentRunId: "99999999-9999-9999-9999-999999999999",
    serviceName: "journalists-service",
    taskName: "discover",
  });

  mockedCloseRun.mockResolvedValue(undefined);

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
          whyRelevant: "Covers SaaS and developer tools.",
          whyNotRelevant: "Some consumer tech coverage.",
          articleUrls: ["https://techcrunch.com/2026/01/15/top-saas-tools"],
        },
        {
          firstName: "Mike",
          lastName: "Chen",
          relevanceScore: 78,
          whyRelevant: "Covers AI funding rounds.",
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

describe("POST /discover", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.resetAllMocks();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  // ── Validation ──────────────────────────────────────────────────────

  it("returns 400 for invalid request body", async () => {
    const res = await request(app)
      .post("/discover")
      .set(DISCOVER_HEADERS)
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 without x-campaign-id header", async () => {
    const { "x-campaign-id": _, ...headersWithoutCampaign } = AUTH_HEADERS;
    const res = await request(app)
      .post("/discover")
      .set(headersWithoutCampaign)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-campaign-id");
  });

  it("returns 400 without x-brand-id header", async () => {
    const { "x-brand-id": _, ...headersWithoutBrand } = AUTH_HEADERS;
    const res = await request(app)
      .post("/discover")
      .set(headersWithoutBrand)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-brand-id");
  });

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/discover")
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(401);
  });

  // ── Discovery ───────────────────────────────────────────────────────

  it("discovers journalists and returns runId + count", async () => {
    setupDiscoverMocks();

    const res = await request(app)
      .post("/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.runId).toBe(CHILD_RUN_ID);
    expect(res.body.discovered).toBe(2);

    // Verify journalists were stored with runId and brandIds
    const cjs = await db
      .select()
      .from(campaignJournalists)
      .where(eq(campaignJournalists.campaignId, CAMPAIGN_ID));

    expect(cjs).toHaveLength(2);
    expect(cjs[0].runId).toBe(CHILD_RUN_ID);
    expect(cjs[1].runId).toBe(CHILD_RUN_ID);
    expect(cjs[0].status).toBe("buffered");
    expect(cjs[0].brandIds).toEqual([BRAND_ID]);

    // Run was closed as completed
    expect(mockedCloseRun).toHaveBeenCalledWith(
      CHILD_RUN_ID,
      "completed",
      expect.any(Object)
    );
  });

  it("stores multiple brand IDs from CSV header", async () => {
    setupDiscoverMocks();
    const BRAND_ID_2 = "44444444-4444-4444-4444-555555555555";

    const res = await request(app)
      .post("/discover")
      .set({ ...DISCOVER_HEADERS, "x-brand-id": `${BRAND_ID},${BRAND_ID_2}` })
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.discovered).toBe(2);

    const cjs = await db
      .select()
      .from(campaignJournalists)
      .where(eq(campaignJournalists.campaignId, CAMPAIGN_ID));

    expect(cjs[0].brandIds).toEqual([BRAND_ID, BRAND_ID_2]);
  });

  it("returns 0 discovered when no articles found", async () => {
    setupDiscoverMocks();
    mockedDiscoverOutletArticles.mockResolvedValue({ articles: [] });

    const res = await request(app)
      .post("/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.runId).toBe(CHILD_RUN_ID);
    expect(res.body.discovered).toBe(0);

    expect(mockedCloseRun).toHaveBeenCalledWith(
      CHILD_RUN_ID,
      "completed",
      expect.any(Object)
    );
  });

  it("skips journalists already in the campaign (dedup via onConflictDoNothing)", async () => {
    setupDiscoverMocks();

    // Pre-insert Sarah — she already exists for this campaign+outlet
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
      relevanceScore: "85.00",
    });

    const res = await request(app)
      .post("/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.runId).toBe(CHILD_RUN_ID);
    // storeJournalists returns 2 (both are processed), but Sarah's campaign_journalist insert is a no-op
    expect(res.body.discovered).toBe(2);

    // Only 2 campaign_journalist rows (Sarah's original + Mike's new one)
    const cjs = await db
      .select()
      .from(campaignJournalists)
      .where(eq(campaignJournalists.campaignId, CAMPAIGN_ID));
    expect(cjs).toHaveLength(2);
  });

  it("deduplicates journalists with case-insensitive name matching", async () => {
    setupDiscoverMocks();

    // Pre-insert "Sarah Johnson" with different casing
    const sarah = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "sarah johnson",
      firstName: "sarah",
      lastName: "johnson",
    });

    const res = await request(app)
      .post("/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);

    // Sarah should reuse the existing journalist record (case-insensitive match)
    const cjs = await db
      .select()
      .from(campaignJournalists)
      .where(eq(campaignJournalists.campaignId, CAMPAIGN_ID));

    // Both Sarah and Mike should be stored
    expect(cjs).toHaveLength(2);

    // Sarah's campaign_journalist should point to the original record
    const sarahCj = cjs.find((cj) => cj.journalistId === sarah.id);
    expect(sarahCj).toBeDefined();
  });

  it("closes run as failed on upstream error", async () => {
    setupDiscoverMocks();
    mockedDiscoverOutletArticles.mockRejectedValue(
      new Error("Articles service failed")
    );

    const res = await request(app)
      .post("/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Articles service failed");

    expect(mockedCloseRun).toHaveBeenCalledWith(
      CHILD_RUN_ID,
      "failed",
      expect.any(Object)
    );
  });

  it("returns 502 when runs-service fails", async () => {
    mockedCreateChildRun.mockRejectedValue(
      new Error("Runs-service unavailable")
    );

    const res = await request(app)
      .post("/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Runs-service unavailable");
  });
});
