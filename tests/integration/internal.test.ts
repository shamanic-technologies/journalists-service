import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  closeDb,
} from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import { outletJournalists, searchedEmails } from "../../src/db/schema.js";

const app = createTestApp();

const OUTLET_ID = "11111111-1111-1111-1111-111111111111";

describe("Internal Endpoints", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /internal/journalists/by-outlet-with-emails/:outletId", () => {
    it("returns journalists with emails for outlet", async () => {
      const journalist = await insertTestJournalist({
        journalistName: "InternalTest",
        firstName: "Internal",
        lastName: "Test",
      });

      await db.insert(outletJournalists).values({
        outletId: OUTLET_ID,
        journalistId: journalist.id,
      });

      await db.insert(searchedEmails).values({
        outletId: OUTLET_ID,
        journalistId: journalist.id,
        searchedAt: new Date(),
        journalistEmail: "internal@test.com",
        sourceStatus: "Found online",
      });

      const res = await request(app)
        .get(`/internal/journalists/by-outlet-with-emails/${OUTLET_ID}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.journalists).toHaveLength(1);
      expect(res.body.journalists[0].emails).toHaveLength(1);
      expect(res.body.journalists[0].emails[0].email).toBe(
        "internal@test.com"
      );
    });

    it("returns empty for outlet with no journalists", async () => {
      const res = await request(app)
        .get(
          `/internal/journalists/by-outlet-with-emails/00000000-0000-0000-0000-000000000000`
        )
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.journalists).toEqual([]);
    });
  });

  describe("GET /internal/journalists/by-ids", () => {
    it("batch lookups by comma-separated IDs", async () => {
      const j1 = await insertTestJournalist({ journalistName: "Batch1" });
      const j2 = await insertTestJournalist({ journalistName: "Batch2" });

      const res = await request(app)
        .get(`/internal/journalists/by-ids?ids=${j1.id},${j2.id}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.journalists).toHaveLength(2);
    });

    it("returns 400 without ids param", async () => {
      const res = await request(app)
        .get("/internal/journalists/by-ids")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(400);
    });
  });
});
