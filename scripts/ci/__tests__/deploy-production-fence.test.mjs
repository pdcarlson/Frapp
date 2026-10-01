// Production's deploy: `.github/workflows/deploy-production.yml`, which
// confirms, validates and reports, and the job it calls, `_deploy.yml`, whose
// steps named `inputs.environment == 'production'` are production's layers
// (#2805). Named for the replay/apply fence, its first subject.
//
// The fence is inline shell in a workflow file, so it has no unit-test seam of
// its own. These tests extract the step's script straight out of the YAML — the
// approach the retired `deploy-api-check-changes.test.mjs` took — and run it against
// real directory state in a throwaway git repo.
//
// ── What it is protecting ───────────────────────────────────────────────────
// `check-migration-replay.mjs` MOVES pending migrations into
// `supabase/.migrations-replay-parked/` and restores them in a `finally`. A
// `finally` survives a thrown error; it does not survive SIGKILL — job
// cancellation, a runner timeout, the OOM killer.
//
// In `migration-drift-gate.yml` that is harmless: a throwaway runner that never
// speaks to production. In production's deploy job the apply runs
// `supabase db push` against the real database, and `run-migration.mjs` counts
// the BASELINE files still on disk, sees a non-zero total, does not bail, pushes
// NOTHING, and prints "Migrations applied successfully".
//
// A production deploy reporting "migrations applied" having applied zero is
// worse than one that fails, which is why this fence exists and why it is its
// own step rather than a line inside a larger one.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { ALERT_ROUTING } from "../lib/ops-docs.mjs";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { ALERT_CONFIGS } from "../deploy-alert.mjs";
import { workflowFiles, workflowJobs, workflowKeys, workflowSteps } from "./helpers/workflow-yaml.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// The dispatch: confirmation, validation, the call, the tag and the report.
const CALLER = join(REPO_ROOT, ".github", "workflows", "deploy-production.yml");
// The job it calls, shared with staging since #2805.
const SHARED = join(REPO_ROOT, ".github", "workflows", "_deploy.yml");
const fileName = (path) => path.split("/").pop();
const INPUT_SHA = "${{ inputs.sha }}";
const VALIDATED_SHA = "${{ needs.validate.outputs.sha }}";

const withoutComments = (text) =>
  text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
const sharedSteps = () => workflowSteps(SHARED).filter((s) => s.jobId === "deploy");
const callerJob = (id) => {
  const found = workflowJobs(CALLER).find((job) => job.jobId === id);
  assert.ok(found, `deploy-production.yml has no job "${id}"`);
  return found;
};

const STEP_NAME = "Fence — the working tree must be intact before anything is applied";
const SHA = "0ca478e9105105ff7013834615eee81499813d0e";

/** Pull a named step's `run:` block out of a workflow, as text. */
function extractStepScript(workflow, stepName) {
  const lines = readFileSync(workflow, "utf8").split("\n");

  const stepIndex = lines.findIndex((line) =>
    line.trim() === `- name: ${stepName}`,
  );
  assert.notEqual(stepIndex, -1, `step "${stepName}" not found in ${fileName(workflow)}`);
  assert.equal(
    lines.filter((line) => line.trim() === `- name: ${stepName}`).length,
    1,
    `more than one step is named "${stepName}" in ${fileName(workflow)}`,
  );

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
  writeFileSync(scriptPath, extractStepScript(SHARED, STEP_NAME));
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("the replay/apply fence", () => {
  // Production's, and its own step: no `continue-on-error` can swallow it.
  it("is production's step, after the rehearsal and before the apply", () => {
    const names = sharedSteps().map((s) => s.name);
    const fence = names.indexOf(STEP_NAME);
    assert.ok(names.indexOf("Rehearse the migration against production's applied state") < fence);
    assert.ok(fence < names.indexOf("Stop the disposable Supabase stack"));
    assert.ok(fence < names.indexOf("Run migrations (apply)"));
  });

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
    writeFileSync(path, extractStepScript(CALLER, CONFIRM_STEP).replace(/\$\{\{[^}]*\}\}/g, ""));
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
    const source = extractStepScript(CALLER, CONFIRM_STEP);
    assert.ok(!/secrets\./.test(source));
  });
});

describe("the SHA-trim step (run 34234768094)", () => {
  const TRIM_STEP = "Trim the SHA";

  function runTrim(raw) {
    const path = join(workspace, "trim-sha.sh");
    writeFileSync(path, extractStepScript(CALLER, TRIM_STEP).replace(/\$\{\{[^}]*\}\}/g, ""));
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

  // Later jobs must consume the trimmed output. Assigning `inputs.sha` again
  // would reintroduce the trailing space that killed 34234768094. Inside
  // `_deploy.yml`, `inputs.sha` IS the trimmed value (its own input), so the
  // rule is about this file: after the trim, nothing reads the raw input.
  it("nothing after the trim reads inputs.sha; the call and the tag take the trimmed output", () => {
    const text = withoutComments(readFileSync(CALLER, "utf8"));
    const trimAt = text.indexOf("- name: Trim the SHA");
    assert.notEqual(trimAt, -1);
    // From the step after the trim: the trim itself reads the raw input.
    const afterTrim = text.indexOf("- name:", trimAt + 1);
    assert.notEqual(afterTrim, -1);
    assert.doesNotMatch(text.slice(afterTrim), /\binputs\.sha\b/);
    assert.equal(callerJob("deploy").keys.get("with").get("sha"), VALIDATED_SHA);
    assert.equal(callerJob("release").keys.get("with").get("sha"), VALIDATED_SHA);
    assert.match(text, /HEAD_SHA:\s*\$\{\{\s*needs\.validate\.outputs\.sha\s*\}\}/);
  });

  // The per-call-site guard #2265 added here has MOVED to
  // `deploy-vercel-env-contract.test.mjs`, generalised rather than dropped: it
  // asserts every variable `deploy-vercel.mjs` requires for a call site's phase
  // (read from that script's own table, so the two cannot drift), across every
  // workflow that invokes it. The exact #2265 case is pinned by name there.
  // Kept as a pointer rather than a second copy: one canonical owner per fact.
});

