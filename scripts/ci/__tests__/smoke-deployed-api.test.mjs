// Pins `smoke-deployed-api.mjs` (#3113, #2990): the client checks
// `_deploy.yml` runs against the live API and the attachment-copy function
// after the served-commit check. Every test here is offline. The API is a fake
// that answers the way the `cors` package and `ClientPolicyController` do. The
// copy function is the REAL handler (`handler.ts`, loaded through Node's type
// stripping), with a `fetch` that throws, so "the probe is refused before any
// fetch or Storage write" is proven against the function's own code.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  apiBaseFrom,
  APP_JSON,
  appVersionFrom,
  checkAttachmentCopy,
  clientProbes,
  COPY_FUNCTION,
  COPY_PROBE_ITEM,
  DASHBOARD_ORIGIN_SOURCES,
  dashboardOrigins,
  functionAuthHeaders,
  gitFileReader,
  MINIMUM_VERSION_VARIABLES,
  newestShippedBuilds,
  readOriginConstant,
  report,
  runSmokeChecks,
  SHIPPED_BUILDS,
  smokeFetch,
  withoutSecret,
} from "../smoke-deployed-api.mjs";
import { parseRegistry } from "../../check-api-breaking-changes.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "ci", "smoke-deployed-api.mjs");
const { handleCopyRequest } = await import(
  join(REPO_ROOT, "supabase", "functions", "discord-attachment-copy", "handler.ts")
);

const API = "https://api.example.test";
const SUPABASE = "https://abcdefghijklmnopqrst.supabase.co";
const FUNCTION_URL = `${SUPABASE}/functions/v1/${COPY_FUNCTION}`;
const PROD_ORIGIN = "https://app.example.test";
const STAGING_ORIGIN = "https://app.staging.example.test";
// Shaped like the legacy service-role JWT, which goes on both headers.
const KEY = "eyJhbGciOiJIUzI1NiJ9.service-role.signature";
const TRUSTED_SHA = "0123456789abcdef0123456789abcdef01234567";

const appJson = (version) => JSON.stringify({ expo: { name: "Frapp", version } });
const registry = (...builds) =>
  JSON.stringify({
    builds: builds.map(([platform, version, build]) => ({ platform, version, build, sha: TRUSTED_SHA, recorded: "2026-10-01" })),
  });
const SOURCES = {
  [DASHBOARD_ORIGIN_SOURCES.production.file]: `export const PRODUCTION_APP_ORIGIN = "${PROD_ORIGIN}";\n`,
  [DASHBOARD_ORIGIN_SOURCES.staging.file]: `export const STAGING_APP_ORIGIN = '${STAGING_ORIGIN}';\n`,
  [APP_JSON]: appJson("0.9.0"),
  [SHIPPED_BUILDS]: registry(),
};
/** The trusted ref's files, with some replaced. */
const trusted = (overrides = {}) => {
  const files = { ...SOURCES, ...overrides };
  return (path) => {
    if (!(path in files)) throw new Error(`no ${path} at the trusted ref`);
    return files[path];
  };
};

const env = (overrides = {}) => ({
  TARGET_ENVIRONMENT: "production",
  API_HEALTHCHECK_URL: `${API}/health`,
  TRUSTED_SHA,
  SUPABASE_URL: SUPABASE,
  SUPABASE_SERVICE_ROLE_KEY: KEY,
  ...overrides,
});

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The `cors` package's preflight: the origin reflected when listed, else no header. */
const preflight = (admitted) => ({ headers }) => {
  const origin = headers.get("origin");
  const allow = admitted.includes(origin) ? { "access-control-allow-origin": origin } : {};
  return new Response(null, { status: 204, headers: { vary: "Origin", ...allow } });
};

/** `ClientPolicyController`, with a minimum that blocks `blocked` headers. */
const clientPolicy = (blocked = []) => ({ headers }) =>
  json(200, { update_required: blocked.includes(headers.get("x-client-version")), update_url: "https://apps.apple.com/app/id1" });

