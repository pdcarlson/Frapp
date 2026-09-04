import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  VERCEL_TARGET_PREVIEW,
  VERCEL_TARGET_PRODUCTION,
  buildAndDeployVercelProject,
  parseDeploymentHost,
  vercelBuildArgs,
  vercelCliEnv,
  vercelDeployArgs,
  vercelEnvironmentFor,
  vercelPullArgs,
} from "../lib/vercel-cli.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const TOKEN = "test-token";
const TEAM_ID = "team_test";
const PROJECT_ID = "prj_test";

const quiet = { log: () => {} };

/**
 * A fake `runCommand` that records each invocation and replies from a table
 * keyed on the CLI subcommand (`pull` / `build` / `deploy`).
 */
function makeRunStub(byStep = {}) {
  const calls = [];
  const runCommand = async ({ command, args, env, cwd }) => {
    calls.push({ command, args, env, cwd });
    const step = args[0];
    const reply = byStep[step] ?? { code: 0, stdout: "", stderr: "" };
    return typeof reply === "function" ? reply() : reply;
  };
  return { runCommand, calls };
}

const READY_DEPLOY = {
  code: 0,
  stdout: "https://frapp-web-abc123.vercel.app\n",
  stderr: "Inspect: https://vercel.com/paul/frapp-web/xyz\n",
};

describe("vercelEnvironmentFor", () => {
  // The load-bearing line: pulling the wrong environment produces a bundle
  // with the wrong API URL and Supabase keys inlined, which every status page
  // then reports as a success.
  it("production pulls the production environment", () =>
    assert.equal(vercelEnvironmentFor(VERCEL_TARGET_PRODUCTION), "production"));
  it("preview pulls the preview environment", () =>
    assert.equal(vercelEnvironmentFor(VERCEL_TARGET_PREVIEW), "preview"));
  it("an unknown target does NOT fall through to production", () =>
    assert.equal(vercelEnvironmentFor("nonsense"), "preview"));
});

describe("vercelPullArgs", () => {
  it("pulls production env vars for a production deploy", () => {
    assert.deepEqual(vercelPullArgs({ target: VERCEL_TARGET_PRODUCTION }), [
      "pull",
      "--yes",
      "--environment=production",
    ]);
  });

  it("pulls preview env vars for a staging deploy", () => {
    assert.deepEqual(vercelPullArgs({ target: VERCEL_TARGET_PREVIEW }), [
      "pull",
      "--yes",
      "--environment=preview",
    ]);
  });
});

describe("vercelBuildArgs", () => {
  // Without --prod the build compiles against preview env vars and is then
  // shipped to the production hostname — the "promoted preview" failure the
  // production path exists to prevent, arriving by a different door.
  it("production builds with --prod", () =>
    assert.deepEqual(vercelBuildArgs({ target: VERCEL_TARGET_PRODUCTION }), ["build", "--prod"]));

  it("staging builds without --prod", () =>
    assert.deepEqual(vercelBuildArgs({ target: VERCEL_TARGET_PREVIEW }), ["build"]));
});

describe("vercelDeployArgs", () => {
  it("uploads prebuilt output and never prompts", () => {
    const args = vercelDeployArgs({ target: VERCEL_TARGET_PREVIEW, sha: SHA });
    assert.ok(args.includes("--prebuilt"), "must upload the output already built on the runner");
    assert.ok(args.includes("--yes"), "a CI runner cannot answer an interactive confirmation");
    assert.ok(!args.includes("--prod"), "a staging deploy must not take production traffic");
  });

  it("production adds --prod", () => {
    assert.ok(vercelDeployArgs({ target: VERCEL_TARGET_PRODUCTION, sha: SHA }).includes("--prod"));
  });

  // A --prebuilt upload carries NO git metadata of its own. Three consumers
  // read it back: ADR-19's named-commit guarantee, ensure-vercel-staging-alias
  // (which finds the deployment by githubCommitSha), and the observer's
  // per-branch supersession test (githubCommitRef).
  it("stamps the commit sha as deployment metadata", () => {
    const args = vercelDeployArgs({ target: VERCEL_TARGET_PRODUCTION, sha: SHA });
    const metaIndex = args.indexOf(`githubCommitSha=${SHA}`);
    assert.ok(metaIndex > 0, "githubCommitSha must be present");
    assert.equal(args[metaIndex - 1], "--meta");
  });

  it("stamps the branch, not the sha, as githubCommitRef", () => {
    // Every branch-scoped lookup downstream matches on this field. A commit id
    // here matches nothing — the bug the old gitSource.ref comment warned about.
    const args = vercelDeployArgs({ target: VERCEL_TARGET_PRODUCTION, sha: SHA });
    assert.ok(args.includes("githubCommitRef=main"));
    assert.ok(!args.includes(`githubCommitRef=${SHA}`));
  });

  it("honours an explicit ref", () => {
    const args = vercelDeployArgs({ target: VERCEL_TARGET_PREVIEW, sha: SHA, ref: "release" });
    assert.ok(args.includes("githubCommitRef=release"));
  });
});

