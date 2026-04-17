// Thin HTTP wrappers around the Render and Vercel deployment-listing APIs.
// Both accept an injectable `fetchImpl` so tests can replay canned responses.

const RENDER_DEPLOYS_URL = (serviceId) =>
  `https://api.render.com/v1/services/${serviceId}/deploys?limit=10`;

const VERCEL_DEPLOYMENTS_URL = (projectId) =>
  `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=20`;

export async function fetchRenderDeploys({ apiKey, serviceId, fetchImpl = fetch }) {
  const response = await fetchImpl(RENDER_DEPLOYS_URL(serviceId), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Render API returned HTTP ${response.status} for service ${serviceId}`);
  }
  return response.json();
}

export async function fetchVercelDeployments({ apiKey, projectId, fetchImpl = fetch }) {
  const response = await fetchImpl(VERCEL_DEPLOYMENTS_URL(projectId), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Vercel API returned HTTP ${response.status} for project ${projectId}`);
  }
  return response.json();
}

/**
 * Resolve the Vercel team / scope id for API calls that require `teamId`.
 * Prefer `VERCEL_TEAM_ID` when set; otherwise read `accountId` from the project.
 */
export async function resolveVercelTeamId({ apiKey, projectId, fetchImpl = fetch }) {
  const fromEnv = process.env.VERCEL_TEAM_ID;
  if (fromEnv) return fromEnv;
  const response = await fetchImpl(`https://api.vercel.com/v10/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Vercel project lookup returned HTTP ${response.status} for ${projectId}`);
  }
  const body = await response.json();
  const accountId = body?.accountId;
  if (!accountId || typeof accountId !== "string") {
    throw new Error(`Vercel project ${projectId} response missing accountId (team scope)`);
  }
  return accountId;
}

/**
 * Point a custom hostname at a READY deployment (`POST /v2/deployments/{id}/aliases`).
 * `not_modified` (HTTP 409) means the alias already points at this deployment — treat as success.
 */
export async function assignVercelDeploymentAlias({
  apiKey,
  teamId,
  deploymentUid,
  alias,
  fetchImpl = fetch,
}) {
  const url = new URL(`https://api.vercel.com/v2/deployments/${deploymentUid}/aliases`);
  url.searchParams.set("teamId", teamId);
  const response = await fetchImpl(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ alias }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.ok) {
    return { ok: true };
  }
  if (response.status === 409 && body?.error?.code === "not_modified") {
    return { ok: true };
  }
  const message =
    typeof body?.error?.message === "string"
      ? body.error.message
      : `HTTP ${response.status}`;
  return { ok: false, message, status: response.status, code: body?.error?.code };
}
