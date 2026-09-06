// The Vercel CLI half of CI-driven deploys (#1578, ADR-21).
//
// ── Why the CLI and not the create-deployment API ──────────────────────────
// Until ADR-21 both Vercel projects were Git-linked, and `deploy-vercel-
// production.mjs` created a deployment by POSTing `gitSource: {repoId, ref,
// sha}` — telling Vercel "go fetch this commit yourself and build it". That
// argument only means anything while the integration exists. With `link: null`
// there is no integration to fetch anything, so the whole create-by-git-source
// path went with it.
//
// Vercel's API can also take an upload of already-built output, and the CLI is
// the supported front end for exactly that: `vercel build` produces
// `.vercel/output` locally, `vercel deploy --prebuilt` uploads it. ADR-21 names
// this as the replacement. Doing it through the CLI rather than hand-rolling
// the `files` upload form is a large amount of code this repo then does not own
// (file hashing, the upload protocol, the build-output contract).
//
// ── Why the env vars and not `--scope` / `--token` flags ───────────────────
// The CLI reads `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` from
// the environment, and that combination auto-links the working directory
// without a `vercel link` step or a `.vercel/project.json` in the repo.
//
// Passing the token as `--token=<secret>` instead would put it in argv, where
// it is visible to anything that can read the process list on the runner and is
// one careless `set -x` away from the build log. The env form keeps it out of
// both. `--scope` is avoided for a second reason: it wants a team *slug*, while
// everything else in this repo (workflows, guardrails, `deploy-vercel-
// production.mjs`) already carries the team *id* — `VERCEL_ORG_ID` takes the id.
//
// ── Why `--meta githubCommitSha` is not decoration ─────────────────────────
// A `--prebuilt` deployment has no git metadata at all: nothing about the
// upload tells Vercel which commit produced it. Three things in this repo read
// that metadata back and would silently degrade without it:
//
//   * ADR-19 / #1340's guarantee that production is only ever deployed from a
//     NAMED commit — the SHA has to be visible on the deployment for that claim
//     to be checkable after the fact rather than merely asserted.
//   * `ensure-vercel-staging-alias.mjs`, which finds the deployment to alias
//     via `findVercelDeploymentBySha` — i.e. by `meta.githubCommitSha`. Without
//     the meta flag it would find nothing and skip, leaving the staging
//     hostname on the previous build.
//   * `wasSupersededByLaterDeployment` in `verify-vercel-deploy.mjs`, which
//     scopes supersession per branch via `meta.githubCommitRef`.
//
// `githubCommitRef` is set to the branch (default `main`) for the same reason
// the old `gitSource.ref` was a branch and not the SHA: every branch-scoped
// lookup downstream matches on it, and a commit id in that field matches
// nothing.
//
// ── Why build and upload are separable ─────────────────────────────────────
// `vercel build` is the step that can fail for reasons unrelated to the commit
// — the OOM killer, a missing Production env var, a registry blip during
// `next build` — and on the production path it used to run AFTER the migration
// had applied and the Render API had shipped. A failure there left a migrated
// database under a half-updated production with no tag naming what was live:
// exactly the split run 33275321347 produced. So `deploy-production.yml` now
// builds BOTH bundles before anything is applied and uploads them after Render
// is healthy. That needs the two halves to be callable separately, with the
// built output surviving in between — hence `buildVercelProject`,
// `deployPrebuiltVercelProject`, and the `stashDir` they hand off through.
//
// The stash moves the whole `.vercel` directory, not just `.vercel/output`:
// `vercel pull` writes `project.json` and the environment file beside the
// output, `vercel build` records the target it built for in
// `output/builds.json`, and `vercel deploy --prebuilt --prod` checks that
// recorded target against the flag. Keeping the directory whole keeps every one
// of those consistent per project, and it is what lets two projects build in
// one checkout without the second `vercel build` overwriting the first's
// output — which is the reason the builds were sequential to begin with.
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/vercel-cli.test.mjs`.

import { spawn } from "node:child_process";
import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The Vercel deployment target this repo understands.
 *
 * `production` is the released channel; anything else is a preview build, which
 * is what staging is. Kept as a two-value vocabulary rather than passing
 * Vercel's own strings around, so a typo cannot quietly select the wrong one.
 */
export const VERCEL_TARGET_PRODUCTION = "production";
export const VERCEL_TARGET_PREVIEW = "preview";

/**
 * Which Vercel *environment* a target pulls its env vars from.
 *
 * This is the load-bearing line for correctness of the built artifact.
 * `NEXT_PUBLIC_*` values are inlined at build time, and the Infisical→Vercel
 * syncs are split Production / Preview, so pulling the wrong environment
 * produces a bundle that points at the wrong API and the wrong Supabase project
 * while every status page reports success. See the header of
 * `deploy-vercel.mjs`.
 */
export function vercelEnvironmentFor(target) {
  return target === VERCEL_TARGET_PRODUCTION ? "production" : "preview";
}

/** `vercel pull` — fetch project settings and the environment's variables. */
export function vercelPullArgs({ target }) {
  return ["pull", "--yes", `--environment=${vercelEnvironmentFor(target)}`];
}

/**
 * `vercel build` — produce `.vercel/output` from the checked-out tree.
 *
 * `--prod` is what makes the build compile against the Production environment
 * variables that `vercel pull --environment=production` just wrote. Omitting it
 * on the production path would build a preview bundle and then ship it to the
 * production hostname — the exact "promoted preview" failure the production
 * deploy path was written to prevent.
 */
export function vercelBuildArgs({ target }) {
  return target === VERCEL_TARGET_PRODUCTION ? ["build", "--prod"] : ["build"];
}

/**
 * `vercel deploy --prebuilt` — upload the output `vercel build` produced.
 *
 * `--yes` skips the interactive project-scope confirmation; a CI runner has no
 * one to answer it and the process would otherwise hang to its timeout.
 */
export function vercelDeployArgs({ target, sha, ref = "main" }) {
  const args = ["deploy", "--prebuilt", "--yes"];
  if (target === VERCEL_TARGET_PRODUCTION) args.push("--prod");
  if (sha) args.push("--meta", `githubCommitSha=${sha}`);
  if (ref) args.push("--meta", `githubCommitRef=${ref}`);
  return args;
}

/**
 * The deployment hostname the CLI printed, from its stdout.
 *
 * `vercel deploy` writes progress, the inspect URL and any warnings to stderr
 * and the deployment URL alone to stdout. "Alone" is not something to bet a
 * release on, so this picks deliberately rather than assuming there is exactly
 * one line.
 *
 * It takes the **FIRST** URL, and the direction matters. The deployment URL is
 * printed first; anything that follows is an alias or custom-domain line. An
 * alias is a *stable* hostname, and `GET /v13/deployments/{idOrUrl}` accepts a
 * hostname — so resolving one does not error, it silently returns whichever
 * deployment currently serves that domain. On the production path that is the
 * PREVIOUS release: `target` is `production` and the state is `READY`, so both
 * the target assertion and the poll pass and the run reports success having
 * verified a deployment it did not create. Taking the last URL would make a
 * future CLI version that prints "Aliased to https://frapp.live" into a silent
 * false green; taking the first cannot.
 *
 * The protocol and any trailing slash are stripped because every consumer wants
 * a hostname.
 *
 * Returns null when there is nothing that looks like a URL, which the caller
 * must treat as a failure — a deploy whose result cannot be identified cannot
 * be verified, and an unverifiable deploy is not a successful one.
 */
export function parseDeploymentHost(stdout) {
  if (typeof stdout !== "string") return null;

  const url = stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("https://"));

  if (!url) return null;

  return url.replace(/^https:\/\//, "").replace(/\/+$/, "");
}

/**
 * Run one command, capturing stdout and stderr.
 *
 * Injectable so the orchestration below is testable without spawning a real
 * Vercel CLI. `stdio` is piped rather than inherited so stdout can be parsed;
 * both streams are echoed through `logger` so a CI log still shows the build.
 */
export async function runCommandCapturing({ command, args, env, cwd, logger = console }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      logger.log?.(text.trimEnd());
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      logger.log?.(text.trimEnd());
    });

    child.on("error", reject);
    // `signal` is kept, not discarded. A child killed by a signal reports
    // `code: null`, and the exit-code check below still fires — but the message
    // would read "exited null" with no cause. The OOM killer taking `next build`
    // is the most common CI build failure of all, and moving both app builds
    // onto a runner is exactly what this change did, so SIGKILL is the one word
    // that turns an unreadable failure into an obvious one.
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

/**
 * The environment one Vercel CLI invocation runs with.
 *
 * Built explicitly from the ambient environment rather than mutating it, so two
 * projects deployed in the same process cannot inherit each other's
 * `VERCEL_PROJECT_ID` — the failure mode being that landing's build is uploaded
 * to the web project, which reports success everywhere.
 */
export function vercelCliEnv({ token, orgId, projectId, baseEnv = process.env }) {
  return {
    ...baseEnv,
    VERCEL_TOKEN: token,
    VERCEL_ORG_ID: orgId,
    VERCEL_PROJECT_ID: projectId,
  };
}

/** The `.vercel` directory the CLI reads and writes, for a working directory. */
export function vercelDirFor(cwd) {
  return path.join(cwd ?? process.cwd(), ".vercel");
}

/**
 * The filesystem operations the stash needs, injectable for tests.
 *
 * `move` is rename-first: on the runner `.vercel` and `$RUNNER_TEMP` are on one
 * filesystem and a rename is atomic and instant. `EXDEV` (a cross-device move)
 * falls back to copy-then-remove so a differently mounted temp dir still works
 * rather than failing the release over where the output happens to live.
 */
export const defaultStashFs = {
  async exists(p) {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  },
  async remove(p) {
    await rm(p, { recursive: true, force: true });
  },
  async move(from, to) {
    await mkdir(path.dirname(to), { recursive: true });
    try {
      await rename(from, to);
    } catch (error) {
      if (error?.code !== "EXDEV") throw error;
      await cp(from, to, { recursive: true });
      await rm(from, { recursive: true, force: true });
    }
  },
};

/** Run one CLI step, throwing on a non-zero exit with the tail of its output. */
async function runVercelStep({ label, args, env, cwd, cliCommand, runCommand, logger }) {
  logger.log?.(`[${label}] vercel ${args.join(" ")}`);
  const result = await runCommand({ command: cliCommand, args, env, cwd, logger });

  if (result.code !== 0) {
    // `killed by SIGKILL` rather than `exited null` when a signal ended it.
    // The OOM killer taking `next build` is the most common CI build failure
    // there is, and this change moved both app builds onto a runner — for
    // that case `code` is null and `signal` is the only word that says why.
    const how = result.signal ? `was killed by ${result.signal}` : `exited ${result.code}`;
    throw new Error(
      `[${label}] \`vercel ${args.join(" ")}\` ${how}. ` +
        `${(result.stderr || result.stdout || "").trim().slice(-500) || "No output."}`,
    );
  }

  return result;
}

