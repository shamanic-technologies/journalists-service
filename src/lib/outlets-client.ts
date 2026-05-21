import { type OrgContext, buildServiceHeaders } from "./service-context.js";

const OUTLETS_SERVICE_URL = process.env.OUTLETS_SERVICE_URL;
const OUTLETS_SERVICE_API_KEY = process.env.OUTLETS_SERVICE_API_KEY;

function getConfig() {
  if (!OUTLETS_SERVICE_URL) throw new Error("OUTLETS_SERVICE_URL is not set");
  if (!OUTLETS_SERVICE_API_KEY) throw new Error("OUTLETS_SERVICE_API_KEY is not set");
  return { url: OUTLETS_SERVICE_URL, apiKey: OUTLETS_SERVICE_API_KEY };
}

const RETRYABLE_CAUSE_CODES = new Set([
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "ECONNRESET",
]);

const RETRY_DELAYS_MS = [100, 300];

function isRetryableFetchError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const cause = (err as { cause?: { code?: string } }).cause;
  return !!cause?.code && RETRYABLE_CAUSE_CODES.has(cause.code);
}

async function fetchWithSocketRetry(
  input: string,
  init: RequestInit,
  label: string
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      if (!isRetryableFetchError(err) || attempt >= RETRY_DELAYS_MS.length) {
        if (attempt > 0) {
          console.warn(
            `[journalists-service] outlets-client ${label} failed after ${attempt + 1} attempts:`,
            err
          );
        }
        throw err;
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}

export interface OutletInfo {
  id: string;
  outletName: string;
  outletUrl: string;
  [key: string]: unknown;
}

export async function fetchOutlet(
  outletId: string,
  ctx: OrgContext
): Promise<OutletInfo> {
  const { url, apiKey } = getConfig();

  const headers = buildServiceHeaders(apiKey, ctx);

  const response = await fetchWithSocketRetry(
    `${url}/orgs/outlets/${outletId}`,
    { headers },
    `GET /orgs/outlets/${outletId}`
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Outlets service GET /orgs/outlets/${outletId} failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as OutletInfo;
  return data;
}

export interface OutletBasic {
  id: string;
  outletName: string;
  outletDomain: string;
}

export async function fetchOutletsBatch(
  outletIds: string[]
): Promise<Map<string, OutletBasic>> {
  const { url, apiKey } = getConfig();

  const response = await fetchWithSocketRetry(
    `${url}/internal/outlets`,
    {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ ids: outletIds }),
    },
    "POST /internal/outlets"
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `[journalists-service] Outlets service POST /internal/outlets failed (${response.status}): ${body}`
    );
  }

  const data = (await response.json()) as {
    outlets: Array<{ id: string; outletName: string; outletDomain: string }>;
  };

  const map = new Map<string, OutletBasic>();
  for (const o of data.outlets) {
    map.set(o.id, { id: o.id, outletName: o.outletName, outletDomain: o.outletDomain });
  }
  return map;
}

export interface PulledOutlet {
  outletId: string;
  outletName: string;
  outletUrl: string;
  outletDomain: string;
  campaignId: string;
  brandIds: string[];
  relevanceScore: number;
  whyRelevant: string;
  whyNotRelevant: string;
}

/**
 * Pull the next best outlet from the outlets-service buffer.
 * Returns null if no outlets are available.
 */
export async function pullNextOutlet(
  ctx: OrgContext,
  idempotencyKey?: string
): Promise<PulledOutlet | null> {
  const { url, apiKey } = getConfig();
  const headers = buildServiceHeaders(apiKey, ctx);

  const body: Record<string, unknown> = { count: 1 };
  if (idempotencyKey) body.idempotencyKey = idempotencyKey;

  const response = await fetchWithSocketRetry(
    `${url}/orgs/buffer/next`,
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    "POST /orgs/buffer/next"
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `[journalists-service] Outlets service POST /orgs/buffer/next failed (${response.status}): ${text}`
    );
  }

  const data = (await response.json()) as { outlets: PulledOutlet[] };
  if (data.outlets.length === 0) return null;
  return data.outlets[0];
}
