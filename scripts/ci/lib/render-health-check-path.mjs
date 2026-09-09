/**
 * Render's GET /v1/services/{id} puts healthCheckPath on webServiceDetails
 * (`serviceDetails`), not the service root. An empty string is a real,
 * documented value (TCP-only probe), not "unreadable".
 *
 * Shared by production-guardrails (frapp-api-prod) and staging-conformance
 * (frapp-api-staging). Do not unwrap `{ service: … }` around the GET body —
 * live responses already have top-level `autoDeploy` / `branch`.
 */
export const EXPECTED_HEALTH_CHECK_PATH = "/health";

/**
 * @param {object} [service]
 * @returns {string | undefined} the nested path, including `""`; `undefined` if unreadable
 */
export function readHealthCheckPath(service) {
  const details = service?.serviceDetails;
  if (typeof details !== "object" || details === null) return undefined;
  if (!Object.hasOwn(details, "healthCheckPath")) return undefined;
  return details.healthCheckPath;
}
