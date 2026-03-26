import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  closeDb,
} from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import { journalists } from "../../src/db/schema.js";

// Mock the Apollo client
vi.mock("../../src/lib/apollo-client.js", () => ({
  apolloMatchBulk: vi.fn(),
}));

// Mock the runs client
vi.mock("../../src/lib/runs-client.js", () => ({
  createChildRun: vi.fn(),
}));

import { apolloMatchBulk } from "../../src/lib/apollo-client.js";
import { createChildRun } from "../../src/lib/runs-client.js";

const mockedApolloMatchBulk = vi.mocked(apolloMatchBulk);
const mockedCreateChildRun = vi.mocked(createChildRun);

const app = createTestApp();

const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const PARENT_RUN_ID = "22222222-2222-2222-2222-222222222222";
const CHILD_RUN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BRAND_ID = "44444444-4444-4444-4444-444444444444";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";

describe("POST /journalists/discover-emails", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.clearAllMocks();
    mockedCreateChildRun.mockResolvedValue({
      run: {
        id: CHILD_RUN_ID,
        parentRunId: PARENT_RUN_ID,
        service: "journalists-service",
        operation: "discover-emails",
      },
    });
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
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      });

    expect(res.status).toBe(401);
  });

  it("returns 400 without x-org-id header", async () => {
    const res = await request(app)
      .post("/journalists/discover-emails")
      .set({ "x-api-key": "test-api-key", "x-user-id": "33333333-3333-3333-3333-333333333333" })
      .send({
        outletId: OUTLET_ID,
        organizationDomain: "example.com",
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("x-org-id header is required");
  });

  it("returns 400 without x-user-id header", async () => {
    const res = await request(app)
      .post("/journalists/discover-emails")
      .set({ "x-api-key": "test-api-key", "x-org-id": "22222222-2222-2222-2222-222222222222" })
      .send({
        outletId: OUTLET_ID,
        organizationDomain: "example.com",
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("x-user-id header is required");
  });

  it("returns 400 without x-run-id header", async () => {
    const res = await request(app)
      .post("/journalists/discover-emails")
      .set({ "x-api-key": "test-api-key", "x-org-id": "22222222-2222-2222-2222-222222222222", "x-user-id": "33333333-3333-3333-3333-333333333333" })
      .send({
        outletId: OUTLET_ID,
        organizationDomain: "example.com",
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("x-run-id header is required");
  });

  it("returns empty results when no journalists found for outlet", async () => {
    mockedApolloMatchBulk.mockResolvedValue({ results: [] });

    const res = await request(app)
      .post("/journalists/discover-emails")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        organizationDomain: "example.com",
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      });

    expect(res.status).toBe(200);
    expect(res.body.discovered).toBe(0);
    expect(res.body.total).toBe(0);
    expect(res.body.results).toEqual([]);
    // Should not call Apollo when no journalists exist
    expect(mockedApolloMatchBulk).not.toHaveBeenCalled();
  });

  it("creates a child run and calls Apollo with child run ID", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "John Doe",
      firstName: "John",
      lastName: "Doe",
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
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
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

    // Verify child run was created with x-run-id header as parentRunId
    expect(mockedCreateChildRun).toHaveBeenCalledWith(
      {
        parentRunId: "99999999-9999-9999-9999-999999999999",
        service: "journalists-service",
        operation: "discover-emails",
      },
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
      "test-feature"
    );

    // Verify Apollo was called with child run ID (not parent)
    expect(mockedApolloMatchBulk).toHaveBeenCalledWith(
      {
        items: [
          {
            firstName: "John",
            lastName: "Doe",
            organizationDomain: "example.com",
          },
        ],
        runId: CHILD_RUN_ID,
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      },
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
      CHILD_RUN_ID,
      "test-feature"
    );
  });

  it("skips journalists without firstName/lastName", async () => {
    const journalistWithName = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Jane Smith",
      firstName: "Jane",
      lastName: "Smith",
    });

    // Insert directly to get null firstName/lastName
    const [journalistNoName] = await db
      .insert(journalists)
      .values({
        outletId: OUTLET_ID,
        entityType: "organization",
        journalistName: "NoName Outlet",
      })
      .returning();

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
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
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
      outletId: OUTLET_ID,
      journalistName: "Alice One",
      firstName: "Alice",
      lastName: "One",
    });
    const j2 = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Bob Two",
      firstName: "Bob",
      lastName: "Two",
    });

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
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
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
      outletId: OUTLET_ID,
      journalistName: "Unknown Person",
      firstName: "Unknown",
      lastName: "Person",
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
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      });

    expect(res.status).toBe(200);
    expect(res.body.discovered).toBe(0);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].email).toBeNull();
  });

  it("batches Apollo calls for more than 10 journalists", async () => {
    // Create 12 journalists
    for (let i = 0; i < 12; i++) {
      await insertTestJournalist({
        outletId: OUTLET_ID,
        journalistName: `First${i} Last${i}`,
        firstName: `First${i}`,
        lastName: `Last${i}`,
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
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      });

    expect(res.status).toBe(200);
    expect(res.body.discovered).toBe(12);
    expect(res.body.results).toHaveLength(12);

    // Should have been called twice (batch of 10 + batch of 2)
    expect(mockedApolloMatchBulk).toHaveBeenCalledTimes(2);
    expect(mockedApolloMatchBulk.mock.calls[0][0].items).toHaveLength(10);
    expect(mockedApolloMatchBulk.mock.calls[1][0].items).toHaveLength(2);
  });

  it("returns 500 if runs-service call fails", async () => {
    const journalist = await insertTestJournalist({
      outletId: OUTLET_ID,
      journalistName: "Test Person",
      firstName: "Test",
      lastName: "Person",
    });

    mockedCreateChildRun.mockRejectedValue(
      new Error("Runs-service POST /v1/runs failed (503): Service unavailable")
    );

    const res = await request(app)
      .post("/journalists/discover-emails")
      .set(AUTH_HEADERS)
      .send({
        outletId: OUTLET_ID,
        organizationDomain: "example.com",
        brandId: BRAND_ID,
        campaignId: CAMPAIGN_ID,
      });

    expect(res.status).toBe(500);
  });
});
