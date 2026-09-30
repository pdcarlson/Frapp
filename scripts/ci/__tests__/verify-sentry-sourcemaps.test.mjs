import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  artifactBundlesUrl,
  annotationsFor,
  buildSummary,
  checkProject,
  classifyBundles,
  projectsToCheck,
  SOURCEMAP_PROJECTS,
  verifySentrySourcemaps,
} from "../verify-sentry-sourcemaps.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "verify-sentry-sourcemaps.mjs");

const bundle = (release, fileCount = 12) => ({
  bundleId: "b-1",
  associations: [{ release, dist: null }],
  fileCount,
  date: "2026-09-30T00:00:00Z",
});

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

/** Answers each call with the next handler (the last one repeats). */
function makeFetch(handlers) {
  const calls = [];
  let index = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    if (handler instanceof Error) throw handler;
    return typeof handler === "function" ? handler(url) : handler;
  };
  return { fetchImpl, calls };
}

const noSleep = { now: () => 0, sleep: async () => {} };

const ENV = {
  TARGET_ENVIRONMENT: "staging",
  DEPLOY_SHA: SHA,
  API_BUILT: "true",
  FRONTENDS_BUILT: "true",
  SENTRY_AUTH_TOKEN: "sntrys_test",
};

describe("which projects a run checks", () => {
  it("is the API when the API was built, web and landing when the frontends were", () => {
    assert.deepEqual(projectsToCheck({ apiBuilt: true, frontendsBuilt: false }), ["frapp-api"]);
    assert.deepEqual(projectsToCheck({ apiBuilt: false, frontendsBuilt: true }), ["frapp-web", "frapp-landing"]);
    assert.deepEqual(projectsToCheck({ apiBuilt: true, frontendsBuilt: true }), ["frapp-api", "frapp-web", "frapp-landing"]);
    assert.deepEqual(projectsToCheck({ apiBuilt: false, frontendsBuilt: false }), []);
  });

  it("names the projects the builds upload to", () => {
    // The API's upload script and both next.config.js files name these.
    const api = readFileSync(join(dirname(SCRIPT), "..", "..", "apps", "api", "src", "infrastructure", "observability", "upload-sentry-sourcemaps.ts"), "utf8");
    assert.match(api, /API_SENTRY_PROJECT = 'frapp-api'/);
    assert.match(api, /API_SENTRY_ORG = 'frapp-live'/);
    for (const [app, project] of [["web", "frapp-web"], ["landing", "frapp-landing"]]) {
      const config = readFileSync(join(dirname(SCRIPT), "..", "..", "apps", app, "next.config.js"), "utf8");
      assert.match(config, new RegExp(`project: "${project}"`), `${app} uploads to ${project}`);
    }
    assert.deepEqual(Object.keys(SOURCEMAP_PROJECTS), ["frapp-api", "frapp-web", "frapp-landing"]);
  });
});

describe("the question it asks Sentry", () => {
  it("lists the project's artifact bundles for the release", () => {
    assert.equal(
      artifactBundlesUrl({ project: "frapp-web", release: SHA }),
      `https://sentry.io/api/0/projects/frapp-live/frapp-web/files/artifact-bundles/?query=${SHA}`,
    );
    assert.equal(
      artifactBundlesUrl({ baseUrl: "https://example.sentry.io/", project: "frapp-api", release: SHA }),
      `https://example.sentry.io/api/0/projects/frapp-live/frapp-api/files/artifact-bundles/?query=${SHA}`,
    );
  });

  it("sends the token as a bearer, and never in the URL", async () => {
    const { fetchImpl, calls } = makeFetch([response(200, [bundle(SHA)])]);
    await checkProject({ project: "frapp-api", release: SHA, token: "sntrys_secret", fetchImpl, clock: noSleep });
    assert.equal(calls[0].init.headers.Authorization, "Bearer sntrys_secret");
    assert.doesNotMatch(calls[0].url, /sntrys_secret/);
  });
});

