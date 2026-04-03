import { type ServiceContext, buildServiceHeaders } from "./service-context.js";

const EMAIL_GATEWAY_SERVICE_URL = process.env.EMAIL_GATEWAY_SERVICE_URL;
const EMAIL_GATEWAY_SERVICE_API_KEY = process.env.EMAIL_GATEWAY_SERVICE_API_KEY;

function getConfig() {
  if (!EMAIL_GATEWAY_SERVICE_URL) throw new Error("EMAIL_GATEWAY_SERVICE_URL is not set");
  if (!EMAIL_GATEWAY_SERVICE_API_KEY) throw new Error("EMAIL_GATEWAY_SERVICE_API_KEY is not set");
  return { url: EMAIL_GATEWAY_SERVICE_URL, apiKey: EMAIL_GATEWAY_SERVICE_API_KEY };
}

interface EmailStatusScope {
  contacted: boolean;
  delivered: boolean;
  replied: boolean;
  replyClassification: "positive" | "negative" | "neutral" | null;
  lastDeliveredAt: string | null;
}

interface EmailAddressScope {
  contacted: boolean;
  delivered: boolean;
  bounced: boolean;
  unsubscribed: boolean;
  lastDeliveredAt: string | null;
}

export interface EmailGatewayStatusResult {
  leadId: string;
  email: string;
  broadcast: {
    campaign: { lead: EmailStatusScope; email: EmailAddressScope } | null;
    brand: { lead: EmailStatusScope; email: EmailAddressScope } | null;
    global: { email: { bounced: boolean; unsubscribed: boolean } };
  };
  transactional: {
    campaign: { lead: EmailStatusScope; email: EmailAddressScope } | null;
    brand: { lead: EmailStatusScope; email: EmailAddressScope } | null;
    global: { email: { bounced: boolean; unsubscribed: boolean } };
  };
}

/**
 * Batch check email delivery status via email-gateway POST /status.
 * Brand scope comes from x-brand-id header (set by buildServiceHeaders).
 */
export async function checkEmailStatuses(
  items: Array<{ leadId: string; email: string }>,
  campaignId: string | undefined,
  ctx: ServiceContext
): Promise<EmailGatewayStatusResult[]> {
  const { url, apiKey } = getConfig();
  const headers = buildServiceHeaders(ctx, apiKey);

  const body: Record<string, unknown> = { items };
  if (campaignId) body.campaignId = campaignId;

  const response = await fetch(`${url}/status`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `[journalists-service] email-gateway POST /status failed (${response.status}): ${text}`
    );
  }

  const data = (await response.json()) as { results: EmailGatewayStatusResult[] };
  return data.results;
}
