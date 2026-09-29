#!/usr/bin/env node

// Decide what the staging deploy job (`_deploy.yml`, called by
// `deploy-staging.yml`) ships for this run's commit:
// whether it deploys the API, by comparing the commit with the one
// `frapp-api-staging` serves now (#2505), and whether it uploads web and
// landing, by comparing it with the commits the two staging hostnames serve
// (#2803).
//
// ── Why the served commit, not `HEAD~1` ─────────────────────────────────────
// Staging deploys only by commit from this job; Render auto-deploy must be off
// (staging-conformance asserts it; #2679 turns it off). So a deploy this job
// skips is one that never happens, and a gate that asks "did THIS push change
// the API?" skips too much:
//   * an API commit whose own CI failed or was replaced gets no Deploy staging run,
//     and the next push, if it touches no API path, diffs only itself;
//   * after a failed Render build, the next docs-only merge would skip, and the
//     Deploy staging alert would close on a run that deployed nothing.
// Asking "has anything the image is built from changed since what staging
// serves?" covers all of these: the diff runs from the served commit, so it
// carries every change that has not reached staging yet.
//
// ── Four verdicts ──────────────────────────────────────────────────────────
// The tip is `origin/main` as this job's checkout fetched it; when it can't be
// read, the run is treated as the tip.
//   deploy  — the tip, and something the image is built from changed since
//             the served commit: deploy it, then verify it is served and ready.
//   current — the tip, and nothing changed: verify the served commit is
//             ready, and let the run speak for staging.
//   forward — not the tip, but newer than the served commit and something
//             changed: deploy it anyway. `main` usually moves on while a run
//             waits for CI and for the run ahead of it, and the tip's own run
//             may never deploy (its CI can fail), so skipping this commit
//             would leave a green change unshipped with no alert. It deploys and
//             verifies like `deploy`; `deploy-alert.mjs` raises the alert if it
//             fails but never closes it, because the tip's run decides that.
//   stale   — not the tip, and nothing to move forward to: staging already
//             serves this commit or a newer one (deploying it would roll
//             staging back), nothing changed, or it can't tell. It deploys
//             no API, and `deploy-alert.mjs` leaves the alert alone. Web and
//             landing may still move forward (below).
//
// ── When it can't tell ─────────────────────────────────────────────────────
// For the tip, it deploys: an unreadable `/health`, a served commit git
// doesn't know, or an unreadable diff all mean "deploy", because a redundant
// deploy is cheap and a change that silently never ships is the #763 failure.
// For any other run it doesn't: without knowing what staging serves, a
// deploy could be a rollback, and the tip's run will deploy.
//
// ── Web and landing (#2803) ─────────────────────────────────────────────────
// The same job uploads web and landing after the API is verified, and the same
// two risks apply: uploading an older commit over a newer one, and skipping a
// green change whose tip run never comes. The API verdict can't answer for
// them. It reads only the paths the image is built from, so a web-only commit
// that isn't the tip plans `stale` though nothing newer is live. So the upload
// has its own rule, read against what `app.staging.frapp.live` and
// `staging.frapp.live` serve (each deployment's `meta.githubCommitSha`):
//   * nothing uploads unless the API staging will serve carries this commit's
//     API: it deploys it, or nothing the image is built from changed since the
//     served commit. That holds for the tip too, whose API plan is `stale`
//     when staging already serves a newer commit (auto-deploy, #2679);
//   * nothing uploads over a host that serves a newer commit, tip or not;
//   * the tip uploads when something web or landing is built from
//     (`FRONTEND_BUILD_PATHS`) changed since the commit either host serves, or
//     when it can't tell (a host it can't read, one on another history, a diff
//     that fails), like the tip's API;
//   * a re-run of the tip's run (`GITHUB_RUN_ATTEMPT` above 1) uploads even
//     when nothing changed: it is how a rotated build-time value (an Infisical
//     `NEXT_PUBLIC_*`) reaches staging, since the value is inlined at build;
//   * any other commit uploads only when both hosts serve commits strictly
//     older than it (a move forward, never a rollback) and something web or
//     landing is built from changed since them. A host it can't read, or one
//     on another history, means no upload: the tip's run uploads.
// A `stale` API plan can therefore still upload. Its verify step then checks
// the served commit, as for `current`, before the upload.
//
// The path gate exists for Vercel's storage (#2865): every upload is a new
// deployment of both projects, kept until `prune-vercel-staging.mjs` deletes
// it, and most merges (docs, the API, mobile) change neither app. Web and
// landing still upload as a pair, since the alias step points both hosts.
//
// Outputs (GITHUB_OUTPUT): `plan` (deploy|current|forward|stale), `deploy`
// (true|false), `upload` (true|false), `verify_sha` (the commit the verify
// step must find served; empty when nothing ships), `reason`, `upload_reason`.
// Unit tests: `scripts/ci/__tests__/plan-staging-deploy.test.mjs`.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { resolveDeploymentByHost } from "./deploy-vercel.mjs";
import { requireEnv } from "./lib/env.mjs";
import { resilientFetch } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

