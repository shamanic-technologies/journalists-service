import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Mock the DB module so this unit test doesn't need a real database connection
vi.mock("../../src/db/index.js", () => ({
  sql: {},
  db: {},
}));

import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";

const app = createTestApp();

describe("Auth middleware logging", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a warning when x-api-key is missing", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await request(app).post("/orgs/buffer/next").send({ outletId: "11111111-1111-1111-1111-111111111111" });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("no x-api-key header")
    );
  });

  it("logs a warning when x-api-key is wrong", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await request(app)
      .post("/orgs/buffer/next")
      .set({ "x-api-key": "wrong-key" })
      .send({ outletId: "11111111-1111-1111-1111-111111111111" });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("api key mismatch")
    );
  });

  it("logs a warning when identity headers are missing", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await request(app)
      .post("/orgs/buffer/next")
      .set({ "x-api-key": "test-api-key" })
      .send({ outletId: "11111111-1111-1111-1111-111111111111" });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Missing required header x-org-id")
    );
  });

  it("does not log warnings for valid auth", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // POST /buffer/next with valid auth but empty body — fails on Zod validation (400)
    // before reaching any DB calls, which is enough to verify auth doesn't warn
    await request(app)
      .post("/orgs/buffer/next")
      .set(AUTH_HEADERS)
      .send({});

    expect(spy).not.toHaveBeenCalledWith(
      expect.stringContaining("[journalists-service] Auth rejected")
    );
    expect(spy).not.toHaveBeenCalledWith(
      expect.stringContaining("Missing required header x-org-id")
    );
  });
});
