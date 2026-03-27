import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  closeDb,
} from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import {
  campaignJournalists,
  discoveryCache,
} from "../../src/db/schema.js";
import { eq, and } from "drizzle-orm";

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

import { createChildRun } from "../../src/lib/runs-client.js";
import { extractBrandFields, getFieldValue } from "../../src/lib/brand-client.js";
import { fetchCampaign } from "../../src/lib/campaign-client.js";
import { fetchOutlet } from "../../src/lib/outlets-client.js";
import { discoverOutletArticles } from "../../src/lib/articles-client.js";
import { chatComplete } from "../../src/lib/chat-client.js";

const mockedCreateChildRun = vi.mocked(createChildRun);
const mockedExtractBrandFields = vi.mocked(extractBrandFields);
const mockedGetFieldValue = vi.mocked(getFieldValue);
const mockedFetchCampaign = vi.mocked(fetchCampaign);
const mockedFetchOutlet = vi.mocked(fetchOutlet);
const mockedDiscoverOutletArticles = vi.mocked(discoverOutletArticles);
const mockedChatComplete = vi.mocked(chatComplete);

const app = createTestApp();

const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const BRAND_ID = "44444444-4444-4444-4444-444444444444";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";
const CHILD_RUN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const RESOLVE_HEADERS = {
  ...AUTH_HEADERS,
  "x-campaign-id": CAMPAIGN_ID,
  "x-brand-id": BRAND_ID,
};