/**
 * Everything the API image is built from: the sources `apps/api/Dockerfile`
 * COPYs, plus the root `.dockerignore` that decides what reaches it.
 * `plan-staging-deploy.test.mjs` reads the Dockerfile and fails when a COPY
 * source is not matched here, which is how four packages the image builds went
 * unmatched before #2505.
 */
export const API_IMAGE_PATHS =
  /^(apps\/api\/|packages\/(validation|org-archetypes|chapter-theme|color|formatting|observability|typescript-config)\/|package\.json$|package-lock\.json$|\.dockerignore$)/;

/**
 * Everything web and landing are built from: both apps, every workspace
 * package (the apps import most of them, and a package's own imports reach
 * the rest), the root manifests `npm ci` installs from, the scripts the apps'
 * `build` and `prebuild` run, the deploy script and helpers that decide which
 * keys reach `vercel build`, and `_deploy.yml`, which pins the Node version
 * and the Vercel CLI the bundles are built with. `plan-staging-deploy.test.mjs` walks the
 * apps' build scripts and fails when a file they import is not matched here.
 */
export const FRONTEND_BUILD_PATHS =
  /^(apps\/(web|landing)\/|packages\/|package\.json$|package-lock\.json$|turbo\.json$|scripts\/(next-build|sync-brand-assets)\.mjs$|scripts\/lib\/brand-pixels\.mjs$|scripts\/ci\/deploy-vercel\.mjs$|scripts\/ci\/lib\/vercel-(cli|build-env)\.mjs$|\.github\/workflows\/_deploy\.yml$)/;

const SHA = /^[0-9a-f]{7,40}$/i;

const short = (sha) => sha.slice(0, 12);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * The pure decision. `tip` is `main`'s tip (null when unreadable).
 * `isAncestor(a, b)` answers whether `a` is `b` or an ancestor of it, and
 * `changedPaths(base, head)` lists the files between two commits; either may
 * throw, which reads as "can't tell".
 *
 * `readyApi` is the commit the API will serve that carries this commit's API:
 * `head` when it deploys, the served commit when nothing the image is built
 * from changed since it, and null otherwise. `planFrontendUpload` reads it.
 */
