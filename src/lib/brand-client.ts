import { type ServiceContext, buildServiceHeaders } from "./service-context.js";

const BRAND_SERVICE_URL = process.env.BRAND_SERVICE_URL;
const BRAND_SERVICE_API_KEY = process.env.BRAND_SERVICE_API_KEY;

function getConfig() {
  if (!BRAND_SERVICE_URL) throw new Error("BRAND_SERVICE_URL is not set");
  if (!BRAND_SERVICE_API_KEY) throw new Error("BRAND_SERVICE_API_KEY is not set");
  return { url: BRAND_SERVICE_URL, apiKey: BRAND_SERVICE_API_KEY };
}

export interface FieldRequest {
  key: string;
  description: string;
}

export interface ExtractedField {
  key: string;
  value: string | string[] | Record<string, unknown> | null;
  cached: boolean;
}

export interface ExtractFieldsResponse {
  brandId: string;
  results: ExtractedField[];
}

export async function extractBrandFields(
  brandId: string,
  fields: FieldRequest[],
  ctx: ServiceContext
): Promise<ExtractFieldsResponse> {
  const { url, apiKey } = getConfig();

  const headers = {
    ...buildServiceHeaders(ctx, apiKey),
    "Content-Type": "application/json",
  };

  const response = await fetch(`${url}/brands/${brandId}/extract-fields`, {
    method: "POST",
    headers,
    body: JSON.stringify({ fields }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Brand service POST /brands/${brandId}/extract-fields failed (${response.status}): ${body}`
    );
  }

  return response.json() as Promise<ExtractFieldsResponse>;
}

/** Helper to pull a string value from extract-fields results */
export function getFieldValue(
  results: ExtractedField[],
  key: string
): string {
  const field = results.find((r) => r.key === key);
  if (!field || field.value === null) return "";
  if (typeof field.value === "string") return field.value;
  if (Array.isArray(field.value)) return field.value.join(", ");
  return JSON.stringify(field.value);
}
