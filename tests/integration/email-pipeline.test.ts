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

describe("Email Pipeline Endpoints", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /journalists/emails/valid", () => {
    it("returns valid emails shape", async () => {
      const res = await request(app)
        .get("/journalists/emails/valid")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.emails).toEqual([]);
    });

    it("returns emails for an outlet journalist with searched email", async () => {
      const journalist = await insertTestJournalist({
        journalistName: "EmailTest",
        firstName: "Email",
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
        journalistEmail: "email@test.com",
        sourceStatus: "Found online",
      });

      const res = await request(app)
        .get(`/journalists/emails/valid?outlet_id=${OUTLET_ID}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.emails).toHaveLength(1);
      expect(res.body.emails[0].email).toBe("email@test.com");
    });
  });

  describe("GET /journalists/need-hunter", () => {
    it("returns journalists without hunter results", async () => {
      const journalist = await insertTestJournalist({
        journalistName: "NeedHunter",
        firstName: "Need",
        lastName: "Hunter",
      });

      await db.insert(outletJournalists).values({
        outletId: OUTLET_ID,
        journalistId: journalist.id,
      });

      const res = await request(app)
        .get("/journalists/need-hunter")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.journalists.length).toBeGreaterThanOrEqual(1);
      expect(
        res.body.journalists.some(
          (j: { journalist_id: string }) =>
            j.journalist_id === journalist.id
        )
      ).toBe(true);
    });
  });

  describe("GET /journalists/need-agent-search", () => {
    it("returns journalists without searched emails", async () => {
      const journalist = await insertTestJournalist({
        journalistName: "NeedSearch",
        firstName: "Need",
        lastName: "Search",
      });

      await db.insert(outletJournalists).values({
        outletId: OUTLET_ID,
        journalistId: journalist.id,
      });

      const res = await request(app)
        .get("/journalists/need-agent-search")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.journalists.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /journalists/need-email-update", () => {
    it("supports pagination", async () => {
      const res = await request(app)
        .get("/journalists/need-email-update?limit=10&offset=0")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.journalists).toBeDefined();
    });
  });

  describe("GET /journalists/emails/need-hunter-verification", () => {
    it("returns emails without verification", async () => {
      const journalist = await insertTestJournalist({
        journalistName: "VerifyTest",
      });

      await db.insert(searchedEmails).values({
        outletId: OUTLET_ID,
        journalistId: journalist.id,
        searchedAt: new Date(),
        journalistEmail: "verify@test.com",
      });

      const res = await request(app)
        .get("/journalists/emails/need-hunter-verification")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.emails.length).toBeGreaterThanOrEqual(1);
      expect(
        res.body.emails.some(
          (e: { email: string }) => e.email === "verify@test.com"
        )
      ).toBe(true);
    });
  });

  describe("GET /journalists/emails/searched-events", () => {
    it("returns searched events", async () => {
      const res = await request(app)
        .get("/journalists/emails/searched-events")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.events).toBeDefined();
    });
  });
});
