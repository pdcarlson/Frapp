#!/usr/bin/env node

// After a deploy, ask the live API and the attachment-copy function the
// questions their clients ask, from the runner (#3113, #2990).
//
// ── Why here ────────────────────────────────────────────────────────────────
// `verify-served-commit.mjs` proves the API serves the deployed commit and is
// ready. It says nothing about whether the clients can use it, and agent
// sandboxes can't reach production to ask: after the 2026-10-01 `v0.7.0` ship
// all three questions below went unasked. The runner reaches both
// environments, so `_deploy.yml` runs this right after the served-commit check
// and before any frontend uploads: a failure ships no frontend behind an API
// its clients can't use, fails the job, and raises its alert.
//
// ── What it asks ────────────────────────────────────────────────────────────
// 1. CORS (#2507, #2976). A preflight from this environment's dashboard origin
//    must get that origin back in `Access-Control-Allow-Origin`, and one from
//    the other environment's dashboard must get no such header. The origins
//    are the constants the API builds its CORS list from, read from the
//    TRUSTED ref's source (`git cat-file`), not restated here and not read from
//    the deployed tree: a rollback is judged against today's dashboards, and a
//    commit from before the constants existed can't fail on a missing file.
//
// 2. The minimum app version (#2526). `GET /v1/client-policy` with
//    `X-Client-Version: <platform>/<expo.version>`, for iOS and Android, where
//    `expo.version` comes from the deployed commit's `apps/mobile/app.json`.
//    `update_required: true` means every install of that version would open on
//    the blocking update screen. The header carries no build number on purpose.
//    The API lets a client with no build through when the versions are equal
//    (`isBelowMinimum`), so the probe trips only on a minimum whose VERSION is
//    above `expo.version`. A probe with a build (`+1`) would also trip on
//    `0.9.0+14`, the documented way to retire earlier builds of `0.9.0`
//    (ENV_REFERENCE.md § API-Only Settings), and fail every deploy while one is
//    set. Known limit: a minimum above every build that exists (`0.9.0+999`)
//    passes. EAS keeps the build numbers (`appVersionSource: remote`), so
//    nothing in the repo knows the latest one.
//    On staging, `update_required: true` is a warning: a staging minimum above
//    the current version is how the update gate is tested with a preview build
//    (the same ENV_REFERENCE.md row). A non-answer fails in both.
//
// 3. The attachment-copy function (#2990, #2981). One POST, made the way the
//    API's supabase-js client makes it (`supabase.functions.invoke`), with the
//    API's own `SUPABASE_SERVICE_ROLE_KEY`, which the job already holds from
//    the Infisical injection. The function refuses an empty `items` with a 400
//    (`parseItems`), so the probe sends one item naming a non-Discord host. The
//    function refuses that item before any CDN fetch or Storage call
//    (`refusal`), and answers 200 with it `rejected`, so the check writes
//    nothing. It passes only on that answer. A 401 is #2981: every bot import
//    would fail at its first attachment batch.
//
// ── Verdicts ────────────────────────────────────────────────────────────────
// Every check runs, and the exit is 1 when any failed, so one run names
// everything that is wrong. A check that got no answer is a failure, never a
// pass: one that silently doesn't run is indistinguishable from one that
// passed. A missing input fails only the checks that need it.
//
// Every request is safe to repeat (the POST writes nothing), so each one gets
// `fetchWithRetry`'s bounded retry on a 429, a 5xx or a dropped connection.
//
// No secret is printed: the key goes on two headers and nowhere else.
//
// Env inputs:
//   TARGET_ENVIRONMENT        — required; staging or production
//   API_HEALTHCHECK_URL       — required; the API's `/health` URL, injected
//                               from Infisical. The checks call the same host.
//   TRUSTED_SHA               — required; the trusted ref (`github.sha`) whose
//                               source names the dashboard origins
//   SUPABASE_URL              — required; injected from Infisical
//   SUPABASE_SERVICE_ROLE_KEY — required; injected; the key the API calls the
//                               function with
//   MOBILE_APP_JSON           — optional; defaults to `apps/mobile/app.json`
//                               in the working tree, the deployed commit
//   SERVICE_LABEL             — optional, for logs
//
// Exits 0 when nothing failed (warnings included), 1 otherwise.
// Unit tests: `scripts/ci/__tests__/smoke-deployed-api.test.mjs`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { fetchWithRetry } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

/** A real `GET` route, so a preflight to it is one the dashboard could send. */
export const CLIENT_POLICY_PATH = "/v1/client-policy";

