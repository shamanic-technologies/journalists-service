import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  closeDb,
} from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import {
  pressJournalists,
  outletJournalists,
  campaignOutletJournalists,
} from "../../src/db/schema.js";
import { eq, and } from "drizzle-orm";

// Mock all external service clients
vi.mock("../../src/lib/runs-client.js", () => ({
  createChildRun: vi.fn(),
}));

vi.mock("../../src/lib/brand-client.js", () => ({
  fetchBrand: vi.fn(),
}));

vi.mock("../../src/lib/outlets-client.js", () => ({
  fetchOutlet: vi.fn(),
}));

vi.mock("../../src/lib/google-client.js", () => ({
  batchSearch: vi.fn(),
}));

vi.mock("../../src/lib/scraping-client.js", () => ({
  scrapeUrl: vi.fn(),
}));

vi.mock("../../src/lib/chat-client.js", () => ({
  chatComplete: vi.fn(),
}));

import { createChildRun } from "../../src/lib/runs-client.js";
import { fetchBrand } from "../../src/lib/brand-client.js";
import { fetchOutlet } from "../../src/lib/outlets-client.js";
import { batchSearch } from "../../src/lib/google-client.js";
import { scrapeUrl } from "../../src/lib/scraping-client.js";
import { chatComplete } from "../../src/lib/chat-client.js";

const mockedCreateChildRun = vi.mocked(createChildRun);
const mockedFetchBrand = vi.mocked(fetchBrand);
const mockedFetchOutlet = vi.mocked(fetchOutlet);
const mockedBatchSearch = vi.mocked(batchSearch);
const mockedScrapeUrl = vi.mocked(scrapeUrl);
const mockedChatComplete = vi.mocked(chatComplete);

const app = createTestApp();