export function planStagingDeploy({ head, served, tip, isAncestor, changedPaths }) {
  const isTip = !tip || same(tip, head);
  const notTip = () => `\`main\` has moved on to ${short(tip)}`;
  const stale = (reason, readyApi = null) => ({ plan: "stale", deploy: false, verifySha: "", readyApi, reason });
  // Deploy when the tip, or move forward when not; unsure is a deploy only for the tip.
  const deploy = (reason) =>
    isTip
      ? { plan: "deploy", deploy: true, verifySha: head, readyApi: head, reason }
      : {
          plan: "forward",
          deploy: true,
          verifySha: head,
          readyApi: head,
          reason: `${reason}; ${notTip()}, so its run decides the alert`,
        };
  const unsure = (reason) => (isTip ? deploy(`${reason}, so deploying`) : stale(`${reason} and ${notTip()}, so not risking a rollback`));
  const current = (reason) =>
    isTip
      ? { plan: "current", deploy: false, verifySha: served, readyApi: served, reason }
      : stale(`${reason}; ${notTip()}`, served);

  if (!served || !SHA.test(served)) {
    return unsure("staging's served commit could not be read");
  }
  if (same(served, head)) return current(`staging already serves ${short(head)}`);

  let headIsOlder;
  let servedIsOlder;
  try {
    headIsOlder = isAncestor(head, served);
    servedIsOlder = isAncestor(served, head);
  } catch {
    return unsure(`git could not relate ${short(served)} (served) to ${short(head)}`);
  }

  if (headIsOlder) {
    return stale(
      `staging serves ${short(served)}, which already contains ${short(head)}; deploying ` +
        `${short(head)} would roll staging back`,
    );
  }
  if (!servedIsOlder) {
    return unsure(`staging serves ${short(served)}, which is not on this commit's history`);
  }

  let paths;
  try {
    paths = changedPaths(served, head);
  } catch {
    return unsure(`could not diff ${short(served)}..${short(head)}`);
  }
  const imagePaths = paths.filter((path) => API_IMAGE_PATHS.test(path));
  if (imagePaths.length > 0) {
    return deploy(
      `${imagePaths.length} file(s) the API image is built from changed since ${short(served)} ` +
        `(first: ${imagePaths[0]})`,
    );
  }
  return current(`nothing the API image is built from changed since ${short(served)}`);
}

/**
 * Whether this run uploads web and landing. Nothing uploads unless the API
 * staging will serve carries this commit's API (`api.readyApi`), which the
 * verify step then checks before anything ships, and nothing uploads over a
 * host that serves a newer commit. Given that, the tip uploads when something
 * in `FRONTEND_BUILD_PATHS` changed since what either host serves, when it
 * can't tell, or when `rerun` (a re-run of the tip's run, which is how a
 * rotated build-time value reaches staging). Any other commit uploads only
 * when every host serves a commit strictly older than it and something
 * changed since. `live` is `[{ host, sha, error? }]` from the staging
 * hostnames (`sha` null when unread), or null when not read; `changedPaths`
 * is `planStagingDeploy`'s and may throw.
 *
 * Returns `{ upload, uploadReason, verifySha }`. `verifySha` is `readyApi`
 * whenever it uploads (a `stale` API plan that uploads verifies the served
 * commit, as `current` does), and the API plan's own otherwise.
 */
