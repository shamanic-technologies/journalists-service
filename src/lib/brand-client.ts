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

type FieldValue = string | unknown[] | Record<string, unknown> | null;

export interface BrandFieldEntry {
  value: FieldValue;
  byBrand: Record<
    string,
    {
      value: FieldValue;
      cached: boolean;
      extractedAt: string;
      expiresAt: string | null;
      sourceUrls: string[] | null;
    }
  >;
}

export interface BrandMeta {
  brandId: string;
  domain: string;
  name: string;
}

export interface ExtractFieldsResponse {
  brands: BrandMeta[];
  fields: Record<string, BrandFieldEntry>;
}

/**
 * Extract brand fields via POST /brands/extract-fields.
 * Brand-service reads x-brand-id from the forwarded headers (CSV-safe).
 */
export async function extractBrandFields(
  fields: FieldRequest[],
  ctx: ServiceContext
): Promise<ExtractFieldsResponse> {
  const { url, apiKey } = getConfig();

  const headers = {
    ...buildServiceHeaders(ctx, apiKey),
    "Content-Type": "application/json",
  };

  const response = await fetch(`${url}/brands/extract-fields`, {
    method: "POST",
    headers,
    body: JSON.stringify({ fields }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Brand service POST /brands/extract-fields failed (${response.status}): ${body}`
    );
  }

  return response.json() as Promise<ExtractFieldsResponse>;
}

/** Helper to pull a string value from the consolidated fields response */
export function getFieldValue(
  fields: Record<string, BrandFieldEntry>,
  key: string
): string {
  const entry = fields[key];
  if (!entry || entry.value === null || entry.value === undefined) return "";
  if (typeof entry.value === "string") return entry.value;
  if (Array.isArray(entry.value)) return entry.value.join(", ");
  return JSON.stringify(entry.value);
}
