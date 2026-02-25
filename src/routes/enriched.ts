import { Router } from "express";
import { db } from "../db/index.js";
import {
  enrichedIndividuals,
  enrichedEmails,
  searchedEmails,
} from "../db/schema.js";
import {
  CreateEnrichedIndividualSchema,
  BulkEnrichedIndividualsSchema,
  CreateEnrichedEmailSchema,
  BulkEnrichedEmailsSchema,
  CreateSearchedEmailSchema,
} from "../schemas.js";

const router = Router();

// POST /enriched-individuals
router.post("/enriched-individuals", async (req, res) => {
  const parsed = CreateEnrichedIndividualSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { enrichedAt, ...rest } = parsed.data;
  await db
    .insert(enrichedIndividuals)
    .values({
      ...rest,
      enrichedAt: new Date(enrichedAt),
    })
    .onConflictDoNothing();

  res.status(201).json({ created: true });
});

// POST /enriched-individuals/bulk
router.post("/enriched-individuals/bulk", async (req, res) => {
  const parsed = BulkEnrichedIndividualsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const values = parsed.data.items.map((item) => ({
    ...item,
    enrichedAt: new Date(item.enrichedAt),
    verificationDate: item.verificationDate || undefined,
  }));

  const result = await db
    .insert(enrichedIndividuals)
    .values(values)
    .onConflictDoNothing()
    .returning();

  res.status(201).json({
    inserted: result.length,
    total: parsed.data.items.length,
  });
});

// POST /enriched-emails
router.post("/enriched-emails", async (req, res) => {
  const parsed = CreateEnrichedEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { enrichedAt, ...rest } = parsed.data;
  await db
    .insert(enrichedEmails)
    .values({
      ...rest,
      enrichedAt: new Date(enrichedAt),
    })
    .onConflictDoNothing();

  res.status(201).json({ created: true });
});

// POST /enriched-emails/bulk
router.post("/enriched-emails/bulk", async (req, res) => {
  const parsed = BulkEnrichedEmailsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const values = parsed.data.items.map((item) => ({
    ...item,
    enrichedAt: new Date(item.enrichedAt),
  }));

  const result = await db
    .insert(enrichedEmails)
    .values(values)
    .onConflictDoNothing()
    .returning();

  res.status(201).json({
    inserted: result.length,
    total: parsed.data.items.length,
  });
});

// POST /searched-emails
router.post("/searched-emails", async (req, res) => {
  const parsed = CreateSearchedEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { searchedAt, ...rest } = parsed.data;
  await db
    .insert(searchedEmails)
    .values({
      ...rest,
      searchedAt: new Date(searchedAt),
    })
    .onConflictDoNothing();

  res.status(201).json({ created: true });
});

export default router;
