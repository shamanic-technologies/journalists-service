const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL;
const CHAT_SERVICE_API_KEY = process.env.CHAT_SERVICE_API_KEY;

function getConfig() {
  if (!CHAT_SERVICE_URL) throw new Error("CHAT_SERVICE_URL is not set");
  if (!CHAT_SERVICE_API_KEY) throw new Error("CHAT_SERVICE_API_KEY is not set");
  return { url: CHAT_SERVICE_URL, apiKey: CHAT_SERVICE_API_KEY };
}

export interface CompleteRequest {
  message: string;
  systemPrompt: string;
  responseFormat?: "json";
  temperature?: number;
  maxTokens?: number;
}

export interface CompleteResponse {
  content: string;
  json?: Record<string, unknown>;
  tokensInput: number;
  tokensOutput: number;
  model: string;
}

export async function chatComplete(
  request: CompleteRequest,
  orgId: string,
  userId: string,
  runId: string,
  featureSlug: string | null = null
): Promise<CompleteResponse> {
  const { url, apiKey } = getConfig();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "x-org-id": orgId,
    "x-user-id": userId,
    "x-run-id": runId,
  };
  if (featureSlug) headers["x-feature-slug"] = featureSlug;

  const response = await fetch(`${url}/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Chat service POST /complete failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<CompleteResponse>;
}