// ── The other half of the #2265 shape ──────────────────────────────────────
//
// A whole-file grep for DEPLOY_SHA is satisfied by a single match, and the
// shared job has a dozen steps that pass it, so most of them could lose theirs
// with the suite still green. That is the identical shape #2265 fixed for the
// Vercel build step. The worst is the production Render deploy:
// `deploy-render-production.mjs` calls `requireEnv("DEPLOY_SHA")`, the step
// runs AFTER `Run migrations (apply)`, and no dry run reaches it. A regression
// there fails a production run with the database already migrated.
//
// So: assert per STEP, over every step that passes the value.
describe("DEPLOY_SHA is sourced per step, not somewhere in the file", () => {
  const steps = () => sharedSteps();
  const carriers = () => steps().filter((step) => step.env.has("DEPLOY_SHA"));
  // Staging's served-commit check verifies the PLANNED commit, which is the
  // one staging already served when the plan deploys no API.
  const PLANNED = new Map([["Verify staging serves the commit", "${{ steps.plan.outputs.verify_sha }}"]]);
  const PRODUCTION_CARRIERS = [
    "Check out the commit being deployed",
    "Build the Vercel production bundles (web + landing)",
    "Deploy the commit to Render (production)",
    "Verify production serves the commit",
    "Deploy the commit to Vercel production (web + landing)",
  ];

  // A loop over an empty list passes. If the reader ever stops recognising
  // these steps, the assertions below would go quietly green.
  it("finds every step that passes DEPLOY_SHA", () => {
    const names = carriers().map((s) => s.name);
    for (const name of PRODUCTION_CARRIERS) {
      assert.ok(names.includes(name), `"${name}" no longer passes DEPLOY_SHA (found: ${names.join(", ")})`);
    }
    assert.ok(names.length >= 10, `expected at least 10 steps passing DEPLOY_SHA, found ${names.length}`);
  });

  it("gives every one of them the called job's sha input", () => {
    for (const step of carriers()) {
      assert.equal(
        step.env.get("DEPLOY_SHA"),
        PLANNED.get(step.name) ?? INPUT_SHA,
        `step "${step.name}" passes DEPLOY_SHA as "${step.env.get("DEPLOY_SHA")}"`,
      );
    }
  });

  // Named explicitly because this one runs after the apply, and because no dry
  // run executes it: its only protection is this assertion.
  it("the production Render deploy passes DEPLOY_SHA, and it runs after the apply", () => {
    const render = steps().find((s) => s.name === "Deploy the commit to Render (production)");
    assert.ok(render, "the production Render deploy step is missing");
    assert.equal(render.env.get("DEPLOY_SHA"), INPUT_SHA);

    const names = steps().map((s) => s.name);
    assert.ok(
      names.indexOf("Run migrations (apply)") < names.indexOf("Deploy the commit to Render (production)"),
      "the Render deploy is expected to run after the migration apply",
    );
  });
});

// The order is what makes a failure cheap. A `full` release builds both
// bundles before it migrates (run 33275321347 migrated, shipped the API, then
// failed the frontend build), a dry run stops after that build and before the
// apply, and the frontends ship only once production serves the new API.
describe("production's steps run in the order that fails before it writes", () => {
  const ORDER = [
    "Provider guardrail preflight",
    "Inject production secrets from Infisical",
    "Check out the commit being deployed",
    "Start disposable Supabase stack",
    "Rehearse the migration against production's applied state",
    STEP_NAME,
    "Stop the disposable Supabase stack",
    "Run migrations (dry-run)",
    "Assert supabase config was not rewritten by link (before the apply)",
    "Build the Vercel production bundles (web + landing)",
    "Stop here (dry run only)",
    "Run migrations (apply)",
    "Assert supabase config was not rewritten by link",
    "Deploy the commit to Render (production)",
    "Verify production serves the commit",
    "Check the API answers its clients (production)",
    "Deploy the commit to Vercel production (web + landing)",
  ];

  it("preflight, rehearse, build, stop on a dry run, then apply, API, verify, frontends", () => {
    const names = sharedSteps().map((s) => s.name);
    const at = ORDER.map((name) => {
      assert.ok(names.includes(name), `step "${name}" not found`);
      return names.indexOf(name);
    });
    for (let k = 1; k < ORDER.length; k += 1) {
      assert.ok(at[k - 1] < at[k], `"${ORDER[k - 1]}" must run before "${ORDER[k]}"`);
    }
  });
});

