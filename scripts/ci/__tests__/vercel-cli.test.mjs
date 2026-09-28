import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  VERCEL_TARGET_PREVIEW,
  VERCEL_TARGET_PRODUCTION,
  buildVercelProject,
  deployPrebuiltVercelProject,
  normalizeGitSha,
  parseDeploymentHost,
  pulledEnvFileFor,
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

/**
 * The minimal `buildEnv` every build and upload now requires (#2673): a base
 * env, no app config. Tests about what a build env carries use their own.
 */
const BUILD_ENV = Object.freeze({ baseEnv: { PATH: "/usr/bin" }, appEnv: {}, appKeys: [] });

/** An env-file stand-in whose pulled file holds only a system variable. */
function pulledEnvFs() {
  return { read: async () => 'VERCEL_ENV="production"\n', write: async () => {} };
}

const CWD = "/work/repo";
const VERCEL_DIR = vercelDirFor(CWD);
const STASH = "/tmp/vercel-builds/frapp-web";

/**
 * One project built and then uploaded through `STASH`, the way every deploy
 * runs since #2803 (`deploy-vercel.mjs`: `DEPLOY_PHASE=build`, then `upload`).
 * Both halves share `options` and the in-memory stash, so no test touches the
 * real disk. `build` leaves a `.vercel` behind, as the real CLI does, unless a
 * test replaces that step.
 */
function twoPhase(byStep = {}) {
  const stash = makeStashFs();
  const { runCommand, calls } = makeRunStub({
    build: () => {
      stash.dirs.add(VERCEL_DIR);
      return { code: 0, stdout: "", stderr: "" };
    },
    ...byStep,
  });
  const options = {
    target: VERCEL_TARGET_PRODUCTION,
    sha: SHA,
    token: TOKEN,
    orgId: TEAM_ID,
    projectId: PROJECT_ID,
    cwd: CWD,
    stashDir: STASH,
    buildEnv: BUILD_ENV,
    runCommand,
    stashFs: stash.fs,
    envFileFs: pulledEnvFs(),
    logger: quiet,
  };
  return { options, calls, stash };
}

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
  it("uploads the prebuilt output as ONE archive, not one request per file", () => {
    // Vercel's free plan allows 5000 upload requests per 24h; a per-file
    // prebuilt Next.js deploy is thousands, and six merges in a day exhausted
    // it (run 34062542629). On the production path that failure lands after
    // the apply. `--archive=tgz` makes a deploy a handful of requests.
    const args = vercelDeployArgs({ target: VERCEL_TARGET_PREVIEW, sha: SHA });
    assert.ok(args.includes("--archive=tgz"));
    assert.ok(args.indexOf("--archive=tgz") > args.indexOf("--prebuilt"));
  });

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

  it("injects a named git SHA as VERCEL_GIT_COMMIT_SHA so Next inlines Sentry release", () => {
    const env = vercelCliEnv({
      token: TOKEN,
      orgId: TEAM_ID,
      projectId: PROJECT_ID,
      gitSha: SHA,
      baseEnv: { PATH: "/usr/bin", VERCEL_GIT_COMMIT_SHA: "stale" },
    });
    assert.equal(env.VERCEL_GIT_COMMIT_SHA, SHA);
  });

  it("does not invent VERCEL_GIT_COMMIT_SHA when the named sha is missing or garbage", () => {
    const without = vercelCliEnv({
      token: TOKEN,
      orgId: TEAM_ID,
      projectId: PROJECT_ID,
      baseEnv: { PATH: "/usr/bin" },
    });
    assert.equal(without.VERCEL_GIT_COMMIT_SHA, undefined);

    const garbage = vercelCliEnv({
      token: TOKEN,
      orgId: TEAM_ID,
      projectId: PROJECT_ID,
      gitSha: "not-a-sha",
      baseEnv: { PATH: "/usr/bin" },
    });
    assert.equal(garbage.VERCEL_GIT_COMMIT_SHA, undefined);
  });
});