const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const BRAND_ID = "44444444-4444-4444-4444-444444444444";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";
const CHILD_RUN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function setupDefaultMocks() {
  mockedCreateChildRun.mockResolvedValue({
    run: {
      id: CHILD_RUN_ID,
      parentRunId: "test-run-id",
      service: "journalists-service",
      operation: "discover-journalists",
    },
  });

  mockedFetchBrand.mockResolvedValue({
    id: BRAND_ID,
    name: "TechCorp",
    domain: "techcorp.com",
    brandUrl: "https://techcorp.com",
    elevatorPitch: "Enterprise SaaS platform for developer tools",
    bio: "TechCorp builds AI-powered developer tools",
    mission: "Empowering developers worldwide",
    location: "San Francisco, CA",
    categories: "SaaS, Developer Tools, AI",
  });

  mockedFetchOutlet.mockResolvedValue({
    id: OUTLET_ID,
    outletName: "TechCrunch",
    outletUrl: "https://techcrunch.com",
  });

  // LLM call 1: generate search queries
  mockedChatComplete.mockResolvedValueOnce({
    content: "",
    json: {
      queries: [
        { query: "site:techcrunch.com SaaS developer tools", type: "web" },
        { query: "site:techcrunch.com AI startup funding", type: "web" },
        { query: "TechCrunch SaaS developer tools", type: "news" },
      ],
    },
    tokensInput: 200,
    tokensOutput: 100,
    model: "claude-sonnet-4-6",
  });

  mockedBatchSearch.mockResolvedValue({
    results: [
      {
        query: "site:techcrunch.com SaaS developer tools",
        type: "web",
        results: [
          {
            title: "Top SaaS Tools for Developers in 2026",
            link: "https://techcrunch.com/2026/01/15/top-saas-tools",
            snippet: "By Sarah Johnson. The best developer tools...",
            domain: "techcrunch.com",
            position: 1,
          },
          {
            title: "AI-Powered Dev Tools Raise $50M",
            link: "https://techcrunch.com/2026/02/10/ai-dev-tools-funding",
            snippet: "By Mike Chen. AI developer tools are booming...",
            domain: "techcrunch.com",
            position: 2,
          },
        ],
      },
      {
        query: "site:techcrunch.com AI startup funding",
        type: "web",
        results: [
          {
            title: "Enterprise SaaS Funding Trends",
            link: "https://techcrunch.com/2026/03/01/enterprise-saas-trends",
            snippet: "By Sarah Johnson. Enterprise SaaS continues...",
            domain: "techcrunch.com",
            position: 1,
          },
        ],
      },
      {
        query: "TechCrunch SaaS developer tools",
        type: "news",
        results: [
          {
            title: "New Wave of Developer Platforms",
            link: "https://techcrunch.com/2026/03/20/new-developer-platforms",
            snippet: "The developer tools market is evolving...",
            source: "TechCrunch",
            date: "2026-03-20",
            domain: "techcrunch.com",
          },
        ],
      },
    ],
  });

  mockedScrapeUrl.mockImplementation(async (url) => ({
    cached: false,
    result: {
      id: `scrape-${url}`,
      url,
      companyName: null,
      description: null,
      rawMarkdown: `# Article\n\nBy Sarah Johnson\n\nThis is an article about SaaS tools and developer platforms. The market continues to grow as AI transforms how developers work.`,
    },
  }));

  // LLM call 2: extract + score journalists
  mockedChatComplete.mockResolvedValueOnce({
    content: "",
    json: {
      journalists: [
        {
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
        {
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
      ],
    },
    tokensInput: 1500,
    tokensOutput: 500,
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
      .set(AUTH_HEADERS)
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).post("/journalists/discover").send({
      outletId: OUTLET_ID,
      brandId: BRAND_ID,
      campaignId: CAMPAIGN_ID,
    });

    expect(res.status).toBe(401);
  });

  it("discovers journalists, stores them, and returns scored results", async () => {
    setupDefaultMocks();

    const res = await request(app)
      .post("/journalists/discover")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
        featureInputs: {
          journalistTypes: "tech reporters",
          geography: "US",
        },
      });

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
    expect(mockedCreateChildRun).toHaveBeenCalledWith(
      {
        parentRunId: "test-run-id",
        service: "journalists-service",
        operation: "discover-journalists",
      },
      "test-org-id",
      "test-user-id",
      "test-feature"
    );

    // Verify brand + outlet were fetched
    expect(mockedFetchBrand).toHaveBeenCalledWith(
      BRAND_ID,
      "test-org-id",
      "test-user-id",
      CHILD_RUN_ID,
      "test-feature"
    );
    expect(mockedFetchOutlet).toHaveBeenCalledWith(
      OUTLET_ID,
      "test-org-id",
      "test-user-id",
      CHILD_RUN_ID,
      "test-feature"
    );

    // Verify stored in DB
    const dbJournalists = await db
      .select()
      .from(pressJournalists)
      .where(eq(pressJournalists.entityType, "individual"));
    expect(dbJournalists).toHaveLength(2);

    const sarahDb = dbJournalists.find((j) => j.firstName === "Sarah");
    expect(sarahDb).toBeDefined();
    expect(sarahDb!.lastName).toBe("Johnson");
    expect(sarahDb!.journalistName).toBe("Sarah Johnson");

    // Verify outlet links
    const outletLinks = await db
      .select()
      .from(outletJournalists)
      .where(eq(outletJournalists.outletId, OUTLET_ID));
    expect(outletLinks).toHaveLength(2);

    // Verify campaign-outlet-journalist links with relevance
    const campaignLinks = await db
      .select()
      .from(campaignOutletJournalists)
      .where(eq(campaignOutletJournalists.campaignId, CAMPAIGN_ID));
    expect(campaignLinks).toHaveLength(2);

    const sarahCampaign = campaignLinks.find(
      (c) => c.journalistId === sarahDb!.id
    );
    expect(sarahCampaign).toBeDefined();
    expect(Number(sarahCampaign!.relevanceScore)).toBe(92);
    expect(sarahCampaign!.whyRelevant).toContain("Sarah Johnson");
  });

  it("marks existing journalists as isNew: false", async () => {
    // Pre-insert Sarah Johnson
    await insertTestJournalist({
      journalistName: "Sarah Johnson",
      firstName: "Sarah",
      lastName: "Johnson",
      entityType: "individual",
    });

    setupDefaultMocks();

    const res = await request(app)
      .post("/journalists/discover")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      });

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

  it("handles zero search results gracefully", async () => {
    mockedCreateChildRun.mockResolvedValue({
      run: {
        id: CHILD_RUN_ID,
        parentRunId: "test-run-id",
        service: "journalists-service",
        operation: "discover-journalists",
      },
    });

    mockedFetchBrand.mockResolvedValue({
      id: BRAND_ID,
      name: "NicheCorp",
      domain: "nichecorp.com",
      brandUrl: "https://nichecorp.com",
      elevatorPitch: "Niche product",
      bio: null,
      mission: null,
      location: null,
      categories: null,
    });

    mockedFetchOutlet.mockResolvedValue({
      id: OUTLET_ID,
      outletName: "Tiny Blog",
      outletUrl: "https://tinyblog.com",
    });

    // LLM generates queries
    mockedChatComplete.mockResolvedValueOnce({
      content: "",
      json: {
        queries: [
          { query: "site:tinyblog.com niche product", type: "web" },
        ],
      },
      tokensInput: 100,
      tokensOutput: 50,
      model: "claude-sonnet-4-6",
    });

    // Google returns nothing
    mockedBatchSearch.mockResolvedValue({
      results: [
        {
          query: "site:tinyblog.com niche product",
          type: "web",
          results: [],
        },
      ],
    });

    // LLM extraction (called with empty articles)
    mockedChatComplete.mockResolvedValueOnce({
      content: "",
      json: { journalists: [] },
      tokensInput: 100,
      tokensOutput: 20,
      model: "claude-sonnet-4-6",
    });

    const res = await request(app)
      .post("/journalists/discover")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      });

    expect(res.status).toBe(200);
    expect(res.body.journalists).toEqual([]);
    expect(res.body.totalArticlesSearched).toBe(0);
    expect(res.body.totalJournalistsStored).toBe(0);
  });

  it("handles scraping failures gracefully (falls back to snippets)", async () => {
    mockedCreateChildRun.mockResolvedValue({
      run: {
        id: CHILD_RUN_ID,
        parentRunId: "test-run-id",
        service: "journalists-service",
        operation: "discover-journalists",
      },
    });

    mockedFetchBrand.mockResolvedValue({
      id: BRAND_ID,
      name: "TechCorp",
      domain: "techcorp.com",
      brandUrl: "https://techcorp.com",
      elevatorPitch: "SaaS platform",
      bio: null,
      mission: null,
      location: null,
      categories: null,
    });

    mockedFetchOutlet.mockResolvedValue({
      id: OUTLET_ID,
      outletName: "TechCrunch",
      outletUrl: "https://techcrunch.com",
    });

    let chatCallCount = 0;
    mockedChatComplete.mockImplementation(async () => {
      chatCallCount++;
      if (chatCallCount === 1) {
        // Query generation
        return {
          content: "",
          json: {
            queries: [
              { query: "site:techcrunch.com SaaS", type: "web" },
            ],
          },
          tokensInput: 100,
          tokensOutput: 50,
          model: "claude-sonnet-4-6",
        };
      }
      // Extraction + scoring
      return {
        content: "",
        json: {
          journalists: [
            {
              firstName: "Jane",
              lastName: "Doe",
              relevanceScore: 70,
              whyRelevant: "Jane Doe writes about SaaS.",
              whyNotRelevant: "Limited data — only snippet available.",
              articleUrls: ["https://techcrunch.com/article-1"],
            },
          ],
        },
        tokensInput: 500,
        tokensOutput: 200,
        model: "claude-sonnet-4-6",
      };
    });

    mockedBatchSearch.mockResolvedValue({
      results: [
        {
          query: "site:techcrunch.com SaaS",
          type: "web",
          results: [
            {
              title: "SaaS Article by Jane Doe",
              link: "https://techcrunch.com/article-1",
              snippet: "By Jane Doe. Great SaaS content here.",
              domain: "techcrunch.com",
              position: 1,
            },
          ],
        },
      ],
    });

    // Scraping fails for all URLs
    mockedScrapeUrl.mockRejectedValue(new Error("Scraping failed"));

    const res = await request(app)
      .post("/journalists/discover")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      });

    expect(res.status).toBe(200);
    expect(chatCallCount).toBe(2); // query gen + extraction
    expect(res.body.totalArticlesSearched).toBe(1);
    expect(res.body.journalists).toHaveLength(1);
    expect(res.body.journalists[0].firstName).toBe("Jane");
  });

  it("returns 502 when runs-service fails", async () => {
    mockedCreateChildRun.mockRejectedValue(
      new Error("Runs-service unavailable")
    );

    const res = await request(app)
      .post("/journalists/discover")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Runs-service unavailable");
  });

  it("passes featureInputs to LLM query generation", async () => {
    setupDefaultMocks();

    await request(app)
      .post("/journalists/discover")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
        featureInputs: {
          journalistTypes: "tech reporters, AI specialists",
          geography: "US, UK",
          topics: "enterprise SaaS",
        },
      });

    // Verify first chatComplete call (query generation) includes feature inputs
    const queryGenCall = mockedChatComplete.mock.calls[0];
    expect(queryGenCall[0].message).toContain("journalistTypes");
    expect(queryGenCall[0].message).toContain("tech reporters, AI specialists");
    expect(queryGenCall[0].message).toContain("geography");
    expect(queryGenCall[0].message).toContain("US, UK");
  });

  it("respects maxArticles parameter", async () => {
    mockedCreateChildRun.mockResolvedValue({
      run: {
        id: CHILD_RUN_ID,
        parentRunId: "test-run-id",
        service: "journalists-service",
        operation: "discover-journalists",
      },
    });

    mockedFetchBrand.mockResolvedValue({
      id: BRAND_ID,
      name: "TechCorp",
      domain: "techcorp.com",
      brandUrl: "https://techcorp.com",
      elevatorPitch: "SaaS platform",
      bio: null,
      mission: null,
      location: null,
      categories: null,
    });

    mockedFetchOutlet.mockResolvedValue({
      id: OUTLET_ID,
      outletName: "TechCrunch",
      outletUrl: "https://techcrunch.com",
    });

    mockedChatComplete.mockResolvedValueOnce({
      content: "",
      json: {
        queries: [{ query: "site:techcrunch.com SaaS", type: "web" }],
      },
      tokensInput: 100,
      tokensOutput: 50,
      model: "claude-sonnet-4-6",
    });

    // Return 10 results
    mockedBatchSearch.mockResolvedValue({
      results: [
        {
          query: "site:techcrunch.com SaaS",
          type: "web",
          results: Array.from({ length: 10 }, (_, i) => ({
            title: `Article ${i}`,
            link: `https://techcrunch.com/article-${i}`,
            snippet: `Snippet ${i}`,
            domain: "techcrunch.com",
            position: i + 1,
          })),
        },
      ],
    });

    mockedScrapeUrl.mockResolvedValue({
      cached: false,
      result: {
        id: "scrape-id",
        url: "https://techcrunch.com/article",
        companyName: null,
        description: null,
        rawMarkdown: "# Article\nBy Test Author\nContent here.",
      },
    });

    mockedChatComplete.mockResolvedValueOnce({
      content: "",
      json: { journalists: [] },
      tokensInput: 500,
      tokensOutput: 50,
      model: "claude-sonnet-4-6",
    });

    await request(app)
      .post("/journalists/discover")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
        maxArticles: 3,
      });

    // Only 3 articles should be scraped (maxArticles = 3)
    expect(mockedScrapeUrl).toHaveBeenCalledTimes(3);
  });
});
