const RUNS_SERVICE_URL = process.env.RUNS_SERVICE_URL;
const RUNS_SERVICE_API_KEY = process.env.RUNS_SERVICE_API_KEY;

function getRunsConfig() {
  if (!RUNS_SERVICE_URL) throw new Error("RUNS_SERVICE_URL is not set");
  if (!RUNS_SERVICE_API_KEY) throw new Error("RUNS_SERVICE_API_KEY is not set");
  return { url: RUNS_SERVICE_URL, apiKey: RUNS_SERVICE_API_KEY };
}

export interface CreateRunResponse {
  run: {
    id: string;
    parentRunId: string;
    service: string;
    operation: string;
  };
}

export async function createChildRun(
  request: { parentRunId: string; service: string; operation: string },
  orgId: string,
  userId: string,
  featureSlug: string | null = null
): Promise<CreateRunResponse> {
  const { url, apiKey } = getRunsConfig();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "x-org-id": orgId,
    "x-user-id": userId,
  };
  if (featureSlug) {
    headers["x-feature-slug"] = featureSlug;
  }

  const response = await fetch(`${url}/v1/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Runs-service POST /v1/runs failed (${response.status}): ${body}`
    );
  }

  return response.json() as Promise<CreateRunResponse>;
}
