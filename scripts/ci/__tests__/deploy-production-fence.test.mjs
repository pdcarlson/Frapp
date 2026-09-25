// The replay/apply fence in `.github/workflows/deploy-production.yml`.
//
// The fence is inline shell in a workflow file, so it has no unit-test seam of
// its own. These tests extract the step's script straight out of the YAML — the
// same approach `deploy-api-check-changes.test.mjs` uses — and run it against
// real directory state in a throwaway git repo.
//
// ── What it is protecting ───────────────────────────────────────────────────
// `check-migration-replay.mjs` MOVES pending migrations into
// `supabase/.migrations-replay-parked/` and restores them in a `finally`. A
// `finally` survives a thrown error; it does not survive SIGKILL — job
// cancellation, a runner timeout, the OOM killer.
//
// In `migration-drift-gate.yml` that is harmless: a throwaway runner that never
// speaks to production. In `deploy-production.yml` the very next step runs
// `supabase db push` against the real database, and `run-migration.mjs` counts
// the BASELINE files still on disk, sees a non-zero total, does not bail, pushes
// NOTHING, and prints "Migrations applied successfully".
//
// A production deploy reporting "migrations applied" having applied zero is
// worse than one that fails, which is why this fence exists and why it is its
// own step rather than a line inside a larger one.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "deploy-production.yml");

const STEP_NAME = "Fence — the working tree must be intact before anything is applied";
const SHA = "0ca478e9105105ff7013834615eee81499813d0e";

/** Pull a named step's `run:` block out of the workflow, as text. */
function extractStepScript(stepName) {
  const lines = readFileSync(WORKFLOW, "utf8").split("\n");

  const stepIndex = lines.findIndex((line) =>
    line.trim() === `- name: ${stepName}`,
  );
  assert.notEqual(stepIndex, -1, `step "${stepName}" not found in deploy-production.yml`);

  // Bounded by the NEXT step, not by the end of the file. Unbounded, a step
  // with no `run: |` of its own silently binds to a LATER step's script and
  // every assertion about it passes vacuously — the fail-open shape
  // `helpers/workflow-yaml.mjs` was written to stop, which this file would
  // otherwise still carry while importing the fix. Every step extracted here
  // has its own `run: |` today, so this is latent; it is guarded because the
  // failure is silent and green.
  const nextStepIndex = lines.findIndex((line, i) => i > stepIndex && /^\s{6}- name:\s*/.test(line));
  const limit = nextStepIndex === -1 ? lines.length : nextStepIndex;
  const runIndex = lines.findIndex(
    (line, i) => i > stepIndex && i < limit && /^\s*run: \|\s*$/.test(line),
  );
  assert.notEqual(runIndex, -1, `step "${stepName}" has no \`run: |\` block`);

  const runIndent = lines[runIndex].match(/^\s*/)[0].length;
  const body = [];
  for (let i = runIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= runIndent) break;
    body.push(line.slice(runIndent + 2));
  }
  return body.join("\n");
}

let workspace;
let scriptPath;