describe("parseDeploymentHost", () => {
  it("strips the protocol", () => {
    assert.equal(
      parseDeploymentHost("https://frapp-web-abc123.vercel.app\n"),
      "frapp-web-abc123.vercel.app",
    );
  });

  it("takes the LAST url when the CLI printed more than one", () => {
    // Not an assumption worth betting a release on: take the last rather than
    // requiring there be exactly one.
    assert.equal(
      parseDeploymentHost("https://old.vercel.app\nhttps://new.vercel.app\n"),
      "new.vercel.app",
    );
  });

  it("strips a trailing slash", () => {
    assert.equal(parseDeploymentHost("https://frapp.vercel.app/\n"), "frapp.vercel.app");
  });

  it("returns null when there is no url — an unidentifiable deploy", () => {
    assert.equal(parseDeploymentHost("Deploying...\nDone.\n"), null);
    assert.equal(parseDeploymentHost(""), null);
    assert.equal(parseDeploymentHost(undefined), null);
  });
});

describe("vercelCliEnv", () => {
  it("carries the token in the environment, never in argv", () => {
    const env = vercelCliEnv({
      token: TOKEN,
      orgId: TEAM_ID,
      projectId: PROJECT_ID,
      baseEnv: { PATH: "/usr/bin" },
    });
    assert.equal(env.VERCEL_TOKEN, TOKEN);
    assert.equal(env.VERCEL_ORG_ID, TEAM_ID);
    assert.equal(env.VERCEL_PROJECT_ID, PROJECT_ID);
    assert.equal(env.PATH, "/usr/bin", "the ambient environment must survive");
  });

  it("builds a fresh object rather than mutating the base environment", () => {
    // Two projects deployed in one process must not inherit each other's
    // VERCEL_PROJECT_ID — that ships landing's build to the web project and
    // reports success everywhere.
    const base = { PATH: "/usr/bin" };
    vercelCliEnv({ token: TOKEN, orgId: TEAM_ID, projectId: PROJECT_ID, baseEnv: base });
    assert.equal(base.VERCEL_PROJECT_ID, undefined);
  });
});

describe("buildAndDeployVercelProject", () => {
  it("runs pull, then build, then deploy — in that order", async () => {
    const { runCommand, calls } = makeRunStub({ deploy: READY_DEPLOY });

    const result = await buildAndDeployVercelProject({
      target: VERCEL_TARGET_PRODUCTION,
      sha: SHA,
      token: TOKEN,
      orgId: TEAM_ID,
      projectId: PROJECT_ID,
      runCommand,
      logger: quiet,
    });

    assert.deepEqual(
      calls.map((c) => c.args[0]),
      ["pull", "build", "deploy"],
    );
    assert.equal(result.host, "frapp-web-abc123.vercel.app");
  });

  it("passes the project id to every step", async () => {
    const { runCommand, calls } = makeRunStub({ deploy: READY_DEPLOY });
    await buildAndDeployVercelProject({
      target: VERCEL_TARGET_PREVIEW,
      sha: SHA,
      token: TOKEN,
      orgId: TEAM_ID,
      projectId: PROJECT_ID,
      runCommand,
      logger: quiet,
    });
    for (const call of calls) {
      assert.equal(call.env.VERCEL_PROJECT_ID, PROJECT_ID);
      assert.equal(call.env.VERCEL_TOKEN, TOKEN);
    }
  });

  it("throws when pull fails, and never reaches build or deploy", async () => {
    // A failed pull leaves the wrong (or no) env vars on disk; building on top
    // of that produces a bundle pointed at the wrong infrastructure.
    const { runCommand, calls } = makeRunStub({
      pull: { code: 1, stdout: "", stderr: "Not authorized" },
    });

    await assert.rejects(
      buildAndDeployVercelProject({
        target: VERCEL_TARGET_PRODUCTION,
        sha: SHA,
        token: TOKEN,
        orgId: TEAM_ID,
        projectId: PROJECT_ID,
        runCommand,
        logger: quiet,
      }),
      /exited 1.*Not authorized/s,
    );
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      ["pull"],
    );
  });

  it("throws when build fails, and never uploads", async () => {
    const { runCommand, calls } = makeRunStub({
      build: { code: 1, stdout: "", stderr: "Type error in app/page.tsx" },
    });

    await assert.rejects(
      buildAndDeployVercelProject({
        target: VERCEL_TARGET_PRODUCTION,
        sha: SHA,
        token: TOKEN,
        orgId: TEAM_ID,
        projectId: PROJECT_ID,
        runCommand,
        logger: quiet,
      }),
      /Type error/,
    );
    assert.ok(!calls.some((c) => c.args[0] === "deploy"));
  });

  it("throws when deploy exits 0 but prints no URL", async () => {
    // A deploy whose result cannot be identified cannot be verified, and an
    // unverifiable deploy is not a successful one.
    const { runCommand } = makeRunStub({
      deploy: { code: 0, stdout: "Done.\n", stderr: "" },
    });

    await assert.rejects(
      buildAndDeployVercelProject({
        target: VERCEL_TARGET_PRODUCTION,
        sha: SHA,
        token: TOKEN,
        orgId: TEAM_ID,
        projectId: PROJECT_ID,
        runCommand,
        logger: quiet,
      }),
      /printed no deployment URL/,
    );
  });
});
