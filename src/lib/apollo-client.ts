import { type ServiceContext, buildServiceHeaders } from "./service-context.js";

const APOLLO_SERVICE_URL = process.env.APOLLO_SERVICE_URL;
const APOLLO_SERVICE_API_KEY = process.env.APOLLO_SERVICE_API_KEY;

function getConfig() {
  if (!APOLLO_SERVICE_URL) throw new Error("APOLLO_SERVICE_URL is not set");
  if (!APOLLO_SERVICE_API_KEY) throw new Error("APOLLO_SERVICE_API_KEY is not set");
  return { url: APOLLO_SERVICE_URL, apiKey: APOLLO_SERVICE_API_KEY };
}

export interface ApolloMatchResult {
  enrichmentId: string | null;
  person: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    emailStatus: string | null;
    title: string | null;
    linkedinUrl: string | null;
    organizationName: string | null;
    organizationDomain: string | null;
    [key: string]: unknown;
  } | null;
  cached: boolean;
}

/**
 * Match a person by firstName + lastName + organizationDomain via Apollo.
 * Returns the full match result. Caller checks person.email and person.emailStatus.
 */
export async function matchPerson(
  firstName: string,
  lastName: string,
  organizationDomain: string,
  ctx: ServiceContext
): Promise<ApolloMatchResult> {
  const { url, apiKey } = getConfig();
  const headers = buildServiceHeaders(ctx, apiKey);

  const response = await fetch(`${url}/match`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ firstName, lastName, organizationDomain }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `[journalists-service] Apollo POST /match failed (${response.status}): ${body}`
    );
  }

  return (await response.json()) as ApolloMatchResult;
}