describe("vercelCliEnv extraEnv", () => {
  // The app config sits UNDER the CLI's own variables. A store that ever held a
  // key named VERCEL_TOKEN or VERCEL_PROJECT_ID must not be able to redirect the
  // upload to another project or authenticate as someone else.
  it("layers app config over the base env and under the CLI's identity", () => {
    const env = vercelCliEnv({
      token: TOKEN,
      orgId: TEAM_ID,
      projectId: PROJECT_ID,
      gitSha: SHA,
      baseEnv: { PATH: "/usr/bin", NEXT_PUBLIC_API_URL: "from-base" },
      extraEnv: {
        NEXT_PUBLIC_API_URL: "https://api-staging.example",
        VERCEL_TOKEN: "hijack",
        VERCEL_PROJECT_ID: "prj_other",
      },
    });
    assert.equal(env.NEXT_PUBLIC_API_URL, "https://api-staging.example");
    assert.equal(env.VERCEL_TOKEN, TOKEN);
    assert.equal(env.VERCEL_PROJECT_ID, PROJECT_ID);
    assert.equal(env.PATH, "/usr/bin");
  });
});

describe("pulledEnvFileFor", () => {
  it("names the file `vercel pull` writes for the target's Vercel environment", () => {
    assert.equal(pulledEnvFileFor(CWD, VERCEL_TARGET_PREVIEW), `${VERCEL_DIR}/.env.preview.local`);
    assert.equal(pulledEnvFileFor(CWD, VERCEL_TARGET_PRODUCTION), `${VERCEL_DIR}/.env.production.local`);
  });
});

describe("normalizeGitSha", () => {
  it("accepts 7–40 hex and rejects everything else", () => {
    assert.equal(normalizeGitSha(SHA), SHA);
    assert.equal(normalizeGitSha("  abcdef0  "), "abcdef0");
    assert.equal(normalizeGitSha(""), undefined);
    assert.equal(normalizeGitSha("not-a-sha"), undefined);
    assert.equal(normalizeGitSha(undefined), undefined);
  });
});

// What the single-phase `buildAndDeployVercelProject` pinned, pinned again on
// the path that replaced it (#2803): the build phase stashes `.vercel`, the
// upload phase restores and ships it.
describe("a build then an upload", () => {
  it("runs pull, then build, then deploy — in that order", async () => {
    const t = twoPhase({ deploy: READY_DEPLOY });

    await buildVercelProject(t.options);
    const result = await deployPrebuiltVercelProject(t.options);

    assert.deepEqual(
      t.calls.map((c) => c.args[0]),
      ["pull", "build", "deploy"],
    );
    assert.equal(result.host, "frapp-web-abc123.vercel.app");
    // The upload shipped exactly what the build stashed: moved out after the
    // build, moved back in before the deploy.
    assert.deepEqual(t.stash.ops, [
      ["remove", VERCEL_DIR],
      ["remove", STASH],
      ["move", VERCEL_DIR, STASH],
      ["remove", VERCEL_DIR],
      ["move", STASH, VERCEL_DIR],
    ]);
  });

  it("passes the project id to every step", async () => {
    const t = twoPhase({ deploy: READY_DEPLOY });
    const options = { ...t.options, target: VERCEL_TARGET_PREVIEW };
    await buildVercelProject(options);
    await deployPrebuiltVercelProject(options);
    assert.deepEqual(
      t.calls.map((c) => c.args[0]),
      ["pull", "build", "deploy"],
    );
    for (const call of t.calls) {
      assert.equal(call.env.VERCEL_PROJECT_ID, PROJECT_ID);
      assert.equal(call.env.VERCEL_TOKEN, TOKEN);
      assert.equal(
        call.env.VERCEL_GIT_COMMIT_SHA,
        SHA,
        "pull/build must see the named SHA so Next inlines Sentry release",
      );
    }
  });

  it("throws when pull fails, and never reaches build or deploy", async () => {
    // A failed pull leaves the wrong (or no) env vars on disk; building on top
    // of that produces a bundle pointed at the wrong infrastructure.
    const t = twoPhase({
      pull: { code: 1, stdout: "", stderr: "Not authorized" },
      deploy: READY_DEPLOY,
    });

    await assert.rejects(buildVercelProject(t.options), /exited 1.*Not authorized/s);
    // An upload phase run anyway finds nothing stashed and ships nothing.
    await assert.rejects(deployPrebuiltVercelProject(t.options), /No prebuilt output/);
    assert.deepEqual(
      t.calls.map((c) => c.args[0]),
      ["pull"],
    );
  });

  it("throws when build fails, and never uploads", async () => {
    const t = twoPhase({
      build: { code: 1, stdout: "", stderr: "Type error in app/page.tsx" },
      deploy: READY_DEPLOY,
    });

    await assert.rejects(buildVercelProject(t.options), /Type error/);
    await assert.rejects(deployPrebuiltVercelProject(t.options), /No prebuilt output/);
    assert.ok(!t.calls.some((c) => c.args[0] === "deploy"));
  });

  it("names the SIGNAL when a build is killed, not 'exited null'", async () => {
    // The OOM killer taking `next build` reports code null; without the signal
    // the message reads "exited null" with no cause, and moving both app builds
    // onto a 7GB runner is exactly what this change did.
    const t = twoPhase({
      build: { code: null, signal: "SIGKILL", stdout: "", stderr: "" },
    });

    await assert.rejects(buildVercelProject(t.options), /was killed by SIGKILL/);
  });

  it("throws when deploy exits 0 but prints no URL", async () => {
    // A deploy whose result cannot be identified cannot be verified, and an
    // unverifiable deploy is not a successful one.
    const t = twoPhase({
      deploy: { code: 0, stdout: "Done.\n", stderr: "" },
    });

    await buildVercelProject(t.options);
    await assert.rejects(deployPrebuiltVercelProject(t.options), /printed no deployment URL/);
  });
});

