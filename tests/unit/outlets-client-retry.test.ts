import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OrgContext } from "../../src/lib/service-context.js";

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);

const CTX: OrgContext = {
  orgId: "org-1",
  userId: "user-1",
  runId: "run-1",
  featureSlug: "test-feature",
  campaignId: "camp-1",
  brandIds: ["brand-1"],
  workflowSlug: "test-wf",
};

function mockOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function mockErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  };
}

function socketError(code = "UND_ERR_SOCKET"): TypeError {
  const err = new TypeError("fetch failed");
  (err as { cause?: { code: string; message: string } }).cause = {
    code,
    message: "other side closed",
  };
  return err;
}

describe("outlets-client retry behavior", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    warnSpy.mockRestore();
  });

  it("succeeds on first attempt without retry", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockOkResponse({ id: "o1", outletName: "T", outletUrl: "https://t.com" })
    );

    const { fetchOutlet } = await import("../../src/lib/outlets-client.js");
    const result = await fetchOutlet("o1", CTX);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.id).toBe("o1");
  });

  it("retries once on UND_ERR_SOCKET then succeeds", async () => {
    fetchSpy
      .mockRejectedValueOnce(socketError("UND_ERR_SOCKET"))
      .mockResolvedValueOnce(
        mockOkResponse({ id: "o2", outletName: "T", outletUrl: "https://t.com" })
      );

    const { fetchOutlet } = await import("../../src/lib/outlets-client.js");
    const promise = fetchOutlet("o2", CTX);

    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.id).toBe("o2");
  });

  it("retries on ECONNRESET then succeeds", async () => {
    fetchSpy
      .mockRejectedValueOnce(socketError("ECONNRESET"))
      .mockResolvedValueOnce(
        mockOkResponse({ id: "o3", outletName: "T", outletUrl: "https://t.com" })
      );

    const { fetchOutlet } = await import("../../src/lib/outlets-client.js");
    const promise = fetchOutlet("o3", CTX);

    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.id).toBe("o3");
  });

  it("retries up to 2 times then throws (3 attempts total)", async () => {
    fetchSpy
      .mockRejectedValueOnce(socketError())
      .mockRejectedValueOnce(socketError())
      .mockRejectedValueOnce(socketError());

    const { fetchOutlet } = await import("../../src/lib/outlets-client.js");
    const promise = fetchOutlet("o4", CTX);

    const expectation = expect(promise).rejects.toThrow("fetch failed");

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(300);
    await expectation;

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("does NOT retry on non-retryable TypeError", async () => {
    const err = new TypeError("invalid URL");
    fetchSpy.mockRejectedValueOnce(err);

    const { fetchOutlet } = await import("../../src/lib/outlets-client.js");
    await expect(fetchOutlet("o5", CTX)).rejects.toThrow("invalid URL");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on HTTP error responses (e.g. 500)", async () => {
    fetchSpy.mockResolvedValueOnce(mockErrorResponse(500, "boom"));

    const { fetchOutlet } = await import("../../src/lib/outlets-client.js");
    await expect(fetchOutlet("o6", CTX)).rejects.toThrow(/500/);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retry applies to pullNextOutlet", async () => {
    fetchSpy
      .mockRejectedValueOnce(socketError())
      .mockResolvedValueOnce(
        mockOkResponse({
          outlets: [
            {
              outletId: "o7",
              outletName: "T",
              outletUrl: "https://t.com",
              outletDomain: "t.com",
              campaignId: "camp-1",
              brandIds: ["brand-1"],
              relevanceScore: 0.9,
              whyRelevant: "x",
              whyNotRelevant: "",
            },
          ],
        })
      );

    const { pullNextOutlet } = await import("../../src/lib/outlets-client.js");
    const promise = pullNextOutlet(CTX);

    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result?.outletId).toBe("o7");
  });

  it("retry applies to fetchOutletsBatch", async () => {
    fetchSpy
      .mockRejectedValueOnce(socketError())
      .mockResolvedValueOnce(
        mockOkResponse({
          outlets: [{ id: "o8", outletName: "T", outletDomain: "t.com" }],
        })
      );

    const { fetchOutletsBatch } = await import("../../src/lib/outlets-client.js");
    const promise = fetchOutletsBatch(["o8"]);

    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.get("o8")?.outletName).toBe("T");
  });
});