// ── What the dry run rehearses, held in place ──────────────────────────────
//
// The rehearsal/ship split is only these `if:` conditions, in both directions:
// the build steps could silently go back to being dry-run-skipped, or the
// shipping steps could silently start running on a dry run. The first quietly
// undoes the coverage; the second deploys from a run whose entire contract is
// that it deploys nothing.
describe("the dry run rehearses the build and ships nothing", () => {
  const byName = () => new Map(sharedSteps().map((step) => [step.name, step]));

  // Run on a dry run, skipped only for migrations-only.
  const REHEARSED = [
    "Install dependencies",
    "Install Vercel CLI",
    "Build the Vercel production bundles (web + landing)",
  ];

  // Never run on a dry run. Each one writes to production, or checks a write
  // that didn't happen.
  const SHIPPING = [
    "Run migrations (apply)",
    "Assert supabase config was not rewritten by link",
    "Deploy the commit to Render (production)",
    "Verify production serves the commit",
    "Check the API answers its clients (production)",
    "Deploy the commit to Vercel production (web + landing)",
  ];

  for (const name of REHEARSED) {
    it(`"${name}" runs on a dry run`, () => {
      const step = byName().get(name);
      assert.ok(step, `step "${name}" not found`);
      assert.doesNotMatch(
        step.if ?? "",
        /dry_run/,
        `step "${name}" is gated on dry_run again; the dry run stops rehearsing the ` +
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
        /!inputs\.dry_run\b/,
        `step "${name}" would run on a dry run — a dry run must apply nothing and deploy nothing`,
      );
    });
  }

  // The rehearsal is the only thing that has ever executed the write first, so
  // a migrations-only run (still a write) and a dry run both need it.
  it("the rehearsal, the fence and the stack are production's, and gated on nothing else", () => {
    for (const name of [
      "Start disposable Supabase stack",
      "Rehearse the migration against production's applied state",
      STEP_NAME,
      "Stop the disposable Supabase stack",
      "Provider guardrail preflight",
    ]) {
      const step = byName().get(name);
      assert.ok(step, `step "${name}" not found`);
      assert.equal(step.if, "inputs.environment == 'production'", `"${name}"'s condition changed`);
    }
    assert.doesNotMatch(withoutComments(readFileSync(SHARED, "utf8")), /continue-on-error/);
  });

  // `link` already ran in the dry run, so a config.toml it rewrote must stop the run
  // before the apply, on a dry run and a migrations-only run too, and on staging,
  // whose every merge is the first run a CLI bump gets.
  it("the pre-apply config.toml assert is gated on nothing", () => {
    const step = byName().get("Assert supabase config was not rewritten by link (before the apply)");
    assert.ok(step, "the pre-apply config.toml assert is missing");
    assert.equal(step.if ?? null, null, "the pre-apply config.toml assert gained a condition");
  });

  it("the dry-run stop reads the dry_run input, and the caller wires it from dry_run_only", () => {
    assert.equal(byName().get("Stop here (dry run only)")?.if, "${{ inputs.dry_run }}");
    const call = callerJob("deploy").keys.get("with");
    assert.equal(call.get("dry_run"), "${{ inputs.dry_run_only }}");
    assert.equal(call.get("scope"), "${{ inputs.scope }}");
    assert.equal(call.get("environment"), "production");
  });

  // Steps are not the whole story. `release` mints and PUSHES the `vX.Y.Z` tag,
  // and it is gated at JOB level, so nothing above can see it. #1340 redefined
  // that tag to mean "this is what is live"; a dry run that tagged would restore
  // the exact meaning it was redefined to remove, and `deploy-outcome` would
  // exit 0 because RELEASE_RESULT came back `success`.
  it("the release job, which pushes the version tag, never runs on a dry run", () => {
    const release = callerJob("release");
    assert.match(
      release.if ?? "",
      /!inputs\.dry_run_only/,
      "the release job would mint a vX.Y.Z tag on a dry run, for a commit that was never deployed",
    );
    assert.match(release.if ?? "", /inputs\.scope != 'migrations-only'/);
    assert.match(release.if ?? "", /needs\.deploy\.result == 'success'/);
  });

  // The Sentry guard's whole wiring is this one `env:` key, and it now spans
  // two files. A tidy-up that deleted either link would leave
  // `deploy-vercel.mjs` reading no DRY_RUN, and every dry run would build with
  // the real token, with the suite green.
  it("the build step wires DRY_RUN from the input the Sentry guard reads", () => {
    const build = byName().get("Build the Vercel production bundles (web + landing)");
    assert.ok(build, "the Vercel build step is missing");
    assert.equal(build.stepEnv.get("DRY_RUN"), "${{ inputs.dry_run }}");
  });
});

