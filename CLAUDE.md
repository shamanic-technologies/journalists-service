# journalists-service — Business Logic Reference

## 1. `checkOutletBlocked` — Is this outlet blocked?

Called by outlets-service via `GET /internal/outlets/blocked` and internally by `processOutlet`.

**Inputs:** `orgId`, `brandIds[]`, `outletId`

**Rule: blocked = true for the outlet if, for ANY brandId in the list, the following holds:**

### Condition A — Someone already reached at this outlet for this brand

At least one journalist exists for this `orgId × brandId × outletId` with:
- status `contacted` AND `contacted < 30 days ago`
- OR status `served` / `claimed` AND `created_at < 1 hour ago` (race window — not yet confirmed as contacted)
- OR replied negative (via email-gateway: `broadcast.brand.lead.replied = true` AND `replyClassification = "negative"`) AND reply `< 6 months ago`
- OR replied positive (via email-gateway: `broadcast.brand.lead.replied = true` AND `replyClassification = "positive"`) AND reply `< 6 months ago`

### OR Condition B — Discovery done but no viable journalists

ALL of the following:
- Discovery happened for this `orgId × brandId × outletId` less than 30 days ago
- AND at least one of:
  - There are 0 journalists for this outlet
  - OR none of them have a valid email (Apollo checked < 30 days, no email found)
  - OR none of them have relevance > 30%

### Reply data source

Reply status comes from email-gateway `POST /status` endpoint:
- `broadcast.brand.lead.replied` — whether the lead replied at brand scope
- `broadcast.brand.lead.replyClassification` — `"positive"`, `"negative"`, `"neutral"`, or `null`
- `broadcast.brand.lead.lastDeliveredAt` — timestamp to compute recency

### Edge cases

- **Empty brand list** — should not happen (middleware guarantees at least one)
- **No discovery ever done** — Condition B cannot be true (no discovery < 30d). Condition A might still be true if the journalist was contacted via another path.

---

## 2. `resolveAndCheckEmail` — Select and validate the next journalist

Called by `processOutlet` in `buffer-next.ts`. For each claimed journalist, determines whether they have a valid, non-duplicate email.

**Flow (in order):**

### Step 1 — Pre-check: journalist_id dedup
Before calling Apollo (to save API credits), check if this `journalist_id` was already contacted for any brand in `brandIds` at this `orgId`.

"Contacted" = `status = 'contacted'` OR (`status IN ('claimed', 'served')` AND `created_at >= now - 1h`).

Uses `excludeId` to avoid self-matching the just-claimed row.

If already contacted → skip (return null).

### Step 2 — Name check
If `firstName` or `lastName` is missing → skip (Apollo needs both).

### Step 3 — Apollo email resolution (with cache)
Check global `journalists` table for cached Apollo results:
- If `apollo_checked_at < 30 days` AND `apollo_email IS NULL` → skip (Apollo already said no email)
- If `apollo_checked_at < 30 days` AND `apollo_email IS NOT NULL` → use cached email
- Otherwise → call Apollo API, then store results on `journalists` table (even if no email, to cache the "no email" result)

If no email after this step → skip.

### Step 4 — Email quality check
Reject if Apollo's `emailStatus` is not in `["verified", "extrapolated"]` (e.g. "bounced", "unavailable").

### Step 5 — Full dedup (3 axes)
Check all three dedup axes at `orgId × brandIds` scope:
1. **By journalist_id** (already done in step 1, but re-checked with full context)
2. **By email** — same email contacted for same brand+org in another campaign_journalists row
3. **By apollo_person_id** — same Apollo person contacted for same brand+org (covers case where same person has different emails)

Each axis uses the same "contacted" definition (status = contacted OR recent claimed/served).

If any axis matches → skip.

### Step 6 — Email-gateway bounce/unsubscribe/contacted check
Call email-gateway `POST /status` and check:
- `broadcast.global.email.bounced` → skip
- `broadcast.global.email.unsubscribed` → skip
- `broadcast.brand.contacted` → skip (already contacted for this brand via any pipeline)

### Step 7 — Success
Return `{ email, apolloPersonId }`. The journalist will be marked as `served`.

### Claim loop
`processOutlet` loops through buffered journalists (highest relevance first), calling `resolveAndCheckEmail` for each. If a journalist is skipped, they're marked `skipped` and the next one is tried. If the buffer empties, a refill (re-discovery) is attempted once.
