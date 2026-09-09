import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERT_ISSUE_TITLE,
  DEFAULT_HEALTH_URL,
  HEALTH_FETCH_TIMEOUT_MS,
  SHA_PATTERN,
  V_TAG_REF,
  collectLiveShas,
  compareHostShas,
  evaluatePin,
  findLiveRenderDeployPage,
  isFullSha,
  peelVTags,
  readHealthCommitField,
  readLiveRenderCommit,
  readProductionVercelCommit,
  runWatchdog,
  tagNameFromRef,
  tagsMatchingSha,
} from "../production-release-pin.mjs";

import { makeFetchMock } from "./helpers.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "production-release-pin.yml");
const GUARDRAILS_WORKFLOW = join(
  REPO_ROOT,
  ".github",
  "workflows",
  "production-guardrails.yml",
);
const SCRIPT = join(REPO_ROOT, "scripts", "ci", "production-release-pin.mjs");
const ALERT_ROUTING = join(REPO_ROOT, "docs", "internal", "ops", "ALERT_ROUTING.md");
const REQUIRED_CHECKS = join(REPO_ROOT, "scripts", "ci", "lib", "required-checks.mjs");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");

const LIVE_SHA = "0ca478e9105105ff7013834615eee81499813d0e";
const OTHER_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TAG_OBJECT_SHA = "bca315f9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DECOY_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const HEALTHY_HOSTS = {
  api: { ok: true, sha: LIVE_SHA },
  web: { ok: true, sha: LIVE_SHA },
  landing: { ok: true, sha: LIVE_SHA },
};

function liveRenderPage({ sha = LIVE_SHA, extra = {} } = {}) {
  return [
    {
      deploy: {
        status: "live",
        commit: { id: sha },
      },
      serviceDetails: { commit: { id: DECOY_SHA } },
      commitId: DECOY_SHA,
      commit: { id: DECOY_SHA },
      ...extra,
    },
  ];
}

function vercelProductionBody({ sha = LIVE_SHA, extra = [] } = {}) {
  return {
    deployments: [
      {
        target: null,
        readyState: "READY",
        meta: { githubCommitSha: DECOY_SHA },
      },
      {
        target: "production",
        readyState: "READY",
        meta: { githubCommitSha: sha },
      },
      ...extra,
    ],
  };
}

/**
 * Provider `fetchJson` reads `.json()`. `ghRequest` reads `.text()`. Health
 * corroboration also uses `.text()`. One helper so a mock cannot satisfy one
 * caller and silently 500 the other.
 */
function dualFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ?? null, signal: init.signal ?? null });
    const route = routes.find((r) => r.method === method && String(url).includes(r.path));
    if (!route) {
      throw new Error(`unexpected ${method} ${url}`);
    }
    const status = route.status ?? 200;
    const payload = typeof route.body === "function" ? route.body(calls) : (route.body ?? {});
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      json: async () => (typeof payload === "string" ? JSON.parse(payload) : payload),
    };
  };
  return { fetchImpl, calls };
}

function uncommented(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

function envValue(yaml, name) {
  const match = yaml.match(new RegExp(`^\\s*${name}:\\s*(\\S+)\\s*$`, "m"));
  assert.ok(match, `${name} must be set in the workflow`);
  return match[1];
}

describe("isFullSha / V_TAG_REF", () => {
  it("accepts a 40-hex SHA and rejects an abbreviation", () => {
    assert.equal(isFullSha(LIVE_SHA), true);
    assert.equal(SHA_PATTERN.test(LIVE_SHA.slice(0, 8)), false);
    assert.equal(isFullSha("0ca478e9"), false);
  });

  it("matches vX.Y.Z refs and not very-old", () => {
    assert.equal(V_TAG_REF.test("refs/tags/v1.0.0"), true);
    assert.equal(V_TAG_REF.test("refs/tags/v0.1.0"), true);
    assert.equal(V_TAG_REF.test("refs/tags/very-old"), false);
    assert.equal(V_TAG_REF.test("refs/tags/v1.0.0-rc.1"), false);
    assert.equal(tagNameFromRef("refs/tags/v1.0.0"), "v1.0.0");
  });
});

describe("readLiveRenderCommit", () => {
  it("reads deploy.commit.id and ignores nested decoys", () => {
    assert.deepEqual(readLiveRenderCommit(liveRenderPage()), { ok: true, sha: LIVE_SHA });
  });

  it("fails an abbreviated SHA even when decoys are full-length", () => {
    const verdict = readLiveRenderCommit(liveRenderPage({ sha: "0ca478e9" }));
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /not a 40-hex SHA/);
  });

  it("fails when the page is not a list", () => {
    const verdict = readLiveRenderCommit({ deploys: liveRenderPage() });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /unreadable/);
  });

  it("fails when no row has status live", () => {
    const verdict = readLiveRenderCommit([
      { deploy: { status: "update_in_progress", commit: { id: LIVE_SHA } } },
    ]);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /status 'live'/);
  });
});