/**
 * Pull and build ONE project. Uploads nothing.
 *
 * With `stashDir` set, the whole `.vercel` directory the build produced is moved
 * there afterwards, so a later `deployPrebuiltVercelProject` can upload exactly
 * this output — after other projects have built, and after other steps have run
 * in between. Without it the output is left in place for an immediate deploy,
 * which is what `buildAndDeployVercelProject` does.
 *
 * A non-zero exit from either step throws: a failed pull produces a build with
 * the wrong environment variables, and a failed build has nothing to upload.
 */
export async function buildVercelProject({
  target,
  token,
  orgId,
  projectId,
  label = projectId,
  cwd,
  stashDir = null,
  cliCommand = "vercel",
  runCommand = runCommandCapturing,
  stashFs = defaultStashFs,
  logger = console,
}) {
  const env = vercelCliEnv({ token, orgId, projectId });
  const common = { label, env, cwd, cliCommand, runCommand, logger };

  await runVercelStep({ ...common, args: vercelPullArgs({ target }) });
  await runVercelStep({ ...common, args: vercelBuildArgs({ target }) });

  if (stashDir) {
    const vercelDir = vercelDirFor(cwd);
    if (!(await stashFs.exists(vercelDir))) {
      throw new Error(
        `[${label}] \`vercel build\` exited 0 but left no ${vercelDir} to stash. ` +
          `Nothing would be uploaded later; refusing to call this build a success.`,
      );
    }
    // A stale stash from an earlier attempt must not be merged into — the
    // upload would then carry files from two different builds.
    await stashFs.remove(stashDir);
    await stashFs.move(vercelDir, stashDir);
    logger.log?.(`[${label}] Stashed the built output at ${stashDir}.`);
  }

  return { stashDir };
}