function setupDiscoverMocks() {
  mockedCreateChildRun.mockResolvedValue({
    run: {
      id: CHILD_RUN_ID,
      parentRunId: "99999999-9999-9999-9999-999999999999",
      service: "journalists-service",
      operation: "resolve-journalists",
    },
  });

  mockedExtractBrandFields.mockResolvedValue({
    brandId: BRAND_ID,
    results: [
      { key: "brand_name", value: "TechCorp", cached: false },
      {
        key: "brand_description",
        value: "Enterprise SaaS platform for developer tools. TechCorp builds AI-powered developer tools. Empowering developers worldwide",
        cached: false,
      },
    ],
  });

  mockedGetFieldValue.mockImplementation((_results, key) => {
    if (key === "brand_name") return "TechCorp";
    if (key === "brand_description")
      return "Enterprise SaaS platform for developer tools. TechCorp builds AI-powered developer tools. Empowering developers worldwide";
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

  mockedChatComplete
    .mockResolvedValueOnce({
      content: "",
      json: {
        firstName: "Sarah",
        lastName: "Johnson",
        relevanceScore: 92,
        whyRelevant: "Sarah Johnson covers SaaS and developer tools.",
        whyNotRelevant: "Some consumer tech coverage.",
        articleUrls: ["https://techcrunch.com/2026/01/15/top-saas-tools"],
      },
      tokensInput: 500,
      tokensOutput: 200,
      model: "claude-sonnet-4-6",
    })
    .mockResolvedValueOnce({
      content: "",
      json: {
        firstName: "Mike",
        lastName: "Chen",
        relevanceScore: 78,
        whyRelevant: "Mike Chen covers AI funding rounds.",
        whyNotRelevant: "Focuses more on funding than products.",
        articleUrls: [
          "https://techcrunch.com/2026/02/10/ai-dev-tools-funding",
        ],
      },
      tokensInput: 500,
      tokensOutput: 200,
      model: "claude-sonnet-4-6",
    });
}

describe("POST /journalists/resolve", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.resetAllMocks();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("returns 400 without x-campaign-id header", async () => {
    const res = await request(app)
      .post("/journalists/resolve")
      .set(AUTH_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-campaign-id");
  });

  it("returns 400 without x-brand-id header", async () => {
    const res = await request(app)
      .post("/journalists/resolve")
      .set({ ...AUTH_HEADERS, "x-campaign-id": CAMPAIGN_ID })
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-brand-id");
  });

  it("returns 400 for invalid request body", async () => {
    const res = await request(app)
      .post("/journalists/resolve")
      .set(RESOLVE_HEADERS)
      .send({});

    expect(res.status).toBe(400);
  });

  it("discovers and scores journalists on first call (cache miss)", async () => {
    setupDiscoverMocks();

    const res = await request(app)
      .post("/journalists/resolve")
      .set(RESOLVE_HEADERS)
      .send({ outletId: OUTLET_ID, count: 20, acceptanceThreshold: 0 });

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.journalists).toHaveLength(2);

    // Sorted by relevance DESC
    expect(res.body.journalists[0].firstName).toBe("Sarah");
    expect(res.body.journalists[0].relevanceScore).toBe(92);
    expect(res.body.journalists[0].whyRelevant).toContain("Sarah Johnson");
    expect(res.body.journalists[0].articleUrls).toBeDefined();
    expect(res.body.journalists[1].firstName).toBe("Mike");
    expect(res.body.journalists[1].relevanceScore).toBe(78);

    // Discovery was triggered
    expect(mockedDiscoverOutletArticles).toHaveBeenCalledTimes(1);
    expect(mockedChatComplete).toHaveBeenCalledTimes(2);

    // Brand extract-fields was called (not fetchBrand)
    expect(mockedExtractBrandFields).toHaveBeenCalledTimes(1);

    // Campaign was fetched for featureInputs
    expect(mockedFetchCampaign).toHaveBeenCalledTimes(1);

    // Stored in DB
    const dbScores = await db
      .select()
      .from(campaignJournalists)
      .where(
        and(
          eq(campaignJournalists.campaignId, CAMPAIGN_ID),
          eq(campaignJournalists.outletId, OUTLET_ID)
        )
      );
    expect(dbScores).toHaveLength(2);

    // Discovery cache populated
    const cache = await db
      .select()
      .from(discoveryCache)
      .where(
        and(
          eq(discoveryCache.campaignId, CAMPAIGN_ID),
          eq(discoveryCache.outletId, OUTLET_ID)
        )
      );
    expect(cache).toHaveLength(1);
  });

  it("returns cached results on second call (cache hit)", async () => {
    // First call: discover + score
    setupDiscoverMocks();

    const res1 = await request(app)
      .post("/journalists/resolve")
      .set(RESOLVE_HEADERS)
      .send({ outletId: OUTLET_ID, count: 20, acceptanceThreshold: 0 });

    expect(res1.status).toBe(200);
    expect(res1.body.cached).toBe(false);

    // Reset mocks to verify they're NOT called on second request
    vi.resetAllMocks();

    // Second call: should be cached
    const res2 = await request(app)
      .post("/journalists/resolve")
      .set(RESOLVE_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res2.status).toBe(200);
    expect(res2.body.cached).toBe(true);
    expect(res2.body.journalists).toHaveLength(2);
    expect(res2.body.journalists[0].firstName).toBe("Sarah");
    expect(res2.body.journalists[0].relevanceScore).toBe(92);

    // No discovery or LLM calls on cached path
    expect(mockedDiscoverOutletArticles).not.toHaveBeenCalled();
    expect(mockedChatComplete).not.toHaveBeenCalled();
    expect(mockedCreateChildRun).not.toHaveBeenCalled();
  });

  it("returns 502 when runs-service fails", async () => {
    mockedCreateChildRun.mockRejectedValue(
      new Error("Runs-service unavailable")
    );

    const res = await request(app)
      .post("/journalists/resolve")
      .set(RESOLVE_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Runs-service unavailable");
  });

  it("returns 502 when articles-service fails", async () => {
    setupDiscoverMocks();
    mockedDiscoverOutletArticles.mockRejectedValue(
      new Error("Articles service failed")
    );

    const res = await request(app)
      .post("/journalists/resolve")
      .set(RESOLVE_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Articles service failed");
  });
});