// Installs before any secret (#2801): `npm ci` and the Vercel CLI install used
// to run after the Infisical `prod` injection, so every dependency's lifecycle
// script ran with SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_PASSWORD,
// STRIPE_SECRET_KEY and the rest of production's store in its environment.
//
// And the trust split (#2798, #2805): the installs run on the DEPLOYED commit,
// then the workspace moves to the trusted ref for the local actions and the
// checks, then back to the deployed commit for everything else.
describe("installs run before any secret, and the trust split holds", () => {
  const names = () => sharedSteps().map((s) => s.name);
  const at = (name) => {
    const i = names().indexOf(name);
    assert.notEqual(i, -1, `the shared deploy job has no step named "${name}"`);
    return i;
  };
  const INJECTS = ["Inject staging secrets from Infisical", "Inject production secrets from Infisical"];

  it("installs the deployed commit's dependencies before either injection", () => {
    const checkout = sharedSteps()[at("Checkout the commit to deploy")];
    assert.match(checkout.body, /uses:\s*actions\/checkout@/);
    assert.match(checkout.body, /ref:\s*\$\{\{ inputs\.sha \}\}/);
    for (const install of ["Install dependencies", "Install Vercel CLI"]) {
      assert.ok(at("Checkout the commit to deploy") < at(install), `"${install}" runs before the checkout`);
      for (const inject of INJECTS) {
        assert.ok(at(install) < at(inject), `"${install}" runs after "${inject}" (#2801)`);
      }
      assert.ok(at(install) < at("Move the workspace to the trusted ref"));
    }
    // Nothing that reads a secret runs before the installs but the guard,
    // which reads names only.
    for (const step of sharedSteps().slice(1, at("Install Vercel CLI") + 1)) {
      assert.doesNotMatch(step.body, /secrets\./, `"${step.name}" reads a secret before the installs finish`);
    }
  });

  it("moves to the trusted ref, forced and without repo hooks, before any local action", () => {
    const move = sharedSteps()[at("Move the workspace to the trusted ref")];
    assert.equal(move.env.get("TRUSTED_SHA"), "${{ github.sha }}");
    // Off, not unset: unset, git falls back to `.git/hooks`, which an install
    // script could have written.
    assert.match(move.body, /^\s*git config --local core\.hooksPath \/dev\/null$/m);
    assert.match(move.body, /^\s*git checkout --force --detach "\$TRUSTED_SHA"$/m);
    const hooks = move.body.indexOf("core.hooksPath");
    assert.ok(hooks < move.body.indexOf("git checkout"), "the hooks are turned off after the checkout they would run in");
  });

  it("runs the local actions and the trusted checks between the move and the detach", () => {
    const move = at("Move the workspace to the trusted ref");
    const detach = at("Check out the commit being deployed");
    for (const name of [
      "Setup Supabase CLI",
      "Provider guardrail preflight",
      "Keep a trusted copy of the served-commit check",
      "Record the job's environment names before Infisical adds to them",
      ...INJECTS,
    ]) {
      assert.ok(move < at(name) && at(name) < detach, `"${name}" runs outside the trusted window`);
    }
    const detachStep = sharedSteps()[detach];
    assert.equal(detachStep.env.get("DEPLOY_SHA"), INPUT_SHA);
    assert.match(detachStep.body, /^\s*git checkout --detach "\$DEPLOY_SHA"$/m);
  });

  it("verifies the served commit from the trusted copy, never the deployed tree", () => {
    const copy = sharedSteps()[at("Keep a trusted copy of the served-commit check")];
    const dir = copy.env.get("TRUSTED_CI");
    assert.match(dir ?? "", /^\$\{\{ runner\.temp \}\}\//);
    assert.match(copy.body, /cp -R scripts\/ci "\$TRUSTED_CI"/);
    const verifiers = sharedSteps().filter((s) => /verify-served-commit\.mjs/.test(s.body));
    assert.deepEqual(
      verifiers.map((s) => s.name),
      ["Verify staging serves the commit", "Verify production serves the commit"],
    );
    for (const step of verifiers) {
      assert.equal(step.env.get("TRUSTED_CI"), dir, `"${step.name}" reads another copy`);
      assert.doesNotMatch(step.body, /node scripts\/ci\/verify-served-commit/, `"${step.name}" runs the deployed tree's copy`);
      assert.ok(at(step.name) > at("Check out the commit being deployed"));
    }
  });

  // The rehearsal's stack starts after the detach, and a rollback can deploy a
  // commit from before supabase-start-disposable.sh existed (#2609). Run from
  // the deployed tree, the script would set a floor on rollbacks.
  it("starts the rehearsal stack from the trusted copy, never the deployed tree", () => {
    const copy = sharedSteps()[at("Keep a trusted copy of the served-commit check")];
    const start = sharedSteps()[at("Start disposable Supabase stack")];
    // The stack starts on every production run, migrations-only included, so
    // a copy that skipped any run would leave it a missing file.
    assert.equal(copy.if ?? null, null, "the trusted copy became conditional");
    assert.equal(start.env.get("TRUSTED_CI"), copy.env.get("TRUSTED_CI"), "the stack start reads another copy");
    assert.match(start.body, /run: bash "\$TRUSTED_CI\/supabase-start-disposable\.sh"/);
    assert.doesNotMatch(start.body, /scripts\/ci\/supabase-start-disposable/, "the stack start runs the deployed tree's copy");
    assert.ok(at("Start disposable Supabase stack") > at("Check out the commit being deployed"));
  });

  // What made the #2801 fix possible to test at all: the verifier's copy needs
  // no install, so it must stay free of npm imports.
  it("the trusted copy needs no install: the verifier imports Node built-ins and ./lib only", () => {
    const seen = new Set();
    const visit = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const [, spec] of source.matchAll(/^import[^"']*["']([^"']+)["']/gm)) {
        if (spec.startsWith("node:")) continue;
        assert.ok(spec.startsWith("./") || spec.startsWith("../"), `${fileName(file)} imports "${spec}", which the trusted copy can't resolve`);
        const target = join(dirname(file), spec);
        assert.ok(target.startsWith(join(REPO_ROOT, "scripts", "ci")), `${fileName(file)} imports outside scripts/ci: ${spec}`);
        visit(target);
      }
    };
    visit(join(REPO_ROOT, "scripts", "ci", "verify-served-commit.mjs"));
    // The source-map check (#2489) and the client checks (#3113) run from the same copy.
    visit(join(REPO_ROOT, "scripts", "ci", "verify-sentry-sourcemaps.mjs"));
    visit(join(REPO_ROOT, "scripts", "ci", "smoke-deployed-api.mjs"));
    // So does the config check (#3112). It loads the deployed commit's built
    // API, but only by path, in a child process; its own imports stay here.
    visit(join(REPO_ROOT, "scripts", "ci", "check-deploy-config.mjs"));
    assert.ok(seen.size > 2);
  });

  // #3113: CORS, the minimum app version and the copy function, asked of the
  // live API right after it is verified. Before any upload, so a failure ships
  // no frontend behind an API its clients can't use; under the verify step's
  // own condition, so it runs whenever that does.
  it("checks the API's clients from the trusted copy, right after each served-commit check", () => {
    const copy = sharedSteps()[at("Keep a trusted copy of the served-commit check")];
    const checks = sharedSteps().filter((s) => /smoke-deployed-api\.mjs/.test(s.body));
    assert.deepEqual(
      checks.map((s) => s.name),
      ["Check the API answers its clients (staging)", "Check the API answers its clients (production)"],
    );
    const verifies = ["Verify staging serves the commit", "Verify production serves the commit"];
    for (const [i, step] of checks.entries()) {
      const verify = sharedSteps()[at(verifies[i])];
      assert.equal(at(step.name), at(verifies[i]) + 1, `"${step.name}" runs right after "${verifies[i]}"`);
      assert.equal(step.if, verify.if, `"${step.name}" runs whenever "${verifies[i]}" does`);
      assert.equal(step.env.get("TRUSTED_CI"), copy.env.get("TRUSTED_CI"), `"${step.name}" reads another copy`);
      assert.match(step.body, /run: node "\$TRUSTED_CI\/smoke-deployed-api\.mjs"/);
      assert.doesNotMatch(step.body, /node scripts\/ci\/smoke-deployed-api/, `"${step.name}" runs the deployed tree's copy`);
      // The dashboard origins come from the trusted ref's source, not the deployed tree's.
      assert.equal(step.env.get("TRUSTED_SHA"), "${{ github.sha }}");
      // The key it calls the function with is the one the injection already
      // gave every step; the step names no secret of its own.
      assert.doesNotMatch(step.body, /secrets\./, `"${step.name}" passes a secret the job didn't already hold`);
      for (const upload of ["Upload web + landing to staging", "Deploy the commit to Vercel production (web + landing)"]) {
        assert.ok(at(step.name) < at(upload), `"${step.name}" must run before "${upload}"`);
      }
    }
    assert.equal(checks[0].env.get("TARGET_ENVIRONMENT"), "staging");
    assert.equal(checks[0].env.get("SERVICE_LABEL"), "frapp-api-staging");
    assert.equal(checks[1].env.get("TARGET_ENVIRONMENT"), "production");
    assert.equal(checks[1].env.get("SERVICE_LABEL"), "frapp-api-prod");
  });

  it("checks the source maps from the trusted copy, last, on a real full production run only", () => {
    const copy = sharedSteps()[at("Keep a trusted copy of the served-commit check")];
    const checks = sharedSteps().filter((s) => /verify-sentry-sourcemaps\.mjs/.test(s.body));
    assert.deepEqual(
      checks.map((s) => s.name),
      ["Check Sentry has this commit's source maps (staging)", "Check Sentry has this commit's source maps (production)"],
    );
    // Last: nothing after them can be skipped by one, and they judge what shipped.
    assert.deepEqual(sharedSteps().slice(-2).map((s) => s.name), checks.map((s) => s.name));
    for (const step of checks) {
      assert.equal(step.env.get("TRUSTED_CI"), copy.env.get("TRUSTED_CI"), `"${step.name}" reads another copy`);
      assert.match(step.body, /run: node "\$TRUSTED_CI\/verify-sentry-sourcemaps\.mjs"/);
      assert.equal(step.env.get("DEPLOY_SHA"), INPUT_SHA);
      assert.ok(at(step.name) > at("Check out the commit being deployed"));
    }
    const production = checks[1];
    assert.equal(production.if, "${{ inputs.environment == 'production' && !inputs.dry_run && inputs.scope != 'migrations-only' }}");
    assert.equal(production.env.has("TARGET_ENVIRONMENT"), false, "the script never names the environment");
    assert.equal(production.env.get("SOURCEMAPS_SINCE"), "${{ steps.builds-start.outputs.at }}");
    assert.equal(production.env.get("API_BUILT"), "true");
    assert.equal(production.env.get("FRONTENDS_BUILT"), "true");
    assert.match(production.body, /^\s*id: sourcemaps-production$/m);
  });
});