describe("reading the answer", () => {
  it("is present only for a bundle associated with this release", () => {
    assert.equal(classifyBundles([bundle(SHA)], SHA).verdict, "present");
    assert.equal(classifyBundles([bundle(OTHER_SHA)], SHA).verdict, "missing");
    assert.equal(classifyBundles([], SHA).verdict, "missing");
  });

  it("does not count a bundle Sentry says holds no files", () => {
    assert.equal(classifyBundles([bundle(SHA, 0)], SHA).verdict, "missing");
    const withoutCount = { ...bundle(SHA), fileCount: undefined };
    assert.equal(classifyBundles([withoutCount], SHA).verdict, "present", "an absent count isn't evidence of an empty bundle");
  });

  it("reads anything but a list of bundles as unverifiable, never as missing", () => {
    // The endpoint is undocumented: a changed shape must not raise an alert.
    assert.equal(classifyBundles({ detail: "x" }, SHA).verdict, "unverifiable");
    assert.equal(classifyBundles(null, SHA).verdict, "unverifiable");
    assert.equal(classifyBundles([{ bundleId: "b" }], SHA).verdict, "unverifiable");
  });
});

describe("one project's verdict", () => {
  const check = (handlers, extra = {}) => {
    const { fetchImpl, calls } = makeFetch(handlers);
    return checkProject({ project: "frapp-web", release: SHA, token: "t", fetchImpl, clock: noSleep, ...extra }).then(
      (result) => ({ result, calls }),
    );
  };

  it("is present on the first answer that holds the release", async () => {
    const { result, calls } = await check([response(200, [bundle(SHA)])]);
    assert.equal(result.verdict, "present");
    assert.equal(calls.length, 1);
  });

  it("re-asks a missing answer, because Sentry assembles an upload after it lands", async () => {
    const { result, calls } = await check([response(200, []), response(200, []), response(200, [bundle(SHA)])]);
    assert.equal(result.verdict, "present");
    assert.equal(calls.length, 3);
  });

  it("is missing once every attempt said so, and says how long it waited", async () => {
    const sleeps = [];
    const clock = { now: () => 0, sleep: async (ms) => sleeps.push(ms) };
    const { result, calls } = await check([response(200, [])], { attempts: 3, intervalMs: 10_000, clock });
    assert.equal(result.verdict, "missing");
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [10_000, 10_000]);
    assert.match(result.detail, /asking 3 times over 20s/);
  });

  it("is rejected on 401 and 403: the token that uploads can't read either", async () => {
    for (const status of [401, 403]) {
      const { result, calls } = await check([response(status, { detail: "no" })]);
      assert.equal(result.verdict, "rejected", String(status));
      assert.equal(calls.length, 1, "a refusal is not re-asked");
    }
  });

  it("is no-project on 404", async () => {
    const { result } = await check([response(404, { detail: "The requested resource does not exist" })]);
    assert.equal(result.verdict, "no-project");
  });

  it("is unverifiable on a 5xx, a 429, a network failure or a body that isn't JSON", async () => {
    for (const handler of [
      response(502, {}),
      response(429, {}),
      Object.assign(new Error("fetch failed"), { cause: new Error("ECONNRESET") }),
      response(200, new SyntaxError("Unexpected token <")),
    ]) {
      const { result } = await check([handler]);
      assert.equal(result.verdict, "unverifiable");
    }
    const { result } = await check([Object.assign(new Error("fetch failed"), { cause: new Error("ENOTFOUND sentry.io") })]);
    assert.match(result.detail, /ENOTFOUND sentry\.io/, "the real reason reaches the log");
  });
});

