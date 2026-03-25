const BRAND_SERVICE_URL = process.env.BRAND_SERVICE_URL;
const BRAND_SERVICE_API_KEY = process.env.BRAND_SERVICE_API_KEY;

function getConfig() {
  if (!BRAND_SERVICE_URL) throw new Error("BRAND_SERVICE_URL is not set");
  if (!BRAND_SERVICE_API_KEY) throw new Error("BRAND_SERVICE_API_KEY is not set");
  return { url: BRAND_SERVICE_URL, apiKey: BRAND_SERVICE_API_KEY };
}

export interface BrandInfo {
  id: string;
  name: string | null;
  domain: string | null;
  brandUrl: string | null;
  elevatorPitch: string | null;
  bio: string | null;
  mission: string | null;
  location: string | null;
  categories: string | null;
}

export async function fetchBrand(
  brandId: string,
  orgId: string,
  userId: string,
  runId: string,
  featureSlug: string | null = null
): Promise<BrandInfo> {
  const { url, apiKey } = getConfig();

  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "x-org-id": orgId,
    "x-user-id": userId,
    "x-run-id": runId,
  };
  if (featureSlug) headers["x-feature-slug"] = featureSlug;

  const response = await fetch(`${url}/brands/${brandId}`, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brand service GET /brands/${brandId} failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { brand: BrandInfo };
  return data.brand;
}