/**
 * The deployed function: the real handler, holding `functionKey`. A key it
 * doesn't hold goes to Auth, which `authStatus` answers. Any other fetch (a CDN
 * download, a Storage upload) fails the test.
 */
const copyFunction = ({ functionKey = KEY, authStatus = 401 } = {}) => async ({ headers, body }) => {
  const request = new Request(FUNCTION_URL, { method: "POST", headers, body });
  return handleCopyRequest(request, {
    fetch: async (url) => {
      if (String(url).startsWith(`${SUPABASE}/auth/v1/admin/users`)) return new Response("{}", { status: authStatus });
      throw new Error(`the probe made the function fetch ${url}`);
    },
    now: () => 0,
    env: (name) => ({ SUPABASE_URL: SUPABASE, SUPABASE_SERVICE_ROLE_KEY: functionKey })[name],
  });
};

/** A production API that answers every check as it should, unless overridden. */
function routes(overrides = {}) {
  return {
    [`OPTIONS ${API}/v1/client-policy`]: preflight([PROD_ORIGIN]),
    [`GET ${API}/v1/client-policy`]: clientPolicy(),
    [`POST ${FUNCTION_URL}`]: copyFunction(),
    ...overrides,
  };
}

function makeFetch(table) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    calls.push({ method, url, headers, body: init.body, redirect: init.redirect });
    const handler = table[`${method} ${url}`];
    if (!handler) throw new Error(`unexpected ${method} ${url}`);
    if (handler instanceof Error) throw handler;
    return handler({ headers, body: init.body });
  };
  return { fetchImpl, calls };
}

async function run({ table = routes(), envOverrides = {}, readTrustedFile = trusted() } = {}) {
  const { fetchImpl, calls } = makeFetch(table);
  const results = await runSmokeChecks({ env: env(envOverrides), fetchImpl, readTrustedFile });
  return { results, calls, byCheck: (pattern) => results.filter((r) => pattern.test(r.check)) };
}

const verdicts = (results) => results.map((r) => `${r.verdict} ${r.check}`);

describe("runSmokeChecks: a healthy deploy", () => {
  it("passes all five checks in production", async () => {
    const { results } = await run();
    assert.deepEqual(verdicts(results), [
      `pass CORS admits ${PROD_ORIGIN}`,
      `pass CORS refuses ${STAGING_ORIGIN}`,
      "pass client policy serves ios/0.9.0",
      "pass client policy serves android/0.9.0",
      `pass ${COPY_FUNCTION} accepts the API's key`,
    ]);
    assert.equal(report(results).failed, 0);
  });

  it("swaps the origins on staging: its own admitted, production's refused", async () => {
    const table = routes({ [`OPTIONS ${API}/v1/client-policy`]: preflight([STAGING_ORIGIN, "http://localhost:3000"]) });
    const { results } = await run({ table, envOverrides: { TARGET_ENVIRONMENT: "staging" } });
    assert.deepEqual(verdicts(results).slice(0, 2), [`pass CORS admits ${STAGING_ORIGIN}`, `pass CORS refuses ${PROD_ORIGIN}`]);
    assert.equal(report(results).failed, 0);
  });

  it("sends a real preflight, to the API base the health URL names", async () => {
    const { calls } = await run({ envOverrides: { API_HEALTHCHECK_URL: `${API}/health/` } });
    const preflights = calls.filter((c) => c.method === "OPTIONS");
    assert.deepEqual(preflights.map((c) => c.headers.get("origin")), [PROD_ORIGIN, STAGING_ORIGIN]);
    for (const call of preflights) {
      assert.equal(call.url, `${API}/v1/client-policy`);
      assert.equal(call.headers.get("access-control-request-method"), "GET");
    }
  });

  it("asks about the app.json version with no build number while no build is recorded", async () => {
    // A build (`+1`) would trip on `0.9.0+14`, the documented way to retire
    // earlier builds of one version, and fail every deploy while it is set.
    const { calls } = await run();
    const asked = calls.filter((c) => c.method === "GET").map((c) => c.headers.get("x-client-version"));
    assert.deepEqual(asked, ["ios/0.9.0", "android/0.9.0"]);
  });

  it("posts one probe item, the way supabase-js invokes the function", async () => {
    const { calls } = await run();
    const [post] = calls.filter((c) => c.method === "POST");
    assert.equal(post.url, FUNCTION_URL);
    assert.equal(post.headers.get("apikey"), KEY);
    assert.equal(post.headers.get("authorization"), `Bearer ${KEY}`);
    assert.equal(post.headers.get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(post.body), { items: [COPY_PROBE_ITEM] });
  });
});

