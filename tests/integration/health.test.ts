import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";

const app = createTestApp();

describe("Health endpoint", () => {
  it("GET /health returns 200 with service info", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      service: "journalists-service",
    });
    expect(res.body.timestamp).toBeDefined();
  });

  it("GET /nonexistent returns 401 without auth", async () => {
    const res = await request(app).get("/nonexistent");
    expect(res.status).toBe(401);
  });

  it("GET /nonexistent returns 404 with auth", async () => {
    const res = await request(app).get("/nonexistent").set(AUTH_HEADERS);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});
