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
import { campaignJournalists, journalists, discoveryCache } from "../../src/db/schema.js";
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
  pullNextOutlet: vi.fn(),
}));

vi.mock("../../src/lib/articles-client.js", () => ({
  discoverOutletArticles: vi.fn(),
}));

vi.mock("../../src/lib/chat-client.js", () => ({
  chatComplete: vi.fn(),
}));

vi.mock("../../src/lib/apollo-client.js", () => ({
  matchPerson: vi.fn(),
}));

vi.mock("../../src/lib/email-gateway-client.js", () => ({
  checkEmailStatuses: vi.fn(),
}));

import { createChildRun } from "../../src/lib/runs-client.js";
import { extractBrandFields, getFieldValue } from "../../src/lib/brand-client.js";
import { fetchCampaign } from "../../src/lib/campaign-client.js";
import { fetchOutlet, pullNextOutlet } from "../../src/lib/outlets-client.js";
import { discoverOutletArticles } from "../../src/lib/articles-client.js";
import { chatComplete } from "../../src/lib/chat-client.js";
import { matchPerson } from "../../src/lib/apollo-client.js";
import { checkEmailStatuses } from "../../src/lib/email-gateway-client.js";

const mockedCreateChildRun = vi.mocked(createChildRun);
const mockedExtractBrandFields = vi.mocked(extractBrandFields);
const mockedGetFieldValue = vi.mocked(getFieldValue);
const mockedFetchCampaign = vi.mocked(fetchCampaign);
const mockedFetchOutlet = vi.mocked(fetchOutlet);
const mockedPullNextOutlet = vi.mocked(pullNextOutlet);
const mockedDiscoverOutletArticles = vi.mocked(discoverOutletArticles);
const mockedChatComplete = vi.mocked(chatComplete);
const mockedMatchPerson = vi.mocked(matchPerson);
const mockedCheckEmailStatuses = vi.mocked(checkEmailStatuses);

const app = createTestApp();

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const BRAND_ID = "44444444-4444-4444-4444-444444444444";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";
const OTHER_CAMPAIGN = "66666666-6666-6666-6666-666666666666";
const CHILD_RUN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const BUFFER_HEADERS = AUTH_HEADERS;

/** Seed discovery cache so processOutlet won't try to refill when buffer is exhausted */
async function seedDiscoveryCache(outletId = OUTLET_ID) {
  await db.insert(discoveryCache).values({
    orgId: ORG_ID,
    brandIds: [BRAND_ID],
    campaignId: CAMPAIGN_ID,
    outletId,
    discoveredAt: new Date(),
  }).onConflictDoUpdate({
    target: [discoveryCache.orgId, discoveryCache.campaignId, discoveryCache.outletId],
    set: { discoveredAt: new Date() },
  });
}

function setupBaseMocks() {
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

  // Default: email-gateway reports no prior contacts
  mockedCheckEmailStatuses.mockResolvedValue([]);
}

function setupApolloMock(email: string, apolloId = "apollo-person-1") {
  mockedMatchPerson.mockResolvedValue({
    enrichmentId: "enrich-1",
    person: {
      id: apolloId,
      firstName: "Sarah",
      lastName: "Johnson",
      email,
      emailStatus: "verified",
      title: "Senior Reporter",
      linkedinUrl: null,
      organizationName: "TechCrunch",
      organizationDomain: "techcrunch.com",
    },
    cached: false,
  });
}

function setupRefillMocks() {
  setupBaseMocks();

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
          whyRelevant: "Sarah Johnson covers SaaS and developer tools.",
          whyNotRelevant: "Some consumer tech coverage.",
          articleUrls: ["https://techcrunch.com/2026/01/15/top-saas-tools"],
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

  setupApolloMock("sarah.johnson@techcrunch.com");
}

