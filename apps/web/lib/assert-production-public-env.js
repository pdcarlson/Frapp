/**
 * Vercel production (`VERCEL_ENV=production`) inlines `NEXT_PUBLIC_*` into
 * the dashboard. Unset `NEXT_PUBLIC_API_URL` becomes localhost via
 * `FrappProvider`; a staging URL signs first users into the wrong API/DB.
 *
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` is checked here too, and it is the reason
 * this fence exists in its current shape. Runs 34896647837 and 34905005744
 * both reached `vercel build --prod` with the two URLs correctly set, passed
 * this guard, and then died ~30s later prerendering `/` with
 * `lib/supabase/server.ts`'s "Supabase env vars missing. Set
 * NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY" — a message
 * that names two variables while `server.ts:13` throws on EITHER being falsy,
 * so the log could not say which one was absent. It was always the anon key:
 * Infisical `prod` holds `SUPABASE_ANON_KEY` but not the `NEXT_PUBLIC_`
 * reference `${SUPABASE_ANON_KEY}` that ENV_REFERENCE.md § References —
 * Framework-Specific Names requires, and only `NEXT_PUBLIC_*` is inlined.
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
 * The anon key is publishable by design (RLS is the real fence), but it is
 * never echoed in an error here: a build log is a wider audience than the
 * bundle, and the value adds nothing to the diagnosis.
 *
 * Two shapes exist. Legacy keys are JWTs whose payload carries a `ref` claim
 * naming the project, which lets this pin the key to the SAME project as
 * `NEXT_PUBLIC_SUPABASE_URL` — a production URL paired with the staging anon
 * key is the silent-catastrophe case the URL fences above exist to prevent,
 * and checking only the URL leaves exactly that hole open. Newer
 * `sb_publishable_…` keys carry no project reference at all, so for those
 * presence is all that is knowable and this deliberately does not guess: a
 * check that cannot see the difference must not claim it did.
 *
 * @param {string} raw
 * @param {string} label
 */
function assertProductionSupabaseAnonKey(raw, label) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(
      `${label} must be set in production (got empty). Infisical \`prod\` ` +
        "needs it at path `/` as the reference `${SUPABASE_ANON_KEY}` — the " +
        "unprefixed `SUPABASE_ANON_KEY` alone does not reach the browser " +
        "bundle, because Next inlines only `NEXT_PUBLIC_*`.",
    );
  }
  const value = raw.trim();
  const segments = value.split(".");
  if (segments.length !== 3) return;
  let claims;
  try {
    // `atob` rather than `Buffer` so this file stays runtime-agnostic — it is
    // imported by next.config.js, which Next may load outside a Node context.
    // JWT payloads are base64URL, so restore the base64 alphabet and padding.
    const base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );
    claims = JSON.parse(atob(padded));
  } catch {
    // Not a JWT after all (or an encoding this cannot read). Presence stands;
    // inventing a format error here would fail builds over a shape change.
    return;
  }
  if (!claims || typeof claims.ref !== "string" || claims.ref === "") return;
  if (claims.ref !== PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error(
      `${label} belongs to Supabase project "${claims.ref}", but production ` +
        `is "${PRODUCTION_SUPABASE_PROJECT_REF}". This build would have ` +
        "signed users into the wrong database.",
    );
  }
}

/**
 * @param {{
 *   vercelEnv?: string | null,
 *   apiUrl?: string | null,
 *   supabaseUrl?: string | null,
 *   supabaseAnonKey?: string | null,
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
  assertProductionSupabaseAnonKey(
    input.supabaseAnonKey ?? "",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}
