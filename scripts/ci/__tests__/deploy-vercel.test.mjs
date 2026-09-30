import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEPLOY_PHASE_BUILD,
  DEPLOY_PHASE_UPLOAD,
  DRY_RUN_WITHHELD_KEYS,
  buildEnvsFor,
  buildVercelProjects as buildVercelProjectsImpl,
  classifyVercelState,
  createVercelDeployment as createVercelDeploymentImpl,
  deployVercel as deployVercelImpl,
  expectedDeploymentTarget,
  parseDeployPhase,
  parseDeployTarget,
  pollVercelDeployment,
  resolveDeploymentByHost,
  stashDirFor,
} from "../deploy-vercel.mjs";
import {
  VERCEL_TARGET_PREVIEW,
  VERCEL_TARGET_PRODUCTION,
  vercelDirFor,
} from "../lib/vercel-cli.mjs";

/**
 * An in-memory stand-in for the stash filesystem: a set of directory paths that
 * exist, plus a log of every move and remove. Pass `ops` to interleave that log
 * with other events.
 */
function makeStashFs(initial = [], ops = []) {
  const dirs = new Set(initial);
  return {
    dirs,
    ops,
    fs: {
      exists: async (p) => dirs.has(p),
      remove: async (p) => {
        ops.push(["remove", p]);
        dirs.delete(p);
      },
      move: async (from, to) => {
        ops.push(["move", from, to]);
        if (!dirs.has(from)) throw new Error(`ENOENT: ${from}`);
        dirs.delete(from);
        dirs.add(to);
      },
    },
  };
}

const CWD = "/work/repo";
const STASH_ROOT = "/tmp/vercel-builds";

// Every build and upload requires a build env since #2673. Most tests here are
// about ordering, polling and fail-fast, not about what the env carries, so
// these wrappers give each project a minimal one (and keep the CLI layer off
// the real disk) unless a test supplies its own.
const BUILD_ENV = Object.freeze({ baseEnv: { PATH: "/usr/bin" }, appEnv: {}, appKeys: [] });
function pulledEnvFs() {
  return { read: async () => 'VERCEL_ENV="production"\n', write: async () => {} };
}
function withBuildEnvs(options) {
  return {
    cwd: CWD,
    stashFs: makeStashFs().fs,
    envFileFs: pulledEnvFs(),
    ...options,
    projects: options.projects.map((project) => ({ buildEnv: BUILD_ENV, ...project })),
  };
}
// Every deploy builds in one phase and uploads in another since #2803, so
// `deployVercel` and `createVercelDeployment` are the upload alone and need the
// build phase's stash. Unless a test supplies its own, they start where a green
// build phase leaves them: one stash per project under STASH_ROOT.
const deployVercel = (options) =>
  deployVercelImpl(
    withBuildEnvs({
      stashRoot: STASH_ROOT,
      stashFs: makeStashFs(options.projects.map((p) => stashDirFor(options.stashRoot ?? STASH_ROOT, p.label))).fs,
      ...options,
    }),
  );
const buildVercelProjects = (options) => buildVercelProjectsImpl(withBuildEnvs(options));
const createVercelDeployment = (options) =>
  createVercelDeploymentImpl({
    buildEnv: BUILD_ENV,
    cwd: CWD,
    stashDir: stashDirFor(STASH_ROOT, options.label),
    stashFs: makeStashFs([stashDirFor(STASH_ROOT, options.label)]).fs,
    envFileFs: pulledEnvFs(),
    ...options,
  });

const SHA = "0123456789abcdef0123456789abcdef01234567";
const API_KEY = "test-key";
const TEAM_ID = "team_test";
const HOST = "frapp-web-abc123.vercel.app";

function makeFakeClock() {
  let nowMs = 1_000_000;
  return {
    now: () => nowMs,
    sleep: async (ms) => {
      nowMs += ms;
    },
  };
}

const quiet = { log: () => {} };

