import { type OrgContext, buildServiceHeaders } from "./service-context.js";

const RUNS_SERVICE_URL = process.env.RUNS_SERVICE_URL;
const RUNS_SERVICE_API_KEY = process.env.RUNS_SERVICE_API_KEY;

function getRunsConfig() {
  if (!RUNS_SERVICE_URL) throw new Error("RUNS_SERVICE_URL is not set");
  if (!RUNS_SERVICE_API_KEY) throw new Error("RUNS_SERVICE_API_KEY is not set");
  return { url: RUNS_SERVICE_URL, apiKey: RUNS_SERVICE_API_KEY };
}

export interface CreateRunResponse {
  id: string;
  parentRunId: string | null;
  serviceName: string;
  taskName: string;
}

export async function createChildRun(
  request: { parentRunId: string | undefined; serviceName: string; taskName: string },
  ctx: OrgContext
): Promise<CreateRunResponse> {
  const { url, apiKey } = getRunsConfig();

  const headers = {
    ...buildServiceHeaders(apiKey, { ...ctx, runId: request.parentRunId }),
    "Content-Type": "application/json",
  };

  const response = await fetch(`${url}/v1/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      serviceName: request.serviceName,
      taskName: request.taskName,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Runs-service POST /v1/runs failed (${response.status}): ${body}`
    );
  }

  return (await response.json()) as CreateRunResponse;
}

export async function closeRun(
  runId: string,
  status: "completed" | "failed",
  ctx: OrgContext
): Promise<void> {
  const { url, apiKey } = getRunsConfig();

  const headers = {
    ...buildServiceHeaders(apiKey, { ...ctx, runId }),
    "Content-Type": "application/json",
  };

  const response = await fetch(`${url}/v1/runs/${runId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.warn(
      `[journalists-service] Failed to close run ${runId} (${response.status}): ${body}`
    );
  }
}

export interface RunWithCosts {
  id: string;
  totalCostInUsdCents: string;
  actualCostInUsdCents: string;
  provisionedCostInUsdCents: string;
  status: string;
}

export async function fetchRunWithCosts(
  runId: string,
  ctx: OrgContext
): Promise<RunWithCosts> {
  const { url, apiKey } = getRunsConfig();

  const headers = buildServiceHeaders(apiKey, { ...ctx, runId });

  const response = await fetch(`${url}/v1/runs/${runId}`, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Runs-service GET /v1/runs/${runId} failed (${response.status}): ${body}`
    );
  }

  return (await response.json()) as RunWithCosts;
}

export interface BatchRunCost {
  runId: string;
  totalCostInUsdCents: string;
  actualCostInUsdCents: string;
  provisionedCostInUsdCents: string;
}

export async function fetchBatchRunCosts(
  runIds: string[],
  ctx: OrgContext
): Promise<BatchRunCost[]> {
  if (runIds.length === 0) return [];

  const { url, apiKey } = getRunsConfig();

  const headers = {
    ...buildServiceHeaders(apiKey, ctx),
    "Content-Type": "application/json",
  };

  const response = await fetch(`${url}/v1/runs/costs/batch`, {
    method: "POST",
    headers,
    body: JSON.stringify({ runIds }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Runs-service POST /v1/runs/costs/batch failed (${response.status}): ${body}`
    );
  }

  const data = (await response.json()) as { costs: BatchRunCost[] };
  return data.costs;
}
