/**
 * openapi-fetch joins `baseUrl` with each OpenAPI path as-is. Our contract paths
 * are absolute (`/v1/...`), so a base URL that already ends with `/v1` would
 * produce `/v1/v1/...`. Accept either form and normalize to the origin only.
 */
export function normalizeOpenapiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return trimmed.slice(0, -3).replace(/\/+$/, "");
  }
  return trimmed;
}
