/**
 * Vercel production (`VERCEL_ENV=production`) inlines `NEXT_PUBLIC_*` into
 * the dashboard. Unset `NEXT_PUBLIC_API_URL` becomes localhost via
 * `FrappProvider`; a staging URL signs first users into the wrong API/DB.
 *
 * Preview (`DEPLOY_TARGET: preview`) and local / CI `next build` leave
 * `VERCEL_ENV` unset and skip this. CI `web-production-build` deliberately
 * uses localhost stand-ins and must not set `VERCEL_ENV=production`.
 *
 * This file is plain ESM so `next.config.js` can import it. `@repo/validation`
 * `"import"` points at TypeScript source Node cannot load from next.config.
 * The strings below are the same values that package exports; the spec pins
 * them together. Do not import TypeScript from `next.config.js`.
 */

export const PRODUCTION_API_ORIGIN = "https://api.frapp.live";

export const PRODUCTION_SUPABASE_PROJECT_REF = "unttyvyfezddlyafcydh";

/**
 * @param {string} raw
 * @param {string} label
 * @param {string} expected
 * @returns {URL}
 */
function assertExactOrigin(raw, label, expected) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`${label} must be ${expected} in production (got empty).`);
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(
      `${label} must be ${expected} in production (got unparseable).`,
    );
  }
  url.username = "";
  url.password = "";
  if (url.origin !== expected) {
    throw new Error(
      `${label} must be ${expected} in production (got ${url.protocol}//${url.host}).`,
    );
  }
  return url;
}

/**
 * @param {string} raw
 * @param {string} label
 * @returns {URL}
 */
function assertProductionSupabaseUrl(raw, label) {
  const expected = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`${label} must be ${expected} in production (got empty).`);
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(
      `${label} must be ${expected} in production (got unparseable).`,
    );
  }
  url.username = "";
  url.password = "";
  const isProduction =
    url.protocol === "https:" &&
    url.hostname === `${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
  if (!isProduction) {
    throw new Error(
      `${label} must be ${expected} in production (got ${url.protocol}//${url.host}).`,
    );
  }
  return url;
}

/**
 * @param {{
 *   vercelEnv?: string | null,
 *   apiUrl?: string | null,
 *   supabaseUrl?: string | null,
 * }} [input]
 */
export function assertProductionWebPublicEnv(input = {}) {
  if (input.vercelEnv !== "production") return;
  assertExactOrigin(
    input.apiUrl ?? "",
    "NEXT_PUBLIC_API_URL",
    PRODUCTION_API_ORIGIN,
  );
  assertProductionSupabaseUrl(
    input.supabaseUrl ?? "",
    "NEXT_PUBLIC_SUPABASE_URL",
  );
}
