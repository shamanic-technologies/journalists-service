import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.RUNS_SERVICE_URL;
const originalKey = process.env.RUNS_SERVICE_API_KEY;

beforeEach(() => {
  process.env.RUNS_SERVICE_URL = "https://runs.test";
  process.env.RUNS_SERVICE_API_KEY = "test-key";
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.RUNS_SERVICE_URL = originalUrl;
  process.env.RUNS_SERVICE_API_KEY = originalKey;
});

// Dynamic import to pick up env vars set in beforeEach
async function loadTraceEvent() {
  // Clear module cache so env vars are re-read
  const mod = await import("../../src/lib/trace-event.js");
  return mod.traceEvent;
}

describe("traceEvent", () => {
  it("POSTs event to runs-service with correct URL, headers, and payload", async () => {
    const traceEvent = await loadTraceEvent();
    const headers: Record<string, string | string[] | undefined> = {
      "x-org-id": "org-1",
      "x-user-id": "user-1",
      "x-brand-id": "brand-1",
      "x-campaign-id": "camp-1",
      "x-workflow-slug": "wf-1",
      "x-feature-slug": "feat-1",
    };

    await traceEvent(
      "run-123",
      {
        service: "journalists-service",
        event: "test-event",
        detail: "some detail",
        level: "info",
        data: { foo: "bar" },
      },
      headers
    );

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://runs.test/v1/runs/run-123/events");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(opts.headers["x-api-key"]).toBe("test-key");
    expect(opts.headers["x-org-id"]).toBe("org-1");
    expect(opts.headers["x-user-id"]).toBe("user-1");
    expect(opts.headers["x-brand-id"]).toBe("brand-1");
    expect(opts.headers["x-campaign-id"]).toBe("camp-1");
    expect(opts.headers["x-workflow-slug"]).toBe("wf-1");
    expect(opts.headers["x-feature-slug"]).toBe("feat-1");

    const body = JSON.parse(opts.body);
    expect(body.service).toBe("journalists-service");
    expect(body.event).toBe("test-event");
    expect(body.detail).toBe("some detail");
    expect(body.level).toBe("info");
    expect(body.data).toEqual({ foo: "bar" });
  });

  it("skips when RUNS_SERVICE_URL is not set", async () => {
    delete process.env.RUNS_SERVICE_URL;
    const traceEvent = await loadTraceEvent();

    await traceEvent("run-1", { service: "journalists-service", event: "x" }, {});

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not throw on fetch failure", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network down"));
    const traceEvent = await loadTraceEvent();

    await expect(
      traceEvent("run-1", { service: "journalists-service", event: "x" }, {})
    ).resolves.toBeUndefined();
  });

  it("only forwards present identity headers", async () => {
    const traceEvent = await loadTraceEvent();
    const headers: Record<string, string | string[] | undefined> = {
      "x-org-id": "org-1",
      // others deliberately missing
    };

    await traceEvent("run-1", { service: "journalists-service", event: "x" }, headers);

    const [, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.headers["x-org-id"]).toBe("org-1");
    expect(opts.headers["x-user-id"]).toBeUndefined();
    expect(opts.headers["x-brand-id"]).toBeUndefined();
    expect(opts.headers["x-campaign-id"]).toBeUndefined();
    expect(opts.headers["x-workflow-slug"]).toBeUndefined();
    expect(opts.headers["x-feature-slug"]).toBeUndefined();
  });
});