// The preflight used to read the SAME workflow-level env the deploy steps did,
// so it could only assert against the services the run shipped to. A caller's
// `env:` doesn't reach a called workflow, so each step reads the ids step's
// outputs (#2806), and this keeps them the same outputs.
describe("the preflight asserts against the services production ships to", () => {
  const byName = () => new Map(sharedSteps().map((step) => [step.name, step]));
  it("uses the production Render service and Vercel projects the deploy steps use", () => {
    const preflight = byName().get("Provider guardrail preflight");
    const render = byName().get("Deploy the commit to Render (production)");
    assert.equal(preflight.env.get("RENDER_SERVICE_ID"), render.env.get("RENDER_SERVICE_ID"));
    for (const name of ["Build the Vercel production bundles (web + landing)", "Deploy the commit to Vercel production (web + landing)"]) {
      for (const key of ["VERCEL_WEB_PROJECT_ID", "VERCEL_LANDING_PROJECT_ID", "VERCEL_TEAM_ID"]) {
        assert.equal(preflight.env.get(key), byName().get(name).env.get(key), `${key} differs from "${name}"'s`);
      }
    }
    // Where those come from, here and in the daily watchdog, is
    // `provider-ids.test.mjs`'s to pin.
    assert.match(preflight.body, /production-guardrails\.mjs --preflight --migrations-only/);
  });

  // `--migrations-only` drops frapp-landing's Git-link check, which only a run
  // that ships no frontend may skip. Run with a stub `node` that echoes its
  // arguments, so the branch the step takes is what's asserted.
  it("drops the frontend check only on a migrations-only run", () => {
    const script = extractStepScript(SHARED, "Provider guardrail preflight");
    const bin = mkdtempSync(join(tmpdir(), "preflight-"));
    writeFileSync(join(bin, "node"), '#!/bin/sh\necho "$@"\n', { mode: 0o755 });
    const run = (SCOPE) =>
      execFileSync("bash", ["-c", script], { env: { PATH: `${bin}:${process.env.PATH}`, SCOPE }, encoding: "utf8" }).trim();
    try {
      assert.equal(run("full"), "scripts/ci/production-guardrails.mjs --preflight");
      assert.equal(run("migrations-only"), "scripts/ci/production-guardrails.mjs --preflight --migrations-only");
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

// The Vercel steps build every CLI process's environment from the names the
// job had before its Infisical injection, plus each app's own keys (#2673).
// The runtime refuses a baseline that holds an app key, which catches a record
// step moved after an injection; these catch the rest in review: a record
// step that is gone, one that writes a file the Vercel steps don't read, and
// one moved earlier, where names exported between it and the injection would
// silently fall out of every CLI process's environment.
describe("the Vercel steps run on the pre-injection env baseline", () => {
  const steps = () => sharedSteps();
  const USES_INFISICAL = /uses:\s*\.\/\.github\/actions\/infisical-secrets/;
  const indexOf = (pred, what) => {
    const i = steps().findIndex(pred);
    assert.notEqual(i, -1, `the deploy job has no step that ${what}`);
    return i;
  };

  // Staging's injection sits between them, and the two never both run.
  it("records the baseline immediately before the two injections", () => {
    const record = indexOf((s) => s.body.includes("scripts/ci/record-env-baseline.mjs"), "records the baseline");
    const staging = steps()[record + 1];
    const production = steps()[record + 2];
    assert.match(staging.body, USES_INFISICAL);
    assert.match(staging.body, /env-slug:\s*"staging"/);
    assert.equal(staging.if, "inputs.environment == 'staging'");
    assert.match(production.body, USES_INFISICAL);
    assert.match(production.body, /env-slug:\s*"prod"/);
    assert.equal(production.if, "inputs.environment == 'production'");
    assert.equal(steps().filter((s) => USES_INFISICAL.test(s.body)).length, 2);
  });

  it("hands every Vercel step the file the record step wrote", () => {
    const record = steps().find((s) => s.body.includes("scripts/ci/record-env-baseline.mjs"));
    const written = record.env.get("VERCEL_BUILD_ENV_BASELINE");
    assert.match(written ?? "", /^\$\{\{ runner\.temp \}\}\//, "outside the checkout, so nothing uploads it");
    const vercel = steps().filter((s) => s.body.includes("scripts/ci/deploy-vercel.mjs"));
    assert.equal(vercel.length, 4, "expected build and upload, for preview and for production");
    for (const step of vercel) {
      assert.equal(step.env.get("VERCEL_BUILD_ENV_BASELINE"), written, `"${step.name}" reads another file`);
    }
  });
});

// The dry-run Sentry guard has two halves. `deploy-vercel.mjs` withholds the
// token from the build and strips it from the pulled file (tested in
// deploy-vercel.test.mjs), but that script runs from the DEPLOYED commit's
// tree, so a dry run of a commit from before #2673 gets an old copy that
// ignores DRY_RUN. The shell `unset` in the build step comes from the
// trusted ref and covers the job-env copy whatever commit is built.
describe("the dry-run Sentry guard on the Vercel build step", () => {
  const BUILD_STEP = "Build the Vercel production bundles (web + landing)";

  /** The step's script, with the real deploy swapped for a probe. */
  function runBuildStep(dryRun) {
    const path = join(workspace, "build-step.sh");
    const script = extractStepScript(SHARED, BUILD_STEP)
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

  it("clears SENTRY_AUTH_TOKEN on a dry run, whatever deploy-vercel.mjs the commit carries", () => {
    const output = runBuildStep("true");
    assert.match(output, /token=__UNSET__/);
    assert.doesNotMatch(output, /sntrys_realtoken/);
  });

  // The other half: a guard that cleared the token unconditionally would stop
  // every real production release from reaching Sentry.
  it("leaves SENTRY_AUTH_TOKEN alone on a real ship", () => {
    assert.match(runBuildStep("false"), /token=sntrys_realtoken/);
  });
});

// The production served-commit check is new shell (#2805): the old step curled
// `/health/ready` for any 2xx. A `full` run verifies the deployed commit; a
// migrations-only run verifies that the commit production already serves is
// still ready, so it has to read that commit first.
describe("the production served-commit check", () => {
  const VERIFY_STEP = "Verify production serves the commit";

  /** Run the step with `curl` stubbed on PATH and the verifier swapped for a probe. */
  function runVerify({ scope, health, url = "https://api.example.test/health" }) {
    const bin = mkdtempSync(join(tmpdir(), "verify-bin-"));
    writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash\n${health === null ? "exit 22" : `printf '%s' '${health}'`}\n`, { mode: 0o755 });
    const path = join(workspace, "verify-step.sh");
    writeFileSync(
      path,
      extractStepScript(SHARED, VERIFY_STEP)
        .replace(/\$\{\{[^}]*\}\}/g, "")
        .replace('node "$TRUSTED_CI/verify-served-commit.mjs"', 'printf "verify=%s\\n" "$DEPLOY_SHA"'),
    );
    try {
      const output = execFileSync("bash", [path], {
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SCOPE: scope, DEPLOY_SHA: SHA, API_HEALTHCHECK_URL: url },
      });
      return { code: 0, output };
    } catch (error) {
      return { code: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  }
  const SERVED = "1111111111111111111111111111111111111111";

  it("verifies the deployed commit on a full run, without reading /health first", () => {
    const { code, output } = runVerify({ scope: "full", health: null });
    assert.equal(code, 0, output);
    assert.match(output, new RegExp(`^verify=${SHA}$`, "m"));
  });

  it("verifies the commit production already serves on a migrations-only run", () => {
    const { code, output } = runVerify({ scope: "migrations-only", health: `{"status":"ok","commit":"${SERVED}"}` });
    assert.equal(code, 0, output);
    assert.match(output, new RegExp(`^verify=${SERVED}$`, "m"));
  });

  it("fails a migrations-only run when /health can't be read or names no commit", () => {
    for (const health of [null, '{"status":"ok"}', '{"commit":"not-a-sha"}']) {
      const { code, output } = runVerify({ scope: "migrations-only", health });
      assert.equal(code, 1, `passed on /health = ${health}`);
      assert.match(output, /Could not read the commit production serves/);
      assert.doesNotMatch(output, /verify=/);
    }
  });

  it("fails a migrations-only run with no API_HEALTHCHECK_URL", () => {
    const { code, output } = runVerify({ scope: "migrations-only", health: "{}", url: "" });
    assert.equal(code, 1);
    assert.match(output, /API_HEALTHCHECK_URL is not set/);
  });
});

describe("SHA validation runs before the production environment (run 34234768094)", () => {
  it("validate has no environment, so a bad paste cannot open a reviewer gate", () => {
    const validate = callerJob("validate");
    assert.equal(validate.keys.get("name"), "Confirm and validate the SHA");
    assert.equal(validate.keys.has("environment"), false);
    assert.equal(validate.keys.get("outputs").get("sha"), "${{ steps.sha.outputs.sha }}");
    const names = workflowSteps(CALLER).filter((s) => s.jobId === "validate").map((s) => s.name);
    assert.deepEqual(names.slice(0, 2), ["Verify confirmation phrase", "Trim the SHA"]);
    assert.ok(names.includes("Validate the commit"));
    // The commit it checks is the one the call deploys. Pointed at
    // `github.sha`, it would pass main's own tip and wave any SHA through.
    const check = workflowSteps(CALLER).find((s) => s.jobId === "validate" && s.name === "Validate the commit");
    assert.equal(check.env.get("DEPLOY_SHA"), "${{ steps.sha.outputs.sha }}");
    assert.equal(callerJob("deploy").keys.get("with").get("sha"), VALIDATED_SHA);
    assert.equal(sharedSteps().some((s) => s.name === "Verify confirmation phrase"), false);
  });

  // One job names the environment, so a release is one Approve click: the
  // shared job, called once. A job that calls a workflow can't name one, and
  // no other job here does.
  it("deploy needs validate and calls the shared job, the only production-environment job", () => {
    const deploy = callerJob("deploy");
    assert.equal(deploy.keys.get("needs"), "validate");
    assert.equal(deploy.keys.get("uses"), "./.github/workflows/_deploy.yml");
    // Without it the called job reads production's secrets empty (#2804,
    // run 36479856561 on staging); workflow-secrets-scope rule E pins it too.
    assert.equal(deploy.keys.get("secrets"), "inherit", "the call passes secrets: inherit");
    for (const job of workflowJobs(CALLER)) {
      assert.equal(job.keys.has("environment"), false, `job "${job.jobId}" names an environment: a second Approve click`);
    }
    const shared = workflowJobs(SHARED);
    assert.deepEqual(shared.map((j) => j.jobId), ["deploy"]);
    assert.equal(shared[0].keys.get("environment"), "${{ inputs.environment }}");
    assert.equal(shared[0].keys.get("concurrency").get("group"), "db-migrate-${{ inputs.environment }}");
  });
});

// The alert (#2805). A failed production deploy used to red one row and email
// the dispatcher; nothing durable recorded a half-shipped production.
describe("deploy-outcome alerts on a failed production deploy", () => {
  const outcomeSteps = () => workflowSteps(CALLER).filter((s) => s.jobId === "deploy-outcome");
  const ALERT_IF =
    "${{ !cancelled() && !inputs.dry_run_only && " +
    "(inputs.scope != 'migrations-only' || needs.deploy.result != 'success') }}";

  it("runs whenever deploy was attempted, with the permissions the alert needs", () => {
    const job = callerJob("deploy-outcome");
    assert.equal(job.if, "always() && needs.deploy.result != 'skipped'");
    assert.equal(job.keys.get("needs"), "[validate, deploy, release]");
    assert.equal(job.keys.get("permissions").get("issues"), "write");
    assert.equal(job.keys.get("permissions").get("contents"), "read");
    assert.equal(job.keys.get("permissions").get("actions"), "read", "this attempt's jobs, for a deploy that never started");
  });

  // Never on a dry run, a cancel, or a green migrations-only run (the code
  // didn't ship, so it can't close). A deploy job that never started reaches
  // the script, which reads this attempt's jobs and files nothing.
  it("raises or closes only on a real ship, or a failed migrations-only run", () => {
    const [checkout, alert, , summary] = outcomeSteps();
    assert.equal(checkout.if, ALERT_IF);
    assert.match(checkout.body, /uses:\s*actions\/checkout@/);
    assert.match(checkout.body, /persist-credentials:\s*false/);
    assert.equal(alert.name, "Report deploy outcome and alert on failure");
    assert.equal(alert.if, ALERT_IF);
    assert.match(alert.body, /run:\s*node scripts\/ci\/deploy-alert\.mjs/);
    assert.equal(alert.env.get("ALERT_CONFIG"), "deploy-production");
    assert.equal(alert.env.get("DEPLOY_NEEDS"), "${{ toJSON(needs) }}");
    assert.equal(alert.env.get("HEAD_SHA"), VALIDATED_SHA);
    assert.equal(alert.env.get("RUN_ID"), "${{ github.run_id }}");
    assert.equal(alert.env.get("RUN_ATTEMPT"), "${{ github.run_attempt }}");
    assert.match(alert.body, /^\s*id: alert$/m);
    // Last: it exits 1 on a failed deploy or tag, which would skip a later step.
    assert.equal(summary.name, "Summarise what actually happened");
    assert.equal(summary.if, "always()");
    assert.equal(outcomeSteps().length, 4);
  });

  // #2489. Its own step, before the summary (which exits 1 on a failed deploy
  // or tag and would skip it). Only on a real `full` run that shipped: a dry
  // run and a migrations-only run build nothing, and every run it reaches is
  // one the checkout ran for.
  it("files source-map alerts from the deploy job's report, only after a real full ship", () => {
    const [, , sourcemaps] = outcomeSteps();
    assert.equal(sourcemaps.name, "Alert on missing Sentry source maps");
    assert.equal(
      sourcemaps.if,
      "${{ !cancelled() && !inputs.dry_run_only && inputs.scope != 'migrations-only' && needs.deploy.result == 'success' }}",
    );
    assert.match(sourcemaps.body, /run:\s*node scripts\/ci\/sentry-sourcemaps-alert\.mjs/);
    assert.equal(sourcemaps.env.get("SOURCEMAPS"), "${{ needs.deploy.outputs.sourcemaps }}");
    assert.equal(sourcemaps.env.get("SOURCEMAPS_CHECKED"), "${{ needs.deploy.outputs.sourcemaps-checked }}");
    assert.equal(sourcemaps.env.get("GITHUB_TOKEN"), "${{ secrets.GITHUB_TOKEN }}");
    assert.equal(sourcemaps.env.get("TARGET_ENVIRONMENT"), "production");
    assert.equal(sourcemaps.env.get("DEPLOY_SHA"), VALIDATED_SHA);
  });

  it("matches the alert config it selects, and the roster lists its title", () => {
    const config = ALERT_CONFIGS["deploy-production"];
    assert.equal(config.workflowFile, ".github/workflows/deploy-production.yml");
    assert.equal(config.workflowLabel, workflowKeys(CALLER).get("name"));
    assert.equal(config.workflowLabel, "Deploy production", "migration-snapshot.yml triggers on this name");
    assert.equal(config.gateJob, null, "validate failing costs nothing and must never alert");
    assert.deepEqual(config.deployJobs, ["deploy"]);
    assert.equal(callerJob("deploy").keys.get("uses"), "./.github/workflows/_deploy.yml");
    assert.ok(config.alert.labels.includes("P1"));
    const routing = readFileSync(join(REPO_ROOT, ALERT_ROUTING), "utf8");
    assert.ok(routing.includes(`*${config.alert.title}*`), "alert-routing.md's roster must list the alert by its title");
  });

  // A deploy job that never ran a step fails or cancels like one that broke.
  // The alert tells them apart from this attempt's jobs, found by the caller
  // job's display name, not from an output of the called job: a failed call
  // may not carry its outputs back.
  it("files nothing for a deploy job that never started, found by the caller's job name", () => {
    assert.equal(ALERT_CONFIGS["deploy-production"].quietWhenNeverStarted, callerJob("deploy").keys.get("name"));
    assert.doesNotMatch(withoutComments(readFileSync(CALLER, "utf8")), /needs\.deploy\.outputs\.started/);
    assert.equal(workflowJobs(SHARED)[0].keys.get("outputs").has("started"), false);
  });

  // The summary must not send a run where nothing was applied to the rollback
  // playbook: a deploy job that ran no step, or any dry run.
  it("the summary points at the rollback playbook only when something may have been applied", () => {
    const summary = outcomeSteps().at(-1);
    assert.equal(summary.env.get("ALERT_OUTCOME"), "${{ steps.alert.outputs.outcome }}");
    const script = extractStepScript(CALLER, summary.name);
    const dir = mkdtempSync(join(tmpdir(), "summary-"));
    const run = (env) => {
      const file = join(dir, "summary.md");
      writeFileSync(file, "");
      const base = { SHA: SHA, SCOPE: "full", DRY_RUN: "false", DEPLOY_RESULT: "failure", RELEASE_RESULT: "skipped", ALERT_OUTCOME: "" };
      const result = spawnSync("bash", ["-c", script], {
        env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: file, ...base, ...env },
        encoding: "utf8",
      });
      return { code: result.status, out: result.stdout };
    };
    const ROLLBACK = /db-rollback-playbook/;
    try {
      const notStarted = run({ ALERT_OUTCOME: "not-started" });
      assert.equal(notStarted.code, 1);
      assert.match(notStarted.out, /production is unchanged/);
      assert.doesNotMatch(notStarted.out, ROLLBACK);

      const dryRun = run({ DRY_RUN: "true" });
      assert.equal(dryRun.code, 1);
      assert.match(dryRun.out, /A dry run applies nothing/);
      assert.doesNotMatch(dryRun.out, ROLLBACK);

      const failed = run({ ALERT_OUTCOME: "failed" });
      assert.equal(failed.code, 1);
      assert.match(failed.out, ROLLBACK);

      assert.equal(run({ DEPLOY_RESULT: "success", RELEASE_RESULT: "success", ALERT_OUTCOME: "deployed" }).code, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Production has one path: this dispatch, through the shared job. A second
// workflow that migrated production or shipped its API or frontends would skip
// the confirmation, the validation, the approval, the rehearsal and the fence.
describe("the shared job is the only thing that migrates or ships production", () => {
  it("no other workflow runs the migration, the Render deploy or a production upload", () => {
    const dir = join(REPO_ROOT, ".github", "workflows");
    for (const file of workflowFiles().filter((f) => f !== "_deploy.yml")) {
      const other = withoutComments(readFileSync(join(dir, file), "utf8"));
      assert.doesNotMatch(other, /node scripts\/run-migration\.mjs/, `${file} applies migrations`);
      assert.doesNotMatch(other, /deploy-render-production\.mjs/, `${file} deploys to Render`);
      assert.doesNotMatch(other, /DEPLOY_TARGET: production/, `${file} ships the production frontends`);
    }
  });
});