/**
 * Where each environment's dashboard origin is defined. The API admits
 * `PRODUCTION_APP_ORIGIN` in production and `STAGING_APP_ORIGIN` on staging
 * (`CORS_ALLOWED_ORIGINS` in `cors.options.ts`).
 */
export const DASHBOARD_ORIGIN_SOURCES = {
  production: { file: "packages/validation/src/invite-token.ts", constant: "PRODUCTION_APP_ORIGIN" },
  staging: { file: "apps/api/src/interface/http/cors.options.ts", constant: "STAGING_APP_ORIGIN" },
};

export const DEFAULT_APP_JSON = "apps/mobile/app.json";

export const PLATFORMS = ["ios", "android"];

/** The variable each platform's minimum is read from (`client-policy.service.ts`). */
export const MINIMUM_VERSION_VARIABLES = {
  ios: "MOBILE_MIN_VERSION_IOS",
  android: "MOBILE_MIN_VERSION_ANDROID",
};

/** The API's `ARCHIVE_MEDIA_COPY_FUNCTION`; the test pins the two together. */
export const COPY_FUNCTION = "discord-attachment-copy";

/**
 * Refused before any fetch: `.invalid` is reserved (RFC 2606) and isn't a
 * Discord CDN host. The bucket and path are ones the function would accept,
 * so the host is what refuses it.
 */
export const COPY_PROBE_ITEM = Object.freeze({
  url: "https://deploy-smoke.invalid/attachment",
  bucket: "chat-archive",
  path: "deploy-smoke/probe",
  contentType: null,
  declaredSize: null,
});

/** Long enough for a function cold start plus its 10 s Auth check. */
export const SMOKE_TIMEOUT_MS = 30_000;

/** Every request here writes nothing, the POST included, so all may be re-sent. */
export const SMOKE_RETRY_METHODS = new Set(["GET", "OPTIONS", "POST"]);

const pass = (check, message) => ({ check, verdict: "pass", message });
const warn = (check, message) => ({ check, verdict: "warn", message });
const fail = (check, message) => ({ check, verdict: "fail", message });

function describeError(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "timed out";
  const cause = error?.cause?.code ?? error?.cause?.message;
  return cause ? `${error.message} (${cause})` : (error?.message ?? String(error));
}

/** At most `max` characters of a value, for a message. */
function excerpt(value, max = 300) {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** `https://host/health` → `https://host`. Throws on a URL that isn't one. */
export function apiBaseFrom(healthUrl) {
  const trimmed = healthUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+(\/.*)?\/health$/.test(trimmed)) {
    throw new Error(
      `API_HEALTHCHECK_URL should be the API's /health URL (as in ENV_REFERENCE.md § CD Secrets); got ${excerpt(healthUrl, 120)}.`,
    );
  }
  return trimmed.slice(0, -"/health".length);
}

/** The string literal `export const <constant> = "…"` assigns, as an origin. */
export function readOriginConstant(source, { file, constant }) {
  const match = source.match(new RegExp(`export const ${constant}\\s*=\\s*(["'])([^"'\\n]+)\\1`));
  if (!match) {
    throw new Error(`${file} at the trusted ref no longer exports ${constant} as a string literal, so the dashboard origin can't be read.`);
  }
  const value = match[2];
  let origin;
  try {
    origin = new URL(value).origin;
  } catch {
    origin = null;
  }
  if (origin !== value) throw new Error(`${constant} in ${file} is not a bare origin: ${excerpt(value, 120)}.`);
  return value;
}

/** This environment's dashboard origin and the other environment's. */
export function dashboardOrigins(environment, readTrustedFile) {
  const other = environment === "production" ? "staging" : "production";
  const read = (name) => {
    const source = DASHBOARD_ORIGIN_SOURCES[name];
    return readOriginConstant(readTrustedFile(source.file), source);
  };
  return { own: read(environment), other: read(other) };
}

