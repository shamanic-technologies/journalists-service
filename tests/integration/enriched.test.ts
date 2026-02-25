import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import { cleanTestData, insertTestJournalist, closeDb } from "../helpers/test-db.js";

const app = createTestApp();

describe("Enriched Data Endpoints", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("POST /enriched-individuals", () => {
    it("records an enriched individual", async () => {
      const res = await request(app)
        .post("/enriched-individuals")
        .set(AUTH_HEADERS)
        .send({
          firstName: "John",
          lastName: "Smith",
          domain: "example.com",
          enrichedAt: new Date().toISOString(),
          position: "Editor",
          company: "Example Corp",
        });

      expect(res.status).toBe(201);
      expect(res.body.created).toBe(true);
    });

    it("handles duplicate gracefully", async () => {
      const enrichedAt = new Date().toISOString();
      const body = {
        firstName: "John",
        lastName: "Smith",
        domain: "example.com",
        enrichedAt,
      };

      await request(app)
        .post("/enriched-individuals")
        .set(AUTH_HEADERS)
        .send(body);

      const res = await request(app)
        .post("/enriched-individuals")
        .set(AUTH_HEADERS)
        .send(body);

      expect(res.status).toBe(201);
    });
  });

  describe("POST /enriched-individuals/bulk", () => {
    it("bulk inserts individuals", async () => {
      const now = new Date().toISOString();
      const res = await request(app)
        .post("/enriched-individuals/bulk")
        .set(AUTH_HEADERS)
        .send({
          items: [
            {
              firstName: "A",
              lastName: "B",
              domain: "a.com",
              enrichedAt: now,
            },
            {
              firstName: "C",
              lastName: "D",
              domain: "c.com",
              enrichedAt: now,
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.inserted).toBe(2);
      expect(res.body.total).toBe(2);
    });

    it("returns 400 for empty items", async () => {
      const res = await request(app)
        .post("/enriched-individuals/bulk")
        .set(AUTH_HEADERS)
        .send({ items: [] });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /enriched-emails", () => {
    it("records an enriched email", async () => {
      const res = await request(app)
        .post("/enriched-emails")
        .set(AUTH_HEADERS)
        .send({
          email: "john@example.com",
          enrichedAt: new Date().toISOString(),
          status: "valid",
          score: 90,
        });

      expect(res.status).toBe(201);
      expect(res.body.created).toBe(true);
    });
  });

  describe("POST /enriched-emails/bulk", () => {
    it("bulk inserts emails", async () => {
      const now = new Date().toISOString();
      const res = await request(app)
        .post("/enriched-emails/bulk")
        .set(AUTH_HEADERS)
        .send({
          items: [
            { email: "a@a.com", enrichedAt: now, status: "valid" },
            { email: "b@b.com", enrichedAt: now, status: "unknown" },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.inserted).toBe(2);
      expect(res.body.total).toBe(2);
    });
  });

  describe("POST /searched-emails", () => {
    it("records a searched email", async () => {
      const journalist = await insertTestJournalist({
        journalistName: "SearchTest",
      });
      const outletId = "11111111-1111-1111-1111-111111111111";

      const res = await request(app)
        .post("/searched-emails")
        .set(AUTH_HEADERS)
        .send({
          outletId,
          journalistId: journalist.id,
          searchedAt: new Date().toISOString(),
          journalistEmail: "search@test.com",
          sourceStatus: "Found online",
          sourceQuote: "Found on their website",
        });

      expect(res.status).toBe(201);
      expect(res.body.created).toBe(true);
    });
  });
});