// The two phases every deploy runs (production since the migration-first
// release, staging since #2803): build everything before the migration
// applies, upload after the API is healthy. The stash is what carries the built
// output across the gap and across the second project's build.
describe("buildVercelProject", () => {
  const base = {
    target: VERCEL_TARGET_PRODUCTION,
    token: TOKEN,
    orgId: TEAM_ID,
    projectId: PROJECT_ID,
    label: "frapp-web",
    cwd: CWD,
    stashDir: STASH,
    logger: quiet,
    buildEnv: BUILD_ENV,
    envFileFs: pulledEnvFs(),
  };

  it("runs pull then build, and never deploy", async () => {
    const stash = makeStashFs();
    const { runCommand, calls } = makeRunStub({
      build: () => {
        stash.dirs.add(VERCEL_DIR);
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    await buildVercelProject({ ...base, runCommand, stashFs: stash.fs });
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
    // `.vercel` is emptied before the pull. A stale stash from an earlier
    // attempt is removed before the move, so two builds can never be merged
    // into one upload.
    assert.deepEqual(stash.ops, [
      ["remove", VERCEL_DIR],
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
    assert.deepEqual(stash.ops, [["remove", VERCEL_DIR]], "only the pre-pull emptying ran");
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
    assert.deepEqual(stash.ops, [["remove", VERCEL_DIR]], "only the pre-pull emptying ran");
  });

  // #2803: there is no single-phase path to leave the output in place for. A
  // build without a stash would leave it where the next project's build
  // overwrites it, so it is refused before anything runs.
  it("refuses to build without a stash dir, before any CLI step", async () => {
    const stash = makeStashFs([VERCEL_DIR]);
    const { runCommand, calls } = makeRunStub();
    await assert.rejects(
      buildVercelProject({ ...base, stashDir: undefined, runCommand, stashFs: stash.fs }),
      /\[frapp-web\] No stash dir/,
    );
    assert.equal(calls.length, 0);
    assert.deepEqual(stash.ops, [], "not even the pre-pull emptying ran");
  });

  // #2673: the fallback to the ambient job env, which holds the whole injected
  // store, is gone. A caller that forgets the build env is refused.
  it("refuses to build without a build env, before any CLI step", async () => {
    const { runCommand, calls } = makeRunStub();
    await assert.rejects(
      buildVercelProject({ ...base, buildEnv: undefined, runCommand, stashFs: makeStashFs().fs }),
      /No build env/,
    );
    assert.equal(calls.length, 0);
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
    buildEnv: BUILD_ENV,
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
    assert.deepEqual(calls[0].args.slice(0, 5), ["deploy", "--prebuilt", "--archive=tgz", "--yes", "--prod"]);
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

  // #2803 deleted the single-phase path that deployed `.vercel` in place. An
  // upload without a stash would ship whatever `.vercel` holds, which on a
  // two-project run is the other project's build.
  it("refuses to upload without a stash dir — never ships whatever .vercel holds", async () => {
    const stash = makeStashFs([VERCEL_DIR]);
    const { runCommand, calls } = makeRunStub({ deploy: READY_DEPLOY });

    await assert.rejects(
      deployPrebuiltVercelProject({ ...base, runCommand, stashFs: stash.fs }),
      /\[frapp-web\] No stash dir/,
    );
    assert.equal(calls.length, 0, "nothing was uploaded");
    assert.equal(stash.ops.length, 0);
    assert.ok(stash.dirs.has(VERCEL_DIR), "the existing .vercel was not destroyed either");
  });

  it("refuses to upload without a build env, before touching the stash", async () => {
    const stash = makeStashFs([STASH]);
    const { runCommand, calls } = makeRunStub({ deploy: READY_DEPLOY });
    await assert.rejects(
      deployPrebuiltVercelProject({ ...base, buildEnv: undefined, runCommand, stashDir: STASH, stashFs: stash.fs }),
      /No build env/,
    );
    assert.equal(calls.length, 0);
    assert.equal(stash.ops.length, 0);
  });

  it("runs the upload on the base env alone", async () => {
    const { runCommand, calls } = makeRunStub({ deploy: READY_DEPLOY });
    process.env.FRAPP_TEST_INJECTED_SECRET = "sk_live_should_never_reach_the_cli";
    try {
      await deployPrebuiltVercelProject({ ...base, runCommand, stashDir: STASH, stashFs: makeStashFs([STASH]).fs });
    } finally {
      delete process.env.FRAPP_TEST_INJECTED_SECRET;
    }
    assert.equal(calls[0].env.FRAPP_TEST_INJECTED_SECRET, undefined);
    assert.equal(calls[0].env.PATH, "/usr/bin");
  });
});

// Every build since #2673 (staging since #2672): app config from Infisical,
// handed in as a `buildEnv`, and the pulled env reduced to Vercel's system
// variables (#2810).
describe("buildVercelProject with an Infisical build env", () => {
  const ENV_FILE = pulledEnvFileFor(CWD, VERCEL_TARGET_PREVIEW);
  const INJECTED_SECRET = "sk_live_should_never_reach_the_cli";

  // What `infisicalBuildEnv` would return: the pre-injection names only, and
  // the project's app keys. The backend secret is in NEITHER, which is the
  // point — it was in the job env, and nothing below may carry it.
  const buildEnv = {
    baseEnv: { PATH: "/usr/bin", HOME: "/home/runner", CI: "true" },
    appEnv: {
      NEXT_PUBLIC_API_URL: "https://api-staging.example",
      NEXT_PUBLIC_SUPABASE_URL: "https://staging-ref.supabase.co",
    },
    appKeys: ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_POSTHOG_KEY"],
  };

  // The shape the CLI writes: sorted `KEY="value"` lines under a header, with
  // Vercel's system variables alongside the project's rows, and a Sensitive
  // row's value written as the placeholder (the shape run 36458267082 hit,
  // most likely `PORT`; the log never names the row).
  const PULLED = [
    "# Created by Vercel CLI",
    'NEXT_PUBLIC_API_URL="https://stale.example"',
    'NEXT_PUBLIC_API_URL_V2="a project row the app does not read"',
    'NEXT_PUBLIC_POSTHOG_KEY="phc_stale"',
    'PORT="[SENSITIVE]"',
    'VERCEL_ENV="preview"',
    'VERCEL_OIDC_TOKEN="oidc"',
    "",
  ].join("\n");

  function makeEnvFileFs() {
    const files = new Map();
    const writes = [];
    return {
      files,
      writes,
      fs: {
        read: async (p) => (files.has(p) ? files.get(p) : null),
        write: async (p, text) => {
          writes.push(p);
          files.set(p, text);
        },
      },
    };
  }

  /**
   * A run stub whose pull writes PULLED and whose build leaves a `.vercel`, as
   * the real CLI would. `.vercel` starts out holding the previous project's
   * leftovers, which the build must empty before its pull.
   */
  function setup({ pulled = PULLED } = {}) {
    const stash = makeStashFs([VERCEL_DIR]);
    const envFiles = makeEnvFileFs();
    const events = [];
    const origRemove = stash.fs.remove;
    stash.fs.remove = async (p) => {
      events.push(`remove ${p}`);
      return origRemove(p);
    };
    const { runCommand, calls } = makeRunStub({
      pull: () => {
        events.push("pull");
        if (pulled !== null) envFiles.files.set(ENV_FILE, pulled);
        return { code: 0, stdout: "", stderr: "" };
      },
      build: () => {
        events.push("build");
        stash.dirs.add(VERCEL_DIR);
        return { code: 0, stdout: "", stderr: "" };
      },
      deploy: READY_DEPLOY,
    });
    const logged = [];
    const logger = { log: (line) => logged.push(line) };
    const options = {
      target: VERCEL_TARGET_PREVIEW,
      sha: SHA,
      token: TOKEN,
      orgId: TEAM_ID,
      projectId: PROJECT_ID,
      label: "frapp-web",
      cwd: CWD,
      stashDir: STASH,
      buildEnv,
      runCommand,
      stashFs: stash.fs,
      envFileFs: envFiles.fs,
      logger,
    };
    return { options, calls, stash, envFiles, events, logged };
  }

  const inAmbient = (fn) => {
    // The injected secret is in the ambient env the way the workflow's
    // Infisical step puts it there. A CLI env built from process.env would
    // carry it; one built from `buildEnv` cannot.
    process.env.FRAPP_TEST_INJECTED_SECRET = INJECTED_SECRET;
    return fn().finally(() => {
      delete process.env.FRAPP_TEST_INJECTED_SECRET;
    });
  };

  it("empties .vercel before pulling, so the previous project's rows cannot merge in", async () => {
    const t = setup();
    await buildVercelProject(t.options);
    // The last remove is the stale stash's, before the build is moved there.
    assert.deepEqual(t.events, [`remove ${VERCEL_DIR}`, "pull", "build", `remove ${STASH}`]);
  });

  it("runs every CLI step on the base env: nothing else the job injected reaches it", async () => {
    await inAmbient(async () => {
      const t = setup();
      await buildVercelProject(t.options);
      await deployPrebuiltVercelProject(t.options);
      assert.deepEqual(
        t.calls.map((c) => c.args[0]),
        ["pull", "build", "deploy"],
      );
      for (const call of t.calls) {
        assert.equal(call.env.FRAPP_TEST_INJECTED_SECRET, undefined, `${call.args[0]} saw the injected store`);
        assert.equal(call.env.PATH, "/usr/bin");
        assert.equal(call.env.VERCEL_TOKEN, TOKEN);
        assert.equal(call.env.VERCEL_PROJECT_ID, PROJECT_ID);
        assert.equal(call.env.VERCEL_GIT_COMMIT_SHA, SHA);
      }
    });
  });

  it("gives the app config to `vercel build` only", async () => {
    const t = setup();
    await buildVercelProject(t.options);
    await deployPrebuiltVercelProject(t.options);
    assert.deepEqual(
      t.calls.map((c) => c.args[0]),
      ["pull", "build", "deploy"],
    );
    const byStep = Object.fromEntries(t.calls.map((c) => [c.args[0], c.env]));
    assert.equal(byStep.build.NEXT_PUBLIC_API_URL, "https://api-staging.example");
    assert.equal(byStep.build.NEXT_PUBLIC_SUPABASE_URL, "https://staging-ref.supabase.co");
    assert.equal(byStep.pull.NEXT_PUBLIC_API_URL, undefined);
    assert.equal(byStep.deploy.NEXT_PUBLIC_API_URL, undefined);
  });

  it("keeps only Vercel's system variables in the pulled env", async () => {
    // NEXT_PUBLIC_POSTHOG_KEY is not in appEnv (Infisical had no value). Left in
    // the file, dotenv would load it and the bundle would carry Vercel's stale
    // value while the log said the config came from Infisical. PORT and
    // NEXT_PUBLIC_API_URL_V2 are rows the app does not read, and still reached
    // the build before #2810, which is how a placeholder broke landing's
    // prerender in run 36458267082.
    const t = setup();
    await buildVercelProject(t.options);
    const after = t.envFiles.files.get(ENV_FILE);
    assert.doesNotMatch(after, /^NEXT_PUBLIC_API_URL=/m, "an app key Infisical supplied");
    assert.doesNotMatch(after, /^NEXT_PUBLIC_POSTHOG_KEY=/m, "an app key Infisical did not supply");
    assert.doesNotMatch(after, /^NEXT_PUBLIC_API_URL_V2=/m, "a project row the app does not read");
    assert.doesNotMatch(after, /^PORT=/m, "a Sensitive project row, written as the placeholder");
    assert.ok(!after.includes("[SENSITIVE]"));
    assert.match(after, /^VERCEL_ENV="preview"$/m, "next.config.js derives the Sentry environment from it");
    assert.match(after, /^VERCEL_OIDC_TOKEN=/m);
    assert.match(after, /^# Created by Vercel CLI$/m);
  });

  it("filters the file after the pull and before the build", async () => {
    const t = setup();
    const origWrite = t.envFiles.fs.write;
    t.envFiles.fs.write = async (p, text) => {
      t.events.push("strip");
      return origWrite(p, text);
    };
    await buildVercelProject(t.options);
    assert.deepEqual(t.events, [`remove ${VERCEL_DIR}`, "pull", "strip", "build", `remove ${STASH}`]);
  });

  it("logs the names it kept and removed, and never a value", async () => {
    const t = setup();
    await buildVercelProject(t.options);
    const text = t.logged.join("\n");
    assert.match(text, /Kept Vercel's system variables from the pulled preview env: VERCEL_ENV, VERCEL_OIDC_TOKEN\./);
    assert.match(
      text,
      /Removed NEXT_PUBLIC_API_URL, NEXT_PUBLIC_API_URL_V2, NEXT_PUBLIC_POSTHOG_KEY, PORT from the pulled preview env/,
    );
    for (const value of ["https://stale.example", "phc_stale", "oidc", "https://api-staging.example", "[SENSITIVE]"]) {
      assert.ok(!text.includes(value), `the log printed a value: ${value}`);
    }
  });

  it("leaves the file untouched when it holds only system rows", async () => {
    const t = setup({ pulled: '# Created by Vercel CLI\nVERCEL_ENV="preview"\n' });
    await buildVercelProject(t.options);
    assert.deepEqual(t.envFiles.writes, []);
    assert.match(t.logged.join("\n"), /holds no project rows/);
  });

  it("refuses to build when a kept system row holds the placeholder", async () => {
    // A Sensitive row under a `VERCEL_` name passes the allowlist. Its value
    // is not one the build can use, and dotenv would load it.
    const t = setup({ pulled: '# Created by Vercel CLI\nVERCEL_ENV="preview"\nVERCEL_FOO="[SENSITIVE]"\n' });
    await assert.rejects(
      buildVercelProject(t.options),
      /\[frapp-web\] The pulled preview env holds VERCEL_FOO with the value "\[SENSITIVE\]".*nothing was built/s,
    );
    assert.deepEqual(t.calls.map((c) => c.args[0]), ["pull"], "nothing was built");
  });

  it("refuses to build when the build's own environment holds the placeholder", async () => {
    // `infisicalBuildEnv` refuses this first; the boundary check is what holds
    // for a `buildEnv` assembled any other way.
    const t = setup();
    await assert.rejects(
      buildVercelProject({
        ...t.options,
        buildEnv: { ...buildEnv, appEnv: { ...buildEnv.appEnv, NEXT_PUBLIC_API_URL: "[SENSITIVE]" } },
      }),
      /The environment for `vercel build` holds NEXT_PUBLIC_API_URL with the value "\[SENSITIVE\]"/,
    );
    assert.deepEqual(t.calls.map((c) => c.args[0]), ["pull"], "nothing was built");
  });

  it("refuses to build when the pull left no env file where the strip looks", async () => {
    // `.vercel` was emptied first, so a missing file means the CLI wrote it
    // elsewhere. Building anyway would load an unstripped file: the strip that
    // silently matches nothing and cannot fail.
    const t = setup({ pulled: null });
    await assert.rejects(buildVercelProject(t.options), /wrote no .*\.env\.preview\.local.*Refusing to build/s);
    assert.deepEqual(t.envFiles.writes, []);
    assert.deepEqual(
      t.calls.map((c) => c.args[0]),
      ["pull"],
      "nothing was built",
    );
  });

  it("warns, naming keys only, when Vercel held an app key Infisical did not supply", async () => {
    // NEXT_PUBLIC_POSTHOG_KEY is in the pulled file but not in appEnv: the
    // build now goes without it. On the first production run on this path that
    // is how a key that only ever lived in Vercel shows up.
    const t = setup();
    const warned = [];
    await buildVercelProject({ ...t.options, logger: { log: () => {}, warn: (line) => warned.push(line) } });
    assert.equal(warned.length, 1);
    assert.match(warned[0], /^::warning::\[frapp-web\].*holds NEXT_PUBLIC_POSTHOG_KEY, but the Infisical injection supplied no value/);
    assert.doesNotMatch(warned[0], /NEXT_PUBLIC_API_URL\b/, "a key Infisical supplied is not lost");
    assert.doesNotMatch(warned[0], /PORT|NEXT_PUBLIC_API_URL_V2/, "a row the app does not read is not lost");
    assert.ok(!warned[0].includes("phc_stale"), "the warning printed a value");
  });

  it("does not call a key a dry run withheld on purpose lost", async () => {
    // Infisical supplied it; `buildEnvsFor` withheld it from a dry run (#2275).
    // Calling it missing would tell the owner to add a key Infisical holds.
    const t = setup();
    const warned = [];
    await buildVercelProject({
      ...t.options,
      buildEnv: { ...buildEnv, withheld: ["NEXT_PUBLIC_POSTHOG_KEY"] },
      logger: { log: () => {}, warn: (line) => warned.push(line) },
    });
    assert.deepEqual(warned, []);
    assert.doesNotMatch(t.envFiles.files.get(ENV_FILE), /^NEXT_PUBLIC_POSTHOG_KEY=/m, "still removed");
  });

  it("builds production the same way: system rows only, base env, app keys", async () => {
    await inAmbient(async () => {
      const t = setup();
      const prodFile = pulledEnvFileFor(CWD, VERCEL_TARGET_PRODUCTION);
      const { runCommand, calls } = makeRunStub({
        pull: () => {
          t.envFiles.files.set(prodFile, PULLED.replace('VERCEL_ENV="preview"', 'VERCEL_ENV="production"'));
          return { code: 0, stdout: "", stderr: "" };
        },
        build: () => {
          t.stash.dirs.add(VERCEL_DIR);
          return { code: 0, stdout: "", stderr: "" };
        },
      });
      await buildVercelProject({ ...t.options, target: VERCEL_TARGET_PRODUCTION, runCommand });
      const after = t.envFiles.files.get(prodFile);
      assert.doesNotMatch(after, /^NEXT_PUBLIC_API_URL=/m);
      assert.doesNotMatch(after, /^PORT=/m, "a Sensitive project row, the shape run 36458267082 hit");
      assert.match(after, /^VERCEL_ENV="production"$/m, "assertProductionWebPublicEnv reads it");
      const build = calls.find((c) => c.args[0] === "build");
      assert.deepEqual(build.args, ["build", "--prod"]);
      assert.equal(build.env.NEXT_PUBLIC_API_URL, "https://api-staging.example");
      assert.equal(build.env.FRAPP_TEST_INJECTED_SECRET, undefined);
    });
  });
});