function okJson(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function errJson(status, body = {}) {
  return { ok: false, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function makeFetchStub(responses) {
  let index = 0;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const handler = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return typeof handler === "function" ? handler() : handler;
  };
  return { fetchImpl, calls };
}

function makeRunStub(host = HOST) {
  const calls = [];
  const runCommand = async ({ args, env }) => {
    calls.push({ step: args[0], args, projectId: env.VERCEL_PROJECT_ID });
    return {
      code: 0,
      stdout: args[0] === "deploy" ? `https://${host}\n` : "",
      stderr: "",
    };
  };
  return { runCommand, calls };
}

// ── The regression this file inherits from deploy-vercel-production.test.mjs ─
//
// Before the #1340 cutover, production deployments lived on the `production`
// branch, which had no earlier successful deployments — Vercel's own build log
// said `No previous deployments found for "web" on branch "production"`. That
// is the ONLY reason the push-triggered observer (`verify-vercel-deploy.mjs`,
// deleted in #1778) could safely call a CANCELED deployment neutral when a
// later push had overtaken it.
//
// Deploying from `main` inverts the precondition. And since #1578 there is a
// second, stronger reason: a deployment CI created from prebuilt output cannot
// be superseded at all — there is no push behind it for a newer push to cancel.
// So on this path a cancel is never neutral, in either channel.
describe("CANCELED: the CI-created path never reads a cancel as neutral", () => {
  it("reports FAILURE for a cancelled deployment it created", async () => {
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_cancelled", state: "CANCELED" })]);
    const result = await pollVercelDeployment({
      apiKey: API_KEY,
      deploymentId: "dpl_cancelled",
      teamId: TEAM_ID,
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });
    assert.equal(result.status, "failure");
    assert.match(result.message, /never a no-op/);
  });
});

describe("classifyVercelState", () => {
  it("READY is success", () => assert.equal(classifyVercelState("READY"), "success"));
  it("ERROR is failure", () => assert.equal(classifyVercelState("ERROR"), "failure"));
  it("CANCELED is failure, not neutral", () =>
    assert.equal(classifyVercelState("CANCELED"), "failure"));
  it("BUILDING is pending", () => assert.equal(classifyVercelState("BUILDING"), "pending"));
  it("an unrecognised state is pending, not success", () =>
    assert.equal(classifyVercelState("SOMETHING_NEW"), "pending"));
});

describe("expectedDeploymentTarget", () => {
  it("production expects the string production", () =>
    assert.equal(expectedDeploymentTarget(VERCEL_TARGET_PRODUCTION), "production"));

  // Vercel reports `null`, not "preview", for a preview deployment. Comparing
  // against the string "preview" would fail every staging deploy.
  it("preview expects null, not the string preview", () =>
    assert.equal(expectedDeploymentTarget(VERCEL_TARGET_PREVIEW), null));
});

describe("parseDeployTarget", () => {
  it("unset means production — matching the file this replaced", () => {
    assert.equal(parseDeployTarget(undefined), VERCEL_TARGET_PRODUCTION);
    assert.equal(parseDeployTarget(""), VERCEL_TARGET_PRODUCTION);
  });

  it("accepts both known channels", () => {
    assert.equal(parseDeployTarget("production"), VERCEL_TARGET_PRODUCTION);
    assert.equal(parseDeployTarget("preview"), VERCEL_TARGET_PREVIEW);
  });

  // Defaulting an unknown target either silently downgrades a release to
  // staging or, far worse, promotes a staging run to production.
  it("throws on anything else rather than guessing a channel", () => {
    assert.throws(() => parseDeployTarget("staging"), /Refusing to guess/);
    assert.throws(() => parseDeployTarget("prod"), /Refusing to guess/);
  });
});

describe("resolveDeploymentByHost", () => {
  it("resolves the hostname the CLI printed to a deployment id", async () => {
    const { fetchImpl, calls } = makeFetchStub([
      okJson({ id: "dpl_1", target: "production", url: HOST, meta: { githubCommitSha: SHA } }),
    ]);
    const result = await resolveDeploymentByHost({
      apiKey: API_KEY,
      host: HOST,
      teamId: TEAM_ID,
      fetchImpl,
    });
    assert.equal(result.deploymentId, "dpl_1");
    assert.equal(result.target, "production");
    assert.equal(result.sha, SHA, "the commit metadata must be carried back for the assertion");
    assert.ok(calls[0].url.includes(HOST));
    assert.ok(calls[0].url.includes(`teamId=${TEAM_ID}`));
  });

  it("throws when the lookup is refused", async () => {
    const { fetchImpl } = makeFetchStub([errJson(404, { error: "not_found" })]);
    await assert.rejects(
      resolveDeploymentByHost({ apiKey: API_KEY, host: HOST, teamId: TEAM_ID, fetchImpl }),
      /HTTP 404/,
    );
  });

  it("throws when the lookup returns no id", async () => {
    const { fetchImpl } = makeFetchStub([okJson({ target: "production" })]);
    await assert.rejects(
      resolveDeploymentByHost({ apiKey: API_KEY, host: HOST, teamId: TEAM_ID, fetchImpl }),
      /no deployment id/,
    );
  });
});

// The upload half of one project (#2803: the build ran in an earlier phase).
// That the build itself gets `--prod` is pinned on `buildVercelProjects` below.
describe("createVercelDeployment", () => {
  it("uploads the stashed build and identifies a production deployment, building nothing", async () => {
    const webStash = stashDirFor(STASH_ROOT, "frapp-web");
    const stash = makeStashFs([webStash]);
    const { runCommand, calls } = makeRunStub();
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_1", target: "production", meta: { githubCommitSha: SHA } })]);

    const result = await createVercelDeployment({
      apiKey: API_KEY,
      projectId: "prj_web",
      label: "frapp-web",
      sha: SHA,
      target: VERCEL_TARGET_PRODUCTION,
      teamId: TEAM_ID,
      stashDir: webStash,
      stashFs: stash.fs,
      runCommand,
      fetchImpl,
      logger: quiet,
    });

    assert.equal(result.deploymentId, "dpl_1");
    assert.deepEqual(
      calls.map((c) => c.step),
      ["deploy"],
    );
    assert.ok(calls[0].args.includes("--prod"), "a production upload must take production traffic");
    assert.deepEqual(stash.ops, [
      ["remove", vercelDirFor(CWD)],
      ["move", webStash, vercelDirFor(CWD)],
    ]);
  });

  // There is no single-phase path to fall back to (#2803). Uploading without
  // the stash would ship whatever `.vercel` holds.
  it("refuses to upload without a stash dir, before any CLI step", async () => {
    const stash = makeStashFs([vercelDirFor(CWD)]);
    const { runCommand, calls } = makeRunStub();
    const { fetchImpl, calls: fetches } = makeFetchStub([
      okJson({ id: "dpl_1", target: "production", meta: { githubCommitSha: SHA } }),
    ]);

    await assert.rejects(
      createVercelDeployment({
        apiKey: API_KEY,
        projectId: "prj_web",
        label: "frapp-web",
        sha: SHA,
        target: VERCEL_TARGET_PRODUCTION,
        teamId: TEAM_ID,
        stashDir: undefined,
        stashFs: stash.fs,
        runCommand,
        fetchImpl,
        logger: quiet,
      }),
      /\[frapp-web\] No stash dir/,
    );
    assert.equal(calls.length, 0, "nothing was uploaded");
    assert.equal(fetches.length, 0);
    assert.deepEqual(stash.ops, []);
  });

  // The assertion that matters: we asked for production; if Vercel recorded a
  // preview, traffic never moves and a poll on readyState alone would happily
  // report READY — a release that shipped nothing and said it worked.
  it("throws when a production deploy comes back as a preview", async () => {
    const { runCommand } = makeRunStub();
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_1", target: null, meta: { githubCommitSha: SHA } })]);

    await assert.rejects(
      createVercelDeployment({
        apiKey: API_KEY,
        projectId: "prj_web",
        label: "frapp-web",
        sha: SHA,
        target: VERCEL_TARGET_PRODUCTION,
        teamId: TEAM_ID,
        runCommand,
        fetchImpl,
        logger: quiet,
      }),
      /not 'production'/,
    );
  });

  it("throws when a staging deploy comes back as production", async () => {
    // The inverse mistake is worse: a staging run that took production traffic.
    const { runCommand } = makeRunStub();
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_1", target: "production", meta: { githubCommitSha: SHA } })]);

    await assert.rejects(
      createVercelDeployment({
        apiKey: API_KEY,
        projectId: "prj_web",
        label: "frapp-web",
        sha: SHA,
        target: VERCEL_TARGET_PREVIEW,
        teamId: TEAM_ID,
        runCommand,
        fetchImpl,
        logger: quiet,
      }),
      /not 'null'/,
    );
  });

  it("accepts a staging deploy reported with target null", async () => {
    const { runCommand, calls } = makeRunStub();
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_2", target: null, meta: { githubCommitSha: SHA } })]);

    const result = await createVercelDeployment({
      apiKey: API_KEY,
      projectId: "prj_web",
      label: "frapp-web",
      sha: SHA,
      target: VERCEL_TARGET_PREVIEW,
      teamId: TEAM_ID,
      runCommand,
      fetchImpl,
      logger: quiet,
    });

    assert.equal(result.deploymentId, "dpl_2");
    assert.deepEqual(
      calls.map((c) => c.step),
      ["deploy"],
    );
    assert.ok(!calls[0].args.includes("--prod"), "a staging upload must not take production traffic");
  });
});

describe("pollVercelDeployment", () => {
  it("polls the deployment id, never the project's deployment list", async () => {
    // Keying on the id is the whole reason CI creating the deployment is better
    // than an observer searching by SHA.
    const { fetchImpl, calls } = makeFetchStub([okJson({ id: "dpl_1", state: "READY" })]);
    const result = await pollVercelDeployment({
      apiKey: API_KEY,
      deploymentId: "dpl_1",
      teamId: TEAM_ID,
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });
    assert.equal(result.status, "success");
    assert.ok(calls[0].url.includes("/deployments/dpl_1"));
    assert.ok(!calls[0].url.includes("projectId"));
  });

  it("reads `readyState`, the only state field the single-deployment endpoint returns", async () => {
    // Vercel's `GET /v13/deployments/:id` documents `readyState` and `status`,
    // no top-level `state` (read 2026-09-30). The fixtures above spell it
    // `state`, so without this case a poll that stopped going through
    // `vercelDeploymentState` would pass here and time out on every real deploy.
    const { fetchImpl } = makeFetchStub([
      okJson({ id: "dpl_1", readyState: "BUILDING" }),
      okJson({ id: "dpl_1", readyState: "READY", status: "READY" }),
    ]);
    const result = await pollVercelDeployment({
      apiKey: API_KEY,
      deploymentId: "dpl_1",
      teamId: TEAM_ID,
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });
    assert.equal(result.status, "success");
  });

  it("fails on ERROR", async () => {
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_1", state: "ERROR" })]);
    const result = await pollVercelDeployment({
      apiKey: API_KEY,
      deploymentId: "dpl_1",
      teamId: TEAM_ID,
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });
    assert.equal(result.status, "failure");
  });

  it("fails on an API error rather than retrying forever", async () => {
    const { fetchImpl } = makeFetchStub([errJson(500)]);
    const result = await pollVercelDeployment({
      apiKey: API_KEY,
      deploymentId: "dpl_1",
      teamId: TEAM_ID,
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });
    assert.equal(result.status, "failure");
    assert.match(result.message, /HTTP 500/);
  });

  it("fails on timeout — never assumes a slow build went live", async () => {
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_1", state: "BUILDING" })]);
    const result = await pollVercelDeployment({
      apiKey: API_KEY,
      deploymentId: "dpl_1",
      teamId: TEAM_ID,
      clock: makeFakeClock(),
      fetchImpl,
      overallTimeoutMs: 60_000,
      logger: quiet,
    });
    assert.equal(result.status, "failure");
    assert.match(result.message, /Timed out/);
  });
});

describe("deployVercel", () => {
  const projects = [
    { projectId: "prj_web", label: "frapp-web" },
    { projectId: "prj_landing", label: "frapp-landing" },
  ];

  // `vercel build` writes .vercel/output into the working tree, so two builds
  // in one checkout would overwrite each other and each could upload the
  // other's bundle. This is the constraint that forces sequential builds, and
  // since each upload restores its stash into that same `.vercel`, sequential
  // uploads too. Both phases, one shared log: each project's step finishes
  // (stash included) before the next project's starts.
  it("finishes one project's build, and then its upload, before starting the next", async () => {
    const log = [];
    const stash = makeStashFs([], log);
    const vercelDir = vercelDirFor(CWD);
    const runCommand = async ({ args, env }) => {
      log.push([`${env.VERCEL_PROJECT_ID}:${args[0]}`]);
      if (args[0] === "build") stash.dirs.add(vercelDir);
      return { code: 0, stdout: args[0] === "deploy" ? `https://${HOST}\n` : "", stderr: "" };
    };
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_x", target: null, state: "READY", meta: { githubCommitSha: SHA } })]);
    const phase = {
      apiKey: API_KEY,
      projects,
      sha: SHA,
      target: VERCEL_TARGET_PREVIEW,
      teamId: TEAM_ID,
      cwd: CWD,
      stashRoot: STASH_ROOT,
      stashFs: stash.fs,
      runCommand,
      logger: quiet,
    };

    const built = await buildVercelProjects(phase);
    const outcome = await deployVercel({ ...phase, clock: makeFakeClock(), fetchImpl });

    assert.equal(built.ok, true);
    assert.equal(outcome.ok, true, JSON.stringify(outcome.failures));
    const webStash = stashDirFor(STASH_ROOT, "frapp-web");
    const landingStash = stashDirFor(STASH_ROOT, "frapp-landing");
    assert.deepEqual(log, [
      // build phase
      ["remove", vercelDir],
      ["prj_web:pull"],
      ["prj_web:build"],
      ["remove", webStash],
      ["move", vercelDir, webStash],
      ["remove", vercelDir],
      ["prj_landing:pull"],
      ["prj_landing:build"],
      ["remove", landingStash],
      ["move", vercelDir, landingStash],
      // upload phase
      ["remove", vercelDir],
      ["move", webStash, vercelDir],
      ["prj_web:deploy"],
      ["remove", vercelDir],
      ["move", landingStash, vercelDir],
      ["prj_landing:deploy"],
    ]);
  });

  it("fails the whole deploy when landing fails and web succeeds", async () => {
    const { runCommand } = makeRunStub();
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      // resolve web, resolve landing, then poll each.
      if (call <= 2) return okJson({ id: `dpl_${call}`, target: null, meta: { githubCommitSha: SHA } });
      if (call === 3) return okJson({ id: "dpl_1", state: "READY" });
      return okJson({ id: "dpl_2", state: "ERROR" });
    };

    const outcome = await deployVercel({
      apiKey: API_KEY,
      projects,
      sha: SHA,
      target: VERCEL_TARGET_PREVIEW,
      teamId: TEAM_ID,
      clock: makeFakeClock(),
      runCommand,
      fetchImpl,
      logger: quiet,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.failures.length, 1);
    assert.equal(outcome.failures[0].label, "frapp-landing");
  });

  // A project whose build never ran must not vanish from the report — a
  // deploy that silently ships one of two apps is the worst outcome here. The
  // build phase's half of this is on `buildVercelProjects` below; this is the
  // upload phase's: no stash for landing is a reported failure, not a skip.
  it("reports a project with no stashed build as a failure rather than skipping it", async () => {
    const stash = makeStashFs([stashDirFor(STASH_ROOT, "frapp-web")]);
    const { runCommand, calls } = makeRunStub();
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_1", target: null, state: "READY", meta: { githubCommitSha: SHA } })]);

    const outcome = await deployVercel({
      apiKey: API_KEY,
      projects,
      sha: SHA,
      target: VERCEL_TARGET_PREVIEW,
      teamId: TEAM_ID,
      stashFs: stash.fs,
      clock: makeFakeClock(),
      runCommand,
      fetchImpl,
      logger: quiet,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.results.length, 2, "both projects must still be reported");
    assert.deepEqual(
      calls.map((c) => `${c.projectId}:${c.step}`),
      ["prj_web:deploy"],
    );
    const landing = outcome.results.find((r) => r.label === "frapp-landing");
    assert.equal(landing.status, "failure");
    assert.equal(landing.deploymentId, null);
    assert.match(landing.message, /No prebuilt output/);
  });
});

// ── The two phases every deploy runs ───────────────────────────────────────
//
// Both deploys build both bundles BEFORE the migration applies and upload them
// AFTER the API is healthy (production since 2026-09-06, staging since #2803,
// one `_deploy.yml` job since #2805), so a build failure can no longer leave a
// migrated database under half-updated frontends. These tests pin the contract between the two phases: what `build`
// leaves behind is exactly what `upload` consumes, per project, and nothing
// else is ever uploaded.
describe("parseDeployPhase", () => {
  // Unset used to mean a single phase that built and uploaded at once. Nothing
  // calls that since #2803, and defaulting to either half is a wrong guess.
  it("refuses an unset phase rather than guessing which half to run", () => {
    assert.throws(() => parseDeployPhase(undefined), /Refusing to guess/);
    assert.throws(() => parseDeployPhase(""), /Refusing to guess/);
  });

  it("accepts the two known phases", () => {
    assert.equal(parseDeployPhase("build"), DEPLOY_PHASE_BUILD);
    assert.equal(parseDeployPhase("upload"), DEPLOY_PHASE_UPLOAD);
  });

  it("throws on anything else rather than guessing which half to run", () => {
    // A typo defaulting to `upload` would skip the build and ship whatever
    // `.vercel` holds; defaulting to `build` would build twice and ship nothing.
    assert.throws(() => parseDeployPhase("deploy"), /Refusing to guess/);
    // The retired single-phase value is not quietly still accepted.
    assert.throws(() => parseDeployPhase("all"), /Refusing to guess/);
  });
});

describe("buildVercelProjects (the build phase)", () => {
  const projects = [
    { projectId: "prj_web", label: "frapp-web" },
    { projectId: "prj_landing", label: "frapp-landing" },
  ];

  it("pulls and builds each project in turn, stashing each output, and uploads nothing", async () => {
    const stash = makeStashFs();
    const order = [];
    const shas = [];
    const runCommand = async ({ args, env }) => {
      order.push(`${env.VERCEL_PROJECT_ID}:${args[0]}`);
      shas.push(env.VERCEL_GIT_COMMIT_SHA);
      if (args[0] === "build") stash.dirs.add(vercelDirFor(CWD));
      return { code: 0, stdout: "", stderr: "" };
    };

    const outcome = await buildVercelProjects({
      apiKey: API_KEY,
      projects,
      sha: SHA,
      target: VERCEL_TARGET_PRODUCTION,
      teamId: TEAM_ID,
      cwd: CWD,
      stashRoot: STASH_ROOT,
      runCommand,
      stashFs: stash.fs,
      logger: quiet,
    });

    assert.equal(outcome.ok, true);
    assert.deepEqual(order, ["prj_web:pull", "prj_web:build", "prj_landing:pull", "prj_landing:build"]);
    assert.ok(!order.some((step) => step.endsWith(":deploy")), "nothing was uploaded");
    assert.ok(
      shas.every((value) => value === SHA),
      "the named SHA must reach vercel pull/build as VERCEL_GIT_COMMIT_SHA",
    );
    // One stash per project, and the working tree's .vercel is empty afterwards —
    // the second build could not have overwritten the first.
    assert.ok(stash.dirs.has(stashDirFor(STASH_ROOT, "frapp-web")));
    assert.ok(stash.dirs.has(stashDirFor(STASH_ROOT, "frapp-landing")));
    assert.ok(!stash.dirs.has(vercelDirFor(CWD)));
    assert.deepEqual(
      outcome.results.map((r) => [r.label, r.status]),
      [
        ["frapp-web", "success"],
        ["frapp-landing", "success"],
      ],
    );
  });

  it("stops at the first failed build and reports the rest as not attempted", async () => {
    const stash = makeStashFs();
    const runCommand = async ({ args, env }) => {
      if (env.VERCEL_PROJECT_ID === "prj_web" && args[0] === "build") {
        return { code: null, signal: "SIGKILL", stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    const outcome = await buildVercelProjects({
      apiKey: API_KEY,
      projects,
      target: VERCEL_TARGET_PRODUCTION,
      teamId: TEAM_ID,
      cwd: CWD,
      stashRoot: STASH_ROOT,
      runCommand,
      stashFs: stash.fs,
      logger: quiet,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.failures.length, 2);
    assert.match(outcome.results[0].message, /killed by SIGKILL/);
    assert.match(outcome.results[1].message, /Not attempted/);
    assert.equal(stash.dirs.size, 0, "no stash was written for either project");
  });

  it("refuses to run without a stash root", async () => {
    await assert.rejects(
      buildVercelProjects({
        apiKey: API_KEY,
        projects,
        target: VERCEL_TARGET_PRODUCTION,
        teamId: TEAM_ID,
        cwd: CWD,
        runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
        logger: quiet,
      }),
      /VERCEL_BUILD_STASH_DIR/,
    );
  });

  // Without --prod the build compiles against preview settings and is then
  // shipped to the production hostname: the "promoted preview" failure. This
  // pins that the target reaches the build through this phase, both ways.
  it("builds production with --prod and staging without", async () => {
    for (const [target, expected] of [
      [VERCEL_TARGET_PRODUCTION, ["build", "--prod"]],
      [VERCEL_TARGET_PREVIEW, ["build"]],
    ]) {
      const stash = makeStashFs();
      const builds = [];
      const runCommand = async ({ args }) => {
        if (args[0] === "build") {
          builds.push(args);
          stash.dirs.add(vercelDirFor(CWD));
        }
        return { code: 0, stdout: "", stderr: "" };
      };
      const outcome = await buildVercelProjects({
        apiKey: API_KEY,
        projects,
        sha: SHA,
        target,
        teamId: TEAM_ID,
        cwd: CWD,
        stashRoot: STASH_ROOT,
        runCommand,
        stashFs: stash.fs,
        logger: quiet,
      });
      assert.equal(outcome.ok, true, target);
      assert.deepEqual(builds, [expected, expected], target);
    }
  });

  // A project whose build never ran must not vanish from the report — a
  // deploy that silently ships one of two apps is the worst outcome here.
  it("reports a failed build as a failure rather than skipping the project", async () => {
    const stash = makeStashFs();
    const runCommand = async ({ args, env }) => {
      if (env.VERCEL_PROJECT_ID === "prj_landing" && args[0] === "build") {
        return { code: 1, stdout: "", stderr: "build failed" };
      }
      if (args[0] === "build") stash.dirs.add(vercelDirFor(CWD));
      return { code: 0, stdout: "", stderr: "" };
    };

    const outcome = await buildVercelProjects({
      apiKey: API_KEY,
      projects,
      sha: SHA,
      target: VERCEL_TARGET_PREVIEW,
      teamId: TEAM_ID,
      cwd: CWD,
      stashRoot: STASH_ROOT,
      runCommand,
      stashFs: stash.fs,
      logger: quiet,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.results.length, 2, "both projects must still be reported");
    const landing = outcome.results.find((r) => r.label === "frapp-landing");
    assert.equal(landing.status, "failure");
    assert.match(landing.message, /build failed/);
    assert.ok(!stash.dirs.has(stashDirFor(STASH_ROOT, "frapp-landing")), "no stash for the upload to ship");
  });
});

describe("deployVercel (the upload phase)", () => {
  const projects = [
    { projectId: "prj_web", label: "frapp-web" },
    { projectId: "prj_landing", label: "frapp-landing" },
  ];

  it("restores each project's own stash before its upload, and never builds", async () => {
    const webStash = stashDirFor(STASH_ROOT, "frapp-web");
    const landingStash = stashDirFor(STASH_ROOT, "frapp-landing");
    const stash = makeStashFs([webStash, landingStash]);
    const order = [];
    const runCommand = async ({ args, env }) => {
      order.push(`${env.VERCEL_PROJECT_ID}:${args[0]}`);
      return { code: 0, stdout: `https://${HOST}\n`, stderr: "" };
    };
    const { fetchImpl } = makeFetchStub([
      okJson({ id: "dpl_x", target: "production", state: "READY", meta: { githubCommitSha: SHA } }),
    ]);

    const outcome = await deployVercel({
      apiKey: API_KEY,
      projects,
      sha: SHA,
      target: VERCEL_TARGET_PRODUCTION,
      teamId: TEAM_ID,
      cwd: CWD,
      stashRoot: STASH_ROOT,
      clock: makeFakeClock(),
      runCommand,
      stashFs: stash.fs,
      fetchImpl,
      logger: quiet,
    });

    assert.equal(outcome.ok, true);
    assert.deepEqual(order, ["prj_web:deploy", "prj_landing:deploy"]);
    // web's stash was restored for web's upload, then landing's for landing's —
    // the interleaving is what guarantees each project ships its own bundle.
    assert.deepEqual(stash.ops, [
      ["remove", vercelDirFor(CWD)],
      ["move", webStash, vercelDirFor(CWD)],
      ["remove", vercelDirFor(CWD)],
      ["move", landingStash, vercelDirFor(CWD)],
    ]);
  });

  it("fails a project whose stash is missing without uploading anything for it, and does not skip the other", async () => {
    // web's build phase output is gone (or never ran); landing's is present.
    // web is a failure that shipped nothing — and because a stash restore
    // failure happens BEFORE any upload, the fail-fast stops landing too: a
    // half-updated environment is exactly what this phase exists to prevent.
    const landingStash = stashDirFor(STASH_ROOT, "frapp-landing");
    const stash = makeStashFs([landingStash]);
    const { runCommand, calls } = makeRunStub();
    const { fetchImpl } = makeFetchStub([
      okJson({ id: "dpl_x", target: "production", state: "READY", meta: { githubCommitSha: SHA } }),
    ]);

    const outcome = await deployVercel({
      apiKey: API_KEY,
      projects,
      sha: SHA,
      target: VERCEL_TARGET_PRODUCTION,
      teamId: TEAM_ID,
      cwd: CWD,
      stashRoot: STASH_ROOT,
      clock: makeFakeClock(),
      runCommand,
      stashFs: stash.fs,
      fetchImpl,
      logger: quiet,
    });

    assert.equal(outcome.ok, false);
    assert.equal(calls.length, 0, "no upload ran at all");
    const web = outcome.results.find((r) => r.label === "frapp-web");
    const landing = outcome.results.find((r) => r.label === "frapp-landing");
    assert.match(web.message, /No prebuilt output/);
    assert.match(landing.message, /Not attempted: frapp-web failed earlier/);
    assert.ok(stash.dirs.has(landingStash), "landing's stash is left intact for a retry");
  });

  // There is no single-phase path to fall back to (#2803): without a stash
  // root the only thing left to upload is whatever `.vercel` holds.
  it("refuses to run without a stash root, before any CLI step", async () => {
    const stash = makeStashFs([vercelDirFor(CWD)]);
    const { runCommand, calls } = makeRunStub();
    const { fetchImpl, calls: fetches } = makeFetchStub([
      okJson({ id: "dpl_x", target: "production", state: "READY", meta: { githubCommitSha: SHA } }),
    ]);

    await assert.rejects(
      deployVercel({
        apiKey: API_KEY,
        projects,
        sha: SHA,
        target: VERCEL_TARGET_PRODUCTION,
        teamId: TEAM_ID,
        cwd: CWD,
        stashRoot: undefined,
        clock: makeFakeClock(),
        runCommand,
        stashFs: stash.fs,
        fetchImpl,
        logger: quiet,
      }),
      /VERCEL_BUILD_STASH_DIR/,
    );
    assert.equal(calls.length, 0, "nothing was uploaded");
    assert.equal(fetches.length, 0);
    assert.deepEqual(stash.ops, []);
  });
});

describe("the commit-metadata assertion", () => {
  // The id comes from a hostname the CLI printed, and GET /v13/deployments/
  // {idOrUrl} resolves an ALIAS to whatever deployment currently serves it. On
  // the production path a stale alias resolves to the previous release, which is
  // `production` and `READY` — so the target guard and the poll both pass and
  // the run reports success having verified a deployment it did not create.
  it("rejects a deployment whose githubCommitSha is a different commit", async () => {
    const { runCommand } = makeRunStub();
    const { fetchImpl } = makeFetchStub([
      okJson({ id: "dpl_previous", target: "production", meta: { githubCommitSha: "f".repeat(40) } }),
    ]);

    await assert.rejects(
      createVercelDeployment({
        apiKey: API_KEY,
        projectId: "prj_web",
        label: "frapp-web",
        sha: SHA,
        target: VERCEL_TARGET_PRODUCTION,
        teamId: TEAM_ID,
        runCommand,
        fetchImpl,
        logger: quiet,
      }),
      /not the commit just built/,
    );
  });

  // If `--meta` is dropped by a CLI upgrade the deploy still succeeds, and
  // everything downstream that reads githubCommitSha degrades silently —
  // ADR-19's named-commit guarantee first among them.
  it("rejects a deployment carrying no commit metadata at all", async () => {
    const { runCommand } = makeRunStub();
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_1", target: "production" })]);

    await assert.rejects(
      createVercelDeployment({
        apiKey: API_KEY,
        projectId: "prj_web",
        label: "frapp-web",
        sha: SHA,
        target: VERCEL_TARGET_PRODUCTION,
        teamId: TEAM_ID,
        runCommand,
        fetchImpl,
        logger: quiet,
      }),
      /githubCommitSha 'null'/,
    );
  });

  // End-to-end wiring: the old file pinned `gitSource.sha` at this same seam.
  // Without this, a refactor that drops `sha` on the way into
  // deployPrebuiltVercelProject passes every other test in this file.
  it("forwards the sha and the branch into the deploy args", async () => {
    const { runCommand, calls } = makeRunStub();
    const { fetchImpl } = makeFetchStub([
      okJson({ id: "dpl_1", target: "production", meta: { githubCommitSha: SHA } }),
    ]);

    await createVercelDeployment({
      apiKey: API_KEY,
      projectId: "prj_web",
      label: "frapp-web",
      sha: SHA,
      target: VERCEL_TARGET_PRODUCTION,
      teamId: TEAM_ID,
      runCommand,
      fetchImpl,
      logger: quiet,
    });

    const deployArgs = calls.find((c) => c.step === "deploy").args;
    assert.ok(deployArgs.includes(`githubCommitSha=${SHA}`));
    assert.ok(deployArgs.includes("githubCommitRef=main"));
  });
});

describe("a throwing poll does not collapse the run", () => {
  // `pollUntilTerminal` does not catch, so before the fetchOne try/catch a
  // rejection escaped Promise.all and rejected deployVercel itself — the
  // reporting loop never ran, both deployment ids went unprinted, and an
  // operator would re-dispatch a deploy that had already shipped.
  it("reports a network error as a per-project failure, not an unhandled rejection", async () => {
    const { runCommand } = makeRunStub();
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      if (call <= 2) return okJson({ id: `dpl_${call}`, target: null, meta: { githubCommitSha: SHA } });
      throw new Error("ECONNRESET");
    };

    const outcome = await deployVercel({
      apiKey: API_KEY,
      projects: [
        { projectId: "prj_web", label: "frapp-web" },
        { projectId: "prj_landing", label: "frapp-landing" },
      ],
      sha: SHA,
      target: VERCEL_TARGET_PREVIEW,
      teamId: TEAM_ID,
      clock: makeFakeClock(),
      runCommand,
      fetchImpl,
      logger: quiet,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.results.length, 2, "both projects must still be reported");
    for (const result of outcome.results) {
      assert.equal(result.status, "failure");
      assert.match(result.message, /ECONNRESET/);
      assert.ok(result.deploymentId, "the id it created must still be reported");
    }
  });

  it("reports a non-JSON body as a failure rather than throwing", async () => {
    const { runCommand } = makeRunStub();
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      if (call <= 2) return okJson({ id: `dpl_${call}`, target: null, meta: { githubCommitSha: SHA } });
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
        text: async () => "<!DOCTYPE html>",
      };
    };

    const outcome = await deployVercel({
      apiKey: API_KEY,
      projects: [{ projectId: "prj_web", label: "frapp-web" }],
      sha: SHA,
      target: VERCEL_TARGET_PREVIEW,
      teamId: TEAM_ID,
      clock: makeFakeClock(),
      runCommand,
      fetchImpl,
      logger: quiet,
    });

    assert.equal(outcome.ok, false);
    assert.match(outcome.results[0].message, /Unexpected token/);
  });
});

describe("fail-fast across projects", () => {
  const projects = [
    { projectId: "prj_web", label: "frapp-web" },
    { projectId: "prj_landing", label: "frapp-landing" },
  ];

  // Builds are sequential, so when web's build fails landing has not been
  // built yet. Building it anyway spends a whole build on a run that is going
  // to fail, and a green landing stash invites an upload of half a release.
  it("does not build landing after web's build fails", async () => {
    const stash = makeStashFs();
    const attempted = [];
    const runCommand = async ({ args, env }) => {
      attempted.push(`${env.VERCEL_PROJECT_ID}:${args[0]}`);
      if (env.VERCEL_PROJECT_ID === "prj_web" && args[0] === "build") {
        return { code: 1, stdout: "", stderr: "type error" };
      }
      if (args[0] === "build") stash.dirs.add(vercelDirFor(CWD));
      return { code: 0, stdout: "", stderr: "" };
    };

    const outcome = await buildVercelProjects({
      apiKey: API_KEY,
      projects,
      sha: SHA,
      target: VERCEL_TARGET_PRODUCTION,
      teamId: TEAM_ID,
      cwd: CWD,
      stashRoot: STASH_ROOT,
      runCommand,
      stashFs: stash.fs,
      logger: quiet,
    });

    assert.ok(
      !attempted.some((step) => step.startsWith("prj_landing")),
      `landing must not be touched after web failed, got ${attempted.join(", ")}`,
    );
    assert.equal(outcome.ok, false);

    // Skipped, but still REPORTED. A project that silently vanishes from the
    // results is how "we deployed" and "we deployed everything" come apart.
    const landing = outcome.results.find((r) => r.label === "frapp-landing");
    assert.equal(landing.status, "failure");
    assert.match(landing.message, /Not attempted.*frapp-web failed/s);
  });

  // Uploads are sequential too, so when web's upload fails landing has not
  // been uploaded yet. Uploading it anyway would put new landing live on
  // frapp.live while app.frapp.live stays on the previous release — a
  // half-shipped production release behind an already-applied migration.
  it("does not upload landing after web's upload fails", async () => {
    const attempted = [];
    const runCommand = async ({ args, env }) => {
      attempted.push(`${env.VERCEL_PROJECT_ID}:${args[0]}`);
      if (env.VERCEL_PROJECT_ID === "prj_web" && args[0] === "deploy") {
        return { code: 1, stdout: "", stderr: "upload refused" };
      }
      return { code: 0, stdout: args[0] === "deploy" ? `https://${HOST}\n` : "", stderr: "" };
    };
    const { fetchImpl } = makeFetchStub([
      okJson({ id: "dpl_1", target: "production", state: "READY", meta: { githubCommitSha: SHA } }),
    ]);

    const outcome = await deployVercel({
      apiKey: API_KEY,
      projects,
      sha: SHA,
      target: VERCEL_TARGET_PRODUCTION,
      teamId: TEAM_ID,
      clock: makeFakeClock(),
      runCommand,
      fetchImpl,
      logger: quiet,
    });

    assert.deepEqual(attempted, ["prj_web:deploy"], "landing must not be touched after web failed");
    assert.equal(outcome.ok, false);
    const web = outcome.results.find((r) => r.label === "frapp-web");
    assert.match(web.message, /upload refused/);
    const landing = outcome.results.find((r) => r.label === "frapp-landing");
    assert.equal(landing.status, "failure");
    assert.match(landing.message, /Not attempted.*frapp-web failed/s);
  });
});

describe("fail-fast distinguishes shipped from not-shipped", () => {
  // The mirror-image hazard of the fail-fast itself. createVercelDeployment
  // throws in three places AFTER the upload — the host lookup, the target
  // assertion and the sha assertion — by which point the deployment exists and,
  // on the production path, is already taking traffic. Aborting the remaining
  // projects there would CREATE the split the flag exists to prevent.
  it("continues to the next project when the failure came after the upload", async () => {
    const attempted = [];
    const runCommand = async ({ args, env }) => {
      attempted.push(`${env.VERCEL_PROJECT_ID}:${args[0]}`);
      return { code: 0, stdout: args[0] === "deploy" ? `https://${HOST}\n` : "", stderr: "" };
    };
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      // web resolves to a DIFFERENT commit — a post-upload failure.
      if (call === 1) {
        return okJson({ id: "dpl_web", target: "production", meta: { githubCommitSha: "f".repeat(40) } });
      }
      if (call === 2) {
        return okJson({ id: "dpl_landing", target: "production", meta: { githubCommitSha: SHA } });
      }
      return okJson({ id: "dpl_landing", state: "READY" });
    };

    const outcome = await deployVercel({
      apiKey: API_KEY,
      projects: [
        { projectId: "prj_web", label: "frapp-web" },
        { projectId: "prj_landing", label: "frapp-landing" },
      ],
      sha: SHA,
      target: VERCEL_TARGET_PRODUCTION,
      teamId: TEAM_ID,
      clock: makeFakeClock(),
      runCommand,
      fetchImpl,
      logger: quiet,
    });

    assert.ok(
      attempted.some((step) => step === "prj_landing:deploy"),
      `landing must still deploy — web already shipped. Got: ${attempted.join(", ")}`,
    );
    // The run still FAILS overall; it just does not make the split worse.
    assert.equal(outcome.ok, false);
    const landing = outcome.results.find((r) => r.label === "frapp-landing");
    assert.equal(landing.status, "success");
    assert.doesNotMatch(
      outcome.results.find((r) => r.label === "frapp-web").message,
      /Not attempted/,
    );
  });
});

// ── App config from Infisical, staging (#2672) and production (#2673) ─────

describe("buildEnvsFor", () => {
  const projects = [
    { projectId: "prj_web", label: "frapp-web" },
    { projectId: "prj_landing", label: "frapp-landing" },
  ];
  const env = {
    PATH: "/usr/bin",
    HOME: "/home/runner",
    NEXT_PUBLIC_API_URL: "https://api-staging.example",
    NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_APP_URL: "https://app.staging.example",
    STRIPE_SECRET_KEY: "sk_test_backend",
  };
  const baseline = () => JSON.stringify(["HOME", "PATH"]);

  it("gives production a build env from the injection too, never the ambient env", () => {
    // Before #2673 production returned no build env, so every CLI process ran
    // on the whole injected `prod` store.
    const [web] = buildEnvsFor({ target: VERCEL_TARGET_PRODUCTION, projects, env, readBaseline: baseline });
    assert.deepEqual(web.buildEnv.baseEnv, { HOME: "/home/runner", PATH: "/usr/bin" });
    assert.equal(web.buildEnv.appEnv.STRIPE_SECRET_KEY, undefined);
    assert.equal(web.buildEnv.baseEnv.STRIPE_SECRET_KEY, undefined);
  });

  // #2275: a dry run must mint no Sentry release. The token is withheld from
  // the build's app config; the pulled file never carries it either, since it
  // keeps only Vercel's system variables (#2810; `vercel-build-env.test.mjs`
  // pins that no app key is one). It stays an app key, so it is still named,
  // and `withheld` is what keeps the lost-key warning from calling it lost.
  it("withholds the Sentry token from a dry run's build, and marks it withheld rather than lost", () => {
    const withToken = { ...env, SENTRY_AUTH_TOKEN: "sntrys_realtoken" };
    assert.deepEqual(DRY_RUN_WITHHELD_KEYS, ["SENTRY_AUTH_TOKEN"]);
    for (const project of buildEnvsFor({ projects, env: withToken, readBaseline: baseline, dryRun: true })) {
      assert.equal(project.buildEnv.appEnv.SENTRY_AUTH_TOKEN, undefined, project.label);
      assert.ok(project.buildEnv.appKeys.includes("SENTRY_AUTH_TOKEN"), `${project.label} still names it as an app key`);
      assert.deepEqual(project.buildEnv.withheld, ["SENTRY_AUTH_TOKEN"], "so the lost-key warning skips it");
    }
  });

  // The workflow's shell `unset` usually removes the token before this script
  // runs. It must still count as withheld, or the lost-key warning would tell
  // the owner to add a key Infisical holds.
  it("marks the Sentry token withheld on a dry run even when the shell already removed it", () => {
    for (const project of buildEnvsFor({ projects, env, readBaseline: baseline, dryRun: true })) {
      assert.deepEqual(project.buildEnv.withheld, ["SENTRY_AUTH_TOKEN"], project.label);
    }
  });

  // The other half: a guard that withheld it unconditionally would stop every
  // real production release from reaching Sentry.
  it("keeps the Sentry token on a real ship", () => {
    const withToken = { ...env, SENTRY_AUTH_TOKEN: "sntrys_realtoken" };
    for (const project of buildEnvsFor({ projects, env: withToken, readBaseline: baseline })) {
      assert.equal(project.buildEnv.appEnv.SENTRY_AUTH_TOKEN, "sntrys_realtoken", project.label);
      assert.deepEqual(project.buildEnv.withheld, []);
    }
  });

  it("reads DRY_RUN from the job the way the workflow sets it", () => {
    // The workflow passes `${{ inputs.dry_run_only }}`, which renders `true` or
    // `false`. Nothing else wires the flag through, so pin the read.
    const source = readFileSync(new URL("../deploy-vercel.mjs", import.meta.url), "utf8");
    assert.match(source, /const dryRun = process\.env\.DRY_RUN === "true";/);
    assert.match(source, /buildEnvsFor\(\{\s*dryRun,/);
  });

  it("gives each staging project its own app keys", () => {
    const [web, landing] = buildEnvsFor({ target: VERCEL_TARGET_PREVIEW, projects, env, readBaseline: baseline });
    assert.deepEqual(Object.keys(web.buildEnv.appEnv).sort(), [
      "NEXT_PUBLIC_API_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
    assert.deepEqual(Object.keys(landing.buildEnv.appEnv), ["NEXT_PUBLIC_APP_URL"]);
    assert.deepEqual(web.buildEnv.baseEnv, { HOME: "/home/runner", PATH: "/usr/bin" });
  });

  it("reports every project's missing keys at once, before anything is built", () => {
    // Checking landing only after web had built would spend a whole build to
    // learn what one read of the environment already knew.
    assert.throws(
      () =>
        buildEnvsFor({
          target: VERCEL_TARGET_PREVIEW,
          projects,
          env: { PATH: "/usr/bin", HOME: "/home/runner" },
          readBaseline: baseline,
        }),
      /\[frapp-web\].*NEXT_PUBLIC_API_URL[\s\S]*\[frapp-landing\].*NEXT_PUBLIC_APP_URL/,
    );
  });

  it("refuses a baseline that is not a job environment", () => {
    assert.throws(
      () => buildEnvsFor({ target: VERCEL_TARGET_PREVIEW, projects, env, readBaseline: () => "[]" }),
      /no PATH/,
    );
  });
});

// The staging job end to end since #2803: the build phase, then the upload
// phase, on one stash root, the way `deploy-staging.yml` runs them.
describe("deployVercel on the staging path", () => {
  it("builds each project on its own app keys, with the rest of the store out of every step", async () => {
    const env = {
      PATH: "/usr/bin",
      HOME: "/home/runner",
      NEXT_PUBLIC_API_URL: "https://api-staging.example",
      NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      NEXT_PUBLIC_APP_URL: "https://app.staging.example",
      STRIPE_SECRET_KEY: "sk_test_backend",
    };
    const projects = buildEnvsFor({
      target: VERCEL_TARGET_PREVIEW,
      projects: [
        { projectId: "prj_web", label: "frapp-web" },
        { projectId: "prj_landing", label: "frapp-landing" },
      ],
      env,
      readBaseline: () => JSON.stringify(["HOME", "PATH"]),
    });

    // `.vercel` starts out holding leftovers; the log interleaves every stash
    // operation with every CLI step, across both phases.
    const log = [];
    const stash = makeStashFs([vercelDirFor(CWD)], log);
    // Every project's pull writes the same stale row for both apps' keys. Each
    // build keeps neither: not its own app's, and not the other app's either,
    // which before #2810 reached the build as an ordinary project row.
    const envFile = `${vercelDirFor(CWD)}/.env.preview.local`;
    const files = new Map();
    const filtered = [];
    const envFileFs = {
      read: async (p) => files.get(p) ?? null,
      write: async (p, text) => {
        filtered.push(text);
        files.set(p, text);
      },
    };
    const steps = [];
    const runCommand = async ({ args, env: stepEnv }) => {
      steps.push({ project: stepEnv.VERCEL_PROJECT_ID, step: args[0], env: stepEnv });
      log.push([args[0], stepEnv.VERCEL_PROJECT_ID]);
      if (args[0] === "pull") {
        files.set(envFile, 'NEXT_PUBLIC_API_URL="stale"\nNEXT_PUBLIC_APP_URL="stale"\nVERCEL_ENV="preview"\n');
      }
      if (args[0] === "build") stash.dirs.add(vercelDirFor(CWD));
      return { code: 0, stdout: args[0] === "deploy" ? `https://${HOST}\n` : "", stderr: "" };
    };
    const { fetchImpl } = makeFetchStub([
      okJson({ id: "dpl_x", target: null, state: "READY", meta: { githubCommitSha: SHA } }),
    ]);
    const phase = {
      apiKey: API_KEY,
      projects,
      sha: SHA,
      target: VERCEL_TARGET_PREVIEW,
      teamId: TEAM_ID,
      cwd: CWD,
      stashRoot: STASH_ROOT,
      runCommand,
      stashFs: stash.fs,
      envFileFs,
      logger: quiet,
    };

    const built = await buildVercelProjects(phase);
    assert.equal(built.ok, true, JSON.stringify(built.failures));
    const outcome = await deployVercel({ ...phase, clock: makeFakeClock(), fetchImpl });

    assert.equal(outcome.ok, true, JSON.stringify(outcome.failures));
    assert.deepEqual(
      steps.map(({ project, step }) => `${project}:${step}`),
      ["prj_web:pull", "prj_web:build", "prj_landing:pull", "prj_landing:build", "prj_web:deploy", "prj_landing:deploy"],
    );
    // Each project's pulled file keeps only Vercel's system variables.
    assert.deepEqual(filtered, ['VERCEL_ENV="preview"\n', 'VERCEL_ENV="preview"\n']);
    const build = (project) => steps.find((s) => s.project === project && s.step === "build").env;
    assert.equal(build("prj_web").NEXT_PUBLIC_API_URL, "https://api-staging.example");
    assert.equal(build("prj_landing").NEXT_PUBLIC_APP_URL, "https://app.staging.example");
    assert.equal(build("prj_landing").NEXT_PUBLIC_API_URL, undefined, "landing got web's config");
    for (const { project, step, env: stepEnv } of steps) {
      assert.equal(stepEnv.STRIPE_SECRET_KEY, undefined, `${project} ${step} saw a backend secret`);
    }
    // Each project's pull started from an empty `.vercel`: the step right
    // before every pull is the removal of `.vercel`.
    const pulls = log.flatMap((entry, i) => (entry[0] === "pull" ? [[entry[1], log[i - 1]]] : []));
    assert.deepEqual(pulls, [
      ["prj_web", ["remove", vercelDirFor(CWD)]],
      ["prj_landing", ["remove", vercelDirFor(CWD)]],
    ]);
  });
});
