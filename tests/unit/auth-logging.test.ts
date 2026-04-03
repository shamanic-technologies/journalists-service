import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";

const app = createTestApp();

describe("Auth middleware logging", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a warning when x-api-key is missing", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await request(app).post("/buffer/next").send({ outletId: "11111111-1111-1111-1111-111111111111" });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("no x-api-key header")
    );
  });

  it("logs a warning when x-api-key is wrong", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await request(app)
      .post("/buffer/next")
      .set({ "x-api-key": "wrong-key" })
      .send({ outletId: "11111111-1111-1111-1111-111111111111" });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("api key mismatch")
    );
  });

  it("logs a warning when identity headers are missing", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await request(app)
      .post("/buffer/next")
      .set({ "x-api-key": "test-api-key" })
      .send({ outletId: "11111111-1111-1111-1111-111111111111" });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Missing required headers")
    );
  });

  it("does not log warnings for valid auth", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await request(app)
      .get("/campaign-outlet-journalists")
      .set(AUTH_HEADERS)
      .query({ brand_id: "44444444-4444-4444-4444-444444444444" });

    expect(spy).not.toHaveBeenCalledWith(
      expect.stringContaining("[journalists-service] Auth rejected")
    );
    expect(spy).not.toHaveBeenCalledWith(
      expect.stringContaining("Missing identity headers")
    );
  });
});