describe("a deploy's report", () => {
  it("checks every project the run built, one verdict each", async () => {
    const { fetchImpl, calls } = makeFetch([(url) => response(200, url.includes("frapp-landing") ? [] : [bundle(SHA)])]);
    const { report } = await verifySentrySourcemaps({ env: ENV, fetchImpl, clock: noSleep, attempts: 1 });
    assert.equal(report.environment, "staging");
    assert.equal(report.sha, SHA);
    assert.deepEqual(
      Object.fromEntries(Object.entries(report.projects).map(([project, { verdict }]) => [project, verdict])),
      { "frapp-api": "present", "frapp-web": "present", "frapp-landing": "missing" },
    );
    assert.equal(calls.length, 3);
  });

  it("asks nothing without a token: every build that read the same Infisical environment uploaded nothing", async () => {
    const { fetchImpl, calls } = makeFetch([response(200, [])]);
    const { report } = await verifySentrySourcemaps({
      env: { ...ENV, TARGET_ENVIRONMENT: "production", SENTRY_AUTH_TOKEN: "" },
      fetchImpl,
      clock: noSleep,
    });
    assert.equal(calls.length, 0);
    for (const { verdict, detail } of Object.values(report.projects)) {
      assert.equal(verdict, "no-token");
      assert.match(detail, /Infisical `prod`/, "production's slug is prod");
    }
  });

  it("uses SENTRY_URL when it is set, as sentry-cli does", async () => {
    const { fetchImpl, calls } = makeFetch([response(200, [bundle(SHA)])]);
    await verifySentrySourcemaps({
      env: { ...ENV, API_BUILT: "false", SENTRY_URL: "https://de.sentry.io" },
      fetchImpl,
      clock: noSleep,
    });
    assert.ok(calls.every((c) => c.url.startsWith("https://de.sentry.io/api/0/")));
  });

  it("reports nothing, with a reason, for inputs that don't describe a deploy to check", async () => {
    const cases = [
      { ...ENV, TARGET_ENVIRONMENT: "preview" },
      { ...ENV, DEPLOY_SHA: "main" },
      { ...ENV, DEPLOY_SHA: SHA.toUpperCase() },
      { ...ENV, API_BUILT: "false", FRONTENDS_BUILT: "" },
    ];
    for (const env of cases) {
      const { fetchImpl, calls } = makeFetch([response(200, [])]);
      const { report, reason } = await verifySentrySourcemaps({ env, fetchImpl, clock: noSleep });
      assert.equal(report, null);
      assert.ok(reason);
      assert.equal(calls.length, 0);
    }
  });

  it("annotates every verdict but present, and summarises all of them", () => {
    const report = {
      environment: "staging",
      sha: SHA,
      projects: {
        "frapp-api": { verdict: "present", detail: "1 artifact bundle(s)" },
        "frapp-web": { verdict: "missing", detail: "no bundle | none" },
      },
    };
    const annotations = annotationsFor(report);
    assert.equal(annotations.length, 1);
    assert.match(annotations[0], /^::warning::Sentry source maps for frapp-web on staging: missing/);
    const summary = buildSummary(report);
    assert.match(summary, /\| `frapp-api` \| `present` \|/);
    assert.match(summary, /no bundle \\\| none/, "a pipe in a detail doesn't break the table");
  });
});

describe("the script never fails the deploy", () => {
  it("exits 0 and writes no output when its inputs are wrong", () => {
    const dir = mkdtempSync(join(tmpdir(), "sourcemaps-"));
    const output = join(dir, "output");
    const result = spawnSync(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH, TARGET_ENVIRONMENT: "nowhere", GITHUB_OUTPUT: output },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /::warning::Sentry source-map check did not run: TARGET_ENVIRONMENT/);
  });

  it("exits 0 with a warning when Sentry can't be reached, and still writes its report", () => {
    const dir = mkdtempSync(join(tmpdir(), "sourcemaps-"));
    const output = join(dir, "output");
    const result = spawnSync(process.execPath, [SCRIPT], {
      env: {
        PATH: process.env.PATH,
        ...ENV,
        API_BUILT: "true",
        FRONTENDS_BUILT: "false",
        // Nothing listens here, so the request fails fast.
        SENTRY_URL: "http://127.0.0.1:9",
        GITHUB_OUTPUT: output,
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /::warning::Sentry source maps for frapp-api on staging: unverifiable/);
    const written = readFileSync(output, "utf8");
    assert.match(written, /^verdicts=\{/);
    assert.equal(JSON.parse(written.slice("verdicts=".length)).projects["frapp-api"].verdict, "unverifiable");
    assert.doesNotMatch(result.stdout + written, /sntrys_test/, "the token is never printed");
  });
});
