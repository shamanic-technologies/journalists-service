import { type ServiceContext, buildServiceHeaders } from "./service-context.js";

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL;
const CHAT_SERVICE_API_KEY = process.env.CHAT_SERVICE_API_KEY;

function getConfig() {
  if (!CHAT_SERVICE_URL) throw new Error("CHAT_SERVICE_URL is not set");
  if (!CHAT_SERVICE_API_KEY) throw new Error("CHAT_SERVICE_API_KEY is not set");
  return { url: CHAT_SERVICE_URL, apiKey: CHAT_SERVICE_API_KEY };
}

export interface CompleteRequest {
  provider: "google" | "anthropic";
  model: string;
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
  ctx: ServiceContext
): Promise<CompleteResponse> {
  const { url, apiKey } = getConfig();

  const headers = {
    ...buildServiceHeaders(ctx, apiKey),
    "Content-Type": "application/json",
  };

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