export function planFrontendUpload({ head, tip, api, live, isAncestor, changedPaths, rerun = false }) {
  const isTip = !tip || same(tip, head);
  const upload = (uploadReason) => ({ upload: true, uploadReason, verifySha: api.readyApi });
  const skip = (why, { tipsRun = !isTip } = {}) => ({
    upload: false,
    uploadReason: tipsRun ? `${why}; \`main\` has moved on to ${short(tip)}, so its run uploads` : why,
    verifySha: api.verifySha,
  });
  // Even for the tip: staging can serve a newer commit than the tip this
  // checkout fetched (Render auto-deploy still on, #2679), and uploading then
  // would ship frontends behind an API nobody verified.
  if (!api.readyApi) {
    // `api.reason` already says whether `main` moved on; no second suffix.
    return {
      upload: false,
      uploadReason: `no API that carries this commit's API is known to be ready (API plan: ${api.reason})`,
      verifySha: api.verifySha,
    };
  }
  if (!Array.isArray(live) || live.length === 0) {
    const why = "what the staging hostnames serve was not read";
    return isTip ? upload(`${why}, and this is \`main\`'s tip, so shipping`) : skip(why);
  }

  // One verdict per host; the diff is shared when both serve the same commit.
  const diffs = new Map();
  const frontendChangesSince = (sha) => {
    const key = sha.toLowerCase();
    if (!diffs.has(key)) diffs.set(key, changedPaths(sha, head).filter((path) => FRONTEND_BUILD_PATHS.test(path)));
    return diffs.get(key);
  };
  const verdicts = live.map(({ host, sha, error }) => {
    if (!sha || !SHA.test(sha)) {
      return { host, kind: "unsure", why: `the commit ${host} serves could not be read${error ? ` (${error})` : ""}` };
    }
    if (same(sha, head)) return { host, kind: "same", why: `${host} already serves ${short(sha)}` };
    let hostIsNewer;
    let hostIsOlder;
    try {
      hostIsNewer = isAncestor(head, sha);
      hostIsOlder = isAncestor(sha, head);
    } catch {
      return { host, kind: "unsure", why: `git could not relate ${short(sha)} (${host}) to ${short(head)}` };
    }
    if (hostIsNewer) return { host, kind: "newer", why: `${host} already serves ${short(sha)}, which contains ${short(head)}` };
    if (!hostIsOlder) return { host, kind: "unsure", why: `${host} serves ${short(sha)}, which is not on this commit's history` };
    let changed;
    try {
      changed = frontendChangesSince(sha);
    } catch {
      return { host, kind: "unsure", why: `could not diff ${short(sha)}..${short(head)} for ${host}` };
    }
    return changed.length > 0
      ? { host, kind: "changed", sha, why: `${changed.length} file(s) web and landing are built from changed since ${short(sha)} (${host}; first: ${changed[0]})` }
      : { host, kind: "unchanged", sha, why: `nothing web and landing are built from changed since ${short(sha)} (${host})` };
  });
  const first = (kind) => verdicts.find((verdict) => verdict.kind === kind);

  // Never over a newer commit: that host's run already shipped past this one.
  const newer = first("newer");
  if (newer) return skip(newer.why, { tipsRun: false });

  if (!isTip) {
    const blocker = first("unsure") ?? first("same");
    if (blocker) return skip(blocker.why);
    const changed = first("changed");
    if (!changed) return skip(verdicts.map((verdict) => verdict.why).join("; "), { tipsRun: false });
    return upload(
      `${live.map(({ host, sha }) => `${host} serves ${short(sha)}`).join(" and ")}, older than ${short(head)}, ` +
        `and ${changed.why}; \`main\` has moved on to ${short(tip)}, whose run may never deploy (its CI can fail), ` +
        "so moving them forward",
    );
  }

  if (rerun) return upload("this is a re-run of `main`'s tip, so its web and landing ship again (a rotated build-time value reaches staging this way)");
  const reason = first("unsure") ?? first("changed");
  if (reason) return upload(`${reason.why}, and this is \`main\`'s tip, so its web and landing ship`);
  return skip(verdicts.map((verdict) => verdict.why).join("; "));
}

/**
 * The commit each staging hostname serves, read from its deployment's
 * `meta.githubCommitSha` (`vercel-cli.mjs` sets it on every upload). A host
 * that can't be read comes back with `sha: null` and the `error` that says
 * why (a revoked key reads differently from an unaliased host), never a throw.
 */
export async function readStagingFrontends(hosts, { apiKey, teamId, fetchImpl = resilientFetch }) {
  return Promise.all(
    hosts.map(async (host) => {
      try {
        const { sha } = await resolveDeploymentByHost({ apiKey, host, teamId, fetchImpl });
        return { host, sha };
      } catch (error) {
        return { host, sha: null, error: String(error?.message ?? error).slice(0, 200) };
      }
    }),
  );
}

/** `a` is `b` or an ancestor of it. Throws when git can't answer (an unknown commit). */
export function gitIsAncestor(a, b, { exec = execFileSync } = {}) {
  try {
    exec("git", ["merge-base", "--is-ancestor", a, b], { stdio: "ignore" });
    return true;
  } catch (error) {
    if (error?.status === 1) return false;
    throw error;
  }
}

