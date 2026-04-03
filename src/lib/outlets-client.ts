import { type ServiceContext, buildServiceHeaders } from "./service-context.js";

const OUTLETS_SERVICE_URL = process.env.OUTLETS_SERVICE_URL;
const OUTLETS_SERVICE_API_KEY = process.env.OUTLETS_SERVICE_API_KEY;

function getConfig() {
  if (!OUTLETS_SERVICE_URL) throw new Error("OUTLETS_SERVICE_URL is not set");
  if (!OUTLETS_SERVICE_API_KEY) throw new Error("OUTLETS_SERVICE_API_KEY is not set");
  return { url: OUTLETS_SERVICE_URL, apiKey: OUTLETS_SERVICE_API_KEY };
}

export interface OutletInfo {
  id: string;
  outletName: string;
  outletUrl: string;
  [key: string]: unknown;
}

export async function fetchOutlet(
  outletId: string,
  ctx: ServiceContext
): Promise<OutletInfo> {
  const { url, apiKey } = getConfig();

  const headers = buildServiceHeaders(ctx, apiKey);

  const response = await fetch(`${url}/outlets/${outletId}`, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Outlets service GET /outlets/${outletId} failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as OutletInfo;
  return data;
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
  ctx: ServiceContext,
  idempotencyKey?: string
): Promise<PulledOutlet | null> {
  const { url, apiKey } = getConfig();
  const headers = buildServiceHeaders(ctx, apiKey);

  const body: Record<string, unknown> = { count: 1 };
  if (idempotencyKey) body.idempotencyKey = idempotencyKey;

  const response = await fetch(`${url}/buffer/next`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `[journalists-service] Outlets service POST /buffer/next failed (${response.status}): ${text}`
    );
  }

  const data = (await response.json()) as { outlets: PulledOutlet[] };
  if (data.outlets.length === 0) return null;
  return data.outlets[0];
}