function setupEmailGatewayNotContacted() {
  mockedCheckEmailStatuses.mockResolvedValue([
    {
      leadId: "any",
      email: "sarah.johnson@techcrunch.com",
      broadcast: {
        campaign: null,
        brand: {
          lead: { contacted: false, delivered: false, replied: false, replyClassification: null, lastDeliveredAt: null },
          email: { contacted: false, delivered: false, bounced: false, unsubscribed: false, lastDeliveredAt: null },
        },
        global: { email: { bounced: false, unsubscribed: false } },
      },
      transactional: {
        campaign: null,
        brand: {
          lead: { contacted: false, delivered: false, replied: false, replyClassification: null, lastDeliveredAt: null },
          email: { contacted: false, delivered: false, bounced: false, unsubscribed: false, lastDeliveredAt: null },
        },
        global: { email: { bounced: false, unsubscribed: false } },
      },
    },
  ]);
}

describe("POST /buffer/next", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.resetAllMocks();
    mockedCheckEmailStatuses.mockResolvedValue([]);
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  // ── Validation ──────────────────────────────────────────────────────

  it("returns 400 without x-campaign-id header", async () => {
    const { "x-campaign-id": _, ...headersWithoutCampaign } = AUTH_HEADERS;
    const res = await request(app)
      .post("/buffer/next")
      .set(headersWithoutCampaign)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-campaign-id");
  });

  it("returns 400 without x-brand-id header", async () => {
    const { "x-brand-id": _, ...headersWithoutBrand } = AUTH_HEADERS;
    const res = await request(app)
      .post("/buffer/next")
      .set(headersWithoutBrand)
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

  it("accepts request without outletId (orchestration mode)", async () => {
    setupBaseMocks();
    mockedPullNextOutlet.mockResolvedValue(null);

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  // ── With outletId: claim + Apollo + dedup ───────────────────────────

  it("claims journalist, resolves email via Apollo, returns enriched response", async () => {
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
      whyRelevant: "Covers SaaS",
      whyNotRelevant: "Some consumer tech",
      status: "buffered",
    });

    setupBaseMocks();
    setupApolloMock("sarah.johnson@techcrunch.com");
    setupEmailGatewayNotContacted();

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.journalist.firstName).toBe("Sarah");
    expect(res.body.journalist.email).toBe("sarah.johnson@techcrunch.com");
    expect(res.body.journalist.apolloPersonId).toBe("apollo-person-1");
    expect(res.body.journalist.outletId).toBe(OUTLET_ID);
    expect(res.body.journalist.outletName).toBe("TechCrunch");
    expect(res.body.journalist.outletDomain).toBe("techcrunch.com");

    // Sarah should be marked as served with email
    const sarahCj = await db
      .select()
      .from(campaignJournalists)
      .where(eq(campaignJournalists.journalistId, sarah.id));
    expect(sarahCj[0].status).toBe("served");
    expect(sarahCj[0].email).toBe("sarah.johnson@techcrunch.com");
    expect(sarahCj[0].apolloPersonId).toBe("apollo-person-1");
  });

  it("skips journalist with no Apollo email, serves next one", async () => {
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
      whyNotRelevant: "Consumer tech",
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

    setupBaseMocks();

    // Sarah: no email from Apollo
    mockedMatchPerson
      .mockResolvedValueOnce({
        enrichmentId: null,
        person: null,
        cached: false,
      })
      // Mike: has email
      .mockResolvedValueOnce({
        enrichmentId: "enrich-2",
        person: {
          id: "apollo-mike",
          firstName: "Mike",
          lastName: "Chen",
          email: "mike.chen@techcrunch.com",
          emailStatus: "verified",
          title: "Staff Writer",
          linkedinUrl: null,
          organizationName: "TechCrunch",
          organizationDomain: "techcrunch.com",
        },
        cached: false,
      });

    setupEmailGatewayNotContacted();

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.journalist.firstName).toBe("Mike");
    expect(res.body.journalist.email).toBe("mike.chen@techcrunch.com");

    // Sarah should be skipped
    const sarahCj = await db
      .select()
      .from(campaignJournalists)
      .where(eq(campaignJournalists.journalistId, sarah.id));
    expect(sarahCj[0].status).toBe("skipped");
  });

  // ── Apollo cache ───────────────────────────────────────────────────

  it("uses cached Apollo email instead of calling Apollo again", async () => {
    const sarah = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Sarah Johnson",
      firstName: "Sarah",
      lastName: "Johnson",
      apolloEmail: "sarah.cached@techcrunch.com",
      apolloEmailStatus: "verified",
      apolloPersonId: "apollo-cached-1",
      apolloCheckedAt: new Date(), // fresh cache
    });

    await insertTestCampaignJournalist({
      journalistId: sarah.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "92.00",
      whyRelevant: "Covers SaaS",
      whyNotRelevant: "Consumer tech",
      status: "buffered",
    });

    setupBaseMocks();
    setupEmailGatewayNotContacted();

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.journalist.email).toBe("sarah.cached@techcrunch.com");
    expect(res.body.journalist.apolloPersonId).toBe("apollo-cached-1");

    // Apollo should NOT have been called — cache hit
    expect(mockedMatchPerson).not.toHaveBeenCalled();
  });

  it("skips journalist with recent Apollo check and no email (cache hit)", async () => {
    const noEmail = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "No Email Person",
      firstName: "No",
      lastName: "Email",
      apolloCheckedAt: new Date(), // checked recently, no email found
      apolloEmail: null,
    });

    await insertTestCampaignJournalist({
      journalistId: noEmail.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "85.00",
      whyRelevant: "Covers tech",
      whyNotRelevant: "Low output",
      status: "buffered",
    });

    setupBaseMocks();
    await seedDiscoveryCache();

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);

    // Apollo should NOT have been called — cache says no email
    expect(mockedMatchPerson).not.toHaveBeenCalled();
  });

  it("calls Apollo when cache is stale (> 30 days)", async () => {
    const stale = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Stale Cache Person",
      firstName: "Stale",
      lastName: "Cache",
      apolloCheckedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), // 31 days ago
      apolloEmail: null,
    });

    await insertTestCampaignJournalist({
      journalistId: stale.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "85.00",
      whyRelevant: "Covers tech",
      whyNotRelevant: "Low output",
      status: "buffered",
    });

    setupBaseMocks();
    setupApolloMock("stale@techcrunch.com", "apollo-stale-1");
    setupEmailGatewayNotContacted();

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.journalist.email).toBe("stale@techcrunch.com");

    // Apollo WAS called because cache was stale
    expect(mockedMatchPerson).toHaveBeenCalledOnce();

    // Verify journalists table was updated with new Apollo data
    const updated = await db
      .select()
      .from(journalists)
      .where(eq(journalists.id, stale.id));
    expect(updated[0].apolloEmail).toBe("stale@techcrunch.com");
    expect(updated[0].apolloPersonId).toBe("apollo-stale-1");
    expect(updated[0].apolloCheckedAt).not.toBeNull();
  });

  it("stores Apollo no-email result on journalists table for future cache hits", async () => {
    const person = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Will Fail Apollo",
      firstName: "Will",
      lastName: "Fail",
    });

    await insertTestCampaignJournalist({
      journalistId: person.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "85.00",
      whyRelevant: "Covers tech",
      whyNotRelevant: "Low output",
      status: "buffered",
    });

    setupBaseMocks();
    mockedMatchPerson.mockResolvedValue({
      enrichmentId: null,
      person: null,
      cached: false,
    });
    await seedDiscoveryCache();

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);

    // Verify the journalists table was updated with apollo_checked_at
    const updated = await db
      .select()
      .from(journalists)
      .where(eq(journalists.id, person.id));
    expect(updated[0].apolloCheckedAt).not.toBeNull();
    expect(updated[0].apolloEmail).toBeNull();
  });

  // ── Relevance threshold ───────────────────────────────────────────

  it("skips journalists below relevance threshold (30)", async () => {
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

    // fetchOutlet is called before processOutlet
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
    expect(res.body.found).toBe(false);
    expect(res.body.reason).toContain("below relevance threshold");

    // Journalist should be marked as skipped
    const cj = await db
      .select()
      .from(campaignJournalists)
      .where(eq(campaignJournalists.journalistId, lowScore.id));
    expect(cj[0].status).toBe("skipped");
  });

  // ── Dedup by journalist_id (brand+org level) ─────────────────────────

  describe("dedup by journalist_id", () => {
    it("skips journalist already contacted for same brand+org in another campaign", async () => {
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
        brandIds: [BRAND_ID],
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
        brandIds: [BRAND_ID],
        campaignId: CAMPAIGN_ID,
        outletId: OUTLET_ID,
        relevanceScore: "92.00",
        status: "buffered",
      });

      await seedDiscoveryCache();
      setupBaseMocks();

      const res = await request(app)
        .post("/buffer/next")
        .set(BUFFER_HEADERS)
        .send({ outletId: OUTLET_ID });

      expect(res.status).toBe(200);
      // Sarah is skipped because journalist_id dedup fires before Apollo
      expect(res.body.found).toBe(false);
      // Apollo should NOT have been called (pre-check saves API credit)
      expect(mockedMatchPerson).not.toHaveBeenCalled();
    });

    it("skips journalist recently served (< 1h) for same brand+org", async () => {
      const sarah = await insertTestJournalist({
        outletId: OUTLET_ID,
        journalistName: "Sarah Johnson",
        firstName: "Sarah",
        lastName: "Johnson",
      });

      // Recently served in another campaign (within 1h race window)
      await insertTestCampaignJournalist({
        journalistId: sarah.id,
        orgId: ORG_ID,
        brandIds: [BRAND_ID],
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
        brandIds: [BRAND_ID],
        campaignId: CAMPAIGN_ID,
        outletId: OUTLET_ID,
        relevanceScore: "92.00",
        status: "buffered",
      });

      await seedDiscoveryCache();
      setupBaseMocks();

      const res = await request(app)
        .post("/buffer/next")
        .set(BUFFER_HEADERS)
        .send({ outletId: OUTLET_ID });

      expect(res.status).toBe(200);
      expect(res.body.found).toBe(false);
      expect(mockedMatchPerson).not.toHaveBeenCalled();
    });

    it("allows journalist served > 1h ago without contacted status", async () => {
      const sarah = await insertTestJournalist({
        outletId: OUTLET_ID,
        journalistName: "Sarah Johnson",
        firstName: "Sarah",
        lastName: "Johnson",
      });

      // Served > 1h ago in another campaign (race window expired, never became contacted)
      await insertTestCampaignJournalist({
        journalistId: sarah.id,
        orgId: ORG_ID,
        brandIds: [BRAND_ID],
        campaignId: OTHER_CAMPAIGN,
        outletId: OUTLET_ID,
        relevanceScore: "90.00",
        status: "served",
        email: "sarah@techcrunch.com",
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      });

      // Buffered in current campaign
      await insertTestCampaignJournalist({
        journalistId: sarah.id,
        orgId: ORG_ID,
        brandIds: [BRAND_ID],
        campaignId: CAMPAIGN_ID,
        outletId: OUTLET_ID,
        relevanceScore: "92.00",
        status: "buffered",
      });

      setupBaseMocks();
      setupApolloMock("sarah@techcrunch.com");
      setupEmailGatewayNotContacted();

      const res = await request(app)
        .post("/buffer/next")
        .set(BUFFER_HEADERS)
        .send({ outletId: OUTLET_ID });

      expect(res.status).toBe(200);
      expect(res.body.found).toBe(true);
      expect(res.body.journalist.firstName).toBe("Sarah");
    });
  });

  // ── Dedup by email (brand+org level) ─────────────────────────────────

  describe("dedup by email", () => {
    it("skips journalist whose email was already contacted for same brand+org", { timeout: 15000 }, async () => {
      const OUTLET_ID_2 = "22222222-1111-1111-1111-111111111111";

      // Different journalist at a different outlet, but same email
      const prev = await insertTestJournalist({
        outletId: OUTLET_ID_2,
        journalistName: "Sarah J",
        firstName: "Sarah",
        lastName: "J",
      });
      await insertTestCampaignJournalist({
        journalistId: prev.id,
        orgId: ORG_ID,
        brandIds: [BRAND_ID],
        campaignId: OTHER_CAMPAIGN,
        outletId: OUTLET_ID_2,
        relevanceScore: "85.00",
        status: "contacted",
        email: "sarah@techcrunch.com",
      });

      // New journalist at our outlet
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
        status: "buffered",
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

      setupBaseMocks();

      // Sarah resolves to same email as prev
      mockedMatchPerson
        .mockResolvedValueOnce({
          enrichmentId: "e1",
          person: {
            id: "apollo-sarah",
            firstName: "Sarah",
            lastName: "Johnson",
            email: "sarah@techcrunch.com",
            emailStatus: "verified",
            title: "Reporter",
            linkedinUrl: null,
            organizationName: "TechCrunch",
            organizationDomain: "techcrunch.com",
          },
          cached: false,
        })
        .mockResolvedValueOnce({
          enrichmentId: "e2",
          person: {
            id: "apollo-mike",
            firstName: "Mike",
            lastName: "Chen",
            email: "mike@techcrunch.com",
            emailStatus: "verified",
            title: "Writer",
            linkedinUrl: null,
            organizationName: "TechCrunch",
            organizationDomain: "techcrunch.com",
          },
          cached: false,
        });

      setupEmailGatewayNotContacted();

      const res = await request(app)
        .post("/buffer/next")
        .set(BUFFER_HEADERS)
        .send({ outletId: OUTLET_ID });

      expect(res.status).toBe(200);
      expect(res.body.found).toBe(true);
      // Sarah skipped (email dedup), Mike served
      expect(res.body.journalist.firstName).toBe("Mike");
      expect(res.body.journalist.email).toBe("mike@techcrunch.com");
    });
  });

  // ── Dedup by apollo_person_id (brand+org level) ──────────────────────

  describe("dedup by apollo_person_id", () => {
    it("skips journalist with same Apollo person ID already contacted for same brand+org", { timeout: 15000 }, async () => {
      const OUTLET_ID_2 = "22222222-1111-1111-1111-111111111111";

      // Previous journalist with same Apollo person ID, different email
      const prev = await insertTestJournalist({
        outletId: OUTLET_ID_2,
        journalistName: "S Johnson",
        firstName: "S",
        lastName: "Johnson",
      });
      await insertTestCampaignJournalist({
        journalistId: prev.id,
        orgId: ORG_ID,
        brandIds: [BRAND_ID],
        campaignId: OTHER_CAMPAIGN,
        outletId: OUTLET_ID_2,
        relevanceScore: "85.00",
        status: "contacted",
        email: "s.johnson@old-outlet.com",
        apolloPersonId: "apollo-same-person",
      });

      // New journalist
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
        status: "buffered",
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

      setupBaseMocks();

      // Sarah resolves to same Apollo person as prev (different email)
      mockedMatchPerson
        .mockResolvedValueOnce({
          enrichmentId: "e1",
          person: {
            id: "apollo-same-person",
            firstName: "Sarah",
            lastName: "Johnson",
            email: "sarah.new@techcrunch.com",
            emailStatus: "verified",
            title: "Reporter",
            linkedinUrl: null,
            organizationName: "TechCrunch",
            organizationDomain: "techcrunch.com",
          },
          cached: false,
        })
        .mockResolvedValueOnce({
          enrichmentId: "e2",
          person: {
            id: "apollo-mike",
            firstName: "Mike",
            lastName: "Chen",
            email: "mike@techcrunch.com",
            emailStatus: "verified",
            title: "Writer",
            linkedinUrl: null,
            organizationName: "TechCrunch",
            organizationDomain: "techcrunch.com",
          },
          cached: false,
        });

      setupEmailGatewayNotContacted();

      const res = await request(app)
        .post("/buffer/next")
        .set(BUFFER_HEADERS)
        .send({ outletId: OUTLET_ID });

      expect(res.status).toBe(200);
      expect(res.body.found).toBe(true);
      // Sarah skipped (apollo person dedup), Mike served
      expect(res.body.journalist.firstName).toBe("Mike");
    });
  });

  // ── Email-gateway: bounced / unsubscribed ────────────────────────────

  describe("email-gateway bounced/unsubscribed", () => {
    it("skips journalist whose email is globally bounced", async () => {
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

      await seedDiscoveryCache();
      setupBaseMocks();
      setupApolloMock("sarah@techcrunch.com");

      mockedCheckEmailStatuses.mockResolvedValue([
        {
          leadId: sarah.id,
          email: "sarah@techcrunch.com",
          broadcast: {
            campaign: null,
            brand: null,
            global: { email: { bounced: true, unsubscribed: false } },
          },
          transactional: {
            campaign: null,
            brand: null,
            global: { email: { bounced: false, unsubscribed: false } },
          },
        },
      ]);

      const res = await request(app)
        .post("/buffer/next")
        .set(BUFFER_HEADERS)
        .send({ outletId: OUTLET_ID });

      expect(res.status).toBe(200);
      expect(res.body.found).toBe(false);
    });

    it("skips journalist whose email is globally unsubscribed", async () => {
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

      await seedDiscoveryCache();
      setupBaseMocks();
      setupApolloMock("sarah@techcrunch.com");

      mockedCheckEmailStatuses.mockResolvedValue([
        {
          leadId: sarah.id,
          email: "sarah@techcrunch.com",
          broadcast: {
            campaign: null,
            brand: null,
            global: { email: { bounced: false, unsubscribed: true } },
          },
          transactional: {
            campaign: null,
            brand: null,
            global: { email: { bounced: false, unsubscribed: false } },
          },
        },
      ]);

      const res = await request(app)
        .post("/buffer/next")
        .set(BUFFER_HEADERS)
        .send({ outletId: OUTLET_ID });

      expect(res.status).toBe(200);
      expect(res.body.found).toBe(false);
    });
  });

  // ── Refill on empty buffer ──────────────────────────────────────────

  it("refills buffer and serves top-1 with email when buffer is empty", async () => {
    setupRefillMocks();
    setupEmailGatewayNotContacted();

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.journalist.firstName).toBe("Sarah");
    expect(res.body.journalist.email).toBe("sarah.johnson@techcrunch.com");
    expect(res.body.journalist.outletDomain).toBe("techcrunch.com");

    // Discovery was triggered
    expect(mockedDiscoverOutletArticles).toHaveBeenCalledTimes(1);
    // Apollo was called
    expect(mockedMatchPerson).toHaveBeenCalledTimes(1);
  });

  // ── Without outletId: orchestration mode ──────────────────────────

  it("pulls outlet from outlets-service when outletId not provided", async () => {
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

    setupBaseMocks();
    setupApolloMock("sarah@techcrunch.com");
    setupEmailGatewayNotContacted();

    mockedPullNextOutlet.mockResolvedValue({
      outletId: OUTLET_ID,
      outletName: "TechCrunch",
      outletUrl: "https://techcrunch.com",
      outletDomain: "techcrunch.com",
      campaignId: CAMPAIGN_ID,
      brandIds: [BRAND_ID],
      relevanceScore: 85,
      whyRelevant: "Top tech outlet",
      whyNotRelevant: "",
    });

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.journalist.email).toBe("sarah@techcrunch.com");
    expect(res.body.journalist.outletName).toBe("TechCrunch");
    expect(mockedPullNextOutlet).toHaveBeenCalledTimes(1);
  });

  it("tries multiple outlets until finding a journalist with email", async () => {
    const OUTLET_ID_2 = "22222222-1111-1111-1111-111111111111";

    // Outlet 1: journalist exists but no email from Apollo
    const noEmail = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "No Email Writer",
      firstName: "No",
      lastName: "Email",
    });
    await insertTestCampaignJournalist({
      journalistId: noEmail.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      relevanceScore: "80.00",
      status: "buffered",
    });

    // Seed discovery cache for outlet 1 so refill is skipped after buffer exhaustion
    const { discoveryCache } = await import("../../src/db/schema.js");
    await db.insert(discoveryCache).values({
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID,
      discoveredAt: new Date(),
    });

    // Outlet 2: journalist with email
    const hasEmail = await insertTestJournalist({
      outletId: OUTLET_ID_2,
      journalistName: "Has Email Writer",
      firstName: "Has",
      lastName: "Email",
    });
    await insertTestCampaignJournalist({
      journalistId: hasEmail.id,
      orgId: ORG_ID,
      brandIds: [BRAND_ID],
      campaignId: CAMPAIGN_ID,
      outletId: OUTLET_ID_2,
      relevanceScore: "75.00",
      status: "buffered",
    });

    setupBaseMocks();

    // Outlet 1: no email from Apollo
    mockedMatchPerson
      .mockResolvedValueOnce({ enrichmentId: null, person: null, cached: false })
      // Outlet 2: has email
      .mockResolvedValueOnce({
        enrichmentId: "e2",
        person: {
          id: "apollo-has-email",
          firstName: "Has",
          lastName: "Email",
          email: "has.email@outlet2.com",
          emailStatus: "verified",
          title: null,
          linkedinUrl: null,
          organizationName: null,
          organizationDomain: null,
        },
        cached: false,
      });

    setupEmailGatewayNotContacted();

    mockedPullNextOutlet
      .mockResolvedValueOnce({
        outletId: OUTLET_ID,
        outletName: "TechCrunch",
        outletUrl: "https://techcrunch.com",
        outletDomain: "techcrunch.com",
        campaignId: CAMPAIGN_ID,
        brandIds: [BRAND_ID],
        relevanceScore: 90,
        whyRelevant: "",
        whyNotRelevant: "",
      })
      .mockResolvedValueOnce({
        outletId: OUTLET_ID_2,
        outletName: "Outlet Two",
        outletUrl: "https://outlet2.com",
        outletDomain: "outlet2.com",
        campaignId: CAMPAIGN_ID,
        brandIds: [BRAND_ID],
        relevanceScore: 80,
        whyRelevant: "",
        whyNotRelevant: "",
      });

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.journalist.email).toBe("has.email@outlet2.com");
    expect(res.body.journalist.outletId).toBe(OUTLET_ID_2);
    expect(mockedPullNextOutlet).toHaveBeenCalledTimes(2);
  });

  it("returns { found: false } when no outlets have journalists with emails", async () => {
    setupBaseMocks();
    mockedPullNextOutlet.mockResolvedValue(null);

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
    expect(res.body.reason).toBe("no outlets available");
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

    setupBaseMocks();
    setupApolloMock("sarah@techcrunch.com");
    setupEmailGatewayNotContacted();

    const idempotencyKey = "test-idem-key-123";

    const res1 = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID, idempotencyKey });

    expect(res1.status).toBe(200);
    expect(res1.body.found).toBe(true);

    // Second call with same key
    vi.resetAllMocks();

    const res2 = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID, idempotencyKey });

    expect(res2.status).toBe(200);
    expect(res2.body.found).toBe(true);
    expect(res2.body.journalist.firstName).toBe("Sarah");
    expect(mockedCreateChildRun).not.toHaveBeenCalled();
  });

  // ── Error handling ──────────────────────────────────────────────────

  it("returns 502 when runs-service fails", async () => {
    mockedFetchOutlet.mockResolvedValue({
      id: OUTLET_ID,
      outletName: "TechCrunch",
      outletUrl: "https://techcrunch.com",
    });
    mockedCreateChildRun.mockRejectedValue(
      new Error("Runs-service unavailable")
    );
    mockedCheckEmailStatuses.mockResolvedValue([]);

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Runs-service unavailable");
  });

  it("returns 502 when Apollo service fails", async () => {
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

    setupBaseMocks();
    mockedMatchPerson.mockRejectedValue(
      new Error("Apollo POST /match failed (503)")
    );

    const res = await request(app)
      .post("/buffer/next")
      .set(BUFFER_HEADERS)
      .send({ outletId: OUTLET_ID });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Apollo");
  });
});