/**
 * Both sides of a rename, as literal paths. `--no-renames` lists a file moved
 * out of `apps/api/` under its old path too (with renames on, only the new
 * one), and `-z` with `core.quotePath=false` keeps a non-ASCII path from
 * coming back quoted, where an anchored pattern would miss it.
 */
export function gitChangedPaths(base, head, { exec = execFileSync } = {}) {
  return exec("git", ["-c", "core.quotePath=false", "diff", "--no-renames", "--name-only", "-z", base, head], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

/** The commit `ref` names, or null when git can't resolve it. */
export function gitResolve(ref, { exec = execFileSync } = {}) {
  try {
    return exec("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/** The commit `/health` reports, or null when it can't be read. `/health` answers even when degraded. */
export async function readServedCommit(healthUrl, { fetchImpl = resilientFetch } = {}) {
  try {
    const response = await fetchImpl(healthUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.commit === "string" ? body.commit : null;
  } catch {
    return null;
  }
}

/**
 * The step outputs `_deploy.yml` reads: `plan`, `deploy`, `upload`,
 * `verify_sha`. `reason` quotes a changed path, which git (with `-z`,
 * unquoted) can hand back containing a newline; written raw, that would start
 * a new output line such as `plan=stale`. Control characters become spaces.
 */
export function formatPlanOutputs(plan, frontends) {
  // eslint-disable-next-line no-control-regex
  const oneLine = (text) => String(text).replace(/[\u0000-\u001f\u007f]/g, " ");
  return (
    `plan=${plan.plan}\ndeploy=${plan.deploy}\nupload=${frontends.upload}\n` +
    `verify_sha=${frontends.verifySha}\nreason=${oneLine(plan.reason)}\n` +
    `upload_reason=${oneLine(frontends.uploadReason)}\n`
  );
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const head = requireEnv("DEPLOY_SHA");
  const healthUrl = requireEnv("API_HEALTHCHECK_URL", {
    hint: "It comes from Infisical (docs/internal/environment/SECRETS_MANAGEMENT.md).",
  });
  const apiKey = requireEnv("VERCEL_API_KEY");
  const teamId = requireEnv("VERCEL_TEAM_ID");
  const hosts = requireEnv("VERCEL_STAGING_HOSTS").split(/\s+/).filter(Boolean);
  const served = await readServedCommit(healthUrl);
  // `origin/main` as the checkout fetched it (full history). TIP_REF exists for
  // the tests, which run on branches whose `origin/main` is elsewhere.
  const tip = gitResolve(process.env.TIP_REF || "origin/main");
  const isAncestor = (a, b) => gitIsAncestor(a, b);
  const plan = planStagingDeploy({
    head,
    served,
    tip,
    isAncestor,
    changedPaths: (base, tip) => gitChangedPaths(base, tip),
  });
  // Only a commit whose API is ready can upload, so only then are the hosts read.
  const live = plan.readyApi ? await readStagingFrontends(hosts, { apiKey, teamId }) : null;
  // GitHub sets it on every step; a caller's re-run of the whole workflow raises it.
  const rerun = Number(process.env.GITHUB_RUN_ATTEMPT ?? "1") > 1;
  const frontends = planFrontendUpload({
    head,
    tip,
    api: plan,
    live,
    isAncestor,
    changedPaths: (base, tip) => gitChangedPaths(base, tip),
    rerun,
  });

  console.log(`Plan for ${head}: ${plan.plan} — ${plan.reason}.`);
  console.log(`Web and landing: ${frontends.upload ? "upload" : "no upload"} — ${frontends.uploadReason}.`);
  console.log(`Verify before shipping: ${frontends.verifySha || "nothing ships"}.`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, formatPlanOutputs(plan, frontends));
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Staging deploy plan\n\n**${plan.plan}** for \`${head}\`: ${plan.reason}.\n\n` +
        `Web and landing: **${frontends.upload ? "upload" : "no upload"}**, ${frontends.uploadReason}.\n\n` +
        `API to verify before anything ships: ${frontends.verifySha ? `\`${frontends.verifySha}\`` : "none, since nothing ships"}.\n`,
    );
  }
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
