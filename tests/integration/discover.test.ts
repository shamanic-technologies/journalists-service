import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  closeDb,
} from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import { pressJournalists, outletJournalists, huntedIndividuals, huntedEmails } from "../../src/db/schema.js";
import { and, eq } from "drizzle-orm";

// Mock the Apollo client
vi.mock("../../src/lib/apollo-client.js", () => ({
  apolloMatchBulk: vi.fn(),
}));

import { apolloMatchBulk } from "../../src/lib/apollo-client.js";

const mockedApolloMatchBulk = vi.mocked(apolloMatchBulk);

const app = createTestApp();

const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const RUN_ID = "22222222-2222-2222-2222-222222222222";
const APP_ID = "33333333-3333-3333-3333-333333333333";
const BRAND_ID = "44444444-4444-4444-4444-444444444444";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";

describe("POST /journalists/discover-emails", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("returns 400 for invalid request body", async () => {
    const res = await request(app)
      .post("/journalists/discover-emails")
      .set(AUTH_HEADERS)
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/journalists/discover-emails")
      .send({
        outletId: OUTLET_ID,
        organizationDomain: "example.com",
        runId: RUN_ID,
        appId: APP_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
        clerkOrgId: "org_test123",
      });

    expect(res.status).toBe(401);
  });

  it("returns empty results when no journalists found for outlet", async () => {
    mockedApolloMatchBulk.mockResolvedValue({ results: [] });

    const res = await request(app)
      .post("/journalists/discover-emails")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        organizationDomain: "example.com",
        runId: RUN_ID,
        appId: APP_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
        clerkOrgId: "org_test123",
      });

    expect(res.status).toBe(200);
    expect(res.body.discovered).toBe(0);
    expect(res.body.total).toBe(0);
    expect(res.body.results).toEqual([]);
    // Should not call Apollo when no journalists exist
    expect(mockedApolloMatchBulk).not.toHaveBeenCalled();
  });

  it("calls Apollo and stores results for journalists with names", async () => {
    const journalist = await insertTestJournalist({
      journalistName: "DiscoverTest",
      firstName: "John",
      lastName: "Doe",
    });

    await db.insert(outletJournalists).values({
      outletId: OUTLET_ID,
      journalistId: journalist.id,
    });

    mockedApolloMatchBulk.mockResolvedValue({
      results: [
        {
          person: {
            id: "apollo-123",
            firstName: "John",
            lastName: "Doe",
            email: "john.doe@example.com",
            emailStatus: "verified",
            title: "Senior Reporter",
            linkedinUrl: "https://linkedin.com/in/johndoe",
            organizationName: "Example News",
            organizationDomain: "example.com",
            phoneNumbers: [],
          },
          enrichmentId: "enrich-abc",
          cached: false,
        },
      ],
    });

    const res = await request(app)
      .post("/journalists/discover-emails")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        organizationDomain: "example.com",
        runId: RUN_ID,
        appId: APP_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
        clerkOrgId: "org_test123",
      });

    expect(res.status).toBe(200);
    expect(res.body.discovered).toBe(1);
    expect(res.body.total).toBe(1);
    expect(res.body.skipped).toBe(0);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      journalistId: journalist.id,
      email: "john.doe@example.com",
      emailStatus: "verified",
      cached: false,
      enrichmentId: "enrich-abc",
    });

    // Verify Apollo was called correctly
    expect(mockedApolloMatchBulk).toHaveBeenCalledWith(
      {
        items: [
          {
            firstName: "John",
            lastName: "Doe",
            organizationDomain: "example.com",
          },
        ],
        runId: RUN_ID,
        appId: APP_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      },
      "org_test123"
    );

    // Verify data was stored in hunted_individuals
    const individuals = await db
      .select()
      .from(huntedIndividuals)
      .where(
        and(
          eq(huntedIndividuals.firstName, "John"),
          eq(huntedIndividuals.lastName, "Doe")
        )
      );
    expect(individuals).toHaveLength(1);
    expect(individuals[0].position).toBe("Senior Reporter");
    expect(individuals[0].linkedinUrl).toBe("https://linkedin.com/in/johndoe");
    expect(individuals[0].verificationStatus).toBe("valid");

    // Verify data was stored in hunted_emails
    const emails = await db
      .select()
      .from(huntedEmails)
      .where(
        eq(huntedEmails.email, "john.doe@example.com")
      );
    expect(emails).toHaveLength(1);
    expect(emails[0].status).toBe("valid");
  });

  it("skips journalists without firstName/lastName", async () => {
    const journalistWithName = await insertTestJournalist({
      journalistName: "WithName",
      firstName: "Jane",
      lastName: "Smith",
    });

    // Insert directly to get null firstName/lastName (helper defaults to "Test"/"Journalist")
    const [journalistNoName] = await db
      .insert(pressJournalists)
      .values({
        entityType: "organization",
        journalistName: "NoName Outlet",
      })
      .returning();

    await db.insert(outletJournalists).values([
      { outletId: OUTLET_ID, journalistId: journalistWithName.id },
      { outletId: OUTLET_ID, journalistId: journalistNoName.id },
    ]);

    mockedApolloMatchBulk.mockResolvedValue({
      results: [
        {
          person: {
            id: "apollo-456",
            firstName: "Jane",
            lastName: "Smith",
            email: "jane@example.com",
            emailStatus: "guessed",
            title: null,
            linkedinUrl: null,
            organizationName: null,
            organizationDomain: "example.com",
            phoneNumbers: [],
          },
          enrichmentId: "enrich-def",
          cached: true,
        },
      ],
    });

    const res = await request(app)
      .post("/journalists/discover-emails")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        organizationDomain: "example.com",
        runId: RUN_ID,
        appId: APP_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
        clerkOrgId: "org_test123",
      });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1); // only matchable
    expect(res.body.skipped).toBe(1); // journalistNoName
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].email).toBe("jane@example.com");
    expect(res.body.results[0].emailStatus).toBe("guessed");
  });

  it("filters by specific journalistIds when provided", async () => {
    const j1 = await insertTestJournalist({
      journalistName: "FilterJ1",
      firstName: "Alice",
      lastName: "One",
    });
    const j2 = await insertTestJournalist({
      journalistName: "FilterJ2",
      firstName: "Bob",
      lastName: "Two",
    });

    await db.insert(outletJournalists).values([
      { outletId: OUTLET_ID, journalistId: j1.id },
      { outletId: OUTLET_ID, journalistId: j2.id },
    ]);

    mockedApolloMatchBulk.mockResolvedValue({
      results: [
        {
          person: {
            id: "apollo-789",
            firstName: "Alice",
            lastName: "One",
            email: "alice@example.com",
            emailStatus: "verified",
            title: null,
            linkedinUrl: null,
            organizationName: null,
            organizationDomain: "example.com",
            phoneNumbers: [],
          },
          enrichmentId: "enrich-ghi",
          cached: false,
        },
      ],
    });

    const res = await request(app)
      .post("/journalists/discover-emails")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        organizationDomain: "example.com",
        journalistIds: [j1.id],
        runId: RUN_ID,
        appId: APP_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
        clerkOrgId: "org_test123",
      });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].journalistId).toBe(j1.id);

    // Apollo should only be called with j1
    expect(mockedApolloMatchBulk).toHaveBeenCalledTimes(1);
    const callArgs = mockedApolloMatchBulk.mock.calls[0][0];
    expect(callArgs.items).toHaveLength(1);
    expect(callArgs.items[0].firstName).toBe("Alice");
  });

  it("handles Apollo returning null person (no match)", async () => {
    const journalist = await insertTestJournalist({
      journalistName: "NoMatch",
      firstName: "Unknown",
      lastName: "Person",
    });

    await db.insert(outletJournalists).values({
      outletId: OUTLET_ID,
      journalistId: journalist.id,
    });

    mockedApolloMatchBulk.mockResolvedValue({
      results: [
        {
          person: null,
          enrichmentId: "enrich-null",
          cached: false,
        },
      ],
    });

    const res = await request(app)
      .post("/journalists/discover-emails")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        organizationDomain: "example.com",
        runId: RUN_ID,
        appId: APP_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
        clerkOrgId: "org_test123",
      });

    expect(res.status).toBe(200);
    expect(res.body.discovered).toBe(0);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].email).toBeNull();
  });

  it("batches Apollo calls for more than 10 journalists", async () => {
    // Create 12 journalists
    const journalists = [];
    for (let i = 0; i < 12; i++) {
      const j = await insertTestJournalist({
        journalistName: `Batch${i}`,
        firstName: `First${i}`,
        lastName: `Last${i}`,
      });
      journalists.push(j);
      await db.insert(outletJournalists).values({
        outletId: OUTLET_ID,
        journalistId: j.id,
      });
    }

    // First batch (10 items)
    mockedApolloMatchBulk.mockResolvedValueOnce({
      results: Array.from({ length: 10 }, (_, i) => ({
        person: {
          id: `apollo-batch-${i}`,
          firstName: `First${i}`,
          lastName: `Last${i}`,
          email: `first${i}@example.com`,
          emailStatus: "verified",
          title: null,
          linkedinUrl: null,
          organizationName: null,
          organizationDomain: "example.com",
          phoneNumbers: [],
        },
        enrichmentId: `enrich-batch-${i}`,
        cached: false,
      })),
    });

    // Second batch (2 items)
    mockedApolloMatchBulk.mockResolvedValueOnce({
      results: Array.from({ length: 2 }, (_, i) => ({
        person: {
          id: `apollo-batch-${i + 10}`,
          firstName: `First${i + 10}`,
          lastName: `Last${i + 10}`,
          email: `first${i + 10}@example.com`,
          emailStatus: "verified",
          title: null,
          linkedinUrl: null,
          organizationName: null,
          organizationDomain: "example.com",
          phoneNumbers: [],
        },
        enrichmentId: `enrich-batch-${i + 10}`,
        cached: false,
      })),
    });

    const res = await request(app)
      .post("/journalists/discover-emails")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        organizationDomain: "example.com",
        runId: RUN_ID,
        appId: APP_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
        clerkOrgId: "org_test123",
      });

    expect(res.status).toBe(200);
    expect(res.body.discovered).toBe(12);
    expect(res.body.results).toHaveLength(12);

    // Should have been called twice (batch of 10 + batch of 2)
    expect(mockedApolloMatchBulk).toHaveBeenCalledTimes(2);
    expect(mockedApolloMatchBulk.mock.calls[0][0].items).toHaveLength(10);
    expect(mockedApolloMatchBulk.mock.calls[1][0].items).toHaveLength(2);
  });
});
