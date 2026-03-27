import { type ServiceContext, buildServiceHeaders } from "./service-context.js";

const CAMPAIGN_SERVICE_URL = process.env.CAMPAIGN_SERVICE_URL;
const CAMPAIGN_SERVICE_API_KEY = process.env.CAMPAIGN_SERVICE_API_KEY;

function getConfig() {
  if (!CAMPAIGN_SERVICE_URL) throw new Error("CAMPAIGN_SERVICE_URL is not set");
  if (!CAMPAIGN_SERVICE_API_KEY)
    throw new Error("CAMPAIGN_SERVICE_API_KEY is not set");
  return { url: CAMPAIGN_SERVICE_URL, apiKey: CAMPAIGN_SERVICE_API_KEY };
}

export interface CampaignInfo {
  id: string;
  featureInputs: Record<string, string> | null;
  brandId: string | null;
}

// In-memory cache — featureInputs never change during a campaign
const campaignCache = new Map<string, CampaignInfo>();

export async function fetchCampaign(
  campaignId: string,
  ctx: ServiceContext
): Promise<CampaignInfo> {
  const cached = campaignCache.get(campaignId);
  if (cached) return cached;

  const { url, apiKey } = getConfig();

  const headers = buildServiceHeaders(ctx, apiKey);

  const response = await fetch(`${url}/campaigns/${campaignId}`, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Campaign service GET /campaigns/${campaignId} failed (${response.status}): ${body}`
    );
  }

  const data = (await response.json()) as { campaign: CampaignInfo };
  const info: CampaignInfo = {
    id: data.campaign.id,
    featureInputs: data.campaign.featureInputs,
    brandId: data.campaign.brandId,
  };

  campaignCache.set(campaignId, info);
  return info;
}

/** Clear cache — useful for testing */
export function clearCampaignCache(): void {
  campaignCache.clear();
}
