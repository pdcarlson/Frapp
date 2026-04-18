/**
 * openapi-fetch concatenates `baseUrl` with OpenAPI paths like `/v1/users/me`.
 * If `baseUrl` already ends with `/v1`, requests become `/v1/v1/...` and 404.
 *
 * Accepts either the API host (`https://api.example.com`) or a legacy value
 * that includes `/v1`, and returns the host-only base (no trailing slash).
 */
export function normalizeOpenApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  if (lower.endsWith("/v1")) {
    return trimmed.slice(0, -"/v1".length);
  }

  return trimmed;
}
