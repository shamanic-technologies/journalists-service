import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  closeDb,
} from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import { journalists, campaignJournalists } from "../../src/db/schema.js";
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

const DISCOVER_HEADERS = {
  ...AUTH_HEADERS,
  "x-campaign-id": CAMPAIGN_ID,
  "x-brand-id": BRAND_ID,
};

function setupDefaultMocks() {
  mockedCreateChildRun.mockResolvedValue({
    run: {
      id: CHILD_RUN_ID,
      parentRunId: "99999999-9999-9999-9999-999999999999",
      service: "journalists-service",
      operation: "discover-journalists",
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
    featureInputs: {
      journalistTypes: "tech reporters",
      geography: "US",
    },
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

  // LLM calls: one per author (scored individually)
  mockedChatComplete
    .mockResolvedValueOnce({
      content: "",
      json: {
        firstName: "Sarah",
        lastName: "Johnson",
        relevanceScore: 92,
        whyRelevant:
          "Sarah Johnson is a senior tech reporter at TechCrunch who regularly covers SaaS and developer tools, perfectly aligned with TechCorp's market.",
        whyNotRelevant:
          "Some of her recent coverage has focused on consumer tech rather than enterprise.",
        articleUrls: [
          "https://techcrunch.com/2026/01/15/top-saas-tools",
          "https://techcrunch.com/2026/03/01/enterprise-saas-trends",
        ],
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
        whyRelevant:
          "Mike Chen covers AI and funding rounds at TechCrunch, relevant to TechCorp's AI-powered positioning.",
        whyNotRelevant:
          "His coverage tends to focus more on funding news than product reviews.",
        articleUrls: [
          "https://techcrunch.com/2026/02/10/ai-dev-tools-funding",
        ],
      },
      tokensInput: 500,
      tokensOutput: 200,
      model: "claude-sonnet-4-6",
    });
}

describe("POST /journalists/discover", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.resetAllMocks();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("returns 400 for invalid request body", async () => {
    const res = await request(app)
      .post("/journalists/discover")
      .set(DISCOVER_HEADERS)
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 without x-campaign-id header", async () => {
    const res = await request(app)
      .post("/journalists/discover")
      .set(AUTH_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-campaign-id");
  });

  it("returns 400 without x-brand-id header", async () => {
    const res = await request(app)
      .post("/journalists/discover")
      .set({ ...AUTH_HEADERS, "x-campaign-id": CAMPAIGN_ID })
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-brand-id");
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).post("/journalists/discover").send({
      outletId: OUTLET_ID,
    });

    expect(res.status).toBe(401);
  });

  it("discovers journalists, stores them, and returns scored results", async () => {
    setupDefaultMocks();

    const res = await request(app)
      .post("/journalists/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID, count: 20, acceptanceThreshold: 0 });

    expect(res.status).toBe(200);
    expect(res.body.journalists).toHaveLength(2);
    expect(res.body.totalJournalistsStored).toBe(2);

    // Should be sorted by relevance desc
    expect(res.body.journalists[0].firstName).toBe("Sarah");
    expect(res.body.journalists[0].relevanceScore).toBe(92);
    expect(res.body.journalists[0].isNew).toBe(true);
    expect(res.body.journalists[1].firstName).toBe("Mike");
    expect(res.body.journalists[1].relevanceScore).toBe(78);

    // Verify child run was created
    expect(mockedCreateChildRun).toHaveBeenCalledTimes(1);

    // Verify brand extract-fields was called
    expect(mockedExtractBrandFields).toHaveBeenCalledTimes(1);

    // Verify campaign was fetched for featureInputs
    expect(mockedFetchCampaign).toHaveBeenCalledTimes(1);

    expect(mockedFetchOutlet).toHaveBeenCalledTimes(1);

    // Verify articles-service was called
    expect(mockedDiscoverOutletArticles).toHaveBeenCalledTimes(1);

    // Verify stored in journalists table
    const dbJournalists = await db
      .select()
      .from(journalists)
      .where(eq(journalists.outletId, OUTLET_ID));
    expect(dbJournalists).toHaveLength(2);

    const sarahDb = dbJournalists.find((j) => j.firstName === "Sarah");
    expect(sarahDb).toBeDefined();
    expect(sarahDb!.lastName).toBe("Johnson");
    expect(sarahDb!.journalistName).toBe("Sarah Johnson");

    // Verify campaign_journalists with relevance scores
    const campaignLinks = await db
      .select()
      .from(campaignJournalists)
      .where(eq(campaignJournalists.campaignId, CAMPAIGN_ID));
    expect(campaignLinks).toHaveLength(2);

    const sarahCampaign = campaignLinks.find(
      (c) => c.journalistId === sarahDb!.id
    );
    expect(sarahCampaign).toBeDefined();
    expect(Number(sarahCampaign!.relevanceScore)).toBe(92);
    expect(sarahCampaign!.whyRelevant).toContain("Sarah Johnson");
    expect(sarahCampaign!.orgId).toBe("22222222-2222-2222-2222-222222222222");
    expect(sarahCampaign!.brandId).toBe(BRAND_ID);
  });

  it("marks existing journalists as isNew: false", async () => {
    // Pre-insert Sarah Johnson at this outlet
    await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Sarah Johnson",
      firstName: "Sarah",
      lastName: "Johnson",
      entityType: "individual",
    });

    setupDefaultMocks();

    const res = await request(app)
      .post("/journalists/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID, count: 20, acceptanceThreshold: 0 });

    expect(res.status).toBe(200);
    const sarah = res.body.journalists.find(
      (j: { firstName: string }) => j.firstName === "Sarah"
    );
    expect(sarah.isNew).toBe(false);

    const mike = res.body.journalists.find(
      (j: { firstName: string }) => j.firstName === "Mike"
    );
    expect(mike.isNew).toBe(true);
  });

  it("handles zero articles gracefully", async () => {
    mockedCreateChildRun.mockResolvedValue({
      run: {
        id: CHILD_RUN_ID,
        parentRunId: "99999999-9999-9999-9999-999999999999",
        service: "journalists-service",
        operation: "discover-journalists",
      },
    });

    mockedExtractBrandFields.mockResolvedValue({
      brandId: BRAND_ID,
      results: [
        { key: "brand_name", value: "NicheCorp", cached: false },
        { key: "brand_description", value: "Niche product", cached: false },
      ],
    });

    mockedGetFieldValue.mockImplementation((_results, key) => {
      if (key === "brand_name") return "NicheCorp";
      if (key === "brand_description") return "Niche product";
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

    // Articles-service returns no articles
    mockedDiscoverOutletArticles.mockResolvedValue({ articles: [] });

    const res = await request(app)
      .post("/journalists/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.journalists).toEqual([]);
    expect(res.body.totalJournalistsStored).toBe(0);

    // LLM should not be called when there are no authors
    expect(mockedChatComplete).not.toHaveBeenCalled();
  });

  it("returns 502 when articles-service fails", async () => {
    mockedCreateChildRun.mockResolvedValue({
      run: {
        id: CHILD_RUN_ID,
        parentRunId: "99999999-9999-9999-9999-999999999999",
        service: "journalists-service",
        operation: "discover-journalists",
      },
    });

    mockedExtractBrandFields.mockResolvedValue({
      brandId: BRAND_ID,
      results: [
        { key: "brand_name", value: "TechCorp", cached: false },
        { key: "brand_description", value: "SaaS platform", cached: false },
      ],
    });

    mockedGetFieldValue.mockImplementation((_results, key) => {
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
      outletName: "TechCrunch",
      outletUrl: "https://techcrunch.com",
    });

    mockedDiscoverOutletArticles.mockRejectedValue(
      new Error("Articles service POST /v1/discover/outlet-articles failed (500): Internal error")
    );

    const res = await request(app)
      .post("/journalists/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Articles service");
  });

  it("returns 502 when runs-service fails", async () => {
    mockedCreateChildRun.mockRejectedValue(
      new Error("Runs-service unavailable")
    );

    const res = await request(app)
      .post("/journalists/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Runs-service unavailable");
  });

  it("injects campaign context (featureInputs) into LLM scoring prompt", async () => {
    setupDefaultMocks();

    mockedFetchCampaign.mockResolvedValue({
      id: CAMPAIGN_ID,
      featureInputs: {
        journalistTypes: "tech reporters, AI specialists",
        geography: "US, UK",
        topics: "enterprise SaaS",
      },
      brandId: BRAND_ID,
    });

    await request(app)
      .post("/journalists/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID, count: 20, acceptanceThreshold: 0 });

    // Each author scored individually — verify first call includes campaign context
    expect(mockedChatComplete).toHaveBeenCalled();
    const scoringCall = mockedChatComplete.mock.calls[0];
    expect(scoringCall[0].message).toContain("journalistTypes");
    expect(scoringCall[0].message).toContain("tech reporters, AI specialists");
    expect(scoringCall[0].message).toContain("geography");
    expect(scoringCall[0].message).toContain("US, UK");
  });

  it("passes maxArticles to articles-service", async () => {
    setupDefaultMocks();

    await request(app)
      .post("/journalists/discover")
      .set(DISCOVER_HEADERS)
      .send({
        outletId: OUTLET_ID,
        maxArticles: 5,
      });

    expect(mockedDiscoverOutletArticles).toHaveBeenCalledWith(
      "techcrunch.com",
      5,
      expect.objectContaining({ orgId: "22222222-2222-2222-2222-222222222222" })
    );
  });

  it("deduplicates authors across multiple articles", async () => {
    mockedCreateChildRun.mockResolvedValue({
      run: {
        id: CHILD_RUN_ID,
        parentRunId: "99999999-9999-9999-9999-999999999999",
        service: "journalists-service",
        operation: "discover-journalists",
      },
    });

    mockedExtractBrandFields.mockResolvedValue({
      brandId: BRAND_ID,
      results: [
        { key: "brand_name", value: "TechCorp", cached: false },
        { key: "brand_description", value: "SaaS platform", cached: false },
      ],
    });

    mockedGetFieldValue.mockImplementation((_results, key) => {
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
      outletName: "TechCrunch",
      outletUrl: "https://techcrunch.com",
    });

    // Same author appears across 3 articles
    mockedDiscoverOutletArticles.mockResolvedValue({
      articles: [
        {
          url: "https://techcrunch.com/a1",
          title: "Article 1",
          snippet: null,
          publishedAt: "2026-01-01",
          authors: [{ firstName: "Sarah", lastName: "Johnson" }],
        },
        {
          url: "https://techcrunch.com/a2",
          title: "Article 2",
          snippet: null,
          publishedAt: "2026-02-01",
          authors: [{ firstName: "Sarah", lastName: "Johnson" }],
        },
        {
          url: "https://techcrunch.com/a3",
          title: "Article 3",
          snippet: null,
          publishedAt: "2026-03-01",
          authors: [{ firstName: "sarah", lastName: "johnson" }],
        },
      ],
    });

    mockedChatComplete.mockResolvedValueOnce({
      content: "",
      json: {
        firstName: "Sarah",
        lastName: "Johnson",
        relevanceScore: 85,
        whyRelevant: "Prolific writer",
        whyNotRelevant: "N/A",
        articleUrls: [
          "https://techcrunch.com/a1",
          "https://techcrunch.com/a2",
          "https://techcrunch.com/a3",
        ],
      },
      tokensInput: 500,
      tokensOutput: 200,
      model: "claude-sonnet-4-6",
    });

    const res = await request(app)
      .post("/journalists/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID, count: 20, acceptanceThreshold: 0 });

    expect(res.status).toBe(200);
    expect(res.body.totalJournalistsStored).toBe(1);

    // LLM prompt should include all 3 articles for Sarah (deduplicated)
    expect(mockedChatComplete).toHaveBeenCalledTimes(1);
    const scoringCall = mockedChatComplete.mock.calls[0];
    expect(scoringCall[0].message).toContain("Articles (3)");
  });

  it("stops scoring early when count=1 and first journalist meets threshold", async () => {
    setupDefaultMocks();

    const res = await request(app)
      .post("/journalists/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID, count: 1, acceptanceThreshold: 70 });

    expect(res.status).toBe(200);
    // Sarah has 2 articles (most prolific), scored first, gets 92 >= 70 → stop
    expect(res.body.journalists).toHaveLength(1);
    expect(res.body.journalists[0].firstName).toBe("Sarah");
    expect(res.body.journalists[0].relevanceScore).toBe(92);

    // Only 1 LLM call — Mike was never scored
    expect(mockedChatComplete).toHaveBeenCalledTimes(1);
  });

  it("continues scoring when first journalist is below threshold", async () => {
    mockedCreateChildRun.mockResolvedValue({
      run: {
        id: CHILD_RUN_ID,
        parentRunId: "99999999-9999-9999-9999-999999999999",
        service: "journalists-service",
        operation: "discover-journalists",
      },
    });

    mockedExtractBrandFields.mockResolvedValue({
      brandId: BRAND_ID,
      results: [
        { key: "brand_name", value: "TechCorp", cached: false },
        { key: "brand_description", value: "SaaS platform", cached: false },
      ],
    });

    mockedGetFieldValue.mockImplementation((_results, key) => {
      if (key === "brand_name") return "TechCorp";
      if (key === "brand_description") return "SaaS platform";
      return "";
    });

    mockedFetchCampaign.mockResolvedValue({
      id: CAMPAIGN_ID,
      featureInputs: {},
      brandId: BRAND_ID,
    });

    mockedFetchOutlet.mockResolvedValue({
      id: OUTLET_ID,
      outletName: "TechCrunch",
      outletUrl: "https://techcrunch.com",
    });

    // Two authors, each with 1 article
    mockedDiscoverOutletArticles.mockResolvedValue({
      articles: [
        {
          url: "https://techcrunch.com/a1",
          title: "Article 1",
          snippet: null,
          publishedAt: "2026-01-01",
          authors: [{ firstName: "Low", lastName: "Score" }],
        },
        {
          url: "https://techcrunch.com/a2",
          title: "Article 2",
          snippet: null,
          publishedAt: "2026-02-01",
          authors: [{ firstName: "High", lastName: "Score" }],
        },
      ],
    });

    // First author scores below threshold
    mockedChatComplete
      .mockResolvedValueOnce({
        content: "",
        json: {
          firstName: "Low",
          lastName: "Score",
          relevanceScore: 30,
          whyRelevant: "Some coverage",
          whyNotRelevant: "Not really relevant",
          articleUrls: ["https://techcrunch.com/a1"],
        },
        tokensInput: 300,
        tokensOutput: 100,
        model: "claude-sonnet-4-6",
      })
      // Second author scores above threshold
      .mockResolvedValueOnce({
        content: "",
        json: {
          firstName: "High",
          lastName: "Score",
          relevanceScore: 85,
          whyRelevant: "Very relevant",
          whyNotRelevant: "None",
          articleUrls: ["https://techcrunch.com/a2"],
        },
        tokensInput: 300,
        tokensOutput: 100,
        model: "claude-sonnet-4-6",
      });

    const res = await request(app)
      .post("/journalists/discover")
      .set(DISCOVER_HEADERS)
      .send({ outletId: OUTLET_ID, count: 1, acceptanceThreshold: 70 });

    expect(res.status).toBe(200);
    // Both were scored (first was below threshold, second met it)
    expect(mockedChatComplete).toHaveBeenCalledTimes(2);
    // Both stored, but sorted by relevance
    expect(res.body.journalists).toHaveLength(2);
    expect(res.body.journalists[0].firstName).toBe("High");
    expect(res.body.journalists[0].relevanceScore).toBe(85);
    expect(res.body.journalists[1].firstName).toBe("Low");
    expect(res.body.journalists[1].relevanceScore).toBe(30);
  });
});
