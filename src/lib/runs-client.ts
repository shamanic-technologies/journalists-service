import { type ServiceContext, buildServiceHeaders } from "./service-context.js";

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
  request: { parentRunId: string; serviceName: string; taskName: string },
  ctx: ServiceContext
): Promise<CreateRunResponse> {
  const { url, apiKey } = getRunsConfig();

  const headers = {
    ...buildServiceHeaders({ ...ctx, runId: request.parentRunId }, apiKey),
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
