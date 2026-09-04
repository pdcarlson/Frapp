import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyVercelState,
  createVercelDeployment,
  deployVercel,
  expectedDeploymentTarget,
  parseDeployTarget,
  pollVercelDeployment,
  resolveDeploymentByHost,
} from "../deploy-vercel.mjs";
import { verifyVercelDeploy } from "../verify-vercel-deploy.mjs";
import { VERCEL_TARGET_PREVIEW, VERCEL_TARGET_PRODUCTION } from "../lib/vercel-cli.mjs";

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
// is the ONLY reason `verify-vercel-deploy.mjs` could safely call a CANCELED
// deployment neutral.
//
// Deploying from `main` inverts the precondition. And since #1578 there is a
// second, stronger reason: a deployment CI created from prebuilt output cannot
// be superseded at all — there is no push behind it for a newer push to cancel.
// So on this path a cancel is never neutral, in either channel.
describe("CANCELED: the CI-created path is stricter than the observer", () => {
  const cancelledOnMain = {
    uid: "dpl_cancelled",
    state: "CANCELED",
    target: null,
    created: 2000,
    meta: { githubCommitSha: SHA, githubCommitRef: "main" },
  };
  const laterOnMain = {
    uid: "dpl_later",
    state: "BUILDING",
    target: null,
    created: 3000,
    meta: { githubCommitSha: "f".repeat(40), githubCommitRef: "main" },
  };

  it("the observer reports NEUTRAL for a superseded cancel", async () => {
    const { fetchImpl } = makeFetchStub([
      okJson({ deployments: [cancelledOnMain, laterOnMain] }),
    ]);
    const result = await verifyVercelDeploy({
      apiKey: API_KEY,
      projectId: "prj_web",
      sha: SHA,
      clock: makeFakeClock(),
      fetchImpl,
      logger: quiet,
    });
    assert.equal(result.status, "neutral");
  });

  it("the CI-created path reports FAILURE for the same deployment", async () => {
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

describe("createVercelDeployment", () => {
  it("builds, uploads and identifies a production deployment", async () => {
    const { runCommand, calls } = makeRunStub();
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_1", target: "production", meta: { githubCommitSha: SHA } })]);

    const result = await createVercelDeployment({
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

    assert.equal(result.deploymentId, "dpl_1");
    assert.deepEqual(
      calls.map((c) => c.step),
      ["pull", "build", "deploy"],
    );
    assert.ok(calls.find((c) => c.step === "build").args.includes("--prod"));
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
    assert.ok(!calls.find((c) => c.step === "build").args.includes("--prod"));
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
  // other's bundle. This is the constraint that forces sequential builds.
  it("finishes one project's build+upload before starting the next", async () => {
    const order = [];
    const runCommand = async ({ args, env }) => {
      order.push(`${env.VERCEL_PROJECT_ID}:${args[0]}`);
      return { code: 0, stdout: args[0] === "deploy" ? `https://${HOST}\n` : "", stderr: "" };
    };
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_x", target: null, state: "READY", meta: { githubCommitSha: SHA } })]);

    await deployVercel({
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

    assert.deepEqual(order, [
      "prj_web:pull",
      "prj_web:build",
      "prj_web:deploy",
      "prj_landing:pull",
      "prj_landing:build",
      "prj_landing:deploy",
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

  it("reports a failed build as a failure rather than skipping the project", async () => {
    // A project whose build never ran must not vanish from the report — a
    // deploy that silently ships one of two apps is the worst outcome here.
    const runCommand = async ({ args, env }) => {
      if (env.VERCEL_PROJECT_ID === "prj_landing" && args[0] === "build") {
        return { code: 1, stdout: "", stderr: "build failed" };
      }
      return { code: 0, stdout: args[0] === "deploy" ? `https://${HOST}\n` : "", stderr: "" };
    };
    const { fetchImpl } = makeFetchStub([okJson({ id: "dpl_1", target: null, state: "READY", meta: { githubCommitSha: SHA } })]);

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
    const landing = outcome.results.find((r) => r.label === "frapp-landing");
    assert.equal(landing.status, "failure");
    assert.equal(landing.deploymentId, null);
    assert.match(landing.message, /build failed/);
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
  // buildAndDeployVercelProject passes every other test in this file.
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
  // Builds are sequential, so when web's build fails landing has not been
  // uploaded yet. Uploading it anyway would put new landing live on frapp.live
  // while app.frapp.live stays on the previous release — a half-shipped
  // production release behind an already-applied migration.
  it("does not deploy landing after web's build fails", async () => {
    const attempted = [];
    const runCommand = async ({ args, env }) => {
      attempted.push(`${env.VERCEL_PROJECT_ID}:${args[0]}`);
      if (env.VERCEL_PROJECT_ID === "prj_web" && args[0] === "build") {
        return { code: 1, stdout: "", stderr: "type error" };
      }
      return { code: 0, stdout: args[0] === "deploy" ? `https://${HOST}\n` : "", stderr: "" };
    };
    const { fetchImpl } = makeFetchStub([
      okJson({ id: "dpl_1", target: "production", state: "READY", meta: { githubCommitSha: SHA } }),
    ]);

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
});
