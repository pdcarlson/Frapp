/**
 * Vercel production (`VERCEL_ENV=production`) inlines `NEXT_PUBLIC_*` into
 * the dashboard. Unset `NEXT_PUBLIC_API_URL` becomes localhost via
 * `FrappProvider`; a staging URL signs first users into the wrong API/DB.
 *
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` is checked here too, for three rules that
 * do not date:
 *
 *   1. Only `NEXT_PUBLIC_*` is inlined, so every unprefixed secret the browser
 *      needs has to exist a second time under that prefix. A store holding
 *      `SUPABASE_ANON_KEY` alone satisfies the API and starves the bundle.
 *   2. A check that names two variables in one message cannot say which is
 *      wrong. `lib/supabase/server.ts` throws on `!url || !anonKey` and names
 *      both, which is why its failures read as ambiguous; each variable is
 *      therefore tested separately here, and all of them before anything
 *      throws.
 *   3. `NEXT_PUBLIC_*` reaches every visitor, so the value's AUTHORITY matters
 *      as much as its presence — see `assertProductionSupabaseAnonKey`.
 *
 * The incident that produced them (2026-09-14: five `full` attempts, the last
 * two dying at prerender ~30s after this guard passed) is written up once in
 * `docs/internal/ops/deployment/ci-cd.md`, not retold here.
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
      `${label} must be set in production (got empty). It is the ` +
        "`${SUPABASE_ANON_KEY}` reference required in every environment by " +
        "ENV_REFERENCE.md § References — Framework-Specific Names; the " +
        "unprefixed `SUPABASE_ANON_KEY` alone does not reach the browser " +
        "bundle, because Next inlines only `NEXT_PUBLIC_*`. If it is already " +
        "set in Infisical `prod`, the Infisical→Vercel sync (#834) is the " +
        "thing to look at, not the store.",
    );
  }
  const value = raw.trim();
  // An unresolved reference is non-empty, so it satisfies both this guard's
  // old presence test and `server.ts`'s `!anonKey`. Stored verbatim by a
  // system that does not expand `${…}` (the Vercel scope does not), it ships
  // a build whose every Supabase request 401s — silent, and strictly worse
  // than the loud failure this check replaced.
  if (value.includes("${")) {
    throw new Error(
      `${label} is an unresolved variable reference, not a key. Infisical ` +
        "expands `${…}` at sync time; a store that keeps it verbatim ships a " +
        "build whose every Supabase request fails.",
    );
  }
  if (/^https?:\/\//i.test(value)) {
    throw new Error(
      `${label} looks like a URL, not a key. It takes the anon key itself, ` +
        "not the project URL.",
    );
  }
  // New-format keys. `sb_secret_…` is the service-role twin and carries no
  // project reference to check, so it is refused on the prefix alone.
  if (value.startsWith("sb_secret_")) {
    throw new Error(
      `${label} is a SECRET key (\`sb_secret_…\`). Next inlines ` +
        "`NEXT_PUBLIC_*` into the browser bundle, so this would publish a " +
        "credential that bypasses RLS to every visitor. Use the publishable " +
        "key.",
    );
  }
  if (value.startsWith("sb_publishable_")) return;

  const segments = value.split(".");
  let claims = null;
  if (segments.length === 3) {
    try {
      // base64URL → base64, then restore padding.
      //
      // THIRD COPY. `lib/auth/base64url.ts` calls itself "the one copy" and
      // is right to: a padding or encoding fix must land in both. It cannot
      // be imported here — this file is plain ESM loaded by next.config.js,
      // which cannot load TypeScript, and sharing it would mean `allowJs` on
      // the whole app. Tracked; grep `base64UrlDecode` before changing either.
      // This copy skips that one's `TextDecoder` UTF-8 step deliberately: it
      // reads only `ref` and `role`, which are ASCII.
      const base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(
        base64.length + ((4 - (base64.length % 4)) % 4),
        "=",
      );
      claims = JSON.parse(atob(padded));
    } catch {
      claims = null;
    }
  }
  if (!claims || typeof claims !== "object") {
    throw new Error(
      `${label} is not a recognized Supabase key. Expected the legacy JWT ` +
        "anon key or a `sb_publishable_…` key.",
    );
  }
  // THE check, not a nicety. `SUPABASE_SERVICE_ROLE_KEY` sits at the same
  // Infisical path, one row from the anon key in ENV_REFERENCE.md's table,
  // and is a JWT for this SAME project ref — so a ref-only check passes it
  // and Next inlines a full RLS-bypass credential into the public bundle.
  // The anon key is publishable because RLS fences it; the service-role key
  // is exactly the value for which that sentence is false.
  if (claims.role !== "anon") {
    throw new Error(
      `${label} is a "${String(claims.role)}" key, not an anon key. Next ` +
        "inlines `NEXT_PUBLIC_*` into the browser bundle, so this would " +
        "publish a credential that bypasses RLS to every visitor.",
    );
  }
  if (typeof claims.ref === "string" && claims.ref !== "") {
    if (claims.ref !== PRODUCTION_SUPABASE_PROJECT_REF) {
      throw new Error(
        `${label} belongs to Supabase project "${claims.ref}", but ` +
          `production is "${PRODUCTION_SUPABASE_PROJECT_REF}". This build ` +
          "would have signed users into the wrong database.",
      );
    }
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
  // Every variable is checked before anything throws, because the cost of a
  // failed production deploy is not the build minute — it is a human
  // re-typing `DEPLOY TO PRODUCTION` and a reviewer clicking Approve again
  // (deploy-production.yml, and the three 2026-09-14 attempts that each burned
  // an approval). Throwing on the first failure turns a Production scope
  // missing three variables into three of those cycles instead of one.
  const problems = [];
  const checks = [
    () =>
      assertExactOrigin(
        input.apiUrl ?? "",
        "NEXT_PUBLIC_API_URL",
        PRODUCTION_API_ORIGIN,
      ),
    () =>
      assertProductionSupabaseUrl(
        input.supabaseUrl ?? "",
        "NEXT_PUBLIC_SUPABASE_URL",
      ),
    () =>
      assertProductionSupabaseAnonKey(
        input.supabaseAnonKey ?? "",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ),
  ];
  for (const check of checks) {
    try {
      check();
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (problems.length === 1) throw new Error(problems[0]);
  if (problems.length > 1) {
    throw new Error(
      `${problems.length} production environment variables are wrong or ` +
        `missing — fix all of them before re-running the deploy:\n` +
        problems.map((p, i) => `  ${i + 1}. ${p}`).join("\n"),
    );
  }
}