/** A reader for files at `sha`, from the object store, not the working tree. */
export function gitFileReader(sha, { exec = execFileSync } = {}) {
  return (path) => {
    if (!/^[0-9a-f]{40}$/.test(sha ?? "")) {
      throw new Error(`TRUSTED_SHA must be the trusted ref's full commit SHA (github.sha); got ${excerpt(sha ?? "", 60) || "nothing"}.`);
    }
    // `cat-file blob` prints the stored bytes; no textconv or filter applies.
    return exec("git", ["cat-file", "blob", `${sha}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  };
}

/** `expo.version` from app.json's text, as `x.y.z`. */
export function appVersionFrom(text, file = DEFAULT_APP_JSON) {
  let version;
  try {
    version = JSON.parse(text)?.expo?.version;
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`${file}'s expo.version is not a version like 0.9.0 (got ${excerpt(version ?? "nothing", 60)}).`);
  }
  return version;
}

/**
 * The auth headers supabase-js puts on a `functions.invoke` call made with a
 * service client (no session): the key on `apikey`, and as a Bearer token
 * unless it is a new-format key, which isn't a JWT (`fetchWithAuth`,
 * `omitApiKeyAsBearer`).
 */
export function functionAuthHeaders(key) {
  const isNewApiKey = key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
  return isNewApiKey ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

/** One CORS preflight: `admitted` says whether `origin` should get itself back. */
export async function checkCors({ apiBase, origin, admitted, fetchImpl }) {
  const check = admitted ? `CORS admits ${origin}` : `CORS refuses ${origin}`;
  const url = `${apiBase}${CLIENT_POLICY_PATH}`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
  } catch (error) {
    return fail(check, `The preflight from ${origin} to ${url} got no answer: ${describeError(error)}.`);
  }
  // A preflight's body is empty; nothing reads it.
  await response.body?.cancel().catch(() => undefined);
  const allowed = response.headers.get("access-control-allow-origin");
  const saw = `HTTP ${response.status}, ${allowed === null ? "no Access-Control-Allow-Origin" : `Access-Control-Allow-Origin: ${allowed}`}`;
  if (admitted) {
    if (response.ok && allowed === origin) return pass(check, `A preflight from ${origin} got it back (${saw}).`);
    return fail(
      check,
      `A preflight from ${origin}, this environment's dashboard, to ${url} answered ${saw}. ` +
        `The browser blocks every request that dashboard makes to this API. The API picks its origins by NODE_ENV ` +
        `(apps/api/src/interface/http/cors.options.ts, deployment-environment.ts).`,
    );
  }
  if (allowed === null) return pass(check, `A preflight from ${origin} got no Access-Control-Allow-Origin (HTTP ${response.status}).`);
  return fail(
    check,
    `A preflight from ${origin}, the other environment's dashboard, to ${url} answered ${saw}. ` +
      `This API admits a dashboard it must not. Check NODE_ENV on the Render service, which picks the CORS list ` +
      `(apps/api/src/interface/http/deployment-environment.ts).`,
  );
}

/** One platform's `GET /v1/client-policy` for the current app version. */
export async function checkClientPolicy({ apiBase, environment, platform, version, fetchImpl }) {
  const header = `${platform}/${version}`;
  const check = `client policy serves ${header}`;
  const url = `${apiBase}${CLIENT_POLICY_PATH}`;
  const asked = `GET ${url} with X-Client-Version ${header}`;
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "application/json", "X-Client-Version": header } });
  } catch (error) {
    return fail(check, `${asked} got no answer: ${describeError(error)}.`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) return fail(check, `${asked} answered HTTP ${response.status}: ${excerpt(body)}.`);
  const required = body?.update_required;
  if (required === false) return pass(check, `${header} is supported (update_required: false).`);
  if (required !== true) {
    return fail(check, `${asked} answered HTTP ${response.status} without a boolean update_required: ${excerpt(body)}.`);
  }
  const variable = MINIMUM_VERSION_VARIABLES[platform];
  const message =
    `${asked} answered update_required: true. ${version} is expo.version in ${DEFAULT_APP_JSON} at the deployed ` +
    `commit, so every ${platform} install of it opens on the blocking "Update Frapp" screen. ${variable} on this API ` +
    `is above ${version}. Lower it in Infisical, then redeploy: a running API keeps the value it booted with.`;
  if (environment === "staging") {
    return warn(
      check,
      `${message} A warning on staging only: a staging minimum above the current version is how the update gate is ` +
        `tested with a preview build (ENV_REFERENCE.md § API-Only Settings).`,
    );
  }
  return fail(check, message);
}

/** What a non-200 from the copy function means, as far as its handler says. */
const COPY_STATUS_HINTS = {
  401: "The function refused the key the API calls it with, so every bot import fails at its first attachment batch (#2981).",
  404: "The function is not deployed to this project.",
  500: "The function is missing its Supabase config (SUPABASE_URL or its own service key).",
  503: "Auth could not confirm the key, after this check's retries.",
};

