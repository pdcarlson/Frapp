/**
 * Base URL for openapi-fetch. OpenAPI paths in this repo are absolute from `/v1`
 * (e.g. `/v1/users/me`), so the base must be the API **origin** (optionally with a
 * non-version path prefix), not `.../v1`.
 *
 * Strips mistaken values like `https://api.example/v1/v1` or `https://api.example/v1`
 * down to `https://api.example` so requests never become `/v1/v1/...`.
 */
export function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    let path = url.pathname.replace(/\/{2,}/g, "/");
    if (!path.startsWith("/")) {
      path = `/${path}`;
    }
    path = path.replace(/\/+$/, "") || "/";

    if (path === "/" || /^(\/v1)+$/.test(path)) {
      url.pathname = "/";
    } else {
      url.pathname = path;
    }

    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}
