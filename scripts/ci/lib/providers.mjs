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