describe("runSmokeChecks: CORS", () => {
  it("fails when this environment's dashboard isn't admitted, naming what came back", async () => {
    const { byCheck } = await run({ table: routes({ [`OPTIONS ${API}/v1/client-policy`]: preflight([]) }) });
    const [own] = byCheck(/admits/);
    assert.equal(own.verdict, "fail");
    assert.match(own.message, /HTTP 204, no Access-Control-Allow-Origin/);
    assert.match(own.message, /this environment's dashboard/);
  });

  it("fails when the preflight answers an error, even with the origin echoed", async () => {
    const table = routes({
      [`OPTIONS ${API}/v1/client-policy`]: () =>
        new Response("bad gateway", { status: 502, headers: { "access-control-allow-origin": PROD_ORIGIN } }),
    });
    const [own] = (await run({ table })).byCheck(/admits/);
    assert.equal(own.verdict, "fail");
    assert.match(own.message, /HTTP 502/);
  });

  it("fails when the other environment's dashboard is admitted", async () => {
    const table = routes({ [`OPTIONS ${API}/v1/client-policy`]: preflight([PROD_ORIGIN, STAGING_ORIGIN]) });
    const [other] = (await run({ table })).byCheck(/refuses/);
    assert.equal(other.verdict, "fail");
    assert.match(other.message, new RegExp(`Access-Control-Allow-Origin: ${STAGING_ORIGIN}`));
    assert.match(other.message, /NODE_ENV/);
  });

  it("fails on a wildcard for the other environment's dashboard", async () => {
    const table = routes({
      [`OPTIONS ${API}/v1/client-policy`]: ({ headers }) =>
        new Response(null, {
          status: 204,
          headers: { "access-control-allow-origin": headers.get("origin") === PROD_ORIGIN ? PROD_ORIGIN : "*" },
        }),
    });
    const [other] = (await run({ table })).byCheck(/refuses/);
    assert.equal(other.verdict, "fail");
    assert.match(other.message, /Access-Control-Allow-Origin: \*/);
  });

  it("fails, never passes, when the preflight gets no answer", async () => {
    const table = routes({ [`OPTIONS ${API}/v1/client-policy`]: new TypeError("fetch failed") });
    const cors = (await run({ table })).byCheck(/^CORS/);
    assert.deepEqual(cors.map((r) => r.verdict), ["fail", "fail"]);
    assert.match(cors[1].message, /got no answer: fetch failed/);
  });

  it("fails the CORS checks alone when the origins can't be read", async () => {
    const readTrustedFile = trusted({ [DASHBOARD_ORIGIN_SOURCES.staging.file]: "export const SOMETHING_ELSE = 1;" });
    const { results } = await run({ readTrustedFile });
    assert.deepEqual(verdicts(results), [
      "fail CORS",
      "pass client policy serves ios/0.9.0",
      "pass client policy serves android/0.9.0",
      `pass ${COPY_FUNCTION} accepts the API's key`,
    ]);
    assert.match(results[0].message, /no longer exports STAGING_APP_ORIGIN/);
  });
});

describe("runSmokeChecks: the minimum app version", () => {
  const blockIos = routes({ [`GET ${API}/v1/client-policy`]: clientPolicy(["ios/0.9.0"]) });

  it("fails production when the current version would open on the update screen", async () => {
    const { results, byCheck } = await run({ table: blockIos });
    const [ios] = byCheck(/ios/);
    assert.equal(ios.verdict, "fail");
    assert.match(ios.message, /update_required: true/);
    assert.match(ios.message, /MOBILE_MIN_VERSION_IOS/);
    assert.match(ios.message, /every ios install opens on/);
    assert.match(ios.message, /expo\.version in apps\/mobile\/app\.json/);
    assert.equal(byCheck(/android/)[0].verdict, "pass");
    assert.equal(report(results).failed, 1);
  });

  it("only warns on staging, where a high minimum is how the gate is tested", async () => {
    const table = { ...blockIos, [`OPTIONS ${API}/v1/client-policy`]: preflight([STAGING_ORIGIN]) };
    const { results, byCheck } = await run({ table, envOverrides: { TARGET_ENVIRONMENT: "staging" } });
    const [ios] = byCheck(/ios/);
    assert.equal(ios.verdict, "warn");
    assert.match(ios.message, /preview build/);
    assert.equal(report(results).failed, 0);
  });

  for (const environment of ["staging", "production"]) {
    it(`fails ${environment} on an error answer, which is no answer at all`, async () => {
      const table = {
        ...routes({ [`GET ${API}/v1/client-policy`]: () => json(500, { message: "Internal server error" }) }),
        ...(environment === "staging" ? { [`OPTIONS ${API}/v1/client-policy`]: preflight([STAGING_ORIGIN]) } : {}),
      };
      const policy = (await run({ table, envOverrides: { TARGET_ENVIRONMENT: environment } })).byCheck(/client policy/);
      assert.deepEqual(policy.map((r) => r.verdict), ["fail", "fail"]);
      assert.match(policy[0].message, /HTTP 500/);
    });
  }

  it("fails on a 2xx without a boolean update_required", async () => {
    const table = routes({ [`GET ${API}/v1/client-policy`]: () => json(200, { update_required: "no" }) });
    const [ios] = (await run({ table })).byCheck(/ios/);
    assert.equal(ios.verdict, "fail");
    assert.match(ios.message, /without a boolean update_required/);
  });

  it("fails the client-policy checks alone when app.json has no usable version", async () => {
    const { results } = await run({ readTrustedFile: trusted({ [APP_JSON]: appJson("0.9.0-beta.1") }) });
    assert.deepEqual(verdicts(results).filter((v) => v.startsWith("fail")), ["fail client policy (ios)", "fail client policy (android)"]);
    assert.match(results.find((r) => r.verdict === "fail").message, /not a version like 0\.9\.0/);
    assert.equal(results.length, 5);
  });

  it("still probes a platform with a recorded build when app.json is unreadable", async () => {
    const readTrustedFile = trusted({ [APP_JSON]: appJson("0.9.0-beta.1"), [SHIPPED_BUILDS]: registry(["ios", "0.9.0", "14"]) });
    const { results, calls } = await run({ readTrustedFile });
    assert.deepEqual(
      verdicts(results).filter((v) => /client policy/.test(v)),
      ["pass client policy serves ios/0.9.0+14", "fail client policy (android)"],
    );
    assert.deepEqual(calls.filter((c) => c.method === "GET").map((c) => c.headers.get("x-client-version")), ["ios/0.9.0+14"]);
  });

  it("probes the newest recorded build once one has shipped, build number included", async () => {
    const readTrustedFile = trusted({
      [SHIPPED_BUILDS]: registry(["ios", "0.9.0", "12"], ["ios", "0.9.0", "14"], ["ios", "0.8.9", "40"], ["android", "0.9.0", "7"]),
    });
    const { calls, results } = await run({ readTrustedFile });
    const asked = calls.filter((c) => c.method === "GET").map((c) => c.headers.get("x-client-version"));
    assert.deepEqual(asked, ["ios/0.9.0+14", "android/0.9.0+7"]);
    assert.match(results.find((r) => /ios/.test(r.check)).message, /the newest ios build recorded in/);
  });

  it("falls back to app.json for a platform with nothing recorded", async () => {
    const readTrustedFile = trusted({ [SHIPPED_BUILDS]: registry(["android", "0.9.0", "7"]) });
    const asked = (await run({ readTrustedFile })).calls
      .filter((c) => c.method === "GET")
      .map((c) => c.headers.get("x-client-version"));
    assert.deepEqual(asked, ["ios/0.9.0", "android/0.9.0+7"]);
  });

  it("fails when the newest recorded build is below the minimum, and passes a retirement of older ones", async () => {
    // `0.9.0+20` strands the newest build (+14), so every install; `0.9.0+14`
    // retires only +12, so it passes.
    const readTrustedFile = trusted({ [SHIPPED_BUILDS]: registry(["ios", "0.9.0", "12"], ["ios", "0.9.0", "14"]) });
    const below = (minimumBuild) => (header) => {
      const build = Number(/\+(\d+)$/.exec(header)?.[1] ?? Infinity);
      return header.startsWith("ios/0.9.0") && build < minimumBuild;
    };
    const policy = (blocked) => ({ headers }) =>
      json(200, { update_required: blocked(headers.get("x-client-version")), update_url: null });
    const at = async (minimumBuild) =>
      (await run({ readTrustedFile, table: routes({ [`GET ${API}/v1/client-policy`]: policy(below(minimumBuild)) }) })).byCheck(/ios/)[0];
    const stranded = await at(20);
    assert.equal(stranded.verdict, "fail");
    assert.match(stranded.message, /record it in apps\/mobile\/store\/shipped-builds\.json/);
    assert.equal((await at(14)).verdict, "pass");
  });

  it("fails the client-policy checks alone on a registry it can't read", async () => {
    const readTrustedFile = trusted({ [SHIPPED_BUILDS]: JSON.stringify({ builds: [{ platform: "ios", version: "0.9" }] }) });
    const { results } = await run({ readTrustedFile });
    assert.deepEqual(verdicts(results).filter((v) => v.startsWith("fail")), ["fail client policy"]);
    assert.match(results.find((r) => r.verdict === "fail").message, /builds\[0\] needs a platform/);
  });
});

describe("runSmokeChecks: the attachment-copy function", () => {
  it("passes against the real handler, which refuses the probe before any fetch", async () => {
    const [copy] = (await run()).byCheck(/accepts/);
    assert.equal(copy.verdict, "pass");
    assert.match(copy.message, /Not a Discord CDN host/);
  });

  it("fails naming the 401 when the function refuses the API's key (#2981)", async () => {
    const table = routes({ [`POST ${FUNCTION_URL}`]: copyFunction({ functionKey: "a-different-key", authStatus: 401 }) });
    const { results, byCheck } = await run({ table });
    const [copy] = byCheck(/accepts/);
    assert.equal(copy.verdict, "fail");
    assert.match(copy.message, /answered HTTP 401 \(Not authorized\.\)/);
    assert.match(copy.message, /#2981/);
    // The key is on two headers and nowhere in the output.
    for (const line of report(results).lines) assert.doesNotMatch(line, new RegExp(KEY.replace(/\./g, "\\.")));
  });

  it("passes when the function holds a different key but Auth vouches for the API's", async () => {
    // The #2991 fix: the byte match isn't the whole check.
    const table = routes({ [`POST ${FUNCTION_URL}`]: copyFunction({ functionKey: "a-different-key", authStatus: 200 }) });
    assert.equal((await run({ table })).byCheck(/accepts/)[0].verdict, "pass");
  });

  it("fails on a 404, naming a function that isn't deployed", async () => {
    const table = routes({ [`POST ${FUNCTION_URL}`]: () => json(404, { code: "NOT_FOUND", message: "Requested function was not found" }) });
    const [copy] = (await run({ table })).byCheck(/accepts/);
    assert.equal(copy.verdict, "fail");
    assert.match(copy.message, /HTTP 404\. The function is not deployed/);
  });

  it("fails on a 200 that refuses some other item, not the probe", async () => {
    const table = routes({
      [`POST ${FUNCTION_URL}`]: () => json(200, { results: [{ path: "chapters/x/other", status: "rejected" }] }),
    });
    const [copy] = (await run({ table })).byCheck(/accepts/);
    assert.equal(copy.verdict, "fail");
    assert.match(copy.message, /without refusing the probe/);
  });

  it("fails on a 200 that doesn't refuse the probe", async () => {
    const table = routes({
      [`POST ${FUNCTION_URL}`]: () => json(200, { results: [{ path: COPY_PROBE_ITEM.path, status: "stored" }] }),
    });
    const [copy] = (await run({ table })).byCheck(/accepts/);
    assert.equal(copy.verdict, "fail");
    assert.match(copy.message, /without refusing the probe/);
    assert.match(copy.message, /"stored"/);
  });

  it("sends a new-format secret key on apikey alone, as supabase-js does", async () => {
    const secret = "sb_secret_abc123";
    assert.deepEqual(functionAuthHeaders(secret), { apikey: secret });
    assert.deepEqual(functionAuthHeaders(KEY), { apikey: KEY, Authorization: `Bearer ${KEY}` });
    const table = routes({ [`POST ${FUNCTION_URL}`]: copyFunction({ functionKey: secret }) });
    const { calls, byCheck } = await run({ table, envOverrides: { SUPABASE_SERVICE_ROLE_KEY: secret } });
    assert.equal(byCheck(/accepts/)[0].verdict, "pass");
    assert.equal(calls.find((c) => c.method === "POST").headers.has("authorization"), false);
  });

  it("never prints the key, even when a fetch error echoes it across lines", async () => {
    // undici quotes a header value it refuses whole, line breaks included, and
    // the runner's mask can't match a secret split over two log lines.
    const key = "eyJhbGciOiJIUzI1NiJ9.first-half\nsecond-half-of-the-key";
    const result = await checkAttachmentCopy({
      supabaseUrl: SUPABASE,
      serviceKey: key,
      fetchImpl: async (url, init) => fetch("http://127.0.0.1:9/", init),
    });
    assert.equal(result.verdict, "fail");
    assert.match(result.message, /Headers\.append: "\*\*\*" is an invalid header value/);
    for (const piece of key.split("\n")) assert.ok(!result.message.includes(piece), result.message);
    assert.equal(withoutSecret(`a ${KEY} b`, KEY), "a *** b");
  });

  it("refuses a redirect, which would carry the apikey header to another origin", async () => {
    const { calls } = await run();
    assert.equal(calls.find((c) => c.method === "POST").redirect, "error");
  });

  it("names the error when the call gets no answer", async () => {
    const result = await checkAttachmentCopy({
      supabaseUrl: `${SUPABASE}/`,
      serviceKey: KEY,
      fetchImpl: async () => {
        throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      },
    });
    assert.equal(result.verdict, "fail");
    assert.match(result.message, new RegExp(`POST ${FUNCTION_URL} got no answer: timed out`));
  });
});

describe("runSmokeChecks: inputs", () => {
  it("refuses an unknown environment and asks nothing", async () => {
    const { results, calls } = await run({ envOverrides: { TARGET_ENVIRONMENT: "prod" } });
    assert.deepEqual(verdicts(results), ["fail inputs"]);
    assert.equal(calls.length, 0);
  });

  it("still checks the function when the API's URL is missing", async () => {
    const { results } = await run({ envOverrides: { API_HEALTHCHECK_URL: "" } });
    assert.deepEqual(verdicts(results), ["fail API checks", `pass ${COPY_FUNCTION} accepts the API's key`]);
    assert.match(results[0].message, /API_HEALTHCHECK_URL is not set/);
  });

  it("still checks the API when the function's inputs are missing", async () => {
    const { results } = await run({ envOverrides: { SUPABASE_SERVICE_ROLE_KEY: "" } });
    assert.equal(report(results).failed, 1);
    assert.match(results.at(-1).message, /SUPABASE_SERVICE_ROLE_KEY not set/);
    assert.equal(results.length, 5);
  });

  it("refuses a health URL that isn't /health", () => {
    assert.equal(apiBaseFrom(`${API}/health`), API);
    assert.equal(apiBaseFrom(` ${API}/health// `), API);
    assert.throws(() => apiBaseFrom(`${API}/health/ready`), /should be the API's \/health URL/);
    assert.throws(() => apiBaseFrom(API), /should be the API's \/health URL/);
  });

  it("reads the origin constants, and refuses anything but a bare origin", () => {
    const source = DASHBOARD_ORIGIN_SOURCES.production;
    assert.equal(readOriginConstant(`export const PRODUCTION_APP_ORIGIN = "${PROD_ORIGIN}";`, source), PROD_ORIGIN);
    assert.throws(() => readOriginConstant(`export const PRODUCTION_APP_ORIGIN = "${PROD_ORIGIN}/";`, source), /not a bare origin/);
    assert.throws(() => readOriginConstant(`export const PRODUCTION_APP_ORIGIN = ORIGIN;`, source), /no longer exports/);
  });

  it("reads the newest build per platform from the registry", () => {
    assert.deepEqual(newestShippedBuilds(registry()), { ios: null, android: null });
    assert.deepEqual(
      newestShippedBuilds(registry(["ios", "0.9.0", "9"], ["ios", "0.10.0", "1"], ["ios", "0.9.1", "30"], ["android", "1.0.0", "2"])),
      { ios: { version: "0.10.0", build: "1" }, android: { version: "1.0.0", build: "2" } },
    );
    // Build numbers compare as numbers, not strings.
    assert.deepEqual(newestShippedBuilds(registry(["ios", "0.9.0", "9"], ["ios", "0.9.0", "10"])).ios, { version: "0.9.0", build: "10" });
    // Every shape the registry's own validator accepts is read, past what the
    // API's header parser takes (which then answers it as supported).
    const wide = registry(["android", "0.9.0", "2026100101"], ["ios", "0.09.0", "3"]);
    assert.doesNotThrow(() => parseRegistry(wide));
    assert.deepEqual(newestShippedBuilds(wide), { ios: { version: "0.09.0", build: "3" }, android: { version: "0.9.0", build: "2026100101" } });
    assert.throws(() => newestShippedBuilds("{"), /not valid JSON/);
    assert.throws(() => newestShippedBuilds("{}"), /no `builds` array/);
  });

  it("reads expo.version strictly", () => {
    assert.equal(appVersionFrom(appJson("1.12.3")), "1.12.3");
    assert.throws(() => appVersionFrom("{"), /not valid JSON/);
    assert.throws(() => appVersionFrom(JSON.stringify({ expo: {} })), /got nothing/);
    assert.throws(() => appVersionFrom(appJson("0.9")), /not a version like 0\.9\.0/);
  });

  it("reads trusted files from the object store at a full SHA only", () => {
    const seen = [];
    const exec = (file, args) => {
      seen.push([file, ...args]);
      return "contents";
    };
    assert.equal(gitFileReader(TRUSTED_SHA, { exec })("a/b.ts"), "contents");
    assert.deepEqual(seen, [["git", "cat-file", "blob", `${TRUSTED_SHA}:a/b.ts`]]);
    assert.throws(() => gitFileReader("main", { exec })("a/b.ts"), /TRUSTED_SHA must be/);
    assert.throws(() => gitFileReader(undefined, { exec })("a/b.ts"), /got nothing/);
  });
});

describe("smokeFetch", () => {
  it("re-sends the probe POST on a 503, which writes nothing", async () => {
    let attempts = 0;
    const response = await smokeFetch(FUNCTION_URL, { method: "POST" }, {
      fetchImpl: async () => new Response(null, { status: (attempts += 1) === 1 ? 503 : 200 }),
      sleep: async () => {},
    });
    assert.equal(response.status, 200);
    assert.equal(attempts, 2);
  });
});

describe("report", () => {
  it("annotates failures and warnings, and counts only failures", () => {
    const { lines, failed } = report(
      [
        { check: "a", verdict: "pass", message: "fine" },
        { check: "b", verdict: "warn", message: "hm" },
        { check: "c", verdict: "fail", message: "broken" },
      ],
      "frapp-api-prod",
    );
    assert.deepEqual(lines, [
      "✅ [frapp-api-prod] a: fine",
      "::warning::[frapp-api-prod] b: hm",
      "::error::[frapp-api-prod] c: broken",
    ]);
    assert.equal(failed, 1);
  });
});

// What the script reads or restates, held against the code that owns it.
describe("the repo agrees with the probe", () => {
  const readRepoFile = (path) => readFileSync(join(REPO_ROOT, path), "utf8");

  it("reads the two constants the API builds its CORS lists from", () => {
    const { own, other } = dashboardOrigins("production", readRepoFile);
    for (const origin of [own, other]) assert.equal(new URL(origin).origin, origin);
    assert.notEqual(own, other);
    assert.deepEqual(dashboardOrigins("staging", readRepoFile), { own: other, other: own });
    const cors = readRepoFile("apps/api/src/interface/http/cors.options.ts");
    assert.match(cors, /^\s*production: \[PRODUCTION_APP_ORIGIN\],$/m);
    assert.match(cors, /^\s*staging: \[STAGING_APP_ORIGIN, \.\.\.LOCAL_DEV_ORIGINS\],$/m);
  });

  it("reads the real app.json and shipped-builds registry", () => {
    for (const probe of clientProbes(readRepoFile)) assert.match(probe.header, /^(ios|android)\/\d+\.\d+\.\d+(\+\d+)?$/);
  });

  it("names the function the API calls, and that directory deploys", () => {
    const copier = readRepoFile("apps/api/src/infrastructure/storage/supabase-archive-media-copier.service.ts");
    assert.match(copier, new RegExp(`export const ARCHIVE_MEDIA_COPY_FUNCTION = '${COPY_FUNCTION}';`));
    assert.ok(existsSync(join(REPO_ROOT, "supabase", "functions", COPY_FUNCTION, "index.ts")));
  });

  it("names the variables the client-policy minimum is read from", () => {
    const service = readRepoFile("apps/api/src/application/services/client-policy.service.ts");
    for (const [platform, variable] of Object.entries(MINIMUM_VERSION_VARIABLES)) {
      assert.match(service, new RegExp(`${platform}: '${variable}'`));
    }
  });
});

// The origins and the probed builds come from the trusted ref, never the
// deployed tree: a rollback to an older commit is judged against today's.
describe("runSmokeChecks: reads the trusted ref by default", () => {
  const head = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const readDefault = async (sha) => {
    const { fetchImpl } = makeFetch({
      [`OPTIONS ${API}/v1/client-policy`]: preflight([]),
      [`GET ${API}/v1/client-policy`]: clientPolicy(),
      [`POST ${FUNCTION_URL}`]: copyFunction(),
    });
    return runSmokeChecks({ env: env({ TRUSTED_SHA: sha }), fetchImpl });
  };

  it("reads the origins and the builds from TRUSTED_SHA's objects", async () => {
    const results = await readDefault(head);
    const { own, other } = dashboardOrigins("production", (path) => readFileSync(join(REPO_ROOT, path), "utf8"));
    assert.deepEqual(results.filter((r) => /^CORS/.test(r.check)).map((r) => r.check), [`CORS admits ${own}`, `CORS refuses ${other}`]);
    assert.equal(results.filter((r) => /^client policy serves/.test(r.check)).length, 2);
  });

  it("refuses to read anything without a full TRUSTED_SHA, rather than reading the working tree", async () => {
    const results = await readDefault("main");
    assert.deepEqual(verdicts(results).slice(0, 2), ["fail CORS", "fail client policy"]);
    for (const failed of results.slice(0, 2)) assert.match(failed.message, /TRUSTED_SHA must be/);
  });
});

describe("CLI", () => {
  it("exits 1 having asked nothing when TARGET_ENVIRONMENT is missing", () => {
    const childEnv = { ...process.env };
    delete childEnv.TARGET_ENVIRONMENT;
    const result = spawnSync(process.execPath, [SCRIPT], { env: childEnv, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /::error::\[API\] inputs: TARGET_ENVIRONMENT must be staging or production/);
  });
});
