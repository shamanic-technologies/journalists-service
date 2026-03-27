import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture fetch calls to inspect headers
const fetchSpy = vi.fn();

vi.stubGlobal("fetch", fetchSpy);

// Set env vars before importing clients
process.env.RUNS_SERVICE_URL = "http://runs";
process.env.RUNS_SERVICE_API_KEY = "runs-key";
process.env.BRAND_SERVICE_URL = "http://brand";
process.env.BRAND_SERVICE_API_KEY = "brand-key";
process.env.CHAT_SERVICE_URL = "http://chat";
process.env.CHAT_SERVICE_API_KEY = "chat-key";
process.env.ARTICLES_SERVICE_URL = "http://articles";
process.env.ARTICLES_SERVICE_API_KEY = "articles-key";
process.env.OUTLETS_SERVICE_URL = "http://outlets";
process.env.OUTLETS_SERVICE_API_KEY = "outlets-key";
process.env.CAMPAIGN_SERVICE_URL = "http://campaign";
process.env.CAMPAIGN_SERVICE_API_KEY = "campaign-key";

const CAMPAIGN_ID = "camp-1234";
const ORG_ID = "org-1";
const USER_ID = "user-1";
const RUN_ID = "run-1";
const FEATURE_SLUG = "test-feature";

function mockOkResponse(body: unknown = {}) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function getHeaders(): Record<string, string> {
  const call = fetchSpy.mock.calls[0];
  const opts = call[1] as { headers: Record<string, string> };
  return opts.headers;
}

describe("client header forwarding", () => {
  beforeEach(() => {
    fetchSpy.mockReset();
  });

  it("chat-client forwards x-campaign-id", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockOkResponse({ content: "ok", tokensInput: 1, tokensOutput: 1, model: "test" })
    );

    const { chatComplete } = await import("../../src/lib/chat-client.js");
    await chatComplete(
      { message: "hi", systemPrompt: "test" },
      ORG_ID, USER_ID, RUN_ID, FEATURE_SLUG, CAMPAIGN_ID
    );

    const headers = getHeaders();
    expect(headers["x-campaign-id"]).toBe(CAMPAIGN_ID);
    expect(headers["x-org-id"]).toBe(ORG_ID);
    expect(headers["x-user-id"]).toBe(USER_ID);
    expect(headers["x-run-id"]).toBe(RUN_ID);
    expect(headers["x-feature-slug"]).toBe(FEATURE_SLUG);
  });

  it("articles-client forwards x-campaign-id", async () => {
    fetchSpy.mockResolvedValueOnce(mockOkResponse({ articles: [] }));

    const { discoverOutletArticles } = await import("../../src/lib/articles-client.js");
    await discoverOutletArticles("example.com", 10, ORG_ID, USER_ID, RUN_ID, FEATURE_SLUG, CAMPAIGN_ID);

    const headers = getHeaders();
    expect(headers["x-campaign-id"]).toBe(CAMPAIGN_ID);
    expect(headers["x-org-id"]).toBe(ORG_ID);
    expect(headers["x-run-id"]).toBe(RUN_ID);
  });

  it("outlets-client forwards x-campaign-id", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockOkResponse({ outlet: { id: "o1", outletName: "Test", outletUrl: "https://test.com" } })
    );

    const { fetchOutlet } = await import("../../src/lib/outlets-client.js");
    await fetchOutlet("outlet-1", ORG_ID, USER_ID, RUN_ID, FEATURE_SLUG, CAMPAIGN_ID);

    const headers = getHeaders();
    expect(headers["x-campaign-id"]).toBe(CAMPAIGN_ID);
    expect(headers["x-org-id"]).toBe(ORG_ID);
    expect(headers["x-run-id"]).toBe(RUN_ID);
  });

  it("runs-client forwards x-campaign-id", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockOkResponse({ id: "child-1", parentRunId: RUN_ID, serviceName: "test", taskName: "test" })
    );

    const { createChildRun } = await import("../../src/lib/runs-client.js");
    await createChildRun(
      { parentRunId: RUN_ID, serviceName: "test-svc", taskName: "test-task" },
      ORG_ID, USER_ID, FEATURE_SLUG, CAMPAIGN_ID
    );

    const headers = getHeaders();
    expect(headers["x-campaign-id"]).toBe(CAMPAIGN_ID);
    expect(headers["x-org-id"]).toBe(ORG_ID);
    expect(headers["x-run-id"]).toBe(RUN_ID);
  });

  it("chat-client omits x-campaign-id when null", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockOkResponse({ content: "ok", tokensInput: 1, tokensOutput: 1, model: "test" })
    );

    const { chatComplete } = await import("../../src/lib/chat-client.js");
    await chatComplete(
      { message: "hi", systemPrompt: "test" },
      ORG_ID, USER_ID, RUN_ID, FEATURE_SLUG, null
    );

    const headers = getHeaders();
    expect(headers["x-campaign-id"]).toBeUndefined();
  });

  it("brand-client forwards x-campaign-id (already correct)", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockOkResponse({ brandId: "b1", results: [] })
    );

    const { extractBrandFields } = await import("../../src/lib/brand-client.js");
    await extractBrandFields("brand-1", [], ORG_ID, USER_ID, RUN_ID, CAMPAIGN_ID, FEATURE_SLUG);

    const headers = getHeaders();
    expect(headers["x-campaign-id"]).toBe(CAMPAIGN_ID);
    expect(headers["x-org-id"]).toBe(ORG_ID);
    expect(headers["x-run-id"]).toBe(RUN_ID);
  });
});
