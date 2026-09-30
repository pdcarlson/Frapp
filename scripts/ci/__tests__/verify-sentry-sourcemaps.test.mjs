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
  CLOCK_SKEW_MS,
  outputWords,
  projectsToCheck,
  SOURCEMAP_PROJECTS,
  VERDICTS,
  verifySentrySourcemaps,
} from "../verify-sentry-sourcemaps.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "verify-sentry-sourcemaps.mjs");
const REPO_ROOT = join(dirname(SCRIPT), "..", "..");

const SINCE = "2026-09-30T12:00:00Z";
const SINCE_MS = Date.parse(SINCE);
const AFTER = "2026-09-30T12:05:00Z";
const BEFORE = "2026-09-30T11:00:00Z";

const bundle = (release, { fileCount = 12, date = AFTER, dateModified } = {}) => ({
  bundleId: "b-1",
  associations: [{ release, dist: null }],
  fileCount,
  date,
  ...(dateModified ? { dateModified } : {}),
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

/** A clock that only moves when slept on, and records the sleeps. */
function fakeClock() {
  let now = 0;
  const sleeps = [];
  return {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

const ENV = {
  DEPLOY_SHA: SHA,
  API_BUILT: "true",
  FRONTENDS_BUILT: "true",
  SOURCEMAPS_SINCE: SINCE,
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
    const api = readFileSync(join(REPO_ROOT, "apps", "api", "src", "infrastructure", "observability", "upload-sentry-sourcemaps.ts"), "utf8");
    assert.match(api, /API_SENTRY_PROJECT = 'frapp-api'/);
    assert.match(api, /API_SENTRY_ORG = 'frapp-live'/);
    for (const [app, project] of [["web", "frapp-web"], ["landing", "frapp-landing"]]) {
      const config = readFileSync(join(REPO_ROOT, "apps", app, "next.config.js"), "utf8");
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
    await checkProject({ project: "frapp-api", release: SHA, sinceMs: SINCE_MS, token: "sntrys_secret", fetchImpl, clock: fakeClock() });
    assert.equal(calls[0].init.headers.Authorization, "Bearer sntrys_secret");
    assert.doesNotMatch(calls[0].url, /sntrys_secret/);
  });
});

describe("reading the answer", () => {
  const since = { sinceMs: SINCE_MS };

  it("is present only for a bundle associated with this release", () => {
    assert.equal(classifyBundles([bundle(SHA)], SHA, since).verdict, "present");
    assert.equal(classifyBundles([bundle(OTHER_SHA)], SHA, since).verdict, "missing");
    assert.equal(classifyBundles([], SHA, since).verdict, "missing");
  });

  it("does not count a bundle Sentry says holds no files", () => {
    assert.equal(classifyBundles([bundle(SHA, { fileCount: 0 })], SHA, since).verdict, "missing");
    const withoutCount = { ...bundle(SHA), fileCount: undefined };
    assert.equal(classifyBundles([withoutCount], SHA, since).verdict, "present", "an absent count isn't evidence of an empty bundle");
  });

  it("reads anything but a list of bundles as unverifiable, never as missing", () => {
    // The endpoint is undocumented: a changed shape must not raise an alert.
    assert.equal(classifyBundles({ detail: "x" }, SHA, since).verdict, "unverifiable");
    assert.equal(classifyBundles(null, SHA, since).verdict, "unverifiable");
    assert.equal(classifyBundles([{ bundleId: "b" }], SHA, since).verdict, "unverifiable");
  });

  describe("only this run's uploads count", () => {
    it("does not count another build's bundle for the same release", () => {
      // Staging uploaded this commit's maps an hour before production's builds
      // began; production's own build uploaded nothing (web: its chunks differ;
      // API: a build without the token injects no debug IDs).
      const result = classifyBundles([bundle(SHA, { date: BEFORE })], SHA, since);
      assert.equal(result.verdict, "missing");
      assert.match(result.detail, /earlier build's/);
      assert.match(result.detail, /cached upload/, "the cached-layer case is named");
    });

    it("counts a bundle uploaded after the builds began, or re-uploaded since", () => {
      assert.equal(classifyBundles([bundle(SHA, { date: AFTER })], SHA, since).verdict, "present");
      assert.equal(classifyBundles([bundle(SHA, { date: BEFORE, dateModified: AFTER })], SHA, since).verdict, "present");
      assert.equal(classifyBundles([bundle(SHA, { date: BEFORE }), bundle(SHA, { date: AFTER })], SHA, since).verdict, "present");
    });

    it("allows for the runner's clock running ahead of Sentry's", () => {
      const justBefore = new Date(SINCE_MS - CLOCK_SKEW_MS + 1000).toISOString();
      assert.equal(classifyBundles([bundle(SHA, { date: justBefore })], SHA, since).verdict, "present");
    });

    it("is unverifiable when a matching bundle's upload time can't be read", () => {
      assert.equal(classifyBundles([bundle(SHA, { date: "yesterday" })], SHA, since).verdict, "unverifiable");
      assert.equal(classifyBundles([{ ...bundle(SHA), date: undefined }], SHA, since).verdict, "unverifiable");
    });
  });
});

describe("one project's verdict", () => {
  const check = (handlers, extra = {}) => {
    const { fetchImpl, calls } = makeFetch(handlers);
    const clock = extra.clock ?? fakeClock();
    return checkProject({ project: "frapp-web", release: SHA, sinceMs: SINCE_MS, token: "t", fetchImpl, clock, ...extra }).then((result) => ({
      result,
      calls,
      clock,
    }));
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

  it("asks for the last time a full window after the first, and says so", async () => {
    const { result, calls, clock } = await check([response(200, [])], { windowMs: 60_000, intervalMs: 15_000 });
    assert.equal(result.verdict, "missing");
    assert.equal(calls.length, 5, "reads at 0, 15, 30, 45 and 60 s");
    assert.deepEqual(clock.sleeps, [15_000, 15_000, 15_000, 15_000, 15_000]);
    assert.match(result.detail, /\(asked 5 time\(s\), the last 60s after the first\)/);
  });

  it("counts a slow read against the window, and reports the asks it actually made", async () => {
    // Each read takes 40 s on the fake clock: the second starts at 55 s, and
    // the loop gives up once that one and its interval end past 75 s.
    const clock = fakeClock();
    const slow = async () => {
      await clock.sleep(40_000);
      return response(200, []);
    };
    const { result, calls } = await check([slow], { clock, windowMs: 60_000, intervalMs: 15_000 });
    assert.equal(result.verdict, "missing");
    assert.equal(calls.length, 2);
    assert.match(result.detail, /\(asked 2 time\(s\), the last 55s after the first\)/, "measured, not the window");
  });

  it("is rejected on 401: the token that uploads can't read either", async () => {
    const { result, calls } = await check([response(401, { detail: "no" })]);
    assert.equal(result.verdict, "rejected");
    assert.equal(calls.length, 1, "a refusal is not re-asked");
  });

  it("asks the documented releases list after a 403, before calling the token dead", async () => {
    // Both refuse: the token can read nothing, so it can't upload either.
    const refused = await check([response(403, {}), response(403, {})]);
    assert.equal(refused.result.verdict, "rejected");
    assert.equal(refused.calls.length, 2);
    assert.equal(
      refused.calls[1].url,
      `https://sentry.io/api/0/organizations/frapp-live/releases/?per_page=1&query=${SHA}`,
    );
    assert.equal(refused.calls[1].init.headers.Authorization, "Bearer t");
    // The releases list answers: the undocumented endpoint wants a scope the
    // upload may not, which is no verdict on the maps.
    const scoped = await check([response(403, {}), response(200, [])]);
    assert.equal(scoped.result.verdict, "unverifiable");
    assert.match(scoped.result.detail, /wants a scope/);
    // The probe itself fails: nothing to judge by.
    const unknown = await check([response(403, {}), response(502, {})]);
    assert.equal(unknown.result.verdict, "unverifiable");
    const thrown = await check([response(403, {}), new Error("fetch failed")]);
    assert.equal(thrown.result.verdict, "unverifiable");
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
  it("judges every project, unbuilt ones included, asking only about what the run built", async () => {
    const { fetchImpl, calls } = makeFetch([response(200, [bundle(SHA)])]);
    const { report } = await verifySentrySourcemaps({
      env: { ...ENV, FRONTENDS_BUILT: "false" },
      fetchImpl,
      clock: fakeClock(),
    });
    assert.deepEqual(
      Object.fromEntries(Object.entries(report).map(([project, { verdict }]) => [project, verdict])),
      { "frapp-api": "present", "frapp-web": "unbuilt", "frapp-landing": "unbuilt" },
    );
    assert.equal(calls.length, 1);
    assert.equal(outputWords(report), "present unbuilt unbuilt");
  });

  it("asks all three at once", async () => {
    // Every fetch waits until all three are in flight, or 2 s pass. Sequential
    // checks never have more than one in flight, so they fail the assertion
    // after the timer instead of hanging.
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
      setTimeout(resolve, 2000).unref();
    });
    let inFlight = 0;
    let most = 0;
    const fetchImpl = async (url) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      if (inFlight === 3) release();
      await gate;
      inFlight -= 1;
      return response(200, url.includes("frapp-landing") ? [] : [bundle(SHA)]);
    };
    const { report } = await verifySentrySourcemaps({ env: ENV, fetchImpl, clock: fakeClock(), windowMs: 1 });
    assert.equal(most, 3, "all three projects were asked at the same time");
    assert.equal(outputWords(report), "present present missing");
  });

  it("filters every project by SOURCEMAPS_SINCE", async () => {
    // Staging's bundles for this commit don't count for this run, the API's
    // included.
    const { fetchImpl } = makeFetch([response(200, [bundle(SHA, { date: BEFORE })])]);
    const { report } = await verifySentrySourcemaps({ env: ENV, fetchImpl, clock: fakeClock(), windowMs: 1 });
    assert.equal(outputWords(report), "missing missing missing");
  });

  it("won't judge any project without SOURCEMAPS_SINCE", async () => {
    const { fetchImpl, calls } = makeFetch([response(200, [bundle(SHA)])]);
    const { report } = await verifySentrySourcemaps({ env: { ...ENV, SOURCEMAPS_SINCE: "" }, fetchImpl, clock: fakeClock() });
    assert.equal(outputWords(report), "unverifiable unverifiable unverifiable");
    assert.equal(calls.length, 0);
  });

  it("asks nothing without a token: every build that read the same Infisical environment uploaded nothing", async () => {
    const { fetchImpl, calls } = makeFetch([response(200, [])]);
    const { report } = await verifySentrySourcemaps({ env: { ...ENV, SENTRY_AUTH_TOKEN: "" }, fetchImpl, clock: fakeClock() });
    assert.equal(calls.length, 0);
    assert.equal(outputWords(report), "no-token no-token no-token");
  });

  it("uses SENTRY_URL when it is set, as sentry-cli does", async () => {
    const { fetchImpl, calls } = makeFetch([response(200, [bundle(SHA)])]);
    await verifySentrySourcemaps({
      env: { ...ENV, FRONTENDS_BUILT: "false", SENTRY_URL: "https://de.sentry.io" },
      fetchImpl,
      clock: fakeClock(),
    });
    assert.ok(calls.every((c) => c.url.startsWith("https://de.sentry.io/api/0/")));
  });

  it("reports nothing, with a reason, for inputs that don't describe a deploy to check", async () => {
    const cases = [
      { ...ENV, DEPLOY_SHA: "main" },
      { ...ENV, DEPLOY_SHA: SHA.toUpperCase() },
      { ...ENV, API_BUILT: "false", FRONTENDS_BUILT: "" },
    ];
    for (const env of cases) {
      const { fetchImpl, calls } = makeFetch([response(200, [])]);
      const { report, reason } = await verifySentrySourcemaps({ env, fetchImpl, clock: fakeClock() });
      assert.equal(report, null);
      assert.ok(reason);
      assert.equal(calls.length, 0);
    }
  });

  it("annotates every failing verdict, summarises all of them, and never names the environment", () => {
    const report = {
      "frapp-api": { verdict: "present", detail: "1 artifact bundle(s)" },
      "frapp-web": { verdict: "missing", detail: "no bundle | none" },
      "frapp-landing": { verdict: "unbuilt", detail: "this run didn't build it" },
    };
    const annotations = annotationsFor(report);
    assert.deepEqual(annotations, ["::warning::Sentry source maps for frapp-web: missing — no bundle | none"]);
    const summary = buildSummary(report, SHA);
    assert.match(summary, /\| `frapp-api` \| `present` \|/);
    assert.match(summary, /no bundle \\\| none/, "a pipe in a detail doesn't break the table");
    assert.doesNotMatch(annotations.join("\n") + summary, /staging|production/);
  });
});

describe("the output", () => {
  it("is words that no masked value can be inside: no environment, SHA, digit or free text", () => {
    // The runner drops a job output containing a value the Infisical injection
    // masked: NODE_ENV (staging, production), PORT (digits a SHA can hold).
    for (const word of VERDICTS) {
      assert.match(word, /^[a-z-]+$/, word);
      assert.doesNotMatch(word, /staging|production/);
    }
    const report = Object.fromEntries(Object.keys(SOURCEMAP_PROJECTS).map((p) => [p, { verdict: "missing", detail: `${SHA} staging` }]));
    assert.equal(outputWords(report), "missing missing missing");
  });
});

describe("the script never fails the deploy", () => {
  const spawn = (env, output) =>
    spawnSync(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH, ...env, ...(output ? { GITHUB_OUTPUT: output } : {}) },
      encoding: "utf8",
      timeout: 60_000,
    });

  it("exits 0 with a warning when its inputs are wrong", () => {
    const result = spawn({ DEPLOY_SHA: "main", API_BUILT: "true" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /::warning::Sentry source-map check did not run: DEPLOY_SHA/);
  });

  it("exits 0 with a warning when it crashes", () => {
    // GITHUB_OUTPUT is a directory, so writing the verdicts throws EISDIR
    // inside main(); only the catch-all stands between that and exit 1.
    const dir = mkdtempSync(join(tmpdir(), "sourcemaps-"));
    const result = spawn({ ...ENV, SENTRY_AUTH_TOKEN: "" }, dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /::warning::Sentry source-map check crashed/);
    assert.match(result.stdout, /EISDIR/);
  });

  it("exits 0 when Sentry can't be reached, writing only verdict words, never the token", () => {
    const dir = mkdtempSync(join(tmpdir(), "sourcemaps-"));
    const output = join(dir, "output");
    const result = spawn(
      {
        ...ENV,
        FRONTENDS_BUILT: "false",
        // Nothing listens here, so the request fails fast.
        SENTRY_URL: "http://127.0.0.1:9",
      },
      output,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /::warning::Sentry source maps for frapp-api: unverifiable/);
    assert.equal(readFileSync(output, "utf8"), "verdicts=unverifiable unbuilt unbuilt\n");
    assert.doesNotMatch(result.stdout, /sntrys_test/, "the token is never printed");
  });
});
