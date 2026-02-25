import { Router } from "express";
import { db } from "../db/index.js";
import {
  huntedIndividuals,
  huntedEmails,
  searchedEmails,
} from "../db/schema.js";
import {
  CreateHuntedIndividualSchema,
  BulkHuntedIndividualsSchema,
  CreateHuntedEmailSchema,
  BulkHuntedEmailsSchema,
  CreateSearchedEmailSchema,
} from "../schemas.js";

const router = Router();

// POST /hunted-individuals
router.post("/hunted-individuals", async (req, res) => {
  const parsed = CreateHuntedIndividualSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { huntedAt, ...rest } = parsed.data;
  await db
    .insert(huntedIndividuals)
    .values({
      ...rest,
      huntedAt: new Date(huntedAt),
    })
    .onConflictDoNothing();

  res.status(201).json({ created: true });
});

// POST /hunted-individuals/bulk
router.post("/hunted-individuals/bulk", async (req, res) => {
  const parsed = BulkHuntedIndividualsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const values = parsed.data.items.map((item) => ({
    ...item,
    huntedAt: new Date(item.huntedAt),
    verificationDate: item.verificationDate || undefined,
  }));

  const result = await db
    .insert(huntedIndividuals)
    .values(values)
    .onConflictDoNothing()
    .returning();

  res.status(201).json({
    inserted: result.length,
    total: parsed.data.items.length,
  });
});

// POST /hunted-emails
router.post("/hunted-emails", async (req, res) => {
  const parsed = CreateHuntedEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { huntedAt, ...rest } = parsed.data;
  await db
    .insert(huntedEmails)
    .values({
      ...rest,
      huntedAt: new Date(huntedAt),
    })
    .onConflictDoNothing();

  res.status(201).json({ created: true });
});

// POST /hunted-emails/bulk
router.post("/hunted-emails/bulk", async (req, res) => {
  const parsed = BulkHuntedEmailsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const values = parsed.data.items.map((item) => ({
    ...item,
    huntedAt: new Date(item.huntedAt),
  }));

  const result = await db
    .insert(huntedEmails)
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
