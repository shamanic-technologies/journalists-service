import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ServiceContext } from "../../src/lib/service-context.js";

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

const FULL_CTX: ServiceContext = {
  orgId: "org-1",
  userId: "user-1",
  runId: "run-1",
  featureSlug: "test-feature",
  campaignId: "camp-1234",
  brandId: "brand-1",
  workflowSlug: "discover-journalists-wf",
};

const ALL_7_HEADERS = [
  "x-org-id",
  "x-user-id",
  "x-run-id",
  "x-feature-slug",
  "x-campaign-id",
  "x-brand-id",
  "x-workflow-slug",
] as const;

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
  const opts = call[1] as { headers: Record<string, string> } | undefined;
  return opts?.headers ?? (call[1] as Record<string, string>);
}

function expectAll7Headers(headers: Record<string, string>) {
  expect(headers["x-org-id"]).toBe(FULL_CTX.orgId);
  expect(headers["x-user-id"]).toBe(FULL_CTX.userId);
  expect(headers["x-run-id"]).toBe(FULL_CTX.runId);
  expect(headers["x-feature-slug"]).toBe(FULL_CTX.featureSlug);
  expect(headers["x-campaign-id"]).toBe(FULL_CTX.campaignId);
  expect(headers["x-brand-id"]).toBe(FULL_CTX.brandId);
  expect(headers["x-workflow-slug"]).toBe(FULL_CTX.workflowSlug);
}

describe("all 7 headers forwarded by every client", () => {
  beforeEach(() => {
    fetchSpy.mockReset();
  });

  it("runs-client forwards all 7 headers", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockOkResponse({ id: "child-1", parentRunId: "run-1", serviceName: "test", taskName: "test" })
    );

    const { createChildRun } = await import("../../src/lib/runs-client.js");
    await createChildRun(
      { parentRunId: FULL_CTX.runId, serviceName: "test-svc", taskName: "test-task" },
      FULL_CTX
    );

    const headers = getHeaders();
    expectAll7Headers(headers);
  });

  it("brand-client forwards all 7 headers", async () => {
    fetchSpy.mockResolvedValueOnce(mockOkResponse({ brandId: "b1", results: [] }));

    const { extractBrandFields } = await import("../../src/lib/brand-client.js");
    await extractBrandFields("brand-1", [], FULL_CTX);

    const headers = getHeaders();
    expectAll7Headers(headers);
  });

  it("campaign-client forwards all 7 headers", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockOkResponse({ campaign: { id: "c1", featureInputs: {}, brandId: "b1" } })
    );

    // Clear cache to force a fetch
    const { fetchCampaign, clearCampaignCache } = await import("../../src/lib/campaign-client.js");
    clearCampaignCache();
    await fetchCampaign("camp-1234", FULL_CTX);

    const headers = getHeaders();
    expectAll7Headers(headers);
  });

  it("chat-client forwards all 7 headers", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockOkResponse({ content: "ok", tokensInput: 1, tokensOutput: 1, model: "test" })
    );

    const { chatComplete } = await import("../../src/lib/chat-client.js");
    await chatComplete({ message: "hi", systemPrompt: "test" }, FULL_CTX);

    const headers = getHeaders();
    expectAll7Headers(headers);
  });

  it("articles-client forwards all 7 headers", async () => {
    fetchSpy.mockResolvedValueOnce(mockOkResponse({ articles: [] }));

    const { discoverOutletArticles } = await import("../../src/lib/articles-client.js");
    await discoverOutletArticles("example.com", 10, FULL_CTX);

    const headers = getHeaders();
    expectAll7Headers(headers);
  });

  it("outlets-client forwards all 7 headers", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockOkResponse({ id: "o1", outletName: "Test", outletUrl: "https://test.com" })
    );

    const { fetchOutlet } = await import("../../src/lib/outlets-client.js");
    await fetchOutlet("outlet-1", FULL_CTX);

    const headers = getHeaders();
    expectAll7Headers(headers);
  });

  it("outlets-client parses flat response (no wrapper)", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockOkResponse({ id: "o1", outletName: "Test Outlet", outletUrl: "https://test.com" })
    );

    const { fetchOutlet } = await import("../../src/lib/outlets-client.js");
    const result = await fetchOutlet("outlet-1", FULL_CTX);

    expect(result).toEqual({
      id: "o1",
      outletName: "Test Outlet",
      outletUrl: "https://test.com",
    });
  });

  it("omits optional headers when null", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockOkResponse({ content: "ok", tokensInput: 1, tokensOutput: 1, model: "test" })
    );

    const nullCtx: ServiceContext = {
      orgId: "org-1",
      userId: "user-1",
      runId: "run-1",
      featureSlug: null,
      campaignId: null,
      brandId: null,
      workflowSlug: null,
    };

    const { chatComplete } = await import("../../src/lib/chat-client.js");
    await chatComplete({ message: "hi", systemPrompt: "test" }, nullCtx);

    const headers = getHeaders();
    expect(headers["x-org-id"]).toBe("org-1");
    expect(headers["x-user-id"]).toBe("user-1");
    expect(headers["x-run-id"]).toBe("run-1");
    expect(headers["x-feature-slug"]).toBeUndefined();
    expect(headers["x-campaign-id"]).toBeUndefined();
    expect(headers["x-brand-id"]).toBeUndefined();
    expect(headers["x-workflow-slug"]).toBeUndefined();
  });
});