/**
 * A throwaway git repo holding a committed `supabase/migrations/` tree, so
 * `git status --porcelain -- supabase/` is meaningful.
 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "fence-"));
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true });
  for (const name of ["20260101000000_a.sql", "20260102000000_b.sql"]) {
    writeFileSync(join(dir, "supabase", "migrations", name), "select 1;\n");
  }
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("add", "-A");
  git("commit", "-qm", "seed");
  return dir;
}

/** Run the extracted fence in `dir`. Returns `{ code, output }`. */
function runFence(dir, env = {}) {
  try {
    const output = execFileSync("bash", [scriptPath], {
      cwd: dir,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, SUPABASE_DB_PASSWORD: "hunter2", ...env },
    });
    return { code: 0, output };
  } catch (error) {
    return {
      code: error.status ?? 1,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
}

before(() => {
  workspace = mkdtempSync(join(tmpdir(), "fence-script-"));
  scriptPath = join(workspace, "fence.sh");
  writeFileSync(scriptPath, extractStepScript(STEP_NAME));
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("the replay/apply fence", () => {
  // The negative control, and it matters more than the positive ones: a fence
  // that always fails would pass every test below while blocking every deploy.
  it("passes on a clean tree", () => {
    const dir = makeRepo();
    try {
      const { code, output } = runFence(dir);
      assert.equal(code, 0, output);
      assert.match(output, /Fence holds/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when the parked directory survived the replay", () => {
    const dir = makeRepo();
    try {
      // What a SIGKILL between `parkPending` and `restoreParked` leaves behind.
      mkdirSync(join(dir, "supabase", ".migrations-replay-parked"));
      writeFileSync(
        join(dir, "supabase", ".migrations-replay-parked", "20260102000000_b.sql"),
        "select 1;\n",
      );
      rmSync(join(dir, "supabase", "migrations", "20260102000000_b.sql"));

      const { code, output } = runFence(dir);
      assert.equal(code, 1);
      assert.match(output, /migrations-replay-parked still exists/);
      assert.match(output, /incomplete set/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The nastier half. If something removed the parked directory but the files
  // never came back, the first check passes and only the `git status` check
  // catches it — as ` D supabase/migrations/*.sql` deletions. This is why the
  // status check is scoped to `supabase/`, not just the parked path.
  it("fails when migrations are missing even though the parked directory is gone", () => {
    const dir = makeRepo();
    try {
      rmSync(join(dir, "supabase", "migrations", "20260102000000_b.sql"));

      const { code, output } = runFence(dir);
      assert.equal(code, 1);
      assert.match(output, /working tree under supabase\/ is dirty/);
      assert.match(output, /20260102000000_b\.sql/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on any other dirt under supabase/", () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "supabase", "config.toml"), "rewritten\n");
      const { code, output } = runFence(dir);
      assert.equal(code, 1);
      assert.match(output, /working tree under supabase\/ is dirty/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Asserted BEFORE `supabase stop`, so a missing secret fails while the stack
  // a re-run would need is still up.
  it("fails when SUPABASE_DB_PASSWORD is empty", () => {
    const dir = makeRepo();
    try {
      const { code, output } = runFence(dir, { SUPABASE_DB_PASSWORD: "" });
      assert.equal(code, 1);
      assert.match(output, /SUPABASE_DB_PASSWORD is not set/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the confirmation-phrase step", () => {
  const CONFIRM_STEP = "Verify confirmation phrase";

  function runConfirm(confirm) {
    const path = join(workspace, "confirm.sh");
    writeFileSync(path, extractStepScript(CONFIRM_STEP).replace(/\$\{\{[^}]*\}\}/g, ""));
    try {
      const output = execFileSync("bash", [path], {
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, CONFIRM: confirm },
      });
      return { code: 0, output };
    } catch (error) {
      return { code: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
    }
  }

  it("accepts the exact phrase", () => assert.equal(runConfirm("DEPLOY TO PRODUCTION").code, 0));
  it("rejects a near miss", () => assert.equal(runConfirm("deploy to production").code, 1));
  it("rejects trailing whitespace", () => assert.equal(runConfirm("DEPLOY TO PRODUCTION ").code, 1));
  it("rejects an empty confirmation", () => assert.equal(runConfirm("").code, 1));

  // The step is first in the job precisely so a typo costs nothing: it must not
  // reference a secret, or the run has already asked for one before failing.
  it("references no secret, so a typo costs nothing", () => {
    const source = extractStepScript(CONFIRM_STEP);
    assert.ok(!/secrets\./.test(source));
  });
});

describe("the SHA-trim step (run 34234768094)", () => {
  const TRIM_STEP = "Trim the SHA";

  function runTrim(raw) {
    const path = join(workspace, "trim-sha.sh");
    writeFileSync(path, extractStepScript(TRIM_STEP).replace(/\$\{\{[^}]*\}\}/g, ""));
    const outFile = join(workspace, "sha-output.txt");
    try {
      const output = execFileSync("bash", [path], {
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, RAW_SHA: raw, GITHUB_OUTPUT: outFile },
      });
      return {
        code: 0,
        output,
        githubOutput: readFileSync(outFile, "utf8"),
      };
    } catch (error) {
      return {
        code: error.status ?? 1,
        output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
        githubOutput: "",
      };
    }
  }

  it("strips a trailing space from a pasted SHA", () => {
    const { code, githubOutput } = runTrim(`${SHA} `);
    assert.equal(code, 0);
    assert.match(githubOutput, new RegExp(`^sha=${SHA}$`, "m"));
  });

  it("strips a trailing newline", () => {
    const { code, githubOutput } = runTrim(`${SHA}\n`);
    assert.equal(code, 0);
    assert.match(githubOutput, new RegExp(`^sha=${SHA}$`, "m"));
  });

  it("does not smash an internal space", () => {
    const { code, githubOutput } = runTrim("abc def");
    assert.equal(code, 0);
    assert.match(githubOutput, /^sha=abc def$/m);
  });

  // Later steps must consume the trimmed output. Assigning `inputs.sha` again
  // would reintroduce the trailing space that killed 34234768094.
  it("no later DEPLOY_SHA assignment reads inputs.sha", () => {
    const text = readFileSync(WORKFLOW, "utf8");
    const trimAt = text.indexOf("- name: Trim the SHA");
    assert.notEqual(trimAt, -1);
    const after = text.slice(trimAt);
    assert.doesNotMatch(after, /DEPLOY_SHA:\s*\$\{\{\s*inputs\.sha\s*\}\}/);
    assert.match(after, /DEPLOY_SHA:\s*\$\{\{\s*steps\.sha\.outputs\.sha\s*\}\}/);
    assert.match(text, /sha:\s*\$\{\{\s*needs\.deploy\.outputs\.sha\s*\}\}/);
  });

  // The assertion above is satisfied by a SINGLE match anywhere in the file, so it
  // stayed green for the whole life of the Vercel BUILD step while that step passed
  // no DEPLOY_SHA at all — the upload step's copy was carrying it. Run 34892839657
  // is what that produced: "DEPLOY_SHA environment variable is required", after the
  // reviewer approval, the `npm ci` and the Vercel CLI install.
  //
  // The per-call-site guard #2265 added here has MOVED to
  // `deploy-vercel-env-contract.test.mjs`, generalised rather than dropped: it now
  // asserts every variable `deploy-vercel.mjs` requires for a call site's phase
  // (read from that script's own table, so the two cannot drift), across every
  // workflow that invokes it rather than this one — the staging caller had the same
  // exposure and nothing looking at it. The exact #2265 case is pinned by name there
  // so this file's loss of it cannot go unnoticed. Kept as a pointer rather than a
  // second copy: one canonical owner per fact.
});

// ── The other half of the #2265 shape ──────────────────────────────────────
//
// `no later DEPLOY_SHA assignment reads inputs.sha` above is two assertions.
// The NEGATIVE half is strong: it fails if ANY occurrence after the trim reads
// `inputs.sha`. The POSITIVE half — that some step reads the trimmed output —
// is a whole-region grep satisfied by a single match, and five steps satisfy
// it, so four of them could lose their `DEPLOY_SHA` with the suite still green.
//
// That is the identical shape #2265 fixed for the Vercel build step, still
// standing for the other four. The worst of them is `Deploy the commit to
// Render`: `deploy-render-commit.mjs` calls `requireEnv("DEPLOY_SHA")`, the
// step runs AFTER `Run migrations (apply)`, and it is gated
// `!inputs.dry_run_only` — so no dry run reaches it even now that the rehearsal
// is wider. A regression there fails a production run with the database already
// migrated.
//
// So: assert per STEP, over every step that passes the value.
describe("DEPLOY_SHA is sourced per step, not somewhere in the file", () => {
  const steps = () => workflowSteps(WORKFLOW);
  const carriers = () => steps().filter((step) => step.env.has("DEPLOY_SHA"));

  // A loop over an empty list passes. If the reader ever stops recognising
  // these steps, the assertions below would go quietly green.
  it("finds every step that passes DEPLOY_SHA", () => {
    assert.ok(
      carriers().length >= 5,
      `expected at least 5 steps passing DEPLOY_SHA, found ${carriers().length}: ` +
        `${carriers().map((s) => s.name).join(", ") || "none"}`,
    );
  });

  it("gives every one of them the trimmed output, never inputs.sha", () => {
    for (const step of carriers()) {
      assert.equal(
        step.env.get("DEPLOY_SHA"),
        "${{ steps.sha.outputs.sha }}",
        `step "${step.name}" (job ${step.jobId}) passes DEPLOY_SHA as ` +
          `"${step.env.get("DEPLOY_SHA")}" rather than the trimmed validated output`,
      );
    }
  });

  // Named explicitly because this one runs after the apply, and because no dry
  // run executes it — its only protection is this assertion.
  it("the Render deploy step passes DEPLOY_SHA, and it runs after the apply", () => {
    const render = steps().find((s) => s.name === "Deploy the commit to Render");
    assert.ok(render, "the Render deploy step is missing");
    assert.equal(render.env.get("DEPLOY_SHA"), "${{ steps.sha.outputs.sha }}");

    const names = steps().map((s) => s.name);
    assert.ok(
      names.indexOf("Run migrations (apply)") < names.indexOf("Deploy the commit to Render"),
      "the Render deploy is expected to run after the migration apply",
    );
  });
});

// ── What the dry run rehearses, held in place ──────────────────────────────
//
// Nothing in this suite asserted the workflow's `if:` conditions before, which
// left the whole rehearsal/ship split unguarded in both directions: the three
// build steps could silently go back to being dry-run-skipped, or the shipping
// steps could silently start running on a dry run. The first quietly undoes the
// coverage; the second deploys from a run whose entire contract is that it
// deploys nothing.
describe("the dry run rehearses the build and ships nothing", () => {
  const byName = () => new Map(workflowSteps(WORKFLOW).map((step) => [step.name, step]));

  // Run on a dry run, skipped only for migrations-only.
  const REHEARSED = [
    "Install dependencies for the Vercel build",
    "Install Vercel CLI",
    "Build the Vercel production bundles (web + landing)",
  ];

  // Never run on a dry run. Each one writes to production or costs a release.
  const SHIPPING = [
    "Run migrations (apply)",
    "Deploy the commit to Render",
    "Deploy the commit to Vercel production (web + landing)",
  ];

  for (const name of REHEARSED) {
    it(`"${name}" runs on a dry run`, () => {
      const step = byName().get(name);
      assert.ok(step, `step "${name}" not found`);
      assert.doesNotMatch(
        step.if ?? "",
        /dry_run_only/,
        `step "${name}" is gated on dry_run_only again; the dry run stops rehearsing the ` +
          `Vercel build, which is the half that failed on runs 34892839657, 34894763676 and 34896647837`,
      );
      // The other half of the gate must stay: a migrations-only run builds nothing.
      assert.match(step.if ?? "", /inputs\.scope != 'migrations-only'/);
    });
  }

  for (const name of SHIPPING) {
    it(`"${name}" never runs on a dry run`, () => {
      const step = byName().get(name);
      assert.ok(step, `step "${name}" not found`);
      assert.match(
        step.if ?? "",
        /!inputs\.dry_run_only/,
        `step "${name}" would run on a dry run — a dry run must apply nothing and deploy nothing`,
      );
    });
  }

  // Steps are not the whole story. `release` mints and PUSHES the `vX.Y.Z` tag,
  // and it is gated at JOB level, so nothing above can see it. #1340 redefined
  // that tag to mean "this is what is live"; a dry run that tagged would restore
  // the exact meaning it was redefined to remove, and `report` would exit 0
  // because RELEASE_RESULT came back `success`.
  it("the release job, which pushes the version tag, never runs on a dry run", () => {
    const release = workflowJobs(WORKFLOW).find((job) => job.jobId === "release");
    assert.ok(release, "the release job is missing");
    assert.match(
      release.if ?? "",
      /!inputs\.dry_run_only/,
      "the release job would mint a vX.Y.Z tag on a dry run, for a commit that was never deployed",
    );
    assert.match(release.if ?? "", /inputs\.scope != 'migrations-only'/);
  });

  // The Sentry guard's whole wiring is this one `env:` key. Nothing outside the
  // step's `run:` block references it, so a tidy-up that deleted it as unused
  // would leave `${DRY_RUN:-}` permanently empty, the `unset` would never fire,
  // and every dry run would build with the real token — with the suite green.
  it("the build step wires DRY_RUN from the input the Sentry guard reads", () => {
    const build = byName().get("Build the Vercel production bundles (web + landing)");
    assert.ok(build, "the Vercel build step is missing");
    assert.equal(build.stepEnv.get("DRY_RUN"), "${{ inputs.dry_run_only }}");
  });
});

// The Vercel BUILD step runs on a dry run as well as on a real ship, which is
// what makes "dry run: green" mean the frontends compile. That is only safe
// while the build stays inert, and it has exactly one way not to be: both
// `next.config.js` files hand `process.env.SENTRY_AUTH_TOKEN` to
// `withSentryConfig` with `release: sentryGitSha`, `vercelCliEnv` spreads
// `process.env` into the build subprocess, and the Infisical `prod` inject puts
// the whole prod secret set into this job's environment. With that token
// present a dry run would create a Sentry release, and upload source maps, for
// a commit that is not being deployed.
//
// Whether the token is in Infisical `prod` is recorded in
// docs/internal/environment/ENV_REFERENCE.md § apps/api; wherever it is, this gap
// is live, not latent. That is precisely why it needs a test: nothing else would
// go red when the token reaches the job.
describe("the dry-run Sentry guard on the Vercel build step", () => {
  const BUILD_STEP = "Build the Vercel production bundles (web + landing)";

  /** The step's script, with the real deploy swapped for a probe. */
  function runBuildStep(dryRun) {
    const path = join(workspace, "build-step.sh");
    const script = extractStepScript(BUILD_STEP)
      .replace(/\$\{\{[^}]*\}\}/g, "")
      .replace(
        "node scripts/ci/deploy-vercel.mjs",
        'printf "token=%s\\n" "${SENTRY_AUTH_TOKEN-__UNSET__}"',
      );
    writeFileSync(path, script);
    try {
      return execFileSync("bash", [path], {
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, DRY_RUN: dryRun, SENTRY_AUTH_TOKEN: "sntrys_realtoken" },
      });
    } catch (error) {
      return `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }
  }

  it("clears SENTRY_AUTH_TOKEN on a dry run, so no release is minted", () => {
    const output = runBuildStep("true");
    assert.match(output, /token=__UNSET__/);
    assert.doesNotMatch(output, /sntrys_realtoken/);
  });

  // The other half, and the one that makes the test above mean something: a
  // guard that cleared the token unconditionally would pass that assertion while
  // silently stopping every real production release from reaching Sentry.
  it("leaves SENTRY_AUTH_TOKEN alone on a real ship", () => {
    assert.match(runBuildStep("false"), /token=sntrys_realtoken/);
  });
});

describe("SHA validation runs before the production environment (run 34234768094)", () => {
  function jobBody(jobId) {
    const text = readFileSync(WORKFLOW, "utf8");
    const start = text.indexOf(`\n  ${jobId}:\n`);
    assert.notEqual(start, -1, `job ${jobId} missing`);
    const from = start + 1;
    const next = text.slice(from + 1).search(/\n  [a-z][a-z0-9_-]*:\n/);
    return next === -1 ? text.slice(from) : text.slice(from, from + 1 + next);
  }

  function uncommented(body) {
    return body
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
  }

  it("validate has no environment, so a bad paste cannot open a reviewer gate", () => {
    const body = uncommented(jobBody("validate"));
    assert.match(body, /name: Confirm and validate the SHA/);
    assert.doesNotMatch(body, /^\s+environment:/m);
    assert.match(body, /- name: Verify confirmation phrase/);
    assert.match(body, /- name: Validate the commit/);
    assert.match(body, /- name: Trim the SHA/);
    assert.match(body, /outputs:\s*\n\s+sha:\s*\$\{\{\s*steps\.sha\.outputs\.sha\s*\}\}/);
    assert.doesNotMatch(uncommented(jobBody("deploy")), /- name: Verify confirmation phrase/);
  });

  it("deploy needs validate and is the only production-environment job", () => {
    const deploy = uncommented(jobBody("deploy"));
    assert.match(deploy, /^\s+needs: validate$/m);
    assert.match(deploy, /^\s+environment: production$/m);

    const text = uncommented(readFileSync(WORKFLOW, "utf8"));
    const envHits = [...text.matchAll(/^\s+environment: production\s*$/gm)];
    assert.equal(
      envHits.length,
      1,
      "a second environment: production job would cost a second Approve click",
    );
  });

  it("the shipping job records needs.validate.outputs.sha, not inputs.sha", () => {
    const script = extractStepScript("Record the validated SHA");
    assert.match(script, /echo "sha=\$SHA" >> "\$GITHUB_OUTPUT"/);
    assert.match(uncommented(jobBody("deploy")), /SHA:\s*\$\{\{\s*needs\.validate\.outputs\.sha\s*\}\}/);
    assert.doesNotMatch(script, /inputs\.sha/);
  });
});
