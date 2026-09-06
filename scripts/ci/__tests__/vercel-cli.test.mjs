import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  VERCEL_TARGET_PREVIEW,
  VERCEL_TARGET_PRODUCTION,
  buildAndDeployVercelProject,
  buildVercelProject,
  deployPrebuiltVercelProject,
  parseDeploymentHost,
  vercelBuildArgs,
  vercelCliEnv,
  vercelDeployArgs,
  vercelDirFor,
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

/**
 * An in-memory stand-in for the stash filesystem: a set of directory paths that
 * exist, plus a log of every move and remove. `build` in a run stub can mark
 * `.vercel` as created via `onBuild`.
 */
function makeStashFs(initial = []) {
  const dirs = new Set(initial);
  const ops = [];
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
const VERCEL_DIR = vercelDirFor(CWD);
const STASH = "/tmp/vercel-builds/frapp-web";

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

  it("takes the FIRST url when the CLI printed more than one", () => {
    // The deployment URL is printed first; anything after it is an alias line.
    // An alias is a STABLE hostname, and GET /v13/deployments/{idOrUrl} resolves
    // one to whatever deployment currently serves it — on the production path,
    // the PREVIOUS release, which is `production` and `READY` and so passes both
    // the target assertion and the poll. Taking the last URL would turn a future
    // CLI that prints "Aliased to https://frapp.live" into a silent false green.
    assert.equal(
      parseDeploymentHost("https://dpl-new.vercel.app\nhttps://frapp.live\n"),
      "dpl-new.vercel.app",
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

  it("names the SIGNAL when a build is killed, not 'exited null'", async () => {
    // The OOM killer taking `next build` reports code null; without the signal
    // the message reads "exited null" with no cause, and moving both app builds
    // onto a 7GB runner is exactly what this change did.
    const { runCommand } = makeRunStub({
      build: { code: null, signal: "SIGKILL", stdout: "", stderr: "" },
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
      /was killed by SIGKILL/,
    );
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

// The two-phase form used by the production path: build everything before the
// migration applies, upload after Render is healthy. The stash is what carries
// the built output across the gap and across the second project's build.
describe("buildVercelProject", () => {
  const base = {
    target: VERCEL_TARGET_PRODUCTION,
    token: TOKEN,
    orgId: TEAM_ID,
    projectId: PROJECT_ID,
    label: "frapp-web",
    cwd: CWD,
    logger: quiet,
  };

  it("runs pull then build, and never deploy", async () => {
    const { runCommand, calls } = makeRunStub();
    await buildVercelProject({ ...base, runCommand });
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      ["pull", "build"],
    );
    assert.deepEqual(calls[1].args, ["build", "--prod"]);
  });

  it("stashes the whole .vercel directory after a successful build", async () => {
    const stash = makeStashFs();
    const { runCommand } = makeRunStub({
      build: () => {
        stash.dirs.add(VERCEL_DIR);
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    const result = await buildVercelProject({
      ...base,
      runCommand,
      stashDir: STASH,
      stashFs: stash.fs,
    });

    assert.equal(result.stashDir, STASH);
    assert.ok(stash.dirs.has(STASH), "the stash exists");
    assert.ok(!stash.dirs.has(VERCEL_DIR), ".vercel was moved, not copied — the next build starts clean");
    // A stale stash from an earlier attempt is removed before the move, so two
    // builds can never be merged into one upload.
    assert.deepEqual(stash.ops, [
      ["remove", STASH],
      ["move", VERCEL_DIR, STASH],
    ]);
  });

  it("fails when the build exited 0 but produced no .vercel to stash", async () => {
    // Nothing would be uploaded later; this must not read as a built project.
    const stash = makeStashFs();
    const { runCommand } = makeRunStub();

    await assert.rejects(
      buildVercelProject({ ...base, runCommand, stashDir: STASH, stashFs: stash.fs }),
      /left no .*\.vercel to stash/,
    );
    assert.equal(stash.ops.length, 0);
  });

  it("does not touch the stash when the build fails", async () => {
    const stash = makeStashFs([STASH]);
    const { runCommand } = makeRunStub({
      build: { code: 1, stdout: "", stderr: "Type error" },
    });

    await assert.rejects(
      buildVercelProject({ ...base, runCommand, stashDir: STASH, stashFs: stash.fs }),
      /Type error/,
    );
    // The previous stash is left alone: the failure is reported on its own, not
    // compounded by deleting output from an earlier phase.
    assert.ok(stash.dirs.has(STASH));
    assert.equal(stash.ops.length, 0);
  });

  it("leaves .vercel in place when no stash is requested", async () => {
    const stash = makeStashFs();
    const { runCommand } = makeRunStub({
      build: () => {
        stash.dirs.add(VERCEL_DIR);
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    await buildVercelProject({ ...base, runCommand, stashFs: stash.fs });
    assert.ok(stash.dirs.has(VERCEL_DIR));
    assert.equal(stash.ops.length, 0);
  });
});

describe("deployPrebuiltVercelProject", () => {
  const base = {
    target: VERCEL_TARGET_PRODUCTION,
    sha: SHA,
    token: TOKEN,
    orgId: TEAM_ID,
    projectId: PROJECT_ID,
    label: "frapp-web",
    cwd: CWD,
    logger: quiet,
  };

  it("restores the stash over whatever .vercel holds, then deploys only", async () => {
    // On the production path `.vercel` holds the OTHER project's leftovers at
    // this point; uploading those would ship landing's bundle to the web
    // project while every status page reported success.
    const stash = makeStashFs([STASH, VERCEL_DIR]);
    const { runCommand, calls } = makeRunStub({ deploy: READY_DEPLOY });

    const result = await deployPrebuiltVercelProject({
      ...base,
      runCommand,
      stashDir: STASH,
      stashFs: stash.fs,
    });

    assert.equal(result.host, "frapp-web-abc123.vercel.app");
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      ["deploy"],
    );
    assert.deepEqual(stash.ops, [
      ["remove", VERCEL_DIR],
      ["move", STASH, VERCEL_DIR],
    ]);
    assert.deepEqual(calls[0].args.slice(0, 4), ["deploy", "--prebuilt", "--yes", "--prod"]);
  });

  it("refuses to upload when the stash is missing — never falls through to .vercel", async () => {
    const stash = makeStashFs([VERCEL_DIR]);
    const { runCommand, calls } = makeRunStub({ deploy: READY_DEPLOY });

    await assert.rejects(
      deployPrebuiltVercelProject({ ...base, runCommand, stashDir: STASH, stashFs: stash.fs }),
      /No prebuilt output at .*build phase/,
    );
    assert.equal(calls.length, 0, "nothing was uploaded");
    assert.ok(stash.dirs.has(VERCEL_DIR), "the existing .vercel was not destroyed either");
  });

  it("deploys in place when no stash is given (the single-phase path)", async () => {
    const stash = makeStashFs([VERCEL_DIR]);
    const { runCommand, calls } = makeRunStub({ deploy: READY_DEPLOY });

    await deployPrebuiltVercelProject({ ...base, runCommand, stashFs: stash.fs });

    assert.deepEqual(
      calls.map((c) => c.args[0]),
      ["deploy"],
    );
    assert.equal(stash.ops.length, 0);
  });
});