describe("readProductionVercelCommit", () => {
  it("reads the READY production row, not a READY preview", () => {
    assert.deepEqual(readProductionVercelCommit(vercelProductionBody(), "frapp-web"), {
      ok: true,
      sha: LIVE_SHA,
    });
  });

  it("fails when only a preview (target absent) is READY", () => {
    const verdict = readProductionVercelCommit(
      {
        deployments: [
          { target: null, readyState: "READY", meta: { githubCommitSha: LIVE_SHA } },
        ],
      },
      "frapp-web",
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /no READY production/);
  });

  it("fails an abbreviated githubCommitSha", () => {
    const verdict = readProductionVercelCommit(
      vercelProductionBody({ sha: "0ca478e9" }),
      "frapp-landing",
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /not a 40-hex SHA/);
  });

  it("accepts historical `state: READY` when readyState is absent", () => {
    const verdict = readProductionVercelCommit(
      {
        deployments: [
          {
            target: "production",
            state: "READY",
            meta: { githubCommitSha: LIVE_SHA },
          },
        ],
      },
      "frapp-web",
    );
    assert.deepEqual(verdict, { ok: true, sha: LIVE_SHA });
  });
});

describe("readHealthCommitField", () => {
  it("treats a missing commit as absent, not a failure", () => {
    assert.deepEqual(
      readHealthCommitField(JSON.stringify({ status: "ok", database: "connected" })),
      { present: false },
    );
  });

  it("treats non-JSON as absent", () => assert.deepEqual(readHealthCommitField("ok"), { present: false }));

  it("fails a present but abbreviated commit", () => {
    const verdict = readHealthCommitField(JSON.stringify({ commit: "0ca478e9" }));
    assert.equal(verdict.present, true);
    assert.equal(verdict.ok, false);
  });

  it("returns the SHA when present and full-length", () => {
    assert.deepEqual(readHealthCommitField(JSON.stringify({ commit: LIVE_SHA })), {
      present: true,
      ok: true,
      sha: LIVE_SHA,
    });
  });
});

