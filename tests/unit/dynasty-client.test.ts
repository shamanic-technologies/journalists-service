import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveFeatureDynastySlugs,
  resolveWorkflowDynastySlugs,
  fetchFeatureDynasties,
  fetchWorkflowDynasties,
  buildSlugToDynastyMap,
} from "../../src/lib/dynasty-client.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const HEADERS = { "x-org-id": "org-1", "x-user-id": "user-1" };

beforeEach(() => {
  mockFetch.mockReset();
});

describe("resolveFeatureDynastySlugs", () => {
  it("returns slugs from features-service", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ slugs: ["feat-alpha", "feat-alpha-v2", "feat-alpha-v3"] }),
    });

    const slugs = await resolveFeatureDynastySlugs("feat-alpha", HEADERS);
    expect(slugs).toEqual(["feat-alpha", "feat-alpha-v2", "feat-alpha-v3"]);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/features/dynasty/slugs?dynastySlug=feat-alpha"),
      expect.objectContaining({ headers: expect.objectContaining({ "x-api-key": "test-features-key" }) })
    );
  });

  it("returns empty array on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "Not found" });
    const slugs = await resolveFeatureDynastySlugs("unknown", HEADERS);
    expect(slugs).toEqual([]);
  });
});

describe("resolveWorkflowDynastySlugs", () => {
  it("returns slugs from workflow-service", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ slugs: ["cold-email", "cold-email-v2"] }),
    });

    const slugs = await resolveWorkflowDynastySlugs("cold-email", HEADERS);
    expect(slugs).toEqual(["cold-email", "cold-email-v2"]);
  });

  it("returns empty array on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "Error" });
    const slugs = await resolveWorkflowDynastySlugs("bad", HEADERS);
    expect(slugs).toEqual([]);
  });
});

describe("fetchFeatureDynasties", () => {
  it("returns dynasties from features-service", async () => {
    const dynasties = [
      { dynastySlug: "feat-alpha", slugs: ["feat-alpha", "feat-alpha-v2"] },
    ];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ dynasties }) });

    const result = await fetchFeatureDynasties(HEADERS);
    expect(result).toEqual(dynasties);
  });

  it("returns empty array on failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await fetchFeatureDynasties(HEADERS);
    expect(result).toEqual([]);
  });
});

describe("fetchWorkflowDynasties", () => {
  it("returns dynasties from workflow-service", async () => {
    const dynasties = [
      { dynastySlug: "cold-email", slugs: ["cold-email", "cold-email-v2"] },
    ];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ dynasties }) });

    const result = await fetchWorkflowDynasties(HEADERS);
    expect(result).toEqual(dynasties);
  });
});

describe("buildSlugToDynastyMap", () => {
  it("builds reverse map from dynasties", () => {
    const dynasties = [
      { dynastySlug: "feat-alpha", slugs: ["feat-alpha", "feat-alpha-v2", "feat-alpha-v3"] },
      { dynastySlug: "feat-beta", slugs: ["feat-beta", "feat-beta-v2"] },
    ];

    const map = buildSlugToDynastyMap(dynasties);
    expect(map.get("feat-alpha")).toBe("feat-alpha");
    expect(map.get("feat-alpha-v2")).toBe("feat-alpha");
    expect(map.get("feat-alpha-v3")).toBe("feat-alpha");
    expect(map.get("feat-beta")).toBe("feat-beta");
    expect(map.get("feat-beta-v2")).toBe("feat-beta");
    expect(map.get("unknown")).toBeUndefined();
  });

  it("handles empty dynasties", () => {
    const map = buildSlugToDynastyMap([]);
    expect(map.size).toBe(0);
  });
});
