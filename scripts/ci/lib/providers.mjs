// Thin HTTP wrappers around the Render and Vercel deployment-listing APIs.
// Both accept an injectable `fetchImpl` so tests can replay canned responses.

const RENDER_DEPLOYS_URL = (serviceId) =>
  `https://api.render.com/v1/services/${serviceId}/deploys?limit=10`;

const VERCEL_DEPLOYMENTS_URL = (projectId) =>
  `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=20`;

/**
 * `fetch` a URL, throw on a non-2xx, return the parsed JSON body.
 *
 * This was three near-identical copies (`fetchRenderDeploys` and
 * `fetchVercelDeployments` below, plus `production-guardrails.mjs`'s
 * `readJson`), differing only in the error-message template (#1351). `what`
 * supplies that template's subject so the thrown message still names what
 * failed to read, without each call site re-writing the ok-check.
 */
export async function fetchJson({ url, headers, what, fetchImpl = fetch }) {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`${what} returned HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchRenderDeploys({ apiKey, serviceId, fetchImpl = fetch }) {
  return fetchJson({
    url: RENDER_DEPLOYS_URL(serviceId),
    headers: { Authorization: `Bearer ${apiKey}` },
    what: `Render API`,
    fetchImpl,
  }).catch((error) => {
    // Preserve the original message shape: "Render API returned HTTP 500 for
    // service srv-123", naming the service rather than just "Render API".
    throw new Error(`${error.message} for service ${serviceId}`);
  });
}

export async function fetchVercelDeployments({ apiKey, projectId, fetchImpl = fetch }) {
  return fetchJson({
    url: VERCEL_DEPLOYMENTS_URL(projectId),
    headers: { Authorization: `Bearer ${apiKey}` },
    what: `Vercel API`,
    fetchImpl,
  }).catch((error) => {
    throw new Error(`${error.message} for project ${projectId}`);
  });
}