describe("compareHostShas / evaluatePin", () => {
  it("fails a three-way mismatch", () => {
    const verdict = compareHostShas({
      api: { ok: true, sha: LIVE_SHA },
      web: { ok: true, sha: OTHER_SHA },
      landing: { ok: true, sha: LIVE_SHA },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /disagree/);
  });

  it("fails when any host is unreadable", () => {
    const verdict = compareHostShas({
      ...HEALTHY_HOSTS,
      web: { ok: false, reason: "Vercel frapp-web deployments list unreadable" },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /unreadable/);
  });

  it("fails when the live SHA has no vX.Y.Z tag", () => {
    const verdict = evaluatePin({
      hosts: HEALTHY_HOSTS,
      tagsResult: { ok: true, tags: [{ name: "v0.1.0", sha: OTHER_SHA }] },
      health: { present: false },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /no vX\.Y\.Z tag/);
  });

  it("fails when GitHub tags are unreadable — that is not a pass", () => {
    const verdict = evaluatePin({
      hosts: HEALTHY_HOSTS,
      tagsResult: { ok: false, reason: "GitHub tags unreadable (HTTP 500)" },
      health: { present: false },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /unreadable/);
  });

  it("ignores absent /health commit and passes with a matching tag", () => {
    const verdict = evaluatePin({
      hosts: HEALTHY_HOSTS,
      tagsResult: { ok: true, tags: [{ name: "v1.0.0", sha: LIVE_SHA }] },
      health: { present: false },
    });
    assert.equal(verdict.ok, true);
    assert.equal(
      verdict.reason,
      `api=web=landing=${LIVE_SHA} tagged v1.0.0`,
    );
  });

  it("fails when /health commit is present and disagrees with Render", () => {
    const verdict = evaluatePin({
      hosts: HEALTHY_HOSTS,
      tagsResult: { ok: true, tags: [{ name: "v1.0.0", sha: LIVE_SHA }] },
      health: { present: true, ok: true, sha: OTHER_SHA },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /disagrees with Render/);
  });

  it("passes when a present /health commit agrees with the hosts", () => {
    const verdict = evaluatePin({
      hosts: HEALTHY_HOSTS,
      tagsResult: { ok: true, tags: [{ name: "v1.0.0", sha: LIVE_SHA }] },
      health: { present: true, ok: true, sha: LIVE_SHA },
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.reason, `api=web=landing=${LIVE_SHA} tagged v1.0.0`);
  });

  it("sorts matching tag names", () => {
    assert.deepEqual(tagsMatchingSha([{ name: "v1.0.1", sha: LIVE_SHA }, { name: "v1.0.0", sha: LIVE_SHA }], LIVE_SHA), [
      "v1.0.0",
      "v1.0.1",
    ]);
  });
});

describe("findLiveRenderDeployPage", () => {
  it("pages until a live deploy appears", async () => {
    const { fetchImpl, calls } = dualFetch([
      {
        method: "GET",
        // More specific first: the unpaged path is a prefix of the cursor URL.
        path: "cursor=page-1",
        body: liveRenderPage(),
      },
      {
        method: "GET",
        path: "/deploys?limit=10",
        body: [{ cursor: "page-1", deploy: { status: "build_in_progress", commit: { id: OTHER_SHA } } }],
      },
    ]);
    const found = await findLiveRenderDeployPage({
      apiKey: "r",
      serviceId: "srv-test",
      fetchImpl,
    });
    assert.equal(found.live.ok, true);
    assert.equal(found.live.sha, LIVE_SHA);
    assert.equal(calls.length, 2);
  });
});

describe("peelVTags", () => {
  it("peels an annotated vX.Y.Z and skips very-old", async () => {
    const { fetchImpl, calls } = dualFetch([
      {
        method: "GET",
        path: "/git/matching-refs/tags/v",
        body: [
          {
            ref: "refs/tags/v1.0.0",
            object: { type: "tag", sha: TAG_OBJECT_SHA },
          },
          {
            ref: "refs/tags/very-old",
            object: { type: "commit", sha: OTHER_SHA },
          },
          {
            ref: "refs/tags/v0.1.0",
            object: { type: "commit", sha: OTHER_SHA },
          },
        ],
      },
      {
        method: "GET",
        path: `/git/tags/${TAG_OBJECT_SHA}`,
        body: { object: { type: "commit", sha: LIVE_SHA } },
      },
    ]);
    const result = await peelVTags({
      token: "t",
      repo: "pdcarlson/Frapp",
      fetchImpl,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.tags, [
      { name: "v1.0.0", sha: LIVE_SHA },
      { name: "v0.1.0", sha: OTHER_SHA },
    ]);
    assert.equal(
      calls.filter((c) => c.url.includes("/git/tags/")).length,
      1,
      "very-old and lightweight tags must not be peeled",
    );
  });

  it("fails closed when matching-refs is unreadable", async () => {
    const { fetchImpl } = dualFetch([
      { method: "GET", path: "/git/matching-refs/tags/v", status: 500, body: {} },
    ]);
    const result = await peelVTags({ token: "t", repo: "pdcarlson/Frapp", fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.reason, /HTTP 500/);
  });

  it("fails closed when an annotated-tag peel is unreadable", async () => {
    const { fetchImpl, calls } = dualFetch([
      {
        method: "GET",
        path: "/git/matching-refs/tags/v",
        body: [
          {
            ref: "refs/tags/v0.1.0",
            object: { type: "commit", sha: OTHER_SHA },
          },
          {
            ref: "refs/tags/v1.0.0",
            object: { type: "tag", sha: TAG_OBJECT_SHA },
          },
        ],
      },
      {
        method: "GET",
        path: `/git/tags/${TAG_OBJECT_SHA}`,
        status: 500,
        body: {},
      },
    ]);
    const result = await peelVTags({
      token: "t",
      repo: "pdcarlson/Frapp",
      fetchImpl,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /v1\.0\.0/);
    assert.match(result.reason, /HTTP 500/);
    assert.deepEqual(result.tags, []);
    assert.equal(
      calls.filter((c) => String(c.url).includes("/git/tags/")).length,
      1,
    );
  });
});

describe("collectLiveShas", () => {
  it("collects three hosts and ignores a missing /health commit", async () => {
    const { fetchImpl, calls } = dualFetch([
      { method: "GET", path: "/deploys?limit=10", body: liveRenderPage() },
      {
        method: "GET",
        path: "projectId=prj_web",
        body: vercelProductionBody(),
      },
      {
        method: "GET",
        path: "projectId=prj_landing",
        body: vercelProductionBody(),
      },
      {
        method: "GET",
        path: "/health",
        body: { status: "ok", database: "connected" },
      },
    ]);
    const hosts = await collectLiveShas({
      renderApiKey: "r",
      vercelApiKey: "v",
      teamId: "team_test",
      renderServiceId: "srv-test",
      webProjectId: "prj_web",
      landingProjectId: "prj_landing",
      healthUrl: DEFAULT_HEALTH_URL,
      fetchImpl,
    });
    assert.equal(hosts.api.ok, true);
    assert.equal(hosts.web.ok, true);
    assert.equal(hosts.landing.ok, true);
    assert.equal(hosts.health.present, false);
    assert.ok(calls.some((c) => c.url.includes("target=production")));
    assert.ok(calls.some((c) => c.url.includes("teamId=team_test")));
    const healthCall = calls.find((c) => String(c.url).includes("/health"));
    assert.ok(healthCall?.signal, "a stalled /health must not hold the 10-minute job");
    assert.equal(HEALTH_FETCH_TIMEOUT_MS, 10_000);
  });

  it("treats an unreadable Render API as a failed api SHA, not a throw", async () => {
    const { fetchImpl } = dualFetch([
      { method: "GET", path: "/deploys?limit=10", status: 502, body: {} },
      { method: "GET", path: "projectId=prj_web", body: vercelProductionBody() },
      { method: "GET", path: "projectId=prj_landing", body: vercelProductionBody() },
    ]);
    const hosts = await collectLiveShas({
      renderApiKey: "r",
      vercelApiKey: "v",
      renderServiceId: "srv-test",
      webProjectId: "prj_web",
      landingProjectId: "prj_landing",
      fetchImpl,
    });
    assert.equal(hosts.api.ok, false);
    assert.match(hosts.api.reason, /HTTP 502/);
  });

  it("ignores a thrown /health fetch", async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes("api.render.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => liveRenderPage(),
          text: async () => JSON.stringify(liveRenderPage()),
        };
      }
      if (String(url).includes("api.vercel.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => vercelProductionBody(),
          text: async () => JSON.stringify(vercelProductionBody()),
        };
      }
      throw new Error("ECONNRESET");
    };
    const hosts = await collectLiveShas({
      renderApiKey: "r",
      vercelApiKey: "v",
      renderServiceId: "srv-test",
      webProjectId: "prj_web",
      landingProjectId: "prj_landing",
      healthUrl: DEFAULT_HEALTH_URL,
      fetchImpl,
    });
    assert.equal(hosts.health.present, false);
  });
});

describe("runWatchdog", () => {
  const failVerdict = {
    ok: false,
    reason: `host SHAs disagree: api=${LIVE_SHA} web=${OTHER_SHA} landing=${LIVE_SHA}`,
  };
  const passVerdict = {
    ok: true,
    sha: LIVE_SHA,
    tags: ["v1.0.0"],
    reason: `api=web=landing=${LIVE_SHA} tagged v1.0.0`,
  };

  it("raises one alert on failure and comments on a still-open one", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      { method: "GET", path: "/issues?state=all", body: [] },
      { method: "POST", path: "/issues", body: { number: 42 } },
    ]);
    const created = await runWatchdog({
      verdict: failVerdict,
      token: "t",
      repo: "pdcarlson/Frapp",
      fetchImpl,
    });
    assert.equal(created.outcome, "fail");
    assert.equal(created.alert.action, "created");
    const createdBody = JSON.parse(calls.find((c) => c.method === "POST").body);
    assert.equal(createdBody.title, ALERT_ISSUE_TITLE);
    assert.ok(createdBody.labels.includes("routine-state"));
    assert.ok(createdBody.labels.includes("P1"));
    assert.doesNotMatch(createdBody.body, /\b(fixes|closes|close)\s+#/i);

    const { fetchImpl: fetchAgain, calls: later } = makeFetchMock([
      {
        method: "GET",
        path: "/issues?state=all",
        body: [{ number: 42, title: ALERT_ISSUE_TITLE, state: "open" }],
      },
      { method: "PATCH", path: "/issues/42", body: { number: 42 } },
      { method: "POST", path: "/comments", body: {} },
    ]);
    const again = await runWatchdog({
      verdict: failVerdict,
      token: "t",
      repo: "pdcarlson/Frapp",
      fetchImpl: fetchAgain,
    });
    assert.equal(again.outcome, "fail");
    assert.equal(again.alert.action, "commented");
    assert.ok(later.some((c) => c.method === "POST" && c.url.includes("/comments")));
  });

  it("closes the alert on recovery only when lookup succeeded", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: "/issues?state=all",
        body: [{ number: 42, title: ALERT_ISSUE_TITLE, state: "open" }],
      },
      { method: "PATCH", path: "/issues/42", body: { number: 42 } },
      { method: "POST", path: "/comments", body: {} },
    ]);
    const out = await runWatchdog({
      verdict: passVerdict,
      token: "t",
      repo: "pdcarlson/Frapp",
      fetchImpl,
    });
    assert.equal(out.outcome, "pass");
    assert.equal(out.resolved, true);
    assert.ok(calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/42")));
  });

  it("does not close an alert when the lookup itself failed", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      { method: "GET", path: "/issues?state=all", status: 500, body: {} },
    ]);
    const out = await runWatchdog({
      verdict: passVerdict,
      token: "t",
      repo: "pdcarlson/Frapp",
      fetchImpl,
    });
    assert.equal(out.outcome, "pass");
    assert.equal(out.resolved, false);
    assert.equal(out.lookupOk, false);
    assert.equal(
      calls.filter((c) => c.method === "PATCH").length,
      0,
      "a failed lookup must not be treated as no open alert",
    );
  });

  it("does not treat a failed close PATCH as recovery", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: "/issues?state=all",
        body: [{ number: 42, title: ALERT_ISSUE_TITLE, state: "open" }],
      },
      { method: "POST", path: "/comments", body: {} },
      { method: "PATCH", path: "/issues/42", status: 502, body: {} },
    ]);
    const out = await runWatchdog({
      verdict: passVerdict,
      token: "t",
      repo: "pdcarlson/Frapp",
      fetchImpl,
    });
    assert.equal(out.outcome, "fail");
    assert.equal(out.resolved, false);
    assert.ok(calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/42")));
  });
});