/** One POST to the copy function with the API's key, refused before any fetch. */
export async function checkAttachmentCopy({ supabaseUrl, serviceKey, fetchImpl }) {
  const check = `${COPY_FUNCTION} accepts the API's key`;
  const url = `${supabaseUrl.trim().replace(/\/+$/, "")}/functions/v1/${COPY_FUNCTION}`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { ...functionAuthHeaders(serviceKey), "Content-Type": "application/json" },
      body: JSON.stringify({ items: [COPY_PROBE_ITEM] }),
    });
  } catch (error) {
    return fail(check, `POST ${url} got no answer: ${describeError(error)}.`);
  }
  const body = await response.json().catch(() => null);
  if (response.status !== 200) {
    const said = typeof body?.error === "string" ? ` (${excerpt(body.error, 200)})` : "";
    const hint = COPY_STATUS_HINTS[response.status] ?? "";
    return fail(
      check,
      `POST ${url} with the API's SUPABASE_SERVICE_ROLE_KEY answered HTTP ${response.status}${said}. ${hint}`.trim(),
    );
  }
  const results = body?.results;
  const only = Array.isArray(results) && results.length === 1 ? results[0] : null;
  if (only?.path === COPY_PROBE_ITEM.path && only.status === "rejected") {
    return pass(check, `The function took the API's key and refused the probe before fetching it (${excerpt(only.reason ?? "no reason", 120)}).`);
  }
  return fail(
    check,
    `POST ${url} answered 200 without refusing the probe: ${excerpt(body)}. The probe names a non-Discord host, which ` +
      `the function refuses before any fetch; any other answer means its contract changed and this probe needs another item.`,
  );
}

/** Run every check; a missing input fails only the checks that need it. */
export async function runSmokeChecks({
  env = process.env,
  fetchImpl = smokeFetch,
  readTrustedFile = gitFileReader(env.TRUSTED_SHA),
  readWorkingFile = (path) => readFileSync(path, "utf8"),
} = {}) {
  const environment = env.TARGET_ENVIRONMENT;
  if (environment !== "staging" && environment !== "production") {
    return [fail("inputs", `TARGET_ENVIRONMENT must be staging or production; got ${excerpt(environment ?? "nothing", 40)}.`)];
  }
  const results = [];

  let apiBase = null;
  if (!env.API_HEALTHCHECK_URL) {
    results.push(fail("API checks", "API_HEALTHCHECK_URL is not set; it comes from Infisical. No CORS or client-policy check ran."));
  } else {
    try {
      apiBase = apiBaseFrom(env.API_HEALTHCHECK_URL);
    } catch (error) {
      results.push(fail("API checks", `${error.message} No CORS or client-policy check ran.`));
    }
  }

  if (apiBase) {
    let origins = null;
    try {
      origins = dashboardOrigins(environment, readTrustedFile);
    } catch (error) {
      results.push(fail("CORS", `Could not read the dashboard origins: ${error.message.trim()}`));
    }
    if (origins) {
      results.push(await checkCors({ apiBase, origin: origins.own, admitted: true, fetchImpl }));
      results.push(await checkCors({ apiBase, origin: origins.other, admitted: false, fetchImpl }));
    }

    const appJson = env.MOBILE_APP_JSON || DEFAULT_APP_JSON;
    let version = null;
    try {
      version = appVersionFrom(readWorkingFile(appJson), appJson);
    } catch (error) {
      results.push(fail("client policy", `Could not read the app version: ${error.message}`));
    }
    if (version) {
      for (const platform of PLATFORMS) {
        results.push(await checkClientPolicy({ apiBase, environment, platform, version, fetchImpl }));
      }
    }
  }

  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((name) => !env[name]);
  if (missing.length > 0) {
    results.push(fail(`${COPY_FUNCTION}`, `${missing.join(" and ")} not set; they come from Infisical. The copy-function check did not run.`));
  } else {
    results.push(
      await checkAttachmentCopy({ supabaseUrl: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl }),
    );
  }
  return results;
}

/** `fetchWithRetry` for these checks: every method retried, one longer ceiling. */
export function smokeFetch(url, init, { fetchImpl = fetch, sleep } = {}) {
  return fetchWithRetry(url, init, { retryMethods: SMOKE_RETRY_METHODS, timeoutMs: SMOKE_TIMEOUT_MS, fetchImpl, sleep });
}

/** One log line per result; `failed` is how many failed. */
export function report(results, label = "API") {
  const lines = results.map(({ check, verdict, message }) => {
    if (verdict === "pass") return `✅ [${label}] ${check}: ${message}`;
    if (verdict === "warn") return `::warning::[${label}] ${check}: ${message}`;
    return `::error::[${label}] ${check}: ${message}`;
  });
  return { lines, failed: results.filter((r) => r.verdict === "fail").length };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const label = process.env.SERVICE_LABEL ?? "API";
  const results = await runSmokeChecks();
  const { lines, failed } = report(results, label);
  for (const line of lines) console.log(line);
  if (failed > 0) {
    console.error(`::error::[${label}] ${failed} of ${results.length} client checks failed; each is named above.`);
    process.exit(1);
  }
  console.log(`[${label}] All ${results.length} client checks answered as expected.`);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