/**
 * Upload ONE project's already-built output, returning the deployment hostname.
 *
 * With `stashDir` set, that directory is moved back to `.vercel` first,
 * replacing whatever is there — on the production path that is the OTHER
 * project's leftovers, and uploading those would ship landing's bundle to the
 * web project while every status page reported success. A missing stash is a
 * hard failure, not a fall-through to whatever `.vercel` happens to hold, for
 * the same reason.
 */
export async function deployPrebuiltVercelProject({
  target,
  sha,
  ref = "main",
  token,
  orgId,
  projectId,
  label = projectId,
  cwd,
  stashDir = null,
  cliCommand = "vercel",
  runCommand = runCommandCapturing,
  stashFs = defaultStashFs,
  logger = console,
}) {
  if (stashDir) {
    if (!(await stashFs.exists(stashDir))) {
      throw new Error(
        `[${label}] No prebuilt output at ${stashDir}. The build phase for this project ` +
          `did not run or did not complete; refusing to upload whatever \`.vercel\` holds.`,
      );
    }
    const vercelDir = vercelDirFor(cwd);
    await stashFs.remove(vercelDir);
    await stashFs.move(stashDir, vercelDir);
    logger.log?.(`[${label}] Restored the built output from ${stashDir}.`);
  }

  const env = vercelCliEnv({ token, orgId, projectId });
  const result = await runVercelStep({
    label,
    env,
    cwd,
    cliCommand,
    runCommand,
    logger,
    args: vercelDeployArgs({ target, sha, ref }),
  });

  const host = parseDeploymentHost(result.stdout);
  if (!host) {
    throw new Error(
      `[${label}] \`vercel deploy\` exited 0 but printed no deployment URL, so there is ` +
        `nothing to verify. Refusing to report an unidentifiable deployment as a success.`,
    );
  }

  return { host };
}

/**
 * Pull, build and deploy ONE project, returning the deployment hostname.
 *
 * The single-phase form, used where nothing needs to happen between build and
 * upload (staging). Sequential by necessity: each step consumes the previous
 * one's output on disk.
 */
export async function buildAndDeployVercelProject(options) {
  await buildVercelProject({ ...options, stashDir: null });
  return deployPrebuiltVercelProject({ ...options, stashDir: null });
}