describe("workflow wiring", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");
  const guardrails = readFileSync(GUARDRAILS_WORKFLOW, "utf8");
  const liveYaml = uncommented(workflow);
  const script = readFileSync(SCRIPT, "utf8");
  const routing = readFileSync(ALERT_ROUTING, "utf8");
  const roster = readFileSync(REQUIRED_CHECKS, "utf8");

  it("does not name environment: production — a schedule job that did would suspend on #1435", () => {
    assert.doesNotMatch(liveYaml, /^\s*environment:\s*production\s*$/m);
    assert.doesNotMatch(liveYaml, /environment:\s*production/);
    assert.doesNotMatch(liveYaml, /environment:\s*["']production["']/);
    assert.doesNotMatch(liveYaml, /^\s*name:\s*["']?production["']?\s*$/m);
  });

  it("is schedule + workflow_dispatch only — not a required PR check", () => {
    assert.match(workflow, /cron: "0 8 \* \* \*"/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /pull_request:/);
    assert.doesNotMatch(roster, /production-release-pin/);
  });

  it("no other daily schedule shares 08:00", () => {
    for (const file of readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f))) {
      if (file === "production-release-pin.yml") continue;
      const text = uncommented(readFileSync(join(WORKFLOWS_DIR, file), "utf8"));
      assert.doesNotMatch(
        text,
        /cron:\s*"0 8 \* \* \*"/,
        `${file} collides with production-release-pin.yml at 08:00 UTC`,
      );
    }
  });

  it("service and project ids stay in step with production-guardrails.yml", () => {
    for (const name of [
      "RENDER_SERVICE_ID",
      "VERCEL_WEB_PROJECT_ID",
      "VERCEL_LANDING_PROJECT_ID",
      "VERCEL_TEAM_ID",
    ]) {
      assert.equal(envValue(liveYaml, name), envValue(uncommented(guardrails), name));
    }
  });

  it("does not bake those ids into the script as defaults", () => {
    assert.doesNotMatch(script, /srv-d6lqu41aae7s73f62df0/);
    assert.doesNotMatch(script, /prj_xkn32taKrJCgYRZoN6pZRfGfPT9T/);
    assert.doesNotMatch(script, /prj_aAkER9EZJcxR51vUY0mwNDnCf8vy/);
  });

  it("corroborates /health, never /health/ready", () => {
    assert.match(workflow, /API_HEALTH_URL: https:\/\/api\.frapp\.live\/health$/m);
    assert.doesNotMatch(liveYaml, /health\/ready/);
    assert.equal(DEFAULT_HEALTH_URL, "https://api.frapp.live/health");
  });

  it("ALERT_ROUTING.md lists this alert title so the roster cannot drop it again", () => {
    assert.ok(
      routing.includes(ALERT_ISSUE_TITLE),
      "ALERT_ROUTING.md must name the new alert; #1674 was this exact miss for guardrails",
    );
  });

  it("the script refuses a GitHub closer in its alert copy", () => {
    assert.doesNotMatch(script, /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i);
  });

  it("requires GitHub credentials before collect when not --probe-only", () => {
    const main = script.slice(script.indexOf("async function main()"));
    const tokenIdx = main.indexOf('requireEnv("GITHUB_TOKEN")');
    const collectIdx = main.indexOf("await collectLiveShas");
    const probeOnlyIdx = main.indexOf("probeOnly");
    assert.ok(tokenIdx !== -1, "main() must require GITHUB_TOKEN");
    assert.ok(collectIdx !== -1, "main() must collect live SHAs");
    assert.ok(probeOnlyIdx !== -1 && probeOnlyIdx < tokenIdx, "--probe-only must skip GitHub");
    assert.ok(
      tokenIdx < collectIdx,
      "a missing token must not look like a successful watch of production",
    );
  });

  it("runs the pin script with no npm ci", () => {
    assert.match(liveYaml, /node scripts\/ci\/production-release-pin\.mjs/);
    assert.doesNotMatch(liveYaml, /npm ci/);
  });
});
