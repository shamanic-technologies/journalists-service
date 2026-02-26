const APOLLO_SERVICE_URL = process.env.APOLLO_SERVICE_URL;
const APOLLO_SERVICE_API_KEY = process.env.APOLLO_SERVICE_API_KEY;

export interface ApolloMatchRequest {
  firstName: string;
  lastName: string;
  organizationDomain: string;
  runId: string;
  appId: string;
  brandId: string;
  campaignId: string;
}

export interface ApolloBulkMatchRequest {
  items: Array<{
    firstName: string;
    lastName: string;
    organizationDomain: string;
  }>;
  runId: string;
  appId: string;
  brandId: string;
  campaignId: string;
}

export interface ApolloPerson {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  emailStatus: string | null;
  title: string | null;
  linkedinUrl: string | null;
  organizationName: string | null;
  organizationDomain: string | null;
  phoneNumbers: string[];
}

export interface ApolloMatchResult {
  person: ApolloPerson | null;
  enrichmentId: string;
  cached: boolean;
}

export interface ApolloBulkMatchResponse {
  results: ApolloMatchResult[];
}

function getConfig() {
  if (!APOLLO_SERVICE_URL) {
    throw new Error("APOLLO_SERVICE_URL is not set");
  }
  if (!APOLLO_SERVICE_API_KEY) {
    throw new Error("APOLLO_SERVICE_API_KEY is not set");
  }
  return { url: APOLLO_SERVICE_URL, apiKey: APOLLO_SERVICE_API_KEY };
}

export async function apolloMatchBulk(
  request: ApolloBulkMatchRequest,
  orgId: string
): Promise<ApolloBulkMatchResponse> {
  const { url, apiKey } = getConfig();

  const response = await fetch(`${url}/match/bulk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "x-org-id": orgId,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Apollo /match/bulk failed (${response.status}): ${body}`
    );
  }

  return response.json() as Promise<ApolloBulkMatchResponse>;
}
